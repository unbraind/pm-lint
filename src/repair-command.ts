import { defineCommand } from '@unbrained/pm-cli/sdk';
import type { CommandHandlerContext, ExtensionApi } from '@unbrained/pm-cli/sdk/authoring';
import { previewAuthoringRepairs, RepairRefusal } from './repairs.ts';

/** Render compact preview context and typed refusals using the host's TOON or JSON transport. */
export async function runRepairCommand(ctx: CommandHandlerContext): Promise<Record<string, unknown>> {
  try {
    const request = { id: scalar(ctx.options.id) as string, revision: scalar(ctx.options.revision) };
    return { ok: true, ...await previewAuthoringRepairs(ctx.pm_root, request) };
  } catch (error) {
    if (!(error instanceof RepairRefusal)) throw error;
    return { ok: false, refusal: { code: error.code, message: error.message, remedy: error.remedy }, writes: 0, exit_code: 2 };
  }
}

/** Register a single-item observational preview; successful questions do not signal a lint gate failure. */
export function registerRepairCommand(api: ExtensionApi): void {
  api.registerCommand(defineCommand({ name: 'lint repair', description: 'Preview revision-bound mechanical repairs and explicit author questions without writes', flags: [
    { long: '--id', value_name: 'id', value_type: 'string', description: 'Required canonical item id; previews one target' },
    { long: '--revision', value_name: 'sha256', value_type: 'string', description: 'Refuse unless the target still matches this observed revision' },
  ], examples: ['pm lint repair --id pm-example-abcd --json', 'pm lint repair --id pm-example-abcd --revision <sha256>'], run: runRepairCommand }));
}

/** Unwrap exactly one host flag occurrence; preserve invalid runtime values for request validation. */
function scalar(value: unknown): string | undefined {
  return (Array.isArray(value) && value.length === 1 ? value[0] : value) as string | undefined;
}
