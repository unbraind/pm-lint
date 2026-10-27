import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, open, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { activateExtensionForTest, assertRegisteredCommandContract, runRegisteredCommandForTest } from '@unbrained/pm-cli/sdk/testing';
import { appendHistoryEntry, createHistoryEntry, getHistoryPath, getItemPath, serializeItemDocument } from '@unbrained/pm-cli/sdk';
import type { ItemMetadata } from '@unbrained/pm-cli/sdk';
import extension, { filesystemLintSource, lintIncremental, lintIncrementalFile, parseIncrementalCheckpoint, parseIncrementalRequest, IncrementalRefusal, readIncrementalCheckpoint, sourceDigest } from '../index.ts';
import type { IncrementalCheckpoint, IncrementalFileBoundary } from '../index.ts';
import { assertIncrementalLimit, assertIncrementalPage, incrementalInteger, INCREMENTAL_LIMITS, validateIncrementalNumbers } from '../src/incremental-contract.ts';
import { decodeIncrementalCheckpoint } from '../src/incremental-file.ts';
import { lintItems } from '../src/engine.ts';
import { runIncrementalCommand } from '../src/incremental-command.ts';
import { tracker, installBuiltExtension, runGitFreeCli } from './helpers.ts';

/** Match typed refusals while proving every category includes a usable remedy. */
function refusal(code: string): (error: unknown) => boolean {
  return error => error instanceof IncrementalRefusal && error.code === code && error.remedy.length > 20;
}

/** Recompute the transport checksum after a deliberate schema-valid semantic mutation. */
function signed(checkpoint: IncrementalCheckpoint): IncrementalCheckpoint {
  const { digest: _digest, ...payload } = checkpoint;
  return { ...payload, digest: sourceDigest(payload) };
}

test('incremental output equals full lint while unchanged predicate pairs are reused', async t => {
  const { client, pmRoot } = await tracker(t);
  const item = (await client.create({ title: 'TODO', type: 'Feature', unset: ['parent', 'goal', 'objective', 'sprint', 'release'], clearDeps: true })).item;
  const peer = (await client.create({ title: 'Retain unrelated authoring debt', type: 'Task', acceptanceCriteria: 'works', unset: ['parent', 'goal', 'objective', 'sprint', 'release'], clearDeps: true })).item;
  const source = filesystemLintSource(pmRoot);
  await assert.rejects(lintIncremental(source), refusal('rebuild_required'));
  const now = Date.now();
  const first = await lintIncremental(source, { rebuild: true, now });
  assert.deepEqual(first.result, await lintItems(client, pmRoot, {}, now));
  assert.equal(first.incremental.reused, 0);
  const before = await client.get(item.id, { full: true });
  const updated = await client.update(item.id, { title: 'Deliver observable authoring context' });
  const next = await lintIncremental(source, { checkpoint: first.checkpoint, now });
  assert.deepEqual(next.result, await lintItems(client, pmRoot, {}, now));
  assert.equal(next.incremental.changed_items, 1);
  assert.deepEqual(next.incremental.by_rule.PML001, { evaluated: 1, reused: 1, global: false });
  assert.deepEqual(next.incremental.by_rule.PML002, { evaluated: 0, reused: 2, global: false });
  assert.deepEqual(next.incremental.by_rule.PML006, { evaluated: 0, reused: 2, global: false });
  assert.ok(next.result.findings.some(row => row.item_id === peer.id));
  assert.ok(next.result.findings.filter(row => row.item_id === item.id).every(row => row.title === updated.item.title && row.source_digest !== sourceDigest(before.item)));
  const unchanged = await lintIncremental(source, { checkpoint: next.checkpoint, now });
  assert.equal(unchanged.incremental.changed_items, 0);
  assert.equal(unchanged.incremental.by_rule.PML003.evaluated, 0);
  assert.deepEqual(unchanged.result, next.result);
  assert.deepEqual(parseIncrementalCheckpoint(JSON.parse(`\r\n${JSON.stringify(next.checkpoint, null, 2)}\r\n`)), next.checkpoint);
});

