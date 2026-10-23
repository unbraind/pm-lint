# Portable rule-pack validation

The overlap check used the installed CLI 2026.10.23 contract, the package-pinned
SDK 2026.10.20, pm-presets export/upgrade, pm-review workflows, and existing
pm-lint rules, baselines and witnesses. Core owns schema types and mutation
workflow governance (required fields, transitions, authors, field writers and
approvals). Presets distributes schemas/settings/templates. Portable packs add
read-only literal text and length authoring assertions with organization-owned
explanations; they do not replace or install governance policies.

## Public read-only measurement

Source: public [pm-presets tracker at
470c2b2](https://github.com/unbraind/pm-presets/tree/470c2b2a367c36dbf19513b4db2f84fa979a057c/.agents/pm).
Repository visibility and the exact commit were verified through GitHub before
measurement. Only committed tracker files were copied to a disposable directory
outside git. Snapshot files and directories were made read-only. Extensions were
disabled, and git discovery was fenced at the snapshot's parent directory.

Reproduce after preparing an equivalent read-only snapshot:

```sh
GIT_CEILING_DIRECTORIES="$SNAPSHOT_PARENT" node test/public-rule-pack-validation.ts "$SNAPSHOT_PM_ROOT"
```

| Measurement | Result |
| --- | ---: |
| Certified items, including terminal work | 76 |
| Rules in shipped example | 3 |
| Potential item/rule pairs | 228 |
| Applicable checks after exact selectors | 157 |
| Findings | 25 |
| Error / warning / informational findings | 0 / 25 / 0 |
| `ORG.acceptance` / `ORG.context` / `ORG.title` findings | 0 / 25 / 0 |
| Complete SDK JSON receipt size | 6,193 bytes |
| Gate exit code | 0 |

Reversing the rule declaration order produced an identical complete receipt.
Hashing all snapshot filenames and bytes before and after both runs proved no
source changes. No source item text or operational data is reproduced here.

## Regression and adapter evidence

The focused suite uses real initialized temporary trackers, core serialization,
and actual built CLI processes. It checks every predicate, exact selectors,
strict parsing and unknown keys, duplicate identities, unsafe pattern modes,
all resource dimensions, stable ordering, typed remedies, read failures, and
TOON/JSON host output. TOON and legacy JSON Markdown readers produce identical
complete diagnostic receipts from the same canonical metadata. The pinned SDK
migrates legacy Markdown during reads; that compatibility test uses a disposable
writable fixture. It does not establish hosted Postgres or network deployment.

The git-free CLI tests set a git discovery ceiling and run with a PATH containing
no git executable. Packed acceptance exercises the shipped example and public SDK
through real npm/npx and native Bun/bunx consumers in CI.

## Full release-gate receipt

Implementation commit `3b6a590809aa72f82e1e83f742542731f732e09f` passed
[CI run 40014216019](https://github.com/unbraind/pm-lint/actions/runs/40014216019).
The subsequent evidence commit changes documentation and tracker receipts only.

| Gate | Suite | Packed acceptance | Coverage |
| --- | ---: | ---: | --- |
| `npm run release:check`, Node 22 | 106/106 | 1/1 | 100/100/100/100 |
| `npm run release:check`, Node 26 | 106/106 | 1/1 | 100/100/100/100 |
| `bun run release:check`, Node 26 | 106/106 | 1/1 | 100/100/100/100 |

Coverage reconciled all 21 configured authored sources, with unchanged 100%
thresholds in each dimension. Each packed acceptance test ran npm/npx and native
Bun/bunx SDK/CLI consumers. All three gates had zero failed, skipped or canceled
top-level tests. Fresh-checkout tracker health, privacy/identity, duplication,
typecheck, lint, docstrings, production dependency audit, package contents,
changelog and release-attestation checks passed. CodeQL also passed.

Behavioral revert proof removed only semantic evaluation, rebuilt, and made both
selected semantic/CLI tests fail (0/2 pass). Independently bypassing strict parsing
and rebuilding made both parser/resource tests fail (0/2 pass). Restoring the
implementation returned the focused suite to 22/22; the final pack-only coverage
run passed 8/8 and measured both new runtime modules at 100/100/100/100.

The package worktree's separate local strict-health check reported ignored
managed-extension host-version skew and pre-existing merge-fence drift. Neither
was changed by this feature; both fresh CI jobs passed tracker health. No hosted
backend acceptance or external review approval is claimed. Automated review
services reported unavailable/skipped/neutral review states, not approvals.
