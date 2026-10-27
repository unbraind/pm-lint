/** Measure complete incremental lint on immutable public data and a disposable edited derivative. */
import assert from 'node:assert/strict';
import { chmod, cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { PmClient } from '@unbrained/pm-cli/sdk';
import { filesystemLintSource, lintIncremental } from '../index.ts';
import { lintItems } from '../src/engine.ts';

/** Exclude derived and executable state from public tracker snapshots. */
const excluded = new Set(['runtime', 'locks', 'extensions', 'search', 'checkpoints', 'transactions']);

/** Inventory only native authoritative files; source text never enters the printed report. */
async function authoritativeDigest(root: string): Promise<string> {
  const names: string[] = [];
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    const name = relative(root, join(entry.parentPath, entry.name));
    if (entry.isFile() && !excluded.has(name.split('/')[0])) names.push(name);
  }
  const digest = createHash('sha256');
  for (const name of names.sort()) digest.update(name).update(await readFile(join(root, name)));
  return digest.digest('hex');
}

/** Make copied source files immutable while leaving cache directories available to the SDK. */
async function mode(root: string, permission: number): Promise<void> {
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) await chmod(join(entry.parentPath, entry.name), permission);
}

const input = resolve(process.argv[2]);
const scratch = await mkdtemp(join(tmpdir(), 'pm-lint-public-incremental-'));
process.env.GIT_CEILING_DIRECTORIES = dirname(scratch);
try {
  const readOnly = join(scratch, 'immutable', '.agents', 'pm');
  await cp(input, readOnly, { recursive: true, filter: path => !excluded.has(relative(input, path).split('/')[0]) });
  await mode(readOnly, 0o444);
  const digest = await authoritativeDigest(readOnly);
  const source = filesystemLintSource(readOnly);
  const now = Date.now();
  const start = performance.now();
  const rebuild = await lintIncremental(source, { rebuild: true, now });
  const rebuilt = performance.now();
  const unchanged = await lintIncremental(source, { checkpoint: rebuild.checkpoint, now });
  const reused = performance.now();
  assert.deepEqual(unchanged.result, await lintItems(new PmClient({ pmRoot: readOnly, noExtensions: true }), readOnly, {}, now));
  assert.equal(await authoritativeDigest(readOnly), digest);
  const writable = join(scratch, 'edited', '.agents', 'pm');
  await cp(readOnly, writable, { recursive: true, filter: path => !excluded.has(relative(readOnly, path).split('/')[0]) });
  await mode(writable, 0o644);
  const editedSource = filesystemLintSource(writable);
  const beforeEdit = await lintIncremental(editedSource, { rebuild: true, now });
  const native = await editedSource.client.listAllComplete();
  assert.ok(native.items.length > 0);
  const target = native.items.find(item => !beforeEdit.result.findings.some(finding => finding.item_id === item.id)) ?? native.items[0];
  const client = new PmClient({ pmRoot: writable, cwd: scratch, noExtensions: true, author: 'validation-agent' });
  await client.update(target.id, { title: `${target.title} validation` });
  const editStart = performance.now();
  const edit = await lintIncremental(editedSource, { checkpoint: beforeEdit.checkpoint, now });
  const editEnd = performance.now();
  const fullStart = performance.now();
  assert.deepEqual(edit.result, await lintItems(client, writable, {}, now));
  const fullEnd = performance.now();
  assert.equal(await authoritativeDigest(readOnly), digest);
  console.log(JSON.stringify({ source: 'public fleet tracker', source_digest: digest, items: edit.result.corpus_count, findings: edit.result.count, complete_equality: true, immutable_source_preserved: true, rebuild_ms: Math.round(rebuilt - start), unchanged_ms: Math.round(reused - rebuilt), edit_ms: Math.round(editEnd - editStart), fresh_ms: Math.round(fullEnd - fullStart), unchanged: unchanged.incremental, title_edit: edit.incremental, checkpoint_bytes: Buffer.byteLength(JSON.stringify(edit.checkpoint)) }, null, 2));
} finally { await rm(scratch, { recursive: true, force: true }); }
