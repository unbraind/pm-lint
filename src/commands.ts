import type { PmClient } from '@unbrained/pm-cli/sdk';
import { PmClient as PmClientCtor, createPmCliExpectedError, defineCommand } from '@unbrained/pm-cli/sdk';
import type { CommandHandlerContext, ExtensionApi, FlagDefinition } from '@unbrained/pm-cli/sdk/authoring';
import { RULES } from './rules.ts';
import type { Rule } from './rules.ts';
import { lintItems } from './engine.ts';
import type { LintResult } from './engine.ts';
import type { LintOptions } from './settings.ts';
import { BaselineRefusal } from './baseline.ts';
import type { Acknowledgment } from './baseline.ts';
import { acknowledgeBaselineFile, readBaseline } from './baseline-file.ts';
import { resolve } from 'node:path';

/** One rule as listed by `pm lint rules`, with its defaults and settings key. */
export interface RuleListing {
  code: Rule['code'];
  severity: Rule['severity'];
  scope: Rule['scope'];
  field: string;
  description: string;
  hint: string;
  settings: string;
}

/** The stable rule table `pm lint rules` returns for agents and CI configuration. */
export interface RulesResult {
  rules: RuleListing[];
  count: number;
}

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

/** Refuse malformed acknowledgment flags with the same typed remedy as missing evidence. */
function acknowledgmentFlag(value: unknown): string | undefined {
  try { return scalarFlag(value); } catch {
    throw new BaselineRefusal('invalid_acknowledgment', 'Acknowledgment flags require one nonempty string each.', 'Supply each acknowledgment flag exactly once with the observed evidence and a reason.');
  }
}

/** Execute through a tracker-bound SDK client and let the host render TOON or JSON. */
export async function runLintCommand(ctx: CommandHandlerContext): Promise<LintResult> {
  const options: LintOptions = { rule: listFlag(ctx.options.rule), disable: listFlag(ctx.options.disable), id: listFlag(ctx.options.id), severity: scalarFlag(ctx.options.severity), failOn: scalarFlag(ctx.options.failOn), type: scalarFlag(ctx.options.type), status: scalarFlag(ctx.options.status), since: scalarFlag(ctx.options.since) };
  const baseline = scalarFlag(ctx.options.baseline);
  if (baseline !== undefined) options.baseline = await readBaseline(resolve(baseline));
  const client: PmClient = new PmClientCtor({ cwd: ctx.source_workspace_root ?? ctx.repo_root, pmRoot: ctx.pm_root, author: ctx.global.author, noExtensions: true });
  return lintItems(client, ctx.pm_root, options);
}

/** Render the complete receipt while adapting the host's nonzero-only exit control contract. */
export async function renderLintCommand(ctx: CommandHandlerContext): Promise<Record<string, unknown>> {
  try {
    const result = await runLintCommand(ctx);
    const { exit_code, ...receipt } = result;
    return { ...receipt, ...(exit_code === 0 ? {} : { exit_code }) };
  } catch (error) { throwBaselineRefusal(error); }
}

/** Delegate expected refusals to the host with only domain diagnostics, never input or I/O context. */
export function throwBaselineRefusal(error: unknown): never {
  if (!(error instanceof BaselineRefusal)) throw error;
  throw createPmCliExpectedError(error.message, { context: { code: error.code, nextSteps: [error.remedy] } });
}

