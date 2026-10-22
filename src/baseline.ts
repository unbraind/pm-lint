import { createHash } from 'node:crypto';
import type { ItemMetadata } from '@unbrained/pm-cli/sdk';
import type { Finding, LintConfig, RuleCode } from './types.ts';
import type { LintOptions } from './settings.ts';

/** Increment whenever built-in rule semantics or source evidence changes. */
export const RULE_VERSION = '1';

/** One explicit acknowledgment; no wildcards, excerpts or rule-wide exceptions. */
export interface Acknowledgment {
  item_id: string;
  rule: RuleCode;
  rule_version: string;
  source_digest: string;
  reason: string;
}

/** Portable, reviewable baseline document, independent of tracker storage and git. */
export interface LintBaseline {
  version: 1;
  acknowledgments: Acknowledgment[];
}

/** Stable refusal codes shared by SDK exceptions and CLI receipts. */
export type BaselineRefusalCode = 'invalid_baseline' | 'unsafe_policy' | 'invalid_acknowledgment' | 'evidence_changed' | 'baseline_io' | 'baseline_busy';

/** Actionable typed refusal without leaking source text or filesystem details. */
export class BaselineRefusal extends Error {
  /** Machine-readable refusal category. */
  readonly code: BaselineRefusalCode;
  /** Concrete next action for the caller. */
  readonly remedy: string;
  /** Preserve a machine code and concrete recovery action for agent callers. */
  constructor(code: BaselineRefusalCode, message: string, remedy: string) {
    super(message);
    this.name = 'BaselineRefusal';
    this.code = code;
    this.remedy = remedy;
  }
}

/** Hash the full canonical item, including text beyond displayed excerpt limits. */
export function sourceDigest(item: ItemMetadata): string {
  const source = JSON.stringify(item, /** Sort nested object keys while retaining array order. */ (_key, value: unknown) => {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) return Object.fromEntries(Object.keys(value).sort().map(/** Canonical keys use locale-independent ordering. */ key => [key, (value as Record<string, unknown>)[key]]));
    return value;
  });
  return createHash('sha256').update(source).digest('hex');
}

/** Validate untrusted baseline bytes strictly; malformed documents never become empty debt. */
export function parseBaseline(value: unknown): LintBaseline {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new BaselineRefusal('invalid_baseline', 'Expected a baseline document.', 'Use version 1 with an acknowledgments array.');
  const document = value as Record<string, unknown>;
  if (document.version !== 1 || !Array.isArray(document.acknowledgments) || Object.keys(document).some(/** Only the versioned contract is accepted. */ key => !['version', 'acknowledgments'].includes(key))) throw new BaselineRefusal('invalid_baseline', 'Unsupported baseline schema.', 'Use version 1 with an acknowledgments array.');
  const seen = new Set<string>();
  for (const entry of document.acknowledgments) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw new BaselineRefusal('invalid_baseline', 'Invalid acknowledgment entry.', 'Acknowledge one observed item and rule with its version, digest and reason.');
    const row = entry as Record<string, unknown>;
    if (Object.keys(row).sort().join(',') !== 'item_id,reason,rule,rule_version,source_digest' || typeof row.item_id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(row.item_id) || typeof row.rule !== 'string' || !/^PML00[1-9]$|^PML010$/.test(row.rule) || typeof row.rule_version !== 'string' || !/^\d+$/.test(row.rule_version) || typeof row.source_digest !== 'string' || !/^[a-f0-9]{64}$/.test(row.source_digest) || typeof row.reason !== 'string' || row.reason.trim().length === 0 || row.reason.length > 1000) throw new BaselineRefusal('invalid_baseline', 'Invalid acknowledgment evidence.', 'Use an exact finding identity, numeric rule version, SHA-256 digest and a reason of 1 to 1000 characters.');
    const key = `${row.item_id}:${row.rule}`;
    if (seen.has(key)) throw new BaselineRefusal('invalid_baseline', 'Duplicate acknowledgment identity.', 'Keep one acknowledgment per item and rule.');
    seen.add(key);
  }
  return structuredClone(value) as LintBaseline;
}

/** Refuse partial or weakened scans rather than issuing a misleading baseline verdict. */
export function assertBaselinePolicy(config: LintConfig, defaults: LintConfig, options: LintOptions): void {
  if (['rule', 'disable', 'severity', 'failOn', 'id', 'type', 'status', 'since'].some(/** Even an empty filter is not a complete baseline gate. */ key => options[key as keyof LintOptions] !== undefined) || JSON.stringify(config) !== JSON.stringify(defaults)) throw new BaselineRefusal('unsafe_policy', 'Baselines require all ten rules with default policy and a complete scan.', 'Remove selection and policy overrides, and restore default lint settings before checking a baseline.');
}

/** Match only current exact evidence; stale acknowledgments remain visible as new failures. */
export function isAcknowledged(finding: Finding, baseline: LintBaseline): boolean {
  return baseline.acknowledgments.some(/** Match all evidence fields, never just the rule code. */ entry => entry.item_id === finding.item_id && entry.rule === finding.rule && entry.rule_version === finding.rule_version && entry.source_digest === finding.source_digest);
}

/** Add or replace exactly one acknowledgment after checking freshly observed evidence. */
export function acknowledgeFinding(findings: readonly Finding[], baseline: LintBaseline, request: Acknowledgment): LintBaseline {
  const checked = parseBaseline({ version: 1, acknowledgments: [request] }).acknowledgments[0];
  const current = findings.find(/** Resolve one exact finding from the complete scan. */ finding => finding.item_id === checked.item_id && finding.rule === checked.rule);
  if (current === undefined) throw new BaselineRefusal('invalid_acknowledgment', 'The requested finding is absent.', 'Run lint again and acknowledge an existing finding.');
  if (current.rule_version !== checked.rule_version || current.source_digest !== checked.source_digest) throw new BaselineRefusal('evidence_changed', 'Finding evidence changed since observation.', 'Run lint again, review the changed source, and use its current rule_version and source_digest.');
  const previous = parseBaseline(baseline);
  return { version: 1, acknowledgments: [...previous.acknowledgments.filter(/** Replace only this finding, retaining every other acknowledgment. */ entry => entry.item_id !== checked.item_id || entry.rule !== checked.rule), checked].sort(/** Keep baseline diffs deterministic. */ (left, right) => left.item_id.localeCompare(right.item_id) || left.rule.localeCompare(right.rule)) };
}
