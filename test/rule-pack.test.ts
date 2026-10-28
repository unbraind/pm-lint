import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serializeItemDocument } from '@unbrained/pm-cli/sdk';
import { activateExtensionForTest, assertRegisteredCommandContract, runRegisteredCommandForTest } from '@unbrained/pm-cli/sdk/testing';
import type { CommandHandlerContext } from '@unbrained/pm-cli/sdk/authoring';
import extension, { lintRulePack, parseRulePack, readRulePack, RulePackRefusal, RULE_PACK_LIMITS } from '../index.ts';
import type { AuthoringPredicate, AuthoringRule, RulePack, RulePackResult } from '../index.ts';
import { runRulePackCommand } from '../src/rule-pack-command.ts';
import { installBuiltExtension, runGitFreeCli, tracker } from './helpers.ts';

/** Build a reusable assertion without hiding runtime validation. */
function rule(id = 'ORG.ac', predicate: AuthoringPredicate = { op: 'present' }): AuthoringRule {
  return { id, field: 'acceptance_criteria', predicate, severity: 'error', explanation: 'Acceptance needs observable proof.', remedy: 'Describe an independently observable result.' };
}
/** Wrap literal assertions in the versioned contract. */
function pack(...rules: AuthoringRule[]): RulePack { return { version: 1, rules }; }
/** Assert machine-readable refusals retain useful recovery advice. */
function refused(code: string, coordinate?: string): (error: unknown) => boolean {
  return error => error instanceof RulePackRefusal && error.code === code && error.remedy.length > 20 && (coordinate === undefined || error.message.includes(coordinate));
}

test('strict pack parser rejects unknown keys, types, unsafe patterns and duplicate identities', () => {
  const original = pack({ ...rule(), when: { statuses: ['open'], types: ['Feature'] } });
  const detached = parseRulePack(original);
  detached.rules[0].when!.statuses!.push('closed');
  assert.deepEqual(original.rules[0].when!.statuses, ['open']);
  for (const value of [null, [], 3, {}, { version: 2, rules: [rule()] }, { version: 1, rules: [] }, { version: 1, rules: {} }, { ...original, extra: true }]) assert.throws(() => parseRulePack(value), refused('invalid_pack', 'pack'));
  for (const patch of [{ extra: true }, { id: 'bad id' }, { id: 'bad\n' }, { id: '' }, { id: 3 }, { field: '__proto__' }, { severity: 'fatal' }, { remedy: ' ' }, { explanation: null }]) assert.throws(() => parseRulePack(pack({ ...rule(), ...patch } as AuthoringRule)), refused('invalid_pack', 'rules[0]'));
  assert.throws(() => parseRulePack({ ...original, extra: true }), /Unknown field in pack/);
  assert.throws(() => parseRulePack(pack(rule(), rule())), refused('invalid_pack', 'id'));
  for (const predicate of [null, {}, { op: 'present', value: true }, { op: 'contains', value: '' }, { op: 'contains', value: 3 }, { op: 'min_length', value: -1 }, { op: 'max_length', value: 0.5 }, { op: 'min_length', value: '1' }, { op: 'unknown' }, { op: 'contains', value: 'x', pattern: 'x' }]) assert.throws(() => parseRulePack({ version: 1, rules: [{ ...rule(), predicate }] }), refused('invalid_pack', 'predicate'));
  for (const op of ['regex', 'matches', 'glob', 'expression']) assert.throws(() => parseRulePack({ version: 1, rules: [{ ...rule(), predicate: { op, value: '(a+)+$' } }] }), refused('unsafe_pattern'));
  for (const when of [null, [], { tags: ['x'] }, { statuses: [] }, { types: 3 }, { statuses: [''] }]) assert.throws(() => parseRulePack({ version: 1, rules: [{ ...rule(), when }] }), refused('invalid_pack', 'when'));
  assert.deepEqual(parseRulePack(pack({ ...rule(), when: {} })).rules[0].when, {});
});

test('pack resource limits refuse rather than truncate and accept exact scalar boundaries', () => {
  for (const patch of [{ id: 'x'.repeat(65) }, { explanation: 'x'.repeat(257) }, { remedy: 'x'.repeat(257) }, { predicate: { op: 'contains', value: 'x'.repeat(513) } }, { predicate: { op: 'min_length', value: 65537 } }, { when: { types: Array.from({ length: 33 }, () => 'Task') } }, { when: { statuses: ['x'.repeat(65)] } }]) assert.throws(() => parseRulePack({ version: 1, rules: [{ ...rule(), ...patch }] }), refused('limit_exceeded'));
  assert.throws(() => parseRulePack(pack(...Array.from({ length: 65 }, (_, i) => rule(`r${i}`)))), refused('limit_exceeded', 'rules'));
  const large = Array.from({ length: 64 }, (_, i) => ({ ...rule(`r${i}`), explanation: 'x'.repeat(256), remedy: 'x'.repeat(256), predicate: { op: 'contains' as const, value: 'é'.repeat(512) } }));
  assert.throws(() => parseRulePack(pack(...large)), refused('limit_exceeded', 'bytes'));
  const boundary = { ...rule('x'.repeat(64), { op: 'contains', value: 'x'.repeat(512) }), explanation: 'x'.repeat(256), remedy: 'x'.repeat(256), when: { types: ['x'.repeat(64)] } };
  assert.deepEqual(parseRulePack(pack(boundary)), pack(boundary));
  assert.equal(parseRulePack(pack(rule('zero', { op: 'min_length', value: 0 }))).rules[0].predicate.op, 'min_length');
  assert.equal(parseRulePack(pack(rule('max', { op: 'max_length', value: 65536 }))).rules.length, 1);
});

