# Changelog

## 2026.11.24 - 2026-11-24

### Other

- Adopt pm-cli 2026.11.23 host-aligned SDK behaviour ([pm-lint-sdk-1122](https://github.com/unbraind/pm-lint/blob/main/.agents/pm/chores/pm-lint-sdk-1122.toon))

### Dependencies

- Bump the codeql-action group with 2 updates ([#103](https://github.com/unbraind/pm-lint/pull/103))

## 2026.11.23 - 2026-11-23

No changes.

## 2026.11.18 - 2026-11-18

### Fixed

- Install the pinned release npm into a job-local prefix ([pm-lint-qcob](https://github.com/unbraind/pm-lint/blob/main/.agents/pm/issues/pm-lint-qcob.toon))

## 2026.11.17 - 2026-11-17

### Other

- Unblock the pm-github 2026.11.15 pin PR gates ([pm-lint-hsa6](https://github.com/unbraind/pm-lint/blob/main/.agents/pm/tasks/pm-lint-hsa6.toon))
- Split quick PR checks from exhaustive local CI ([pm-lint-ci-v2](https://github.com/unbraind/pm-lint/blob/main/.agents/pm/tasks/pm-lint-ci-v2.toon))

### Dependencies

- Bump eslint ([#96](https://github.com/unbraind/pm-lint/pull/96))
- Bump the pm-toolchain group with 2 updates ([#95](https://github.com/unbraind/pm-lint/pull/95))
- Bump pm-changelog ([#91](https://github.com/unbraind/pm-lint/pull/91))
- Bump the pm-toolchain group with 3 updates ([#89](https://github.com/unbraind/pm-lint/pull/89))
- Bump @babel/eslint-parser ([#90](https://github.com/unbraind/pm-lint/pull/90))

## 2026.11.14 - 2026-11-14

### Dependencies

- Bump @unbrained/pm-cli from 2026.11.9 to 2026.11.10 in the pm-toolchain group ([#82](https://github.com/unbraind/pm-lint/pull/82))

## 2026.11.12 - 2026-11-12

### Other

- Adopt SDK lint settings section reads ([pm-lint-sdk-settings-sections](https://github.com/unbraind/pm-lint/blob/main/.agents/pm/chores/pm-lint-sdk-settings-sections.toon))

### Dependencies

- Bump @unbrained/pm-cli ([#81](https://github.com/unbraind/pm-lint/pull/81))
- Bump jscpd ([#78](https://github.com/unbraind/pm-lint/pull/78))
- Bump @unbrained/pm-cli ([#77](https://github.com/unbraind/pm-lint/pull/77))
- Bump the pm-toolchain group with 2 updates ([#72](https://github.com/unbraind/pm-lint/pull/72))
- Bump unbraind/pm-github/.github/workflows/pm-github-sync.yml ([#75](https://github.com/unbraind/pm-lint/pull/75))
- Bump the codeql-action group across 1 directory with 2 updates ([#73](https://github.com/unbraind/pm-lint/pull/73))
- Bump unbraind/pm-github/.github/workflows/pm-github-closeout.yml ([#74](https://github.com/unbraind/pm-lint/pull/74))
- Bump the pm-toolchain group with 3 updates ([#70](https://github.com/unbraind/pm-lint/pull/70))

## 2026.11.7 - 2026-11-07

No changes.

## 2026.11.6 - 2026-11-06

### Fixed

- SDK 2026.10.30 upgrade breaks repair-preview transport and replay equality ([pm-lint-github-253a36d6af64-57](https://github.com/unbraind/pm-lint/blob/main/.agents/pm/issues/pm-lint-github-253a36d6af64-57.toon))

### Dependencies

- Bump unbraind/pm-github/.github/workflows/pm-github-closeout.yml ([#54](https://github.com/unbraind/pm-lint/pull/54))
- Bump unbraind/pm-github/.github/workflows/pm-github-sync.yml ([#53](https://github.com/unbraind/pm-lint/pull/53))
- Bump the pm-toolchain group across 1 directory with 3 updates ([#56](https://github.com/unbraind/pm-lint/pull/56))

## 2026.11.4 - 2026-11-04

No changes.

## 2026.11.3 - 2026-11-03

### Dependencies

- Bump the dependencies group across 1 directory with 2 updates ([#50](https://github.com/unbraind/pm-lint/pull/50))
- Bump the pm-toolchain group with 3 updates ([#48](https://github.com/unbraind/pm-lint/pull/48))

## 2026.10.31 - 2026-10-31

### Dependencies

- Bump the pm-toolchain group with 3 updates ([#45](https://github.com/unbraind/pm-lint/pull/45))

## 2026.10.29 - 2026-10-29

### Added

- Explain incompatible organization rules with minimal witnesses ([pm-lint-conflicting-rule-pack-witnesses](https://github.com/unbraind/pm-lint/blob/main/.agents/pm/features/pm-lint-conflicting-rule-pack-witnesses.toon))

### Dependencies

- Bump @unbrained/pm-cli ([#44](https://github.com/unbraind/pm-lint/pull/44))

## 2026.10.28 - 2026-10-28

### Added

- Preserve complete lint results with incremental rule invalidation ([pm-lint-incremental-invalidation](https://github.com/unbraind/pm-lint/blob/main/.agents/pm/features/pm-lint-incremental-invalidation.toon))
- Preview minimal authoring repairs without writing tracker state ([pm-lint-authoring-repair-previews](https://github.com/unbraind/pm-lint/blob/main/.agents/pm/features/pm-lint-authoring-repair-previews.toon))
- Enforce portable organization authoring rule packs ([pm-lint-portable-rule-packs](https://github.com/unbraind/pm-lint/blob/main/.agents/pm/features/pm-lint-portable-rule-packs.toon))
- Acknowledge lint debt with source-bound evidence ([pm-lint-lint-baselines](https://github.com/unbraind/pm-lint/blob/main/.agents/pm/features/pm-lint-lint-baselines.toon))
- Validate declared acceptance criterion witnesses without executing code ([pm-lint-criterion-witnesses](https://github.com/unbraind/pm-lint/blob/main/.agents/pm/features/pm-lint-criterion-witnesses.toon))
- Certify complete tracker lint reads ([pm-lint-engine](https://github.com/unbraind/pm-lint/blob/main/.agents/pm/features/pm-lint-engine.toon))
- Register host rendered lint command ([pm-lint-cli](https://github.com/unbraind/pm-lint/blob/main/.agents/pm/features/pm-lint-cli.toon))
- Configure lint rules through SDK settings ([pm-lint-settings](https://github.com/unbraind/pm-lint/blob/main/.agents/pm/features/pm-lint-settings.toon))
- Dogfood improvement round: precise PML003, finding excerpts, scopes, lint rules and read_output ([pm-lint-trap](https://github.com/unbraind/pm-lint/blob/main/.agents/pm/features/pm-lint-trap.toon))
- Implement ten authoring quality rules ([pm-lint-rules](https://github.com/unbraind/pm-lint/blob/main/.agents/pm/features/pm-lint-rules.toon))
- Certify package CI and packed consumers ([pm-lint-gate](https://github.com/unbraind/pm-lint/blob/main/.agents/pm/features/pm-lint-gate.toon))

### Changed

- Adopt pm-github 2026.10.16: default-branch-safe gated sync and daily gated closeout PRs ([pm-lint-8kis](https://github.com/unbraind/pm-lint/blob/main/.agents/pm/chores/pm-lint-8kis.toon))
- Enable the gated GitHub issue sync and drop the braces chain ([pm-lint-maint1014](https://github.com/unbraind/pm-lint/blob/main/.agents/pm/chores/pm-lint-maint1014.toon))

### Fixed

- Daily release never publishes: npm reads release-artifact/package.tgz as a GitHub repository ([pm-lint-4tem](https://github.com/unbraind/pm-lint/blob/main/.agents/pm/issues/pm-lint-4tem.toon))

### Other

- Release readiness behind PM_RELEASE_APPROVED ([pm-lint-release-gate](https://github.com/unbraind/pm-lint/blob/main/.agents/pm/chores/pm-lint-release-gate.toon))
- Publish pm-lint as @unbrained/pm-lint ([pm-lint-scoped-npm-name](https://github.com/unbraind/pm-lint/blob/main/.agents/pm/chores/pm-lint-scoped-npm-name.toon))
- Use the pm SDK for baseline command refusals ([pm-lint-sdk-adoption-1025](https://github.com/unbraind/pm-lint/blob/main/.agents/pm/tasks/pm-lint-sdk-adoption-1025.toon))
- Reconcile stale in-progress tracker records (2026-10-23) ([pm-lint-reconcile-1023](https://github.com/unbraind/pm-lint/blob/main/.agents/pm/chores/pm-lint-reconcile-1023.toon))
- Cover package tooling: gates, workflows and packed consumers ([pm-lint-vh3f](https://github.com/unbraind/pm-lint/blob/main/.agents/pm/tasks/pm-lint-vh3f.toon))
- Register merge drivers during CI install ([pm-lint-41oh](https://github.com/unbraind/pm-lint/blob/main/.agents/pm/tasks/pm-lint-41oh.toon))
- Declare the schema capability so packed command flags activate ([pm-lint-1c6j](https://github.com/unbraind/pm-lint/blob/main/.agents/pm/tasks/pm-lint-1c6j.toon))

### Dependencies

- Bump the pm-toolchain group with 3 updates ([#40](https://github.com/unbraind/pm-lint/pull/40))
- Bump the pm-toolchain group across 1 directory with 3 updates ([#38](https://github.com/unbraind/pm-lint/pull/38))
- Bump unbraind/pm-github/.github/workflows/pm-github-sync.yml ([#37](https://github.com/unbraind/pm-lint/pull/37))
- Bump unbraind/pm-github/.github/workflows/pm-github-closeout.yml ([#36](https://github.com/unbraind/pm-lint/pull/36))
- Bump the codeql-action group with 2 updates ([#35](https://github.com/unbraind/pm-lint/pull/35))
- Bump jscpd ([#31](https://github.com/unbraind/pm-lint/pull/31))
- Bump the pm-toolchain group with 3 updates ([#30](https://github.com/unbraind/pm-lint/pull/30))
- Bump the pm-toolchain group across 1 directory with 3 updates ([#16](https://github.com/unbraind/pm-lint/pull/16))
- Bump the codeql-action group across 1 directory with 2 updates ([#15](https://github.com/unbraind/pm-lint/pull/15))
- Bump the pm-toolchain group across 1 directory with 2 updates ([#13](https://github.com/unbraind/pm-lint/pull/13))
- Bump eslint ([#14](https://github.com/unbraind/pm-lint/pull/14))
- Bump the pm-toolchain group with 3 updates ([#12](https://github.com/unbraind/pm-lint/pull/12))
- Bump pm-changelog ([#10](https://github.com/unbraind/pm-lint/pull/10))
- Bump the pm-toolchain group with 2 updates ([#8](https://github.com/unbraind/pm-lint/pull/8))
- Bump the dependencies group across 1 directory with 3 updates ([#1](https://github.com/unbraind/pm-lint/pull/1))
- Bump actions/setup-node from 7.0.0 to 7.1.0 ([#5](https://github.com/unbraind/pm-lint/pull/5))
- Bump actions/upload-artifact from 7.0.1 to 7.0.2 ([#3](https://github.com/unbraind/pm-lint/pull/3))
- Bump the codeql-action group across 1 directory with 2 updates ([#2](https://github.com/unbraind/pm-lint/pull/2))
- Bump actions/download-artifact from 8.0.1 to 8.0.2 ([#4](https://github.com/unbraind/pm-lint/pull/4))
