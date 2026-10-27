import { certifyCompleteListResult } from '@unbrained/pm-cli/sdk';
import type { ListMutationEventsOptions, MutationEventPage, PmClient } from '@unbrained/pm-cli/sdk';
import { RULE_VERSION, sourceDigest } from './baseline.ts';
import { evaluateRule, lintCorpus } from './engine.ts';
import type { LintResult, RuleEvaluator } from './engine.ts';
import { assertIncrementalLimit, assertIncrementalPage, INCREMENTAL_LIMITS, IncrementalRefusal, parseIncrementalCheckpoint, parseIncrementalRequest, RULE_DEPENDENCIES, validateIncrementalNumbers } from './incremental-contract.ts';
import type { IncrementalCheckpoint, IncrementalCursor, IncrementalItemState, IncrementalRequest } from './incremental-contract.ts';
import { RULES } from './rules.ts';
import type { LintStatusRegistry } from './statuses.ts';
import type { LintConfig, RuleCode } from './types.ts';

/** Native SDK capabilities supplied by a filesystem, remote or hosted adapter. */
export interface IncrementalLintSource {
  /** Stable backend/workspace identity; persisted only as a digest. */
  identity: string;
  client: Pick<PmClient, 'listAllComplete'>;
  events: (options: Pick<ListMutationEventsOptions, 'since' | 'limit' | 'item'>) => Promise<MutationEventPage>;
  policy: () => Promise<{ config: LintConfig; statuses: LintStatusRegistry }>;
}
/** Observable boundaries for deterministic integration interleavings, never SDK mocks. */
export type IncrementalBoundary = 'policy' | 'anchor' | 'events' | 'corpus' | 'evaluated' | 'verified';
/** Evaluation counts measure actual predicate calls; all unchanged findings remain in result. */
export interface IncrementalLintResult {
  result: LintResult;
  checkpoint: IncrementalCheckpoint;
  incremental: {
    mode: 'rebuild' | 'update';
    changed_items: number;
    evaluated: number;
    reused: number;
    events: number;
    event_pages: number;
    by_rule: Record<RuleCode, { evaluated: number; reused: number; global: boolean }>;
  };
}

/** Drain core event pagination to a recoverable boundary; never infer continuation from time. */
async function drain(source: IncrementalLintSource, start: IncrementalCursor | null, stats: IncrementalLintResult['incremental'], item?: string): Promise<{ cursor: IncrementalCursor | null; ids: Set<string>; anchors: Set<string> }> {
  let cursor = start;
  let since = item === undefined ? start?.value : start!.ts;
  const ids = new Set<string>();
  const anchors = new Set<string>();
  const seen = new Set<string>();
  for (;;) {
    const page = await readPage(source, { since, limit: 1000, ...(item === undefined ? {} : { item }) });
    assertIncrementalPage(page, seen);
    stats.event_pages += 1;
    stats.events += page.count;
    assertIncrementalLimit(stats.events, INCREMENTAL_LIMITS.events);
    for (const event of page.events) {
      ids.add(event.item_id);
      anchors.add(`${event.item_id}:${event.version}:${event.ts}`);
    }
    if (page.count > 0) {
      const last = page.events[page.events.length - 1];
      seen.add(page.next_cursor!);
      cursor = { value: page.next_cursor!, item_id: last.item_id, version: last.version, ts: last.ts };
      since = page.next_cursor;
    }
    if (!page.has_more) return { cursor, ids, anchors };
  }
}

/** Map native SDK cursor/read failures before applying package-owned progress and budget checks. */
async function readPage(source: IncrementalLintSource, options: Parameters<IncrementalLintSource['events']>[0]): Promise<MutationEventPage> {
  try { return await source.events(options); } catch {
    throw new IncrementalRefusal('cursor_lost', 'SDK event continuation is unavailable.');
  }
}

/** Revalidate the saved SDK anchor; core cursors alone do not certify retained history. */
async function verifyAnchor(source: IncrementalLintSource, cursor: IncrementalCursor | null, stats: IncrementalLintResult['incremental']): Promise<void> {
  if (cursor === null) return;
  const page = await drain(source, cursor, stats, cursor.item_id);
  if (!page.anchors.has(`${cursor.item_id}:${cursor.version}:${cursor.ts}`)) throw new IncrementalRefusal('cursor_lost', 'The saved event anchor is no longer readable.');
}

/** Hash both explicit version and dependency declarations so metadata drift cannot reuse stale outcomes. */
export function incrementalRuleVersion(): string {
  return sourceDigest({ version: RULE_VERSION, dependencies: RULE_DEPENDENCIES });
}

