/** Measure preview context on an untouched read-only public tracker copy outside git. */
import assert from 'node:assert/strict';
import { inventory } from './repair-inventory.ts';
import { encode } from '@toon-format/toon';
import { PmClient, certifyCompleteListResult } from '@unbrained/pm-cli/sdk';
import { previewAuthoringRepairs } from '../index.ts';
import { withRepairSnapshot } from '../src/repair-snapshot.ts';

const [pmRoot] = process.argv.slice(2);
assert.ok(pmRoot, 'Supply a read-only public tracker snapshot');
const before = await inventory(pmRoot);
const corpus = await withRepairSnapshot(pmRoot, async snapshot => certifyCompleteListResult(await new PmClient({ pmRoot: snapshot, noExtensions: true }).listAllComplete()));
let mechanical = 0;
let validated = 0;
let questions = 0;
let repeatChecks = 0;
let maxJson = 0;
let maxToon = 0;
const byCode: Record<string, number> = {};
for (const item of corpus.items) {
  const result = await previewAuthoringRepairs(pmRoot, { id: item.id });
  assert.equal(result.writes, 0);
  assert.equal(result.remaining_mechanical, 0);
  mechanical += result.findings.length;
  validated += result.validation === null ? 0 : Number(result.validation.validated);
  questions += result.questions.length;
  for (const question of result.questions) byCode[question.code] = (byCode[question.code] ?? 0) + 1;
  maxJson = Math.max(maxJson, Buffer.byteLength(JSON.stringify(result)));
  maxToon = Math.max(maxToon, Buffer.byteLength(encode(result)));
  assert.deepEqual(await previewAuthoringRepairs(pmRoot, { id: item.id, revision: result.revision }), result);
  repeatChecks += 1;
}
assert.equal(await inventory(pmRoot), before);
console.log(JSON.stringify({ corpus_count: corpus.items.length, previews: corpus.items.length, repeat_revision_checks: repeatChecks, mechanical_findings: mechanical, sdk_validated_repairs: validated, substantive_questions: questions, by_code: byCode, max_json_bytes: maxJson, max_toon_bytes: maxToon, source_files_and_bytes_unchanged: true, source_writes: 0 }, null, 2));
