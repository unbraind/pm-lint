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

`pm package install` registers and activates the extension in the tracker. Run `pm lint`, `npx pm lint`, or `bunx --bun pm lint` after installation. Minimum host SDK: `2026.10.13`; Node `>=22.18.0`.

```sh
npm ci
npm run build
npm pack
pm package install ./pm-lint-2026.10.13.tgz
pm lint
pm lint --json
pm lint rules --json
pm lint --output-include item_id,rule,title,excerpt --output-budget 2000
pm lint --rule PML002 --rule PML004 --fail-on warn
pm lint --disable PML006 --severity error --type Feature --status open
pm lint --id project-abcd --id project-efgh --since 2026-10-01
pm --pm-path path/to/tracker/.agents/pm lint --json
```

`--rule`, `--disable` and `--id` are repeatable. `--rule` selects exactly those rules and can re-enable rules disabled in settings; `--disable` wins when both flags name the same rule. `--severity` overrides every enabled rule's severity. `--fail-on` defaults to `error` and is inclusive: `warn` fails on warnings and errors, `info` on every finding. `--since` selects items updated on or after a calendar date (UTC) or explicitly zoned ISO timestamp. Types match exact SDK metadata values. `--status` accepts comma-separated statuses and overrides each rule's default scope for the selected items. Item IDs must exist in the certified corpus.

The commands use the host renderer: TOON by default and global `--json` for automation. Every finding has `item_id`, `rule`, `severity`, `field`, `hint`, the item `title`, and an `excerpt` of the offending value trimmed to at most 160 characters. Missing-field findings use an empty excerpt. PML003 excerpts the first failing criterion; PML009 excerpts the unresolvable blocker reference. Treat diagnostic output as source context: it may contain private item text.

`summary` counts findings for every rule and severity, including zeros. `scanned` is the selected item count; `corpus_count` and `complete_list` prove the entire tracker was read before selection. Lint never edits an item or records test results in the scanned tracker. Both `pm lint` and `pm lint rules` declare the SDK `read_output` contract, so host projection (`--output-include` / `--output-exclude`), row limits, output budgets and `--output-cursor` continuations apply. Bounded output can contain fewer rows than `count`; read the host truncation receipt and follow every cursor, or use `--output-budget unbounded --output-limit unbounded` for a full report. Exit status and summary describe the full evaluation even when rendered rows are bounded.

`pm lint rules` lists each rule's code, default severity, default scope, field, description, hint and settings key.

| Code | Default severity | Default scope | Field | Checks |
| --- | --- | --- | --- | --- |
| PML001 | warn | non_terminal | title | Placeholder, under three words, or ticket-only title |
| PML002 | error | non_terminal | acceptance_criteria | Feature, Issue or Task lacks criteria |
| PML003 | warn | non_terminal | acceptance_criteria | Placeholder criterion, title restatement, or fewer than three words without an observable noun or verb |
| PML004 | error | closed | resolution | Missing closure evidence beyond the title |
| PML005 | warn | active | updated_at | Stale in-progress work or stale ownership without recent activity |
| PML006 | info | all | files | Feature has neither linked files nor linked tests |
| PML007 | warn | non_terminal | parent | Epic has no children in the complete tracker |
| PML008 | info | non_terminal | description | Description or notes only repeat the title |
| PML009 | error | blocked | blocked_reason | Missing blocker reason or unresolvable local blocker |
| PML010 | warn | active | title | Active titles form SDK duplicate clusters |

Authoring rules skip closed and canceled history by default. `non_terminal` and `active` cover unfinished statuses, including blocked and draft. PML010 uses the SDK's duplicate corpus of open, in-progress and blocked items. Scope restricts which items emit findings; hierarchy and duplicate context still use the complete corpus. A per-rule `scope` setting changes that default; explicit `--status` takes precedence over settings and evaluates every enabled rule on the named lifecycle. Rule-specific conditions still apply (for example, PML002 checks only work types and PML005 checks in-progress or owned work).

PML003 deliberately flags vague assertions rather than requiring every fragment to match a verb whitelist. `works`, `done`, `fixed`, `complete`, `ok`, `as expected`, `looks good`, `should work`, `TBD`, `N/A`, and `see description` are rejected, as are assertions identical to the title. Concrete examples such as `pm-cli-data.json regenerated`, `Any drifted snippet is corrected in all locales`, and `Publication and deployment state distinguished from candidate validation` pass. Semicolons and newlines delimit assertions; the first vague fragment produces one item-level finding. This conservative heuristic does not prove that an outcome is true or sufficiently specified.

Each rule is individually configurable. Heuristics are authoring prompts and do not certify the truth of item evidence. PML010 uses the public SDK `analyzeDuplicateItems` capability on the certified active corpus. It preserves the SDK scorer and candidate-pair safety bound. The SDK caps output at 1,000 clusters; reaching that cap causes an error because complete duplicate findings cannot be proven. A refused SDK analysis fails the command rather than reporting a passing gate.

Place a `lint` section in the tracker's `settings.json`:

```json
{
  "lint": {
    "enable": ["PML001"],
    "disable": ["PML006"],
    "failOn": "error",
    "rules": {
      "PML003": { "severity": "info", "scope": "all" },
      "PML005": { "parameters": { "staleDays": 14 } },
      "PML010": { "enabled": true, "parameters": { "threshold": 0.92 } }
    }
  }
}
```

All rules start enabled. Settings apply enable/disable lists, then per-rule entries, then CLI overrides. Supported severities are `error`, `warn`, and `info`. Supported scopes are `all`, `non_terminal`, `active`, `terminal`, `closed`, `canceled`, `open`, `in_progress`, and `blocked`. `terminal` includes closed and canceled items; single-status scopes match exactly. `staleDays` must be finite and positive; duplicate `threshold` must be greater than zero and at most one. Unknown codes, parameters, keys and invalid values are errors. The current SDK strips custom sections from `readSettings`, so the package validates core settings through that API and retrieves the custom section using public SDK settings-path and storage helpers.

Exit code `0` means no finding met the failure threshold. Exit code `1` means one or more findings met it. Invalid arguments, settings, incomplete storage, or refused duplicate analysis cause a host error and nonzero exit, rather than a clean lint receipt.

A tracker quality gate can start with errors and progressively adopt warnings:

```yaml
- run: npm ci
- run: pm lint --fail-on error --json
```

Run the host in a workspace where the package is activated. The package's own `release:check` covers identity/privacy, TypeScript, ESLint, jscpd, docstrings, all authored source coverage, production audit, package contents, changelog, release attestation and packed npm/native-Bun consumers. New packages stay unreleased until maintainer approval; the release workflow is dispatch-only and additionally gated by `PM_LINT_RELEASE_ENABLED`.

Dogfood receipts, heuristic tuning decisions, coverage and behavioural revert proofs are recorded in the package tracker. The aggregate before/after corpus comparison and hand-checked PML003 sample are in [the dogfood report](docs/dogfood-round.md). Public evidence contains only aggregate counts and generic verdicts; raw titles, criteria and tracker configuration stay out of the repository.
