/** Stable diagnostic severities ordered from informational to gating errors. */
export type Severity = 'info' | 'warn' | 'error';
/** Stable authoring-quality rule identifiers. */
export type RuleCode = `PML00${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}` | 'PML010';
/** One privacy-conscious finding, deliberately excluding source item text. */
export interface Finding {
  item_id: string;
  rule: RuleCode;
  severity: Severity;
  field: string;
  hint: string;
}
/** One rule's effective enablement, severity and numeric tuning parameters. */
export interface RuleConfig {
  enabled: boolean;
  severity: Severity;
  parameters: Record<string, number>;
}
/** Fully resolved configuration consumed by the lint engine. */
export interface LintConfig {
  rules: Record<RuleCode, RuleConfig>;
  failOn: Severity;
}
