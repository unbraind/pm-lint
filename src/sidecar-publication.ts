import { constants, openSync, fstatSync, readSync, closeSync, renameSync, unlinkSync, chmodSync, chownSync } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';

/** Exact observed file generation and access policy, independent of JSON normalization. */
export interface SidecarSnapshot { bytes: Buffer; stamp: string; dev: bigint; ino: bigint; mode: number; uid: number; gid: number }

/** A peer or foreign writer changed a target or staging pathname. */
export class SidecarConflict extends Error {
  /** Report the conflict without exposing a path or cached source text. */
  constructor() { super('Sidecar changed during publication; peer state was preserved.'); }
}

/** Bind bytes, inode generation, ownership and permission changes to one observed revision. */
function snapshot(bytes: Buffer, info: BigIntStats): SidecarSnapshot {
  return { bytes, stamp: createHash('sha256').update(bytes).update([info.dev, info.ino, info.mode, info.uid, info.gid, info.size, info.mtimeNs, info.ctimeNs].join(':')).digest('hex'), dev: info.dev, ino: info.ino, mode: Number(info.mode & 0o777n), uid: Number(info.uid), gid: Number(info.gid) };
}

/** Read an observed regular-file generation without following links or blocking on special files. */
export function readSidecarSnapshot(path: string, maxBytes: number): SidecarSnapshot | undefined {
  let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    const info = fstatSync(fd, { bigint: true });
    if (!info.isFile() || info.size > BigInt(maxBytes)) throw new Error('A bounded regular sidecar file is required.');
    const buffer = Buffer.alloc(Number(info.size) + 1);
    const length = readSync(fd, buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, length);
    const after = fstatSync(fd, { bigint: true });
    const before = snapshot(bytes, info);
    if (bytes.length !== Number(info.size) || before.stamp !== snapshot(bytes, after).stamp) throw new SidecarConflict();
    return before;
  } finally { closeSync(fd); }
}

/** Access policy applied by this invocation, separate from any foreign metadata change. */
interface StagePolicy { mode: number; uid: number; gid: number }

/** Remove only owned bytes and metadata, including when a foreign writer edits the same inode. */
export function removeOwnedStage(path: string, owned: BigIntStats, contents = Buffer.alloc(0), policy: StagePolicy = { mode: Number(owned.mode & 0o777n), uid: Number(owned.uid), gid: Number(owned.gid) }, partial = false): void {
  let current: SidecarSnapshot | undefined;
  try { current = readSidecarSnapshot(path, contents.length); } catch { return; }
  if (current === undefined || current.dev !== owned.dev || current.ino !== owned.ino || current.mode !== policy.mode || current.uid !== policy.uid || current.gid !== policy.gid) return;
  const expected = partial ? contents.subarray(0, current.bytes.length) : contents;
  if (current.bytes.equals(expected)) unlinkSync(path);
}

/** Prepared bytes with synchronous commit/disposal methods for a held SDK lease or exclusive lock. */
export interface SidecarPublication { commit: () => void; dispose: () => void }

/** Stage private bytes and metadata before the final no-await compare/rename critical section. */
export async function prepareSidecarPublication(path: string, contents: string, previous: SidecarSnapshot | undefined, maxBytes: number, staging?: { path: string; handle: FileHandle }): Promise<SidecarPublication> {
  const stagePath = staging?.path ?? `${path}.${randomUUID()}.tmp`;
  const handle = staging?.handle ?? await open(stagePath, 'wx', 0o600);
  let owned: BigIntStats;
  try { owned = await handle.stat({ bigint: true }); } catch (error) { await handle.close(); throw error; }
  const mode = previous?.mode ?? Number(owned.mode & 0o600n);
  const uid = previous?.uid ?? Number(owned.uid);
  const gid = previous?.gid ?? Number(owned.gid);
  const bytes = Buffer.from(contents);
  const policy = { mode: Number(owned.mode & 0o777n), uid: Number(owned.uid), gid: Number(owned.gid) };
  try {
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
  } catch (error) {
    await handle.close();
    removeOwnedStage(stagePath, owned, bytes, policy, true);
    throw error;
  }
  return {
    /** No promise, callback or SDK operation separates the last target comparison from rename. */
    commit(): void {
      const staged = readSidecarSnapshot(stagePath, maxBytes);
      if (staged === undefined || staged.dev !== owned.dev || staged.ino !== owned.ino || staged.mode !== Number(owned.mode & 0o777n) || staged.uid !== Number(owned.uid) || staged.gid !== Number(owned.gid) || !staged.bytes.equals(Buffer.from(contents))) throw new SidecarConflict();
      const latest = readSidecarSnapshot(path, maxBytes);
      if (latest?.stamp !== previous?.stamp) throw new SidecarConflict();
      if (BigInt(uid) !== owned.uid || BigInt(gid) !== owned.gid) { chownSync(stagePath, uid, gid); policy.uid = uid; policy.gid = gid; }
      chmodSync(stagePath, mode);
      policy.mode = mode;
      renameSync(stagePath, path);
    },
    /** Disposal cannot unlink a foreign replacement, including after a failed commit. */
    dispose(): void { removeOwnedStage(stagePath, owned, bytes, policy); },
  };
}
