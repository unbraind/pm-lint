import assert from 'node:assert/strict';
import test from 'node:test';
import { activateExtensionForTest, assertRegisteredCommandContract, runRegisteredCommandForTest } from '@unbrained/pm-cli/sdk/testing';
import type { CommandHandlerContext } from '@unbrained/pm-cli/sdk/authoring';
import extension from '../index.ts';
import { listFlag, runLintCommand, runLintRulesCommand } from '../src/commands.ts';
import type { RulesResult } from '../src/commands.ts';
import type { LintResult } from '../src/engine.ts';
import { tracker } from './helpers.ts';

/** Exercise actual extension activation and dispatch with a real tracker. */
test('host activation exposes lint commands and preserves lint receipt exit status', async t => {
  const previousExit = process.exitCode;
  t.after(/** SDK host exit control is process-global even in its testing dispatcher. */ () => { process.exitCode = previousExit; });
  const { client, pmRoot } = await tracker(t);
  const item = (await client.create({ title: 'TODO', type: 'Task' })).item;
  const activation = await activateExtensionForTest(extension, { name: 'pm-lint', capabilities: ['commands', 'schema'] });
  assert.deepEqual(activation.failed, []);
  assert.equal(activation.commands.handlers.length, 5);
  const lint = assertRegisteredCommandContract(activation.registrations, { command: 'lint', flags: ['--rule', '--disable', '--id', '--severity', '--fail-on', '--type', '--status', '--since'] });
  for (const flag of lint.flags) {
    assert.ok((flag.description ?? '').length > 0, `${flag.long} carries a help description`);
    assert.ok(!/^Override (?:type|status|severity|fail-on|since)$/.test(flag.description ?? ''), `${flag.long} does not print a generic override label`);
  }
  const rules = assertRegisteredCommandContract(activation.registrations, { command: 'lint rules', flags: [] });
  assert.deepEqual(lint.command.read_output?.row_keys, ['findings'], 'the lint command declares its findings rows for host shaping');
  assert.deepEqual(rules.command.read_output?.row_keys, ['rules'], 'the rules command declares its rule rows for host shaping');
  const result = await runRegisteredCommandForTest(activation.commands, { command: 'lint', args: [], options: { rule: ['PML001'], id: [item.id], failOn: 'warn' }, pmRoot });
  assert.equal(result.handled, true);
  const receipt = result.result as LintResult;
  assert.equal(receipt.exit_code, 1);
  assert.equal(receipt.count, 1);
  assert.equal(receipt.findings[0].title, 'TODO', 'findings carry the offending title');
  assert.equal(receipt.findings[0].excerpt, 'TODO', 'PML001 excerpts the offending title');
  assert.deepEqual(receipt.summary.PML001, { info: 0, warn: 1, error: 0 });
  assert.equal(receipt.summary.PML002.warn, 0);
  const clean = await runRegisteredCommandForTest(activation.commands, { command: 'lint', options: { rule: ['PML010'] }, pmRoot });
  const cleanReceipt = clean.result as LintResult;
  assert.equal('exit_code' in cleanReceipt, false);
  assert.equal(cleanReceipt.summary.PML010.warn, 0);
  const listed = await runRegisteredCommandForTest(activation.commands, { command: 'lint rules', pmRoot });
  const listing = listed.result as RulesResult;
  assert.equal(listing.count, 10);
  assert.equal(listed.handled, true);
  assert.deepEqual(Object.keys(listing.rules[0]), ['code', 'severity', 'scope', 'field', 'description', 'hint', 'settings']);
  assert.equal(listing.rules[0].settings, 'lint.rules.PML001');
});

/** The rule table listing is static, complete and independent of tracker state. */
test('the rules command lists every documented rule with its defaults', async () => {
  const listing = await runLintRulesCommand();
  assert.equal(listing.count, listing.rules.length);
  assert.deepEqual(listing.rules.map(entry => entry.code), ['PML001', 'PML002', 'PML003', 'PML004', 'PML005', 'PML006', 'PML007', 'PML008', 'PML009', 'PML010']);
  for (const rule of listing.rules) {
    assert.ok(['info', 'warn', 'error'].includes(rule.severity), `${rule.code} lists a severity`);
    assert.ok(rule.scope.length > 0, `${rule.code} lists a scope`);
    assert.ok(rule.field.length > 0, `${rule.code} lists a field`);
    assert.ok(rule.description.length > 0, `${rule.code} lists a description`);
    assert.ok(rule.settings === `lint.rules.${rule.code}`, `${rule.code} lists its settings key`);
  }
});

/** Scalar and repeated selections must not silently ignore host values. */
test('flag normalization refuses nonstrings and empty occurrences', () => {
  assert.equal(listFlag(undefined), undefined);
  assert.deepEqual(listFlag('PML001'), ['PML001']);
  assert.deepEqual(listFlag(['PML001', 'PML002']), ['PML001', 'PML002']);
  for (const value of [false, 1, '', '  ', ['PML001', 2]]) assert.throws(() => listFlag(value));
});

/** Both host workspace coordinates and global JSON route to the same observational engine. */
test('command validates scalar options and uses source or repository workspace coordinates', async t => {
  const { client, root, pmRoot } = await tracker(t);
  await client.create({ title: 'TODO', type: 'Feature' });
  const ctx: CommandHandlerContext = { command: 'lint', args: [], options: { rule: ['PML001'], severity: 'warn', failOn: 'warn', type: 'Feature', status: 'open', since: '2000-01-01' }, pm_root: pmRoot, source_workspace_root: root, global: { json: true, author: 'lint-test' } };
  assert.equal((await runLintCommand(ctx)).exit_code, 1);
  delete ctx.source_workspace_root;
  ctx.repo_root = root;
  ctx.options = { disable: ['PML010'], severity: ['info'] };
  assert.equal((await runLintCommand(ctx)).exit_code, 0);
  ctx.options = { failOn: ['warn', 'error'] };
  await assert.rejects(runLintCommand(ctx), /one value/);
});
