import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFile, rm, cp } from 'node:fs/promises';
import { getItemPath, serializeItemDocument } from '@unbrained/pm-cli/sdk';
import type { ItemDocument } from '@unbrained/pm-cli/sdk';
import { encode, decode } from '@toon-format/toon';
import { analyzeRulePack, lintRulePack, parseRulePack, RulePackRefusal } from '../index.ts';
import type { AuthoringRule, RulePack } from '../index.ts';
import { tracker } from './helpers.ts';
import { constraint, policy } from './conflict-fixtures.ts';

/** Reproduce every operation and transport choice from one unsigned seed. */
function random(seed: number): () => number {
  let state = seed;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

/** Generate only the finite domain whose oracle is exhaustive, including conditional scopes. */
function generated(rng: () => number): RulePack {
  const rules: AuthoringRule[] = [];
  for (let i = 0; i < 1 + Math.floor(rng() * 10); i++) {
    const field = (['priority', 'tags', 'title', 'description'] as const)[Math.floor(rng() * 4)];
    const predicate = field === 'priority' ? { op: rng() < 0.5 ? 'min_value' as const : 'max_value' as const, value: Math.floor(rng() * 5) } : field === 'tags' ? { op: rng() < 0.5 ? 'required_tag' as const : 'forbidden_tag' as const, value: ['a', 'b', 'c'][Math.floor(rng() * 3)] } : rng() < 0.2 ? { op: 'present' as const } : { op: rng() < 0.5 ? 'min_length' as const : 'max_length' as const, value: Math.floor(rng() * 9) };
    rules.push(constraint(`r${i}`, field, predicate, {
      ...(rng() < 0.5 ? { statuses: [['custom-ready'], ['custom-working'], ['custom-ready', 'custom-done']][Math.floor(rng() * 3)] } : {}),
      ...(rng() < 0.5 ? { types: [['Task'], ['Issue'], ['Task', 'Feature']][Math.floor(rng() * 3)] } : {}),
    }));
  }
  return policy(...rules);
}

/** Independently evaluate the exhaustive finite fixture domain without interval or parser logic. */
function accepts(rule: AuthoringRule, value: number | string[]): boolean {
  const predicate = rule.predicate;
  if (predicate.op === 'required_tag') return (value as string[]).includes(predicate.value);
  if (predicate.op === 'forbidden_tag') return !(value as string[]).includes(predicate.value);
  if (predicate.op === 'present') return (value as number) > 0;
  if (predicate.op === 'min_value' || predicate.op === 'min_length') return (value as number) >= predicate.value;
  if (predicate.op === 'max_value' || predicate.op === 'max_length') return (value as number) <= predicate.value;
  throw new Error('Outside the exhaustive oracle domain');
}

/** Enumerate values in every selector cell; a contradiction in any applicable cell blocks policy admission. */
function impossible(rules: AuthoringRule[]): boolean {
  for (const status of ['custom-ready', 'custom-working', 'custom-done']) for (const type of ['Task', 'Issue', 'Feature']) {
    const active = rules.filter(rule => (rule.when?.statuses === undefined || rule.when.statuses.includes(status)) && (rule.when?.types === undefined || rule.when.types.includes(type)));
    for (const field of ['priority', 'tags', 'title', 'description'] as const) {
      const selected = active.filter(rule => rule.field === field);
      const values: (number | string[])[] = field === 'tags' ? Array.from({ length: 8 }, (_, bits) => ['a', 'b', 'c'].filter((_, i) => (bits & (1 << i)) !== 0)) : Array.from({ length: field === 'priority' ? 5 : field === 'title' ? 8 : 9 }, (_, i) => field === 'title' ? i + 1 : i);
      if (!values.some(value => selected.every(rule => accepts(rule, value)))) return true;
    }
  }
  return false;
}

/** A separate exhaustive subset search checks global cardinality and deterministic ties. */
function expectedWitness(pack: RulePack): string[] | null {
  const rules = [...pack.rules].sort((a, b) => a.id < b.id ? -1 : 1);
  for (const rule of rules) if (impossible([rule])) return [rule.id];
  for (let i = 0; i < rules.length; i++) for (let j = i + 1; j < rules.length; j++) if (impossible([rules[i], rules[j]])) return [rules[i].id, rules[j].id];
  assert.equal(impossible(rules), false, 'the finite interval/tag grammar has no larger irreducible core');
  return null;
}

test('500 seeded operation sequences agree with an exhaustive oracle and preserve SDK-read native state through old pack replays', { timeout: 600000 }, async t => {
  const actual = await tracker(t);
  const reference = await tracker(t);
  const peer = (await actual.client.create({ type: 'Epic', title: 'Explicit source relationship', unset: ['parent', 'goal', 'objective', 'sprint', 'release'], clearDeps: true })).item;
  const item = (await actual.client.create({ type: 'Task', title: 'Preserve every policy field', parent: peer.id, goal: 'goal', objective: 'objective', sprint: 'sprint', release: 'release', clearDeps: true })).item;
  await cp(actual.pmRoot, reference.pmRoot, { recursive: true });
  const rng = random(0xc0f11c7);
  const saved: { pack: RulePack; document: ItemDocument }[] = [];
  for (let sequence = 0; sequence < 500; sequence++) {
    const record = saved.length > 0 && rng() < 0.3 ? structuredClone(saved[Math.floor(rng() * saved.length)]) : {
      pack: generated(rng),
      document: { metadata: { ...item, title: ` \tContext ${sequence}\r\n`, description: `Description ${sequence}\r\n`, acceptance_criteria: `Observed ${sequence}  \r\n`, definition_of_ready: `Ready ${sequence}`, resolution: `Resolution ${sequence}`, blocked_reason: `Reason ${sequence}`, outcome: `Outcome ${sequence}`, value: `Value ${sequence}`, why_now: `Now ${sequence}`, priority: Math.floor(rng() * 5) as typeof item.priority, tags: ['a', 'b', 'c'].filter(() => rng() < 0.5), status: ['open', 'in_progress', 'closed', 'blocked'][Math.floor(rng() * 4)] as typeof item.status, parent: rng() < 0.5 ? peer.id : undefined, dependencies: [{ id: peer.id, kind: 'related' as const, author: 'model-test', created_at: item.created_at }] }, body: `Retain source body ${sequence}\r\n` },
    };
    saved.push(structuredClone(record));
    const format = rng() < 0.5 ? 'toon' : 'json_markdown';
    let bytes = serializeItemDocument(record.document, { format });
    if (rng() < 0.5) bytes = bytes.replaceAll('\n', '\r\n');
    for (const root of [actual.pmRoot, reference.pmRoot]) {
      await rm(getItemPath(root, item.type, item.id, format === 'toon' ? 'json_markdown' : 'toon'), { force: true });
      await writeFile(getItemPath(root, item.type, item.id, format), bytes);
    }
    const expected = structuredClone((await reference.client.get(item.id, { full: true })).item);
    // Reference state machine: import/export/analyze/evaluate/replay are identity transitions on native state.
    const imported = parseRulePack(rng() < 0.5 ? JSON.parse(` \r\n${JSON.stringify(record.pack, null, 2)}\r\n`) : decode(encode(record.pack)));
    const result = analyzeRulePack(imported);
    assert.ok(Number.isFinite(result.version) && result.version === 1);
    assert.ok(Number.isInteger(result.rule_count) && result.rule_count >= 1 && result.rule_count <= 64);
    assert.deepEqual(parseRulePack(imported), parseRulePack(JSON.parse(JSON.stringify(imported))));
    assert.deepEqual(result.witness?.rule_ids ?? null, expectedWitness(record.pack), `seed=0xc0f11c7 sequence=${sequence}`);
    assert.deepEqual(analyzeRulePack(policy(...[...imported.rules].reverse())), result);
    assert.deepEqual(analyzeRulePack(decode(encode(imported))), result);
    if (result.status === 'compatible') await lintRulePack(actual.client, imported);
    else await assert.rejects(lintRulePack(actual.client, imported), error => error instanceof RulePackRefusal && error.code === 'conflicting_pack' && JSON.stringify(error.witness) === JSON.stringify(result.witness!.rule_ids));
    assert.deepEqual((await actual.client.get(item.id, { full: true })).item, expected, `SDK state sequence=${sequence}`);
    // Ambient focus varies independently; the policy path performs no creates or updates.
    if (sequence % 50 === 0) await actual.client.focus(rng() < 0.5 ? peer.id : item.id);
    if ((sequence + 1) % 100 === 0) t.diagnostic(`seed=0xc0f11c7 sequences=${sequence + 1}: exhaustive witnesses and native SDK state agree`);
  }
});
