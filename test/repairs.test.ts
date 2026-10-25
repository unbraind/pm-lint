import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { certifyCompleteListResult, getItemPath, serializeItemDocument } from '@unbrained/pm-cli/sdk';
import type { ItemMetadata } from '@unbrained/pm-cli/sdk';
import { activateExtensionForTest, assertRegisteredCommandContract, runRegisteredCommandForTest } from '@unbrained/pm-cli/sdk/testing';
import type { CommandHandlerContext } from '@unbrained/pm-cli/sdk/authoring';
import { inventory } from './repair-inventory.ts';
import extension, { previewAuthoringRepairs, RepairRefusal } from '../index.ts';
import type { RepairBoundary, RepairRequest } from '../index.ts';
import { mechanicalRepairs } from '../src/repairs.ts';
import { runRepairCommand } from '../src/repair-command.ts';
import { installBuiltExtension, runGitFreeCli, tracker } from './helpers.ts';

/** Seed surface debt that ordinary SDK authoring already normalizes away. */
async function seed(pmRoot: string, item: ItemMetadata, title = '  Verify observable behavior \r\n', tags = ['one', 'one', ' two ']): Promise<void> {
  const text = serializeItemDocument({ metadata: { ...item, title, tags }, body: 'Preserve body  \r\n\r\n' });
  await writeFile(getItemPath(pmRoot, item.type, item.id), text.replace(/^tags\[.*$/m, `tags[${tags.length}]: ${tags.map(tag => JSON.stringify(tag)).join(',')}`));
}

/** Check public refusal types and useful recovery advice. */
function refusal(code: string): (error: unknown) => boolean {
  return error => error instanceof RepairRefusal && error.code === code && error.remedy.length > 20;
}

test('mechanical preview validates through core, preserves substantive questions and writes zero bytes', async t => {
  const { client, pmRoot } = await tracker(t);
  const item = (await client.create({ type: 'Issue', title: 'Verify observable behavior', acceptanceCriteria: 'works', expectedResult: '' })).item;
  await seed(pmRoot, item);
  const before = await inventory(pmRoot);
  const result = await previewAuthoringRepairs(pmRoot, { id: item.id });
  assert.deepEqual(result.findings.map(row => row.code), ['title_whitespace', 'tag_normalization']);
  assert.deepEqual(result.patch, { title: 'Verify observable behavior', tags: ['one', 'two'] });
  assert.equal(result.remaining_mechanical, 0);
  assert.equal(result.validation?.validated, true);
  assert.equal(result.validation?.state, 'staged_snapshot');
  assert.ok(result.validation.unresolved_commit_constraints.includes('concurrent_tracker_changes'));
  assert.ok(result.questions.some(row => row.code === 'PML003'));
  assert.ok(result.questions.some(row => row.field === 'expected_result' && row.question.endsWith('?')));
  assert.equal(result.writes, 0);
  assert.deepEqual(await previewAuthoringRepairs(pmRoot, { id: item.id, revision: result.revision }), result);
  assert.equal(await inventory(pmRoot), before);
  // Independently apply only the suggested fields using core; then read state back through the SDK.
  await client.update(item.id, { title: result.patch.title, tags: JSON.stringify(result.patch.tags) });
  const reread = certifyCompleteListResult(await client.listAllComplete()).items[0];
  assert.equal(reread.title, result.patch.title);
  assert.deepEqual(reread.tags, result.patch.tags);
  const clean = await previewAuthoringRepairs(pmRoot, { id: item.id });
  assert.deepEqual(clean.patch, {});
  assert.equal(clean.validation, null);
  assert.equal(clean.remaining_mechanical, 0);
  assert.ok(clean.questions.some(row => row.code === 'missing_expected_behavior'));
  assert.notEqual(clean.plan_key, result.plan_key);
  await assert.rejects(previewAuthoringRepairs(pmRoot, { id: item.id, revision: result.revision }), refusal('stale_revision'));
});

test('requests, limits, core refusals and blank substantive titles stay explicit', async t => {
  const { client, pmRoot } = await tracker(t);
  for (const request of [null, {}, { id: true }, { id: 'bad id' }, { id: 'x-y', apply: true }, { id: 'x-y', revision: 'bad' }, { id: 'x-y', revision: 7 }] as unknown as RepairRequest[]) await assert.rejects(previewAuthoringRepairs(pmRoot, request), refusal('invalid_request'));
  await assert.rejects(previewAuthoringRepairs(pmRoot, { id: 'pm-missing-row' }), refusal('unknown_item'));
  const item = (await client.create({ title: 'Need explicit expected outcomes', type: 'Task' })).item;
  await seed(pmRoot, item, ' '.repeat(2) + 'x'.repeat(16385));
  await assert.rejects(previewAuthoringRepairs(pmRoot, { id: item.id }), refusal('limit_exceeded'));
  await seed(pmRoot, item, ' '.repeat(2) + 'x'.repeat(16372), []);
  assert.ok((await previewAuthoringRepairs(pmRoot, { id: item.id })).validation?.validated);
  await seed(pmRoot, item, ' \r\n ', []);
  const blank = await previewAuthoringRepairs(pmRoot, { id: item.id });
  assert.deepEqual(blank.patch, {});
  assert.ok(blank.questions.some(row => row.code === 'PML001'));
  assert.ok(blank.questions.some(row => row.code === 'PML002'));
  await seed(pmRoot, { ...item, tags: [] }, '  Must respect peer ownership ', []);

  await seed(pmRoot, { ...item, assignee: 'peer-agent', claim_principal: 'peer-agent' });
  // Core guards external schema files; the repair layer never bypasses them.
  const settingsPath = join(pmRoot, 'settings.json');
  const settings = JSON.parse(await readFile(settingsPath, 'utf8')) as Record<string, unknown>;
  settings.schema = { files: { fields: '../foreign-fields.json' } };
  await writeFile(settingsPath, JSON.stringify(settings));
  await assert.rejects(previewAuthoringRepairs(pmRoot, { id: item.id }), refusal('unsafe_repair'));
});

test('every asynchronous preview boundary rejects a competing target transition on one non-git tracker', async t => {
  const { client, pmRoot } = await tracker(t);
  const item = (await client.create({ title: 'Check every interleaving boundary', type: 'Task' })).item;
  const boundaries: RepairBoundary[] = ['snapshot_read', 'settings_read', 'source_read', 'planned', 'validated', 'source_rechecked'];
  for (const boundary of boundaries) {
    await seed(pmRoot, item);
    const saved = await previewAuthoringRepairs(pmRoot, { id: item.id });
    let injected = false;
    await assert.rejects(previewAuthoringRepairs(pmRoot, { id: item.id, revision: saved.revision }, { onBoundary: async step => {
      if (step === boundary) { injected = true; await client.update(item.id, { description: `Peer succeeded at ${boundary}` }); }
    } }), refusal('stale_revision'));
    assert.equal(injected, true, boundary);
    assert.equal((await client.get(item.id, { full: true })).item.description, `Peer succeeded at ${boundary}`);
  }
  await seed(pmRoot, item);
  await assert.rejects(previewAuthoringRepairs(pmRoot, { id: item.id }, { onBoundary: async step => {
    if (step === 'validated') await client.update(item.id, { tags: 'peer' });
  } }), refusal('stale_revision'));
  await assert.rejects(previewAuthoringRepairs(pmRoot, { id: item.id }, { onBoundary: async step => {
    if (step === 'source_rechecked') {
      const path = join(pmRoot, 'settings.json');
      const settings = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
      settings.lint = { disable: ['PML002'] };
      await writeFile(path, JSON.stringify(settings));
    }
  } }), refusal('stale_revision'));
});

test('registered and installed TOON/JSON repair commands work with no git executable', async t => {
  const { client, pmRoot, root } = await tracker(t);
  const item = (await client.create({ title: 'Describe concrete expected behavior', type: 'Issue' })).item;
  const activation = await activateExtensionForTest(extension, { name: 'pm-lint', capabilities: ['commands', 'schema'] });
  assertRegisteredCommandContract(activation.registrations, { command: 'lint repair', flags: ['--id', '--revision'] });
  const result = await runRegisteredCommandForTest(activation.commands, { command: 'lint repair', options: { id: item.id }, pmRoot });
  assert.equal(result.handled, true);
  assert.equal('exit_code' in (result.result as object), false);
  const ctx: CommandHandlerContext = { command: 'lint repair', args: [], options: {}, pm_root: pmRoot, global: {} };
  assert.equal((await runRepairCommand(ctx)).exit_code, 2);
  ctx.options = { id: [item.id], revision: undefined };
  assert.equal((await runRepairCommand(ctx)).ok, true);
  ctx.options = { id: [item.id, item.id] };
  assert.equal((await runRepairCommand(ctx)).exit_code, 2);
  await installBuiltExtension(pmRoot);
  for (const format of [[], ['--json']]) {
    const before = await inventory(pmRoot);
    const result = runGitFreeCli(root, pmRoot, ['lint', 'repair', '--id', item.id, ...format]);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /missing_expected_behavior/);
    assert.ok(Buffer.byteLength(result.stdout) < 4096);
    assert.equal(await inventory(pmRoot), before);
  }
  for (const args of [[], ['--id', item.id, '--revision', '0'.repeat(64)], ['--id', item.id, '--id', item.id]]) {
    const result = runGitFreeCli(root, pmRoot, ['lint', 'repair', '--json', ...args]);
    assert.equal(result.status, 2, result.stderr + result.stdout);
    assert.equal((JSON.parse(result.stdout) as { writes: number }).writes, 0);
  }
  await writeFile(getItemPath(pmRoot, item.type, item.id), 'broken item');
  ctx.options.id = item.id;
  await assert.rejects(runRepairCommand(ctx), /complete|parse|source|scan/i);
});

