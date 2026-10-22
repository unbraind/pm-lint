import { getSettingsPath, readFileIfExists, readSettings } from '@unbrained/pm-cli/sdk';
import { RULES } from './rules.ts';
import type { LintConfig, RuleCode, RuleConfig, RuleScope, Severity } from './types.ts';
import type { LintBaseline } from './baseline.ts';

/** CLI overrides and item filters accepted by both extension and embedded callers. */
export interface LintOptions {
  baseline?: LintBaseline;
  rule?: string[];
  disable?: string[];
  severity?: string;
  failOn?: string;
  type?: string;
  status?: string;
  id?: string[];
  since?: string;
}

/** Reject non-object configuration instead of silently applying defaults. */
export function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected a lint settings object');
  return value as Record<string, unknown>;
}

/** Validate stable diagnostic severities used in configuration and exit policy. */
export function severityValue(value: unknown): Severity {
  if (value !== 'error' && value !== 'warn' && value !== 'info') throw new Error('Severity must be error, warn or info');
  return value;
}

/** Documented lifecycle slices a rule can be scoped to through settings. */
export const RULE_SCOPES: readonly RuleScope[] = ['all', 'non_terminal', 'active', 'terminal', 'closed', 'canceled', 'open', 'in_progress', 'blocked'];

/** Validate one rule lifecycle scope against the documented vocabulary. */
export function scopeValue(value: unknown): RuleScope {
  if (typeof value !== 'string' || !RULE_SCOPES.includes(value as RuleScope)) throw new Error('Scope must be all, non_terminal, active, terminal, closed, canceled, open, in_progress or blocked');
  return value as RuleScope;
}

/** Reject misspelled rule codes so a purported CI gate cannot silently do less work. */
export function ruleCode(value: unknown): RuleCode {
  const rule = RULES.find(/** Match the public stable code table. */ entry => entry.code === value);
  if (!rule) throw new Error('Unknown lint rule code');
  return rule.code;
}

/** Validate enable and disable lists from the persisted lint section. */
function codeList(value: unknown): RuleCode[] {
  if (!Array.isArray(value)) throw new Error('Lint rule lists must be arrays');
  return value.map(/** Validate each code independently. */ entry => ruleCode(entry));
}

/** Read extension settings with the public SDK, preserving its currently stripped custom section. */
export async function readLintSettings(pmRoot: string): Promise<unknown> {
  await readSettings(pmRoot);
  // SDK readSettings validates core settings but strips extension-owned keys.
  const text = await readFileIfExists(getSettingsPath(pmRoot));
  return lintSettingsFromText(text);
}

/** Parse SDK settings bytes and reject a settings file lost during a concurrent read. */
export function lintSettingsFromText(text: string | null): unknown {
  if (text === null) throw new Error('Tracker settings disappeared during lint read');
  const raw: unknown = JSON.parse(text);
  return objectValue(raw).lint;
}

/** Validate parameters supported by each rule, rejecting typos and unsafe numeric windows. */
function parametersFor(code: RuleCode, value: unknown): Record<string, number> {
  const parameters = objectValue(value);
  const result: Record<string, number> = {};
  for (const [key, number] of Object.entries(parameters)) {
    const validKey = (code === 'PML005' && key === 'staleDays') || (code === 'PML010' && key === 'threshold');
    if (!validKey || typeof number !== 'number' || !Number.isFinite(number) || number <= 0 || (key === 'threshold' && number > 1)) throw new Error('Invalid lint rule parameter');
    result[key] = number;
  }
  return result;
}

/** Merge defaults, persisted policy and explicit CLI overrides without mutating input objects. */
export function resolveConfig(raw: unknown, options: LintOptions = {}): LintConfig {
  const section = raw === undefined ? {} : objectValue(raw);
  const rules = Object.fromEntries(RULES.map(/** Start every rule with its documented defaults. */ rule => [rule.code, { enabled: true, severity: rule.severity, scope: rule.scope, parameters: {} }])) as Record<RuleCode, RuleConfig>;
  for (const key of Object.keys(section)) {
    if (!['enable', 'disable', 'rules', 'failOn'].includes(key)) throw new Error('Unknown lint settings key');
  }
  for (const code of section.enable === undefined ? [] : codeList(section.enable)) rules[code].enabled = true;
  for (const code of section.disable === undefined ? [] : codeList(section.disable)) rules[code].enabled = false;
  if (section.rules !== undefined) {
    for (const [key, value] of Object.entries(objectValue(section.rules))) {
      const code = ruleCode(key);
      const entry = objectValue(value);
      for (const property of Object.keys(entry)) {
        if (!['enabled', 'severity', 'scope', 'parameters'].includes(property)) throw new Error('Unknown per-rule lint settings key');
      }
      if (entry.enabled !== undefined) {
        if (typeof entry.enabled !== 'boolean') throw new Error('Rule enabled must be boolean');
        rules[code].enabled = entry.enabled;
      }
      if (entry.severity !== undefined) rules[code].severity = severityValue(entry.severity);
      if (entry.scope !== undefined) rules[code].scope = scopeValue(entry.scope);
      if (entry.parameters !== undefined) rules[code].parameters = parametersFor(code, entry.parameters);
    }
  }
  if (options.rule !== undefined) {
    const selected = new Set(codeList(options.rule));
    for (const rule of RULES) rules[rule.code].enabled = selected.has(rule.code);
  }
  for (const code of options.disable === undefined ? [] : codeList(options.disable)) rules[code].enabled = false;
  if (options.severity !== undefined) {
    const severity = severityValue(options.severity);
    for (const rule of RULES) rules[rule.code].severity = severity;
  }
  return { rules, failOn: severityValue(options.failOn ?? section.failOn ?? 'error') };
}
