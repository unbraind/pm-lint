import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { activateExtensionForTest, runRegisteredCommandForTest } from '@unbrained/pm-cli/sdk/testing';
import type { ItemMetadata } from '@unbrained/pm-cli/sdk';
import type { CommandHandlerContext } from '@unbrained/pm-cli/sdk/authoring';
import extension, { acknowledgeFinding, BaselineRefusal, parseBaseline, sourceDigest } from '../index.ts';
import type { Acknowledgment, LintBaseline } from '../index.ts';
import { assertBaselinePolicy, isAcknowledged } from '../src/baseline.ts';
import { acknowledgeBaselineFile, readBaseline } from '../src/baseline-file.ts';
import { baselineRefusalReceipt, renderLintCommand, runAcknowledgeCommand, runLintCommand } from '../src/commands.ts';
import { lintItems } from '../src/engine.ts';
import { resolveConfig } from '../src/settings.ts';
import { tracker } from './helpers.ts';

const empty: LintBaseline = { version: 1, acknowledgments: [] };
const evidence: Acknowledgment = { item_id: 'pm-example-abcd', rule: 'PML002', rule_version: '1', source_digest: 'a'.repeat(64), reason: 'Legacy debt scheduled for repair' };

/** Assert machine-readable refusals carry a nonempty recovery action. */
function refusal(code: string): (error: unknown) => boolean {
  return error => error instanceof BaselineRefusal && error.code === code && error.remedy.length > 0;
}

test('strict portable baseline parser refuses malformed, broad and duplicate acknowledgments', () => {
  for (const bad of [null, [], 1, {}, { version: 2, acknowledgments: [] }, { version: 1, acknowledgments: {} }, { ...empty, disable: ['PML002'] }]) assert.throws(() => parseBaseline(bad), refusal('invalid_baseline'));
  for (const bad of [null, [], 'PML002', {}, { ...evidence, extra: true }, ...[
    ['item_id', 1], ['item_id', '*'], ['rule', 1], ['rule', '*'], ['rule_version', 1], ['rule_version', '*'], ['source_digest', 1], ['source_digest', 'bad'], ['reason', 1], ['reason', ' '], ['reason', 'a'.repeat(1001)],
  ].map(([key, value]) => ({ ...evidence, [key]: value }))]) assert.throws(() => parseBaseline({ version: 1, acknowledgments: [bad] }), refusal('invalid_baseline'));
  assert.throws(() => parseBaseline({ version: 1, acknowledgments: [evidence, evidence] }), refusal('invalid_baseline'));
  const parsed = parseBaseline({ version: 1, acknowledgments: [evidence, { ...evidence, rule: 'PML010' }] });
  parsed.acknowledgments[0].reason = 'independent copy';
  assert.notEqual(parsed.acknowledgments[0].reason, evidence.reason);
});

test('source digest is canonical, nested and sensitive to complete untrimmed text', () => {
  const left = { title: 'x', description: `${'a'.repeat(200)}x`, notes: [{ text: 'note', author: 'test' }], custom: null } as unknown as ItemMetadata;
  const reordered = { custom: null, notes: [{ author: 'test', text: 'note' }], description: left.description, title: 'x' } as unknown as ItemMetadata;
  assert.equal(sourceDigest(left), sourceDigest(reordered));
  assert.notEqual(sourceDigest(left), sourceDigest({ ...left, description: `${'a'.repeat(200)}y` }));
});