/** Acknowledge one freshly observed finding without modifying any tracker item. */
export async function runAcknowledgeCommand(ctx: CommandHandlerContext): Promise<Record<string, unknown>> {
  try {
    const fields = ['baseline', 'id', 'rule', 'reason', 'ruleVersion', 'sourceDigest'] as const;
    const values = fields.map(/** Acknowledgment operands are singular and explicit. */ field => acknowledgmentFlag(ctx.options[field]));
    if (values.some(/** Omitted evidence never triggers implicit bulk acknowledgment. */ value => value === undefined)) throw new BaselineRefusal('invalid_acknowledgment', 'All acknowledgment flags are required.', 'Supply --baseline, --id, --rule, --reason, --rule-version and --source-digest from a fresh lint result.');
    const [path, itemId, rule, reason, ruleVersion, digest] = values as string[];
    const request = { item_id: itemId, rule, reason, rule_version: ruleVersion, source_digest: digest } as Acknowledgment;
    const client = new PmClientCtor({ cwd: ctx.source_workspace_root ?? ctx.repo_root, pmRoot: ctx.pm_root, author: ctx.global.author, noExtensions: true });
    const result = await lintItems(client, ctx.pm_root, { baseline: { version: 1, acknowledgments: [] } });
    const baseline = await acknowledgeBaselineFile(resolve(path), result.findings, request);
    return { ok: true, acknowledgment: request, acknowledgment_count: baseline.acknowledgments.length };
  } catch (error) { throwBaselineRefusal(error); }
}

/** Describe the documented rule table without reading tracker state. */
export async function runLintRulesCommand(): Promise<RulesResult> {
  const rules = RULES.map(/** Every listed field comes from the stable rule registry. */ rule => ({ code: rule.code, severity: rule.severity, scope: rule.scope, field: rule.field, description: rule.description, hint: rule.hint, settings: `lint.rules.${rule.code}` }));
  return { rules, count: rules.length };
}

/** Register the lint commands with their selection flags and read-output declarations. */
export function registerLintCommand(api: ExtensionApi): void {
  const flags: FlagDefinition[] = [
    { long: '--baseline', value_name: 'file', value_type: 'string', description: 'Check a baseline against all default rules; every new finding fails' },
    ...['rule', 'disable', 'id'].map(/** Ordered accumulation preserves repeated rule and item selections. */ name => ({ long: `--${name}`, value_name: 'value', value_type: 'string' as const, repeatable: true, description: { rule: 'Run only these rule codes; repeatable, and re-enables rules disabled in settings', disable: 'Skip these rule codes for this run; repeatable, and wins over --rule', id: 'Lint only these item ids; repeatable, and every id must exist in the tracker' }[name] })),
    ...(['severity', 'fail-on', 'type', 'status', 'since'] as const).map(/** Scalar overrides use the host's canonical camel-case option keys. */ name => ({ long: `--${name}`, value_name: 'value', value_type: 'string' as const, description: { severity: 'Override the severity of every enabled rule (info|warn|error)', 'fail-on': 'Lowest severity that fails the run (info|warn|error); default error', type: 'Lint only items of this SDK item type (for example Feature)', status: 'Lint only items in these comma-separated statuses and judge every rule on them', since: 'Lint only items updated on or after this calendar date or zoned ISO timestamp' }[name] })),
  ];
  api.registerCommand(defineCommand({ name: 'lint', read_output: { row_keys: ['findings'] }, description: 'Lint item authoring quality across a certified complete tracker', intent: 'Project management = context management: make every item useful agent context', flags, examples: ['pm lint --fail-on warn', 'pm lint --rule PML002 --rule PML004 --json', 'pm lint --status open,in_progress'], run: renderLintCommand }));
  api.registerCommand(defineCommand({ name: 'lint rules', read_output: { row_keys: ['rules'] }, description: 'List the lint rule table: codes, default severities, default scopes, fields, descriptions and settings keys', intent: 'Project management = context management: know which authoring rules a tracker enforces', examples: ['pm lint rules --json'], run: async () => runLintRulesCommand() }));
  api.registerCommand(defineCommand({ name: 'lint acknowledge', description: 'Acknowledge one exact lint finding with reason, rule version and source digest', flags: ['baseline', 'id', 'rule', 'reason', 'rule-version', 'source-digest'].map(/** Every acknowledgment flag accepts one explicit string value. */ name => ({ long: `--${name}`, value_name: 'value', value_type: 'string' as const, description: `Required ${name} for one observed finding` })), examples: ['pm lint acknowledge --baseline lint-baseline.json --id pm-example-abcd --rule PML002 --reason "Legacy debt scheduled for repair" --rule-version 1 --source-digest <digest>'], run: runAcknowledgeCommand }));
}
