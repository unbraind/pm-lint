# SDK adoption validation (2026-10-25)

Tracking: [pm-lint-sdk-adoption-1025](https://github.com/unbraind/pm-lint/blob/main/.agents/pm/tasks/pm-lint-sdk-adoption-1025.toon), related to [pm-lint-settings](https://github.com/unbraind/pm-lint/blob/main/.agents/pm/features/pm-lint-settings.toon). Searches for adoption and SDK found no existing adoption item.

| Audit finding (original source) | Disposition | Evidence |
| --- | --- | --- |
| `src/commands.ts:73-76`: manual baseline refusal envelope and exit status | Replace with `createPmCliExpectedError`; delete receipt construction and delegate rendering, expected-error classification and usage exit status to the SDK/host | `test/sdk-refusals.test.ts`: adapter, actual registered dispatch, git-free CLI diagnostics; behavioral revert fails all three tests |
| `src/settings.ts:54-67`: raw custom-section read | Retain `readSettings` validation plus SDK `getSettingsPath`/`readFileIfExists` and local parsing | The pinned SDK's normalized settings strip `lint`; no validated lossless extension settings-section reader (`readSettingsSection`) is exported. Replacing this with `readSettings` alone would silently discard configured lint policy. This missing API is for orchestrator upstream follow-up. |

The pin stays at `@unbrained/pm-cli@2026.10.20`; the current registry CLI version was checked as 2026.10.25. No replaced code reads history, verifies item history, uses an event cache or makes cursor/recovery decisions. No history verifier was removed or substituted, so a cache-prime/history-corruption preservation test is inapplicable to this adapter. Certified complete-list reads and source digests remain unchanged; this change makes no new history-integrity claim.

## Intentional differences

Successful lint, rule listing, baseline and acknowledgment function outputs are identical. Baseline refusal command functions now throw native `PmCliError` instead of returning `{ ok: false, refusal: { code, message, remedy }, exit_code: 2 }`. Exit 2, domain code, message and remedy remain identical; the remedy is passed as `context.nextSteps`. Only those domain diagnostics are copied: no arbitrary exception properties, cause, raw input or filesystem error details.

The host renders native diagnostics on stderr. JSON exposes `code`, `detail`, `next_steps`, `exit_code` and standard recovery fields. Human diagnostics show the message and next steps. Host recovery guidance may echo command arguments. This is host behavior, not extra context copied by the adapter. The old `lint` refusal result could itself fail host read-output shaping because it lacked the declared `findings` rows; the native boundary preserves the actual baseline diagnostic instead. Embedded baseline-model APIs still throw `BaselineRefusal`.

## Differential proof

`test/sdk-adoption-differential.ts` compares the compiled `origin/main` command functions at `34d3ba5784e75d7d78a16b680326382511d05b73` with the branch build. Both use the same pinned dependencies. Source tracker snapshots come from Git archives of these verified-public repositories, never runtime or hosted data:

| Public source | Snapshot commit | Items | Identical outputs | Intentional native refusals |
| --- | --- | ---: | ---: | ---: |
| `unbraind/pm-review` | `d65d149bbcafdc11d2ef6addcfff8bf2e4f479e1` | 56 | 5 | 8 |
| `unbraind/pm-presets` | `117a077df250a905d8a8f9ebee39eeeb38b4a0f4` | 79 | 5 | 8 |

All 26 comparisons pass. Identical cases: rules, ordinary lint (including complete-list certificate), empty baseline, successful acknowledgment and acknowledged-debt baseline. Intentional differences: unsafe policy, missing baseline, invalid JSON, invalid schema, missing acknowledgment flags, repeated acknowledgment flag, stale evidence and absent finding. Every refused case compares the exact code/message/remedy/exit tuple against the original result.

Each run copies the snapshot to a non-git temporary tracker, makes tracker files/directories read-only, fences Git discovery and supplies a PATH with no git executable. Both builds run on the same copy with a fixed clock. A hash of file names and bytes proves the tracker remains unchanged after both runs; acknowledgment only writes a separate scratch baseline. No tracker contents or temporary paths are published.

Reproduce after building origin/main in a scratch package with the pinned dependencies and extracting public tracker archives:

```sh
npm run build
node test/sdk-adoption-differential.ts "$ORIGIN_BUILD" "$REVIEW_SNAPSHOT" "$PRESETS_SNAPSHOT"
```

## Behavioral revert proof

Retained the new tests and restored the original receipt-producing behavior in the adapter and the two command catch paths, without reverting test changes. Rebuilt, then ran `node --test test/sdk-refusals.test.ts`: **0 pass, 3 fail**. Failures prove that the adapter must throw the SDK error, dispatch must propagate it, and real CLI diagnostics must retain the domain refusal. Restored the SDK implementation and rebuilt: **3 pass, 0 fail**. The per-replacement proof is also recorded in the pm item.

## Gates

The linked pm test runs typecheck, lint, build and both focused suites: **13 pass, 0 fail**. The isolated-home local `npm run release:check` passes: **121 unit tests**, **1 packed npm/npx and native Bun/bunx installation acceptance test**, no failures or skips, **100% statements/branches/functions/lines** across all **24 required source files**, and **0% duplication** across **43 sources**. Typecheck, lint, docstrings (91 declarations), production audit (zero vulnerabilities), pack dry-run, changelog and publish-attestation checks also pass. Thresholds are unchanged.

[PR #25](https://github.com/unbraind/pm-lint/pull/25) carries the current-head CI receipts for Node 22/npm and Node 26/npm plus Bun full release gates. The pm item records local results and links this review boundary. Automatic reviewers that skip or hit quota do not constitute review approval; the PR remains for review and orchestrator verification.
