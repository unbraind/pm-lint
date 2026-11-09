# Repair preview validation

The focused suite uses real SDK trackers outside git and runs the installed CLI
with git absent from PATH. It verifies disposable SDK mutation validation,
source byte/name equality, substantive questions, stale revision refusals,
16 KiB bounds, foreign-state exclusion and concurrent peer edits at every
exposed read/plan/validation boundary.

Repair plans compare the SDK-validated lint section with the section in their
captured settings bytes before deriving questions. Schema settings and every
core key recognized by the pinned SDK must also agree before plan generation.
Before any read hook runs, the preview fingerprints every retained file name and
byte (including default/custom schema paths and absent files). The private copy
must match that fingerprint and the captured lint section before core reads.
Settings sections use semantic equality to preserve independent sibling settings;
when a schema file aliases `settings.json`, its entire pre-hook bytes are also
bound at the private handoff. All schema sections and SDK-normalized path aliases
(including whitespace and `..`) follow this rule. Alias detection resolves file
identities before hooks run, so case-insensitive spellings and hard links cannot
escape the byte fence. Real same-inode aliases with varied spelling exercise this
rule on case-sensitive test volumes too. The excluded-state guard applies the
same trimming before comparison, including direct padded paths, `.` and `..`,
for all schema sections and all six excluded directories. All other retained inputs use
byte equality. The SDK-loaded effective schema also binds
the plan key, so schema policy changes cannot reuse an older plan identity.
Audit history and equivalent schema formatting do not alter plan identity.
Schema and parsed settings hashing reuse the recursive canonical JSON digest, so object-key
permutations at any depth preserve replay identity while array order stays bound.
Repair questions use the status registry resolved from this same private schema;
custom lifecycle names retain built-in active, blocked and terminal semantics.
After the initial section read, a second stability-checked snapshot hides the
core-read root from hooks that may have scheduled deferred writes to the first
snapshot. All schema reads, planning and validation run against that private
copy with extensions disabled. Core-key adversarial cases change and restore
the exposed settings at every downstream boundary; the receipts must retain
the captured plan and validation. Any captured-settings mismatch or non-restored
write returns `stale_revision` without a patch. Real asynchronous SDK read hooks exercise
absent/present sections, every built-in rule, severity, scopes and parameters
through the API and command handler; refusal receipts round trip through JSON
and TOON. Equivalent object-key ordering and independent settings remain valid,
and the source tracker stays byte-identical. Hook-introduced malformed documents
and invalid policy return stale receipts through API and JSON/TOON commands;
previously invalid documents retain their SDK refusal, even if hooks change their
bytes. The adversarial corpus covers all rule controls and both invalid-document
classes, plus unchanged SDK errors and native I/O failures. Packed Node
and native Bun consumers repeat invalidation and same-inode alias checks. Packed Node and native Bun consumers
also inject policy, aliased settings/schema and schema-only changes through real
hooks, and check semantic schema replay and custom terminal-done questions.
The regression corpus includes 32 seeded recursive object permutations for each of file and inline schemas, array
reordering, every schema-section alias at both handoffs, and 15 renamed lifecycle
cases through SDK and actual non-git CLI JSON/TOON output. A generated
core-key matrix checks refusals before source reads, and separate cases cover
removed/malformed settings and late hooks through mechanical validation. Reverting the preview builder or
removing only the comparison makes the adversarial test fail; restoring the
implementation makes it pass.

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

The development SDK stays pinned to 2026.11.4. The peer/manifest minimum is
2026.11.2 because repair policy uses the SDK settings-section reader alongside
the structured planner and semantic preview APIs. Full release checks run in CI through npm on Node 22 and 26 and
through Bun on Node 26, with the existing 100/100/100/100 and zero-duplication
thresholds unchanged. CI receipts are linked from the pull request.
