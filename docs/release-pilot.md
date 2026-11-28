# Pinned Daily Release pilot

This package delegates its release transaction to
`unbraind/pm-ops/.github/workflows/daily-release.yml` at
`c46a2419c63af3b348e6b559b0733ab0d9942cc7 # v2026.11.18`.
The canonical Git tag API identifies that object directly as a commit; the local
peeled tag agrees. This release installs npm 11.21.0 in a job-local prefix and verifies the effective
version. The pin preserves the shared-runner isolation introduced in pm-lint #92.

The caller retains the daily preparation schedule and adds canonical hourly
reconciliation, opt-in unpublished-intent retirement, empty workflow permissions
and the shared transaction's job permissions. Root Dependabot configuration
already covers `github-actions`, including this SHA and canonical version comment.

The caller retains the exact repository/main guards and the string-valued `vars.PM_RELEASE_APPROVED == 'true'` condition through `release-enabled`. The shared Bun verifier reads the scoped npm identity from package.json.

Tracking: [package epic](https://github.com/unbraind/pm-lint/blob/main/.agents/pm/epics/pm-lint-epic.toon).

All package changelog generate/check/notes scripts explicitly include
`--include-empty`. They already carried the option at the migration baseline;
the pilot retains it without duplication and regenerates CHANGELOG.md. The
unreleased persistence work in pm-ops PR #275 is therefore a no-op for these
scripts and is not required by this pilot pin.

## Activation gate

The first scheduled or orchestrator-dispatched run must pass **Verify npm will
accept this workflow's OIDC identity** for this cross-repository reusable call.
Until that live token exchange succeeds, activation is unverified. npm trusted
publishing stays configured for this package's own repository and `release.yml`;
no trusted-publisher setting change is required. The exchange checks identity,
while npm must separately permit the publish action. Neither local YAML checks
nor a previous same-repository exchange prove this cross-repository acceptance.

No merge, release dispatch or publication is performed by the pilot PR.

## Pre-merge prerequisites

The package keeps its current pm-ops 2026.11.14 validator and pm-changelog
2026.11.13 dependency. pm-changelog issue #337 is closed. The package changelog
commands still use the same explicit empty-release policy.
The hosted OIDC identity exchange remains the activation gate.

## Fleet rollout receipt

This pilot is part of [pm-ops #272](https://github.com/unbraind/pm-ops/issues/272),
tracked centrally by `ops-release-diagnosis-propagation`. Both pilot PR URLs and
final validation receipts are recorded in the package pilot items. No additional
pm-ops code/tracker PR or push to #275 is part of this continuation.

Pilot PRs: [pm-jira #209](https://github.com/unbraind/pm-jira/pull/209) merged.
[pm-lint #85](https://github.com/unbraind/pm-lint/pull/85) still requires review
and orchestrator activation.

After pm-lint and pm-jira, the remaining 34 authorized packages are:

pm-ado, pm-beads, pm-brand, pm-brief, pm-case, pm-changelog, pm-context, pm-csv, pm-evidence, pm-gantt-chart, pm-github, pm-glossary, pm-graph, pm-http, pm-hypothesis, pm-jev, pm-linear, pm-memory, pm-presets, pm-reduce, pm-review, pm-rl, pm-rlm, pm-rust, pm-screen, pm-slack, pm-slack-standup, pm-starter, pm-swarm, pm-todos, pm-ts-starter, pm-unit, pm-vcs, pm-web.

pm-cli is excluded. Roll out in small reviewed batches after both pilots have
passed their live preflight. Preserve approval guards, package scripts, outputs,
extra publishing targets and synthetic services. Affected older raw changelog
generators must satisfy pre-tag/post-tag checks or resolve the existing
[pm-changelog #337](https://github.com/unbraind/pm-changelog/issues/337) prerequisite.
Only the orchestrator merges, dispatches and verifies publication.
