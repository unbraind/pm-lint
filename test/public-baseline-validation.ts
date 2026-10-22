/** Reproduce aggregate validation against a read-only public tracker snapshot outside git. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PmClient } from '@unbrained/pm-cli/sdk';
import { acknowledgeFinding, BaselineRefusal, lintItems } from '../index.ts';
import type { LintBaseline } from '../index.ts';

/** Inventory source bytes without publishing any tracker content. */
async function inventory(root: string): Promise<string> {
  const hash = createHash('sha256');
  for (const entry of (await readdir(root, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile()).sort((left, right) => join(left.parentPath, left.name).localeCompare(join(right.parentPath, right.name)))) {
    hash.update(await readFile(join(entry.parentPath, entry.name)));
  }
  return hash.digest('hex');
}

/** Restore directory permissions only on a disposable mutation copy. */
async function writable(root: string): Promise<void> {
  await chmod(root, 0o700);
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) await chmod(join(entry.parentPath, entry.name), entry.isDirectory() ? 0o700 : 0o600);
}

const [pmRoot] = process.argv.slice(2);
assert.ok(pmRoot, 'Pass a read-only public tracker snapshot');
const beforeHash = await inventory(pmRoot);
const client = new PmClient({ pmRoot, cwd: pmRoot, author: 'validation-agent', noExtensions: true });
const observed = await lintItems(client, pmRoot);
let baseline: LintBaseline = { version: 1, acknowledgments: [] };
for (const finding of observed.findings) baseline = acknowledgeFinding(observed.findings, baseline, { item_id: finding.item_id, rule: finding.rule, rule_version: finding.rule_version, source_digest: finding.source_digest, reason: 'Public-data validation of specific legacy debt' });
const accepted = await lintItems(client, pmRoot, { baseline });
assert.equal(accepted.debt_count, observed.count);
assert.equal(accepted.new_count, 0);
assert.equal(accepted.exit_code, 0);
assert.equal(await inventory(pmRoot), beforeHash, 'Read-only source bytes remain identical');
const scratch = await mkdtemp(join(tmpdir(), 'pm-lint-public-mutation-'));
try {
  const copy = join(scratch, '.agents', 'pm');
  await cp(pmRoot, copy, { recursive: true });
  await writable(copy);
  const copyClient = new PmClient({ pmRoot: copy, cwd: scratch, author: 'validation-agent', noExtensions: true });
  // Description edits can resolve PML008; refreshed activity resolves PML005.
  const target = observed.findings.find(row => row.rule !== 'PML008' && row.rule !== 'PML005');
  assert.ok(target, 'The public source must contain a finding unaffected by description and activity updates');
  await copyClient.update(target.item_id, { description: 'Public baseline source-change validation probe' });
  const changed = await lintItems(copyClient, copy, { baseline });
  assert.ok(changed.stale_count > 0);
  assert.ok(changed.new_count > 0);
  assert.equal(changed.exit_code, 1);
  let disabled = false;
  try { await lintItems(copyClient, copy, { baseline, disable: [target.rule] }); } catch (error) { disabled = error instanceof BaselineRefusal && error.code === 'unsafe_policy'; }
  assert.equal(disabled, true);
  console.log(JSON.stringify({ corpus_count: observed.corpus_count, scanned: observed.scanned, findings: observed.count, summary: observed.summary, baseline: { debt: accepted.debt_count, new: accepted.new_count, stale: accepted.stale_count, exit: accepted.exit_code }, changed: { debt: changed.debt_count, new: changed.new_count, stale: changed.stale_count, exit: changed.exit_code }, broad_disable_refused: disabled, source_bytes_unchanged: true }, null, 2));
} finally {
  await rm(scratch, { recursive: true, force: true });
}
