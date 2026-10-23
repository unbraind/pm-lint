import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { commitImportedItem, readSettings } from '@unbrained/pm-cli/sdk';
import { activateExtensionForTest, assertRegisteredCommandContract, runRegisteredCommandForTest } from '@unbrained/pm-cli/sdk/testing';
import type { CommandHandlerContext } from '@unbrained/pm-cli/sdk/authoring';
import extension, { lintWitnesses, parseWitnessContract, observationDigest, sourceDigest, WitnessRefusal } from '../index.ts';
import type { CriterionBinding, CriterionWitness, WitnessContract, WitnessResult } from '../index.ts';
import { readWitnessContract } from '../src/witnesses.ts';
import { runWitnessCommand } from '../src/witness-command.ts';
import { installBuiltExtension, runGitFreeCli, tracker } from './helpers.ts';

/** Check the stable machine category and actionable remedy. */
function refusal(code: string): (error: unknown) => boolean {
  return error => error instanceof WitnessRefusal && error.code === code && error.remedy.length > 0;
}
/** Build a strict single-criterion contract without concealing runtime input validation. */
function contract(item_id: string, criterion: string, witnesses: CriterionWitness[]): WitnessContract {
  return { version: 1, bindings: [{ item_id, criterion, witnesses }] };
}
const pending: CriterionWitness = { kind: 'pending', reason: 'Await independent observation' };
const observation: CriterionWitness = { kind: 'observation', path: 'proof.txt:2:4', sha256: observationDigest('verified\n'), outcome: 'pass' };

test('strict witness schema rejects unknown, empty, duplicate and mistyped declarations', () => {
  const valid = contract('pm-proof-abcd', 'Returns exact citations', [pending, observation, { kind: 'test', command: 'do not execute', sha256: 'a'.repeat(64), outcome: 'fail' }]);
  const parsed = parseWitnessContract(valid);
  parsed.bindings[0].criterion = 'changed';
  assert.equal(valid.bindings[0].criterion, 'Returns exact citations');
  assert.deepEqual(parseWitnessContract({ version: 1, bindings: [] }), { version: 1, bindings: [] });
  const base = valid.bindings[0];
  for (const value of [null, [], 1, {}, { version: 2, bindings: [] }, { version: 1, bindings: null }, { ...valid, extra: true }, { version: 1, bindings: [null] }, { version: 1, bindings: [base, base] }]) assert.throws(() => parseWitnessContract(value), refusal('invalid_contract'));
  for (const patch of [{ extra: true }, { item_id: '' }, { item_id: 4 }, { criterion: ' ' }, { criterion: 'x'.repeat(4097) }, { witnesses: [] }, { witnesses: {} }]) assert.throws(() => parseWitnessContract({ ...valid, bindings: [{ ...base, ...patch }] }), refusal('invalid_contract'));
  for (const witness of [null, [], {}, { kind: 'pending', reason: ' ' }, { ...pending, extra: true }, { kind: 'test', command: '', sha256: 'a'.repeat(64), outcome: 'pass' }, { ...observation, path: '' }, { ...observation, sha256: 1 }, { ...observation, sha256: 'bad' }, { ...observation, outcome: 'unknown' }, { ...observation, kind: 'prose' }, { ...observation, extra: true }]) assert.throws(() => parseWitnessContract({ ...valid, bindings: [{ ...base, witnesses: [witness] }] }), refusal('invalid_contract'));
});

