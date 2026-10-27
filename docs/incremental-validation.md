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
payload; the corrected cleanup retains it. Focused publication/baseline tests
pass 21/21 with 100/100/100/100 shared-publisher coverage.
The final focused set also includes all original incremental regressions and
adapter metadata-failure checks: 31/31 passed, with 100/100/100/100 measured for
both writer adapters and the shared publisher.

Packed acceptance (`npm run test:install`) passed one integration test with
zero failures, skips, cancellations or todo cases. It exercises npm and Bun
global hosts, npx/native bunx, direct project-local CLI entrypoints and the
packed incremental SDK. The run took 515,980 ms on the shared host. Full npm
and Bun release-gate counts remain separate CI evidence.
