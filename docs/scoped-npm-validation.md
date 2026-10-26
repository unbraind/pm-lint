# Scoped npm package validation

Tracking: [pm-lint-scoped-npm-name](https://github.com/unbraind/pm-lint/blob/main/.agents/pm/chores/pm-lint-scoped-npm-name.toon).

The npm coordinate is `@unbrained/pm-lint`; manifest identity, display name and commands remain `pm-lint`. The homepage is `https://pm-cli.unbrained.dev/packages/pm-lint`, and scoped publication retains public access.

## Packed install proof

After `npm run build`, `npm pack --ignore-scripts --json --pack-destination "$PROOF"` produced `unbrained-pm-lint-2026.10.13.tgz` with 69 allowlisted files. `PROOF` denotes a fresh scratch directory outside Git. Each consumer had a minimal private package manifest and an isolated home/configuration; `git rev-parse --is-inside-work-tree` failed in both consumer directories as expected.

Commands below use scratch variables in place of machine-specific locations. `TARBALL` names that packed artifact. Both package managers installed it in their own temporary prefix:

```sh
npm install --prefix "$PROOF/npm" --ignore-scripts --no-audit --no-fund "$TARBALL" @unbrained/pm-cli@2026.10.20
bun add --cwd "$PROOF/bun" --ignore-scripts "$TARBALL" @unbrained/pm-cli@2026.10.20
```

Both exited 0. Reading each installed `node_modules/@unbrained/pm-lint/package.json` confirmed `name: @unbrained/pm-lint`.

In the npm consumer, these commands matched the README's tarball activation path:

```sh
npx --no-install pm init lint-consumer --defaults --agent-guidance skip --json
npx --no-install pm install "$TARBALL" --json
npx --no-install pm create Feature 'Weak context item' --description 'Weak context item' --json
npx --no-install pm lint --json
```

The Bun consumer ran the same arguments through `bunx --bun --no-install pm`. Initialization, installation and item creation exited 0 in both. Installation reported `ok: true`, `extension.name: pm-lint`, `activated: true`, `runtime_activation_status: ok`, `verification.status: ok`, and all six existing lint commands. Real lint exited 1 in both with `scanned: 1`, `count: 3`, and rules `PML002`, `PML006`, `PML008` on the synthetic item. Exit 1 is the expected failing lint verdict, not an install failure.

Native `bun pm pack --ignore-scripts --destination "$PROOF" --quiet` also exited 0 and produced `unbrained-pm-lint-2026.10.13.tgz` with 69 files, npm name `@unbrained/pm-lint` and manifest name `pm-lint`.

The pinned host requires `npm:@unbrained/pm-lint` for registry resolution. In the npm consumer, `npx --no-install pm install @unbrained/pm-lint --dry-run --json` exited 3 with `local_source_not_found_bare_name` and recommended `pm package install npm:@unbrained/pm-lint`. The extension has no standalone executable, so direct `npx @unbrained/pm-lint` and `bunx @unbrained/pm-lint` are not runnable commands. Registry publication is outside this validation; all executable install proofs use the packed bytes.

## Regression proof

`node --test test/package-metadata.test.ts` passes 2/2. Independently restoring the original `package.json` or the original registry Bun package name in `.github/workflows/release.yml` produces one failure in the corresponding test. Restoring the intended changes returns 2/2. The linked pm test also passes 2/2. `npm run typecheck` and `npm run lint` pass.

`test/install.acceptance.ts` checks the tarball name, installed scoped npm identity, unchanged activated manifest identity, real lint findings, all SDK import examples, baselines, witnesses, portable rule packs and repair previews through npm/npx and native Bun/bunx.

## Release gates

Both `npm run release:check` and `bun run release:check` pass with isolated home and Git configuration: each reports 123/123 suite tests and 1/1 packed acceptance test, zero failures and zero skips. Each coverage evaluation reconciles all 24 intended source files at 100% statements, branches, functions and lines. Thresholds are unchanged. Duplication is 0%, all 91 declarations are documented, and the production dependency audit reports zero vulnerabilities. Identity, typecheck, lint, pack dry-run, changelog consistency and publish-attestation checks pass. Isolated `pm health --strict-exit --require-merge-drivers` passes. The changed-file privacy scan reports zero matches.

This branch is independent of open PR #26. Its release approval changes are not included. The overlapping metadata and README sections must retain this scoped npm name and the unscoped catalog homepage; the homepage assertion in that PR must use the explicit catalog URL rather than deriving it from the scoped npm name. No package was published or PR merged.
