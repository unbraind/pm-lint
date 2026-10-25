import { createHash } from 'node:crypto';
import { chmod, cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { RepairRefusal } from './repairs.ts';

/** Operational state and executable extensions are foreign to an observational authoring snapshot. */
export const REPAIR_EXCLUDED_STATE: Readonly<Record<string, string>> = { runtime: 'foreign operational state', locks: 'peer ownership', extensions: 'executable state', transactions: 'foreign journals', checkpoints: 'foreign recovery state', search: 'derived indexes' };

/** Resolve excluded root entries once for snapshot copying and fingerprints. */
const SKIPPED = new Set(Object.keys(REPAIR_EXCLUDED_STATE));

/** Fingerprint regular source files and names without creating SDK caches in the source tracker. */
async function fingerprint(root: string): Promise<string> {
  const hash = createHash('sha256');
  /** Recurse only inside the selected tracker and refuse links or special files. */
  async function visit(directory: string): Promise<void> {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort(/** Stable source ordering makes copy checks deterministic. */ (a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (SKIPPED.has(relative(root, path).split(/[\\/]/)[0])) continue;
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) { const bytes = await readFile(path); hash.update(JSON.stringify([relative(root, path), bytes.length])); hash.update(bytes); }
      else throw new RepairRefusal('unsafe_repair', 'Repair context requires regular tracker files.', 'Replace symbolic links or special files with ordinary tracker files before requesting a preview.');
    }
  }
  await visit(root);
  return hash.digest('hex');
}

/** Isolate SDK read-side caches, validate copy stability and discard only this invocation's own scratch directory. */
export async function withRepairSnapshot<T>(source: string, read: (snapshot: string) => Promise<T>, onSnapshotRead?: () => Promise<void>): Promise<T> {
  const before = await fingerprint(source);
  const scratch = await mkdtemp(join(tmpdir(), 'pm-lint-repair-'));
  try {
    const snapshot = join(scratch, 'tracker');
    await onSnapshotRead?.();
    await cp(source, snapshot, { recursive: true, dereference: false, filter: /** Foreign state is never followed or copied. */ path => !SKIPPED.has(relative(source, path).split(/[\\/]/)[0]) });
    if (await fingerprint(snapshot) !== before) throw changed();
    await writableDirectories(snapshot);
    const result = await read(snapshot);
    if (await fingerprint(source) !== before) throw changed();
    return result;
  } finally { await writableDirectories(scratch); await rm(scratch, { recursive: true, force: true }); }
}

/** A changed source invalidates the whole single-target receipt, including its substantive questions. */
function changed(): RepairRefusal {
  return new RepairRefusal('stale_revision', 'Tracker bytes changed during the repair preview.', 'Request a fresh preview; review its current revision before using any patch.');
}

/** Source permissions stay untouched; owned scratch directories must allow SDK writes and reliable cleanup. */
async function writableDirectories(root: string): Promise<void> {
  await chmod(root, 0o700);
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory()) await writableDirectories(join(root, entry.name));
  }
}
