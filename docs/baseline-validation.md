# Public tracker validation

Source: public `unbraind/pm-ops`, `origin/main` commit `eba7d5262fd75e67afce0caad29dae7dc7dfbaeb`, measured on 2026-10-21. Repository visibility was checked through the GitHub REST API. Only committed tracker files were copied; no hosted data or private tracker was read.

The tracker snapshot was extracted into a temporary directory outside git. All snapshot directories and files were made read-only. `GIT_CEILING_DIRECTORIES` fenced the temporary parent. A complete before/after source-byte digest confirmed that the original snapshot remained unchanged. Mutation probes used a separate disposable writable copy.

| Measurement | Result |
| --- | ---: |
| Certified corpus / scanned items | 146 / 146 |
| Findings before baseline | 24 |
| PML002 errors | 10 |
| PML005 warnings | 10 |
| PML006 informational findings | 4 |
| Exact acknowledgments / retained debt | 24 / 24 |
| New / stale after acknowledgment | 0 / 0 |
| Baseline exit | 0 |
| Debt after changing one source item | 23 |
| New / stale after source change | 1 / 1 |
| Source-change exit | 1 |
| Broad rule disabling | Refused: `unsafe_policy` |
| Read-only source bytes | Unchanged |

All other rules reported zero findings. These measurements validate baseline accounting on this source snapshot; they are not package-readiness or finding-truth claims.

To reproduce, prepare a read-only snapshot of the committed public tracker outside git, then run:

```sh
GIT_CEILING_DIRECTORIES=<temporary-parent> \
  node test/public-baseline-validation.ts <snapshot-tracker-root>
```

The script reads the snapshot, acknowledges each exact finding in memory, checks retained debt, then changes one item in a separate disposable copy. Its output contains aggregate counts only. The test suite separately exercises the SDK and acknowledgment command in a plain-directory tracker with a PATH containing no git executable. Packed acceptance checks both npm/npx and native Bun/bunx acknowledgment and baseline verdicts in CI.
