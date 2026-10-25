import { decode } from '@toon-format/toon';
import { createHash, randomUUID } from 'node:crypto';
import { PmClient, certifyCompleteListResult, getSettingsPath, locateItem, readSettings, resolveItemTypeRegistry, splitFrontMatter, planItemMutationDocument, previewItemMutations, readFileIfExists, toImportTags, toNonEmptyImportString } from '@unbrained/pm-cli/sdk';
import type { ItemMetadata, ItemMutationPreviewValidation, PmCompleteListResult } from '@unbrained/pm-cli/sdk';
import { REPAIR_EXCLUDED_STATE, withRepairSnapshot } from './repair-snapshot.ts';
import { sourceDigest } from './baseline.ts';
import { lintCorpus } from './engine.ts';
import { lintSettingsFromText, resolveConfig } from './settings.ts';
import type { RuleCode } from './types.ts';

/** Actionable refusal categories; a refusal never contains a usable patch. */
export type RepairRefusalCode = 'invalid_request' | 'unknown_item' | 'stale_revision' | 'limit_exceeded' | 'unsafe_repair';

/** Typed refusal shared by embedded callers and the host renderer. */
export class RepairRefusal extends Error {
  /** Stable machine-readable category. */
  readonly code: RepairRefusalCode;
  /** Concrete recovery action for the caller. */
  readonly remedy: string;
  /** Preserve a stable machine code and a concrete next action without exposing source paths. */
  constructor(code: RepairRefusalCode, message: string, remedy: string) {
    super(message);
    this.name = 'RepairRefusal';
    this.code = code;
    this.remedy = remedy;
  }
}

/** Single-target request; resubmitting observed evidence requires the exact source revision. */
export interface RepairRequest {
  id: string;
  revision?: string;
}

/** Mechanical edits only; substantive metadata and relationships cannot be authored here. */
export interface RepairPatch {
  title?: string;
  tags?: string[];
}

/** A concrete surface defect explained without copying unrelated tracker text. */
export interface MechanicalFinding {
  code: 'title_whitespace' | 'tag_normalization';
  field: 'title' | 'tags';
}

/** Explicit substantive question, never a proposed answer or acceptance criterion. */
export interface RepairQuestion {
  code: RuleCode | 'missing_expected_behavior';
  field: string;
  question: string;
}

/** Compact observational receipt; patches require fresh application-time revision checks by the caller. */
export interface RepairPreview {
  version: 1;
  id: string;
  revision: string;
  plan_key: string;
  corpus_count: number;
  writes: 0;
  findings: MechanicalFinding[];
  patch: RepairPatch;
  questions: RepairQuestion[];
  validation: ItemMutationPreviewValidation | null;
  remaining_mechanical: number;
  /** Foreign operational state is excluded without reading, replaying or deleting it. */
  excluded_state: Readonly<Record<string, string>>;
}

/** Stable author questions for existing lint diagnostics; no text is invented for the item. */
const QUESTIONS: Record<RuleCode, string> = {
  PML001: 'What concrete action and scope should the title name?',
  PML002: 'What observable expected behavior proves this work is complete?',
  PML003: 'What measurable outcome should replace the vague criterion?',
  PML004: 'What observed result or evidence supports closure?',
  PML005: 'What is the current work state, and should the claim remain active?',
  PML006: 'Which implementation files or reproducible tests support this feature?',
  PML007: 'Which concrete child item belongs to this epic?',
  PML008: 'What context, constraints or evidence should supplement the title?',
  PML009: 'What blocks this work, and which current item identifies the blocker?',
  PML010: 'How does this work differ from the duplicate candidates, or which item is canonical?',
};

/** Reuse core import normalization for the two explicitly supported mechanical surfaces. */
export function mechanicalRepairs(item: ItemMetadata, originalTags: unknown = item.tags): { findings: MechanicalFinding[]; patch: RepairPatch } {
  const findings: MechanicalFinding[] = [];
  const patch: RepairPatch = {};
  const title = toNonEmptyImportString(item.title);
  if (title !== undefined && title !== item.title) {
    findings.push({ code: 'title_whitespace', field: 'title' });
    patch.title = title;
  }
  const tags = toImportTags(item.tags);
  if (JSON.stringify(tags) !== JSON.stringify(originalTags)) {
    findings.push({ code: 'tag_normalization', field: 'tags' });
    patch.tags = tags;
  }
  return { findings, patch };
}

/** Refuse malformed JavaScript requests as strictly as CLI flags. */
function assertRequest(request: RepairRequest): void {
  if (!request || typeof request.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(request.id) || Object.keys(request).some(/** Unknown controls cannot silently enable application. */ key => !['id', 'revision'].includes(key)) || (request.revision !== undefined && (typeof request.revision !== 'string' || !/^[a-f0-9]{64}$/.test(request.revision)))) {
    throw new RepairRefusal('invalid_request', 'One canonical item id and an optional SHA-256 revision are required.', 'Supply an item id; reuse the revision from a fresh repair preview when checking saved context.');
  }
}

/** Hash all certified context so concurrent peer edits cannot silently change relationship-dependent questions. */
function contextRevision(source: PmCompleteListResult, settings: string | null): string {
  const items = certifyCompleteListResult(source).items.map(/** Bind all native fields, not just the proposed patch content. */ item => [item.id, sourceDigest(item)]).sort(/** Canonical ids make scan ordering irrelevant. */ (left, right) => left[0].localeCompare(right[0]));
  return createHash('sha256').update(JSON.stringify([items, settings])).digest('hex');
}

