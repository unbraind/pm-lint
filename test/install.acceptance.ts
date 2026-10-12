import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

/** One lint verdict as rendered by the packed extension command. */
interface LintVerdict {
  findings: { item_id: string; rule: string; severity: string; field: string; hint: string }[];
  count: number;
  scanned: number;
  corpus_count: number;
  fail_on: string;
  /** Present only when findings met the failure threshold; absence means success. */
  exit_code?: number;
}

/** One item identity as reported by the consumer CLI's `create` command. */
interface CreatedItem {
  id: string;
}

/** Every stable rule code this package documents, used to disable the whole set. */
const RULE_CODES = ['PML001', 'PML002', 'PML003', 'PML004', 'PML005', 'PML006', 'PML007', 'PML008', 'PML009', 'PML010'];

/** Run a consumer command with isolated HOME and tracker coordinates, preserving stderr for failures. */
function command(cwd: string, name: string, args: string[], pmRoot: string, home = cwd): string {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, PM_PATH: pmRoot, PM_AUTHOR: 'install-test', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', NPM_CONFIG_USERCONFIG: '/dev/null', npm_config_userconfig: '/dev/null' };
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'npm_config_allow_scripts') delete env[key];
  const result = spawnSync(name, args, { cwd, encoding: 'utf8', env, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, `${name} ${args.join(' ')}\n${result.stderr}\n${result.stdout}`);
  return result.stdout;
}

/** Run the packed lint command and return its rendered verdict plus process status. */
function lintCommand(cwd: string, runner: string, prefix: string[], pmRoot: string, extra: string[] = []): { verdict: LintVerdict; status: number | null } {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: cwd, PM_PATH: pmRoot, PM_AUTHOR: 'install-test', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', NPM_CONFIG_USERCONFIG: '/dev/null', npm_config_userconfig: '/dev/null' };
  const result = spawnSync(runner, [...prefix, '--json', 'lint', ...extra], { cwd, encoding: 'utf8', env, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.error, undefined);
  const verdict = JSON.parse(result.stdout) as LintVerdict;
  assert.equal(verdict.count, verdict.findings.length, 'the rendered count must match the findings array');
  return { verdict, status: result.status };
}

test('packed npm/npx and native Bun/bunx consumers lint a real tracker through the extension', { timeout: 1800000 }, async t => {
  const root = resolve(import.meta.dirname, '..');
  const scratch = await mkdtemp(join(tmpdir(), 'pm-lint-install-'));
  t.after(async () => { await rm(scratch, { recursive: true, force: true }); });
  // npm 10 still runs prepare during pack; its source workspace must use the source tracker.
  const packOutput = command(root, 'npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', scratch], join(root, '.agents/pm'), scratch);
  // npm 10 can prefix its final JSON array with prepare output.
  const manifest = JSON.parse(packOutput.slice(packOutput.lastIndexOf('\n[') + 1)) as { filename: string; files: { path: string }[] }[];
  const files = manifest[0].files.map(file => file.path);
  assert.ok(files.includes('dist/index.js'));
  for (const file of files) assert.ok(file.startsWith('dist/') || ['package.json', 'manifest.json', 'README.md', 'LICENSE', 'CHANGELOG.md'].includes(file), `unexpected packed file: ${file}`);
  const tarball = join(scratch, manifest[0].filename);
  const sdk = JSON.parse(await importManifest(root)) as { devDependencies: Record<string, string> };
  for (const runtime of ['npm', 'bun']) {
    const cwd = join(scratch, runtime);
    await writeConsumer(cwd);
    const pmRoot = join(cwd, '.agents/pm');
    const args = runtime === 'npm' ? ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball, `@unbrained/pm-cli@${sdk.devDependencies['@unbrained/pm-cli']}`] : ['add', '--ignore-scripts', tarball, `@unbrained/pm-cli@${sdk.devDependencies['@unbrained/pm-cli']}`];
    command(cwd, runtime, args, pmRoot);
    const runner = runtime === 'npm' ? 'npx' : 'bunx';
    const prefix = runtime === 'npm' ? ['--no-install', 'pm'] : ['--bun', '--no-install', 'pm'];
    command(cwd, runner, [...prefix, 'init', 'consumer', '--defaults', '--agent-guidance', 'skip', '--json'], pmRoot);
    command(cwd, runner, [...prefix, 'install', tarball, '--project', '--json'], pmRoot);
    assert.match(command(cwd, runner, [...prefix, 'lint', '--help'], pmRoot), /lint/);
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
    // Disabling the whole documented rule set must empty the verdict without hiding the corpus.
    const disabled = lintCommand(cwd, runner, prefix, pmRoot, RULE_CODES.flatMap(code => ['--disable', code]));
    assert.equal(disabled.verdict.count, 0, 'no findings survive a full rule disable');
    assert.equal(disabled.verdict.scanned, initial.verdict.scanned, 'selection is independent of rule enablement');
    assert.equal(disabled.verdict.corpus_count, initial.verdict.corpus_count, 'certification is independent of rule enablement');
    assert.equal(disabled.status, 0, 'an empty verdict exits successfully');
    // The host renderer emits TOON by default and keeps the exit contract.
    const toon = spawnSync(runner, [...prefix, 'lint'], { cwd, encoding: 'utf8', env: { ...process.env, HOME: cwd, PM_PATH: pmRoot, PM_AUTHOR: 'install-test' } });
    assert.equal(toon.error, undefined);
    assert.ok(toon.stdout.length > 0, 'the default rendering is host TOON, not silence');
    assert.equal(toon.status, initial.verdict.exit_code ?? 0, 'TOON and JSON renderings share one exit contract');
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