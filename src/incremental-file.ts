import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireLockLease, certifyCompleteListResult, listMutationEvents, PmClient } from '@unbrained/pm-cli/sdk';
import { sourceDigest } from './baseline.ts';
import { INCREMENTAL_LIMITS, IncrementalRefusal, parseIncrementalCheckpoint, parseIncrementalRequest } from './incremental-contract.ts';
import type { IncrementalCheckpoint } from './incremental-contract.ts';
import { lintIncremental } from './incremental.ts';
import type { IncrementalBoundary, IncrementalLintResult, IncrementalLintSource } from './incremental.ts';
import { readLintSettings, resolveConfig } from './settings.ts';
import { readLintStatuses } from './statuses.ts';
import { prepareSidecarPublication, readSidecarSnapshot, SidecarConflict } from './sidecar-publication.ts';

/** File-wrapper boundaries let integration tests inject real peer transitions at every await. */
export type IncrementalFileBoundary = IncrementalBoundary | 'locked' | 'loaded' | 'publish' | 'published' | 'release';

/** Bind core SDK capabilities to one explicit local tracker; never resolve a host from argv or symlinks. */
export function filesystemLintSource(pmRoot: string): IncrementalLintSource {
  const root = resolve(pmRoot);
  return {
    identity: root,
    client: PmClient.forActiveExtensionHost({ pmRoot: root, cwd: dirname(root) }),
    /** The SDK owns event ordering, indexing, cursors and backend diagnostics. */
    events: options => listMutationEvents({ ...options, pmRoot: root }),
    /** Load settings and lifecycle roles through the supported SDK readers. */
    policy: async () => ({ config: resolveConfig(await readLintSettings(root)), statuses: await readLintStatuses(root) }),
  };
}

/** Read one bounded regular checkpoint without following foreign symbolic links or waiting on pipes. */
export async function readIncrementalCheckpoint(path: string): Promise<IncrementalCheckpoint | undefined> {
  let handle;
  try { handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new IncrementalRefusal('state_io', 'Cannot open the checkpoint.', 'Use a readable regular checkpoint file; symbolic links and special files are unsupported.');
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > INCREMENTAL_LIMITS.bytes) throw new IncrementalRefusal('state_io', 'Checkpoint is not a bounded regular file.', 'Use a regular checkpoint within the documented byte ceiling.');
    const bytes = Buffer.alloc(info.size + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    return decodeIncrementalCheckpoint(bytes.subarray(0, bytesRead), info.size);
  } finally { await handle.close(); }
}

/** Decode exactly the observed regular-file size before passing bytes to the single checkpoint schema. */
export function decodeIncrementalCheckpoint(bytes: Uint8Array, expectedSize: number): IncrementalCheckpoint {
  if (bytes.byteLength !== expectedSize) throw new IncrementalRefusal('state_io', 'Checkpoint changed while being read.', 'Retry after the current writer finishes.');
  let value: unknown;
  try { value = JSON.parse(Buffer.from(bytes).toString('utf8')); } catch {
    throw new IncrementalRefusal('invalid_input', 'Checkpoint JSON is malformed.', 'Preserve the damaged file for inspection and choose a new state file for an explicit rebuild.');
  }
  return parseIncrementalCheckpoint(value);
}

/** Serialize checkpoint writers with a core token-owned lease and fence the final atomic publication. */
export async function lintIncrementalFile(source: IncrementalLintSource, statePath: string, rebuild = false, onBoundary?: (boundary: IncrementalFileBoundary) => Promise<void>): Promise<IncrementalLintResult> {
  parseIncrementalRequest({ rebuild });
  if (typeof statePath !== 'string' || statePath.trim() === '') throw new IncrementalRefusal('invalid_input', 'A state file is required.', 'Supply --state <file> in an existing writable cache directory.');
  let path: string;
  let lease;
  try {
    // Canonicalize the parent so cooperating writers using directory aliases share one lease.
    path = resolve(await realpath(dirname(resolve(statePath))), basename(resolve(statePath)));
    lease = await acquireLockLease(dirname(path), `lint-${sourceDigest(path)}`, 3600, randomUUID(), false, true, 0, { maxWaitMs: 0 });
  } catch {
    throw new IncrementalRefusal('state_busy', 'Checkpoint lease is unavailable.', 'Retry after the peer writer finishes; verify the state directory exists and is writable.');
  }
  try {
    await onBoundary?.('locked');
    let observed;
    try { observed = readSidecarSnapshot(path, INCREMENTAL_LIMITS.bytes); } catch {
      throw new IncrementalRefusal('state_io', 'Cannot read the checkpoint generation.', 'Use a readable regular checkpoint within the documented byte ceiling.');
    }
    const previous = observed === undefined ? undefined : decodeIncrementalCheckpoint(observed.bytes, observed.bytes.length);
    await onBoundary?.('loaded');
    const result = await lintIncremental(source, { rebuild, ...(previous === undefined ? {} : { checkpoint: previous }) }, onBoundary);
    await onBoundary?.('publish');
    const current = certifyCompleteListResult(await source.client.listAllComplete());
    const revisions = current.items.map(/** Revalidate every source revision through the SDK before publishing derived state. */ item => [item.id, sourceDigest(item)]).sort();
    const expected = result.checkpoint.items.map(/** Source order is irrelevant to the complete snapshot. */ item => [item.id, item.source_digest]).sort();
    const policy = await source.policy();
    if (sourceDigest(revisions) !== sourceDigest(expected) || sourceDigest({ config: policy.config, statuses: policy.statuses.definitions }) !== result.checkpoint.policy_digest) throw new IncrementalRefusal('source_changed', 'Current SDK revisions no longer match the evaluated snapshot.', 'Retry against current SDK state; no stale checkpoint was published.');
    let publication;
    try {
      publication = await prepareSidecarPublication(path, `${JSON.stringify(result.checkpoint)}\n`, observed, INCREMENTAL_LIMITS.bytes);
      await lease.fence(/** Core fences ownership; the final target check and replacement do not yield. */ async () => { publication!.commit(); });
    } catch (error) {
      if (error instanceof SidecarConflict) throw new IncrementalRefusal('source_changed', error.message, 'Retry from the current checkpoint; foreign and peer state was preserved.');
      throw new IncrementalRefusal('state_io', 'Checkpoint publication failed.', 'Verify storage and lease ownership, then retry from the current checkpoint.');
    } finally { publication?.dispose(); }
    await onBoundary?.('published');
    return result;
  } finally {
    try { await onBoundary?.('release'); } finally { await lease.release(); }
  }
}
