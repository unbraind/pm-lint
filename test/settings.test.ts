import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { getSettingsPath, isPmCliExpectedError, readSettingsSection, writeSettingsSection } from '@unbrained/pm-cli/sdk';
import { createExtensionTestHarness } from '@unbrained/pm-cli/sdk/testing';
import extension from '../index.ts';
import { lintItems } from '../src/engine.ts';
import { previewAuthoringRepairs, RepairRefusal } from '../src/repairs.ts';
import type { RepairBoundary } from '../src/repairs.ts';
import { objectValue, readLintSettings, resolveConfig, ruleCode, RULE_SCOPES, scopeValue, severityValue } from '../src/settings.ts';
import { installBuiltExtension, runGitFreeCli, tracker } from './helpers.ts';
import { decode } from '@toon-format/toon';
import { inventory } from './repair-inventory.ts';

/** Verify defaults, per-rule policy, explicit selections and severity overrides. */
test('settings precedence is defaults, persisted rules, then explicit CLI flags', () => {
  assert.equal(resolveConfig(undefined).failOn, 'error');
  assert.equal(resolveConfig(undefined).rules.PML005.severity, 'warn');
  assert.equal(resolveConfig(undefined).rules.PML004.scope, 'closed');
  assert.equal(resolveConfig(undefined).rules.PML001.scope, 'non_terminal');
  const config = resolveConfig({ enable: ['PML001'], disable: ['PML001', 'PML002'], failOn: 'warn', rules: { PML001: { enabled: true, severity: 'error' }, PML005: { parameters: { staleDays: 21 } }, PML010: { parameters: { threshold: 1 } }, PML004: { scope: 'all' } } });
  assert.equal(config.rules.PML001.enabled, true);
  assert.equal(config.rules.PML002.enabled, false);
  assert.equal(config.rules.PML001.severity, 'error');
  assert.equal(config.rules.PML005.parameters.staleDays, 21);
  assert.equal(config.rules.PML004.scope, 'all');
  assert.equal(config.failOn, 'warn');
  const overrides = resolveConfig({ disable: ['PML004'] }, { rule: ['PML004', 'PML005'], disable: ['PML005'], severity: 'info', failOn: 'info' });
  assert.equal(overrides.rules.PML004.enabled, true);
  assert.equal(overrides.rules.PML005.enabled, false);
  assert.equal(overrides.rules.PML001.enabled, false);
  assert.equal(overrides.rules.PML004.severity, 'info');
  assert.equal(overrides.failOn, 'info');
  assert.equal(resolveConfig({ rules: { PML006: { enabled: false, parameters: {} } } }).rules.PML006.enabled, false);
});

/** Refuse malformed policy so invalid CI configuration cannot become a silent pass. */
test('settings reject unknown codes, keys, values and parameter windows', () => {
  for (const value of [null, [], 'bad']) assert.throws(() => objectValue(value));
  assert.equal(severityValue('error'), 'error');
  assert.equal(severityValue('warn'), 'warn');
  assert.equal(severityValue('info'), 'info');
  assert.throws(() => severityValue('warning'));
  for (const scope of RULE_SCOPES) assert.equal(scopeValue(scope), scope);
  assert.throws(() => scopeValue('sometimes'));
  assert.throws(() => scopeValue(14));
  assert.throws(() => ruleCode('PML999'));
  const invalid: unknown[] = [{ bad: true }, { enable: 'PML001' }, { disable: ['PML999'] }, { rules: null }, { rules: { PML001: null } }, { rules: { PML001: { typo: true } } }, { rules: { PML001: { enabled: 'true' } } }, { rules: { PML001: { severity: 1 } } }, { rules: { PML001: { scope: 'sometimes' } } }, { rules: { PML005: { parameters: [] } } }];
  for (const raw of invalid) assert.throws(() => resolveConfig(raw));
  for (const number of ['14', 0, -1, Infinity, NaN]) assert.throws(() => resolveConfig({ rules: { PML005: { parameters: { staleDays: number } } } }));
  assert.throws(() => resolveConfig({ rules: { PML001: { parameters: { staleDays: 14 } } } }));
  assert.throws(() => resolveConfig({ rules: { PML005: { parameters: { typo: 14 } } } }));
  assert.throws(() => resolveConfig({ rules: { PML010: { parameters: { threshold: 1.01 } } } }));
  assert.throws(() => resolveConfig(undefined, { rule: ['PML999'] }));
  assert.throws(() => resolveConfig(undefined, { severity: 'fatal' }));
  assert.throws(() => resolveConfig(undefined, { failOn: 'fatal' }));
});