test('plain-directory SDK separates missing, dangling, stale, pending and contradictory proof', async t => {
  const { client, root, pmRoot } = await tracker(t);
  const item = (await client.create({ type: 'Feature', title: 'Expose explicit criterion proof', acceptanceCriteria: 'Verified output; Pending output; Missing output', test: ['command=node -e "process.exit(99)"'] })).item;
  await writeFile(join(root, 'proof.txt'), 'verified\n');
  const linked = item.tests![0];
  const declarations: CriterionBinding[] = [
    ...contract(item.id, 'Verified output', [observation, { kind: 'test', command: linked.command!, sha256: sourceDigest(linked), outcome: 'pass' }]).bindings,
    ...contract(item.id, 'Pending output', [pending]).bindings,
    ...contract(item.id, 'Removed criterion', [pending]).bindings,
    ...contract('pm-absent-abcd', 'Unknown item', [pending]).bindings,
  ];
  const before = await readFile(join(pmRoot, 'features', `${item.id}.toon`));
  const result = await lintWitnesses(client, { version: 1, bindings: declarations }, root);
  assert.deepEqual(result.summary, { supported: 2, pending: 1, missing: 1, dangling: 1, stale: 1, contradictory: 0 });
  assert.equal(result.criteria_count, 3);
  assert.equal(result.corpus_count, 1);
  assert.equal(result.exit_code, 1);
  assert.equal(result.findings.find(row => row.citation === observation.path)?.citation, 'proof.txt:2:4');
  assert.deepEqual(await readFile(join(pmRoot, 'features', `${item.id}.toon`)), before);
  const failing = contract(item.id, 'Verified output', [
    { ...observation, path: 'proof.txt#L1-L2', outcome: 'fail' },
    { kind: 'test', command: 'not linked', sha256: 'b'.repeat(64), outcome: 'pass' },
    { kind: 'test', command: linked.command!, sha256: 'b'.repeat(64), outcome: 'fail' },
    { ...observation, path: 'absent.txt' }, { ...observation, path: 'proof.txt/child' }, { ...observation, sha256: 'b'.repeat(64) },
  ]);
  const invalid = await lintWitnesses(client, failing, root);
  assert.equal(invalid.summary.dangling, 3);
  assert.equal(invalid.summary.stale, 2);
  assert.equal(invalid.summary.contradictory, 2);
  assert.ok(invalid.findings.some(row => row.citation === 'proof.txt#L1-L2'));
  assert.deepEqual(invalid.findings, (await lintWitnesses(client, { version: 1, bindings: [...failing.bindings].reverse() }, root)).findings);
});

test('current linked tests bind all metadata and ambiguous identities contradict', async t => {
  const { client, root, pmRoot } = await tracker(t);
  const item = (await client.create({ type: 'Task', title: 'Do not execute declared commands', acceptanceCriteria: 'Proof', test: ['command=never-run,path=first.ts', 'command=never-run,path=second.ts'] })).item;
  const ambiguous = await lintWitnesses(client, contract(item.id, 'Proof', [{ kind: 'test', command: 'never-run', sha256: sourceDigest(item.tests![0]), outcome: 'pass' }]), root);
  assert.equal(ambiguous.summary.contradictory, 1);
  const precise = await lintWitnesses(client, contract(item.id, 'Proof', [{ kind: 'test', command: 'never-run', path: 'first.ts', sha256: sourceDigest(item.tests![0]), outcome: 'pass' }]), root);
  assert.equal(precise.summary.supported, 1);
  assert.equal(precise.findings[0].citation, 'first.ts');
  const pathItem = (await client.create({ type: 'Task', title: 'Keep path-only linked tests', acceptanceCriteria: 'Exact path' })).item;
  // The pinned writer requires commands; import a valid legacy path-only declaration.
  const imported = await commitImportedItem({ pmRoot, id: pathItem.id, itemPath: join(pmRoot, 'tasks', `${pathItem.id}.toon`), document: { metadata: { ...pathItem, tests: [{ path: 'test/proof.ts', scope: 'project' }] }, body: '' }, author: 'lint-test', message: 'Import path-only linked test', settings: await readSettings(pmRoot), conflictWarningPrefix: 'fixture' });
  assert.equal(imported.committed, true);
  const pathOnly = (await client.listAllComplete()).items.find(entry => entry.id === pathItem.id)!;
  const byPath = await lintWitnesses(client, contract(pathOnly.id, 'Exact path', [{ kind: 'test', path: 'test/proof.ts', sha256: sourceDigest(pathOnly.tests![0]), outcome: 'pass' }]), root);
  assert.equal(byPath.summary.supported, 1);
  assert.equal(byPath.findings.find(row => row.state === 'supported')?.citation, 'test/proof.ts');
  const noTests = (await client.create({ type: 'Task', title: 'No linked tests', acceptanceCriteria: 'No execution' })).item;
  const missing = await lintWitnesses(client, contract(noTests.id, 'No execution', [{ kind: 'test', command: 'never-run', sha256: 'a'.repeat(64), outcome: 'pass' }]), root);
  assert.equal(missing.summary.dangling, 1);
});

