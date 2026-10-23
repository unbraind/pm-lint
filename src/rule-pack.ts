import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { certifyCompleteListResult } from '@unbrained/pm-cli/sdk';
import type { PmClient, PmCompleteListCertificate } from '@unbrained/pm-cli/sdk';
import type { Severity } from './types.ts';

/** Version 1 text fields retain core's canonical metadata spelling and types. */
export const RULE_PACK_FIELDS = ['title', 'description', 'acceptance_criteria', 'definition_of_ready', 'resolution', 'blocked_reason', 'outcome', 'value', 'why_now'] as const;
/** Literal semantic checks deliberately exclude regex, glob, recursion and executable code. */
export type AuthoringPredicate = { op: 'present' } | { op: 'contains' | 'not_contains' | 'starts_with'; value: string } | { op: 'min_length' | 'max_length'; value: number };
/** Organization-owned assertion; all selectors are exact, case-sensitive OR lists, ANDed together. */
export interface AuthoringRule {
  id: string;
  field: typeof RULE_PACK_FIELDS[number];
  predicate: AuthoringPredicate;
  severity: Severity;
  explanation: string;
  remedy: string;
  when?: { statuses?: string[]; types?: string[] };
}
/** Portable, strictly parsed pack with no implicit settings or execution hooks. */
export interface RulePack { version: 1; rules: AuthoringRule[] }
/** Stable refusal categories distinguish contract, resource and I/O remedies. */
export type RulePackRefusalCode = 'invalid_pack' | 'unsafe_pattern' | 'limit_exceeded' | 'pack_io';
/** Fail closed with a bounded explanation that does not echo source content or paths. */
export class RulePackRefusal extends Error {
  /** Stable category shared by CLI and SDK consumers. */
  readonly code: RulePackRefusalCode;
  /** Concrete next action for recovering from the refusal. */
  readonly remedy: string;
  /** Preserve a machine-readable category and next action for every transport. */
  constructor(code: RulePackRefusalCode, message: string, remedy: string) {
    super(message);
    this.name = 'RulePackRefusal';
    this.code = code;
    this.remedy = remedy;
  }
}
/** Hard ceilings apply to SDK input, file reads and evaluation; no silent truncation. */
export const RULE_PACK_LIMITS = { bytes: 65536, rules: 64, literal: 512, text: 65536, checks: 100000, findings: 1000 } as const;

/** Reject malformed values at a contract coordinate without disclosing their contents. */
function invalid(path: string): never {
  throw new RulePackRefusal('invalid_pack', `Invalid version 1 rule pack at ${path}; check required fields, unknown fields and value types.`, 'Use the documented version 1 keys, supported text fields, unique rule ids and literal predicates.');
}
/** Bound resources independently of well-formedness, preserving the failed dimension. */
function bound(ok: boolean, dimension: string): void {
  if (!ok) throw new RulePackRefusal('limit_exceeded', `Rule pack ${dimension} limit exceeded.`, 'Reduce the pack or applicable rule scope to the documented ceilings; never truncate a certified corpus.');
}
/** Validate exact own keys before reading a JSON object's values. */
function object(value: unknown, required: readonly string[], optional: readonly string[], path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || !required.every(/** Required keys must be explicit. */ key => Object.hasOwn(value, key))) invalid(path);
  if (Object.keys(value).some(/** Refuse all undeclared options. */ key => !required.includes(key) && !optional.includes(key))) throw new RulePackRefusal('invalid_pack', `Unknown field in ${path}.`, 'Remove undeclared fields at this contract coordinate; use only documented version 1 keys.');
  return value as Record<string, unknown>;
}
/** Validate bounded nonblank strings without changing literal semantics. */
function text(value: unknown, limit: number, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') invalid(path);
  bound(value.length <= limit, path);
  return value;
}
/** Parse one non-executable predicate, refusing regex and wildcard modes explicitly. */
function predicate(value: unknown, path: string): AuthoringPredicate {
  const input = object(value, ['op'], ['value'], path);
  if (['regex', 'matches', 'glob', 'expression'].includes(input.op as string)) throw new RulePackRefusal('unsafe_pattern', `Executable or unbounded pattern at ${path}.`, 'Use contains, not_contains or starts_with with a literal string; regex, globs and expressions are unsupported.');
  if (input.op === 'present') {
    if (Object.hasOwn(input, 'value')) invalid(path);
    return { op: 'present' };
  }
  if (input.op === 'contains' || input.op === 'not_contains' || input.op === 'starts_with') return { op: input.op, value: text(input.value, RULE_PACK_LIMITS.literal, path) };
  if (input.op !== 'min_length' && input.op !== 'max_length') invalid(path);
  if (typeof input.value !== 'number' || !Number.isInteger(input.value) || input.value < 0) invalid(path);
  bound(input.value <= RULE_PACK_LIMITS.text, path);
  return { op: input.op, value: input.value };
}
/** Parse bounded exact selectors, including custom statuses and item types. */
function selectors(value: unknown, path: string): NonNullable<AuthoringRule['when']> {
  const input = object(value, [], ['statuses', 'types'], path);
  const result: NonNullable<AuthoringRule['when']> = {};
  for (const key of ['statuses', 'types'] as const) {
    if (!Object.hasOwn(input, key)) continue;
    const entries = input[key];
    if (!Array.isArray(entries) || entries.length === 0) invalid(`${path}.${key}`);
    bound(entries.length <= 32, `${path}.${key}`);
    result[key] = entries.map(/** Selector strings are literal, bounded identifiers. */ entry => text(entry, 64, `${path}.${key}`));
  }
  return result;
}
/** Validate and detach untrusted SDK input before any tracker read. */
export function parseRulePack(value: unknown): RulePack {
  const input = object(value, ['version', 'rules'], [], 'pack');
  if (input.version !== 1 || !Array.isArray(input.rules) || input.rules.length === 0) invalid('pack');
  bound(input.rules.length <= RULE_PACK_LIMITS.rules, 'rules');
  const seen = new Set<string>();
  const rules = input.rules.map(/** Each rule is rebuilt from validated scalar values. */ (value: unknown, index: number): AuthoringRule => {
    const path = `rules[${index}]`;
    const rule = object(value, ['id', 'field', 'predicate', 'severity', 'explanation', 'remedy'], ['when'], path);
    const id = text(rule.id, 64, `${path}.id`);
    if (id !== id.trim() || !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(id) || seen.has(id)) invalid(`${path}.id`);
    seen.add(id);
    if (!RULE_PACK_FIELDS.includes(rule.field as AuthoringRule['field'])) invalid(`${path}.field`);
    if (!['info', 'warn', 'error'].includes(rule.severity as string)) invalid(`${path}.severity`);
    return { id, field: rule.field as AuthoringRule['field'], predicate: predicate(rule.predicate, `${path}.predicate`), severity: rule.severity as Severity, explanation: text(rule.explanation, 256, `${path}.explanation`), remedy: text(rule.remedy, 256, `${path}.remedy`), ...(Object.hasOwn(rule, 'when') ? { when: selectors(rule.when, `${path}.when`) } : {}) };
  });
  const pack: RulePack = { version: 1, rules };
  bound(Buffer.byteLength(JSON.stringify(pack)) <= RULE_PACK_LIMITS.bytes, 'bytes');
  return pack;
}

