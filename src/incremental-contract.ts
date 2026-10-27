import { sourceDigest } from './baseline.ts';
import { RULES } from './rules.ts';
import type { ItemMetadata, MutationEventPage } from '@unbrained/pm-cli/sdk';
import type { RuleCode } from './types.ts';

/** Strict resource ceilings; exhaustion refuses rather than truncating a complete result. */
export const INCREMENTAL_LIMITS = { items: 50000, bytes: 64 * 1024 * 1024, events: 1000000, time: 8640000000000000 } as const;

/** Dependencies of a predicate, separate from freshly rendered finding evidence. */
export interface RuleDependency { fields: readonly (keyof ItemMetadata)[]; global: boolean }

/** Global predicates always run: clock, hierarchy, local references and SDK duplicate clusters. */
export const RULE_DEPENDENCIES: Readonly<Record<RuleCode, RuleDependency>> = {
  PML001: { fields: ['title'], global: false },
  PML002: { fields: ['type', 'acceptance_criteria'], global: false },
  PML003: { fields: ['title', 'acceptance_criteria'], global: false },
  PML004: { fields: ['title', 'resolution', 'actual_result', 'close_reason', 'closed_at', 'comments'], global: false },
  PML005: { fields: [], global: true },
  PML006: { fields: ['type', 'files', 'tests'], global: false },
  PML007: { fields: [], global: true },
  PML008: { fields: ['title', 'description', 'notes'], global: false },
  PML009: { fields: [], global: true },
  PML010: { fields: [], global: true },
};

/** Saved predicate inputs, bounded display excerpts and a ten-bit violation set. */
export interface IncrementalItemState { id: string; source_digest: string; inputs: string[]; excerpts: string[]; violations: number }
/** SDK cursor plus an anchor whose continued existence is checked through the SDK. */
export interface IncrementalCursor { value: string; item_id: string; version: number; ts: string }
/** Portable, checksummed checkpoint owned exclusively by this package. */
export interface IncrementalCheckpoint {
  owner: 'pm-lint-incremental';
  format: 1;
  rule_version: string;
  policy_digest: string;
  source_id: string;
  cursor: IncrementalCursor | null;
  items: IncrementalItemState[];
  digest: string;
}
/** Controls accepted at the SDK boundary; a rebuild must be explicit. */
export interface IncrementalRequest { rebuild?: boolean; checkpoint?: IncrementalCheckpoint; now?: number }
/** Machine categories with concrete recovery instructions on every refusal. */
export type IncrementalRefusalCode = 'invalid_input' | 'rebuild_required' | 'foreign_state' | 'rule_drift' | 'policy_drift' | 'cursor_lost' | 'source_changed' | 'limit_exceeded' | 'state_busy' | 'state_io';

/** Typed, privacy-conscious refusal shared by SDK and CLI. */
export class IncrementalRefusal extends Error {
  /** Stable machine-readable category. */
  readonly code: IncrementalRefusalCode;
  /** Concrete next action without private source details. */
  readonly remedy: string;
  /** Keep diagnostics independent of untrusted content and local paths. */
  constructor(code: IncrementalRefusalCode, message: string, remedy = 'Run lint incremental --state <file> --rebuild to create a fresh complete checkpoint.') {
    super(message);
    this.name = 'IncrementalRefusal';
    this.code = code;
    this.remedy = remedy;
  }
}

