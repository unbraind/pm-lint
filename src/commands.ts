import { PmClient, printResult, suppressHostOutput } from '@unbrained/pm-cli/sdk';
import { defineCommand } from '@unbrained/pm-cli/sdk/authoring';
import type { CommandHandlerContext, ExtensionApi, FlagDefinition } from '@unbrained/pm-cli/sdk/authoring';
import { lintItems } from './engine.ts';
import type { LintResult } from './engine.ts';
import type { LintOptions } from './settings.ts';

/** Normalize repeated host flags, preserving every occurrence and rejecting invalid values. */
export function listFlag(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  const values = Array.isArray(value) ? value : [value];
  if (values.some(/** Every occurrence must carry a nonempty atomic value. */ entry => typeof entry !== 'string' || entry.trim() === '')) throw new Error('Expected nonempty lint flag values');
  return values as string[];
}

/** Validate scalar flags before passing them to the shared engine. */
function scalarFlag(value: unknown): string | undefined {
  const values = listFlag(value);
  if (values === undefined) return undefined;
  if (values.length !== 1) throw new Error('Lint scalar flags accept one value');
  return values[0];
}

/** Execute through a tracker-bound SDK client and let the host render TOON or JSON. */
export async function runLintCommand(ctx: CommandHandlerContext): Promise<LintResult> {
  const options: LintOptions = { rule: listFlag(ctx.options.rule), disable: listFlag(ctx.options.disable), id: listFlag(ctx.options.id), severity: scalarFlag(ctx.options.severity), failOn: scalarFlag(ctx.options.failOn), type: scalarFlag(ctx.options.type), status: scalarFlag(ctx.options.status), since: scalarFlag(ctx.options.since) };
  const client = new PmClient({ cwd: ctx.source_workspace_root ?? ctx.repo_root, pmRoot: ctx.pm_root, author: ctx.global.author, noExtensions: true });
  return lintItems(client, ctx.pm_root, options);
}

/** Render the complete receipt while adapting the host's nonzero-only exit control contract. */
export async function renderLintCommand(ctx: CommandHandlerContext): Promise<Record<string, unknown>> {
  const result = await runLintCommand(ctx);
  printResult(result, ctx.global);
  const { exit_code, ...receipt } = result;
  return { ...suppressHostOutput(receipt), ...(exit_code === 0 ? {} : { exit_code }) };
}

/** Register repeatable selection flags and the native renderer/exit contract. */
export function registerLintCommand(api: ExtensionApi): void {
  const flags: FlagDefinition[] = [
    ...['rule', 'disable', 'id'].map(/** Ordered accumulation preserves repeated rule and item selections. */ name => ({ long: `--${name}`, value_name: 'value', value_type: 'string' as const, repeatable: true, description: `Repeatable ${name} selection` })),
    ...['severity', 'fail-on', 'type', 'status', 'since'].map(/** Scalar overrides use the host's canonical camel-case option keys. */ name => ({ long: `--${name}`, value_name: 'value', value_type: 'string' as const, description: `Override ${name}` })),
  ];
  api.registerCommand(defineCommand({ name: 'lint', description: 'Lint item authoring quality across a certified complete tracker', intent: 'Project management = context management: make every item useful agent context', flags, examples: ['pm lint --fail-on warn', 'pm lint --rule PML002 --rule PML004 --json'], run: renderLintCommand }));
}
