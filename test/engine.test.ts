import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { getSettingsPath } from '@unbrained/pm-cli/sdk';
import { duplicateItemIds, EXCERPT_LIMIT, excerptText, inScope, lintCorpus, lintItems, sinceTimestamp, statusSelection } from '../src/engine.ts';
import { resolveConfig } from '../src/settings.ts';
import { tracker } from './helpers.ts';

/** Certify terminal inclusion and rule threshold behavior with genuine SDK mutations. */
test('engine reads all statuses and gates at or above the severity threshold', async t => {
  const { client, pmRoot } = await tracker(t);
  const task = (await client.create({ title: 'Implement stable context reader', type: 'Task', acceptanceCriteria: 'The reader returns every item' })).item;
  const feature = (await client.create({ title: 'TODO', type: 'Feature' })).item;
  await client.close(task.id, 'The complete reader returns 5 items in the integration test');
  const all = await lintItems(client, pmRoot, { rule: ['PML001', 'PML002', 'PML004'] });
  assert.equal(all.corpus_count, 2);
  assert.equal(all.complete_list.terminal_items_included, true);
  assert.equal(all.complete_list.item_count, 2);
  assert.deepEqual(all.findings.map(f => f.rule), ['PML001', 'PML002']);
  assert.equal(all.exit_code, 1);
  assert.equal((await lintItems(client, pmRoot, { rule: ['PML001'] })).exit_code, 0);
  assert.equal((await lintItems(client, pmRoot, { rule: ['PML001'], failOn: 'warn' })).exit_code, 1);
  assert.equal((await lintItems(client, pmRoot, { rule: ['PML001'], severity: 'info', failOn: 'warn' })).exit_code, 0);
  assert.equal((await lintItems(client, pmRoot, { rule: ['PML001'], severity: 'info', failOn: 'info' })).exit_code, 1);
  const serialized = JSON.stringify(all);
  assert.ok(serialized.includes(feature.title), 'findings carry the offending item title');
  const titleFinding = all.findings.find(f => f.rule === 'PML001');
  assert.equal(titleFinding?.excerpt, feature.title, 'PML001 excerpts the offending title');
  const criteriaFinding = all.findings.find(f => f.rule === 'PML002');
  assert.equal(criteriaFinding?.excerpt, '', 'absence findings carry an empty excerpt');
  assert.ok(all.findings.every(f => f.hint && !f.hint.includes('\n')));
  assert.deepEqual(all.summary.PML001, { info: 0, warn: 1, error: 0 });
  assert.deepEqual(all.summary.PML002, { info: 0, warn: 0, error: 1 });
  assert.deepEqual(all.summary.PML004, { info: 0, warn: 0, error: 0 });
});

/** A repeated title at closure does not demonstrate that the expected work happened. */
test('closed title-only evidence produces PML004 with a real SDK close operation', async t => {
  const { client, pmRoot } = await tracker(t);
  const item = (await client.create({ title: 'Reject malformed context input', type: 'Task' })).item;
  await client.close(item.id, item.title);
  const result = await lintItems(client, pmRoot, { rule: ['PML004'] });
  assert.deepEqual(result.findings.map(f => [f.item_id, f.rule]), [[item.id, 'PML004']]);
  assert.equal(result.exit_code, 1);
});

/** Selection must happen after certification so filtered children and duplicate peers remain available. */
test('filters select emitted findings while retaining complete hierarchy and duplicate context', async t => {
  const { client, pmRoot } = await tracker(t);
  const epic = (await client.create({ title: 'Deliver portable lint engine', type: 'Epic' })).item;
  await client.create({ title: 'Create portable rule registry', type: 'Task', parent: epic.id });
  const a = (await client.create({ title: 'Create robust item diagnostics', type: 'Task' })).item;
  const b = (await client.create({ title: 'Create robust item diagnostics', type: 'Task', allowDuplicate: true })).item;
  const hierarchy = await lintItems(client, pmRoot, { type: 'Epic', rule: ['PML007'] });
  assert.equal(hierarchy.scanned, 1);
  assert.equal(hierarchy.count, 0);
  const duplicates = await lintItems(client, pmRoot, { id: [b.id], rule: ['PML010'] });
  assert.equal(duplicates.scanned, 1);
  assert.deepEqual(duplicates.findings.map(f => f.item_id), [b.id]);
  const both = await lintItems(client, pmRoot, { id: [b.id, a.id], status: 'open', since: '2000-01-01', rule: ['PML010'] });
  assert.deepEqual(both.findings.map(f => f.item_id), [a.id, b.id].sort((x, y) => x.localeCompare(y)));
  const receipt = await client.duplicates({ status: ['open', 'in_progress', 'blocked'] });
  const corpus = await client.listAllComplete();
  assert.throws(() => duplicateItemIds({ ...receipt, cost: { ...receipt.cost, item_count: 0 } }, corpus.items), /does not match/);
  assert.throws(() => duplicateItemIds({ ...receipt, count: 1000 }, corpus.items), /cap reached/);
  assert.equal((await lintItems(client, pmRoot, { since: '2999-01-01', rule: [] })).scanned, 0);
  assert.equal((await lintItems(client, pmRoot, { status: 'closed', rule: [] })).scanned, 0);
  await assert.rejects(lintItems(client, pmRoot, { id: ['missing-item'], rule: [] }), /Unknown lint item/);
});

