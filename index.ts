import { defineExtension } from '@unbrained/pm-cli/sdk/authoring';
import type { ExtensionApi } from '@unbrained/pm-cli/sdk/authoring';
import { registerLintCommand } from './src/commands.ts';
import { registerWitnessCommand } from './src/witness-command.ts';

/** Expose portable acceptance witness validation and strict contract parsing. */
export { lintWitnesses, parseWitnessContract, readWitnessContract, observationDigest, WitnessRefusal } from './src/witnesses.ts';
/** Expose explicit criterion, evidence, refusal and receipt contracts. */
export type { CriterionWitness, CriterionBinding, WitnessContract, WitnessState, WitnessFinding, WitnessResult, WitnessRefusalCode } from './src/witnesses.ts';

/** Expose portable evidence-backed baseline operations and typed refusals. */
export { acknowledgeFinding, BaselineRefusal, parseBaseline, RULE_VERSION, sourceDigest } from './src/baseline.ts';
/** Expose baseline contracts for agents using any tracker backend. */
export type { Acknowledgment, BaselineRefusalCode, LintBaseline } from './src/baseline.ts';

/** Expose the same complete-reader engine used by the host command. */
export { lintItems, SEVERITY_RANK } from './src/engine.ts';
/** Expose strict settings resolution for embedded consumers. */
export { resolveConfig, scopeValue, RULE_SCOPES } from './src/settings.ts';
/** Expose the documented stable authoring rule registry. */
export { RULES } from './src/rules.ts';
/** Expose diagnostic and configuration contracts without a second data model. */
export type { Finding, RuleCode, RuleScope, RuleConfig, LintConfig, Severity } from './src/types.ts';
/** Expose engine selection options to embedded callers. */
export type { LintOptions } from './src/settings.ts';
/** Expose the certified lint receipt contract. */
export type { LintResult } from './src/engine.ts';
/** Expose the rule table listing contract behind `pm lint rules`. */
export type { RuleListing, RulesResult } from './src/commands.ts';

/** Activate read-only item linting through the host command registry. */
export default defineExtension({
  name: 'pm-lint', version: '2026.10.13', description: 'Authoring-quality rules for useful pm context',
  /** Register one observational command; the package never mutates items. */
  activate(api: ExtensionApi): void { registerLintCommand(api); registerWitnessCommand(api); },
});
