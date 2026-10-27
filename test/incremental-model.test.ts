import assert from 'node:assert/strict';
import test from 'node:test';
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import { getItemPath, serializeItemDocument, resolveRuntimeStatusRegistry } from '@unbrained/pm-cli/sdk';
import type { ItemDocument, ItemMetadata } from '@unbrained/pm-cli/sdk';
import { decode, encode } from '@toon-format/toon';
import { filesystemLintSource, lintIncremental, parseIncrementalCheckpoint, IncrementalRefusal } from '../index.ts';
import type { IncrementalCheckpoint } from '../index.ts';
import { inScope, lintItems } from '../src/engine.ts';
import { DEFAULT_STATUSES } from '../src/statuses.ts';
import { RULES } from '../src/rules.ts';
import { tracker } from './helpers.ts';

/** Seeded generator: the sequence number and seed reproduce every transport and replay choice. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

test('500 model sequences preserve SDK state through checkpoint imports, exports, old replays and native variants', { timeout: 600000 }, async t => {
  const { client, pmRoot } = await tracker(t);
  const peer = (await client.create({ title: 'Retain explicit relationship target', type: 'Epic', unset: ['parent', 'goal', 'objective', 'sprint', 'release'], clearDeps: true })).item;
  const item = (await client.create({ title: 'Retain all native source fields', type: 'Issue', parent: peer.id, goal: 'goal', objective: 'objective', sprint: 'sprint', release: 'release', clearDeps: true, acceptanceCriteria: 'The SDK returns complete native state', expectedResult: 'A stable result', actualResult: 'A visible result', resolution: 'Verified result', risk: 'low', confidence: 'high', environment: 'synthetic', component: 'parser', regression: 'true', reproSteps: 'Run a native check', affectedVersion: '1', fixedVersion: '2', customerImpact: 'Synthetic evidence', severity: 'low', reporter: 'test-agent', definitionOfReady: 'Fixture exists', value: 'Preserved context', impact: 'Complete state', outcome: 'Reproducible evidence', whyNow: 'Regression coverage', estimatedMinutes: '20', order: '3' })).item;
  const oracle = await tracker(t);
  await cp(pmRoot, oracle.pmRoot, { recursive: true });
  const source = filesystemLintSource(pmRoot);
  const rng = random(0x1ace2026);
  const documents: ItemDocument[] = [];
  const checkpoints: IncrementalCheckpoint[] = [];
  const now = Date.parse('2027-01-01T00:00:00Z');
  let checkpoint = (await lintIncremental(source, { rebuild: true, now })).checkpoint;
  for (let sequence = 0; sequence < 500; sequence++) {
    const at = new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)).toISOString();
    const metadata: ItemMetadata = { ...item, status: ['open', 'in_progress', 'blocked', 'closed', 'canceled'][Math.floor(rng() * 5)] as ItemMetadata['status'], title: rng() < 0.4 ? ` \tTODO ${sequence}\r\n` : `Verify native field ${sequence}`, description: rng() < 0.5 ? `Verify native field ${sequence}` : `Source context ${sequence}`, acceptance_criteria: rng() < 0.5 ? 'works' : `The command returns ${sequence}`, resolution: rng() < 0.5 ? undefined : `Recorded result ${sequence}`, actual_result: rng() < 0.5 ? undefined : `Observed result ${sequence}`, close_reason: rng() < 0.5 ? undefined : 'A recorded close reason', closed_at: at, updated_at: at, assignee: rng() < 0.5 ? 'synthetic-agent' : undefined, claim_principal: rng() < 0.5 ? 'synthetic-agent' : undefined, parent: rng() < 0.5 ? peer.id : undefined, blocked_reason: rng() < 0.5 ? 'Waiting for a recorded prerequisite' : undefined, blocked_by: rng() < 0.5 ? peer.id : 'pm-missing-blocker', dependencies: [{ id: peer.id, kind: rng() < 0.5 ? 'blocked_by' : 'related', author: 'test-agent', created_at: at }], comments: [{ text: rng() < 0.5 ? 'Closed: verified outcome' : 'Current work context', author: 'test-agent', created_at: at }], notes: [{ text: rng() < 0.5 ? `Verify native field ${sequence}` : 'Additional context', author: 'test-agent', created_at: at }], test_runs: rng() < 0.5 ? [] : [{ run_id: `synthetic-${sequence}`, kind: 'test', status: 'passed', started_at: at, finished_at: at, recorded_at: new Date(Date.parse(at) + 86400000).toISOString(), passed: 1, failed: 0, skipped: 0 }], files: rng() < 0.5 ? [] : [{ path: 'src/example.ts', scope: 'project' }], tests: rng() < 0.5 ? [] : [{ command: 'node --test', scope: 'project' }], docs: [{ path: 'README.md', scope: 'project' }], learnings: [{ text: `Preserve native learning ${sequence}`, author: 'test-agent', created_at: at }], tags: ['source', `sequence-${sequence}`] };
    const document = documents.length > 0 && rng() < 0.25 ? structuredClone(documents[Math.floor(rng() * documents.length)]) : { metadata, body: `Preserve body ${sequence}  \r\n\r\nAnd relationships\r\n` };
    documents.push(structuredClone(document));
    const format = rng() < 0.5 ? 'toon' : 'json_markdown';
    let text = serializeItemDocument(document, { format });
    if (rng() < 0.5) text = text.replaceAll('\n', '\r\n');
    for (const target of [pmRoot, oracle.pmRoot]) {
      await rm(getItemPath(target, item.type, item.id, format === 'toon' ? 'json_markdown' : 'toon'), { force: true });
      await writeFile(getItemPath(target, item.type, item.id, format), text);
    }
    // Reference model: each observational operation is an identity transition on native SDK state.
    // The independent tracker supplies normalization; no expected strings or relationships are normalized here.
    const expected = structuredClone((await oracle.client.get(item.id, { full: true })).item);
    const bytes = await readFile(getItemPath(pmRoot, item.type, item.id, format));
    let replay = checkpoints.length > 0 && rng() < 0.5 ? checkpoints[Math.floor(rng() * checkpoints.length)] : checkpoint;
    replay = parseIncrementalCheckpoint(rng() < 0.5 ? JSON.parse(` \r\n${JSON.stringify(replay, null, 2)}\r\n`) : decode(encode(replay)));
    let scan;
    try { scan = await lintIncremental(source, { checkpoint: replay, now }); } catch (error) {
      assert.ok(error instanceof IncrementalRefusal && error.code === 'cursor_lost', `seed=0x1ace2026 sequence=${sequence}`);
      scan = await lintIncremental(source, { checkpoint: replay, rebuild: true, now });
    }
    assert.deepEqual(scan.result, await lintItems(client, pmRoot, {}, now), `complete result sequence=${sequence}`);
    assert.deepEqual((await client.get(item.id, { full: true })).item, expected, `native SDK state sequence=${sequence}`);
    assert.deepEqual(await readFile(getItemPath(pmRoot, item.type, item.id, format)), bytes);
    checkpoint = parseIncrementalCheckpoint(decode(encode(scan.checkpoint)));
    const retry = await lintIncremental(source, { checkpoint, now });
    assert.deepEqual(retry.result, scan.result, `idempotent retry sequence=${sequence}`);
    assert.deepEqual((await client.get(item.id, { full: true })).item, expected);
    checkpoints.push(checkpoint);
    if ((sequence + 1) % 100 === 0) t.diagnostic(`seed=0x1ace2026 sequences=${sequence + 1} SDK native state and fresh scan agree`);
  }
});

test('500 random custom registries preserve lifecycle decisions under status renaming', async t => {
  const { client } = await tracker(t);
  const item = (await client.create({ title: 'Test custom active statuses', type: 'Task', unset: ['parent', 'goal', 'objective', 'sprint', 'release'], clearDeps: true })).item;
  const rng = random(0x57a7e);
  const stale = RULES.find(rule => rule.code === 'PML005')!;
  for (let sequence = 0; sequence < 500; sequence++) {
    const names = ['ready', 'working', 'waiting', 'completed', 'discarded'].map(name => `${name}_${Math.floor(rng() * 1000000)}`);
    const roles = [['active', 'default_open'], ['active'], ['blocked'], ['terminal', 'terminal_done'], ['terminal', 'terminal_canceled']] as const;
    const registry = resolveRuntimeStatusRegistry({ version: 1, files: {}, fields: [], statuses: names.map((id, i) => ({ id, roles: [...roles[i]] })), workflow: { open_status: names[0], in_progress_status: names[1], blocked_status: names[2], close_status: names[3], canceled_status: names[4] }, unknown_field_policy: 'allow' });
    for (let i = 0; i < names.length; i++) {
      const builtin = ['open', 'in_progress', 'blocked', 'closed', 'canceled'][i];
      for (const scope of ['all', 'active', 'non_terminal', 'terminal', 'open', 'in_progress', 'blocked', 'closed', 'canceled'] as const) assert.equal(inScope(scope, names[i], registry), inScope(scope, builtin, DEFAULT_STATUSES), `sequence=${sequence} scope=${scope} role=${builtin} definition=${JSON.stringify(registry.by_id.get(names[i]))}`);
      const context = { items: [], now: Date.parse(item.updated_at) + 15 * 86400000, parameters: {}, duplicateIds: new Set<string>(), statuses: registry };
      assert.equal(stale.check({ ...item, status: names[i] as ItemMetadata['status'] }, context), i === 1);
    }
  }
});
