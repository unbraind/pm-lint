import { RelationshipKindRegistry } from '@unbrained/pm-cli/sdk';
import type { ItemMetadata } from '@unbrained/pm-cli/sdk';
import type { RuleCode, Severity } from './types.ts';

/** Certified tracker context and deterministic rule tuning supplied by the engine. */
export interface RuleContext {
  items: readonly ItemMetadata[];
  now: number;
  parameters: Record<string, number>;
  duplicateIds: ReadonlySet<string>;
}

/** One stable authoring rule with its documented default and static remediation hint. */
export interface Rule {
  code: RuleCode;
  severity: Severity;
  field: string;
  hint: string;
  check: (item: ItemMetadata, context: RuleContext) => boolean;
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

/** Flag a title that lacks a concrete action and scope. */
function vagueTitle(item: ItemMetadata): boolean {
  const title = folded(item.title);
  return /^(?:[\w.-]+\/[\w.-]+)?#\d+$/.test(item.title.trim()) || /^(?:todo|wip|untitled)(?:\s|$)|^fix stuff(?:\s|$)/.test(title) || title.split(/\s+/).length < 3;
}

/** Require criteria for the three work types while they are open or in progress. */
function missingCriteria(item: ItemMetadata): boolean {
  return ['Feature', 'Issue', 'Task'].includes(item.type) && ['open', 'in_progress'].includes(item.status) && !hasText(item.acceptance_criteria);
}

/** Judge each criterion independently, accepting observable outcomes or explicit conditions. */
function unverifiableCriteria(item: ItemMetadata): boolean {
  if (!hasText(item.acceptance_criteria)) return false;
  const criteria = item.acceptance_criteria!.split(/[;\n]/).map(/** Retain each separate assertion without formatting. */ text => text.trim()).filter(/** Ignore empty delimiters. */ text => text !== '');
  return criteria.length === 0 || criteria.some(/** Every assertion must add a verifiable outcome beyond the title. */ criterion => {
    const text = folded(criterion);
    if (/^(?:it )?(?:works|done)$/.test(text) || text === folded(item.title)) return true;
    return !/\b(?:return|reject|accept|emit|output|display|render|show|contain|includ|exclud|preserv|persist|write|read|creat|remov|block|prevent|reproduc|report|pass|fail|exit|match|equal|assert|verif|measur|record|succeed|complet|resolv|pin|prov|dispatch|perform|expos|cover|disposition|acknowledg|count|requeu|supply|produc|collect|validat|stop|honour|execut|print|track|target|repeat|enforc|permit|deriv|launch|retain|promot|append|pars|load|respect|invalidat|obtain|rehears|serv|link|document|publish|reduc|store|stream|authoriz|refresh|select|leav|exercis|version|provision|run|import|export|install|activat|classif|scan|inventory|scrub|requir|support|test|chang|keep|appl)(?:e|es|s|ed|d|ing|y|ies|ied)?\b|\b(?:when|if|unless|given|without|zero|no|before|after|merged|deferred|readable|absent|intact|visible|immutable|green|clean|released|closed|unchanged)\b|\d|[<>=]/i.test(criterion);
  });
}

/** Require closure evidence beyond a repeated title, including comments made at closure. */
function missingClosureEvidence(item: ItemMetadata): boolean {
  if (item.status !== 'closed') return false;
  const evidence = [item.resolution, item.actual_result, item.close_reason];
  const closedAt = Date.parse(item.closed_at ?? '');
  for (const comment of item.comments ?? []) {
    if (Date.parse(comment.created_at) >= closedAt || /^\s*(?:close(?:d)?|resolution|actual result)\s*:/i.test(comment.text)) evidence.push(comment.text);
  }
  return !evidence.some(/** At least one evidence entry must add context beyond the title. */ text => hasText(text) && folded(text!) !== folded(item.title));
}

/** Detect stale in-progress work and stale claims, using the most recent recorded activity. */
function staleWork(item: ItemMetadata, context: RuleContext): boolean {
  if (['closed', 'canceled'].includes(item.status)) return false;
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

/** Flag a populated description or note that supplies no context beyond the title. */
function restatedContext(item: ItemMetadata): boolean {
  const text = folded(item.title);
  return (hasText(item.description) && folded(item.description) === text) || (item.notes ?? []).some(/** Judge every note without requiring notes to exist. */ note => hasText(note.text) && folded(note.text) === text);
}

/** Recognize local references while allowing human blocker prose and external URLs. */
function localReference(text: string, items: readonly ItemMetadata[]): boolean {
  if (/\s|^https?:\/\//i.test(text)) return false;
  return /^pm-[a-z0-9]+-[a-z0-9-]+$/i.test(text) || items.some(/** SDK-generated ids share a namespace before the final token. */ item => text.startsWith(item.id.slice(0, item.id.lastIndexOf('-') + 1)) && item.id.includes('-'));
}

/** Diagnose missing blocker context or unresolved local blocking references. */
function unresolvedBlocker(item: ItemMetadata, context: RuleContext): boolean {
  if (item.status !== 'blocked') return false;
  if (!hasText(item.blocked_reason)) return true;
  const ids = new Set(context.items.filter(/** An item cannot resolve its own blocker. */ candidate => candidate.id !== item.id).map(/** Canonical ids come from the certified metadata. */ candidate => candidate.id));
  if ((item.dependencies ?? []).some(/** Explicit SDK blocker edges always name local items. */ dependency => dependency.kind === 'blocked_by' && !ids.has(dependency.id))) return true;
  const blocker = item.blocked_by?.trim();
  return blocker !== undefined && localReference(blocker, context.items) && !ids.has(blocker);
}

/** Ten stable rules; duplicate membership is supplied exclusively by SDK analysis. */
export const RULES: readonly Rule[] = [
  { code: 'PML001', severity: 'warn', field: 'title', hint: 'Write a concrete title with at least three words naming the action and scope.', check: vagueTitle },
  { code: 'PML002', severity: 'error', field: 'acceptance_criteria', hint: 'Add acceptance criteria describing an observable completion condition.', check: missingCriteria },
  { code: 'PML003', severity: 'warn', field: 'acceptance_criteria', hint: 'Replace vague or repeated criteria with a measurable outcome or condition.', check: unverifiableCriteria },
  { code: 'PML004', severity: 'error', field: 'resolution', hint: 'Record closure evidence such as a result, test count, commit or resolution beyond the title.', check: missingClosureEvidence },
  { code: 'PML005', severity: 'warn', field: 'updated_at', hint: 'Record recent work activity, revise the status or release an unused claim.', check: staleWork },
  { code: 'PML006', severity: 'info', field: 'files', hint: 'Link the Feature to implementation files or a reproducible test command.', /** Only Features need implementation or test links under this rule. */ check: item => item.type === 'Feature' && (item.files ?? []).length === 0 && (item.tests ?? []).length === 0 },
  { code: 'PML007', severity: 'warn', field: 'parent', hint: 'Create or link a concrete child item that explains part of this Epic.', check: childlessEpic },
  { code: 'PML008', severity: 'info', field: 'description', hint: 'Add context, constraints or evidence beyond a repeated title.', check: restatedContext },
  { code: 'PML009', severity: 'error', field: 'blocked_reason', hint: 'Explain the blocker and replace missing or self-referencing local blocker links.', check: unresolvedBlocker },
  { code: 'PML010', severity: 'warn', field: 'title', hint: 'Review the SDK duplicate-title cluster and clarify scope or retain a canonical item.', /** The SDK owns duplicate scoring; this predicate only projects membership. */ check: (item, context) => context.duplicateIds.has(item.id) },
];