test('rule, policy, source, missing cursor and history loss demand explicit recovery', async t => {
  const { client, pmRoot } = await tracker(t);
  const item = (await client.create({ title: 'Verify saved event anchors', type: 'Task' })).item;
  const source = filesystemLintSource(pmRoot);
  const first = await lintIncremental(source, { rebuild: true });
  assert.ok(first.checkpoint.cursor);
  const drift = signed({ ...first.checkpoint, rule_version: 'older-rule-version' });
  await assert.rejects(lintIncremental(source, { checkpoint: drift }), refusal('rule_drift'));
  assert.equal((await lintIncremental(source, { checkpoint: drift, rebuild: true })).incremental.mode, 'rebuild');
  const foreign = signed({ ...first.checkpoint, source_id: 'f'.repeat(64) });
  await assert.rejects(lintIncremental(source, { checkpoint: foreign, rebuild: true }), refusal('foreign_state'));
  const policy = signed({ ...first.checkpoint, policy_digest: 'f'.repeat(64) });
  await assert.rejects(lintIncremental(source, { checkpoint: policy }), refusal('policy_drift'));
  const badCursor = signed({ ...first.checkpoint, cursor: { ...first.checkpoint.cursor!, value: 'invalid-cursor' } });
  await assert.rejects(lintIncremental(source, { checkpoint: badCursor }), refusal('cursor_lost'));
  const goneAnchor = signed({ ...first.checkpoint, cursor: { ...first.checkpoint.cursor!, version: 999999 } });
  await assert.rejects(lintIncremental(source, { checkpoint: goneAnchor }), refusal('cursor_lost'));
  const path = getItemPath(pmRoot, item.type, item.id);
  await writeFile(path, serializeItemDocument({ metadata: { ...item, title: 'Direct native import changed state' }, body: '' }));
  await assert.rejects(lintIncremental(source, { checkpoint: first.checkpoint }), refusal('cursor_lost'));
  const rebuilt = await lintIncremental(source, { checkpoint: first.checkpoint, rebuild: true });
  assert.deepEqual(rebuilt.result, await lintItems(client, pmRoot));
  await rm(join(pmRoot, 'history', `${item.id}.jsonl`));
  await assert.rejects(lintIncremental(source, { checkpoint: rebuilt.checkpoint }), refusal('cursor_lost'));
});

test('empty sources, first events, deletions and native history replays preserve complete results', async t => {
  const { client, pmRoot } = await tracker(t);
  const source = filesystemLintSource(pmRoot);
  const empty = await lintIncremental(source, { rebuild: true });
  assert.equal(empty.result.corpus_count, 0);
  const noHistory = signed({ ...empty.checkpoint, cursor: null });
  assert.equal((await lintIncremental(source, { checkpoint: noHistory })).result.count, 0);
  assert.equal((await lintIncremental(source, { checkpoint: empty.checkpoint })).result.count, 0);
  const item = (await client.create({ title: 'Trace every source transition', type: 'Task' })).item;
  const next = await lintIncremental(source, { checkpoint: empty.checkpoint });
  assert.equal(next.result.corpus_count, 1);
  await client.delete(item.id, { force: true });
  const deleted = await lintIncremental(source, { checkpoint: next.checkpoint });
  assert.equal(deleted.incremental.changed_items, 1);
  assert.deepEqual(deleted.result, await lintItems(client, pmRoot));
});

