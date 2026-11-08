import assert from 'node:assert/strict';
import { encode, decode } from '@toon-format/toon';
import { assertRepairReplay } from './repair-receipt.ts';
import test from 'node:test';
import { chmod, mkdir, readFile, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { certifyCompleteListResult, clearActiveExtensionHooks, getItemPath, getSettingsPath, readSettings, serializeItemDocument, setActiveExtensionHooks } from '@unbrained/pm-cli/sdk';
import type { ItemMetadata } from '@unbrained/pm-cli/sdk';
import { activateExtensionForTest, assertRegisteredCommandContract, runRegisteredCommandForTest } from '@unbrained/pm-cli/sdk/testing';
import type { CommandHandlerContext } from '@unbrained/pm-cli/sdk/authoring';
import { inventory } from './repair-inventory.ts';
import extension, { previewAuthoringRepairs, RepairRefusal } from '../index.ts';
import type { RepairBoundary, RepairRequest } from '../index.ts';
import { mechanicalRepairs } from '../src/repairs.ts';
import { runRepairCommand } from '../src/repair-command.ts';
import { installBuiltExtension, runGitFreeCli, tracker } from './helpers.ts';
import { RULES } from '../src/rules.ts';

/** Verify all refusal transport fields without dropping either renderer round trip. */
async function assertStaleRepairCommand(pmRoot: string, id: string): Promise<void> {
  const command = await runRepairCommand({ command: 'lint repair', args: [], options: { id }, pm_root: pmRoot, global: {} });
  assert.equal(command.ok, false);
  assert.equal((command.refusal as { code: string }).code, 'stale_revision');
  assert.equal(command.writes, 0);
  assert.equal(command.exit_code, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(command)), command);
  assert.deepEqual(decode(encode(command)), command);
}

/** Check the shared API and command fence together while retaining the authoritative inventory. */
async function assertBoundRepairRefusal(pmRoot: string, id: string, before: string): Promise<void> {
  await assert.rejects(previewAuthoringRepairs(pmRoot, { id }), refusal('stale_revision'));
  await assertStaleRepairCommand(pmRoot, id);
  assert.equal(await inventory(pmRoot), before);
}

/** Cover absent/default policy and every public rule control without duplicating the oracle. */
function repairPolicies(): unknown[] {
  return [undefined, {}, { failOn: 'warn' }, ...RULES.flatMap(rule => [
    { disable: [rule.code] }, { enable: [rule.code] },
    { rules: { [rule.code]: { enabled: false, severity: 'info', scope: 'all' } } },
  ]), { rules: { PML005: { parameters: { staleDays: 29 } }, PML010: { parameters: { threshold: 0.5 } } } }];
}

/** Exercise real asynchronous SDK hooks without allowing writes to the authoritative tracker. */
test('every repair policy must equal the settings policy bound into its plan digest', async t => {
  const { client, pmRoot } = await tracker(t);
  const item = (await client.create({ title: 'Bind policy to certified repair context', type: 'Task' })).item;
  const path = getSettingsPath(pmRoot);
  const settings = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  const policies = repairPolicies();
  t.after(clearActiveExtensionHooks);
  for (let index = 0; index < policies.length; index++) {
    const lint = policies[index];
    await writeFile(path, JSON.stringify({ ...settings, lint }));
    const before = await inventory(pmRoot);
    let calls = 0;
    const replacement = policies[(index + 1) % policies.length];
    setActiveExtensionHooks({ beforeCommand: [], beforeMutation: [], afterCommand: [], onWrite: [], onIndex: [], onRead: [{ layer: 'project', name: 'policy-interleaving', run: async context => {
      assert.notEqual(context.path, path, 'hooks may only mutate the disposable snapshot');
      if (context.path.endsWith('settings.json')) {
        calls++;
        await writeFile(context.path, JSON.stringify({ ...settings, lint: replacement }));
      }
    } }] });
    try {
      await assert.rejects(previewAuthoringRepairs(pmRoot, { id: item.id }), refusal('stale_revision'));
      await assertStaleRepairCommand(pmRoot, item.id);
      assert.equal(calls, 2, 'both SDK and command paths exercised the real hook');
      assert.equal(await inventory(pmRoot), before);
    } finally { clearActiveExtensionHooks(); }
  }
});