/** Read boundaries available to deterministic interleaving tests and observational instrumentation. */
export type RepairBoundary = 'snapshot_read' | 'settings_read' | 'source_read' | 'planned' | 'validated' | 'source_rechecked';

/** Optional observational instrumentation; it cannot supply or replace tracker state. */
export interface RepairPreviewOptions {
  onBoundary?: (boundary: RepairBoundary) => Promise<void>;
}

/** Assemble fresh single-item repair context and validate through core without writing source state. */
export async function previewAuthoringRepairs(pmRoot: string, request: RepairRequest, options: RepairPreviewOptions = {}): Promise<RepairPreview> {
  assertRequest(request);
  return withRepairSnapshot(pmRoot, /** No SDK read or disposable validation can write into the source tracker. */ snapshot => buildRepairPreview(snapshot, request, options), options.onBoundary === undefined ? undefined : /** Surface the copy boundary without exposing scratch paths. */ () => options.onBoundary!('snapshot_read'));
}

/** Read and validate exclusively in an owned disposable snapshot. */
async function buildRepairPreview(pmRoot: string, request: RepairRequest, options: RepairPreviewOptions): Promise<RepairPreview> {
  const client = new PmClient({ pmRoot, noExtensions: true });
  const settings = await readFileIfExists(getSettingsPath(pmRoot));
  await options.onBoundary?.('settings_read');
  const config = resolveConfig(lintSettingsFromText(settings));
  const nativeSettings = await readSettings(pmRoot);
  const registry = resolveItemTypeRegistry(nativeSettings);
  // Preserve pre-migration bytes: the pinned SDK may canonicalize legacy Markdown while reading.
  const located = await locateItem(pmRoot, request.id, nativeSettings.id_prefix, nativeSettings.item_format, registry.type_to_folder);
  const raw = located === null ? null : await readFileIfExists(located.itemPath);
  const source = await client.listAllComplete();
  const corpus = certifyCompleteListResult(source);
  const item = corpus.items.find(/** Only canonical identities are accepted. */ row => row.id === request.id);
  if (item === undefined) throw new RepairRefusal('unknown_item', 'The requested item is absent from the certified tracker.', 'Select a current item id from pm list and request a new preview.');
  await options.onBoundary?.('source_read');
  const revision = createHash('sha256').update(JSON.stringify([sourceDigest(item), raw])).digest('hex');
  if (request.revision !== undefined && request.revision !== revision) throw staleRevision();
  const context = contextRevision(source, settings);
  const original = located!.item_format === 'toon' ? decode(raw!) : JSON.parse(splitFrontMatter(raw!).frontMatter) as unknown;
  const { findings, patch } = mechanicalRepairs(item, (original as Record<string, unknown>).tags);
  if (Buffer.byteLength(JSON.stringify(patch)) > 16384) throw new RepairRefusal('limit_exceeded', 'The mechanical patch exceeds 16 KiB.', 'Review this item directly with pm get --full; repair the oversized field explicitly.');
  const questions: RepairQuestion[] = lintCorpus(source, config, { id: [item.id] }).findings.map(/** Existing diagnostics become questions without generating answers. */ finding => ({ code: finding.rule, field: finding.field, question: QUESTIONS[finding.rule] }));
  if (item.type === 'Issue' && toNonEmptyImportString(item.expected_result) === undefined) questions.push({ code: 'missing_expected_behavior', field: 'expected_result', question: 'What should happen for the reported reproduction steps?' });
  const planKey = createHash('sha256').update(JSON.stringify([1, revision, context, patch])).digest('hex');
  let validation: ItemMutationPreviewValidation | null = null;
  if (findings.length > 0) {
    try {
      const plan = await planItemMutationDocument({ pmRoot, transactionId: `lint-repair-${planKey}`, input: JSON.stringify([{ op: 'update', id: item.id, options: { ...patch, ...(patch.tags === undefined ? {} : { tags: JSON.stringify(patch.tags) }) } }]) });
      await options.onBoundary?.('planned');
      // A fresh disposable validation identity avoids replaying a source journal, including foreign records.
      validation = await previewItemMutations({ pmRoot, author: 'lint-preview', transactionId: `lint-preview-${randomUUID()}`, mutations: plan.mutations });
    } catch {
      throw new RepairRefusal('unsafe_repair', 'Core could not freshly validate the proposed repair.', 'Run pm validate and inspect ownership/schema constraints; refresh the preview after resolving them.');
    }
  }
  await options.onBoundary?.('validated');
  await options.onBoundary?.('source_rechecked');
  return { version: 1, id: item.id, revision, plan_key: planKey, corpus_count: corpus.items.length, writes: 0, findings, patch, questions, validation, excluded_state: { ...REPAIR_EXCLUDED_STATE }, remaining_mechanical: mechanicalRepairs({ ...item, ...patch }).findings.length };
}

/** Explain stale evidence without ever returning a frozen patch for reuse. */
function staleRevision(): RepairRefusal {
  return new RepairRefusal('stale_revision', 'The source revision or preview context changed.', 'Read a new preview and review its revision; never apply the saved patch against a changed target.');
}
