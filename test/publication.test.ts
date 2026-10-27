import assert from 'node:assert/strict';
import test from 'node:test';
import fsPromises, { chmod, chown, mkdir, open, readFile, readdir, rename, stat, symlink, writeFile } from 'node:fs/promises';
import fs from 'node:fs';
import { join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { filesystemLintSource, lintIncrementalFile, IncrementalRefusal, BaselineRefusal } from '../index.ts';
import { acknowledgeBaselineFile, readBaseline } from '../src/baseline-file.ts';
import { lintItems } from '../src/engine.ts';
import { prepareSidecarPublication, readSidecarSnapshot, SidecarConflict } from '../src/sidecar-publication.ts';
import { tracker, installBuiltExtension, runGitFreeCli } from './helpers.ts';

/** Exercise both durable sidecar writers through their public SDK paths on one real non-git tracker. */
async function fixture(t: Parameters<typeof tracker>[0]) {
  const context = await tracker(t);
  await context.client.create({ title: 'TODO', type: 'Feature', unset: ['parent', 'goal', 'objective', 'sprint', 'release'], clearDeps: true });
  const source = filesystemLintSource(context.pmRoot);
  const { findings } = await lintItems(context.client, context.pmRoot);
  const row = findings[0];
  const request = { item_id: row.item_id, rule: row.rule, rule_version: row.rule_version, source_digest: row.source_digest, reason: 'Keep reviewed evidence' };
  return { ...context, source, writers: [
    { name: 'checkpoint', path: join(context.root, 'checkpoint.local.json'), create: () => lintIncrementalFile(source, join(context.root, 'checkpoint.local.json'), true), update: () => lintIncrementalFile(source, join(context.root, 'checkpoint.local.json')) },
    { name: 'baseline', path: join(context.root, 'baseline.local.json'), create: () => acknowledgeBaselineFile(join(context.root, 'baseline.local.json'), findings, request), update: () => acknowledgeBaselineFile(join(context.root, 'baseline.local.json'), findings, request) },
  ] };
}

/** Obtain the real file-handle methods used by all publication fault injections. */
async function publicationProbe(t: Parameters<typeof tracker>[0], root: string) {
  const probe = await open(join(root, 'publication-probe'), 'w');
  t.after(() => probe.close());
  const prototype: typeof probe = Object.getPrototypeOf(probe);
  return { probe, prototype };
}

test('every sidecar writer preserves restrictive modes and creates private files even with permissive umask', async t => {
  const { writers, root } = await fixture(t);
  await chmod(root, 0o755);
  for (const writer of writers) {
    const before = process.umask(0);
    try { await writer.create(); } finally { process.umask(before); }
    assert.equal((await stat(writer.path)).mode & 0o777, 0o600, `${writer.name} creation`);
    for (const mode of [0o400, 0o600, 0o640, 0o644]) {
      await chmod(writer.path, mode);
      await writer.update();
      assert.equal((await stat(writer.path)).mode & 0o777, mode, `${writer.name} mode=${mode.toString(8)}`);
    }
  }
});

test('foreign replacement after every awaited SDK read is preserved, including final policy read', async t => {
  const { source, writers } = await fixture(t);
  const writer = writers[0];
  await writer.create();
  const initial = await readFile(writer.path);
  const steps: string[] = [];
  const policy = source.policy;
  const events = source.events;
  const list = source.client.listAllComplete.bind(source.client);
  let target: string | undefined;
  const counts = new Map<string, number>();
  /** Inject only after actual SDK work completes, rather than replacing an SDK result. */
  async function boundary(name: string): Promise<void> {
    const n = (counts.get(name) ?? 0) + 1;
    counts.set(name, n);
    const step = `${name}:${n}`;
    if (target === undefined) steps.push(step);
    if (target === step) await writeFile(writer.path, 'foreign replacement must survive');
  }
  source.policy = async () => { const result = await policy(); await boundary('policy'); return result; };
  source.events = async options => { const result = await events(options); await boundary('events'); return result; };
  source.client.listAllComplete = async options => { const result = await list(options); await boundary('corpus'); return result; };
  await writer.update();
  assert.ok(steps.includes('policy:3'), 'the final SDK policy read is part of the interleaving corpus');
  for (target of [...steps].reverse()) {
    await writeFile(writer.path, initial);
    counts.clear();
    await assert.rejects(writer.update(), error => error instanceof IncrementalRefusal && error.code === 'source_changed');
    assert.equal(await readFile(writer.path, 'utf8'), 'foreign replacement must survive', target);
  }
});

test('baseline refuses a foreign replacement during durable sync', async t => {
  const { root, writers } = await fixture(t);
  const writer = writers[1];
  await writer.create();
  const handle = await open(join(root, 'sync-injection-probe'), 'w');
  t.after(() => handle.close());
  const prototype: typeof handle = Object.getPrototypeOf(handle);
  const implementation = prototype.sync;
  const mock = t.mock.method(prototype, 'sync', async function(this: typeof handle) {
    await implementation.call(this);
    await writeFile(writer.path, 'foreign baseline must survive');
  });
  try {
    await assert.rejects(writer.update(), error => error instanceof BaselineRefusal && error.code === 'evidence_changed');
    assert.equal(await readFile(writer.path, 'utf8'), 'foreign baseline must survive');
  } finally { mock.mock.restore(); }
});

test('every writer rechecks after staging awaits and never deletes a replaced staging inode', async t => {
  const { writers, root } = await fixture(t);
  const { probe, prototype } = await publicationProbe(t, root);
  for (const writer of writers) {
    await writer.create();
    const original = await readFile(writer.path);
    for (const method of ['stat', 'writeFile', 'sync'] as const) {
      const implementation = prototype[method];
      const originalStat = prototype.stat;
      let injected = false;
      const mock = t.mock.method(prototype, method, async function(this: typeof probe, ...args: unknown[]) {
        let staging = false;
        if (this.fd >= 0) {
          const info = await originalStat.call(this, { bigint: true });
          for (const name of await readdir(root)) {
            if (!name.startsWith(writer.path.slice(root.length + 1) + '.')) continue;
            const candidate = await stat(join(root, name));
            if (candidate.ino === Number(info.ino)) staging = true;
          }
        }
        const result: unknown = await Reflect.apply(implementation, this, args);
        if (staging && !injected) { injected = true; await writeFile(writer.path, `foreign after ${method}`); }
        return result;
      });
      try {
        await assert.rejects(writer.update(), error => error instanceof IncrementalRefusal || error instanceof BaselineRefusal);
        assert.ok(injected, `${writer.name}:${method}`);
        assert.equal(await readFile(writer.path, 'utf8'), `foreign after ${method}`);
      } finally { mock.mock.restore(); }
      await writeFile(writer.path, original);
    }
    const originalOpen = fsPromises.open;
    let closed = false;
    const openMock = t.mock.method(fsPromises, 'open', async (...args: Parameters<typeof fsPromises.open>) => {
      const handle = await originalOpen(...args);
      if (String(args[0]).startsWith(writer.path + '.')) {
        const close = handle.close.bind(handle);
        t.mock.method(handle, 'close', async () => {
          await close();
          if (!closed) { closed = true; await writeFile(writer.path, 'foreign after close'); }
        });
      }
      return handle;
    });
    syncBuiltinESMExports();
    try {
      await assert.rejects(writer.update());
      assert.ok(closed, `${writer.name}:close`);
      assert.equal(await readFile(writer.path, 'utf8'), 'foreign after close');
    } finally { openMock.mock.restore(); syncBuiltinESMExports(); }
    await writeFile(writer.path, original);
    const implementation = prototype.sync;
    const mock = t.mock.method(prototype, 'sync', async function(this: typeof probe) {
      await implementation.call(this);
      const stage = (await readdir(root)).find(name => name.startsWith(writer.path.slice(root.length + 1) + '.'));
      if (stage !== undefined) { await rename(join(root, stage), join(root, `${writer.name}-owned-backup`)); await writeFile(join(root, stage), 'foreign staging record'); }
    });
    try {
      await assert.rejects(writer.update());
      const stage = (await readdir(root)).find(name => name.startsWith(writer.path.slice(root.length + 1) + '.'));
      assert.ok(stage);
      assert.equal(await readFile(join(root, stage), 'utf8'), 'foreign staging record');
      assert.deepEqual(await readFile(writer.path), original);
    } finally { mock.mock.restore(); }
  }
});

test('final commit refuses creation, deletion, identical-byte replacement and mode drift after preparation', async t => {
  const { root } = await tracker(t);
  const path = join(root, 'sidecar.json');
  for (const transition of ['create', 'delete', 'replace', 'mode'] as const) {
    if (transition !== 'create') await writeFile(path, 'observed bytes', { mode: 0o600 });
    const observed = readSidecarSnapshot(path, 1024);
    const publication = await prepareSidecarPublication(path, 'next bytes', observed, 1024);
    if (transition === 'create') await writeFile(path, 'foreign bytes');
    if (transition === 'delete') await rename(path, join(root, 'deleted-by-peer'));
    if (transition === 'replace') { await rename(path, join(root, 'replaced-by-peer')); await writeFile(path, 'observed bytes'); }
    if (transition === 'mode') await chmod(path, 0o640);
    assert.throws(publication.commit, SidecarConflict);
    publication.dispose();
    // Preserve the peer's target while preparing the next independent fixture.
    if (transition !== 'delete') await rename(path, join(root, `${transition}-peer-result`));
  }
});

test('both writers preserve foreign content written into their original staging inode', async t => {
  const { root, writers } = await fixture(t);
  const { probe, prototype } = await publicationProbe(t, root);
  for (const writer of writers) {
    await writer.create();
    const original = await readFile(writer.path);
    const implementation = prototype.sync;
    let stage: string | undefined;
    const mock = t.mock.method(prototype, 'sync', async function(this: typeof probe) {
      await implementation.call(this);
      const name = (await readdir(root)).find(name => name.startsWith(writer.path.slice(root.length + 1) + '.'));
      if (name !== undefined) { stage = join(root, name); await writeFile(stage, 'foreign in-place data'); }
    });
    try {
      await assert.rejects(writer.update());
      assert.ok(stage);
      assert.equal(await readFile(stage, 'utf8'), 'foreign in-place data');
      assert.deepEqual(await readFile(writer.path), original);
    } finally { mock.mock.restore(); }
  }
});

test('cleanup leaves oversized foreign staging data alone instead of masking the publication conflict', async t => {
  const { root } = await tracker(t);
  const path = join(root, 'target.json');
  await writeFile(path, 'original');
  const publication = await prepareSidecarPublication(path, 'next', readSidecarSnapshot(path, 1024), 1024);
  const stage = (await readdir(root)).find(name => name.startsWith('target.json.'));
  assert.ok(stage);
  await writeFile(join(root, stage), 'foreign data longer than the owned payload');
  assert.throws(publication.commit, SidecarConflict);
  assert.doesNotThrow(publication.dispose);
  assert.equal(await readFile(join(root, stage), 'utf8'), 'foreign data longer than the owned payload');
  assert.equal(await readFile(path, 'utf8'), 'original');
});

test('JSON and TOON non-git CLI consumers retain checkpoint permissions on every update', async t => {
  const { root, pmRoot, writers } = await fixture(t);
  await installBuiltExtension(pmRoot);
  const path = writers[0].path;
  await writers[0].create();
  for (const format of [[], ['--json']]) {
    await chmod(path, 0o600);
    const result = runGitFreeCli(root, pmRoot, ['lint', 'incremental', '--state', path, ...format]);
    assert.equal(result.status, 1, result.stderr);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  }
  assert.ok(await readBaseline(writers[1].path, true));
});

test('snapshot readers reject torn, special and oversized files while read-only legacy baselines remain readable', async t => {
  const { root } = await tracker(t);
  const path = join(root, 'input.json');
  await writeFile(path, '{"version":1,"acknowledgments":[]}');
  const link = join(root, 'legacy-link.json');
  await symlink(path, link);
  assert.deepEqual(await readBaseline(link), { version: 1, acknowledgments: [] });
  assert.throws(() => readSidecarSnapshot(link, 1024));
  assert.throws(() => readSidecarSnapshot(path, 0));
  const directory = join(root, 'directory');
  await mkdir(directory);
  assert.throws(() => readSidecarSnapshot(directory, 1024));
  await assert.rejects(lintIncrementalFile(filesystemLintSource(join(root, '.agents', 'pm')), directory, true), error => error instanceof IncrementalRefusal && error.code === 'state_io');
  for (const changed of ['x', 'different bytes with original size!']) {
    await writeFile(path, 'initial bytes');
    const implementation = fs.readSync;
    const mock = t.mock.method(fs, 'readSync', (fd: number, ...args: unknown[]) => {
      const length = Reflect.apply(implementation, fs, [fd, ...args]) as number;
      fs.writeFileSync(path, changed);
      return length;
    });
    syncBuiltinESMExports();
    try { assert.throws(() => readSidecarSnapshot(path, 1024), SidecarConflict); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(await readFile(path, 'utf8'), changed);
  }
});

test('staging metadata failures close their handles and never replace the target', async t => {
  const { root } = await tracker(t);
  const path = join(root, 'target.json');
  await writeFile(path, 'original');
  const handle = await open(join(root, 'owned-stage'), 'wx', 0o600);
  const mock = t.mock.method(handle, 'stat', async () => { throw new Error('metadata unavailable'); });
  try { await assert.rejects(prepareSidecarPublication(path, 'next', readSidecarSnapshot(path, 1024), 1024, { path: join(root, 'owned-stage'), handle })); }
  finally { mock.mock.restore(); }
  assert.equal(handle.fd, -1);
  assert.equal(await readFile(path, 'utf8'), 'original');
});

test('replacements retain an existing authorized group rather than inheriting the staging directory group', async t => {
  const { root } = await tracker(t);
  const group = process.getgroups?.().find(value => value !== process.getgid?.());
  assert.notEqual(group, undefined, 'the supported Ubuntu test environment supplies an additional authorized group');
  const path = join(root, 'group-owned.json');
  await writeFile(path, 'original', { mode: 0o640 });
  await chown(path, process.getuid!(), group!);
  const previous = readSidecarSnapshot(path, 1024);
  const publication = await prepareSidecarPublication(path, 'replacement', previous, 1024);
  try { publication.commit(); } finally { publication.dispose(); }
  const current = await stat(path);
  assert.equal(current.gid, group);
  assert.equal(current.uid, previous!.uid);
  assert.equal(current.mode & 0o777, 0o640);
});