test('one strict schema rejects malformed and extreme inputs while allowing legacy item ids', async t => {
  const { client, pmRoot } = await tracker(t);
  await client.create({ title: 'Validate strict transport schemas', type: 'Task' });
  const checkpoint = (await lintIncremental(filesystemLintSource(pmRoot), { rebuild: true })).checkpoint;
  for (const input of [null, [], true, 0, new Date(), Object.create({ rebuild: true }), { rebuild: 1 }, { now: Infinity }, { now: -1 }, { now: NaN }, { now: INCREMENTAL_LIMITS.time + 1 }, { extra: true }]) assert.throws(() => parseIncrementalRequest(input), refusal('invalid_input'));
  for (const value of [NaN, Infinity, -Infinity, -1, 0.5, Number.MAX_VALUE, '1']) assert.throws(() => incrementalInteger(value, 10), refusal('invalid_input'));
  for (const value of [0, 10]) assert.equal(incrementalInteger(value, 10), value);
  assert.deepEqual(parseIncrementalRequest({ rebuild: false, now: 0 }), { rebuild: false, now: 0 });
  assert.deepEqual(parseIncrementalRequest({}), {});
  assert.deepEqual(parseIncrementalRequest(Object.assign(Object.create(null) as object, { now: 1 })), { now: 1 });
  const variants: unknown[] = [null, [], {}, { ...checkpoint, owner: 'foreign' }, { ...checkpoint, format: 2 }, { ...checkpoint, extra: 1 }, { ...checkpoint, items: new Array(1) }, { ...checkpoint, items: new Array(INCREMENTAL_LIMITS.items + 1) }, { ...checkpoint, cursor: {} }, { ...checkpoint, cursor: { ...checkpoint.cursor!, version: 0 } }, { ...checkpoint, cursor: { ...checkpoint.cursor!, ts: 'invalid' } }, { ...checkpoint, rule_version: '' }, { ...checkpoint, rule_version: 1 }, { ...checkpoint, rule_version: 'a'.repeat(129) }, { ...checkpoint, digest: 'x'.repeat(64) }, { ...checkpoint, digest: '0'.repeat(64) }, { ...checkpoint, items: [...checkpoint.items, checkpoint.items[0]] }];
  for (const patch of [{ inputs: new Array(10) }, { inputs: [] }, { inputs: ['a'] }, { excerpts: [] }, { excerpts: [false] }, { excerpts: ['a'.repeat(161)] }, { violations: Infinity }, { violations: 1024 }, { source_digest: '' }, { id: 2 }, { id: 'a'.repeat(4097) }]) variants.push({ ...checkpoint, items: [{ ...checkpoint.items[0], ...patch }] });
  for (const value of variants) assert.throws(() => parseIncrementalCheckpoint(value), error => error instanceof IncrementalRefusal);
  const disguisedSparse = new Array(1) as unknown[] & { foreign?: boolean };
  disguisedSparse.foreign = true;
  assert.throws(() => parseIncrementalCheckpoint({ ...checkpoint, items: disguisedSparse }), refusal('invalid_input'));
  const legacy = signed({ ...checkpoint, items: [{ ...checkpoint.items[0], id: 'Legacy.Item/42' }] });
  assert.equal(parseIncrementalCheckpoint(legacy).items[0].id, 'Legacy.Item/42');
  for (let i = 0; i < 500; i++) {
    const transported = JSON.parse(JSON.stringify({ ...checkpoint, items: checkpoint.items.map(item => ({ ...item, violations: i % 1024 })) })) as IncrementalCheckpoint;
    assert.deepEqual(parseIncrementalCheckpoint(signed(transported)), signed(transported));
  }
  assert.throws(() => assertIncrementalLimit(11, 10), refusal('limit_exceeded'));
  assertIncrementalLimit(10, 10);
  assert.throws(() => validateIncrementalNumbers({ nested: [0, Infinity] }), refusal('invalid_input'));
  validateIncrementalNumbers({ count: 0, entries: [1, true, null, 'literal'] });
  assert.throws(() => decodeIncrementalCheckpoint(Buffer.from('{}'), 4), refusal('state_io'));
  const page = await filesystemLintSource(pmRoot).events({ limit: 1000 });
  assertIncrementalPage(page, new Set());
  for (const variant of [{ ...page, next_cursor: undefined }, { ...page, count: 0 }, { ...page, count: 0, events: [], has_more: true }]) assert.throws(() => assertIncrementalPage(variant, new Set()), refusal('cursor_lost'));
  assert.throws(() => assertIncrementalPage(page, new Set([page.next_cursor!])), refusal('cursor_lost'));
  for (const extreme of [NaN, Infinity, -1, 1001]) assert.throws(() => assertIncrementalPage({ ...page, count: extreme }, new Set()), refusal('invalid_input'));
});

