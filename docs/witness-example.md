# Explicit criterion witnesses

Start with a reviewable pending declaration rather than inferring proof from an
item's test list. Replace the example identity and criterion with exact tracker
values. A sidecar can be tracked alongside code without adding custom item fields.

```json
{
  "version": 1,
  "bindings": [
    {
      "item_id": "project-example",
      "criterion": "Output retains exact citation paths",
      "witnesses": [
        { "kind": "pending", "reason": "Await independent citation-path observation" }
      ]
    }
  ]
}
```

```sh
pm lint witnesses --contract criterion-witnesses.json --json
```

Pending proof exits 1, with an explicit remedy. An empty `bindings` array audits
all current criteria as missing. The checker never derives witnesses from prose.

This TypeScript example constructs a contract through the public SDK, obtains
core's exact criteria, and binds complete linked-test metadata after an explicit
review. Review the test and its observed outcome before declaring `pass`; the
checker does not run it. Do not execute SDK commands merely to lint a contract.

```typescript
import { PmClient, certifyCompleteListResult, splitAcceptanceCriteria } from '@unbrained/pm-cli/sdk';
import { lintWitnesses, sourceDigest } from '@unbrained/pm-lint';
import type { WitnessContract } from '@unbrained/pm-lint';

const client = new PmClient({ cwd: '.', pmRoot: '.agents/pm', noExtensions: true });
const corpus = certifyCompleteListResult(await client.listAllComplete());
const item = corpus.items.find(entry => entry.id === 'project-example');
if (!item) throw new Error('Select an existing item');
const criterion = splitAcceptanceCriteria(item.acceptance_criteria)[0];
const test = item.tests?.[0];
if (!criterion || !test) throw new Error('Select an exact criterion and linked test');
const identity = test.command === undefined ? { path: test.path! } : { command: test.command, ...(test.path === undefined ? {} : { path: test.path }) };
const contract: WitnessContract = {
  version: 1,
  bindings: [{ item_id: item.id, criterion, witnesses: [
    { kind: 'test', ...identity, sha256: sourceDigest(test), outcome: 'pass' },
  ] }],
};
const result = await lintWitnesses(client, contract, '.');
console.log(result.summary, result.exit_code);
```

Use both command and path when one command occurs in multiple linked entries.
For path-only tests, use the exact `path` and digest; the checker does not look for
a local file for test witnesses. Changing any linked-test metadata makes the
old digest stale. Reordering criteria or adding unrelated comments does not.

An observation declaration uses the artifact's exact bytes, not a shortened
excerpt or the citation line alone:

```typescript
import { readFile } from 'node:fs/promises';
import { observationDigest } from '@unbrained/pm-lint';
import type { CriterionWitness } from '@unbrained/pm-lint';

const bytes = await readFile('docs/citation-observation.txt');
const observation: CriterionWitness = {
  kind: 'observation', path: 'docs/citation-observation.txt#L2-L4',
  sha256: observationDigest(bytes), outcome: 'pass',
};
```

Only declare a pass after reviewing the observation against the criterion.
`outcome: fail` reports contradiction, including when another witness claims
pass. If bytes change, stale evidence is reported independently of contradiction.
There is no automatic digest update, execution, repair, or acknowledgment.
