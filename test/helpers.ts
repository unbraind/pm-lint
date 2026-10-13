import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