test('mechanical extraction uses native SDK defaults without inventing a blank title', () => {
  const base = { title: ' ', tags: [] } as unknown as ItemMetadata;
  assert.deepEqual(mechanicalRepairs(base), { findings: [], patch: {} });
});


test('unsafe source links refuse before SDK reads and preserve foreign files', async t => {
  const { pmRoot, root } = await tracker(t);
  await writeFile(join(root, 'foreign.txt'), 'foreign');
  await symlink(join(root, 'foreign.txt'), join(pmRoot, 'foreign-link'));
  await assert.rejects(previewAuthoringRepairs(pmRoot, { id: 'pm-example-unknown' }), refusal('unsafe_repair'));
  assert.equal(await readFile(join(root, 'foreign.txt'), 'utf8'), 'foreign');
});


test('read-only source permissions are preserved and scratch cleanup succeeds', async t => {
  const { client, pmRoot } = await tracker(t);
  const item = (await client.create({ title: 'Check read only source', type: 'Task' })).item;
  await seed(pmRoot, item);
  const directory = join(pmRoot, 'tasks');
  const file = getItemPath(pmRoot, item.type, item.id);
  await chmod(file, 0o400);
  await chmod(directory, 0o500);
  try {
    const before = await inventory(pmRoot);
    assert.equal((await previewAuthoringRepairs(pmRoot, { id: item.id })).validation?.validated, true);
    assert.equal(await inventory(pmRoot), before);
  } finally { await chmod(directory, 0o700); }
});


