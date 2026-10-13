# Dogfood improvement round

Measured on 2026-10-13 against the companion tracker and every available fleet tracker. Each original tracker was copied to isolated projects before installing the baseline or candidate packed tarball. The baseline is commit `7a8209f`; the candidate contains this improvement round. Both runs used host SDK `2026.10.13`. The candidate is the final `2026.10.13` packed artifact used after short-fragment corpus tuning.

Commands in each copied project were `pm install <packed-artifact> --project --json`, followed by `pm lint --json`. The candidate additionally used `--output-budget unbounded --output-limit unbounded`. The baseline does not declare `read_output` and refuses those universal controls; its original renderer emits the full JSON receipt. The reader certifies complete item coverage, including terminal items, before applying rule scopes. Item, history, settings and supporting source file SHA-256 inventories matched before and after every comparison; original trackers were never installation targets. Runtime caches and installed extensions were excluded from inventories and copies.

The table uses **before → after** counts. Each row uses the same original input for both runs. Counts combine the PML003 inversion and the new default lifecycle scopes; they are not an isolated precision estimate. The single PML002 increase is the old open/in-progress predicate widening to every non-terminal status, not a new missing-criteria false positive. Staleness uses the measurement time, so old receipts from a different day can differ by a stale item.

Across **26 trackers and 5,998 items**, findings changed **2,216 → 640**; PML003 changed **1512 → 0**.

| Repo | Items | Total | PML001 | PML002 | PML003 | PML004 | PML005 | PML006 | PML007 | PML008 | PML009 | PML010 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| companion | 937 | 303 → 141 | 5 → 0 | 50 → 51 | 137 → 0 | 3 → 3 | 16 → 16 | 65 → 65 | 24 → 3 | 0 → 0 | 1 → 1 | 2 → 2 |
| pm-ado | 23 | 14 → 3 | 0 → 0 | 1 → 1 | 11 → 0 | 0 → 0 | 0 → 0 | 2 → 2 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| pm-beads | 90 | 36 → 13 | 0 → 0 | 1 → 1 | 23 → 0 | 1 → 1 | 4 → 4 | 7 → 7 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| pm-brief | 81 | 29 → 10 | 0 → 0 | 1 → 1 | 19 → 0 | 0 → 0 | 4 → 4 | 5 → 5 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| pm-changelog | 181 | 54 → 13 | 0 → 0 | 2 → 2 | 41 → 0 | 3 → 3 | 3 → 3 | 5 → 5 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| pm-cli | 2949 | 1115 → 165 | 0 → 0 | 0 → 0 | 920 → 0 | 0 → 0 | 0 → 0 | 165 → 165 | 8 → 0 | 22 → 0 | 0 → 0 | 0 → 0 |
| pm-context | 74 | 21 → 6 | 0 → 0 | 2 → 2 | 15 → 0 | 0 → 0 | 4 → 4 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| pm-csv | 110 | 42 → 19 | 0 → 0 | 3 → 3 | 23 → 0 | 10 → 10 | 2 → 2 | 4 → 4 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| pm-gantt-chart | 97 | 41 → 24 | 0 → 0 | 2 → 2 | 17 → 0 | 7 → 7 | 3 → 3 | 11 → 11 | 0 → 0 | 0 → 0 | 1 → 1 | 0 → 0 |
| pm-github | 116 | 42 → 19 | 0 → 0 | 4 → 4 | 23 → 0 | 1 → 1 | 3 → 3 | 11 → 11 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| pm-graph | 93 | 37 → 21 | 0 → 0 | 6 → 6 | 16 → 0 | 1 → 1 | 4 → 4 | 8 → 8 | 0 → 0 | 0 → 0 | 2 → 2 | 0 → 0 |
| pm-jev | 19 | 7 → 7 | 0 → 0 | 7 → 7 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| pm-jira | 101 | 45 → 28 | 0 → 0 | 3 → 3 | 17 → 0 | 13 → 13 | 2 → 2 | 8 → 8 | 0 → 0 | 0 → 0 | 2 → 2 | 0 → 0 |
| pm-linear | 97 | 35 → 19 | 0 → 0 | 4 → 4 | 16 → 0 | 6 → 6 | 2 → 2 | 7 → 7 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| pm-lint | 6 | 5 → 5 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | 5 → 5 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| pm-ops | 136 | 58 → 19 | 0 → 0 | 6 → 6 | 32 → 0 | 0 → 0 | 9 → 9 | 4 → 4 | 0 → 0 | 7 → 0 | 0 → 0 | 0 → 0 |
| pm-presets | 72 | 30 → 11 | 0 → 0 | 3 → 3 | 19 → 0 | 1 → 1 | 2 → 2 | 4 → 4 | 0 → 0 | 0 → 0 | 1 → 1 | 0 → 0 |
| pm-rl | 78 | 24 → 7 | 0 → 0 | 1 → 1 | 17 → 0 | 0 → 0 | 1 → 1 | 5 → 5 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| pm-rust | 52 | 13 → 4 | 0 → 0 | 1 → 1 | 9 → 0 | 0 → 0 | 2 → 2 | 1 → 1 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| pm-slack | 83 | 26 → 12 | 0 → 0 | 3 → 3 | 14 → 0 | 1 → 1 | 2 → 2 | 6 → 6 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| pm-slack-standup | 91 | 32 → 13 | 0 → 0 | 3 → 3 | 19 → 0 | 1 → 1 | 1 → 1 | 8 → 8 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| pm-starter | 72 | 21 → 7 | 0 → 0 | 2 → 2 | 14 → 0 | 1 → 1 | 2 → 2 | 2 → 2 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| pm-todos | 89 | 37 → 13 | 2 → 0 | 3 → 3 | 22 → 0 | 1 → 1 | 5 → 5 | 4 → 4 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| pm-ts-starter | 76 | 30 → 11 | 0 → 0 | 4 → 4 | 19 → 0 | 1 → 1 | 3 → 3 | 3 → 3 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| pm-vcs | 123 | 58 → 21 | 0 → 0 | 4 → 4 | 37 → 0 | 0 → 0 | 0 → 0 | 17 → 17 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| pm-web | 152 | 61 → 29 | 0 → 0 | 7 → 7 | 32 → 0 | 3 → 3 | 8 → 8 | 11 → 11 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| **Total** | **5998** | **2216 → 640** | 7 → 0 | 123 → 124 | 1512 → 0 | 54 → 54 | 82 → 82 | 368 → 368 | 32 → 3 | 29 → 0 | 7 → 7 | 2 → 2 |

