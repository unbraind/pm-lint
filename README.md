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

## Evidence-backed baselines

Use a baseline to keep specific old findings visible while failing every new finding. Each finding now includes `rule_version`, a SHA-256 `source_digest` of its full canonical source item, and `disposition` (`new` or `debt`). Digests include all item metadata and full text, including text beyond the displayed excerpt. Any source-item change invalidates its acknowledgments; unrelated new items preserve existing debt. Rule semantics changes require a `RULE_VERSION` increment and invalidate older evidence.

```sh
pm lint --json --output-include item_id,rule,rule_version,source_digest
# Copy one observed finding's identity, version and digest; review its full source.
pm lint acknowledge --baseline lint-baseline.json \
  --id project-abcd --rule PML002 --reason 'Legacy criteria debt; repair scheduled' \
  --rule-version 1 --source-digest <observed-sha256>
pm lint --baseline lint-baseline.json --json
pm lint --baseline lint-baseline.json \
  --output-include item_id,rule,disposition --output-budget 2000
```

Acknowledgment creates or updates only the named JSON file. It rechecks the complete tracker and refuses missing findings or changed evidence. A nonempty reason of at most 1,000 characters is required. There is no bulk acknowledgment or wildcard. Commit the reviewable baseline file alongside the policy decision. Cooperating CLI writers use an exclusive lock and atomic replacement; a busy lock returns a retry remedy. Do not edit the file concurrently with a command.

The baseline gate requires the complete tracker and all ten default rules. It refuses selection flags, severity/failure-threshold overrides, disabled rules and nondefault lint settings with `unsafe_policy`; restore default settings before using it. Output retains **all** findings and the ordinary per-rule summary, adds `debt_count`, `new_count`, `stale_count`, and labels each row. `stale_count` includes resolved findings and obsolete evidence; stale entries never count as debt. Exit `0` means no new findings, `1` means new findings at **any** severity (`fail_on: info`), and `2` is a typed baseline refusal with `code`, `message` and `remedy`. Malformed or missing baseline files fail closed. Host projection and continuation controls apply to baseline checks too.

The SDK exports `LintBaseline`, `Acknowledgment`, `BaselineRefusal`, `parseBaseline`, `sourceDigest`, `RULE_VERSION` and `acknowledgeFinding`. `lintItems(client, pmRoot, { baseline })` uses the same complete gate on any SDK tracker backend. SDK baseline refusals throw `BaselineRefusal`; the CLI renders them as compact TOON or JSON. See [the SDK example](docs/baseline-example.md) and [public-data validation](docs/baseline-validation.md). A baseline records an explicit authoring-debt decision; it does not certify that the finding or its reason is true.

## Acceptance-criterion witnesses

`pm lint witnesses --contract criterion-witnesses.json` checks the declared link
from **every** stored criterion to a linked test, a file observation, or explicitly
pending proof. It never runs code, reads a Git history, fetches URLs, or guesses
that prose establishes support. Core SDK criteria parsing and certified complete
reads apply to every lifecycle status, including closed and canceled items.

```sh
pm lint witnesses --contract criterion-witnesses.json --json
pm lint witnesses --contract criterion-witnesses.json \
  --output-include item_id,criterion,state,citation --output-budget 2000
```

The strict version 1 JSON contract contains `bindings`, each with `item_id`, exact
`criterion` text, and a nonempty `witnesses` array. Unknown keys and duplicate
item/criterion bindings refuse. Criteria use core's semicolon boundaries; exact
text identity survives reordering and unrelated item edits. Every criterion
without a binding reports `missing`, even if its item contains tests or comments.

| Witness kind | Required fields beyond `kind` | Meaning |
| --- | --- | --- |
| `test` | `command` and/or `path`, `sha256`, `outcome` | Match one exact linked-test declaration; `sourceDigest(test)` binds all metadata, including provenance and assertions |
| `observation` | `path`, `sha256`, `outcome` | Hash the exact local artifact bytes with `observationDigest(bytes)` |
| `pending` | `reason` | Explicitly unfinished proof with a nonblank reason |

Test and observation outcomes are explicitly declared `pass` or `fail`. A
`supported` row means the reference and digest match the declaration. It does
**not** certify that a test ran, that an observation proves the criterion, or
that a claimed outcome is true. Digest refreshes require evidence review.
`pending` is visible unfinished work and always fails the gate.

| State | Interpretation |
| --- | --- |
| `supported` | Evidence reference and complete digest match a declared pass |
| `pending` | Proof is explicitly deferred |
| `missing` | Current criterion has no declared binding |
| `dangling` | Referenced item, linked test, or file does not exist |
| `stale` | Criterion text was removed/changed, or referenced evidence digest changed |
| `contradictory` | Outcome declares failure against the criterion, or test identity is ambiguous |

Each witness produces a row. A failing outcome plus stale/dangling evidence
produces both findings so neither condition hides the other. Mixed pass/fail
witnesses remain contradictory; passing evidence cannot suppress any failure or
pending proof. Removed-item bindings are dangling; removed-criterion bindings
are stale, and replacement criteria remain missing until explicitly bound.

Observation paths are relative to the evidence workspace. They retain exact
citation spelling, including `:line[:column]` or `#Lline[-Lline]`; the digest
covers the whole file. Traversal, absolute observation paths and symlinks escaping
the workspace refuse. Missing files are dangling; unreadable artifacts refuse.
Test paths are exact tracker identities, with no filesystem lookup.

