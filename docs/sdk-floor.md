# Published pm SDK capability floor

Audited main: `8bca66afd4b36d906bd8b0b14b424b87db03f25a`. Required API floor: **2026.10.17**.

Declared host floor: `2026.10.20`. npm peer: `>=2026.10.20`.

floor verified: the host declaration and the npm peer or exact runtime dependency already cover every API below. No floor change is needed.

## Artifact method and limits

The published version list was obtained with `npm view @unbrained/pm-cli versions --json`. Each capability was bisected over stable published releases, with its first providing release and adjacent previous stable release inspected. Prereleases do not satisfy these stable npm minimum ranges. Tarballs were downloaded with `npm pack @unbrained/pm-cli@VERSION --ignore-scripts` into an isolated scratch directory and inspected as data. No downloaded pm package code or lifecycle script was executed.

Public module exports were checked against both `package.json` entrypoints and the static ESM runtime export graph, then their `dist` declarations. Client methods and context members were read from the published declarations, including inherited members and static methods. A context property is attributed to the context used by this package, rather than a later base-interface refactor. TypeScript symbol resolution covers aliases, typed lazy loaders, destructuring, and clients passed through helpers. Erased interfaces do not create runtime requirements; imported function/constructor types used by loaders are retained conservatively.

This establishes API availability. It does not attest older-host runtime semantics, provider integration, or execution on the declared minimum. The current pinned SDK remains the local test host.

## API to first-version table

The machine-readable source inventory and artifact hashes are in [sdk-floor.json](sdk-floor.json). Source locations refer to the audited main commit.