test('regular file reader bounds bytes and returns typed I/O and schema refusals', async t => {
  const { root } = await tracker(t);
  const path = join(root, 'rules.json');
  await assert.rejects(readRulePack(path), refused('pack_io'));
  await assert.rejects(readRulePack(root), refused('pack_io'));
  await writeFile(path, 'not json');
  await assert.rejects(readRulePack(path), refused('pack_io'));
  await writeFile(path, '{}');
  await assert.rejects(readRulePack(path), refused('invalid_pack'));
  await writeFile(path, ' '.repeat(65537));
  await assert.rejects(readRulePack(path), refused('limit_exceeded', 'bytes'));
  const json = JSON.stringify(pack(rule()));
  await writeFile(path, json.padEnd(65536));
  assert.deepEqual(await readRulePack(path), pack(rule()));
});

test('real non-git trackers evaluate every literal predicate, selectors and exact ordering', async t => {
  const { client, pmRoot } = await tracker(t);
  assert.equal((await lintRulePack(client, pack(rule()))).exit_code, 0);
  const first = (await client.create({ id: 'lint-pack-z', type: 'Task', title: 'Org measurable result', description: 'proof (a+)+$', acceptanceCriteria: 'Exact proof' })).item;
  const second = (await client.create({ id: 'lint-pack-a', type: 'Feature', title: 'Org small', description: 'different' })).item;
  await client.create({ id: 'lint-pack-terminal', type: 'Task', title: 'Past work', status: 'closed', closeReason: 'Historical fixture' });
  const literalRules: AuthoringRule[] = [
    rule('present'), rule('contains', { op: 'contains', value: 'proof' }), rule('forbid', { op: 'not_contains', value: 'Exact' }),
    rule('prefix', { op: 'starts_with', value: 'Exact' }), { ...rule('minimum', { op: 'min_length', value: 6 }), field: 'description' }, rule('maximum', { op: 'max_length', value: 3 }),
    { ...rule('literal', { op: 'contains', value: '(a+)+$' }), field: 'description', severity: 'info' },
    { ...rule('z'), severity: 'warn' }, { ...rule('a'), severity: 'warn' },
  ];
  const observed = await lintRulePack(client, pack(...literalRules));
  assert.equal(observed.corpus_count, 3);
  assert.equal(observed.checks, 27);
  assert.equal(observed.exit_code, 1);
  assert.equal(observed.summary.info, 2);
  assert.equal(observed.summary.warn, 4);
  assert.deepEqual(observed.findings.filter(row => row.item_id === first.id).map(row => row.rule), ['forbid', 'maximum']);
  assert.ok(observed.findings.some(row => row.item_id === second.id && row.rule === 'present'));
  assert.deepEqual(observed.findings, (await lintRulePack(client, pack(...[...literalRules].reverse()))).findings);
  assert.ok(!JSON.stringify(observed.findings).includes('different'), 'diagnostics do not copy source text');
  const filtered = await lintRulePack(client, pack({ ...rule(), when: { statuses: ['open'], types: ['Task'] } }));
  assert.equal(filtered.checks, 1);
  assert.equal(filtered.count, 0);
  const advisory = await lintRulePack(client, pack({ ...rule(), severity: 'warn', when: { types: ['Feature'] } }));
  assert.equal(advisory.count, 1);
  assert.equal(advisory.exit_code, 0);
  const before = await readFile(join(pmRoot, 'tasks', `${first.id}.toon`));
  await lintRulePack(client, pack(...literalRules));
  assert.deepEqual(await readFile(join(pmRoot, 'tasks', `${first.id}.toon`)), before);
});

test('TOON and JSON Markdown SDK storage adapters produce identical diagnostic receipts', async t => {
  const source = await tracker(t);
  const target = await tracker(t);
  await source.client.create({ id: 'lint-pack-z', type: 'Task', title: 'With evidence', acceptanceCriteria: 'Observed output' });
  await source.client.create({ id: 'lint-pack-a', type: 'Task', title: 'Needs evidence' });
  const items = (await source.client.listAllComplete()).items;
  for (const item of [...items].reverse()) {
    await writeFile(join(target.pmRoot, 'tasks', `${item.id}.md`), serializeItemDocument({ metadata: item, body: '' }, { format: 'json_markdown' }));
  }
  const input = pack(rule(), { ...rule('ORG.length', { op: 'min_length', value: 30 }), field: 'title', severity: 'warn' });
  assert.match(await readFile(join(target.pmRoot, 'tasks', `${items.find(item => item.title === 'Needs evidence')!.id}.md`), 'utf8'), /"id"/);
  // The pinned host migrates legacy Markdown during reads; both readers expose identical metadata.
  assert.deepEqual(await lintRulePack(source.client, input), await lintRulePack(target.client, input));
});