The host renders TOON by default or JSON with `--json`. `findings` rows carry
`item_id`, `criterion`, `state`, exact `citation`, and a remedy. Rows sort by exact
UTF-16 `item_id`, `criterion`, `citation`, then `state`, independently of host locale
and declaration order. Unicode spellings are never normalized. Counts and summary
cover the full evaluation; host projection, budgets, row limits and cursor
continuations apply. `count` counts finding rows, `criteria_count` counts stored
criteria, and `corpus_count` counts certified items. Exit `0` means every finding is
`supported`, including when the tracker has no criteria (a contract binding for a
removed item still emits `dangling` and exits `1`), `1` means any
unfinished/invalid proof, and `2` means a typed refusal with `code`, `message` and
`remedy`. SDK input/I/O refusals throw `WitnessRefusal`; incomplete tracker reads
remain SDK errors and never become a passing empty corpus.

SDK exports include `lintWitnesses(client, contract, evidenceRoot)`,
`parseWitnessContract`, `readWitnessContract`, `observationDigest`,
`WitnessRefusal`, and typed contract/result interfaces. The sidecar and artifacts
are caller-owned local inputs; the client can target any supported tracker
backend. No witness command changes tracker data. See the
[SDK and JSON example](docs/witness-example.md) and
[public tracker validation](docs/witness-validation.md).

## Without git

Linting, rule listing, acknowledgment, baseline checks and witness checks work in plain directory trackers without a git executable. These commands do not require repository history. The SDK baseline model is independent of git and tracker storage; CLI baseline files use the local filesystem.

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

## Portable organization authoring rules

`pm lint pack --pack authoring-rules.json` checks semantic authoring conventions
through the same certified complete reader as the built-in rules. It reads every
status, then applies the pack's explicit selectors. It does not change items or
settings. pm-presets can distribute configuration and templates; core owns field
types; this contract adds organization-specific assertions over canonical text.
See the shipped [example pack](examples/authoring-rules.json).
Measured public-data and adapter evidence is in the
[validation report](docs/portable-rule-packs-validation.md).

```sh
pm lint pack --pack examples/authoring-rules.json
pm lint pack --pack examples/authoring-rules.json --json
```

The strict version 1 contract is `{ "version": 1, "rules": [...] }`. Each rule
requires `id`, `field`, `predicate`, `severity`, `explanation`, and `remedy`.
Rule ids are unique, case-sensitive ASCII identifiers beginning with a letter;
subsequent characters may be letters, digits, `_`, `.` or `-`. Unknown keys fail
at every level, including predicates and selectors; unknown versions fail closed.

| Property | Version 1 semantics |
| --- | --- |
| `field` | `title`, `description`, `acceptance_criteria`, `definition_of_ready`, `resolution`, `blocked_reason`, `outcome`, `value`, `why_now` |
| `predicate` | `{ "op": "present" }`, or `{ "op": "contains" / "not_contains" / "starts_with", "value": "literal" }`, or `{ "op": "min_length" / "max_length", "value": integer }` |
| `severity` | `info`, `warn`, `error`; only failed `error` assertions fail the gate |
| `explanation`, `remedy` | Required nonblank organization-authored diagnostic text, at most 256 characters each |
| `when` | Optional object with `statuses` and/or `types` exact string arrays; OR within each array, AND between them; no selector means all items |

Matching is case-sensitive and literal, including characters such as `*` and `+`.
Missing text fields behave as empty strings. `present` tests trimmed nonemptiness;
other predicates use the original text. Length counts UTF-16 code units.
Regex, glob and executable expression modes refuse with `unsafe_pattern` and a
literal-predicate remedy. There are no imports, nested expressions or commands.

Hard ceilings are 64 KiB of UTF-8 JSON, 64 rules, 64 characters per id/selector,
32 values per selector list, 512 characters per literal, 65,536 characters per
checked item field or length threshold, 100,000 potential item/rule pairs before
selection, and 1,000 findings. Empty rule/selector arrays refuse. Exceeding a
ceiling returns `limit_exceeded`; no partial result can pass. For SDK input the
byte ceiling applies to the detached canonical pack; for files it also applies
to the raw bytes, including whitespace. Regular files only are accepted.

Rows contain `item_id`, `rule`, `field`, `severity`, `explanation` and `remedy`.
They sort by exact item id then rule id, independent of locale, declaration order
and storage order. Receipts include corpus/check/finding counts, severity counts
and core's complete-list certificate. Item titles and text are not copied into
rows. Host output budgets and continuation controls apply to `findings` in TOON
and JSON. Exit codes are 0 for no error findings, 1 for error findings, and 2 for
typed pack refusals (`invalid_pack`, `unsafe_pattern`, `limit_exceeded`, `pack_io`).
Core read/certification failures retain core's diagnostic instead of becoming a
successful or partial pack result. Baseline acknowledgments do not suppress pack
rules; they belong to the separate built-in lint command.

```ts
import { PmClient } from '@unbrained/pm-cli/sdk';
import { lintRulePack, readRulePack, RulePackRefusal } from 'pm-lint';
import type { RulePack } from 'pm-lint';

const pack: RulePack = await readRulePack('authoring-rules.json');
try {
  const result = await lintRulePack(new PmClient({ pmRoot: '.agents/pm' }), pack);
  console.log(result.summary, result.exit_code);
} catch (error) {
  if (error instanceof RulePackRefusal) console.error(error.code, error.remedy);
  else throw error;
}
```

`parseRulePack(unknown)` validates SDK-supplied data. `lintRulePack` accepts the
`listAllComplete` portion of the typed `PmClient` contract so adapters can supply
the same certified canonical metadata without filesystem access in the evaluator.
Tests compare real TOON and legacy JSON Markdown reader results; the pinned host
migrates legacy Markdown during reading. These tests do not attest hosted database
or network deployment. Pack semantics never inspect storage paths or invoke git.

## Without git

All lint commands, baselines, witness validation and portable packs work in a
plain tracker directory. No lint command requires a git repository. Package
release changelog generation uses git tags separately from tracker linting.
