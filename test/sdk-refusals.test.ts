import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isPmCliExpectedError } from '@unbrained/pm-cli/sdk';
import { activateExtensionForTest, runRegisteredCommandForTest } from '@unbrained/pm-cli/sdk/testing';
import extension, { BaselineRefusal } from '../index.ts';
import { throwBaselineRefusal } from '../src/commands.ts';
import { installBuiltExtension, runGitFreeCli, tracker } from './helpers.ts';

/** Native errors retain domain guidance without copying arbitrary exception properties. */
test('baseline refusal adapter throws the SDK expected error with sanitized context', () => {
  const source = Object.assign(new BaselineRefusal('evidence_changed', 'Finding evidence changed since observation.', 'Run lint again.'), { path: 'private-coordinate', input: 'private-input', cause: new Error('private-cause') });
  assert.throws(() => throwBaselineRefusal(source), error => {
    assert.ok(isPmCliExpectedError(error));
    assert.equal(error.exitCode, 2);
    assert.equal(error.code, source.code);
    assert.equal(error.message, source.message);
    assert.deepEqual(error.context, { code: source.code, nextSteps: [source.remedy] });
    assert.equal('cause' in error, false);
    assert.doesNotMatch(JSON.stringify(error), /private-/);
    return true;
  });
  const unexpected = new Error('unrelated failure');
  assert.throws(() => throwBaselineRefusal(unexpected), error => error === unexpected);
});

/** Dispatch must propagate expected errors rather than turn refusals into successful command results. */
test('registered baseline handlers propagate native expected errors for lint and acknowledgment', async t => {
  const { pmRoot, root } = await tracker(t);
  const baseline = join(root, 'baseline.json');
  await writeFile(baseline, '{');
  const activation = await activateExtensionForTest(extension, { name: 'pm-lint', capabilities: ['commands', 'schema'] });
  for (const [command, options, code] of [
    ['lint', { baseline }, 'invalid_baseline'],
    ['lint acknowledge', {}, 'invalid_acknowledgment'],
  ] as const) {
    await assert.rejects(runRegisteredCommandForTest(activation.commands, { command, options, pmRoot }), error => isPmCliExpectedError(error) && error.code === code && error.exitCode === 2 && (error.context.nextSteps?.length ?? 0) > 0);
  }
});

/** Exercise real host rendering, privacy and nonzero exits with no git executable or repository. */
test('native baseline refusals keep code and remedy in git-free CLI diagnostics', async t => {
  const { pmRoot, root } = await tracker(t);
  await installBuiltExtension(pmRoot);
  const baseline = join(root, 'baseline.json');
  await writeFile(baseline, '{"private-input":');
  for (const format of [[], ['--json']]) {
    for (const [args, code, message, remedy] of [
      [['lint', '--baseline', 'baseline.json'], 'invalid_baseline', 'Baseline is not valid JSON.', 'Restore a valid baseline document before retrying.'],
      [['lint', 'acknowledge'], 'invalid_acknowledgment', 'All acknowledgment flags are required.', 'Supply --baseline, --id, --rule, --reason, --rule-version and --source-digest from a fresh lint result.'],
    ] as const) {
      const result = runGitFreeCli(root, pmRoot, [...args, ...format]);
      assert.equal(result.status, 2, result.stderr);
      assert.equal(result.stdout, '', 'refusals are native error diagnostics');
      if (format.length > 0) {
        const diagnostic = JSON.parse(result.stderr) as { code: string; exit_code: number; next_steps: string[] };
        assert.equal(diagnostic.code, code);
        assert.equal(diagnostic.exit_code, 2);
        assert.deepEqual(diagnostic.next_steps, [remedy]);
      }
      assert.ok(result.stderr.includes(message), result.stderr);
      assert.ok(result.stderr.includes(remedy), result.stderr);
      assert.doesNotMatch(result.stderr, /private-input|extension_command_handler_failed/);
      assert.equal(result.stderr.includes(root), false);
    }
  }
  assert.equal(await readFile(baseline, 'utf8'), '{"private-input":');
});
