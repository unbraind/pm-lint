import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import type { TestContext } from 'node:test';
import { PmClient } from '@unbrained/pm-cli/sdk';
/** Create an isolated real SDK tracker and register cleanup before initialization. */
export async function tracker(t: TestContext): Promise<{ client: PmClient; root: string; pmRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), 'pm-lint-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const pmRoot = join(root, '.agents', 'pm');
  const client = new PmClient({ cwd: root, pmRoot, author: 'lint-test', noExtensions: true });
  await client.init('lint-test', { defaults: true, agentGuidance: 'skip', mergeFence: false });
  return { client, root, pmRoot };
}

/** Install the built extension into a real tracker without package-manager side effects. */
export async function installBuiltExtension(pmRoot: string): Promise<void> {
  const extensionRoot = join(pmRoot, 'extensions', 'pm-lint');
  await mkdir(extensionRoot, { recursive: true });
  const manifest = JSON.parse(await readFile(resolve('manifest.json'), 'utf8')) as Record<string, unknown>;
  await writeFile(join(extensionRoot, 'manifest.json'), JSON.stringify({ ...manifest, entry: './index.mjs' }));
  await writeFile(join(extensionRoot, 'index.mjs'), `export { default } from ${JSON.stringify(pathToFileURL(resolve('dist/index.js')).href)};`);
}

/** Execute the real host with git discovery fenced and no executables available on PATH. */
export function runGitFreeCli(root: string, pmRoot: string, args: string[]): SpawnSyncReturns<string> {
  const env = { ...process.env, PM_PATH: pmRoot, PM_SOURCE_PM_PATH: pmRoot, PM_SOURCE_WORKSPACE_ROOT: root, PM_GLOBAL_PATH: join(root, 'profile'), GIT_CEILING_DIRECTORIES: dirname(root), PATH: join(root, 'no-executables'), HOME: root };
  return spawnSync(process.execPath, [resolve('node_modules/@unbrained/pm-cli/dist/cli.js'), ...args], { cwd: root, env, encoding: 'utf8' });
}