test('file adapter holds core ownership until release and preserves peer and foreign state', async t => {
  const { client, root, pmRoot } = await tracker(t);
  await client.create({ title: 'Serialize complete checkpoint publication', type: 'Task' });
  const source = filesystemLintSource(pmRoot);
  const path = join(root, 'lint.local.json');
  assert.equal(await readIncrementalCheckpoint(path), undefined);
  await assert.rejects(lintIncrementalFile(source, path), refusal('rebuild_required'));
  const first = await lintIncrementalFile(source, path, true);
  assert.deepEqual(await readIncrementalCheckpoint(path), first.checkpoint);
  const boundaries: IncrementalFileBoundary[] = ['locked', 'loaded', 'policy', 'anchor', 'events', 'corpus', 'evaluated', 'verified', 'publish', 'published', 'release'];
  for (const boundary of boundaries) {
    let injected = false;
    await lintIncrementalFile(source, path, false, async step => {
      if (step !== boundary) return;
      injected = true;
      await assert.rejects(lintIncrementalFile(source, path), refusal('state_busy'));
    });
    assert.ok(injected, boundary);
  }
  const peer = signed({ ...first.checkpoint, cursor: null });
  await assert.rejects(lintIncrementalFile(source, path, false, async step => { if (step === 'publish') await writeFile(path, JSON.stringify(peer)); }), refusal('source_changed'));
  assert.deepEqual(await readIncrementalCheckpoint(path), peer);
  await writeFile(path, JSON.stringify({ ...first.checkpoint, owner: 'another-package' }));
  const foreign = await readFile(path, 'utf8');
  await assert.rejects(lintIncrementalFile(source, path, true), refusal('foreign_state'));
  assert.equal(await readFile(path, 'utf8'), foreign);
  await assert.rejects(lintIncrementalFile(source, ''), refusal('invalid_input'));
  await assert.rejects(lintIncrementalFile(source, path, 'true' as unknown as boolean), refusal('invalid_input'));
  await assert.rejects(lintIncrementalFile(source, join(root, 'missing', 'file')), refusal('state_busy'));
  await writeFile(path, '{');
  await assert.rejects(readIncrementalCheckpoint(path), refusal('invalid_input'));
  await rm(path);
  await symlink('missing', path);
  await assert.rejects(readIncrementalCheckpoint(path), refusal('state_io'));
  await rm(path);
  await mkdir(path);
  await assert.rejects(readIncrementalCheckpoint(path), refusal('state_io'));
  await rm(path, { recursive: true });
  const oversized = await open(path, 'w');
  await oversized.truncate(INCREMENTAL_LIMITS.bytes + 1);
  await oversized.close();
  await assert.rejects(readIncrementalCheckpoint(path), refusal('state_io'));
  await rm(path);
  // Losing this invocation's actual core lease refuses the final fenced commit.
  await assert.rejects(lintIncrementalFile(source, path, true, async step => {
    if (step !== 'publish') return;
    for (const entry of await readdir(join(root, 'locks'))) await rm(join(root, 'locks', entry), { force: true });
  }), refusal('state_io'));
});

test('source changes at every prepublication boundary are re-read before any checkpoint advance', async t => {
  const { client, root, pmRoot } = await tracker(t);
  const item = (await client.create({ title: 'Recheck every target revision', type: 'Task' })).item;
  const source = filesystemLintSource(pmRoot);
  const path = join(root, 'state.local.json');
  await lintIncrementalFile(source, path, true);
  for (const boundary of ['locked', 'loaded', 'policy', 'anchor', 'events', 'corpus', 'evaluated', 'verified', 'publish'] as const) {
    const before = await readFile(path, 'utf8');
    let injected = false;
    const run = lintIncrementalFile(source, path, false, async step => {
      if (step !== boundary) return;
      injected = true;
      await client.update(item.id, { title: `Recheck current revision ${boundary}` });
    });
    if (['locked', 'loaded', 'policy', 'anchor'].includes(boundary)) {
      const result = await run;
      assert.deepEqual(result.result, await lintItems(client, pmRoot));
    } else {
      await assert.rejects(run, refusal(boundary === 'events' ? 'cursor_lost' : 'source_changed'));
      assert.equal(await readFile(path, 'utf8'), before);
    }
    assert.ok(injected);
    await lintIncrementalFile(source, path);
  }
});