/** Missing documents use SDK section defaults, while full lint and repair operations refuse them. */
test('missing settings documents keep section defaults but refuse lint and repair operations', async t => {
  const { client, pmRoot } = await tracker(t);
  const item = (await client.create({ type: 'Task', title: 'Preserve missing settings refusal' })).item;
  const path = getSettingsPath(pmRoot);
  await unlink(path);
  assert.equal(await readLintSettings(pmRoot), undefined);
  await assert.rejects(lintItems(client, pmRoot));
  await assert.rejects(readFile(path), { code: 'ENOENT' });
  const before = await inventory(pmRoot);
  const boundaries: RepairBoundary[] = [];
  const refusal = { code: 'unsafe_repair', message: 'Tracker settings are missing.', remedy: 'Restore settings.json before requesting a preview.' };
  await assert.rejects(previewAuthoringRepairs(pmRoot, { id: item.id }, { onBoundary: async boundary => { boundaries.push(boundary); } }), error => error instanceof RepairRefusal && error.code === refusal.code && error.message === refusal.message && error.remedy === refusal.remedy);
  assert.deepEqual(boundaries, ['snapshot_read', 'settings_read']);
  const harness = await createExtensionTestHarness(extension, { capabilities: ['commands', 'schema'] });
  const command = await harness.runCommand({ command: 'lint repair', pmRoot, options: { id: item.id } });
  assert.deepEqual(command.result, { ok: false, refusal, writes: 0, exit_code: 2 });
  await assert.rejects(readFile(path), { code: 'ENOENT' });
  assert.equal(await inventory(pmRoot), before);
});

/** Preserve policy parity and independent core/sibling data in a real non-git tracker. */
test('SDK section reads share validated policy with the registered lint command', async t => {
  const previousExit = process.exitCode;
  t.after(() => { process.exitCode = previousExit; });
  const { client, pmRoot } = await tracker(t);
  const harness = await createExtensionTestHarness(extension, { capabilities: ['commands', 'schema'] });
  assert.equal(await readLintSettings(pmRoot), undefined);
  assert.equal(resolveConfig(await readLintSettings(pmRoot)).failOn, 'error');
  await client.schemaAddStatus('reviewing', { role: ['active'] });
  const item = (await client.create({ type: 'Task', title: 'TODO', status: 'reviewing' })).item;
  const lint = { disable: ['PML003'], failOn: 'info', rules: { PML001: { severity: 'info' }, PML005: { parameters: { staleDays: 30 } } } };
  await writeSettingsSection(pmRoot, 'lint', lint);
  await writeSettingsSection(pmRoot, 'sibling', { independent: ['value'], enabled: false });
  const before = await readFile(getSettingsPath(pmRoot), 'utf8');
  assert.deepEqual(await readLintSettings(pmRoot), lint);
  const config = resolveConfig(await readLintSettings(pmRoot));
  assert.equal(config.rules.PML003.enabled, false);
  assert.equal(config.rules.PML005.parameters.staleDays, 30);
  const direct = await lintItems(client, pmRoot);
  const command = await harness.runCommand({ command: 'lint', pmRoot });
  assert.deepEqual(command.result, direct);
  assert.ok(direct.findings.some(row => row.item_id === item.id && row.rule === 'PML001' && row.severity === 'info'));
  assert.equal(direct.exit_code, 1);
  const override = await harness.runCommand({ command: 'lint', pmRoot, options: { rule: ['PML001'], severity: 'error', failOn: 'error' } });
  assert.deepEqual(override.result, await lintItems(client, pmRoot, { rule: ['PML001'], severity: 'error', failOn: 'error' }));
  const overridden = override.result as Awaited<ReturnType<typeof lintItems>>;
  assert.deepEqual(overridden.findings.map(row => [row.item_id, row.rule, row.severity]), [[item.id, 'PML001', 'error']]);
  assert.equal(overridden.fail_on, 'error');
  assert.equal(overridden.exit_code, 1);
  assert.equal((await readSettingsSection(pmRoot, 'sibling')).value !== undefined, true);
  assert.equal(await readFile(getSettingsPath(pmRoot), 'utf8'), before);
  // A CLI override must never hide invalid persisted policy. Each invalid value
  // must be refused by the reader itself as well as the command and engine.
  for (const invalid of [null, [], 'bad', { typo: true }, { disable: ['PML999'] }, { rules: { PML005: { parameters: { staleDays: 0 } } } }]) {
    await writeSettingsSection(pmRoot, 'lint', invalid);
    const bytes = await readFile(getSettingsPath(pmRoot), 'utf8');
    const refused = (error: unknown): boolean => isPmCliExpectedError(error) && error.code === 'settings_section_invalid' && error.exitCode === 2;
    await assert.rejects(readLintSettings(pmRoot), refused);
    await assert.rejects(lintItems(client, pmRoot, { rule: ['PML001'] }), refused);
    await assert.rejects(previewAuthoringRepairs(pmRoot, { id: item.id }), refused);
    await assert.rejects(harness.runCommand({ command: 'lint', pmRoot, options: { rule: ['PML001'] } }), refused);
    assert.equal(await readFile(getSettingsPath(pmRoot), 'utf8'), bytes);
  }
});

