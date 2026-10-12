import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { getSettingsPath } from '@unbrained/pm-cli/sdk';
import { duplicateItemIds, lintItems, sinceTimestamp } from '../src/engine.ts';
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
  assert.ok(!serialized.includes(feature.title));
  assert.ok(all.findings.every(f => f.hint && !f.hint.includes('\n')));
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