test('foreign runtime, journals, checkpoints, indexes and extensions are excluded with reasons', async t => {
  const { client, pmRoot, root } = await tracker(t);
  const item = (await client.create({ title: 'Observe foreign state safely', type: 'Task' })).item;
  const names = ['runtime', 'locks', 'extensions', 'transactions', 'checkpoints', 'search'];
  for (const name of names) {
    await mkdir(join(pmRoot, name), { recursive: true });
    await writeFile(join(pmRoot, name, 'foreign.json'), 'foreign partial record');
    await symlink(join(root, 'unavailable'), join(pmRoot, name, 'foreign-link'));
  }
  const result = await previewAuthoringRepairs(pmRoot, { id: item.id });
  assert.deepEqual(Object.keys(result.excluded_state).sort(), names.sort());
  for (const name of names) {
    assert.ok(result.excluded_state[name].length > 5);
    assert.equal(await readFile(join(pmRoot, name, 'foreign.json'), 'utf8'), 'foreign partial record');
  }
});


test('schema preflight refuses external bootstrap paths before SDK reads even without mechanical debt', async t => {
  const { client, pmRoot, root } = await tracker(t);
  const item = (await client.create({ title: 'Preserve external schema boundary', type: 'Task' })).item;
  const path = join(pmRoot, 'settings.json');
  const settings = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  const external = join(root, 'foreign-fields.json');
  for (const fields of ['../foreign-fields.json', external]) {
    settings.schema = { files: { fields } };
    await writeFile(path, JSON.stringify(settings));
    const before = await inventory(pmRoot);
    await assert.rejects(previewAuthoringRepairs(pmRoot, { id: item.id }), refusal('unsafe_repair'));
    await assert.rejects(stat(external), { code: 'ENOENT' });
    assert.equal(await inventory(pmRoot), before);
  }
});
