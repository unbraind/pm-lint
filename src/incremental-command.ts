import { defineCommand } from '@unbrained/pm-cli/sdk';
import type { CommandHandlerContext, ExtensionApi } from '@unbrained/pm-cli/sdk/authoring';
import { IncrementalRefusal } from './incremental-contract.ts';
import { filesystemLintSource, lintIncrementalFile } from './incremental-file.ts';

/** Render the complete findings and constant-sized reuse receipt without exposing checkpoint internals. */
export async function runIncrementalCommand(ctx: CommandHandlerContext): Promise<Record<string, unknown>> {
  try {
    const path = ctx.options.state;
    if (typeof path !== 'string') throw new IncrementalRefusal('invalid_input', 'Exactly one state file is required.', 'Supply --state <file>; add --rebuild for the first scan or after an explicit rebuild refusal.');
    const scan = await lintIncrementalFile(filesystemLintSource(ctx.pm_root), path, ctx.options.rebuild === undefined ? false : ctx.options.rebuild as boolean);
    const { exit_code, ...result } = scan.result;
    return { ok: true, ...result, incremental: scan.incremental, ...(exit_code === 0 ? {} : { exit_code }) };
  } catch (error) {
    if (!(error instanceof IncrementalRefusal)) throw error;
    return { ok: false, refusal: { code: error.code, message: error.message, remedy: error.remedy }, exit_code: 2 };
  }
}

/** Register explicit checkpoint management separately from the existing time-selection command. */
export function registerIncrementalCommand(api: ExtensionApi): void {
  api.registerCommand(defineCommand({ name: 'lint incremental', description: 'Update a complete lint result using rule dependencies and SDK event cursors', read_output: { row_keys: ['findings'] }, flags: [
    { long: '--state', value_name: 'file', value_type: 'string', description: 'Required checkpoint file in an existing writable cache directory' },
    { long: '--rebuild', description: 'Explicitly rebuild after first use, cursor loss, rule version or policy drift' },
  ], examples: ['pm lint incremental --state lint.local.json --rebuild --json', 'pm lint incremental --state lint.local.json'], run: runIncrementalCommand }));
}
