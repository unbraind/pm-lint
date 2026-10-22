import { resolve } from 'node:path';
import { PmClient, defineCommand } from '@unbrained/pm-cli/sdk';
import type { CommandHandlerContext, ExtensionApi } from '@unbrained/pm-cli/sdk/authoring';
import { lintWitnesses, readWitnessContract, WitnessRefusal } from './witnesses.ts';

/** Render typed refusals and let the host paginate evidence rows in TOON or JSON. */
export async function runWitnessCommand(ctx: CommandHandlerContext): Promise<Record<string, unknown>> {
  try {
    if (typeof ctx.options.contract !== 'string' || ctx.options.contract.trim() === '') throw new WitnessRefusal('invalid_contract', 'One --contract file is required.', 'Supply --contract criterion-witnesses.json; use an empty bindings array to audit undeclared proof.');
    const root = ctx.source_workspace_root ?? ctx.repo_root;
    if (typeof root !== 'string') throw new WitnessRefusal('invalid_contract', 'The evidence workspace is missing.', 'Run the command from a tracker workspace or supply the SDK evidence root.');
    const contract = await readWitnessContract(resolve(root, ctx.options.contract));
    const client = new PmClient({ cwd: root, pmRoot: ctx.pm_root, author: ctx.global.author, noExtensions: true });
    const { exit_code, ...result } = await lintWitnesses(client, contract, root);
    return { ...result, ...(exit_code === 0 ? {} : { exit_code }) };
  } catch (error) {
    if (!(error instanceof WitnessRefusal)) throw error;
    return { ok: false, findings: [], count: 0, refusal: { code: error.code, message: error.message, remedy: error.remedy }, exit_code: 2 };
  }
}

/** Register an observational command without linked-test execution or git discovery. */
export function registerWitnessCommand(api: ExtensionApi): void {
  api.registerCommand(defineCommand({ name: 'lint witnesses', description: 'Validate declared criterion witnesses without executing code', intent: 'Keep acceptance proof explicit, current and traceable', read_output: { row_keys: ['findings'] }, flags: [{ long: '--contract', value_name: 'file', value_type: 'string', description: 'Required version 1 JSON criterion-to-witness contract' }], examples: ['pm lint witnesses --contract criterion-witnesses.json --json'], run: runWitnessCommand }));
}