test('baseline retains debt while changes and new items fail, including non-error findings', async t => {
  const { client, pmRoot } = await tracker(t);
  const item = (await client.create({ type: 'Task', title: 'Implement observable legacy behavior', description: 'a'.repeat(200) })).item;
  const first = await lintItems(client, pmRoot, { baseline: empty });
  assert.equal(first.exit_code, 1);
  assert.equal(first.new_count, 1);
  const finding = first.findings[0];
  const request = { ...evidence, ...finding, reason: evidence.reason };
  // Only the five evidence fields are accepted, never a whole output row.
  assert.throws(() => acknowledgeFinding(first.findings, empty, request), refusal('invalid_baseline'));
  const ack: Acknowledgment = { item_id: finding.item_id, rule: finding.rule, rule_version: finding.rule_version, source_digest: finding.source_digest, reason: evidence.reason };
  const baseline = acknowledgeFinding(first.findings, empty, ack);
  const debt = await lintItems(client, pmRoot, { baseline });
  assert.equal(debt.exit_code, 0);
  assert.equal(debt.debt_count, 1);
  assert.equal(debt.new_count, 0);
  assert.equal(debt.stale_count, 0);
  assert.equal(debt.findings[0].disposition, 'debt');
  assert.equal(debt.summary.PML002.error, 1);
  const info = (await client.create({ type: 'Feature', title: 'Document another observable scenario', acceptanceCriteria: 'Output includes the expected rows' })).item;
  const fresh = await lintItems(client, pmRoot, { baseline });
  assert.equal(fresh.debt_count, 1, 'unrelated new items retain old debt');
  assert.equal(fresh.new_count, 1);
  assert.equal(fresh.findings.find(row => row.item_id === info.id)?.severity, 'info');
  assert.equal(fresh.exit_code, 1, 'new informational findings also fail baseline gates');
  await client.update(item.id, { description: `${'a'.repeat(200)}changed` });
  const changed = await lintItems(client, pmRoot, { baseline });
  assert.equal(changed.debt_count, 0);
  assert.equal(changed.stale_count, 1);
  assert.equal(changed.new_count, 2);
  assert.equal(changed.findings.find(row => row.item_id === item.id)?.excerpt, '');
  assert.equal(changed.exit_code, 1);
  assert.throws(() => acknowledgeFinding(changed.findings, baseline, ack), refusal('evidence_changed'));
  await client.update(item.id, { acceptanceCriteria: 'The command returns a verified receipt' });
  const resolved = await lintItems(client, pmRoot, { baseline });
  assert.equal(resolved.stale_count, 1);
  assert.ok(resolved.findings.every(row => row.item_id !== item.id));
});

test('version changes and exact identities invalidate acknowledgments; replacement preserves other debt', async t => {
  const { client, pmRoot } = await tracker(t);
  await client.create({ type: 'Task', title: 'TODO' });
  const result = await lintItems(client, pmRoot);
  let baseline = empty;
  for (const row of result.findings) baseline = acknowledgeFinding(result.findings, baseline, { item_id: row.item_id, rule: row.rule, rule_version: row.rule_version, source_digest: row.source_digest, reason: 'Deferred specific debt' });
  const first = baseline.acknowledgments[0];
  baseline = acknowledgeFinding(result.findings, baseline, { ...first, reason: 'Revised repair rationale' });
  assert.equal(baseline.acknowledgments.length, 2);
  assert.equal(baseline.acknowledgments[0].reason, 'Revised repair rationale');
  assert.throws(() => acknowledgeFinding([], baseline, first), refusal('invalid_acknowledgment'));
  assert.throws(() => acknowledgeFinding(result.findings, baseline, { ...first, rule_version: '0' }), refusal('evidence_changed'));
  assert.equal(isAcknowledged(result.findings[0], { version: 1, acknowledgments: [{ ...first, rule_version: '0' }] }), false);
  assert.equal(isAcknowledged(result.findings[0], { version: 1, acknowledgments: [{ ...first, rule: 'PML010' }] }), false);
  assert.equal(isAcknowledged(result.findings[0], { version: 1, acknowledgments: [{ ...first, item_id: 'pm-another-abcd' }] }), false);
  const oldVersion = await lintItems(client, pmRoot, { baseline: { version: 1, acknowledgments: baseline.acknowledgments.map(row => ({ ...row, rule_version: '0' })) } });
  assert.equal(oldVersion.debt_count, 0);
  assert.equal(oldVersion.stale_count, 2);
  assert.equal(oldVersion.exit_code, 1);
});

