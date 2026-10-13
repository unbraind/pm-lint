import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { getSettingsPath } from '@unbrained/pm-cli/sdk';
import { lintSettingsFromText, objectValue, readLintSettings, resolveConfig, ruleCode, RULE_SCOPES, scopeValue, severityValue } from '../src/settings.ts';
import { tracker } from './helpers.ts';

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
  assert.throws(() => lintSettingsFromText(null), /disappeared/);
  assert.throws(() => lintSettingsFromText('{'), /JSON/);
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

/** Reproduce the SDK custom-section gap using real tracker settings bytes. */
test('SDK storage helpers preserve a custom lint section for validated settings', async t => {
  const { pmRoot } = await tracker(t);
  assert.equal(await readLintSettings(pmRoot), undefined);
  const path = getSettingsPath(pmRoot);
  const raw: Record<string, unknown> = JSON.parse(await readFile(path, 'utf8'));
  raw.lint = { disable: ['PML003'], rules: { PML005: { parameters: { staleDays: 30 } } } };
  await writeFile(path, JSON.stringify(raw));
  const config = resolveConfig(await readLintSettings(pmRoot));
  assert.equal(config.rules.PML003.enabled, false);
  assert.equal(config.rules.PML005.parameters.staleDays, 30);
});
