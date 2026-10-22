/** Stable diagnostic severities ordered from informational to gating errors. */
export type Severity = 'info' | 'warn' | 'error';
/** Stable authoring-quality rule identifiers. */
export type RuleCode = `PML00${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}` | 'PML010';
/**
 * Default lifecycle slice each rule judges.
 *
 * `non_terminal` and `active` both cover every item that is neither closed nor
 * canceled, so unfinished statuses such as blocked or draft keep being judged
 * while closed history stays silent. Single-status scopes and `terminal` exist
 * for settings overrides and `--status` selections.
 */
export type RuleScope = 'all' | 'non_terminal' | 'active' | 'terminal' | 'closed' | 'canceled' | 'open' | 'in_progress' | 'blocked';
/** One diagnostic with the offending context: the item title and a bounded excerpt. */
export interface Finding {
  /** Rule semantics version used to validate acknowledgment evidence. */
  rule_version: string;
  /** SHA-256 over the full canonical source item, never the bounded excerpt. */
  source_digest: string;
  /** Acknowledged findings stay in output but do not fail a baseline gate. */
  disposition: 'debt' | 'new';
  item_id: string;
  rule: RuleCode;
  severity: Severity;
  field: string;
  hint: string;
  /** Title of the offending item so agents do not need a follow-up read. */
  title: string;
  /** The offending text, at most 160 characters; empty when the rule flags an absence rather than text. */
  excerpt: string;
}
/** One rule's effective enablement, severity, judged lifecycle scope and numeric tuning parameters. */
export interface RuleConfig {
  enabled: boolean;
  severity: Severity;
  scope: RuleScope;
  parameters: Record<string, number>;
}
/** Fully resolved configuration consumed by the lint engine. */
export interface LintConfig {
  rules: Record<RuleCode, RuleConfig>;
  failOn: Severity;
}