| Used API | First stable release | Previous stable release lacking it | Source uses |
| --- | --- | --- | --- |
| `@unbrained/pm-cli/sdk :: certifyCompleteListResult` | 2026.8.18 | 2026.8.17 | [src/engine.ts:1](../src/engine.ts#L1), [src/repairs.ts:4](../src/repairs.ts#L4), [src/rule-pack.ts:3](../src/rule-pack.ts#L3), [src/witnesses.ts:4](../src/witnesses.ts#L4) |
| `@unbrained/pm-cli/sdk :: createPmCliExpectedError` | 2026.6.5 | 2026.5.31 | [src/commands.ts:2](../src/commands.ts#L2) |
| `@unbrained/pm-cli/sdk :: defineCommand` | 2026.6.23 | 2026.6.22 | [src/commands.ts:2](../src/commands.ts#L2), [src/repair-command.ts:1](../src/repair-command.ts#L1), [src/rule-pack-command.ts:2](../src/rule-pack-command.ts#L2), [src/witness-command.ts:2](../src/witness-command.ts#L2) |
| `@unbrained/pm-cli/sdk :: getSettingsPath` | 2026.5.14 | 2026.5.12 | [src/settings.ts:1](../src/settings.ts#L1), [src/repairs.ts:4](../src/repairs.ts#L4) |
| `@unbrained/pm-cli/sdk :: loadGuardedRuntimeSchema` | 2026.10.17 | 2026.10.15 | [src/repairs.ts:4](../src/repairs.ts#L4) |
| `@unbrained/pm-cli/sdk :: locateItem` | 2026.5.14 | 2026.5.12 | [src/repairs.ts:4](../src/repairs.ts#L4) |
| `@unbrained/pm-cli/sdk :: planItemMutationDocument` | 2026.10.17 | 2026.10.15 | [src/repairs.ts:4](../src/repairs.ts#L4) |
| `@unbrained/pm-cli/sdk :: PmClient` | 2026.7.6 | 2026.7.5 | [src/engine.ts:2](../src/engine.ts#L2), [src/commands.ts:1](../src/commands.ts#L1), [src/commands.ts:2](../src/commands.ts#L2), [src/repairs.ts:4](../src/repairs.ts#L4), [src/rule-pack.ts:4](../src/rule-pack.ts#L4), [src/rule-pack-command.ts:2](../src/rule-pack-command.ts#L2), [src/witnesses.ts:5](../src/witnesses.ts#L5), [src/witness-command.ts:2](../src/witness-command.ts#L2) |
| `@unbrained/pm-cli/sdk :: previewItemMutations` | 2026.10.2 | 2026.10.1 | [src/repairs.ts:4](../src/repairs.ts#L4) |
| `@unbrained/pm-cli/sdk :: readFileIfExists` | 2026.5.14 | 2026.5.12 | [src/settings.ts:1](../src/settings.ts#L1), [src/repairs.ts:4](../src/repairs.ts#L4) |
| `@unbrained/pm-cli/sdk :: readSettings` | 2026.5.14 | 2026.5.12 | [src/settings.ts:1](../src/settings.ts#L1), [src/repairs.ts:4](../src/repairs.ts#L4) |
| `@unbrained/pm-cli/sdk :: RelationshipKindRegistry` | 2026.7.15 | 2026.7.14 | [src/rules.ts:1](../src/rules.ts#L1) |
| `@unbrained/pm-cli/sdk :: resolveItemTypeRegistry` | 2026.5.14 | 2026.5.12 | [src/repairs.ts:4](../src/repairs.ts#L4) |
| `@unbrained/pm-cli/sdk :: splitAcceptanceCriteria` | 2026.7.23 | 2026.7.22 | [src/witnesses.ts:4](../src/witnesses.ts#L4) |
| `@unbrained/pm-cli/sdk :: splitFrontMatter` | 2026.5.14 | 2026.5.12 | [src/repairs.ts:4](../src/repairs.ts#L4) |
| `@unbrained/pm-cli/sdk :: toImportTags` | 2026.5.27 | 2026.5.24 | [src/repairs.ts:4](../src/repairs.ts#L4) |
| `@unbrained/pm-cli/sdk :: toNonEmptyImportString` | 2026.5.27 | 2026.5.24 | [src/repairs.ts:4](../src/repairs.ts#L4) |
| `@unbrained/pm-cli/sdk/authoring :: defineExtension` | 2026.7.26 | 2026.7.25 | [index.ts:1](../index.ts#L1) |
| `@unbrained/pm-cli/sdk/query :: analyzeDuplicateItems` | 2026.9.6 | 2026.9.5 | [src/engine.ts:3](../src/engine.ts#L3) |
| `CommandHandlerContext.global` | 2026.5.1 | 2026.3.12 | [src/commands.ts:59](../src/commands.ts#L59), [src/commands.ts:86](../src/commands.ts#L86), [src/rule-pack-command.ts:12](../src/rule-pack-command.ts#L12), [src/witness-command.ts:13](../src/witness-command.ts#L13) |
| `CommandHandlerContext.options` | 2026.5.1 | 2026.3.12 | [src/commands.ts:56](../src/commands.ts#L56), [src/commands.ts:57](../src/commands.ts#L57), [src/commands.ts:82](../src/commands.ts#L82), [src/repair-command.ts:8](../src/repair-command.ts#L8), [src/rule-pack-command.ts:9](../src/rule-pack-command.ts#L9), [src/rule-pack-command.ts:11](../src/rule-pack-command.ts#L11), [src/witness-command.ts:9](../src/witness-command.ts#L9), [src/witness-command.ts:12](../src/witness-command.ts#L12) |
| `CommandHandlerContext.pm_root` | 2026.5.1 | 2026.3.12 | [src/commands.ts:59](../src/commands.ts#L59), [src/commands.ts:60](../src/commands.ts#L60), [src/commands.ts:86](../src/commands.ts#L86), [src/commands.ts:87](../src/commands.ts#L87), [src/repair-command.ts:9](../src/repair-command.ts#L9), [src/rule-pack-command.ts:12](../src/rule-pack-command.ts#L12), [src/witness-command.ts:13](../src/witness-command.ts#L13) |
| `CommandHandlerContext.repo_root` | 2026.7.25 | 2026.7.24 | [src/commands.ts:59](../src/commands.ts#L59), [src/commands.ts:86](../src/commands.ts#L86), [src/rule-pack-command.ts:10](../src/rule-pack-command.ts#L10), [src/witness-command.ts:10](../src/witness-command.ts#L10) |
| `CommandHandlerContext.source_workspace_root` | 2026.7.25 | 2026.7.24 | [src/commands.ts:59](../src/commands.ts#L59), [src/commands.ts:86](../src/commands.ts#L86), [src/rule-pack-command.ts:10](../src/rule-pack-command.ts#L10), [src/witness-command.ts:10](../src/witness-command.ts#L10) |
| `ExtensionApi.registerCommand` | 2026.5.1 | 2026.3.12 | [src/commands.ts:106](../src/commands.ts#L106), [src/commands.ts:107](../src/commands.ts#L107), [src/commands.ts:108](../src/commands.ts#L108), [src/repair-command.ts:18](../src/repair-command.ts#L18), [src/rule-pack-command.ts:29](../src/rule-pack-command.ts#L29), [src/witness-command.ts:24](../src/witness-command.ts#L24) |
| `PmClient.listAllComplete` | 2026.8.18 | 2026.8.17 | [src/engine.ts:90](../src/engine.ts#L90), [src/repairs.ts:150](../src/repairs.ts#L150), [src/rule-pack.ts:156](../src/rule-pack.ts#L156), [src/witnesses.ts:147](../src/witnesses.ts#L147) |
| `RelationshipKindRegistry.resolve` | 2026.7.15 | 2026.7.14 | [src/rules.ts:122](../src/rules.ts#L122) |

## Tarball provenance

SHA-256 of the exact packed `.tgz` bytes; package archives and extracted files are not committed.

| pm release | Tarball SHA-256 |
| --- | --- |
| 2026.3.12 | `4e4e6a33cb45d665f072120e9e1ce25d2e5773e738cbc914b29e8f54367747fb` |
| 2026.5.1 | `730de8b79aa0074dc2ca81a54ce37f9aaa0a4167b690c9a62b87d2121a8b37f7` |
| 2026.5.12 | `42dcaef84dc441b7792aeffa059bfe10a86ae8b12b1084472229bba03fb29910` |
| 2026.5.14 | `7f7e9131afadb891344bf2fb93b15bc157d18c532a5da4ec31677957d37b7260` |
| 2026.5.24 | `9d28fff4b06405ea5691ee919ad646c86c0a416a5007ca8104b19251306262af` |
| 2026.5.27 | `afd3c6e0ecca429510f049019069802c0034a3e99fb711035b5b22fc8fa643dd` |
| 2026.5.31 | `d3b4a795704588e414070a22a4034d7fbd7a290a050509cc4852e0051c0969a7` |
| 2026.6.5 | `bb47c85bb2ce1a8ba858651af8d1f4ca6888bc731d0aaaa63a4b97427219cd89` |
| 2026.6.22 | `2fc292ff819a82eb79010a45ec017ab3003c9a8fecb525bc203916151aa33bd9` |
| 2026.6.23 | `090693b440b0e5f4fe101ac029ebf5a533cf3b38ef384885edf82d2a8a4e3aca` |
| 2026.7.5 | `4a6664f68120cace5648faf48d51b08c14e969d9c7e185e592f1a0fceae57274` |
| 2026.7.6 | `0d6e446cf93a0f0660ce4e21943adf1e0c21381010ef67369f40cc9834b8d158` |
| 2026.7.14 | `4a42de258a3b1cabff1112dd90ae4f3cc272e25ada229d818becae0f2845e128` |
| 2026.7.15 | `1c5d8e7427d74af157577ff58e0692a986016ee355eaf3a6b5ccebca5a9779aa` |
| 2026.7.22 | `d013832d6afc97c9a5c6f4a48a497f54a216643f8c7017b9c4f807ce6607532b` |
| 2026.7.23 | `caf1a21b0b587dc55c3509654466dd1e20383e30f2d17b47678887a15a5490af` |
| 2026.7.24 | `ae7757c7e4b02bf5c0908a7bcfd487926912bc2f71332c68c9e1be4017d796ab` |
| 2026.7.25 | `20dfec2ca4ddfcebd484af686b76aebcb1f479a7b81c781380a7fe6b6f8506f5` |
| 2026.7.26 | `b10b647a7fce423106dfb964934ac2d43b8770f8f085df89a13c9a04e75569cc` |
| 2026.8.17 | `fda330eb4887031751889ef85b510d52886fa5f70b4813f3951d7eed705023f2` |
| 2026.8.18 | `b00374f0e32c98ccec03a5893d8bfbbae45650f44bd04292ceafd8d9aac059f7` |
| 2026.9.5 | `9ff8c5f6cb74df02df9de1e2c38044c1afb199ffb7a330a3d034a1b1d23a6ed5` |
| 2026.9.6 | `28505ef7ddb3869f794be63411ff250197f002d0595e04c68860d28cf549ac34` |
| 2026.10.1 | `54eafd4428b5554a1860aa5311349f7dff167a63560f55e7f1315da63a775c02` |
| 2026.10.2 | `d1cc9a7c6ccc1da01788cf307be73cca81089215a88a63ce41c32803fdc45e3e` |
| 2026.10.15 | `e4e59abcff5644704897f4313df614a9e09bf6bcf552b0c8035836043ab0a11c` |
| 2026.10.17 | `3e6e29647629a89973881d0223c43ac08abcbf39ffd87cc4579daa07e55a79b8` |