/** Every retained schema path must keep its pre-hook bytes, not just its settings reference. */
test('repair retained inputs bind every schema file before hooks and snapshot handoff', async t => {
  const { client, pmRoot } = await tracker(t);
  const item = (await client.create({ title: 'Bind authoritative schema file contents', type: 'Task' })).item;
  await seed(pmRoot, item);
  const settingsPath = getSettingsPath(pmRoot);
  const settings = JSON.parse(await readFile(settingsPath, 'utf8')) as Record<string, unknown>;
  const sections = ['types', 'statuses', 'fields', 'workflows'];
  t.after(clearActiveExtensionHooks);
  for (const custom of [false, true]) {
    const files = Object.fromEntries(sections.map(key => [key, `${custom ? 'retained' : 'schema'}/${key}.json`]));
    await mkdir(join(pmRoot, 'retained'), { recursive: true });
    for (const key of sections) await writeFile(join(pmRoot, files[key]), await readFile(join(pmRoot, 'schema', `${key}.json`)));
    await writeFile(settingsPath, JSON.stringify({ ...settings, schema: { files } }));
    for (const key of sections) {
      const file = files[key];
      const bytes = await readFile(join(pmRoot, file), 'utf8');
      const expected = await previewAuthoringRepairs(pmRoot, { id: item.id });
      assert.equal(expected.validation?.validated, true);
      // Schema formatting is semantically equivalent, but still cannot change during a preview.
      await writeFile(join(pmRoot, file), bytes + '\n');
      assert.equal((await previewAuthoringRepairs(pmRoot, { id: item.id })).plan_key, expected.plan_key);
      await writeFile(join(pmRoot, file), bytes);
      const before = await inventory(pmRoot);
      for (const remove of [false, true]) {
        let calls = 0;
        setActiveExtensionHooks({ beforeCommand: [], beforeMutation: [], afterCommand: [], onWrite: [], onIndex: [], onRead: [{ layer: 'project', name: 'schema-content-writer', run: async context => {
          assert.notEqual(context.path, settingsPath);
          if (context.path.endsWith('settings.json')) {
            calls++;
            const target = join(dirname(context.path), file);
            if (remove) await unlink(target);
            else await writeFile(target, bytes + '\n');
          }
        } }] });
        try {
          await assertBoundRepairRefusal(pmRoot, item.id, before);
          assert.equal(calls, 2);
        } finally { clearActiveExtensionHooks(); }
      }
      // A deferred edit after the section read must be fenced at the same handoff.
      let exposed = '';
      setActiveExtensionHooks({ beforeCommand: [], beforeMutation: [], afterCommand: [], onWrite: [], onIndex: [], onRead: [{ layer: 'project', name: 'remember-schema-root', run: async context => { exposed = dirname(context.path); } }] });
      try {
        await assert.rejects(previewAuthoringRepairs(pmRoot, { id: item.id }, { onBoundary: async step => {
          if (step === 'settings_read') await writeFile(join(exposed, file), bytes + '\n');
        } }), refusal('stale_revision'));
        assert.equal(await inventory(pmRoot), before);
      } finally { clearActiveExtensionHooks(); }
      // Missing referenced files are inputs too: hooks must not supply their replacement defaults.
      await unlink(join(pmRoot, file));
      const absent = await inventory(pmRoot);
      setActiveExtensionHooks({ beforeCommand: [], beforeMutation: [], afterCommand: [], onWrite: [], onIndex: [], onRead: [{ layer: 'project', name: 'create-missing-schema', run: async context => {
        await writeFile(join(dirname(context.path), file), bytes);
      } }] });
      try { await assertBoundRepairRefusal(pmRoot, item.id, absent); }
      finally { clearActiveExtensionHooks(); await writeFile(join(pmRoot, file), bytes); }
    }
  }
});