/** Malformed persisted documents must refuse before an empty/default policy can run. */
test('SDK section reads give typed refusals for malformed settings documents', async t => {
  const { client, pmRoot } = await tracker(t);
  const item = (await client.create({ type: 'Task', title: 'Preserve malformed settings refusal' })).item;
  const harness = await createExtensionTestHarness(extension, { capabilities: ['commands', 'schema'] });
  for (const bytes of ['{', 'null', '[]', '"text"', '42']) {
    await writeFile(getSettingsPath(pmRoot), bytes);
    const refused = (error: unknown): boolean => isPmCliExpectedError(error) && error.code === 'settings_section_document_malformed' && error.exitCode === 2;
    await assert.rejects(readLintSettings(pmRoot), refused);
    await assert.rejects(lintItems(client, pmRoot), refused);
    await assert.rejects(previewAuthoringRepairs(pmRoot, { id: item.id }), refused);
    await assert.rejects(harness.runCommand({ command: 'lint', pmRoot }), refused);
    assert.equal(await readFile(getSettingsPath(pmRoot), 'utf8'), bytes);
  }
});

/** Exhaust the severity/threshold domain against literal expected findings on every public transport. */
test('explicit overrides defeat conflicting persisted settings on SDK and JSON/TOON commands without git', async t => {
  const { client, pmRoot, root } = await tracker(t);
  const item = (await client.create({ type: 'Task', title: 'Fix' })).item;
  await installBuiltExtension(pmRoot);
  const harness = await createExtensionTestHarness(extension, { capabilities: ['commands', 'schema'] });
  const severities = ['info', 'warn', 'error'] as const;
  for (const [rank, severity] of severities.entries()) for (const [threshold, failOn] of severities.entries()) {
    await writeSettingsSection(pmRoot, 'lint', { disable: ['PML001'], failOn: severities[(threshold + 1) % 3], rules: { PML001: { severity: severities[(rank + 1) % 3] } } });
    const options = { rule: ['PML001'], severity, failOn };
    const direct = await lintItems(client, pmRoot, options);
    const registered = (await harness.runCommand({ command: 'lint', pmRoot, options })).result;
    const results: unknown[] = [direct, registered];
    for (const format of ['json', 'toon']) {
      const command = runGitFreeCli(root, pmRoot, [...(format === 'json' ? ['--json'] : []), 'lint', '--rule', 'PML001', '--severity', severity, '--fail-on', failOn]);
      assert.equal(command.status, rank >= threshold ? 1 : 0, command.stderr);
      results.push(format === 'json' ? JSON.parse(command.stdout) : decode(command.stdout));
    }
    for (const raw of results) {
      const result = raw as Awaited<ReturnType<typeof lintItems>>;
      assert.deepEqual(result.findings.map(row => [row.item_id, row.rule, row.severity]), [[item.id, 'PML001', severity]]);
      assert.equal(result.fail_on, failOn);
      assert.equal(result.count, 1);
      assert.equal(result.exit_code ?? 0, rank >= threshold ? 1 : 0);
    }
  }
});
