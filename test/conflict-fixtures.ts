import type { AuthoringRule, AuthoringPredicate, RulePack } from '../index.ts';

/** Construct one declared policy assertion using the public producer contract. */
export function constraint(id: string, field: AuthoringRule['field'], predicate: AuthoringPredicate, when?: AuthoringRule['when']): AuthoringRule {
  return { id, field, predicate, severity: 'error', explanation: 'Organization assertion', remedy: 'Adjust the stated constraint', ...(when === undefined ? {} : { when }) };
}
/** Wrap assertions without introducing alternate normalization. */
export function policy(...rules: AuthoringRule[]): RulePack { return { version: 1, rules }; }