test('witness ordering uses exact strings across Unicode criteria, citations and reversed declarations', async t => {
  const { client, root } = await tracker(t);
  const decomposed = 'e\u0301 proof';
  const composed = '\u00e9 proof';
  const item = (await client.create({ id: 'lint-order-a', type: 'Task', title: 'Order every exact witness identity', acceptanceCriteria: `${composed}; ${decomposed}; Z proof` })).item;
  const other = (await client.create({ id: 'lint-order-z', type: 'Task', title: 'Order separate item identities', acceptanceCriteria: 'Other proof' })).item;
  const paths = ['\u00e9vidence.txt:1', 'e\u0301vidence.txt:1'];
  for (const path of paths) await writeFile(join(root, path.slice(0, -2)), 'verified\n');
  const witnesses: CriterionWitness[] = paths.flatMap(path => ([{ ...observation, path, outcome: 'pass' }, { ...observation, path, outcome: 'fail' }]));
  witnesses.push({ ...observation, path: paths[0] });
  const bindings = [composed, decomposed].map(criterion => ({ item_id: item.id, criterion, witnesses }));
  const original = await lintWitnesses(client, { version: 1, bindings }, root);
  const reversed = await lintWitnesses(client, { version: 1, bindings: [...bindings].reverse().map(binding => ({ ...binding, witnesses: [...binding.witnesses].reverse() })) }, root);
  assert.deepEqual(original.findings, reversed.findings, 'canonical-equivalent Unicode strings must not retain declaration order');
  const rows = original.findings.filter(row => row.item_id === item.id);
  assert.deepEqual([...new Set(rows.map(row => row.criterion))], ['Z proof', decomposed, composed]);
  for (const criterion of [decomposed, composed]) {
    const citations = rows.filter(row => row.criterion === criterion);
    assert.deepEqual(citations.map(row => [row.citation, row.state]), [
      [paths[1], 'contradictory'], [paths[1], 'supported'],
      [paths[0], 'contradictory'], [paths[0], 'supported'], [paths[0], 'supported'],
    ]);
  }
  assert.deepEqual(original.summary, { supported: 6, pending: 0, missing: 2, dangling: 0, stale: 0, contradictory: 4 });
  assert.equal(original.findings.at(-1)?.item_id, other.id);
});

test('observations reject traversal and symlink escapes with typed remedies', async t => {
  const { client, root } = await tracker(t);
  const item = (await client.create({ type: 'Task', title: 'Keep observations local', acceptanceCriteria: 'Proof' })).item;
  for (const path of ['../escape', resolve(root, 'proof.txt')]) await assert.rejects(lintWitnesses(client, contract(item.id, 'Proof', [{ ...observation, path }]), root), refusal('unsafe_citation'));
  await symlink(dirname(root), join(root, 'escape'));
  await assert.rejects(lintWitnesses(client, contract(item.id, 'Proof', [{ ...observation, path: 'escape' }]), root), refusal('unsafe_citation'));
  await mkdir(join(root, 'directory'));
  await assert.rejects(lintWitnesses(client, contract(item.id, 'Proof', [{ ...observation, path: 'directory' }]), root), refusal('evidence_io'));
  assert.equal(observationDigest(new Uint8Array([97])), observationDigest('a'));
});

test('empty trackers and fully supported criteria succeed; comments cannot supply proof', async t => {
  const { client, root } = await tracker(t);
  const empty = await lintWitnesses(client, { version: 1, bindings: [] }, root);
  assert.equal(empty.criteria_count, 0);
  assert.equal(empty.exit_code, 0);
  const item = (await client.create({ type: 'Task', title: 'Require explicit support', acceptanceCriteria: 'Proof', comment: ['text=Everything passes'] })).item;
  assert.equal((await lintWitnesses(client, { version: 1, bindings: [] }, root)).summary.missing, 1);
  await writeFile(join(root, 'proof.txt'), 'verified\n');
  assert.equal((await lintWitnesses(client, contract(item.id, 'Proof', [observation]), root)).exit_code, 0);
});

test('exact criteria survive reorder and comments while changed artifacts and test metadata become stale', async t => {
  const { client, root } = await tracker(t);
  const item = (await client.create({ type: 'Task', title: 'Keep stable proof identities', acceptanceCriteria: 'File proof; Test proof', test: ['command=never-execute'] })).item;
  await writeFile(join(root, 'proof.txt'), 'verified\n');
  const bindings = [...contract(item.id, 'File proof', [observation]).bindings, ...contract(item.id, 'Test proof', [{ kind: 'test', command: item.tests![0].command!, sha256: sourceDigest(item.tests![0]), outcome: 'pass' }]).bindings];
  assert.equal((await lintWitnesses(client, { version: 1, bindings }, root)).exit_code, 0);
  await client.update(item.id, { acceptanceCriteria: 'Test proof; File proof' });
  await client.comments(item.id, { add: 'Independent comment without proof inference' });
  assert.equal((await lintWitnesses(client, { version: 1, bindings }, root)).exit_code, 0);
  await writeFile(join(root, 'proof.txt'), 'changed\n');
  await client.run('test', { id: item.id, options: { updateIndex: 1, setJson: JSON.stringify({ note: 'Changed test metadata' }) } });
  const drifted = await lintWitnesses(client, { version: 1, bindings }, root);
  assert.equal(drifted.summary.stale, 2);
  assert.equal(drifted.summary.supported, 0);
  assert.equal(drifted.exit_code, 1);
});

