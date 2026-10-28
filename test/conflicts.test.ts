import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { activateExtensionForTest, assertRegisteredCommandContract } from '@unbrained/pm-cli/sdk/testing';
import type { CommandHandlerContext } from '@unbrained/pm-cli/sdk/authoring';
import extension, { analyzeRulePack, lintRulePack, parseRulePack, RulePackRefusal } from '../index.ts';
import type { RulePackAnalysis } from '../index.ts';
import { runRulePackCommand } from '../src/rule-pack-command.ts';
import { installBuiltExtension, runGitFreeCli, tracker } from './helpers.ts';
import { inventory } from './repair-inventory.ts';
import { constraint, policy } from './conflict-fixtures.ts';

test('minimum witnesses include tag pairs, exact ranges and singleton native-title conflicts', () => {
  const required = constraint('a', 'tags', { op: 'required_tag', value: ' Reviewed ' });
  const forbidden = constraint('b', 'tags', { op: 'forbidden_tag', value: 'reviewed' });
  const numeric = [constraint('c', 'priority', { op: 'min_value', value: 3 }), constraint('d', 'priority', { op: 'max_value', value: 2 })];
  const pack = policy(required, forbidden, ...numeric);
  assert.deepEqual(analyzeRulePack(pack).witness, { rule_ids: ['a', 'b'], field: 'tags', when: {} });
  assert.deepEqual(analyzeRulePack(policy(...numeric)).witness?.rule_ids, ['c', 'd']);
  assert.deepEqual(analyzeRulePack(policy(...numeric, constraint('z', 'title', { op: 'max_length', value: 0 }))).witness?.rule_ids, ['z']);
  assert.equal(analyzeRulePack(policy(constraint('a', 'description', { op: 'max_length', value: 0 }))).status, 'compatible');
  const text = policy(constraint('a', 'description', { op: 'present' }), constraint('b', 'description', { op: 'max_length', value: 0 }));
  assert.equal(analyzeRulePack(text).status, 'conflict');
  assert.equal(analyzeRulePack(policy(constraint('a', 'priority', { op: 'min_value', value: 2 }), constraint('b', 'priority', { op: 'max_value', value: 2 }))).status, 'compatible');
  for (const order of [pack.rules, [...pack.rules].reverse(), [numeric[1], required, numeric[0], forbidden]]) {
    const result = analyzeRulePack(policy(...order));
    assert.deepEqual(result, analyzeRulePack(pack));
    for (const id of result.witness!.rule_ids) assert.equal(analyzeRulePack(policy(...order.filter(rule => rule.id !== id && result.witness!.rule_ids.includes(rule.id)))).status, 'compatible');
  }
});

test('selector intersections preserve custom status identities and unknown predicates never invent proofs', () => {
  const min = constraint('a', 'priority', { op: 'min_value', value: 4 }, { statuses: ['custom-working', 'custom-ready'], types: ['Task'] });
  const max = constraint('b', 'priority', { op: 'max_value', value: 0 }, { statuses: ['custom-working', 'custom-working'], types: ['Task', 'Issue'] });
  assert.deepEqual(analyzeRulePack(policy(min, max)).witness?.when, { statuses: ['custom-working'], types: ['Task'] });
  for (const when of [{ statuses: ['custom-done'] }, { types: ['Feature'] }]) assert.equal(analyzeRulePack(policy(min, { ...max, when })).status, 'compatible');
  assert.equal(analyzeRulePack(policy({ ...min, when: {} }, max)).status, 'conflict');
  assert.equal(analyzeRulePack(policy(min, constraint('b', 'priority', { op: 'max_value', value: 0 }))).status, 'conflict');
  for (const op of ['contains', 'not_contains', 'starts_with'] as const) {
    const result = analyzeRulePack(policy(constraint('literal', 'title', { op, value: 'x' })));
    assert.equal(result.status, 'unknown');
    assert.deepEqual(result.unknown_rule_ids, ['literal']);
    assert.equal(result.witness, null);
    assert.match(result.remedy, /manually/);
  }
  assert.equal(analyzeRulePack(policy(min, max, constraint('literal', 'title', { op: 'contains', value: 'x' }))).status, 'conflict');
});

test('shared boundary refuses sparse arrays, invalid field/operator pairs and extreme numeric values', () => {
  const base = constraint('a', 'priority', { op: 'min_value', value: 0 });
  const invalid = [
    policy({ ...base, field: 'tags' }), policy({ ...base, field: 'description' }), policy({ ...base, predicate: { op: 'present' } }),
    policy(constraint('a', 'tags', { op: 'contains', value: 'x' })),
    { version: 1, rules: new Array(2) }, policy({ ...base, when: { statuses: new Array(2) } }),
    ...[NaN, Infinity, -Infinity, -1, Number.MAX_VALUE, Number.MIN_VALUE, 0.5, 5, 65536].map(value => policy({ ...base, predicate: { op: 'min_value', value } })),
  ];
  for (const input of invalid) assert.throws(() => analyzeRulePack(input), error => error instanceof RulePackRefusal && error.remedy.length > 0);
  for (const field of ['priority', 'description'] as const) for (const value of [0, 4]) for (const op of field === 'priority' ? ['min_value', 'max_value'] as const : ['min_length', 'max_length'] as const) assert.equal(analyzeRulePack(policy(constraint('bound', field, { op, value }))).status, 'compatible');
  for (const value of [0, 65536]) assert.equal(analyzeRulePack(policy(constraint('bound', 'description', { op: 'min_length', value }))).status, 'compatible');
  const legacy = JSON.parse(awaitlessExample()) as unknown;
  assert.equal(analyzeRulePack(legacy).status, 'unknown', 'previously shipped packs remain readable');
});