## Hand-checked PML003 sample

The first candidate left two default-scope hits naming an observable CI artifact and a rollback action. Both were hand-checked false positives under the requested short-criterion rule. An opt-in terminal-history probe also exposed an observable container health state. All three have regression cases, and the final packed candidate was re-run against every frozen corpus copy.

There are **zero remaining default-scope PML003 hits**, so a ten-hit remaining sample cannot be drawn. Instead, the first ten baseline PML003 hits in deterministic item-ID order were inspected in full and reviewed after the change. The categories below are generic paraphrases of that ordered sample; private titles, criteria, IDs and configuration are not published. This is a qualitative spot check, not a measured corpus-wide precision score.

| Sample | Lifecycle | Generic criterion category | Verdict |
| --- | --- | --- | --- |
| 1 | open | Concurrent writes and revision assertions | Concrete: competing-writer tests, revision reconciliation, typed relations, batch counts, credential preflight and coverage gates are observable. It stays in default scope. The old finding was a false positive. |
| 2 | closed | Generated data and build checks | Mixed: generated data, avoided examples and aligned descriptions are inspectable; a completion clause is vague. Closed history is also outside default authoring scope. |
| 3 | closed | Schema, isolation and policy requirements | Mixed: schemas, isolation and gated execution are observable; broad contract and approval wording still needs review. Closed history is also outside default authoring scope. |
| 4 | closed | Redirect outcomes and exceptions | Response codes, destinations, preserved inputs and named exceptions can be tested. Closed history is also outside default authoring scope. |
| 5 | closed | Completion wording plus locale and build checks | Mixed: completion wording alone is vague; locale coverage and buildability are observable. A longer phrase that merely contains "complete" is not an exact placeholder, so the new predicate does not flag it. Closed history is also outside default authoring scope. |
| 6 | closed | Tooling gates and recorded state | Typecheck, coverage, audit, pack, changelog and recorded repository state are observable. Closed history is also outside default authoring scope. |
| 7 | closed | Checkout and lifecycle gates | Clean checkouts, linked receipts, configured gates and reviewed heads are observable. Closed history is also outside default authoring scope. |
| 8 | open | Shared fixture locations | A shared location, per-repository identity assertions and a version-bump rollout are inspectable. It stays in default scope. The old finding was a false positive. |
| 9 | closed | Second completion wording plus locale and build checks | Mixed for the same reason as sample 5. Closed history is also outside default authoring scope. |
| 10 | blocked | Linked evidence and a reviewed candidate | Census evidence, a reviewed candidate and explicit remaining gaps are mostly inspectable; one qualitative clause still needs judgement. Blocked items stay in the default non-terminal scope. The old finding was a false positive under the new predicate. |

Longer subjective prose can pass this conservative heuristic. A zero-hit run does not certify that every criterion is precise, true or complete. Placeholder positives and the three concrete examples from the task are covered by regression tests.

## Behavioural revert proof

Eight isolated mutations each produced an assertion failure while the current implementation passed: restore the original PML003 verb heuristic; remove the engine scope guard; empty finding excerpts; leave summary counts at zero; replace flag descriptions with generic labels; remove both `read_output` declarations; return an empty rule listing; and remove the corpus-derived short-observable vocabulary. The mutations ran with the current regression tests over real SDK-created temporary trackers, without SDK mocks. Source files in the package worktree were not reverted.

Targeted commands used `node --test --test-name-pattern <scenario> test/rules.test.ts`, `test/engine.test.ts`, or `test/commands.test.ts`, matching the criteria, scope, excerpt, summary, activation and listing scenarios. Full release gates, exact test counts and packed npm/native-Bun results are recorded in the package tracker and PR.
