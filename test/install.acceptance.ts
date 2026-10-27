import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { PmClient, certifyCompleteListResult, splitAcceptanceCriteria } from '@unbrained/pm-cli/sdk';

/** One lint verdict as rendered by the packed extension command. */
interface LintVerdict {
  findings: { item_id: string; rule: string; severity: string; field: string; hint: string; title: string; excerpt: string }[];
  count: number;
  scanned: number;
  corpus_count: number;
  summary: Record<string, Record<string, number>>;
  fail_on: string;
  /** Present only when findings met the failure threshold; absence means success. */
  exit_code?: number;
}

/** One row of the rule table as rendered by the packed `pm lint rules` command. */
interface RuleRow {
  code: string;
  severity: string;
  scope: string;
  field: string;
  description: string;
  hint: string;
  settings: string;
}

/** One item identity as reported by the consumer CLI's `create` command. */
interface CreatedItem {
  id: string;
}

/** Every stable rule code this package documents, used to disable the whole set. */
const RULE_CODES = ['PML001', 'PML002', 'PML003', 'PML004', 'PML005', 'PML006', 'PML007', 'PML008', 'PML009', 'PML010'];

/** Isolated consumer environment shared by packed commands and package managers. */
function consumerEnv(cwd: string, pmRoot: string, home = cwd): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, PM_PATH: pmRoot, PM_AUTHOR: 'install-test', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', NPM_CONFIG_USERCONFIG: '/dev/null', npm_config_userconfig: '/dev/null' };
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'npm_config_allow_scripts') delete env[key];
  return env;
}

/** Execute a real consumer process and preserve diagnostics on unexpected exits. */
function runConsumer(cwd: string, name: string, args: string[], pmRoot: string, home = cwd): { stdout: string; status: number | null } {
  const result = spawnSync(name, args, { cwd, encoding: 'utf8', env: consumerEnv(cwd, pmRoot, home), maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.error, undefined);
  assert.ok(result.status === 0 || result.status === 1, `${name} ${args.join(' ')}\n${result.stderr}\n${result.stdout}`);
  return { stdout: result.stdout, status: result.status };
}

/** Execute setup commands, which must succeed rather than return a lint verdict. */
function command(cwd: string, name: string, args: string[], pmRoot: string, home = cwd): string {
  const result = runConsumer(cwd, name, args, pmRoot, home);
  assert.equal(result.status, 0, result.stdout);
  return result.stdout;
}

/** Parse a host-shaped JSON read while preserving the lint exit status. */
function jsonRead(cwd: string, runner: string, prefix: string[], pmRoot: string, subcommand: string[], extra: string[]): { data: Record<string, unknown>; status: number | null } {
  const result = runConsumer(cwd, runner, [...prefix, '--json', 'lint', ...subcommand, ...extra], pmRoot);
  return { data: JSON.parse(result.stdout) as Record<string, unknown>, status: result.status };
}

/** Read a complete lint verdict for assertions independent of host compaction. */
function lintCommand(cwd: string, runner: string, prefix: string[], pmRoot: string, extra: string[] = []): { verdict: LintVerdict; status: number | null } {
  const result = jsonRead(cwd, runner, prefix, pmRoot, [], extra);
  const verdict = result.data as unknown as LintVerdict;
  assert.equal(verdict.count, verdict.findings.length, 'the full rendered count must match the findings array');
  return { verdict, status: result.status };
}

/** Read lint rows with host projection or compaction controls applied. */
function lintRaw(cwd: string, runner: string, prefix: string[], pmRoot: string, extra: string[]): Record<string, unknown> {
  return jsonRead(cwd, runner, prefix, pmRoot, [], extra).data;
}

/** Read the packed rule listing, which always exits successfully. */
function rulesCommand(cwd: string, runner: string, prefix: string[], pmRoot: string, extra: string[] = []): { rules: RuleRow[]; count: number } {
  const result = jsonRead(cwd, runner, prefix, pmRoot, ['rules'], extra);
  assert.equal(result.status, 0);
  return result.data as unknown as { rules: RuleRow[]; count: number };
}

/** Follow every declared continuation and reject overlap, omissions and non-progress. */
function continuationRows(cwd: string, runner: string, prefix: string[], pmRoot: string, subcommand: string[], path: string, key: string): string[] {
  const collected: string[] = [];
  let cursor: string | undefined;
  let budget = 900;
  for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
    const extra = ['--output-budget', String(budget), ...(cursor === undefined ? [] : ['--output-cursor', cursor])];
    const page = jsonRead(cwd, runner, prefix, pmRoot, subcommand, extra).data;
    const rows = page[path] as Record<string, string>[];
    assert.ok(rows.length > 0, 'every continuation makes progress');
    for (const row of rows) collected.push(path === 'findings' ? `${row.item_id}:${row.rule}` : row[key]);
    const receipt = page.output_budget_truncation as { continuations?: { path: string; cursor: string }[] } | undefined;
    const next = receipt?.continuations?.find(entry => entry.path === path)?.cursor;
    if (collected.length === rows.length && cursor === undefined && next === undefined && budget > 450) {
      collected.length = 0;
      budget -= 150;
      continue;
    }
    if (cursor === undefined) assert.ok(next, 'a bounded read has a continuation');
    if (next === undefined) {
      assert.equal(new Set(collected).size, collected.length, 'no row repeats across pages');
      return collected.sort();
    }
    assert.notEqual(next, cursor, 'continuation advances');
    cursor = next;
  }
  assert.fail('continuation did not terminate within 100 pages');
}

