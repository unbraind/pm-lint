/** Compare built command functions on read-only public tracker copies outside git. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Hash file names and contents so additions, removals and edits all invalidate the proof. */
async function inventory(root: string): Promise<string> {
  const hash = createHash('sha256');
  const entries = (await readdir(root, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile()).sort((left, right) => join(left.parentPath, left.name).localeCompare(join(right.parentPath, right.name)));
  for (const entry of entries) {
    const path = join(entry.parentPath, entry.name);
    hash.update(path.slice(root.length)).update(await readFile(path));
  }
  return hash.digest('hex');
}

/** Execute both built commands with a fixed clock, preserving their actual refusal shape. */
function observe(build: string, root: string, pmRoot: string): Record<string, unknown> {
  const script = `
    import { writeFile } from 'node:fs/promises';
    import { renderLintCommand, runAcknowledgeCommand, runLintRulesCommand } from ${JSON.stringify(pathToFileURL(join(build, 'dist/src/commands.js')).href)};
    Date.now = () => Date.parse('2026-10-25T00:00:00Z');
    const [root, pmRoot] = process.argv.slice(1);
    const ctx = { command: 'lint', args: [], options: {}, pm_root: pmRoot, source_workspace_root: root, global: { author: 'validation-agent' } };
    const results = {};
    async function record(name, run) {
      try { results[name] = { returned: await run() }; }
      catch (error) {
        if (error.name !== 'PmCliError') throw error;
        results[name] = { thrown: { name: error.name, code: error.code, message: error.message, exitCode: error.exitCode, context: error.context } };
      }
    }
    await record('rules', runLintRulesCommand);
    await record('lint', () => renderLintCommand(ctx));
    const row = results.lint.returned.findings[0];
    if (!row) throw new Error('Public corpus must have a finding for acknowledgment proof');
    const baseline = root + '/baseline.json';
    await writeFile(baseline, JSON.stringify({version: 1, acknowledgments: []}));
    ctx.options = { baseline };
    await record('empty-baseline', () => renderLintCommand(ctx));
    ctx.options = { baseline, id: row.item_id, rule: row.rule, reason: 'Specific public validation debt', ruleVersion: row.rule_version, sourceDigest: row.source_digest };
    await record('acknowledge', () => runAcknowledgeCommand(ctx));
    ctx.options = { baseline };
    await record('debt-baseline', () => renderLintCommand(ctx));
    ctx.options = { baseline, disable: ['PML002'] };
    await record('unsafe-policy', () => renderLintCommand(ctx));
    ctx.options = { baseline: root + '/missing.json' };
    await record('missing-baseline', () => renderLintCommand(ctx));
    await writeFile(baseline, '{');
    ctx.options = { baseline };
    await record('invalid-json', () => renderLintCommand(ctx));
    await writeFile(baseline, '{}');
    await record('invalid-schema', () => renderLintCommand(ctx));
    ctx.options = {};
    await record('missing-acknowledgment', () => runAcknowledgeCommand(ctx));
    ctx.options = { baseline: ['a', 'b'] };
    await record('repeated-acknowledgment', () => runAcknowledgeCommand(ctx));
    await writeFile(baseline, JSON.stringify({version: 1, acknowledgments: []}));
    ctx.options = { baseline, id: row.item_id, rule: row.rule, reason: 'Specific public validation debt', ruleVersion: row.rule_version, sourceDigest: '0'.repeat(64) };
    await record('stale-evidence', () => runAcknowledgeCommand(ctx));
    ctx.options = { ...ctx.options, id: 'pm-absent-validation' };
    await record('absent-finding', () => runAcknowledgeCommand(ctx));
    console.log(JSON.stringify(results));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, root, pmRoot], { cwd: root, encoding: 'utf8', env: { ...process.env, PATH: join(root, 'no-executables'), HOME: root, PM_PATH: pmRoot, GIT_CEILING_DIRECTORIES: dirname(root) } });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

const [beforeBuild, ...sources] = process.argv.slice(2);
assert.ok(beforeBuild && sources.length > 0, 'Pass an origin/main package build and public tracker snapshots');
for (const source of sources) {
  const root = await mkdtemp(join(tmpdir(), 'pm-lint-differential-'));
  const pmRoot = join(root, '.agents', 'pm');
  try {
    await cp(resolve(source), pmRoot, { recursive: true });
    const entries = await readdir(pmRoot, { recursive: true, withFileTypes: true });
    for (const entry of entries) await chmod(join(entry.parentPath, entry.name), entry.isDirectory() ? 0o500 : 0o400);
    await chmod(pmRoot, 0o500);
    const hash = await inventory(pmRoot);
    const before = observe(resolve(beforeBuild), root, pmRoot);
    const after = observe(process.cwd(), root, pmRoot);
    const unchanged: string[] = [];
    const intentional: string[] = [];
    for (const [name, original] of Object.entries(before)) {
      const prior = original as { returned: { ok?: boolean; refusal?: { code: string; message: string; remedy: string }; exit_code?: number } };
      if (prior.returned.refusal === undefined) {
        assert.deepEqual(after[name], original, name);
        unchanged.push(name);
      } else {
        assert.equal(prior.returned.ok, false);
        assert.deepEqual(after[name], { thrown: { name: 'PmCliError', code: prior.returned.refusal.code, message: prior.returned.refusal.message, exitCode: prior.returned.exit_code, context: { code: prior.returned.refusal.code, nextSteps: [prior.returned.refusal.remedy] } } }, name);
        intentional.push(name);
      }
    }
    assert.equal(await inventory(pmRoot), hash, 'Both builds leave every tracker byte unchanged');
    console.log(JSON.stringify({ corpus_items: (before.lint as { returned: { corpus_count: number } }).returned.corpus_count, tracker_sha256: hash, unchanged, intentional_native_errors: intentional, tracker_bytes_unchanged: true, git_unavailable: true }));
  } finally {
    await chmod(pmRoot, 0o700);
    for (const entry of await readdir(pmRoot, { recursive: true, withFileTypes: true })) if (entry.isDirectory()) await chmod(join(entry.parentPath, entry.name), 0o700);
    await rm(root, { recursive: true, force: true });
  }
}
