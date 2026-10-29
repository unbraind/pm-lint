import { certifyCompleteListResult, toImportTags } from '@unbrained/pm-cli/sdk';
import type { ItemMetadata, PmClient, PmCompleteListCertificate } from '@unbrained/pm-cli/sdk';
import type { Severity } from './types.ts';
import { parseRulePack, RulePackRefusal, RULE_PACK_LIMITS } from './rule-pack-contract.ts';
import type { AuthoringRule, RulePack } from './rule-pack-contract.ts';
import { analyzeParsedRulePack } from './rule-pack-conflicts.ts';
export * from './rule-pack-contract.ts';

/** Bound evaluation work independently of pack parsing. */
function bound(ok: boolean, dimension: string): void {
  if (!ok) throw new RulePackRefusal('limit_exceeded', `Rule pack ${dimension} limit exceeded.`, 'Reduce the pack or applicable rule scope to the documented ceilings; never truncate a certified corpus.');
}

/** One compact diagnostic carries the organization's explanation and concrete correction. */
export interface RulePackFinding { item_id: string; rule: string; field: AuthoringRule['field']; severity: Severity; explanation: string; remedy: string }
/** Complete receipt retains counts and certification without copying tracker text. */
export interface RulePackResult { version: 1; findings: RulePackFinding[]; count: number; corpus_count: number; checks: number; summary: Record<Severity, number>; complete_list: PmCompleteListCertificate; exit_code: number }

/** Evaluate an assertion in bounded linear literal operations; length counts UTF-16 code units. */
function satisfies(item: ItemMetadata, rule: AuthoringRule): boolean {
  const check = rule.predicate;
  if (check.op === 'required_tag' || check.op === 'forbidden_tag') {
    const present = toImportTags(item.tags).includes(check.value);
    return check.op === 'required_tag' ? present : !present;
  }
  if (check.op === 'min_value' || check.op === 'max_value') return check.op === 'min_value' ? item.priority >= check.value : item.priority <= check.value;
  const value = (item[rule.field] ?? '') as string;
  bound(value.length <= RULE_PACK_LIMITS.text, 'item text');
  switch (check.op) {
    case 'present': return value.trim().length > 0;
    case 'contains': return value.includes(check.value);
    case 'not_contains': return !value.includes(check.value);
    case 'starts_with': return value.startsWith(check.value);
    case 'min_length': return value.length >= check.value;
    case 'max_length': return value.length <= check.value;
  }
}

/** Use core's certified full reader so filesystem and remote SDK adapters share semantics. */
export async function lintRulePack(client: Pick<PmClient, 'listAllComplete'>, input: RulePack): Promise<RulePackResult> {
  return lintParsedRulePack(client, parseRulePack(input));
}

/** Share preflight and evaluation with the command after its file boundary has validated the pack. */
export async function lintParsedRulePack(client: Pick<PmClient, 'listAllComplete'>, pack: RulePack): Promise<RulePackResult> {
  const analysis = analyzeParsedRulePack(pack);
  if (analysis.witness !== null) throw new RulePackRefusal('conflicting_pack', 'Organization policy contains incompatible constraints.', analysis.remedy, analysis.witness.rule_ids);
  const corpus = certifyCompleteListResult(await client.listAllComplete());
  bound(corpus.items.length * pack.rules.length <= RULE_PACK_LIMITS.checks, 'checks');
  const findings: RulePackFinding[] = [];
  const summary: Record<Severity, number> = { info: 0, warn: 0, error: 0 };
  let checks = 0;
  for (const item of corpus.items) {
    for (const rule of pack.rules) {
      if (rule.when?.statuses !== undefined && !rule.when.statuses.includes(item.status)) continue;
      if (rule.when?.types !== undefined && !rule.when.types.includes(item.type)) continue;
      checks += 1;
      if (satisfies(item, rule)) continue;
      bound(findings.length < RULE_PACK_LIMITS.findings, 'findings');
      findings.push({ item_id: item.id, rule: rule.id, field: rule.field, severity: rule.severity, explanation: rule.explanation, remedy: rule.remedy });
      summary[rule.severity] += 1;
    }
  }
  findings.sort(/** Certified item ids and unique rule ids make each pair distinct; use locale-free ordering. */ (a, b) => (a.item_id === b.item_id ? a.rule < b.rule : a.item_id < b.item_id) ? -1 : 1);
  return { version: 1, findings, count: findings.length, corpus_count: corpus.items.length, checks, summary, complete_list: corpus.complete_list, exit_code: summary.error > 0 ? 1 : 0 };
}