/** Schema semantics participate in the plan identity without binding irrelevant audit history. */
test('repair plan identity binds the effective schema independently of item revisions', async t => {
  const { client, pmRoot } = await tracker(t);
  const item = (await client.create({ title: 'Bind effective schema to certified repair context', type: 'Task' })).item;
  await seed(pmRoot, item);
  const expected = await previewAuthoringRepairs(pmRoot, { id: item.id });
  await writeFile(join(pmRoot, 'schema', 'types.json'), JSON.stringify({ definitions: [{ name: 'Proof', folder: 'proof' }] }));
  const before = await inventory(pmRoot);
  const result = await previewAuthoringRepairs(pmRoot, { id: item.id });
  assert.equal(result.revision, expected.revision);
  assert.deepEqual(result.patch, expected.patch);
  assert.equal(result.validation?.validated, true);
  assert.notEqual(result.plan_key, expected.plan_key);
  assert.equal(await inventory(pmRoot), before);
});

/** A section validated earlier cannot silently drift while copying into the private snapshot. */
test('repair copied lint policy must match every captured policy after the section read', async t => {
  const { client, pmRoot } = await tracker(t);
  const item = (await client.create({ title: 'Fence copied lint policy before private reads', type: 'Task' })).item;
  const path = getSettingsPath(pmRoot);
  const settings = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  const policies = repairPolicies();
  let exposed = '';
  t.after(clearActiveExtensionHooks);
  setActiveExtensionHooks({ beforeCommand: [], beforeMutation: [], afterCommand: [], onWrite: [], onIndex: [], onRead: [{ layer: 'project', name: 'remember-lint-root', run: async context => {
    assert.notEqual(context.path, path);
    exposed = context.path;
  } }] });
  for (let index = 0; index < policies.length; index++) {
    await writeFile(path, JSON.stringify({ ...settings, lint: policies[index] }));
    const before = await inventory(pmRoot);
    await assert.rejects(previewAuthoringRepairs(pmRoot, { id: item.id }, { onBoundary: async step => {
      if (step === 'settings_read') await writeFile(exposed, JSON.stringify({ ...settings, lint: policies[(index + 1) % policies.length] }));
    } }), refusal('stale_revision'));
    assert.equal(await inventory(pmRoot), before);
  }
});

/** Vary every SDK-recognized core input while keeping lint policy unchanged. */
test('every core setting must match captured repair settings before schema-dependent reads', async t => {
  const { client, pmRoot } = await tracker(t);
  const item = (await client.create({ title: 'Bind all core repair inputs', type: 'Task' })).item;
  const path = getSettingsPath(pmRoot);
  const settings = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  const core = await readSettings(pmRoot);
  const schemas = ['types', 'statuses', 'fields', 'workflows'].map(key => ({ ...settings, schema: { files: { [key]: `schema/alternate-${key}.json` } } }));
  const replacements = [...Object.keys(core).map(key => ({ ...settings, [key]: settings[key] === null ? false : null })), ...schemas, { ...settings, schema: { files: { fields: '../unfenced-fields.json' } } }];
  const before = await inventory(pmRoot);
  t.after(clearActiveExtensionHooks);
  for (const replacement of replacements) {
    let calls = 0;
    setActiveExtensionHooks({ beforeCommand: [], beforeMutation: [], afterCommand: [], onWrite: [], onIndex: [], onRead: [{ layer: 'project', name: 'core-settings-interleaving', run: async context => {
      assert.notEqual(context.path, path);
      if (context.path.endsWith('settings.json')) { calls++; await writeFile(context.path, JSON.stringify(replacement)); }
    } }] });
    try {
      const boundaries: RepairBoundary[] = [];
      await assert.rejects(previewAuthoringRepairs(pmRoot, { id: item.id }, { onBoundary: async step => { boundaries.push(step); } }), refusal('stale_revision'));
      assert.deepEqual(boundaries, replacement.schema === settings.schema ? ['snapshot_read', 'settings_read', 'settings_bound'] : ['snapshot_read', 'settings_read']);
      await assertStaleRepairCommand(pmRoot, item.id);
      assert.equal(calls, 2);
      assert.equal(await inventory(pmRoot), before);
    } finally { clearActiveExtensionHooks(); }
  }
});