test('evaluation refuses oversized text, diagnostic explosion and excessive work on real trackers', async t => {
  const { client, pmRoot } = await tracker(t);
  const item = (await client.create({ id: 'lint-pack-seed', type: 'Task', title: 'Bounded source', description: 'x'.repeat(RULE_PACK_LIMITS.text + 1) })).item;
  await assert.rejects(lintRulePack(client, pack({ ...rule(), field: 'description' })), refused('limit_exceeded', 'item text'));
  await client.update(item.id, { description: 'Bounded text' });
  const template = (await client.listAllComplete()).items[0];
  // Serialize real canonical documents through core, keeping this resource test inexpensive.
  for (let i = 0; i < 16; i += 1) {
    const id = `lint-pack-row-${i}`;
    await writeFile(join(pmRoot, 'tasks', `${id}.toon`), serializeItemDocument({ metadata: { ...template, id }, body: '' }));
  }
  const manyRules = pack(...Array.from({ length: 64 }, (_, i) => rule(`r${i}`)));
  await assert.rejects(lintRulePack(client, manyRules), refused('limit_exceeded', 'findings'));
  for (let i = 16; i < 1562; i += 1) {
    const id = `lint-pack-row-${i}`;
    await writeFile(join(pmRoot, 'tasks', `${id}.toon`), serializeItemDocument({ metadata: { ...template, id }, body: '' }));
  }
  await assert.rejects(lintRulePack(client, manyRules), refused('limit_exceeded', 'checks'));
});

test('registered rule-pack command preserves host exit semantics and complete-reader failures', async t => {
  const previousExit = process.exitCode;
  t.after(() => { process.exitCode = previousExit; });
  const { client, root, pmRoot } = await tracker(t);
  const path = join(root, 'rules.json');
  await writeFile(path, JSON.stringify(pack(rule())));
  const activation = await activateExtensionForTest(extension, { name: 'pm-lint', capabilities: ['commands', 'schema'] });
  const registered = assertRegisteredCommandContract(activation.registrations, { command: 'lint pack', flags: ['--pack'] });
  assert.deepEqual(registered.command.read_output?.row_keys, ['findings']);
  const result = await runRegisteredCommandForTest(activation.commands, { command: 'lint pack', options: { pack: path }, pmRoot });
  assert.equal(result.handled, true);
  assert.equal('exit_code' in (result.result as object), false);
  const ctx: CommandHandlerContext = { command: 'lint pack', args: [], options: { pack: 'rules.json' }, pm_root: pmRoot, repo_root: root, global: { author: 'lint-test' } };
  assert.equal('exit_code' in await runRulePackCommand(ctx), false);
  const item = (await client.create({ type: 'Task', title: 'Require evidence' })).item;
  ctx.source_workspace_root = root;
  assert.equal((await runRulePackCommand(ctx)).exit_code, 1);
  for (const pack of [undefined, [], '', false]) {
    ctx.options.pack = pack;
    const result = await runRulePackCommand(ctx);
    assert.equal(result.exit_code, 2);
    assert.equal((result.refusal as { code: string }).code, 'invalid_pack');
  }
  ctx.options.pack = path;
  delete ctx.repo_root;
  delete ctx.source_workspace_root;
  assert.equal((await runRulePackCommand(ctx)).exit_code, 1);
  await writeFile(join(pmRoot, 'tasks', `${item.id}.toon`), 'broken item');
  await assert.rejects(runRulePackCommand(ctx), /complete|parse|source|scan/i);
});

test('built pack CLI emits compact TOON/JSON and refusals without git on PATH', async t => {
  const { client, root, pmRoot } = await tracker(t);
  await client.create({ type: 'Task', title: 'Need observable acceptance' });
  await writeFile(join(root, 'rules.json'), JSON.stringify(pack(rule())));
  await installBuiltExtension(pmRoot);
  for (const json of [false, true]) {
    const result = runGitFreeCli(root, pmRoot, ['lint', 'pack', '--pack', 'rules.json', ...(json ? ['--json'] : [])]);
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.match(result.stdout, /ORG.ac/);
    if (json) {
      const receipt = JSON.parse(result.stdout) as RulePackResult;
      assert.equal(receipt.count, 1);
      assert.equal(receipt.summary.error, 1);
      assert.equal(receipt.findings[0].remedy, rule().remedy);
    } else assert.match(result.stdout, /findings/);
  }
  const missing = runGitFreeCli(root, pmRoot, ['lint', 'pack', '--json']);
  assert.equal(missing.status, 2, missing.stderr + missing.stdout);
  assert.equal((JSON.parse(missing.stdout || missing.stderr) as { refusal: { code: string } }).refusal.code, 'invalid_pack');
});
