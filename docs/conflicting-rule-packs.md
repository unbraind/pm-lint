# Conflicting organization rules

```sh
pm lint conflicts --pack examples/conflicting-rules.json --json
pm lint conflicts --pack examples/conflicting-rules.json
```

The example requires and forbids `reviewed` in the same scope. Both renderers
return the declared rule IDs `ORG.forbid-review` and `ORG.require-review` as the
smallest witness, with `status: conflict` and exit 1. No tracker read is needed.

```ts
import { analyzeRulePack, readRulePack } from '@unbrained/pm-lint';

const pack = await readRulePack('examples/conflicting-rules.json');
const analysis = analyzeRulePack(pack);
console.log(analysis.status, analysis.witness?.rule_ids, analysis.remedy);
```

The additive version 1 grammar supports these field/operator pairs:

| Field | Predicate | Domain |
| --- | --- | --- |
| `tags` | `required_tag`, `forbidden_tag` with a string `value` | One literal tag, normalized by the SDK's `toImportTags` on both inputs and stored rows |
| `priority` | `min_value`, `max_value` with an integer `value` | Inclusive native priorities 0 through 4 |
| Existing text fields | `present`, `min_length`, `max_length` | UTF-16 length 0 through 65,536; a native title is nonempty |

For example, `priority >= 3` and `priority <= 2` form a two-rule witness.
Equal bounds are compatible. `present` and `max_length: 0` conflict; a title
`max_length: 0` is impossible alone because native titles cannot be empty.
All severities participate: advisory assertions can contradict one another too.

The 512-unit literal ceiling applies to both the supplied and canonical UTF-16
tag. Unicode lowercasing can expand text: 256 repetitions of U+0130 normalize
to exactly 512 units and remain valid; 257 or 300 repetitions refuse with
`limit_exceeded` before analysis or tracker access. File reads, repeated SDK
parsing, policy evaluation and JSON/TOON commands use this same boundary.

Each `when.statuses` and `when.types` list is an exact OR selector; dimensions
are ANDed. A witness includes their nonempty intersection. Disjoint selectors
cannot conflict. Status names are exact configured identities, with no lifecycle
interpretation. Rename selectors when the configured identities change.
Policy admission examines every potentially applicable selector intersection,
even if the current tracker has no matching item.

`compatible` means the supported conjunction is satisfiable in its documented
domain. `contains`, `not_contains` and `starts_with` remain valid for policy
evaluation but are outside this analyzer's proof fragment. They produce
`unknown` and `unknown_rule_ids` when no supported contradiction exists. A
supported conflict remains a proof even when other rules are unknown. Unknown
operator names, executable predicates and malformed packs remain typed refusals;
they are not silently accepted as an expanded grammar.

Witnesses have minimum cardinality within the documented proof fragment, across
the whole pack, rather than just being irreducible after greedy removal. Every
supported core has one or two rules. Singletons win over pairs; ties choose the
lexicographically first sorted rule-ID tuple, independently of input ordering
or locale. IDs are the pack's unique, declared identities; no random IDs or
content-derived replacements are generated. Unknown predicates cannot conceal
a smaller singleton contradiction in this grammar. A witness does not claim
to enumerate every contradiction involving predicates outside the fragment.

The analyzer uses the same strict parser and preflight as `pm lint pack`.
Applying a proven inconsistent pack returns `conflicting_pack`, its rule IDs and
a remedy before any SDK corpus read. An unknown analysis permits the existing
literal evaluator to inspect item compliance; it does not assert satisfiability.
The analysis command exits 0 for compatible, 1 for conflict, and 2 for unknown
or a typed refusal. The policy command retains its finding exit codes and
returns 2 for a proven contradictory policy.

Existing version 1 producers, IDs, text semantics and serialization order remain
valid. Sparse SDK arrays and incompatible field/operator combinations refuse.
The common 64-rule, 64-KiB, finite-integer and selector bounds apply before
analysis. Output contains only bounded IDs, selectors, counts and remedies, with
no item bodies; host TOON/JSON transport applies normally. Analysis costs at
most 2,016 pair checks plus a singleton pass. Every emitted count is an exact
bounded integer. The feature creates no items, state files, journals, replay
keys, leases or shared mutable state, and introduces no import/export/sync
mutation path.

The seeded model regression executes 500 operation sequences including old
pack/document replays, JSON/TOON and Markdown storage, whitespace/CRLF variants,
relationships, ambient focus and every native field selected by the grammar.
An independent finite-domain oracle checks global minimum witnesses; two real
non-git SDK trackers supply normalization and native read-back. It also covers
producer/parser round trips. The finite oracle is exhaustive for its generated
tag and bounded-integer domain; it makes no claim about arbitrary text programs.

## Public tracker validation

The validation command is `node test/public-conflict-validation.ts <copy>`.
Use an immutable, read-only public tracker copy outside git. The receipt reports
corpus/rule/check/finding counts, both witness sizes, JSON/TOON bytes, reordered
result equality and a before/after inventory hash. Aggregate measurements and
the exact public source revision are recorded in the PR and package tracker.

Measured against public pm-lint main revision
`57a49b5b9e2b4d69f2a80b4b9f1da33af7ef9b0e`: 23 items, 3 rules,
69 checks and 24 findings (23 missing reviewed tags, 1 below the lower priority
bound, 0 above the upper bound). Both conflict fixtures returned size-2
witnesses. The tag-conflict receipt occupied 334 JSON bytes / 313 TOON bytes
(84 / 79 estimated tokens at four UTF-8 bytes per token). Rule reordering
preserved the complete result. The read-only snapshot inventory stayed
`aeef29c3eeaa99af5eb146a43a8fa90b5cd88defc50a5c363ee6dfe500447912`.
This is policy diagnosis on one public corpus, not a judgment that its items
must follow the synthetic reviewed-tag policy.
