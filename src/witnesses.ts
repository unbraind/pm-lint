import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { certifyCompleteListResult, splitAcceptanceCriteria } from '@unbrained/pm-cli/sdk';
import type { PmClient, PmCompleteListCertificate } from '@unbrained/pm-cli/sdk';
import { sourceDigest } from './baseline.ts';

/** A declaration of proof, never an instruction to execute code. */
export type CriterionWitness =
  | { kind: 'test'; command: string; path?: string; sha256: string; outcome: 'pass' | 'fail' }
  | { kind: 'test'; path: string; command?: string; sha256: string; outcome: 'pass' | 'fail' }
  | { kind: 'observation'; path: string; sha256: string; outcome: 'pass' | 'fail' }
  | { kind: 'pending'; reason: string };

/** Exact criterion text avoids unstable ordinal links after criteria are reordered. */
export interface CriterionBinding {
  item_id: string;
  criterion: string;
  witnesses: CriterionWitness[];
}

/** Portable sidecar contract; every criterion in the complete tracker is judged. */
export interface WitnessContract { version: 1; bindings: CriterionBinding[] }
/** Stable lint outcomes distinguish absent proof from invalid proof. */
export type WitnessState = 'supported' | 'pending' | 'missing' | 'dangling' | 'stale' | 'contradictory';
/** Compact citation preserves the exact declared spelling, including line anchors. */
export interface WitnessFinding {
  item_id: string;
  criterion: string;
  state: WitnessState;
  citation: string;
  remedy: string;
}
/** Complete counts accompany host-paginatable rows; pending proof cannot pass a gate. */
export interface WitnessResult {
  findings: WitnessFinding[];
  count: number;
  corpus_count: number;
  criteria_count: number;
  summary: Record<WitnessState, number>;
  complete_list: PmCompleteListCertificate;
  exit_code: number;
}
/** Stable input and I/O refusals preserve actionable recovery across SDK and CLI. */
export type WitnessRefusalCode = 'invalid_contract' | 'contract_io' | 'evidence_io' | 'unsafe_citation';
/** Fail closed without echoing filesystem details or untrusted input. */
export class WitnessRefusal extends Error {
  /** Machine-readable failure category. */
  readonly code: WitnessRefusalCode;
  /** Concrete recovery action safe to render in agent receipts. */
  readonly remedy: string;
  /** Carry a machine code and a concrete next action. */
  constructor(code: WitnessRefusalCode, message: string, remedy: string) {
    super(message);
    this.name = 'WitnessRefusal';
    this.code = code;
    this.remedy = remedy;
  }
}

/** Require an exact key set on a plain JSON object. */
function keys(value: unknown, expected: string): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === expected;
}
/** Require bounded nonblank strings without changing their exact citation spelling. */
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= 4096; }
/** Refuse malformed contracts instead of silently treating them as an empty scan. */
function invalid(): never {
  throw new WitnessRefusal('invalid_contract', 'Invalid version 1 witness contract.', 'Use version 1, unique item_id/criterion bindings, and nonempty typed witnesses with exact keys and SHA-256 evidence.');
}
/** Validate and detach all external input before any tracker or evidence read. */
export function parseWitnessContract(value: unknown): WitnessContract {
  if (!keys(value, 'bindings,version') || value.version !== 1 || !Array.isArray(value.bindings)) invalid();
  const seen = new Set<string>();
  for (const binding of value.bindings) {
    if (!keys(binding, 'criterion,item_id,witnesses') || !text(binding.item_id) || !text(binding.criterion) || !Array.isArray(binding.witnesses) || binding.witnesses.length === 0) invalid();
    const identity = JSON.stringify([binding.item_id, binding.criterion]);
    if (seen.has(identity)) invalid();
    seen.add(identity);
    for (const witness of binding.witnesses) {
      if (keys(witness, 'kind,reason') && witness.kind === 'pending' && text(witness.reason)) continue;
      if (!validEvidence(witness)) invalid();
      if ((witness.outcome !== 'pass' && witness.outcome !== 'fail') || typeof witness.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(witness.sha256)) invalid();
    }
  }
  return structuredClone(value) as unknown as WitnessContract;
}

/** Accept exact core test identities, including path-only tests, and file observations. */
function validEvidence(value: unknown): value is Record<string, unknown> {
  if (keys(value, 'kind,outcome,path,sha256')) return (value.kind === 'test' || value.kind === 'observation') && text(value.path);
  if (keys(value, 'command,kind,outcome,sha256')) return value.kind === 'test' && text(value.command);
  return keys(value, 'command,kind,outcome,path,sha256') && value.kind === 'test' && text(value.command) && text(value.path);
}