test('registered command renders compact refusals and real TOON/JSON without git on PATH', async t => {
  const exitAtStart = process.exitCode;
  t.after(() => Object.assign(process, { exitCode: exitAtStart }));
  const { client, root, pmRoot } = await tracker(t);
  await client.create({ title: 'TODO', type: 'Task' });
  const activation = await activateExtensionForTest(extension, { name: 'pm-lint', capabilities: ['commands', 'schema'] });
  const command = assertRegisteredCommandContract(activation.registrations, { command: 'lint incremental', flags: ['--state', '--rebuild'] });
  assert.deepEqual(command.command.read_output?.row_keys, ['findings']);
  const path = join(root, 'state.local.json');
  const missing = await runRegisteredCommandForTest(activation.commands, { command: 'lint incremental', pmRoot });
  assert.equal((missing.result as { refusal: { code: string } }).refusal.code, 'invalid_input');
  const rebuild = await runRegisteredCommandForTest(activation.commands, { command: 'lint incremental', pmRoot, options: { state: path, rebuild: true } });
  assert.equal((rebuild.result as { count: number }).count, 2);
  await installBuiltExtension(pmRoot);
  const json = runGitFreeCli(root, pmRoot, ['lint', 'incremental', '--state', path, '--json']);
  assert.equal(json.status, 1, json.stderr);
  assert.equal((JSON.parse(json.stdout) as { incremental: { changed_items: number } }).incremental.changed_items, 0);
  const toon = runGitFreeCli(root, pmRoot, ['lint', 'incremental', '--state', path]);
  assert.equal(toon.status, 1, toon.stderr);
  assert.match(toon.stdout, /incremental:/);
  const context = { command: 'lint incremental', args: [], options: { state: path }, pm_root: pmRoot, global: {} };
  const clean = await tracker(t);
  const ok = await runIncrementalCommand({ ...context, pm_root: clean.pmRoot, options: { state: join(clean.root, 'state.local.json'), rebuild: true } });
  assert.equal(ok.ok, true);
  assert.equal('exit_code' in ok, false);
  await writeFile(getItemPath(pmRoot, 'Task', (await client.listAllComplete()).items[0].id), 'invalid native item');
  await assert.rejects(runIncrementalCommand({ ...context, options: { state: path } }));
});

test('SDK pagination and saved-anchor verification cross real thousand-event boundaries', { timeout: 180000 }, async t => {
  const { client, pmRoot } = await tracker(t);
  const created = await client.create({ title: 'Paginate actual native history', type: 'Task', unset: ['parent', 'goal', 'objective', 'sprint', 'release'], clearDeps: true });
  const document = { metadata: created.item, body: '' };
  const entry = createHistoryEntry({ nowIso: new Date().toISOString(), author: 'test-agent', op: 'update', before: document, after: document });
  for (let i = 0; i < 1001; i++) await appendHistoryEntry(getHistoryPath(pmRoot, created.item.id), entry);
  const source = filesystemLintSource(pmRoot);
  const first = await lintIncremental(source, { rebuild: true });
  assert.ok(first.incremental.event_pages >= 3);
  const update = await lintIncremental(source, { checkpoint: first.checkpoint });
  assert.ok(update.incremental.event_pages >= 4);
  assert.deepEqual(update.result, await lintItems(client, pmRoot));
});

test('10000-item title edit evaluates only affected pairs and declared globals', { timeout: 180000 }, async t => {
  const { client, pmRoot } = await tracker(t);
  const base = (await client.create({ title: 'Seed isolated scale corpus', type: 'Task', acceptanceCriteria: 'The command returns an observable result', unset: ['parent', 'goal', 'objective', 'sprint', 'release'], clearDeps: true })).item;
  // Native SDK serialization seeds real on-disk rows; actual edits and every read use the SDK.
  const total = 10000;
  for (let i = 1; i < total; i++) {
    const metadata: ItemMetadata = { ...base, id: `lint-test-scale-${i}`, title: `Unique ${sourceDigest(i).slice(0, 24)} context` };
    await writeFile(getItemPath(pmRoot, base.type, metadata.id), serializeItemDocument({ metadata, body: '' }));
  }
  const source = filesystemLintSource(pmRoot);
  const now = Date.now();
  const started = performance.now();
  const first = await lintIncremental(source, { rebuild: true, now });
  const built = performance.now();
  await client.update(base.id, { title: 'Verify the edited scale target' });
  const next = await lintIncremental(source, { checkpoint: first.checkpoint, now });
  const updated = performance.now();
  assert.deepEqual(next.result, await lintItems(client, pmRoot, {}, now));
  assert.equal(next.result.corpus_count, total);
  assert.equal(next.incremental.changed_items, 1);
  assert.deepEqual(next.incremental.by_rule.PML001, { evaluated: 1, reused: total - 1, global: false });
  assert.equal(next.incremental.by_rule.PML002.evaluated, 0);
  assert.equal(next.incremental.by_rule.PML006.evaluated, 0);
  assert.equal(next.incremental.by_rule.PML003.evaluated, 1);
  assert.equal(next.incremental.by_rule.PML008.evaluated, 1);
  assert.equal(next.incremental.evaluated, 30003);
  assert.equal(next.incremental.reused, 49997);
  t.diagnostic(JSON.stringify({ items: total, rebuild_ms: Math.round(built - started), update_ms: Math.round(updated - built), evaluated: next.incremental.evaluated, reused: next.incremental.reused, state_bytes: Buffer.byteLength(JSON.stringify(next.checkpoint)) }));
});