/** Update a complete lint result, using only SDK reads and detached caller-owned checkpoint state. */
export async function lintIncremental(source: IncrementalLintSource, input: IncrementalRequest = {}, onBoundary?: (boundary: IncrementalBoundary) => Promise<void>): Promise<IncrementalLintResult> {
  const request = parseIncrementalRequest(input);
  const previous = request.checkpoint;
  if (!request.rebuild && previous === undefined) throw new IncrementalRefusal('rebuild_required', 'No checkpoint exists; an explicit rebuild is required.');
  const identity = sourceDigest(source.identity);
  if (previous !== undefined && previous.source_id !== identity) throw new IncrementalRefusal('foreign_state', 'Checkpoint belongs to a different source; it was skipped.', 'Use a separate checkpoint for this source; foreign state is never overwritten.');
  const { config, statuses } = await source.policy();
  const policy = sourceDigest({ config, statuses: statuses.definitions });
  await onBoundary?.('policy');
  if (!request.rebuild && previous!.rule_version !== incrementalRuleVersion()) throw new IncrementalRefusal('rule_drift', 'Rule version or dependency declarations changed.');
  if (!request.rebuild && previous!.policy_digest !== policy) throw new IncrementalRefusal('policy_drift', 'Lint settings or configured status roles changed.');
  const stats: IncrementalLintResult['incremental'] = { mode: request.rebuild ? 'rebuild' : 'update', changed_items: 0, evaluated: 0, reused: 0, events: 0, event_pages: 0, by_rule: Object.fromEntries(RULES.map(/** Keep all ten rule counts, including disabled or out-of-scope rules. */ rule => [rule.code, { evaluated: 0, reused: 0, global: RULE_DEPENDENCIES[rule.code].global }])) as IncrementalLintResult['incremental']['by_rule'] };
  if (!request.rebuild) await verifyAnchor(source, previous!.cursor, stats);
  await onBoundary?.('anchor');
  const events = await drain(source, request.rebuild ? null : previous!.cursor, stats);
  await onBoundary?.('events');
  const corpus = certifyCompleteListResult(await source.client.listAllComplete());
  await onBoundary?.('corpus');
  assertIncrementalLimit(corpus.items.length, INCREMENTAL_LIMITS.items);
  const old = new Map((request.rebuild ? [] : previous!.items).map(/** Compare current SDK state, including changes to fields no predicate consumes. */ item => [item.id, item]));
  const current = new Map<string, IncrementalItemState>();
  for (const item of corpus.items) {
    current.set(item.id, { id: item.id, source_digest: sourceDigest(item), inputs: RULES.map(/** Status participates in every pair because it determines applicability. */ rule => RULE_DEPENDENCIES[rule.code].global ? '' : sourceDigest([item.status, ...RULE_DEPENDENCIES[rule.code].fields.map(/** Native SDK values define dependency equality. */ field => item[field])])), excerpts: RULES.map(/** Clean and out-of-scope pairs carry no saved text. */ () => ''), violations: 0 });
  }
  for (const id of new Set([...old.keys(), ...current.keys()])) {
    if (old.get(id)?.source_digest === current.get(id)?.source_digest) continue;
    stats.changed_items += 1;
    if (!request.rebuild && !events.ids.has(id)) throw new IncrementalRefusal('cursor_lost', 'Current SDK state changed without a corresponding retained event.');
  }
  const evaluate: RuleEvaluator = /** Reuse only an unchanged declared input; render findings from current SDK metadata. */ (rule, item, context) => {
    const index = RULES.indexOf(rule);
    const next = current.get(item.id)!;
    const prior = old.get(item.id);
    const cached = !RULE_DEPENDENCIES[rule.code].global && prior !== undefined && prior.inputs[index] === next.inputs[index];
    const verdict = cached ? { matched: (prior.violations & (1 << index)) !== 0, excerpt: prior.excerpts[index] } : evaluateRule(rule, item, context);
    stats.by_rule[rule.code][cached ? 'reused' : 'evaluated'] += 1;
    stats[cached ? 'reused' : 'evaluated'] += 1;
    if (verdict.matched) next.violations |= 1 << index;
    next.excerpts[index] = verdict.excerpt;
    return verdict;
  };
  const result = lintCorpus(corpus, config, {}, request.now ?? Date.now(), statuses, evaluate);
  await onBoundary?.('evaluated');
  const tail = await drain(source, events.cursor, stats);
  const latestPolicy = await source.policy();
  if (tail.ids.size > 0 || sourceDigest({ config: latestPolicy.config, statuses: latestPolicy.statuses.definitions }) !== policy) throw new IncrementalRefusal('source_changed', 'Source or policy changed during the scan.', 'Retry the scan against current SDK state; no checkpoint was advanced.');
  await onBoundary?.('verified');
  validateIncrementalNumbers({ result, stats });
  const payload = { owner: 'pm-lint-incremental' as const, format: 1 as const, rule_version: incrementalRuleVersion(), policy_digest: policy, source_id: identity, cursor: events.cursor, items: [...current.values()] };
  const checkpoint = parseIncrementalCheckpoint({ ...payload, digest: sourceDigest(payload) });
  return { result, checkpoint, incremental: stats };
}
