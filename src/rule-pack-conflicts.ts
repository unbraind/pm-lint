import { parseRulePack } from './rule-pack-contract.ts';
import type { AuthoringRule, RulePack } from './rule-pack-contract.ts';

/** Smallest contradictory conjunction, valid in the displayed selector intersection. */
export interface RulePackConflict {
  rule_ids: string[];
  field: AuthoringRule['field'];
  when: NonNullable<AuthoringRule['when']>;
}
/** Conservative proof receipt; unknown rules never become satisfiability evidence. */
export interface RulePackAnalysis {
  version: 1;
  status: 'conflict' | 'compatible' | 'unknown';
  rule_count: number;
  rule_ids: string[];
  witness: RulePackConflict | null;
  unknown_rule_ids: string[];
  remedy: string;
}

/** Order identities without depending on the process locale. */
function compare(a: AuthoringRule, b: AuthoringRule): number { return a.id < b.id ? -1 : 1; }

/** Literal text operations remain evaluable but are outside the exact interval proof fragment. */
function supported(rule: AuthoringRule): boolean {
  return !['contains', 'not_contains', 'starts_with'].includes(rule.predicate.op);
}

/** Intersect exact selectors, retaining the unbounded dimension when neither rule restricts it. */
function intersection(a: AuthoringRule, b: AuthoringRule): RulePackConflict['when'] | null {
  const when: RulePackConflict['when'] = {};
  for (const key of ['statuses', 'types'] as const) {
    const left = a.when?.[key];
    const right = b.when?.[key];
    if (left === undefined && right === undefined) continue;
    const values = [...new Set(left === undefined ? right! : right === undefined ? left : left.filter(value => right.includes(value)))].sort();
    if (values.length === 0) return null;
    when[key] = values;
  }
  return when;
}

/** Map the admitted integer interval grammar without approximate arithmetic. */
function interval(rule: AuthoringRule): readonly [number, number] {
  const domain = rule.field === 'priority' ? 4 : 65536;
  const check = rule.predicate as { op: 'present' } | { op: 'min_length' | 'min_value' | 'max_length' | 'max_value'; value: number };
  if (check.op === 'present') return [1, domain];
  return check.op === 'min_length' || check.op === 'min_value' ? [check.value, domain] : [0, check.value];
}

/** Prove a pair only when both operations belong to the exact supported fragment. */
function contradicts(a: AuthoringRule, b: AuthoringRule): boolean {
  if (a.field !== b.field || !supported(a) || !supported(b)) return false;
  if (a.field === 'tags') {
    const left = a.predicate as { op: 'required_tag' | 'forbidden_tag'; value: string };
    const right = b.predicate as typeof left;
    return left.op !== right.op && left.value === right.value;
  }
  const [aMin, aMax] = interval(a);
  const [bMin, bMax] = interval(b);
  return Math.max(aMin, bMin) > Math.min(aMax, bMax);
}

/** Analyze validated packs with a bounded quadratic scan; all minimal cores in this fragment have size at most two. */
export function analyzeParsedRulePack(pack: RulePack): RulePackAnalysis {
  const rules = [...pack.rules].sort(compare);
  const unknown_rule_ids = rules.filter(rule => !supported(rule)).map(rule => rule.id);
  let witness: RulePackConflict | null = null;
  // Native titles cannot be empty; other supported fields have nonempty admitted domains.
  for (const rule of rules) {
    if (rule.field === 'title' && rule.predicate.op === 'max_length' && rule.predicate.value === 0) {
      witness = { rule_ids: [rule.id], field: rule.field, when: intersection(rule, rule)! };
      break;
    }
  }
  for (let i = 0; witness === null && i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      if (!contradicts(rules[i], rules[j])) continue;
      const when = intersection(rules[i], rules[j]);
      if (when === null) continue;
      witness = { rule_ids: [rules[i].id, rules[j].id], field: rules[i].field, when };
      break;
    }
  }
  return {
    version: 1, status: witness !== null ? 'conflict' : unknown_rule_ids.length > 0 ? 'unknown' : 'compatible',
    rule_count: rules.length, rule_ids: rules.map(rule => rule.id), witness, unknown_rule_ids,
    remedy: witness !== null ? 'Remove or relax a witnessed rule, or separate its selectors, then analyze again before applying the policy.' : unknown_rule_ids.length > 0 ? 'Review the listed literal text predicates manually; use tag membership or integer bounds for exact proofs.' : 'The supported constraints are compatible; apply the policy to inspect item compliance.',
  };
}

/** Validate one untrusted input through the same schema used by policy evaluation. */
export function analyzeRulePack(input: unknown): RulePackAnalysis { return analyzeParsedRulePack(parseRulePack(input)); }
