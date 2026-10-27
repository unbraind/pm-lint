# Incremental lint validation

The implementation is checked against fresh certified full scans, genuine SDK
trackers outside git, checkpoint transport properties and concurrent writers.
Results and measured numbers are recorded here before review.

Public source: `unbraind/pm-lint` at `a813e56`, exported from `origin/main`.
Authoritative source SHA-256:
`16b7a56ee139b2681ce3ece7e468d9caea102b1cd32a38f9aee4ee638ffaa7d1`.

| Dataset / transition | Items | Findings | Predicates evaluated | Pairs reused | Complete equality |
| --- | ---: | ---: | ---: | ---: | --- |
| Immutable public copy, no-op | 21 | 0 | 12 | 54 | yes |
| Public derivative, one title edit | 21 | 0 | 15 | 51 | yes |
| Synthetic active corpus, one title edit | 10,000 | 0 | 30,003 | 49,997 | yes |

On the shared host, the public-copy rebuild took 3,650 ms, no-op 694 ms,
title edit 288 ms and warm full scan 98 ms. Its checkpoint was 13,121 bytes.
The synthetic run under coverage measured 29,761 ms for rebuild and 6,864 ms
for update, with a 5,959,530-byte checkpoint. These are observations under
load, not speed guarantees. Public authoritative file names and bytes were
unchanged; the title edit occurred only in the disposable derivative.

The read-only public-data harness is `test/public-incremental-validation.ts`.
It copies a public tracker into a non-git scratch directory, makes authoritative
files read only, compares rebuild/no-op results with full lint and fingerprints
all authoritative names and bytes before/after. A separate disposable derivative
receives one SDK title edit and is compared with a fresh scan. SDK caches remain
disposable and are excluded from the authoritative fingerprint.

The 10,000-item fixture uses native SDK serialization for seeding and the SDK for
the title edit and all reads. It asserts complete result equality and exact
per-rule predicate counts. Performance figures include complete reads and SDK
certification; they do not assert a universal wall-time speedup.

`test/incremental-model.test.ts` uses seed `0x1ace2026` for 500 sequences of native
document imports, old input/checkpoint replays, JSON/TOON exports, whitespace/CRLF
variants, complete scans and retry. An independent SDK-read tracker is the
normalization oracle. Each observational step is an identity transition on
native state; every result is compared with a fresh full scan. Relationships,
native authoring fields and bounded excerpts remain covered. A second seeded
property checks 500 randomly named custom status registries against role-equivalent
built-in statuses.

The interleaving test injects a real competing file writer at all eleven exposed
boundaries on one non-git tracker, including publication and release. Another
injects SDK source edits at all nine prepublication boundaries. A lost actual
core lease cannot publish, a changed source cannot advance the saved checkpoint,
and foreign or peer state remains untouched. No SDK mocks are used.

Review follow-up audits both durable sidecar writers, including baseline
acknowledgments. `test/publication.test.ts` injects a foreign target after every
actual SDK read and each staging await, including the final SDK policy read and
durable sync. It covers staging-inode replacement, identical-byte replacement,
creation/deletion/mode drift, in-place foreign staging edits, torn reads, owner/group preservation and private
creation in a traversable directory under a permissive umask. Both JSON and TOON
CLI paths and packed npm/Bun consumers check that `0600` stays `0600`.

Function-only revert proofs fail for each writer: the old checkpoint publisher
overwrites a final-policy replacement and creates `0666` under umask `000`; the
old baseline publisher overwrites a replacement during sync and changes an
existing `0400` file to `0600`. No original regressions were weakened or removed.
Restoring only inode-based staging cleanup also deletes the in-place foreign
payload; the corrected cleanup retains it. The final focused set includes all
original incremental regressions and adapter metadata-failure checks: 31/31
passed, with 100/100/100/100 measured for both writer adapters and the shared
publisher.

The complete local release gates passed serially at source commit `208f70f`,
using isolated home directories and Git configuration, Node 24.19.0, npm 11.17.0
and Bun 1.3.5. Test concurrency remained at most two; thresholds were unchanged.

| Command | Main tests | Packed acceptance | Coverage | Total measured time |
| --- | ---: | ---: | --- | ---: |
| `npm run release:check` | 179/179 | 1/1 | 100/100/100/100 | 1,804,238 ms |
| `bun run release:check` | 179/179 | 1/1 | 100/100/100/100 | 2,292,750 ms |

Both runs had zero failures, skips, cancellations or todo cases. All 30 measured
source files met every coverage threshold. Typecheck, lint, zero-duplication,
docstrings, identity, production audit, dry packing, changelog and publication
attestation checks passed. Packed acceptance covers npm and Bun global hosts,
npx/native bunx, direct project-local CLI entrypoints and the packed incremental
SDK. Its final-policy replacement and permission assertions use the packed SDK;
the two packed runs took 454,550 ms and 424,134 ms respectively.

The subsequent merge of `815ec63` changes only another tracker item's closure
evidence. Product source, tests, scripts and dependency files remain identical
to the full-gate source commit. Final tracker/docs receipts are checked with
tracker health, identity, changelog and diff validation. Pushed-head CI results
are linked from [PR 32 checks](https://github.com/unbraind/pm-lint/pull/32/checks);
local source-gate results and CI results are separate receipts.

The bounded CI watch at `74774ab` reached approximately 30 minutes with both
Node 22 and Node 26 jobs still queued and zero executed steps in
[run 40499927461](https://github.com/unbraind/pm-lint/actions/runs/40499927461).
[CodeQL](https://github.com/unbraind/pm-lint/actions/runs/40499927369) was also
queued. No new CI gate pass is claimed. This final tracker/docs receipt does
not change implementation or tests; its own CI remains separate at PR checks.
The orchestrator pipeline continues final-head checks and re-review.
