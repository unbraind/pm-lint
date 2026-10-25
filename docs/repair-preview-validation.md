# Repair preview validation

The focused suite uses real SDK trackers outside git and runs the installed CLI
with git absent from PATH. It verifies disposable SDK mutation validation,
source byte/name equality, substantive questions, stale revision refusals,
16 KiB bounds, foreign-state exclusion and concurrent peer edits at every
exposed read/plan/validation boundary.

The seeded state test runs 500 random operation sequences with seed
`0x51a7e202`. It includes native TOON/JSON Markdown inputs, whitespace/CRLF
variants, replayed older documents and revision requests, relationships and all
populated native metadata. An independent real SDK tracker supplies the reference
state; the result is compared with state read back through the SDK, without
handwritten normalization. Plan output also round trips through JSON. The feature
has no import/export/sync mutation adapter or durable journal path.

Read-only public snapshots (repository visibility checked before validation):

| Source | Revision | Items / previews / revision rechecks | Mechanical findings | Questions | Max JSON / TOON bytes | Source writes |
| --- | --- | --- | --- | --- | --- | --- |
| pm-lint | `d9813e3461fd8ecb982819f1d13bb479a20afb73` | 17 / 17 / 17 | 0 | 0 | 530 / 499 | 0 |
| pm-review | `24e04fcf308c58988bb2869a86491f367e9b39e6` | 54 / 54 / 54 | 0 | 4 | 661 / 620 | 0 |

The sibling tracker questions were one `PML002` acceptance gap and three
`missing_expected_behavior` gaps. Both snapshots were exported from public main
into plain temporary directories and made read-only. Full byte/name inventories
were equal before and after all previews. These sources contained no mechanical
debt; synthetic regressions separately prove staged title/duplicate-tag fixes.
Reproduce by exporting a public tracker snapshot and running
`node test/public-repair-validation.ts <read-only-tracker-copy>`.

Behavioral revert proof: the focused mechanical regression exits 1 independently
when mechanical patches are replaced with an empty plan, when the revision guard
is removed, and when snapshot isolation is removed. Restoring each implementation
returns the test to green. The third revert exposes SDK cache writes, rather than
only checking item text.

The pinned development SDK stays at 2026.10.20. The peer/manifest minimum now
matches that SDK because the repair path uses its structured planner and semantic
preview APIs. Full release checks run in CI through npm on Node 22 and 26 and
through Bun on Node 26, with the existing 100/100/100/100 and zero-duplication
thresholds unchanged. CI receipts are linked from the pull request.
