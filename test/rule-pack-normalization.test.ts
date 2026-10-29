import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decode, encode } from '@toon-format/toon';
import { toImportTags } from '@unbrained/pm-cli/sdk';
import { analyzeRulePack, lintRulePack, parseRulePack, readRulePack, RulePackRefusal, RULE_PACK_LIMITS } from '../index.ts';
import { constraint, policy } from './conflict-fixtures.ts';
import { installBuiltExtension, runGitFreeCli, tracker } from './helpers.ts';

/** Require a bounded refusal without admitting an invalid producer result. */
function exceedsLiteral(error: unknown): boolean { return error instanceof RulePackRefusal && error.code === 'limit_exceeded' && error.remedy.length > 0; }

test('500 Unicode normalization cases preserve canonical producer closure and JSON/TOON analysis', () => {
  let seed = 0x01302026;
  const atoms = ['\u0130', 'A', '\u03a3', 'I\u0307', '\ud83d\ude80', 'constructor', '__proto__'];
  const lengths = [1, 2, 31, 128, 255, 256, 257, 300, 511, 512, 513];
  let accepted = 0;
  let refused = 0;
  for (let sequence = 0; sequence < 500; sequence++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const value = `${seed % 3 === 0 ? ' \r\n' : ''}${atoms[seed % atoms.length].repeat(lengths[(seed >>> 8) % lengths.length])}${seed % 5 === 0 ? '\t ' : ''}`;
    const input = policy(constraint('Unicode', 'tags', { op: seed % 2 === 0 ? 'required_tag' : 'forbidden_tag', value }));
    const canonical = toImportTags([value])[0];
    if (value.length > RULE_PACK_LIMITS.literal || canonical.length > RULE_PACK_LIMITS.literal) {
      assert.throws(() => parseRulePack(input), exceedsLiteral, `seed=0x01302026 sequence=${sequence}`);
      assert.throws(() => analyzeRulePack(input), exceedsLiteral);
      refused++;
      continue;
    }
    const parsed = parseRulePack(input);
    assert.deepEqual(parsed.rules[0].predicate, { op: input.rules[0].predicate.op, value: canonical });
    for (const exported of [parsed, JSON.parse(JSON.stringify(parsed)), decode(encode(parsed))]) {
      assert.deepEqual(parseRulePack(exported), parsed, `canonical closure sequence=${sequence}`);
      assert.deepEqual(analyzeRulePack(exported), analyzeRulePack(input));
    }
    accepted++;
  }
  assert.ok(accepted > 50 && refused > 50, 'the seed covers admitted and refused canonical boundaries');
});

test('Unicode boundaries agree through file reads, repeated SDK calls and git-free JSON/TOON commands', async t => {
  const { client, root, pmRoot } = await tracker(t);
  const item = (await client.create({ type: 'Task', title: 'Keep normalized Unicode tags', tags: JSON.stringify(['\u0130'.repeat(256)]), unset: ['parent', 'goal', 'objective', 'sprint', 'release'], clearDeps: true })).item;
  const before = (await client.get(item.id, { full: true })).item;
  const file = join(root, 'unicode-rules.json');
  await installBuiltExtension(pmRoot);
  for (const op of ['required_tag', 'forbidden_tag'] as const) {
    for (const value of ['\u0130'.repeat(255), '\u0130'.repeat(256), '\u0130'.repeat(257), '\u0130'.repeat(300)]) {
      const input = policy(constraint('Unicode', 'tags', { op, value }));
      await writeFile(file, ` \r\n${JSON.stringify(input)}\r\n`);
      const admitted = toImportTags([value])[0].length <= RULE_PACK_LIMITS.literal;
      let count = 0;
      if (admitted) {
        const parsed = await readRulePack(file);
        assert.deepEqual(parseRulePack(parsed), parsed);
        assert.deepEqual(analyzeRulePack(parsed), analyzeRulePack(input));
        const result = await lintRulePack(client, input);
        assert.deepEqual(await lintRulePack(client, parsed), result);
        assert.deepEqual(await lintRulePack(client, parseRulePack(decode(encode(parsed)))), result);
        count = result.count;
      } else {
        assert.throws(() => analyzeRulePack(input), exceedsLiteral);
        await assert.rejects(readRulePack(file), exceedsLiteral);
        await assert.rejects(lintRulePack(client, input), exceedsLiteral);
      }
      for (const command of ['conflicts', 'pack']) for (const json of [false, true]) {
        const process = runGitFreeCli(root, pmRoot, ['lint', command, '--pack', file, ...(json ? ['--json'] : [])]);
        const receipt = (json ? JSON.parse(process.stdout) : decode(process.stdout)) as { status?: string; count?: number; refusal?: { code: string } };
        assert.equal(process.status, admitted ? command === 'pack' ? count : 0 : 2, process.stderr + process.stdout);
        if (admitted) {
          assert.equal(receipt.refusal, undefined);
          if (command === 'pack') assert.equal(receipt.count, count);
          else assert.equal(receipt.status, 'compatible');
        } else assert.equal(receipt.refusal?.code, 'limit_exceeded');
      }
    }
  }
  assert.deepEqual((await client.get(item.id, { full: true })).item, before);
});

test('canonical byte expansion is bounded while released text literals retain exact spelling', async t => {
  for (const op of ['contains', 'not_contains', 'starts_with'] as const) {
    const original = policy(constraint('Legacy', 'title', { op, value: '\u0130'.repeat(512) }));
    assert.deepEqual(parseRulePack(original), original);
    assert.deepEqual(parseRulePack(decode(encode(original))), original);
  }
  const input = policy(...Array.from({ length: 56 }, (_, index) => ({ ...constraint(`Tag${index}`, 'tags', { op: 'required_tag', value: '\u0130'.repeat(256) }), explanation: 'x'.repeat(256), remedy: 'x'.repeat(256) })));
  const raw = JSON.stringify(input);
  assert.ok(Buffer.byteLength(raw) <= RULE_PACK_LIMITS.bytes, 'the source file fits before canonical expansion');
  assert.throws(() => parseRulePack(input), exceedsLiteral);
  const { root } = await tracker(t);
  const file = join(root, 'canonical-bytes.json');
  await writeFile(file, raw);
  await assert.rejects(readRulePack(file), exceedsLiteral);
});
