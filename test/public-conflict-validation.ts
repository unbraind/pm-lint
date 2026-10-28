/** Measure conflict preflight and policy compliance on an immutable public tracker copy. */
import assert from 'node:assert/strict';
import { PmClient } from '@unbrained/pm-cli/sdk';
import { encode } from '@toon-format/toon';
import { analyzeRulePack, lintRulePack, readRulePack } from '../index.ts';
import { constraint, policy } from './conflict-fixtures.ts';
import { inventory } from './repair-inventory.ts';

const [pmRoot] = process.argv.slice(2);
assert.ok(pmRoot, 'Supply a read-only public tracker snapshot');
const before = await inventory(pmRoot);
const conflict = analyzeRulePack(await readRulePack('examples/conflicting-rules.json'));
assert.equal(conflict.status, 'conflict');
const numeric = analyzeRulePack(policy(constraint('min', 'priority', { op: 'min_value', value: 3 }), constraint('max', 'priority', { op: 'max_value', value: 2 })));
assert.equal(numeric.status, 'conflict');
const input = policy(constraint('review', 'tags', { op: 'required_tag', value: 'reviewed' }), constraint('min', 'priority', { op: 'min_value', value: 1 }), constraint('max', 'priority', { op: 'max_value', value: 3 }));
assert.equal(analyzeRulePack(input).status, 'compatible');
const client = new PmClient({ cwd: pmRoot, pmRoot, noExtensions: true });
const observed = await lintRulePack(client, input);
assert.deepEqual(observed, await lintRulePack(client, policy(...[...input.rules].reverse())));
assert.equal(await inventory(pmRoot), before);
console.log(JSON.stringify({ corpus_count: observed.corpus_count, rules: input.rules.length, checks: observed.checks, findings: observed.count, by_rule: Object.fromEntries(input.rules.map(rule => [rule.id, observed.findings.filter(row => row.rule === rule.id).length])), tag_witness_size: conflict.witness!.rule_ids.length, range_witness_size: numeric.witness!.rule_ids.length, json_bytes: Buffer.byteLength(JSON.stringify(conflict)), toon_bytes: Buffer.byteLength(encode(conflict)), source_sha256: before, source_bytes_unchanged: true, reordered_result_identical: true }, null, 2));