/** Preserve a previously released version 1 serialization, including whitespace literals. */
function awaitlessExample(): string { return '{"version":1,"rules":[{"id":"ORG.legacy","field":"title","predicate":{"op":"contains","value":" x "},"severity":"warn","explanation":"Existing rule","remedy":"Keep literal whitespace"}]}'; }

test('policy preflight rejects contradictions before a complete corpus read and preserves SDK state', async t => {
  const { client, pmRoot } = await tracker(t);
  const item = (await client.create({ title: 'Read native priority and tags', type: 'Task', priority: '3', tags: ' Reviewed ', unset: ['parent', 'goal', 'objective', 'sprint', 'release'], clearDeps: true })).item;
  const native = (await client.get(item.id, { full: true })).item;
  await client.listAllComplete();
  const valid = policy(constraint('min', 'priority', { op: 'min_value', value: 3 }), constraint('max', 'priority', { op: 'max_value', value: 3 }), constraint('tag', 'tags', { op: 'required_tag', value: 'REVIEWED' }), constraint('other', 'tags', { op: 'forbidden_tag', value: 'other' }));
  assert.equal((await lintRulePack(client, valid)).count, 0);
  const misses = policy(constraint('max', 'priority', { op: 'max_value', value: 2 }), constraint('tag', 'tags', { op: 'required_tag', value: 'missing' }), constraint('forbidden', 'tags', { op: 'forbidden_tag', value: 'reviewed' }), constraint('min', 'priority', { op: 'min_value', value: 4 }));
  // Evaluate independently compatible packs; applying the contradictory union is refused.
  for (const rule of misses.rules) assert.equal((await lintRulePack(client, policy(rule))).count, 1);
  await client.create({ title: 'Read absent native tags', type: 'Task', unset: ['parent', 'goal', 'objective', 'sprint', 'release'], clearDeps: true });
  assert.equal((await lintRulePack(client, policy(valid.rules[2]))).count, 1);
  const brokenPath = join(pmRoot, 'tasks', `${item.id}.toon`);
  const original = await readFile(brokenPath);
  try {
    await writeFile(brokenPath, 'broken SDK source');
    const bytes = await inventory(pmRoot);
    await assert.rejects(lintRulePack(client, misses), error => error instanceof RulePackRefusal && error.code === 'conflicting_pack' && error.witness?.length === 2);
    assert.equal(await inventory(pmRoot), bytes, 'preflight performs no corpus read or cache write');
  } finally { await writeFile(brokenPath, original); }
  assert.deepEqual((await client.get(item.id, { full: true })).item, native);
  assert.deepEqual(await readFile(brokenPath), original);
});

test('registered and built conflict commands expose compact JSON/TOON with git absent', async t => {
  const activation = await activateExtensionForTest(extension, { name: 'pm-lint', capabilities: ['commands', 'schema'] });
  assertRegisteredCommandContract(activation.registrations, { command: 'lint conflicts', flags: ['--pack'] });
  const { root, pmRoot } = await tracker(t);
  const file = join(root, 'rules.json');
  const pack = policy(constraint('a', 'tags', { op: 'required_tag', value: 'x' }), constraint('b', 'tags', { op: 'forbidden_tag', value: 'x' }));
  await writeFile(file, JSON.stringify(pack));
  const direct: CommandHandlerContext = { command: 'lint conflicts', args: [], options: { pack: file }, pm_root: pmRoot, repo_root: root, global: {} };
  assert.equal((await runRulePackCommand(direct)).exit_code, 1);
  assert.deepEqual(((await runRulePackCommand({ ...direct, command: 'lint pack' })).refusal as { witness: string[] }).witness, ['a', 'b']);
  await installBuiltExtension(pmRoot);
  for (const json of [false, true]) {
    const result = runGitFreeCli(root, pmRoot, ['lint', 'conflicts', '--pack', file, ...(json ? ['--json'] : [])]);
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.match(result.stdout, /conflict/);
    if (json) {
      const receipt = JSON.parse(result.stdout) as RulePackAnalysis;
      assert.deepEqual(receipt.witness?.rule_ids, ['a', 'b']);
      assert.ok(Buffer.byteLength(result.stdout) < 1200);
    }
  }
  const refused = runGitFreeCli(root, pmRoot, ['lint', 'pack', '--pack', file, '--json']);
  assert.equal(refused.status, 2);
  assert.deepEqual((JSON.parse(refused.stdout) as { refusal: { witness: string[] } }).refusal.witness, ['a', 'b']);
  for (const [predicate, status, exit] of [[{ op: 'min_value', value: 0 }, 'compatible', undefined], [{ op: 'contains', value: 'x' }, 'unknown', 2]] as const) {
    await writeFile(file, JSON.stringify(policy(constraint('single', predicate.op === 'contains' ? 'title' : 'priority', predicate))));
    const ctx: CommandHandlerContext = { command: 'lint conflicts', args: [], options: { pack: file }, pm_root: pmRoot, repo_root: root, global: {} };
    const result = await runRulePackCommand(ctx);
    assert.equal(result.status, status);
    assert.equal(result.exit_code, exit);
  }
  assert.equal(parseRulePack(pack).rules.length, 2);
});
