import assert from 'node:assert/strict';
import test from 'node:test';
import { isHostOutputSuppressed } from '@unbrained/pm-cli/sdk';
import { activateExtensionForTest, runRegisteredCommandForTest } from '@unbrained/pm-cli/sdk/testing';
import type { CommandHandlerContext } from '@unbrained/pm-cli/sdk/authoring';
import extension from '../index.ts';
import { listFlag, runLintCommand } from '../src/commands.ts';
import { tracker } from './helpers.ts';

/** Exercise actual extension activation and dispatch with a real tracker. */
test('host activation exposes repeatable flags and preserves lint receipt exit status', async t => {
  const previousExit = process.exitCode;
  t.after(/** SDK host exit control is process-global even in its testing dispatcher. */ () => { process.exitCode = previousExit; });
  const { client, pmRoot } = await tracker(t);
  const item = (await client.create({ title: 'TODO', type: 'Task' })).item;
  const activation = await activateExtensionForTest(extension, { name: 'pm-lint', capabilities: ['commands', 'schema'] });
  assert.deepEqual(activation.failed, []);
  assert.equal(activation.commands.handlers.length, 1);
  const result = await runRegisteredCommandForTest(activation.commands, { command: 'lint', args: [], options: { rule: ['PML001'], id: [item.id], failOn: 'warn' }, pmRoot });
  assert.equal(result.handled, true);
  assert.equal((result.result as { exit_code: number }).exit_code, 1);
  const clean = await runRegisteredCommandForTest(activation.commands, { command: 'lint', options: { rule: ['PML010'] }, pmRoot });
  assert.equal('exit_code' in (clean.result as object), false);
  assert.equal(isHostOutputSuppressed(clean.result), true);
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