test('packed npm/npx and native Bun/bunx consumers lint a real tracker through the extension', { timeout: 3600000 }, async t => {
  const root = resolve(import.meta.dirname, '..');
  const scratch = await mkdtemp(join(tmpdir(), 'pm-lint-install-'));
  // Package-manager caches can still be flushing when the scratch directory is removed.
  t.after(async () => { await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); });
  // npm 10 still runs prepare during pack; its source workspace must use the source tracker.
  const packOutput = command(root, 'npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', scratch], join(root, '.agents/pm'), scratch);
  // npm 10 can prefix its final JSON array with prepare output.
  const manifest = JSON.parse(packOutput.slice(packOutput.lastIndexOf('\n[') + 1)) as { name: string; filename: string; files: { path: string }[] }[];
  assert.equal(manifest[0].name, '@unbrained/pm-lint');
  assert.match(manifest[0].filename, /^unbrained-pm-lint-[0-9].*\.tgz$/);
  const files = manifest[0].files.map(file => file.path);
  assert.ok(files.includes('dist/index.js'));
  for (const file of files) assert.ok(file.startsWith('dist/') || ['package.json', 'manifest.json', 'README.md', 'LICENSE', 'CHANGELOG.md', 'examples/authoring-rules.json', 'docs/portable-rule-packs-validation.md', 'docs/repair-preview-example.md', 'docs/repair-preview-validation.md'].includes(file), `unexpected packed file: ${file}`);
  assert.ok(files.includes('examples/authoring-rules.json'));
  const tarball = join(scratch, manifest[0].filename);
  const sdk = JSON.parse(await importManifest(root)) as { devDependencies: Record<string, string> };
  for (const runtime of ['npm', 'bun']) {
    const cwd = join(scratch, runtime);
    await writeConsumer(cwd);
    assert.equal((await readdir(cwd)).includes('.git'), false, 'consumer tracker is outside Git');
    const pmRoot = join(cwd, '.agents/pm');
    const args = runtime === 'npm' ? ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball, `@unbrained/pm-cli@${sdk.devDependencies['@unbrained/pm-cli']}`] : ['add', '--ignore-scripts', tarball, `@unbrained/pm-cli@${sdk.devDependencies['@unbrained/pm-cli']}`];
    command(cwd, runtime, args, pmRoot);
    const installed = JSON.parse(await readFile(join(cwd, 'node_modules/@unbrained/pm-lint/package.json'), 'utf8')) as { name: string };
    assert.equal(installed.name, '@unbrained/pm-lint');
    const runner = runtime === 'npm' ? 'npx' : 'bunx';
    const prefix = runtime === 'npm' ? ['--no-install', 'pm'] : ['--bun', '--no-install', 'pm'];
    command(cwd, runner, [...prefix, 'init', 'consumer', '--defaults', '--agent-guidance', 'skip', '--json'], pmRoot);
    command(cwd, runner, [...prefix, 'install', tarball, '--project', '--json'], pmRoot);
    const activated = JSON.parse(await readFile(join(pmRoot, 'extensions/pm-lint/manifest.json'), 'utf8')) as { name: string };
    assert.equal(activated.name, 'pm-lint');
    const help = command(cwd, runner, [...prefix, 'lint', '--help'], pmRoot).replace(/\s+/g, ' ');
    for (const text of ['Run only these rule codes', 'Skip these rule codes', 'Lint only these item ids', 'Lowest severity', 'SDK item type', 'comma-separated statuses', 'calendar date', 'Override the severity']) assert.ok(help.includes(text), `help describes ${text}`);
    // A deliberately weak item joins the certified corpus before the first verdict.
    const created = JSON.parse(command(cwd, runner, [...prefix, 'create', 'Feature', 'Weak context item', '--description', 'Weak context item', '--json'], pmRoot)) as CreatedItem;
    // The default verdict must cover the certified complete corpus and report the weak item.
    const initial = lintCommand(cwd, runner, prefix, pmRoot);
    assert.ok(initial.verdict.corpus_count >= 1, 'the lint must read the real initialized tracker');
    assert.ok(initial.verdict.scanned >= 1, 'selection defaults to the whole certified corpus');
    assert.ok(initial.verdict.findings.every(finding => RULE_CODES.includes(finding.rule)), 'findings carry stable rule codes');
    assert.ok(['info', 'warn', 'error'].includes(initial.verdict.fail_on), 'the exit policy names a stable severity');
    assert.ok(initial.verdict.findings.some(finding => finding.item_id === created.id), 'the weak item is reported with its complete canonical id');
    assert.ok(initial.verdict.findings.every(finding => finding.severity === 'error' || finding.severity === 'warn' || finding.severity === 'info'), 'findings carry stable severities');
    assert.ok(initial.verdict.findings.every(finding => finding.title === 'Weak context item'), 'findings carry the offending title');
    const restated = initial.verdict.findings.find(finding => finding.rule === 'PML008');
    assert.equal(restated?.excerpt, 'Weak context item', 'the restated description is excerpted');
    assert.ok(initial.verdict.findings.every(finding => typeof finding.excerpt === 'string' && finding.excerpt.length <= 160), 'excerpts stay bounded');
    assert.equal(initial.verdict.summary.PML002.error, initial.verdict.findings.filter(finding => finding.rule === 'PML002').length, 'the per-rule summary counts findings by severity');
    // The rule table read command lists the documented defaults and settings keys.
    const listing = rulesCommand(cwd, runner, prefix, pmRoot);
    assert.equal(listing.count, 10);
    assert.deepEqual(listing.rules.map(row => row.code), RULE_CODES);
    for (const row of listing.rules) {
      assert.ok(row.description.length > 0, `${row.code} lists a description`);
      assert.ok(row.scope.length > 0, `${row.code} lists a default scope`);
      assert.equal(row.settings, `lint.rules.${row.code}`, `${row.code} names its settings key`);
    }
    // Host output projection narrows finding rows to the requested fields.
    const projected = lintRaw(cwd, runner, prefix, pmRoot, ['--output-include', 'item_id,rule']);
    const projectedRows = (projected.findings as { item_id: string; rule: string }[]).map(row => Object.keys(row).sort());
    assert.ok(projectedRows.length > 0, 'the projected verdict still carries rows');
    for (const keys of projectedRows) assert.deepEqual(keys, ['item_id', 'rule'], 'projection keeps only the requested fields');
    // Disabling the whole documented rule set must empty the verdict without hiding the corpus.
    const disabled = lintCommand(cwd, runner, prefix, pmRoot, RULE_CODES.flatMap(code => ['--disable', code]));
    assert.equal(disabled.verdict.count, 0, 'no findings survive a full rule disable');
    assert.equal(disabled.verdict.scanned, initial.verdict.scanned, 'selection is independent of rule enablement');
    assert.equal(disabled.verdict.corpus_count, initial.verdict.corpus_count, 'certification is independent of rule enablement');
    assert.equal(disabled.status, 0, 'an empty verdict exits successfully');
    // Exercise packed baseline writes and reads through each real CLI runtime.
    const baselinePath = join(cwd, 'lint-baseline.json');
    const observed = initial.verdict.findings as unknown as { item_id: string; rule: string; rule_version: string; source_digest: string }[];
    for (const finding of observed) {
      const acknowledged = JSON.parse(command(cwd, runner, [...prefix, '--json', 'lint', 'acknowledge', '--baseline', baselinePath, '--id', finding.item_id, '--rule', finding.rule, '--reason', 'Accepted specific legacy debt', '--rule-version', finding.rule_version, '--source-digest', finding.source_digest], pmRoot)) as { ok: boolean };
      assert.equal(acknowledged.ok, true);
    }
    const baselineRead = jsonRead(cwd, runner, prefix, pmRoot, [], ['--baseline', baselinePath]);
    assert.equal(baselineRead.status, 0);
    assert.equal(baselineRead.data.debt_count, observed.length);
    assert.equal(baselineRead.data.new_count, 0);
    // Budget compaction returns a resumable continuation cursor for the findings rows.
    const fixtureClient = new PmClient({ cwd, pmRoot, author: 'install-test', noExtensions: true });
    for (let index = 2; index <= 5; index += 1) {
      const title = `Continuation weak item number ${index}`;
      await fixtureClient.create({ type: 'Feature', title, description: title, acceptanceCriteria: 'works', allowDuplicate: true });
    }
    const full = lintRaw(cwd, runner, prefix, pmRoot, []);
    const regressed = jsonRead(cwd, runner, prefix, pmRoot, [], ['--baseline', baselinePath]);
    assert.equal(regressed.status, 1);
    assert.equal(regressed.data.debt_count, observed.length);
    assert.ok(Number(regressed.data.new_count) > 0);
    const fullIds = (full.findings as { item_id: string; rule: string }[]).map(row => `${row.item_id}:${row.rule}`).sort();
    assert.ok(fullIds.length >= 10, 'the grown corpus carries enough findings to compact');
    assert.deepEqual(continuationRows(cwd, runner, prefix, pmRoot, [], 'findings', 'item_id'), fullIds, 'finding continuations cover the full verdict');
    const limitedRules = rulesCommand(cwd, runner, prefix, pmRoot, ['--output-limit', '2', '--output-include', 'code,scope']);
    assert.equal(limitedRules.rules.length, 2, 'the host limits declared rule rows');
    assert.deepEqual(Object.keys(limitedRules.rules[0]).sort(), ['code', 'scope'], 'the host projects declared rule rows');
    assert.deepEqual(continuationRows(cwd, runner, prefix, pmRoot, ['rules'], 'rules', 'code'), RULE_CODES, 'rule continuations cover the full registry');
    // The host renderer emits TOON by default and keeps the exit contract.
    const toon = spawnSync(runner, [...prefix, 'lint'], { cwd, encoding: 'utf8', env: { ...process.env, HOME: cwd, PM_PATH: pmRoot, PM_AUTHOR: 'install-test' } });
    assert.equal(toon.error, undefined);
    assert.ok(toon.stdout.length > 0, 'the default rendering is host TOON, not silence');
    assert.equal(toon.status, initial.verdict.exit_code ?? 0, 'TOON and JSON renderings share one exit contract');
    // The same shipped declarative pack runs through npm/npx and native Bun/bunx.
    const portablePath = join(cwd, 'node_modules/@unbrained/pm-lint/examples/authoring-rules.json');
    const portable = jsonRead(cwd, runner, prefix, pmRoot, ['pack'], ['--pack', portablePath]);
    assert.equal(portable.status, 1);
    assert.ok(Number(portable.data.count) > 0);
    assert.ok((portable.data.findings as { rule: string }[]).every(row => row.rule.startsWith('ORG.')));
    const portableToon = runConsumer(cwd, runner, [...prefix, 'lint', 'pack', '--pack', portablePath], pmRoot);
    assert.match(portableToon.stdout, /ORG.acceptance/);
    await writeFile(join(cwd, 'pack-sdk.mjs'), `import { lintRulePack, readRulePack, RulePackRefusal } from '@unbrained/pm-lint';\nimport { PmClient } from '@unbrained/pm-cli/sdk';\nconst pack = await readRulePack('node_modules/@unbrained/pm-lint/examples/authoring-rules.json');\nconst result = await lintRulePack(new PmClient({ pmRoot: '.agents/pm', noExtensions: true }), pack);\nif (result.count < 1 || result.exit_code !== 1 || typeof RulePackRefusal !== 'function') throw new Error('Packed rule SDK contract failed');\nconsole.log('packed-rule-sdk-ok');\n`);
    assert.match(command(cwd, runtime === 'npm' ? process.execPath : 'bun', ['pack-sdk.mjs'], pmRoot), /packed-rule-sdk-ok/);
    // The packed witness SDK and command retain exact citations in both runtimes.
    const proof = (await fixtureClient.create({ type: 'Task', title: 'Preserve packed witness citations', acceptanceCriteria: 'Output preserves the exact citation path' })).item;
    const bytes = 'Verified synthetic citation observation\n';
    await writeFile(join(cwd, 'proof.txt'), bytes);
    const corpus = certifyCompleteListResult(await fixtureClient.listAllComplete());
    const bindings = corpus.items.flatMap(item => splitAcceptanceCriteria(item.acceptance_criteria).map(criterion => ({ item_id: item.id, criterion, witnesses: item.id === proof.id ? [{ kind: 'observation', path: 'proof.txt#L1', sha256: createHash('sha256').update(bytes).digest('hex'), outcome: 'pass' }] : [{ kind: 'pending', reason: 'Other synthetic criteria await proof' }] })));
    const witnessPath = join(cwd, 'witnesses.json');
    await writeFile(witnessPath, JSON.stringify({ version: 1, bindings }));
    const witness = jsonRead(cwd, runner, prefix, pmRoot, ['witnesses'], ['--contract', witnessPath]);
    assert.equal(witness.status, 1, 'explicit pending proof remains unfinished');
    assert.equal((witness.data.summary as { supported: number }).supported, 1);
    const citation = (witness.data.findings as { item_id: string; citation: string }[]).find(row => row.item_id === proof.id);
    assert.equal(citation?.citation, 'proof.txt#L1');
    const witnessToon = runConsumer(cwd, runner, [...prefix, 'lint', 'witnesses', '--contract', witnessPath], pmRoot);
    assert.equal(witnessToon.status, 1);
    assert.match(witnessToon.stdout, /proof\.txt#L1/);
    await writeFile(join(cwd, 'witness-sdk.mjs'), `import { lintWitnesses, parseWitnessContract, observationDigest, WitnessRefusal } from '@unbrained/pm-lint';\nimport { PmClient } from '@unbrained/pm-cli/sdk';\nimport { readFile } from 'node:fs/promises';\nconst contract = parseWitnessContract(JSON.parse(await readFile('witnesses.json', 'utf8')));\nconst result = await lintWitnesses(new PmClient({cwd: '.', pmRoot: '.agents/pm', noExtensions: true}), contract, '.');\nif (result.summary.supported !== 1 || observationDigest('a').length !== 64 || typeof WitnessRefusal !== 'function') throw new Error('Packed witness SDK contract failed');\nconsole.log('packed-witness-sdk-ok');\n`);
    assert.match(command(cwd, runtime === 'npm' ? process.execPath : 'bun', ['witness-sdk.mjs'], pmRoot), /packed-witness-sdk-ok/);
    // Packed repair API and both renderers keep the single-target zero-write contract.
    const repair = jsonRead(cwd, runner, prefix, pmRoot, ['repair'], ['--id', created.id]);
    assert.equal(repair.status, 0);
    assert.equal(repair.data.writes, 0);
    assert.deepEqual(repair.data.patch, {});
    assert.equal(jsonRead(cwd, runner, prefix, pmRoot, ['repair'], ['--id', created.id, '--revision', String(repair.data.revision)]).status, 0);
    assert.match(command(cwd, runner, [...prefix, 'lint', 'repair', '--id', created.id], pmRoot), /writes: 0/);
    await writeFile(join(cwd, 'repair-sdk.mjs'), `import { previewAuthoringRepairs, RepairRefusal } from '@unbrained/pm-lint';\nconst result = await previewAuthoringRepairs('.agents/pm', { id: ${JSON.stringify(created.id)} });\nif (result.writes !== 0 || result.remaining_mechanical !== 0 || typeof RepairRefusal !== 'function') throw new Error('Packed repair SDK contract failed');\nconsole.log('packed-repair-sdk-ok');\n`);
    assert.match(command(cwd, runtime === 'npm' ? process.execPath : 'bun', ['repair-sdk.mjs'], pmRoot), /packed-repair-sdk-ok/);
    assert.ok((await readdir(cwd)).includes('node_modules'));
  }
});

/** Read package metadata without evaluating shipped extension code. */
async function importManifest(root: string): Promise<string> {
  return readFile(join(root, 'package.json'), 'utf8');
}

/** Materialize a minimal independent consuming workspace for one package manager. */
async function writeConsumer(cwd: string): Promise<void> {
  await mkdir(cwd);
  await writeFile(join(cwd, 'package.json'), '{"name":"lint-consumer","private":true,"type":"module"}\n');
}
