import { resolve } from 'node:path';
import { PmClient, defineCommand } from '@unbrained/pm-cli/sdk';
import type { CommandHandlerContext, ExtensionApi } from '@unbrained/pm-cli/sdk/authoring';
import { lintParsedRulePack, readRulePack, RulePackRefusal } from './rule-pack.ts';
import { analyzeParsedRulePack } from './rule-pack-conflicts.ts';

/** Render bounded diagnostics and typed refusals through the host's TOON/JSON transport. */
export async function runRulePackCommand(ctx: CommandHandlerContext): Promise<Record<string, unknown>> {
  try {
    if (typeof ctx.options.pack !== 'string' || ctx.options.pack.trim() === '') throw new RulePackRefusal('invalid_pack', 'One --pack JSON file is required.', 'Supply --pack authoring-rules.json using the documented version 1 contract.');
    const root = ctx.source_workspace_root ?? ctx.repo_root;
    const pack = await readRulePack(resolve(root ?? '.', ctx.options.pack));
    if (ctx.command === 'lint conflicts') {
      const analysis = analyzeParsedRulePack(pack);
      return { ...analysis, ...(analysis.status === 'compatible' ? {} : { exit_code: analysis.status === 'conflict' ? 1 : 2 }) };
    }
    const client = ctx.sdk?.client ?? new PmClient({ cwd: root, pmRoot: ctx.pm_root, author: ctx.global.author, noExtensions: true });
    const { exit_code, ...result } = await lintParsedRulePack(client, pack);
    return { ...result, ...(exit_code === 0 ? {} : { exit_code }) };
  } catch (error) {
    return rulePackRefusalReceipt(error);
  }
}

/** Preserve infrastructure failures while rendering actionable pack refusals for agents. */
export function rulePackRefusalReceipt(error: unknown): Record<string, unknown> {
  if (!(error instanceof RulePackRefusal)) throw error;
  const refusal = { code: error.code, message: error.message, remedy: error.remedy, ...(error.witness === undefined ? {} : { witness: error.witness }) };
  return { ok: false, refusal, count: 0, findings: [], exit_code: 2 };
}

/** Register an observational command with host budgeting and no git dependency. */
export function registerRulePackCommand(api: ExtensionApi): void {
  api.registerCommand(defineCommand({ name: 'lint pack', description: 'Check organization authoring rules from a bounded version 1 JSON pack', intent: 'Apply portable semantic authoring checks without executing plugins', read_output: { row_keys: ['findings'] }, flags: [{ long: '--pack', value_name: 'file', value_type: 'string', description: 'Required version 1 declarative authoring rule pack' }], examples: ['pm lint pack --pack authoring-rules.json --json'], run: runRulePackCommand }));
  api.registerCommand(defineCommand({ name: 'lint conflicts', description: 'Explain the smallest conflicting rule set before applying a policy', intent: 'Analyze tag membership and integer bounds; disclose unsupported proofs as unknown', flags: [{ long: '--pack', value_name: 'file', value_type: 'string', description: 'Required declarative authoring rule pack' }], examples: ['pm lint conflicts --pack rules.json --json'], run: runRulePackCommand }));
}
