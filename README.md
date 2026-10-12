# pm-lint

Project management = context management. Vague work items waste agent time because they cannot explain what to do, how to verify it, or what already happened. `pm-lint` judges authoring quality. Use it alongside `pm validate` for structure and references, `pm health` for workspace health, and `pm duplicates` for duplicate discovery.

This package is unreleased and under local review. The following registry commands become available after maintainer-approved publication. For local review, build and install a packed artifact into a scratch tracker.

```sh
pm package install npm:pm-lint

npm install --save-dev pm-lint @unbrained/pm-cli
npx pm package install ./node_modules/pm-lint

bun add --dev pm-lint @unbrained/pm-cli
bunx --bun pm package install ./node_modules/pm-lint

npx --package @unbrained/pm-cli pm package install npm:pm-lint
bunx --bun --package @unbrained/pm-cli pm package install npm:pm-lint
```

`pm package install` registers and activates the extension in the tracker. Run `pm lint`, `npx pm lint`, or `bunx --bun pm lint` after installation. Minimum host SDK: `2026.10.10`; Node `>=22.18.0`.

```sh
npm ci
npm run build
npm pack
pm package install ./pm-lint-2026.10.12.tgz
pm lint
pm lint --json
pm lint --rule PML002 --rule PML004 --fail-on warn
pm lint --disable PML006 --severity error --type Feature --status open
pm lint --id project-abcd --id project-efgh --since 2026-10-01
pm --pm-path path/to/tracker/.agents/pm lint --json
```

`--rule`, `--disable` and `--id` are repeatable. `--rule` selects exactly those rules and can re-enable rules disabled in settings; `--disable` wins when both flags name the same rule. `--severity` overrides every enabled rule's severity. `--fail-on` defaults to `error` and is inclusive: `warn` fails on warnings and errors, `info` on every finding. `--since` selects items updated on or after a calendar date (UTC) or explicitly zoned ISO timestamp. Types and statuses match exact SDK metadata values. Item IDs must exist in the certified corpus.

The command uses the host renderer: TOON by default and the global `--json` for automation. Every finding has `item_id`, `rule`, `severity`, `field`, and a one-line `hint`. Output contains no source titles, descriptions, or comments. `scanned` is the selected item count; `corpus_count` and `complete_list` prove the entire tracker was read before selection. Lint never edits an item or records test results in the scanned tracker.

| Code | Default | Checks | Bad example | Good example |
| --- | --- | --- | --- | --- |
| PML001 | warn | Placeholder, under three words, or ticket-only title | `Fix stuff` / `ABC-123` | `Reject malformed import cursors` |
| PML002 | error | Open/in-progress Feature, Issue or Task lacks criteria | Task with empty criteria | `An invalid cursor returns an error before any item is written` |
| PML003 | warn | Criteria have no observable verb/condition, say only works/done, or repeat the title | `Works` | `The command returns exit code 1 for malformed input` |
| PML004 | error | Closed work lacks resolution, actual result, or closure evidence beyond its title | Close with `Add cursor validation` | `Cursor regression tests pass 4/4; commit abc123 rejects cycles` |
| PML005 | warn | In-progress work is stale; claims lack recent activity | In progress with no update for 20 days | Recent comment explains a verification result; release unused claims |
| PML006 | info | Feature has neither linked files nor linked tests | Feature with no implementation links | Link `src/reader.ts` or a reproducible test command |
| PML007 | warn | Epic has no children in the complete tracker | Empty Epic | Parent a concrete Feature or Task to the Epic |
| PML008 | info | Description or notes only repeat the title | Title and description both `Reject malformed import cursors` | Description explains the failing input, boundary and expected outcome |
| PML009 | error | Blocked work lacks a reason or references an unresolvable local blocker | Blocked with no reason; missing local dependency | Explain the required event and link an existing blocker item |
| PML010 | warn | Active titles form SDK duplicate clusters | Two open Tasks titled `Reject malformed import cursors` | Describe separate scopes, or retain one canonical Task |