/** Prove malformed storage cannot produce a purportedly complete passing lint receipt. */
test('incomplete or unreadable item storage fails closed before any findings', async t => {
  const { client, pmRoot } = await tracker(t);
  const item = (await client.create({ title: 'Verify strict tracker parsing', type: 'Task' })).item;
  await writeFile(join(pmRoot, 'tasks', `${item.id}.toon`), 'not a valid item');
  await assert.rejects(lintItems(client, pmRoot));
});

/** Respect persisted thresholds and let explicit flags enable a configured-off rule. */
test('settings control actual engine findings and CLI flags override them', async t => {
  const { client, pmRoot } = await tracker(t);
  await client.create({ title: 'TODO', type: 'Task' });
  const path = getSettingsPath(pmRoot);
  const settings: Record<string, unknown> = JSON.parse(await readFile(path, 'utf8'));
  settings.lint = { disable: ['PML001', 'PML010'], rules: { PML002: { severity: 'info' }, PML010: { parameters: { threshold: 1 } } } };
  await writeFile(path, JSON.stringify(settings));
  const configured = await lintItems(client, pmRoot, {}, Date.now());
  assert.equal(configured.exit_code, 0);
  assert.deepEqual(configured.findings.map(f => f.rule), ['PML002']);
  assert.equal((await lintItems(client, pmRoot, { rule: ['PML001'], failOn: 'warn' })).exit_code, 1);
  assert.equal((await lintItems(client, pmRoot, { rule: ['PML010'] })).count, 0);
});

/** Reject invalid date spellings while preserving calendar and zoned timestamp selections. */
test('since validation is explicit and calendar dates do not roll into another month', () => {
  for (const value of ['yesterday', '2026-02-30', '2026-02-30T12:00:00Z', '2026-99-01', '2026-01-01T00:00:00', '2026-01-01T99:00:00Z']) assert.throws(() => sinceTimestamp(value));
  assert.equal(sinceTimestamp('2026-01-01'), Date.parse('2026-01-01T00:00:00Z'));
  assert.equal(sinceTimestamp('2026-01-01T00:00:00.123+01:00'), Date.parse('2026-01-01T00:00:00.123+01:00'));
});

/** Authoring rules stay silent on closed history unless settings or --status widen them. */
test('per-rule scopes skip closed items until settings or --status override the default', async t => {
  const { client, pmRoot } = await tracker(t);
  const weak = (await client.create({ title: 'TODO', type: 'Task' })).item;
  await client.close(weak.id, 'Closed with recorded evidence about the shipped work');
  const defaultRun = await lintItems(client, pmRoot, {});
  assert.equal(defaultRun.corpus_count, 1, 'the engine still certifies the closed corpus');
  assert.equal(defaultRun.count, 0, 'closed history does not flood the default report');
  const statusRun = await lintItems(client, pmRoot, { status: 'closed', rule: ['PML001', 'PML002'] });
  assert.equal(statusRun.scanned, 1);
  assert.deepEqual(statusRun.findings.map(f => f.rule), ['PML001', 'PML002'], '--status judges every rule on the named lifecycle');
  assert.equal(statusRun.findings[0].title, 'TODO');
  const path = getSettingsPath(pmRoot);
  const settings: Record<string, unknown> = JSON.parse(await readFile(path, 'utf8'));
  settings.lint = { rules: { PML001: { scope: 'all' } } };
  await writeFile(path, JSON.stringify(settings));
  const widened = await lintItems(client, pmRoot, {});
  assert.deepEqual(widened.findings.map(f => f.rule), ['PML001'], 'settings widen a rule beyond its default scope');
  assert.equal(widened.scanned, 1);
});

/** --status accepts comma-separated lifecycle selections across the whole corpus. */
test('status selections are comma-separated and reject empty spellings', async t => {
  const { client, pmRoot } = await tracker(t);
  const open = (await client.create({ title: 'Comma open selection work', type: 'Task' })).item;
  const canceled = (await client.create({ title: 'Comma canceled selection work', type: 'Task' })).item;
  await client.update(canceled.id, { status: 'canceled' });
  const both = await lintItems(client, pmRoot, { status: 'open,canceled', rule: ['PML002'] });
  assert.equal(both.scanned, 2);
  assert.deepEqual(both.findings.map(f => f.item_id), [open.id, canceled.id].sort((a, b) => a.localeCompare(b)), 'explicit status overrides the default authoring scope');
  await assert.rejects(lintItems(client, pmRoot, { status: ' , ' }), /--status requires/);
});

