import { defineExtension } from '@unbrained/pm-cli/sdk/authoring';
import type { ExtensionApi } from '@unbrained/pm-cli/sdk/authoring';
import { registerLintCommand } from './src/commands.ts';
import { registerWitnessCommand } from './src/witness-command.ts';
import { registerRepairCommand } from './src/repair-command.ts';
import { registerRulePackCommand } from './src/rule-pack-command.ts';
import { registerIncrementalCommand } from './src/incremental-command.ts';

/** Expose complete incremental scans using caller-injected native SDK capabilities. */
export { lintIncremental, incrementalRuleVersion } from './src/incremental.ts';
export type { IncrementalLintSource, IncrementalLintResult, IncrementalBoundary } from './src/incremental.ts';
/** Expose strict portable checkpoint contracts and dependency declarations. */
export { parseIncrementalCheckpoint, parseIncrementalRequest, IncrementalRefusal, INCREMENTAL_LIMITS, RULE_DEPENDENCIES } from './src/incremental-contract.ts';
export type { IncrementalCheckpoint, IncrementalRequest, IncrementalCursor, IncrementalItemState, IncrementalRefusalCode, RuleDependency } from './src/incremental-contract.ts';
/** Expose the optional local checkpoint adapter; hosted callers keep their own compare-and-set storage. */
export { filesystemLintSource, lintIncrementalFile, readIncrementalCheckpoint } from './src/incremental-file.ts';
export type { IncrementalFileBoundary } from './src/incremental-file.ts';
export type { LintStatusRegistry } from './src/statuses.ts';

/** Expose bounded revision-bound authoring previews and typed refusals. */
export { previewAuthoringRepairs, RepairRefusal } from './src/repairs.ts';
/** Expose mechanical patches and explicit author-question contracts. */
export type { RepairRequest, RepairPatch, RepairPreview, RepairQuestion, RepairRefusalCode, MechanicalFinding, RepairBoundary, RepairPreviewOptions } from './src/repairs.ts';

/** Expose portable organization rules, bounded parsing and typed recovery guidance. */
export { lintRulePack, parseRulePack, readRulePack, RulePackRefusal, RULE_PACK_FIELDS, RULE_PACK_LIMITS } from './src/rule-pack.ts';
/** Expose the versioned semantic contract and compact diagnostic receipt. */
export type { AuthoringPredicate, AuthoringRule, RulePack, RulePackFinding, RulePackResult, RulePackRefusalCode } from './src/rule-pack.ts';

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
  activate(api: ExtensionApi): void { registerLintCommand(api); registerWitnessCommand(api); registerRulePackCommand(api); registerRepairCommand(api); registerIncrementalCommand(api); },
});
