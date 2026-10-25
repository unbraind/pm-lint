import assert from 'node:assert/strict';
import test from 'node:test';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getItemPath, serializeItemDocument } from '@unbrained/pm-cli/sdk';
import type { ItemDocument, ItemMetadata } from '@unbrained/pm-cli/sdk';
import { previewAuthoringRepairs, RepairRefusal } from '../index.ts';
import type { RepairRequest } from '../index.ts';
import { tracker } from './helpers.ts';

/** Deterministic PRNG; the fixed seed and sequence index reproduce every failure. */
function random(seed: number): () => number {
  let state = seed;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
}

/** Read the complete native state through the SDK, without a handwritten normalization model. */
async function nativeState(client: Awaited<ReturnType<typeof tracker>>['client'], id: string): Promise<unknown> {
  return structuredClone((await client.get(id, { full: true })).item);
}

test('500 seeded random sequences preserve SDK-read state across document/output round trips and older request replays', async t => {
  const { client, pmRoot } = await tracker(t);
  const peer = (await client.create({ title: 'Preserve related peer context', type: 'Epic' })).item;
  const item = (await client.create({ title: 'Preserve every native authoring field', type: 'Issue', description: 'Context', acceptanceCriteria: 'The test exits zero', expectedResult: 'A visible result', actualResult: 'An observed failure', parent: peer.id, risk: 'low', confidence: 'high', environment: 'synthetic', component: 'parser', regression: "true", reproSteps: 'Run the synthetic command', affectedVersion: '1', fixedVersion: '2', customerImpact: 'Local test', severity: 'low', reporter: 'test-agent', definitionOfReady: 'Fixture exists', goal: 'synthetic-goal', objective: 'synthetic-objective', value: 'Clear repair context', impact: 'Preserved state', outcome: 'Reviewable repairs', whyNow: 'Regression coverage', estimatedMinutes: '20', order: '3', sprint: 'synthetic', release: 'synthetic' })).item;
  const oracle = await tracker(t);
  await cp(pmRoot, oracle.pmRoot, { recursive: true });
  const rng = random(0x51a7e202);
  const requests: RepairRequest[] = [];
  const documents: ItemDocument[] = [];
  const keyByRevision = new Map<string, string>();
  let latest: ItemMetadata = { ...item, dependencies: [{ id: peer.id, kind: 'related', author: 'test-agent', created_at: item.created_at }], comments: [{ author: 'test-agent', created_at: item.created_at, text: 'Preserve comments' }], notes: [{ author: 'test-agent', created_at: item.created_at, text: 'Preserve notes' }], learnings: [{ author: 'test-agent', created_at: item.created_at, text: 'Preserve learnings' }], files: [{ path: 'src/example.ts', scope: 'project' }], docs: [{ path: 'README.md', scope: 'project' }], tests: [{ command: 'node --test', note: 'Never execute from preview', scope: 'project' }] };
  for (let sequence = 0; sequence < 500; sequence += 1) {
    // Each sequence has 4-6 operations: native document import, read, preview/export,
    // optional saved-request replay and an independent SDK mutation + second preview.
    const replay = documents.length > 0 && rng() < 0.25;
    const document: ItemDocument = replay ? structuredClone(documents[Math.floor(rng() * documents.length)]) : {
      metadata: { ...latest, title: rng() < 0.5 ? ` \tVerify behavior ${sequence}\r\n` : `Verify behavior ${sequence}`, tags: ['beta', 'alpha'], acceptance_criteria: rng() < 0.5 ? '' : `The command returns ${sequence}`, expected_result: rng() < 0.5 ? undefined : `Expected result ${sequence}`, updated_at: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)).toISOString(), parent: rng() < 0.5 ? peer.id : undefined, dependencies: [{ id: peer.id, kind: rng() < 0.5 ? 'related' : 'blocked_by', author: 'test-agent', created_at: item.created_at }] },
      body: `Native body ${sequence}  \r\n\r\nPreserve paragraphs\r\n`,
    };
    documents.push(structuredClone(document));
    const format = rng() < 0.5 ? 'toon' : 'json_markdown';
    const other = getItemPath(pmRoot, item.type, item.id, format === 'toon' ? 'json_markdown' : 'toon');
    await rm(other, { force: true });
    const path = getItemPath(pmRoot, item.type, item.id, format);
    let text = serializeItemDocument(document, { format });
    // Preserve genuine duplicate-tag debt in both storage formats, before SDK reads normalize it.
    if (format === 'toon') text = text.replace(/^tags\[.*$/m, 'tags[3]: beta,alpha,beta');
    else text = text.replace('"tags": [\n    "alpha",\n    "beta"\n  ]', '"tags": ["beta", "alpha", "beta"]');
    if (rng() < 0.5) text = text.replaceAll('\n', '\r\n');
    await writeFile(path, text);
    await rm(getItemPath(oracle.pmRoot, item.type, item.id, format === 'toon' ? 'json_markdown' : 'toon'), { force: true });
    await writeFile(getItemPath(oracle.pmRoot, item.type, item.id, format), text);
    const model = await nativeState(oracle.client, item.id); // Reference model: previews are identity transitions.
    const before = await readFile(path);
    const receipt = await previewAuthoringRepairs(pmRoot, { id: item.id });
    const transport = JSON.parse(` \r\n${JSON.stringify(receipt, null, rng() < 0.5 ? 2 : 0)}\r\n`) as typeof receipt;
    assert.deepEqual(transport, receipt, `transport sequence=${sequence}`);
    assert.deepEqual(await readFile(path), before);

    assert.equal(receipt.remaining_mechanical, 0);
    const priorKey = keyByRevision.get(receipt.revision);
    if (priorKey !== undefined) assert.equal(receipt.plan_key, priorKey);
    keyByRevision.set(receipt.revision, receipt.plan_key);
    if (requests.length > 0) {
      const older = requests[Math.floor(rng() * requests.length)];
      if (older.revision !== receipt.revision) await assert.rejects(previewAuthoringRepairs(pmRoot, older), error => error instanceof RepairRefusal && error.code === 'stale_revision');
      else assert.deepEqual(await previewAuthoringRepairs(pmRoot, older), receipt);
    }
    requests.push({ id: item.id, revision: receipt.revision });
    assert.deepEqual(await nativeState(client, item.id), model, `state sequence=${sequence}`);
    // SDK is the normalization oracle: independently author only the offered fields,
    // then read back and re-preview. Never compute expected normalized state by hand.
    await client.update(item.id, { ...(receipt.patch.title === undefined ? {} : { title: receipt.patch.title }), ...(receipt.patch.tags === undefined ? {} : { tags: JSON.stringify(receipt.patch.tags) }), description: `Native revision ${sequence}` });
    const appliedModel = await nativeState(client, item.id);
    const clean = await previewAuthoringRepairs(pmRoot, { id: item.id });
    assert.deepEqual(clean.patch, {});
    assert.equal(clean.validation, null);
    assert.notEqual(clean.plan_key, receipt.plan_key);
    assert.deepEqual(await nativeState(client, item.id), appliedModel);
    latest = (await client.listAllComplete()).items.find(row => row.id === item.id)!;
    if ((sequence + 1) % 100 === 0) t.diagnostic(`seed=0x51a7e202 sequences=${sequence + 1} native SDK state preserved`);
  }
  await mkdir(join(pmRoot, 'runtime'), { recursive: true });
  await writeFile(join(pmRoot, 'runtime', 'foreign-plan.json'), 'foreign partial record');
  assert.deepEqual((await previewAuthoringRepairs(pmRoot, { id: item.id })).patch, {});
  assert.equal(await readFile(join(pmRoot, 'runtime', 'foreign-plan.json'), 'utf8'), 'foreign partial record');
});
