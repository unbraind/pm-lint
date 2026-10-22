# Public tracker witness validation

Source: the public [pm-context tracker](https://github.com/unbraind/pm-context/tree/7d156cd179b1a02a4023d0c8690dcba7d8594c81/.agents/pm),
commit `7d156cd179b1a02a4023d0c8690dcba7d8594c81` (origin/main snapshot).
Repository visibility was checked through GitHub's repository API.

The validation extracted only committed tracker files into a fresh non-git
scratch directory, marked tracker files/directories read-only, set a Git ceiling
at the directory parent, and replaced PATH with an empty executable directory.
The public SDK client used `noExtensions: true`; it never executed linked tests.
SHA-256 manifests of all 167 tracker files matched before and after both runs.
Only aggregates are published; no item text, local topology, or tracker
configuration is copied into this report.

| Measurement | Result |
| --- | ---: |
| Certified items | 80 |
| Items with criteria | 46 |
| Criteria parsed by core SDK | 176 |
| Existing linked tests, not executed or inferred as proof | 82 |
| Tracker files with unchanged hashes | 167 / 167 |

| Scenario | Supported | Pending | Missing | Dangling | Stale | Contradictory | Exit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Empty declared contract | 0 | 0 | 176 | 0 | 0 | 0 | 1 |
| One explicit pending declaration per criterion | 0 | 176 | 0 | 0 | 0 | 0 | 1 |

The second scenario is a generated audit sidecar, not imported proof. Each
pending reason states that structured proof has not been declared for the
snapshot. Existing tests and prose never implicitly turn a missing criterion
into supported evidence. These measurements establish read-only operation on
this corpus, not correctness of its criteria or test results.

Reproduce by extracting the pinned commit's `.agents/pm` with `git archive`
before entering the scratch workspace. Point `PmClient` at the extracted tracker,
use `certifyCompleteListResult(await client.listAllComplete())`, then call
`lintWitnesses(client, { version: 1, bindings: [] }, evidenceRoot)`. Build the
second contract by mapping each `splitAcceptanceCriteria(item.acceptance_criteria)`
entry to its exact `item_id` and `criterion`, with a `pending` witness and a
nonblank reason. Hash the entire extracted tracker before and after; no Git
executable is needed for either checker call.

Synthetic real-tracker regressions in `test/witnesses.test.ts` cover the distinct
dangling, stale and contradictory conditions, missing and explicit pending
proof, current test and observation declarations, path-only tests, ambiguous
test identities, citation suffixes, unsafe paths, and actionable refusals.
The built CLI regression checks both JSON and TOON with no Git executable and
preserves `proof.txt:2:4` exactly. Focused behavioral reversion evidence and CI
release-gate results are recorded on the linked pm item and PR.