/** Excerpts are trimmed and bounded so one finding never dumps whole item bodies. */
test('excerpts trim offending text to the documented ceiling', async t => {
  const { client, pmRoot } = await tracker(t);
  const longTitle = `Ship ${'the '.repeat(80)}payload`;
  const longItem = (await client.create({ title: longTitle, type: 'Task', acceptanceCriteria: longTitle })).item;
  const result = await lintItems(client, pmRoot, { rule: ['PML003'] });
  assert.deepEqual(result.findings.map(f => f.item_id), [longItem.id]);
  assert.equal(result.findings[0].excerpt, excerptText(longTitle));
  assert.equal(result.findings[0].excerpt?.length, EXCERPT_LIMIT, 'the excerpt never exceeds 160 characters');
});

/** Scope, status and excerpt helpers are explicit pure contracts. */
test('scope, status selection and excerpt helpers cover their whole vocabulary', () => {
  assert.equal(inScope('all', 'draft'), true);
  assert.equal(inScope('non_terminal', 'open'), true);
  assert.equal(inScope('non_terminal', 'closed'), false);
  assert.equal(inScope('active', 'blocked'), true);
  assert.equal(inScope('active', 'canceled'), false);
  assert.equal(inScope('terminal', 'closed'), true);
  assert.equal(inScope('terminal', 'open'), false);
  assert.equal(inScope('closed', 'closed'), true);
  assert.equal(inScope('canceled', 'closed'), false);
  assert.equal(inScope('open', 'open'), true);
  assert.equal(inScope('open', 'blocked'), false);
  assert.equal(inScope('blocked', 'blocked'), true);
  assert.equal(inScope('blocked', 'open'), false);
  assert.equal(inScope('open', 'legacy_unregistered_status'), false);
  assert.equal(inScope('in_progress', 'legacy_unregistered_status'), false);
  assert.deepEqual(statusSelection('closed,canceled'), ['closed', 'canceled']);
  assert.deepEqual(statusSelection(' open '), ['open']);
  assert.throws(() => statusSelection(' , '));
  assert.equal(excerptText('  padded  '), 'padded');
  assert.equal(excerptText('x'.repeat(400)).length, EXCERPT_LIMIT);
});

test('snapshot callers retain default policy, clock and built-in registry arguments', async t => {
  const { client, pmRoot } = await tracker(t);
  await client.create({ title: 'Observe snapshot engine defaults', type: 'Task', acceptanceCriteria: 'The complete result matches ordinary lint', unset: ['parent', 'goal', 'objective', 'sprint', 'release'], clearDeps: true });
  assert.deepEqual(lintCorpus(await client.listAllComplete(), resolveConfig(undefined)), await lintItems(client, pmRoot));
});

/** Every text-bearing rule carries the exact offending context through the complete reader. */
test('engine excerpts stale activity, repeated context, bad blockers and duplicate titles', async t => {
  const { client, pmRoot } = await tracker(t);
  const stale = (await client.create({ title: 'Record recent work activity', type: 'Task', status: 'in_progress', acceptanceCriteria: 'works' })).item;
  const echo = (await client.create({ title: 'Repeat the recorded context', type: 'Feature', description: 'Repeat the recorded context' })).item;
  const blocked = (await client.create({ title: 'Resolve a missing blocker', type: 'Task', status: 'blocked', blockedReason: 'Waiting for a prerequisite', dep: ['id=pm-lint-ghost,kind=blocked_by'], allowUnresolvedDeps: true })).item;
  const first = (await client.create({ title: 'Detect repeated context titles', type: 'Task' })).item;
  await client.create({ title: first.title, type: 'Task', allowDuplicate: true });
  const result = await lintItems(client, pmRoot, {}, Date.now() + 30 * 86400000);
  const excerptFor = (id: string, code: string): string | undefined => result.findings.find(finding => finding.item_id === id && finding.rule === code)?.excerpt;
  assert.equal(excerptFor(stale.id, 'PML003'), 'works');
  assert.equal(excerptFor(stale.id, 'PML005'), stale.updated_at);
  assert.equal(excerptFor(echo.id, 'PML008'), echo.title);
  assert.ok(blocked.dependencies?.[0], 'the SDK stores the canonical unresolved reference');
  assert.equal(excerptFor(blocked.id, 'PML009'), blocked.dependencies[0].id);
  assert.equal(excerptFor(first.id, 'PML010'), first.title);
});