/** Hash exact file bytes so whitespace and content drift remain observable. */
export function observationDigest(bytes: string | Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
/** Load only the explicit sidecar; never discover a git root or infer links from prose. */
export async function readWitnessContract(path: string): Promise<WitnessContract> {
  let value: unknown;
  try { value = JSON.parse(await readFile(path, 'utf8')); } catch {
    throw new WitnessRefusal('contract_io', 'Cannot read witness JSON.', 'Supply --contract with a readable version 1 JSON document.');
  }
  return parseWitnessContract(value);
}

/** Test a resolved path against the caller-selected evidence root. */
function within(root: string, path: string): boolean {
  const tail = relative(root, path);
  return tail !== '..' && !tail.startsWith(`..${sep}`) && !isAbsolute(tail);
}
/** Read a repository-relative citation without following escapes or invoking git. */
async function observationState(root: string, witness: Extract<CriterionWitness, { kind: 'observation' }>): Promise<WitnessState> {
  // A line suffix is a citation only; the digest binds the entire file.
  const path = witness.path.replace(/#L\d+(?:-L\d+)?$|:\d+(?::\d+)?$/, '');
  if (isAbsolute(path) || !within(resolve(root), resolve(root, path))) throw new WitnessRefusal('unsafe_citation', 'Observation escapes the evidence root.', 'Use a relative file citation inside the selected evidence root.');
  try {
    const canonicalRoot = await realpath(root);
    const target = await realpath(resolve(root, path));
    if (!within(canonicalRoot, target)) throw new WitnessRefusal('unsafe_citation', 'Observation symlink escapes the evidence root.', 'Use a file whose resolved target remains inside the evidence root.');
    return observationDigest(await readFile(target)) === witness.sha256 ? 'supported' : 'stale';
  } catch (error) {
    if (error instanceof WitnessRefusal) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return 'dangling';
    throw new WitnessRefusal('evidence_io', 'Cannot read observation evidence.', 'Make the cited artifact a readable regular file, then retry.');
  }
}

/** Recovery messages are stable and bounded instead of copying source evidence. */
const REMEDIES: Record<WitnessState, string> = {
  supported: '', pending: 'Collect the explicitly pending proof, then replace its declaration.',
  missing: 'Declare a test, observation or explicit pending proof for this exact criterion.',
  dangling: 'Restore the cited item, linked test or observation, or correct the declaration.',
  stale: 'Review changed criteria or evidence and refresh the exact declaration and digest.',
  contradictory: 'Resolve failing or conflicting outcome declarations before claiming support.',
};

/** Check declared contracts against certified tracker state; never execute a linked test. */
export async function lintWitnesses(client: PmClient, contract: WitnessContract, evidenceRoot: string): Promise<WitnessResult> {
  const checked = parseWitnessContract(contract);
  const corpus = certifyCompleteListResult(await client.listAllComplete());
  const items = new Map(corpus.items.map(/** Index certified items once. */ item => [item.id, item]));
  const criteria = new Map(corpus.items.map(/** Let core own criterion boundary semantics. */ item => [item.id, splitAcceptanceCriteria(item.acceptance_criteria)]));
  const findings: WitnessFinding[] = [];
  const summary: Record<WitnessState, number> = { supported: 0, pending: 0, missing: 0, dangling: 0, stale: 0, contradictory: 0 };
  /** Record every declaration separately so stale evidence never conceals contradiction. */
  function add(item_id: string, criterion: string, state: WitnessState, citation = ''): void {
    findings.push({ item_id, criterion, state, citation, remedy: REMEDIES[state] });
    summary[state] += 1;
  }
  const bound = new Set<string>();
  for (const binding of checked.bindings) {
    const { item_id, criterion } = binding;
    bound.add(JSON.stringify([item_id, criterion]));
    const item = items.get(item_id);
    if (item === undefined) { add(item_id, criterion, 'dangling'); continue; }
    if (!criteria.get(item_id)!.includes(criterion)) { add(item_id, criterion, 'stale'); continue; }
    for (const witness of binding.witnesses) {
      if (witness.kind === 'pending') { add(item_id, criterion, 'pending'); continue; }
      let state: WitnessState;
      let citation: string;
      if (witness.kind === 'observation') {
        citation = witness.path;
        state = await observationState(evidenceRoot, witness);
      } else {
        citation = witness.path ?? witness.command!;
        const matches = (item.tests ?? []).filter(/** Every supplied identity field must match exactly. */ entry => (witness.command === undefined || entry.command === witness.command) && (witness.path === undefined || entry.path === witness.path));
        state = matches.length === 0 ? 'dangling' : matches.length > 1 ? 'contradictory' : sourceDigest(matches[0]) === witness.sha256 ? 'supported' : 'stale';
      }
      if (state !== 'supported' || witness.outcome !== 'fail') add(item_id, criterion, state, citation);
      if (witness.outcome === 'fail') add(item_id, criterion, 'contradictory', citation);
    }
  }
  let criteriaCount = 0;
  for (const [id, entries] of criteria) {
    criteriaCount += entries.length;
    for (const criterion of entries) if (!bound.has(JSON.stringify([id, criterion]))) add(id, criterion, 'missing');
  }
  findings.sort(/** Deterministic output ignores scan and contract order. */ (a, b) => a.item_id.localeCompare(b.item_id) || a.criterion.localeCompare(b.criterion) || a.citation.localeCompare(b.citation) || a.state.localeCompare(b.state));
  return { findings, count: findings.length, corpus_count: corpus.items.length, criteria_count: criteriaCount, summary, complete_list: corpus.complete_list, exit_code: findings.some(/** Explicit pending proof remains unfinished. */ row => row.state !== 'supported') ? 1 : 0 };
}