Each rule is individually configurable. Heuristics are authoring prompts and do not certify the truth of item evidence. PML010 uses the public SDK `analyzeDuplicateItems` capability on the certified active corpus. It preserves the SDK scorer and candidate-pair safety bound. The SDK caps output at 1,000 clusters; reaching that cap causes an error because complete duplicate findings cannot be proven. A refused SDK analysis fails the command rather than reporting a passing gate.

Place a `lint` section in the tracker's `settings.json`:

```json
{
  "lint": {
    "enable": ["PML001"],
    "disable": ["PML006"],
    "failOn": "error",
    "rules": {
      "PML003": { "severity": "info" },
      "PML005": { "parameters": { "staleDays": 14 } },
      "PML010": { "enabled": true, "parameters": { "threshold": 0.92 } }
    }
  }
}
```

All rules start enabled. Settings apply enable/disable lists, then per-rule entries, then CLI overrides. Supported severities are `error`, `warn`, and `info`. `staleDays` must be finite and positive; duplicate `threshold` must be greater than zero and at most one. Unknown codes, parameters, keys and invalid values are errors. The current SDK strips custom sections from `readSettings`, so the package validates core settings through that API and retrieves the custom section using public SDK settings-path and storage helpers.

Exit code `0` means no finding met the failure threshold. Exit code `1` means one or more findings met it. Invalid arguments, settings, incomplete storage, or refused duplicate analysis cause a host error and nonzero exit, rather than a clean lint receipt.

A tracker quality gate can start with errors and progressively adopt warnings:

```yaml
- run: npm ci
- run: pm lint --fail-on error --json
```

Run the host in a workspace where the package is activated. The package's own `release:check` covers identity/privacy, TypeScript, ESLint, jscpd, docstrings, all authored source coverage, production audit, package contents, changelog, release attestation and packed npm/native-Bun consumers. New packages stay unreleased until maintainer approval; the release workflow is dispatch-only and additionally gated by `PM_LINT_RELEASE_ENABLED`.

Dogfood receipts, heuristic tuning decisions, coverage and behavioural revert proofs are recorded in the package tracker. Only codes, counts and IDs from observational scans are retained; private source text is excluded.

The read-only dogfood runs used the actual `pm --pm-path … lint --json` command on the companion tracker (937 items), `pm-rl` (78), and `pm-web` (151). Filesystem write restrictions and before/after SHA-256 inventories confirmed that every tracker stayed unchanged.

| Rule | Companion | pm-rl | pm-web |
| --- | ---: | ---: | ---: |
| PML001 | 5 | 0 | 0 |
| PML002 | 50 | 1 | 7 |
| PML003 | 137 | 17 | 31 |
| PML004 | 3 | 0 | 3 |
| PML005 | 15 | 0 | 7 |
| PML006 | 65 | 5 | 11 |
| PML007 | 24 | 0 | 0 |
| PML008 | 0 | 0 | 0 |
| PML009 | 1 | 0 | 0 |
| PML010 | 2 | 0 | 0 |

Dogfood tuning: the first PML003 pass produced 255/40/65 findings. Samples included observable action verbs, past-tense results and explicit readable/absent/unchanged states that the initial narrow vocabulary missed. Recognizing those conditions reduced the counts to 137/17/31 while retaining checks on each semicolon/newline assertion and on criteria that repeat the title. These are heuristic counts, not a measured corpus-wide precision score. Subjective claims such as “better quality” still fail; “works” and “done” remain explicitly rejected.

Other conservative defaults keep PML006 informational, retain PML001's required three-word minimum as a warning, accept human blocker prose and external URLs for PML009, recognize SDK hierarchy aliases and closed children for PML007, and use a 0.92 SDK duplicate threshold. PML005 uses recent comments, notes and test-run evidence to avoid flagging a fresh active claim. No additional rules were introduced.