/** Read at most one bounded regular JSON file; special files never become blocking streams. */
export async function readRulePack(path: string): Promise<RulePack> {
  let value: unknown;
  try {
    // O_NONBLOCK prevents FIFO opens from waiting for a writer; stat rejects special files.
    const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error('regular file required');
      const buffer = Buffer.alloc(RULE_PACK_LIMITS.bytes + 1);
      let used = 0;
      while (used < buffer.length) {
        const { bytesRead } = await handle.read(buffer, used, buffer.length - used, null);
        if (bytesRead === 0) break;
        used += bytesRead;
      }
      bound(used <= RULE_PACK_LIMITS.bytes, 'bytes');
      value = JSON.parse(buffer.subarray(0, used).toString('utf8')) as unknown;
    } finally { await handle.close(); }
  } catch (error) {
    if (error instanceof RulePackRefusal) throw error;
    throw new RulePackRefusal('pack_io', 'Cannot read a regular rule-pack JSON file.', 'Supply one readable UTF-8 JSON file within the documented byte limit.');
  }
  return parseRulePack(value);
}

/** One compact diagnostic carries the organization's explanation and concrete correction. */
export interface RulePackFinding { item_id: string; rule: string; field: AuthoringRule['field']; severity: Severity; explanation: string; remedy: string }
/** Complete receipt retains counts and certification without copying tracker text. */
export interface RulePackResult { version: 1; findings: RulePackFinding[]; count: number; corpus_count: number; checks: number; summary: Record<Severity, number>; complete_list: PmCompleteListCertificate; exit_code: number }

/** Evaluate an assertion in bounded linear literal operations; length counts UTF-16 code units. */
function satisfies(value: string, check: AuthoringPredicate): boolean {
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
  const pack = parseRulePack(input);
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
      const value = item[rule.field] ?? '';
      bound(value.length <= RULE_PACK_LIMITS.text, 'item text');
      if (satisfies(value, rule.predicate)) continue;
      bound(findings.length < RULE_PACK_LIMITS.findings, 'findings');
      findings.push({ item_id: item.id, rule: rule.id, field: rule.field, severity: rule.severity, explanation: rule.explanation, remedy: rule.remedy });
      summary[rule.severity] += 1;
    }
  }
  findings.sort(/** Certified item ids and unique rule ids make each pair distinct; use locale-free ordering. */ (a, b) => (a.item_id === b.item_id ? a.rule < b.rule : a.item_id < b.item_id) ? -1 : 1);
  return { version: 1, findings, count: findings.length, corpus_count: corpus.items.length, checks, summary, complete_list: corpus.complete_list, exit_code: summary.error > 0 ? 1 : 0 };
}
