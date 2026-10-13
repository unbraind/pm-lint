import { certifyCompleteListResult } from '@unbrained/pm-cli/sdk';
import type { ItemMetadata, PmClient, PmCompleteListCertificate } from '@unbrained/pm-cli/sdk';
import { analyzeDuplicateItems } from '@unbrained/pm-cli/sdk/query';
import type { DuplicateItemsAnalysis } from '@unbrained/pm-cli/sdk/query';
import { RULES } from './rules.ts';
import { readLintSettings, resolveConfig } from './settings.ts';
import type { LintOptions } from './settings.ts';
import type { Finding, RuleCode, RuleScope, Severity } from './types.ts';

/** Privacy-conscious lint result with corpus certification and deterministic exit status. */
export interface LintResult {
  findings: Finding[];
  count: number;
  scanned: number;
  corpus_count: number;
  /** Findings counted by rule and severity so CI can trend rule pressure at a glance. */
  summary: Record<RuleCode, Record<Severity, number>>;
  complete_list: PmCompleteListCertificate;
  fail_on: Severity;
  exit_code: number;
}

/** Map severities to their stable CI ordering. */
export const SEVERITY_RANK: Record<Severity, number> = { info: 0, warn: 1, error: 2 };

/** Maximum characters of offending text one finding carries. */
export const EXCERPT_LIMIT = 160;

/** Trim one offending value and bound it to the documented excerpt ceiling. */
export function excerptText(value: string): string {
  return value.trim().slice(0, EXCERPT_LIMIT);
}

/** Decide whether one item status falls inside a rule's lifecycle scope. */
export function inScope(scope: RuleScope, status: string): boolean {
  if (scope === 'all') return true;
  if (scope === 'non_terminal' || scope === 'active') return status !== 'closed' && status !== 'canceled';
  if (scope === 'terminal') return status === 'closed' || status === 'canceled';
  return status === scope;
}

/** Parse a comma-separated status selection into nonempty status tokens. */
export function statusSelection(value: string): string[] {
  const statuses = value.split(',').map(/** Trim surrounding whitespace from each status. */ entry => entry.trim()).filter(/** Refuse a selection that names no status. */ entry => entry !== '');
  if (statuses.length === 0) throw new Error('--status requires one or more statuses');
  return statuses;
}

/** Parse a calendar date or an explicitly zoned ISO timestamp without permissive Date coercion. */
export function sinceTimestamp(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) throw new Error('--since requires a calendar date or zoned ISO timestamp');
  const time = Date.parse(value);
  const calendar = value.slice(0, 10);
  const day = Date.parse(calendar);
  if (!Number.isFinite(time) || new Date(day).toISOString().slice(0, 10) !== calendar) throw new Error('Invalid --since date');
  return time;
}

/** Apply selection after whole-corpus certification, retaining complete relationship context. */
function selectItems(items: readonly ItemMetadata[], options: LintOptions): ItemMetadata[] {
  const since = options.since === undefined ? undefined : sinceTimestamp(options.since);
  const ids = options.id === undefined ? undefined : new Set(options.id);
  const statuses = options.status === undefined ? undefined : statusSelection(options.status);
  if (ids && [...ids].some(/** Refuse unknown ids instead of passing an empty gate. */ id => !items.some(/** Compare complete canonical ids. */ item => item.id === id))) throw new Error('Unknown lint item id');
  return items.filter(/** Filters restrict findings while rules retain the complete corpus. */ item => (options.type === undefined || item.type === options.type) && (statuses === undefined || statuses.includes(item.status)) && (ids === undefined || ids.has(item.id)) && (since === undefined || Date.parse(item.updated_at) >= since));
}

/** Reconcile the SDK duplicate scan with certified active counts before using its findings. */
export function duplicateItemIds(result: DuplicateItemsAnalysis, items: readonly ItemMetadata[]): Set<string> {
  const active = items.filter(/** Match the SDK duplicate operation's explicit lifecycle selection. */ item => ['open', 'in_progress', 'blocked'].includes(item.status));
  if (result.cost.item_count !== active.length) throw new Error('Duplicate source does not match the certified corpus');
  if (result.count >= 1000) throw new Error('SDK duplicate cluster cap reached; completeness cannot be proven');
  const ids = new Set<string>();
  for (const cluster of result.clusters) {
    for (const item of cluster.items) ids.add(item.id);
  }
  return ids;
}

/** Lint the certified SDK corpus, reuse SDK duplication analysis and fail on configured severity. */
export async function lintItems(client: PmClient, pmRoot: string, options: LintOptions = {}, now: number = Date.now()): Promise<LintResult> {
  const config = resolveConfig(await readLintSettings(pmRoot), options);
  const corpus = certifyCompleteListResult(await client.listAllComplete());
  const selected = selectItems(corpus.items, options);
  let duplicateIds = new Set<string>();
  if (config.rules.PML010.enabled) {
    const active = corpus.items.filter(/** The SDK receives only the certified active lifecycle corpus. */ item => ['open', 'in_progress', 'blocked'].includes(item.status));
    const duplicates = analyzeDuplicateItems(active, { threshold: config.rules.PML010.parameters.threshold ?? 0.92, limit: 1000 });
    duplicateIds = duplicateItemIds(duplicates, corpus.items);
  }
  const findings: Finding[] = [];
  const summary = Object.fromEntries(RULES.map(/** Every rule reports a stable per-severity count, zero included. */ rule => [rule.code, { info: 0, warn: 0, error: 0 }])) as Record<RuleCode, Record<Severity, number>>;
  for (const item of selected) {
    for (const rule of RULES) {
      const effective = config.rules[rule.code];
      if (!effective.enabled) continue;
      // An explicit --status selection overrides every rule's scope: the caller named the lifecycle to judge.
      if (options.status === undefined && !inScope(effective.scope, item.status)) continue;
      const context = { items: corpus.items, now, parameters: effective.parameters, duplicateIds };
      if (!rule.check(item, context)) continue;
      const finding: Finding = { item_id: item.id, rule: rule.code, severity: effective.severity, field: rule.field, hint: rule.hint, title: item.title, excerpt: excerptText(rule.excerpt?.(item, context) ?? '') };
      findings.push(finding);
      summary[rule.code][effective.severity] += 1;
    }
  }
  findings.sort(/** Keep host output deterministic independently of tracker scan ordering. */ (left, right) => left.item_id.localeCompare(right.item_id) || left.rule.localeCompare(right.rule));
  return { findings, count: findings.length, scanned: selected.length, corpus_count: corpus.items.length, summary, complete_list: corpus.complete_list, fail_on: config.failOn, exit_code: findings.some(/** Exit policy includes the configured threshold and every higher severity. */ finding => SEVERITY_RANK[finding.severity] >= SEVERITY_RANK[config.failOn]) ? 1 : 0 };
}