test('contract I/O and malformed JSON refuse without disclosing source contents', async t => {
  const { root } = await tracker(t);
  await assert.rejects(readWitnessContract(join(root, 'absent.json')), refusal('contract_io'));
  const path = join(root, 'contract.json');
  await writeFile(path, 'not json');
  await assert.rejects(readWitnessContract(path), refusal('contract_io'));
  await writeFile(path, '{}');
  await assert.rejects(readWitnessContract(path), refusal('invalid_contract'));
  await writeFile(path, JSON.stringify({ version: 1, bindings: [] }));
  assert.deepEqual(await readWitnessContract(path), { version: 1, bindings: [] });
});

test('registered host command renders success, failing rows and typed refusals', async t => {
  const previousExit = process.exitCode;
  t.after(() => { process.exitCode = previousExit; });
  const { client, root, pmRoot } = await tracker(t);
  await writeFile(join(root, 'contract.json'), JSON.stringify({ version: 1, bindings: [] }));
  const activation = await activateExtensionForTest(extension, { name: 'pm-lint', capabilities: ['commands', 'schema'] });
  const registered = assertRegisteredCommandContract(activation.registrations, { command: 'lint witnesses', flags: ['--contract'] });
  assert.deepEqual(registered.command.read_output?.row_keys, ['findings']);
  const result = await runRegisteredCommandForTest(activation.commands, { command: 'lint witnesses', options: { contract: join(root, 'contract.json') }, pmRoot });
  assert.equal(result.handled, true);
  assert.equal((result.result as { exit_code: number }).exit_code, 2, 'the SDK dispatcher omits workspace coordinates; refuse absent evidence roots');
  const ctx: CommandHandlerContext = { command: 'lint witnesses', args: [], options: { contract: 'contract.json' }, pm_root: pmRoot, repo_root: root, global: { author: 'lint-test' } };
  assert.equal('exit_code' in await runWitnessCommand(ctx), false);
  const item = (await client.create({ type: 'Task', title: 'Require declared witnesses', acceptanceCriteria: 'Proof' })).item;
  assert.equal((await runWitnessCommand(ctx)).exit_code, 1);
  ctx.source_workspace_root = root;
  assert.equal((await runWitnessCommand(ctx)).criteria_count, 1);
  for (const value of [undefined, [], '', false]) {
    ctx.options.contract = value;
    assert.equal((await runWitnessCommand(ctx)).exit_code, 2);
  }
  ctx.options.contract = 'contract.json';
  delete ctx.repo_root;
  delete ctx.source_workspace_root;
  assert.equal((await runWitnessCommand(ctx)).exit_code, 2);
  ctx.repo_root = root;
  ctx.options.contract = 'absent.json';
  assert.equal((await runWitnessCommand(ctx)).exit_code, 2);
  // Complete-list failures remain errors instead of being reclassified as contract failures.
  ctx.options.contract = 'contract.json';
  await writeFile(join(pmRoot, 'tasks', `${item.id}.toon`), 'broken item');
  await assert.rejects(runWitnessCommand(ctx));
});

test('built CLI emits exact JSON and TOON citations in a non-git directory with no git on PATH', async t => {
  const { client, root, pmRoot } = await tracker(t);
  const item = (await client.create({ type: 'Task', title: 'Cite exact observation path', acceptanceCriteria: 'Proof' })).item;
  await writeFile(join(root, 'proof.txt'), 'verified\n');
  await writeFile(join(root, 'contract.json'), JSON.stringify(contract(item.id, 'Proof', [observation])));
  await installBuiltExtension(pmRoot);
  for (const format of [[], ['--json']]) {
    const result = runGitFreeCli(root, pmRoot, ['lint', 'witnesses', '--contract', 'contract.json', ...format]);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /proof\.txt:2:4/);
    if (format.length > 0) {
      const receipt = JSON.parse(result.stdout) as WitnessResult;
      assert.equal(receipt.findings[0].citation, 'proof.txt:2:4');
      assert.equal(receipt.summary.supported, 1);
    } else assert.match(result.stdout, /findings/);
  }
  const refused = runGitFreeCli(root, pmRoot, ['lint', 'witnesses', '--json']);
  assert.equal(refused.status, 2, refused.stderr + refused.stdout);
  assert.equal((JSON.parse(refused.stdout || refused.stderr) as { refusal: { code: string } }).refusal.code, 'invalid_contract', refused.stderr + refused.stdout);
});
