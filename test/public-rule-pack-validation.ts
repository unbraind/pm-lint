/** Measure portable rules against a supplied read-only public tracker copy outside git. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PmClient } from '@unbrained/pm-cli/sdk';
import { lintRulePack, readRulePack } from '../index.ts';

/** Hash every source filename and byte so even incidental read-side mutation is observable. */
async function inventory(root: string): Promise<string> {
  const hash = createHash('sha256');
  const files = (await readdir(root, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name)).sort();
  for (const path of files) {
    hash.update(path.slice(root.length));
    hash.update(await readFile(path));
  }
  return hash.digest('hex');
}

const [pmRoot] = process.argv.slice(2);
assert.ok(pmRoot, 'Supply a read-only public tracker snapshot');
const before = await inventory(pmRoot);
const client = new PmClient({ cwd: pmRoot, pmRoot, noExtensions: true });
const pack = await readRulePack('examples/authoring-rules.json');
const observed = await lintRulePack(client, pack);
const reordered = await lintRulePack(client, { ...pack, rules: [...pack.rules].reverse() });
assert.deepEqual(observed, reordered);
assert.equal(await inventory(pmRoot), before, 'Read-only snapshot bytes and filenames remain identical');
const byRule = Object.fromEntries(pack.rules.map(rule => [rule.id, observed.findings.filter(row => row.rule === rule.id).length]));
console.log(JSON.stringify({ corpus_count: observed.corpus_count, rules: pack.rules.length, checks: observed.checks, findings: observed.count, summary: observed.summary, by_rule: byRule, exit_code: observed.exit_code, json_bytes: Buffer.byteLength(JSON.stringify(observed)), identical_after_rule_reorder: true, source_bytes_unchanged: true }, null, 2));