/** A later hook cannot switch schema during reads or restore it after validation (ABA). */
test('repair schema remains isolated from later SDK hooks through planning and validation', async t => {
  const { client, pmRoot } = await tracker(t);
  const item = (await client.create({ title: 'Keep fenced schema stable', type: 'Task' })).item;
  await seed(pmRoot, item);
  const expected = await previewAuthoringRepairs(pmRoot, { id: item.id });
  assert.equal(expected.validation?.validated, true);
  const path = getSettingsPath(pmRoot);
  const settings = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  const before = await inventory(pmRoot);
  let calls = 0;
  t.after(clearActiveExtensionHooks);
  setActiveExtensionHooks({ beforeCommand: [], beforeMutation: [], afterCommand: [], onWrite: [], onIndex: [], onRead: [{ layer: 'project', name: 'late-schema-interleaving', run: async context => {
    assert.notEqual(context.path, path);
    if (context.path.endsWith('settings.json') && ++calls > 1) {
      await writeFile(context.path, JSON.stringify(calls % 2 === 0 ? { ...settings, schema: { files: { fields: 'schema/alternate-fields.json' } } } : settings));
    }
  } }] });
  try {
    assertRepairReplay(await previewAuthoringRepairs(pmRoot, { id: item.id }), expected);
    assert.equal(calls, 1, 'only the initial SDK section read runs external hooks');
    assert.equal(await inventory(pmRoot), before);
  } finally { clearActiveExtensionHooks(); }
});

/** Deferred writers retain only the exposed root; even ABA edits cannot affect later core reads. */
test('captured repair settings survive deferred ABA writes at every downstream boundary', async t => {
  const { client, pmRoot } = await tracker(t);
  const item = (await client.create({ title: 'Keep captured repair configuration', type: 'Task' })).item;
  await seed(pmRoot, item);
  const expected = await previewAuthoringRepairs(pmRoot, { id: item.id });
  const path = getSettingsPath(pmRoot);
  const settings = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  const core = await readSettings(pmRoot);
  const replacements = [{ ...settings, item_types: { definitions: [...core.item_types.definitions.filter(row => row.name !== item.type), { name: item.type, folder: 'alternate-items' }] } }, ...Object.keys(core).map(key => ({ ...settings, [key]: settings[key] === null ? false : null })), { ...settings, item_format: 'md' }, { ...settings, schema: { files: { fields: '../unfenced-fields.json' } } }];
  const before = await inventory(pmRoot);
  let exposedPath = '';
  let exposedBytes = '';
  t.after(clearActiveExtensionHooks);
  setActiveExtensionHooks({ beforeCommand: [], beforeMutation: [], afterCommand: [], onWrite: [], onIndex: [], onRead: [{ layer: 'project', name: 'deferred-settings-writer', run: async context => {
    assert.notEqual(context.path, path);
    if (context.path.endsWith('settings.json')) { exposedPath = context.path; exposedBytes = await readFile(context.path, 'utf8'); }
  } }] });
  try {
    const windows: [RepairBoundary, RepairBoundary][] = [['source_read', 'planned'], ['planned', 'validated'], ['validated', 'source_rechecked'], ['settings_bound', 'source_read']];
    for (const replacement of replacements) for (const [change, restore] of windows) {
      let changed = false;
      let restored = false;
      const result = await previewAuthoringRepairs(pmRoot, { id: item.id }, { onBoundary: async step => {
        if (step === change) { changed = true; await writeFile(exposedPath, JSON.stringify(replacement)); }
        if (step === restore) { restored = true; await writeFile(exposedPath, exposedBytes); }
      } });
      assert.equal(changed && restored, true, `${change} ABA injection completed`);
      assertRepairReplay(result, expected);
      assert.deepEqual(decode(encode(result)), result);
      assert.equal(await inventory(pmRoot), before);
    }
    t.diagnostic(`${replacements.length} core-setting variants across ${windows.length} downstream ABA windows`);
    // A non-restored write still invalidates the receipt rather than publishing mixed evidence.
    await assert.rejects(previewAuthoringRepairs(pmRoot, { id: item.id }, { onBoundary: async step => {
      if (step === 'planned') await writeFile(exposedPath, JSON.stringify({ ...settings, item_format: 'md' }));
    } }), refusal('stale_revision'));
    assert.equal(await inventory(pmRoot), before);
  } finally { clearActiveExtensionHooks(); }
});