/** One strict schema primitive for versioned request and checkpoint records. */
function record(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) || required.some(/** Required keys cannot be inherited or omitted. */ key => !Object.hasOwn(value, key)) || Object.keys(value).some(/** Refuse misspelled or unsupported controls. */ key => !required.includes(key) && !optional.includes(key))) invalid();
  return value as Record<string, unknown>;
}
/** A schema failure never silently creates an empty successful checkpoint. */
function invalid(): never {
  throw new IncrementalRefusal('invalid_input', 'Invalid incremental request or checkpoint schema.', 'Correct the documented request fields; for damaged state, preserve it and choose a new state file with --rebuild.');
}
/** Require dense bounded arrays, including when callers bypass JSON transport. */
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max || Object.keys(value).length !== value.length || Array.from({ length: value.length }, /** Sparse positions must be owned values. */ (_, i) => !Object.hasOwn(value, i)).some(Boolean)) invalid();
  return value;
}
/** Keep literal identifiers readable across old tracker formats without imposing a new ID alphabet. */
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) invalid();
  return value;
}
/** Check exact finite integer domains before any successful numeric output. */
export function incrementalInteger(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) invalid();
  return value;
}
/** Apply the same hard limits to validated input, source receipts and checkpoint producers. */
export function assertIncrementalLimit(value: number, max: number): void {
  if (value > max) throw new IncrementalRefusal('limit_exceeded', 'Incremental scan exceeds a documented resource ceiling.', 'Use a tracker and history within the documented item, event and checkpoint byte ceilings; never truncate a scan.');
}
/** Validate continuation progress independently of the SDK transport; fuzzable with real page data. */
export function assertIncrementalPage(page: MutationEventPage, seen: ReadonlySet<string>): void {
  incrementalInteger(page.count, 1000);
  if (page.count !== page.events.length || (page.has_more && page.count === 0) || (page.count > 0 && (page.next_cursor === undefined || seen.has(page.next_cursor)))) throw new IncrementalRefusal('cursor_lost', 'SDK pagination did not supply a complete progressing page.');
}
/** Validate every emitted numeric leaf, including future receipt fields and per-rule totals. */
export function validateIncrementalNumbers(value: unknown): void {
  if (typeof value === 'number') incrementalInteger(value, Number.MAX_SAFE_INTEGER);
  else if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) validateIncrementalNumbers(child);
  }
}
/** Validate producer digests without accepting truncated evidence. */
function digest(value: unknown): string {
  const hash = text(value, 64);
  if (!/^[a-f0-9]{64}$/.test(hash)) invalid();
  return hash;
}

/** Validate and detach an imported checkpoint using the same schema as every producer. */
export function parseIncrementalCheckpoint(value: unknown): IncrementalCheckpoint {
  const row = record(value, ['owner', 'format', 'rule_version', 'policy_digest', 'source_id', 'cursor', 'items', 'digest']);
  if (row.owner !== 'pm-lint-incremental') throw new IncrementalRefusal('foreign_state', 'Checkpoint belongs to another producer; it was skipped.', 'Choose a separate checkpoint file; foreign records are never overwritten.');
  if (row.format !== 1) invalid();
  let cursor: IncrementalCursor | null = null;
  if (row.cursor !== null) {
    const entry = record(row.cursor, ['value', 'item_id', 'version', 'ts']);
    cursor = { value: text(entry.value, 4096), item_id: text(entry.item_id, 4096), version: incrementalInteger(entry.version, Number.MAX_SAFE_INTEGER), ts: text(entry.ts, 64) };
    if (cursor.version === 0 || !Number.isFinite(Date.parse(cursor.ts))) invalid();
  }
  const seen = new Set<string>();
  const items = array(row.items, INCREMENTAL_LIMITS.items).map(/** Rebuild each row from validated primitives; never normalize native item data. */ value => {
    const item = record(value, ['id', 'source_digest', 'inputs', 'excerpts', 'violations']);
    const id = text(item.id, 4096);
    if (seen.has(id)) invalid();
    seen.add(id);
    const inputs = array(item.inputs, RULES.length).map(/** Empty input digests identify declared global checks. */ value => value === '' ? '' : digest(value));
    if (inputs.length !== RULES.length) invalid();
    const excerpts = array(item.excerpts, RULES.length).map(/** Blank excerpts represent absence findings or clean pairs. */ value => {
      if (typeof value !== 'string' || value.length > 160) invalid();
      return value;
    });
    if (excerpts.length !== RULES.length) invalid();
    return { id, source_digest: digest(item.source_digest), inputs, excerpts, violations: incrementalInteger(item.violations, (1 << RULES.length) - 1) };
  });
  const checkpoint: IncrementalCheckpoint = { owner: row.owner, format: row.format, rule_version: text(row.rule_version, 128), policy_digest: digest(row.policy_digest), source_id: digest(row.source_id), cursor, items, digest: digest(row.digest) };
  const { digest: checksum, ...payload } = checkpoint;
  if (sourceDigest(payload) !== checksum) invalid();
  assertIncrementalLimit(Buffer.byteLength(JSON.stringify(checkpoint)), INCREMENTAL_LIMITS.bytes);
  return checkpoint;
}

/** Parse the only incremental request schema before accessing any SDK source. */
export function parseIncrementalRequest(value: unknown): IncrementalRequest {
  const input = record(value, [], ['rebuild', 'checkpoint', 'now']);
  const request: IncrementalRequest = {};
  if (input.rebuild !== undefined) {
    if (typeof input.rebuild !== 'boolean') invalid();
    request.rebuild = input.rebuild;
  }
  if (input.now !== undefined) request.now = incrementalInteger(input.now, INCREMENTAL_LIMITS.time);
  if (input.checkpoint !== undefined) request.checkpoint = parseIncrementalCheckpoint(input.checkpoint);
  return request;
}