test('baseline refuses all selection, policy weakening and settings overrides', async t => {
  const defaults = resolveConfig(undefined);
  assertBaselinePolicy(defaults, defaults, {});
  for (const options of [{ disable: [] }, { rule: ['PML002'] }, { severity: 'info' }, { failOn: 'error' }, { id: [] }, { type: 'Task' }, { status: 'open' }, { since: '2000-01-01' }]) assert.throws(() => assertBaselinePolicy(defaults, defaults, options), refusal('unsafe_policy'));
  const { client, pmRoot } = await tracker(t);
  const item = (await client.create({ type: 'Task', title: 'Record a specific outcome' })).item;
  await assert.rejects(lintItems(client, pmRoot, { baseline: empty, disable: ['PML002'] }), refusal('unsafe_policy'));
  const settingsPath = join(pmRoot, 'settings.json');
  const settings = JSON.parse(await readFile(settingsPath, 'utf8')) as Record<string, unknown>;
  for (const lint of [{ disable: ['PML002'] }, { rules: { PML002: { enabled: false } } }, { rules: { PML002: { scope: 'closed' } } }, { failOn: 'warn' }]) {
    await writeFile(settingsPath, JSON.stringify({ ...settings, lint }));
    await assert.rejects(lintItems(client, pmRoot, { baseline: empty }), refusal('unsafe_policy'));
  }
  await writeFile(settingsPath, JSON.stringify(settings));
  await client.update(item.id, { acceptanceCriteria: 'The scanner emits zero findings' });
  const clean = await lintItems(client, pmRoot, { baseline: empty });
  assert.equal(clean.exit_code, 0);
  assert.equal(clean.count, 0);
});

test('baseline files create atomically, retain debt, fail closed and serialize writers', async t => {
  const { client, pmRoot, root } = await tracker(t);
  await client.create({ type: 'Task', title: 'Retain a legacy debt' });
  const result = await lintItems(client, pmRoot);
  const row = result.findings[0];
  const request: Acknowledgment = { item_id: row.item_id, rule: row.rule, rule_version: row.rule_version, source_digest: row.source_digest, reason: evidence.reason };
  const path = join(root, 'baseline.json');
  await assert.rejects(readBaseline(path), refusal('baseline_io'));
  const baseline = await acknowledgeBaselineFile(path, result.findings, request);
  assert.deepEqual(await readBaseline(path), baseline);
  assert.deepEqual(await acknowledgeBaselineFile(path, result.findings, request), baseline);
  // Inject only a disk-write failure, retaining a real SDK tracker and actual lock files.
  const handle = await open(join(root, 'failure-probe'), 'w');
  const writeFailure = t.mock.method(Object.getPrototypeOf(handle), 'writeFile', async () => { throw new Error('disk write failed'); });
  await assert.rejects(acknowledgeBaselineFile(path, result.findings, request), refusal('baseline_io'));
  writeFailure.mock.restore();
  await handle.close();
  assert.deepEqual(await readBaseline(path), baseline, 'failed publication preserves the existing document');
  const attempts = await Promise.allSettled([acknowledgeBaselineFile(path, result.findings, request), acknowledgeBaselineFile(path, result.findings, request)]);
  assert.equal(attempts.filter(attempt => attempt.status === 'fulfilled').length, 1);
  const rejected = attempts.find(attempt => attempt.status === 'rejected');
  assert.ok(rejected?.status === 'rejected' && refusal('baseline_busy')(rejected.reason));
  await assert.rejects(acknowledgeBaselineFile(join(root, 'missing', 'baseline.json'), result.findings, request), refusal('baseline_io'));
  await writeFile(path, '{');
  await assert.rejects(readBaseline(path), refusal('invalid_baseline'));
  await assert.rejects(acknowledgeBaselineFile(path, result.findings, request), refusal('invalid_baseline'));
  await writeFile(path, 'null');
  await assert.rejects(readBaseline(path), refusal('invalid_baseline'));
  // A directory at the destination reaches atomic publication failure after a valid empty read.
  const destination = join(root, 'destination');
  await mkdir(destination);
  await assert.rejects(acknowledgeBaselineFile(destination, result.findings, request), refusal('baseline_io'));
});

