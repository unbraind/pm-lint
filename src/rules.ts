import { RelationshipKindRegistry } from '@unbrained/pm-cli/sdk';
import type { ItemMetadata } from '@unbrained/pm-cli/sdk';
import type { RuleCode, RuleScope, Severity } from './types.ts';

/** Certified tracker context and deterministic rule tuning supplied by the engine. */
export interface RuleContext {
  items: readonly ItemMetadata[];
  now: number;
  parameters: Record<string, number>;
  duplicateIds: ReadonlySet<string>;
}

/** One stable authoring rule with its documented defaults and static remediation hint. */
export interface Rule {
  code: RuleCode;
  severity: Severity;
  /** Lifecycle slice the engine judges by default; settings and `--status` can override it. */
  scope: RuleScope;
  field: string;
  /** One-line description of what the rule checks, surfaced by `pm lint rules`. */
  description: string;
  hint: string;
  check: (item: ItemMetadata, context: RuleContext) => boolean;
  /** The offending text for a positive check, when the rule flags specific text rather than an absence. */
  excerpt?: (item: ItemMetadata, context: RuleContext) => string | undefined;
}

/** Built-in SDK relationship semantics, including compatibility hierarchy aliases. */
const RELATIONS = new RelationshipKindRegistry();

/** Normalize surface punctuation and whitespace when identifying repeated context. */
function folded(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Detect meaningful optional text without coercing missing values into words. */
function hasText(text: string | undefined): boolean {
  return text !== undefined && text.trim() !== '';
}

/**
 * Placeholder and tautological criterion phrases that never name an outcome.
 *
 * Values are folded text: lowercase with punctuation collapsed to spaces, so
 * `N/A` matches `n a` and trailing punctuation cannot rescue a placeholder.
 */
const VAGUE_CRITERIA: ReadonlySet<string> = new Set([
  'works', 'it works', 'working', 'works fine', 'works as intended', 'done', 'it is done', 'all done',
  'fixed', 'fix', 'complete', 'completed', 'complete now', 'ok', 'okay', 'all ok', 'as expected',
  'looks good', 'looks fine', 'looks right', 'should work', 'should be fine', 'should be ok', 'tbd',
  'to be determined', 'to be defined', 'n a', 'na', 'none', 'nothing', 'see description', 'see above',
  'same as above', 'same as description', 'same as title', 'per description',
]);

/**
 * Words that name an observable action, state or thing inside a short fragment.
 *
 * The lexicon only decides fragments shorter than three words; longer criteria
 * are assumed to carry observable context and are never flagged by PML003.
 */
const OBSERVABLE_TOKENS = /\b[a-z]{3,}(?:ed|ing|es)\b|\b(?:pass|passes|failed|fails|exit|exits|returns?|rejects?|accepts?|emits?|outputs?|displays?|renders?|shows?|prints?|writes?|reads?|creates?|removes?|adds?|records?|reports?|matches?|counts?|tests?|suite|build|builds|coverage|release|releases|deploy|deploys|commits?|merges?|errors?|warnings?|documents?|configs?|settings?|schemas?|cursors?|tokens?|flags?|gates?|items?|files?|state|states|status|statuses|locales?|snippets?|data|logs?|limits?|thresholds?|budgets?|receipts?|contracts?|rows?|lists?|arrays?|ids?|titles?|tags?|badges?|rollback|preserve|containers?|healthy|branch|refs?|vars?|green|clean|absent|intact|unchanged|visible|readable|zero|empty|equal|equals|valid|invalid|reproduced|repro)\b|\d|[<>=]/;

/** Flag a title that lacks a concrete action and scope. */
function vagueTitle(item: ItemMetadata): boolean {
  const title = folded(item.title);
  return /^(?:[\w.-]+\/[\w.-]+)?#\d+$/.test(item.title.trim()) || /^(?:todo|wip|untitled)(?:\s|$)|^fix stuff(?:\s|$)/.test(title) || title.split(/\s+/).length < 3;
}

/** Require criteria for work types selected by the effective lifecycle scope. */
function missingCriteria(item: ItemMetadata): boolean {
  return ['Feature', 'Issue', 'Task'].includes(item.type) && !hasText(item.acceptance_criteria);
}

/** Split criteria into separate assertions the way authors delimit them. */
function criteriaFragments(item: ItemMetadata): string[] {
  if (!hasText(item.acceptance_criteria)) return [];
  return item.acceptance_criteria!.split(/[;\n]/).map(/** Retain each separate assertion without formatting. */ text => text.trim()).filter(/** Ignore empty delimiters. */ text => text !== '');
}

/** Identify the first genuinely vague criterion, or undefined when every assertion is concrete. */
function vagueCriterionText(item: ItemMetadata): string | undefined {
  const fragments = criteriaFragments(item);
  if (fragments.length === 0) return hasText(item.acceptance_criteria) ? item.acceptance_criteria!.trim() : undefined;
  const title = folded(item.title);
  for (const fragment of fragments) {
    const text = folded(fragment);
    if (VAGUE_CRITERIA.has(text) || text === title) return fragment;
    if (text.split(/\s+/).length < 3 && !OBSERVABLE_TOKENS.test(text)) return fragment;
  }
  return undefined;
}

/** Flag criteria whose assertions are placeholder or tautological text instead of outcomes. */
function vagueCriteria(item: ItemMetadata): boolean {
  return vagueCriterionText(item) !== undefined;
}

/** Require closure evidence beyond a repeated title, including comments made at closure. */
function missingClosureEvidence(item: ItemMetadata): boolean {
  const evidence = [item.resolution, item.actual_result, item.close_reason];
  const closedAt = Date.parse(item.closed_at ?? '');
  for (const comment of item.comments ?? []) {
    if (Date.parse(comment.created_at) >= closedAt || /^\s*(?:close(?:d)?|resolution|actual result)\s*:/i.test(comment.text)) evidence.push(comment.text);
  }
  return !evidence.some(/** At least one evidence entry must add context beyond the title. */ text => hasText(text) && folded(text!) !== folded(item.title));
}

/** Detect stale in-progress work and stale claims, using the most recent recorded activity. */
function staleWork(item: ItemMetadata, context: RuleContext): boolean {
  if (item.status !== 'in_progress' && !hasText(item.assignee) && !hasText(item.claim_principal)) return false;
  const activity = [item.updated_at, ...(item.comments ?? []).map(/** Comments are observable work activity. */ entry => entry.created_at), ...(item.notes ?? []).map(/** Notes can carry work evidence. */ entry => entry.created_at), ...(item.test_runs ?? []).map(/** Completed test runs are substantive activity. */ entry => entry.recorded_at)];
  const valid = activity.map(/** Parse SDK timestamps without inventing an update. */ text => Date.parse(text)).filter(/** Structural date errors belong to pm validate. */ time => Number.isFinite(time));
  return valid.length > 0 && context.now - Math.max(...valid) > (context.parameters.staleDays ?? 14) * 86400000;
}

/** Identify an Epic's direct children using SDK hierarchy direction and alias semantics. */
function childlessEpic(item: ItemMetadata, context: RuleContext): boolean {
  if (item.type !== 'Epic') return false;
  return !context.items.some(/** Include scalar parents and both directions of SDK hierarchy edges. */ candidate => {
    if (candidate.id !== item.id && candidate.parent === item.id) return true;
    return (candidate.dependencies ?? []).some(/** Only resolved non-self hierarchy references count as children. */ dependency => {
      const definition = RELATIONS.resolve(dependency.kind);
      if (!definition?.hierarchy || dependency.id === candidate.id) return false;
      if (definition.hierarchyDirection === 'target_parent') return candidate.id !== item.id && dependency.id === item.id;
      return candidate.id === item.id && context.items.some(/** Missing child references must not excuse an empty Epic. */ child => child.id === dependency.id && child.id !== item.id);
    });
  });
}

/** Identify description or note text that supplies no context beyond the title. */
function restatedContextText(item: ItemMetadata): string | undefined {
  const title = folded(item.title);
  if (hasText(item.description) && folded(item.description) === title) return item.description;
  return (item.notes ?? []).find(/** Judge every note without requiring notes to exist. */ note => hasText(note.text) && folded(note.text) === title)?.text;
}

/** Flag a populated description or note that supplies no context beyond the title. */
function restatedContext(item: ItemMetadata): boolean {
  return restatedContextText(item) !== undefined;
}

/** Recognize local references while allowing human blocker prose and external URLs. */
function localReference(text: string, items: readonly ItemMetadata[]): boolean {
  if (/\s|^https?:\/\//i.test(text)) return false;
  return /^pm-[a-z0-9]+-[a-z0-9-]+$/i.test(text) || items.some(/** SDK-generated ids share a namespace before the final token. */ item => text.startsWith(item.id.slice(0, item.id.lastIndexOf('-') + 1)) && item.id.includes('-'));
}

/** Collect the certified ids another item may reference as its blocker. */
function blockerTargetIds(item: ItemMetadata, context: RuleContext): Set<string> {
  return new Set(context.items.filter(/** An item cannot resolve its own blocker. */ candidate => candidate.id !== item.id).map(/** Canonical ids come from the certified metadata. */ candidate => candidate.id));
}

/** Identify an unresolvable local blocker reference, or undefined when every reference resolves. */
function badBlockerReference(item: ItemMetadata, context: RuleContext): string | undefined {
  const ids = blockerTargetIds(item, context);
  const ghost = (item.dependencies ?? []).find(/** Explicit SDK blocker edges always name local items. */ dependency => dependency.kind === 'blocked_by' && !ids.has(dependency.id));
  if (ghost !== undefined) return ghost.id;
  const blocker = item.blocked_by?.trim();
  return blocker !== undefined && localReference(blocker, context.items) && !ids.has(blocker) ? blocker : undefined;
}

/** Diagnose missing blocker context or unresolved local blocking references. */
function unresolvedBlocker(item: ItemMetadata, context: RuleContext): boolean {
  if (!hasText(item.blocked_reason)) return true;
  return badBlockerReference(item, context) !== undefined;
}

/** Ten stable rules; duplicate membership is supplied exclusively by SDK analysis. */
export const RULES: readonly Rule[] = [
  { code: 'PML001', severity: 'warn', scope: 'non_terminal', field: 'title', description: 'Titles name a concrete action and scope instead of placeholders, ticket references or fewer than three words.', hint: 'Write a concrete title with at least three words naming the action and scope.', check: vagueTitle, excerpt: item => item.title },
  { code: 'PML002', severity: 'error', scope: 'non_terminal', field: 'acceptance_criteria', description: 'Features, Issues and Tasks in the selected lifecycle scope carry acceptance criteria.', hint: 'Add acceptance criteria describing an observable completion condition.', check: missingCriteria },
  { code: 'PML003', severity: 'warn', scope: 'non_terminal', field: 'acceptance_criteria', description: 'Every criterion asserts an outcome: placeholder phrases, title restatements and wordless fragments are flagged, concrete assertions are not.', hint: 'Replace placeholder criteria such as works, done or see description with a measurable outcome or condition.', check: vagueCriteria, excerpt: vagueCriterionText },
  { code: 'PML004', severity: 'error', scope: 'closed', field: 'resolution', description: 'Closed items record closure evidence beyond a repeated title.', hint: 'Record closure evidence such as a result, test count, commit or resolution beyond the title.', check: missingClosureEvidence },
  { code: 'PML005', severity: 'warn', scope: 'active', field: 'updated_at', description: 'Active work records recent activity and unused claims are released.', hint: 'Record recent work activity, revise the status or release an unused claim.', check: staleWork, excerpt: item => item.updated_at },
  { code: 'PML006', severity: 'info', scope: 'all', field: 'files', description: 'Features link implementation files or a reproducible test command.', hint: 'Link the Feature to implementation files or a reproducible test command.', /** Only Features need implementation or test links under this rule. */ check: item => item.type === 'Feature' && (item.files ?? []).length === 0 && (item.tests ?? []).length === 0 },
  { code: 'PML007', severity: 'warn', scope: 'non_terminal', field: 'parent', description: 'Epics hold at least one concrete child item in the complete tracker.', hint: 'Create or link a concrete child item that explains part of this Epic.', check: childlessEpic },
  { code: 'PML008', severity: 'info', scope: 'non_terminal', field: 'description', description: 'Descriptions and notes add context beyond a restatement of the title.', hint: 'Add context, constraints or evidence beyond a repeated title.', check: restatedContext, excerpt: restatedContextText },
  { code: 'PML009', severity: 'error', scope: 'blocked', field: 'blocked_reason', description: 'Blocked items explain the blocker and reference only resolvable local blockers.', hint: 'Explain the blocker and replace missing or self-referencing local blocker links.', check: unresolvedBlocker, excerpt: badBlockerReference },
  { code: 'PML010', severity: 'warn', scope: 'active', field: 'title', description: 'Active titles do not form SDK duplicate clusters.', hint: 'Review the SDK duplicate-title cluster and clarify scope or retain a canonical item.', /** The SDK owns duplicate scoring; this predicate only projects membership. */ check: (item, context) => context.duplicateIds.has(item.id), excerpt: item => item.title },
];