/** Missing or malformed settings introduced after a successful SDK read cannot reach schema loading. */
test('repair settings recheck refuses removed and malformed captured documents', async t => {
  const { client, pmRoot } = await tracker(t);
  const item = (await client.create({ title: 'Reject replaced settings after section read', type: 'Task' })).item;
  const path = getSettingsPath(pmRoot);
  const before = await inventory(pmRoot);
  let snapshotPath = '';
  t.after(clearActiveExtensionHooks);
  setActiveExtensionHooks({ beforeCommand: [], beforeMutation: [], afterCommand: [], onWrite: [], onIndex: [], onRead: [{ layer: 'project', name: 'remember-settings-read', run: async context => {
    assert.notEqual(context.path, path);
    if (context.path.endsWith('settings.json')) snapshotPath = context.path;
  } }] });
  try {
    for (const bytes of [null, '{', '[]', 'null']) {
      await assert.rejects(previewAuthoringRepairs(pmRoot, { id: item.id }, { onBoundary: async step => {
        if (step === 'settings_read') {
          if (bytes === null) await unlink(snapshotPath);
          else await writeFile(snapshotPath, bytes);
        }
      } }), refusal('stale_revision'));
      assert.equal(await inventory(pmRoot), before);
    }
  } finally { clearActiveExtensionHooks(); }
});

/** Equivalent object order and independent settings are compatible; malformed captured bytes refuse. */
test('repair policy binding accepts equivalent sections and refuses replaced malformed documents', async t => {
  const { client, pmRoot } = await tracker(t);
  const item = (await client.create({ title: 'Keep compatible policy snapshots readable', type: 'Task' })).item;
  const path = getSettingsPath(pmRoot);
  const settings = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  const lint = { failOn: 'warn', rules: { PML002: { enabled: false, severity: 'info' } } };
  await writeFile(path, JSON.stringify({ ...settings, lint }));
  const expected = await previewAuthoringRepairs(pmRoot, { id: item.id });
  t.after(clearActiveExtensionHooks);
  setActiveExtensionHooks({ beforeCommand: [], beforeMutation: [], afterCommand: [], onWrite: [], onIndex: [], onRead: [{ layer: 'project', name: 'compatible-policy', run: async context => {
    assert.notEqual(context.path, path);
    if (context.path.endsWith('settings.json')) await writeFile(context.path, JSON.stringify({ ...settings, sibling: { preserved: true }, lint: { rules: { PML002: { severity: 'info', enabled: false } }, failOn: 'warn' } }));
  } }] });
  try {
    const before = await inventory(pmRoot);
    assertRepairReplay(await previewAuthoringRepairs(pmRoot, { id: item.id }), expected);
    assert.equal(await inventory(pmRoot), before);
    for (const bytes of ['{', 'null', '[]', '42', '"text"']) {
      await writeFile(path, bytes);
      const malformed = await inventory(pmRoot);
      await assert.rejects(previewAuthoringRepairs(pmRoot, { id: item.id }), refusal('stale_revision'));
      assert.equal(await inventory(pmRoot), malformed);
    }
  } finally { clearActiveExtensionHooks(); }
});