test('host command returns typed refusals, observed evidence and compact debt counts', async t => {
  const previousExit = process.exitCode;
  t.after(() => { process.exitCode = previousExit; });
  const { client, root, pmRoot } = await tracker(t);
  await client.create({ type: 'Task', title: 'Preserve an explicit debt' });
  const ctx: CommandHandlerContext = { command: 'lint', args: [], options: {}, pm_root: pmRoot, repo_root: root, global: { author: 'lint-test' } };
  const initial = await runLintCommand(ctx);
  const row = initial.findings[0];
  assert.equal((await runAcknowledgeCommand(ctx)).exit_code, 2);
  ctx.options = { baseline: join(root, 'baseline.json'), id: row.item_id, rule: row.rule, reason: evidence.reason, ruleVersion: row.rule_version, sourceDigest: row.source_digest };
  assert.equal((await runAcknowledgeCommand(ctx)).ok, true);
  ctx.source_workspace_root = root;
  assert.equal((await runAcknowledgeCommand(ctx)).acknowledgment_count, 1);
  const activation = await activateExtensionForTest(extension, { name: 'pm-lint', capabilities: ['commands', 'schema'] });
  const acknowledged = await runRegisteredCommandForTest(activation.commands, { command: 'lint acknowledge', options: ctx.options, pmRoot });
  assert.equal((acknowledged.result as { ok: boolean }).ok, true);
  ctx.options = { baseline: join(root, 'baseline.json') };
  const receipt = await renderLintCommand(ctx);
  assert.equal(receipt.debt_count, 1);
  assert.equal(receipt.new_count, 0);
  assert.equal('exit_code' in receipt, false);
  ctx.options = { ...ctx.options, disable: ['PML002'] };
  const rejected = await renderLintCommand(ctx);
  assert.equal(rejected.exit_code, 2);
  assert.equal((rejected.refusal as { code: string }).code, 'unsafe_policy');
  assert.throws(() => baselineRefusalReceipt(new Error('unrelated')), /unrelated/);
  ctx.options = { failOn: ['warn', 'error'] };
  const malformed = await runAcknowledgeCommand({ ...ctx, options: { baseline: ['a', 'b'] } });
  assert.equal(malformed.exit_code, 2);
  assert.equal((malformed.refusal as { code: string }).code, 'invalid_acknowledgment');
});

test('new baseline SDK and command paths work in a non-git tracker with no git executable', async t => {
  const { client, root, pmRoot } = await tracker(t);
  await client.create({ type: 'Task', title: 'Validate standalone tracker context' });
  const script = `
    import { lintItems } from ${JSON.stringify(new URL('../src/engine.ts', import.meta.url).href)};
    import { runAcknowledgeCommand, renderLintCommand } from ${JSON.stringify(new URL('../src/commands.ts', import.meta.url).href)};
    import { PmClient } from ${JSON.stringify(new URL('../node_modules/@unbrained/pm-cli/dist/sdk/index.js', import.meta.url).href)};
    const [root, pmRoot] = process.argv.slice(1);
    const client = new PmClient({cwd: root, pmRoot, noExtensions: true});
    const initial = await lintItems(client, pmRoot, {baseline: {version: 1, acknowledgments: []}});
    const row = initial.findings[0];
    const ctx = {command: 'lint acknowledge', args: [], options: {baseline: root + '/baseline.json', id: row.item_id, rule: row.rule, reason: 'Legacy debt', ruleVersion: row.rule_version, sourceDigest: row.source_digest}, pm_root: pmRoot, source_workspace_root: root, global: {author: 'lint-test'}};
    const acknowledged = await runAcknowledgeCommand(ctx);
    if (!acknowledged.ok) throw new Error(JSON.stringify(acknowledged));
    ctx.options = {baseline: root + '/baseline.json'};
    console.log(JSON.stringify(await renderLintCommand(ctx)));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, root, pmRoot], { cwd: root, encoding: 'utf8', env: { ...process.env, PATH: resolve(root, 'no-executables'), GIT_CEILING_DIRECTORIES: dirname(root), PM_PATH: pmRoot } });
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout) as { debt_count: number; new_count: number };
  assert.equal(receipt.debt_count, 1);
  assert.equal(receipt.new_count, 0);
});
