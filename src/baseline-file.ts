import { open, readFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { acknowledgeFinding, BaselineRefusal, parseBaseline } from './baseline.ts';
import type { Acknowledgment, LintBaseline } from './baseline.ts';
import type { Finding } from './types.ts';
import { prepareSidecarPublication, readSidecarSnapshot, removeOwnedStage, SidecarConflict } from './sidecar-publication.ts';

/** Read an explicit baseline; only acknowledgment creation may start from a missing file. */
export async function readBaseline(path: string, allowMissing = false): Promise<LintBaseline> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, acknowledgments: [] };
    throw new BaselineRefusal('baseline_io', 'Cannot read the baseline.', 'Check that the baseline file exists and is readable; use lint acknowledge to create it.');
  }
  return baselineFromText(text);
}

/** Validate exactly the baseline bytes observed under the publication lock. */
function baselineFromText(text: string): LintBaseline {
  let value: unknown;
  try { value = JSON.parse(text); } catch {
    throw new BaselineRefusal('invalid_baseline', 'Baseline is not valid JSON.', 'Restore a valid baseline document before retrying.');
  }
  return parseBaseline(value);
}

/** Serialize cooperating writers with exclusive creation and publish one complete atomic document. */
export async function acknowledgeBaselineFile(path: string, findings: readonly Finding[], request: Acknowledgment): Promise<LintBaseline> {
  const lockPath = `${path}.lock`;
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new BaselineRefusal('baseline_busy', 'Another baseline writer holds the lock.', 'Retry after the writer finishes; remove an abandoned lock only after verifying no writer remains.');
    throw new BaselineRefusal('baseline_io', 'Cannot create the baseline lock.', 'Choose a writable baseline file in an existing directory.');
  }
  try {
    return await publishBaseline(lock, path, findings, request);
  } catch (error) {
    if (error instanceof BaselineRefusal) throw error;
    if (error instanceof SidecarConflict) throw new BaselineRefusal('evidence_changed', error.message, 'Read the current baseline and retry; peer and foreign files were preserved.');
    throw new BaselineRefusal('baseline_io', 'Cannot publish the baseline.', 'Check baseline permissions and available storage, then retry.');
  }
}

/** Retain exclusive ownership until publication, cleaning up only this writer's unpublished lock. */
async function publishBaseline(lock: FileHandle, path: string, findings: readonly Finding[], request: Acknowledgment): Promise<LintBaseline> {
  const lockPath = `${path}.lock`;
  const owned = await lock.stat({ bigint: true });
  let publication;
  try {
    const observed = readSidecarSnapshot(path, Number.MAX_SAFE_INTEGER);
    const baseline = acknowledgeFinding(findings, observed === undefined ? { version: 1, acknowledgments: [] } : baselineFromText(observed.bytes.toString('utf8')), request);
    publication = await prepareSidecarPublication(path, `${JSON.stringify(baseline, null, 2)}\n`, observed, Number.MAX_SAFE_INTEGER, { path: lockPath, handle: lock });
    publication.commit();
    return baseline;
  } finally {
    if (publication === undefined) { await lock.close(); removeOwnedStage(lockPath, owned); }
    else publication.dispose();
  }
}