/** Seed surface debt that ordinary SDK authoring already normalizes away. */
async function seed(pmRoot: string, item: ItemMetadata, title = '  Verify observable behavior \r\n', tags = ['one', 'one', ' two ']): Promise<void> {
  const text = serializeItemDocument({ metadata: { ...item, title, tags }, body: 'Preserve body  \r\n\r\n' });
  await writeFile(getItemPath(pmRoot, item.type, item.id), text.replace(/^tags\[.*$/m, `tags[${tags.length}]: ${tags.map(tag => JSON.stringify(tag)).join(',')}`));
}

/** Check public refusal types and useful recovery advice. */
function refusal(code: string): (error: unknown) => boolean {
  return error => error instanceof RepairRefusal && error.code === code && error.remedy.length > 20;
}

/** Assert typed refusal and the full byte/name preservation invariant together. */
async function unchangedRefusal(pmRoot: string, id: string): Promise<void> {
  const before = await inventory(pmRoot);
  await assert.rejects(previewAuthoringRepairs(pmRoot, { id }), refusal('unsafe_repair'));
  assert.equal(await inventory(pmRoot), before);
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
  assertRepairReplay(await previewAuthoringRepairs(pmRoot, { id: item.id, revision: result.revision }), result);
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
  const boundaries: RepairBoundary[] = ['snapshot_read', 'settings_read', 'settings_bound', 'source_read', 'planned', 'validated', 'source_rechecked'];
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

test('core ownership refusal returns a typed remedy without bypassing a peer claim', async t => {
  const { client, pmRoot } = await tracker(t);
  const item = (await client.create({ title: 'Respect the owning peer', type: 'Task', assignee: 'peer-agent' })).item;
  await seed(pmRoot, item);
  const path = join(pmRoot, 'settings.json');
  const settings = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  settings.governance = { preset: 'custom', ownership_enforcement: 'strict' };
  await writeFile(path, JSON.stringify(settings));
  await unchangedRefusal(pmRoot, item.id);
  assert.equal((await client.get(item.id, { full: true })).item.assignee, 'peer-agent');
});


test('referenced schema cannot be silently dropped with excluded foreign operational state', async t => {
  const { client, pmRoot } = await tracker(t);
  const item = (await client.create({ title: 'Retain configured schema semantics', type: 'Task' })).item;
  const path = join(pmRoot, 'settings.json');
  const settings = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  delete settings.schema;
  await writeFile(path, JSON.stringify(settings));
  assert.equal((await previewAuthoringRepairs(pmRoot, { id: item.id })).writes, 0);
  settings.schema = { files: { fields: 42 } };
  await writeFile(path, JSON.stringify(settings));
  await assert.rejects(previewAuthoringRepairs(pmRoot, { id: item.id }), refusal('unsafe_repair'));
  for (const name of ['runtime', 'locks', 'extensions', 'transactions', 'checkpoints', 'search']) {
    await mkdir(join(pmRoot, name), { recursive: true });
    const file = join(pmRoot, name, 'fields.json');
    await writeFile(file, '{"fields":[]}');
    settings.schema = { files: { fields: `schema/../${name}/fields.json` } };
    await writeFile(path, JSON.stringify(settings));
    await unchangedRefusal(pmRoot, item.id);
    assert.equal(await readFile(file, 'utf8'), '{"fields":[]}');
  }
});

/** SDK receipts retain full fresh stage evidence and exactly match their JSON representation. */
test('staged repair validation is JSON-compatible without losing native records or metadata', async t => {
  const { client, pmRoot } = await tracker(t);
  const item = (await client.create({ title: 'Preserve native validation context', type: 'Issue', description: 'Preserved source description', assignee: 'fixture-owner' })).item;
  await seed(pmRoot, { ...item, comments: [{ author: 'fixture', created_at: item.created_at, text: 'Preserve native comment' }], files: [{ path: 'src/repairs.ts', scope: 'project' }] });
  const before = await inventory(pmRoot);
  const receipt = await previewAuthoringRepairs(pmRoot, { id: item.id });
  assert.deepEqual(JSON.parse(JSON.stringify(receipt)), receipt);
  assert.deepEqual(decode(encode(receipt)), receipt);
  assert.equal(receipt.validation?.records.length, 1);
  const record = receipt.validation!.records[0];
  assert.equal(record.id, item.id);
  assert.equal(record.op, 'update');
  assert.equal(record.execution, 'applied');
  assert.equal(record.item.title, receipt.patch.title);
  assert.deepEqual(record.item.tags, receipt.patch.tags);
  assert.equal(record.item.description, item.description);
  assert.equal(record.item.assignee, item.assignee);
  assert.equal(record.item.created_at, item.created_at);
  assert.equal(record.item.comments![0].text, 'Preserve native comment');
  assert.equal(record.item.files![0].path, 'src/repairs.ts');
  assert.ok(record.commit_time_fields.includes('/updated_at'));
  assert.equal(await inventory(pmRoot), before);
});
