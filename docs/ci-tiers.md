# Fleet CI v2

Required checks remain `test (22)`, `test (26)` and `codeql`. PRs and manual
dispatch use GitHub-hosted Ubuntu at quick depth. Superseded PR runs cancel;
every PR job has a 30-minute timeout. Docs/tracker-only PRs keep the required
checks by running the contracts that consume their changed inputs.

| Existing check | Code PR 22 | Code PR 26 | Docs/tracker PR (both) | Deep 22/26 |
| --- | --- | --- | --- | --- |
| npm ci / merge-driver prepare | yes | yes | yes | yes |
| Strict tracker health / required merge drivers | yes | yes | yes | yes |
| Identity / added private-path policy | yes | yes + gate | yes | yes + gates |
| Build / production and test typecheck | quick tests | npm gate | packed build | full npm + Bun |
| Lint, duplication, docstrings | — | npm gate | — | npm + Bun |
| Build and standard test suite | quick | quick coverage | docs/metadata suite | full npm + Bun |
| Coverage: unchanged 100% statements/branches/functions/lines | — | quick | — | full npm + Bun |
| Production dependency audit | — | npm gate | — | npm + Bun |
| Pack dry-run / packaged file allowlist | — | npm gate + packed acceptance | both | npm + Bun |
| Changelog consistency | — | npm gate | yes | npm + Bun |
| Publish-attestation verification | — | npm gate | yes | npm + Bun |
| README/docs/package identity contracts | suite | suite | release-approval + package-metadata | suite |
| Packed npm/npx + native Bun/bunx consumers | — | npm gate | yes | npm + Bun gates |
| Bun package graph installation / bunx smoke | — | yes | via packed acceptance | yes + Bun gates |
| CodeQL | separate required workflow, all PR/main pushes; weekly Monday 01:47 UTC | same | same | weekly/main workflow |

The docs path retains `identity:check`, `changelog:check`, attestation verification,
pack dry-run, documentation/package-metadata tests, and `test:install`. The
packed consumer acceptance validates the allowlist that includes README, license,
changelog and shipped docs; skipping it would omit a check of changed inputs.
Bun setup therefore also runs for docs-only PRs. Attestation auditing recognizes
shell shebangs regardless of filename. There is no additional standalone secret
or privacy gate beyond the identity/private-path check. Executable tracker files
select code CI. CodeQL is required, so it receives no path filters. Release
workflows, pm-github workflows and release verifier scripts remain unchanged.

Deep runs on main pushes, nightly 02:29 UTC (release is 03:23 UTC), and manual
dispatch. Its job names `deep (22)` and `deep (26)` are distinct from required
checks. Each job has a 120-minute timeout, per-ref cancellation, full depth and
harness scale 3. It runs both npm and Bun full release gates on both Node
versions as requested; the old PR workflow ran Bun's gate only on Node 26.
The local runner pool is selected unless `PM_LOCAL_DEEP=off`. Local jobs use
persistent npm cache and preinstalled Bun; hosted fallback restores npm cache
and installs Bun. Every deep job logs `bun --version`.

Quick uses a deterministic tenth of repetitive 500-case property sequences,
rounded up with a minimum of 25 (capped by full count). Full is the default.
Seed order and every per-case assertion remain. The fuzz success/refusal
minimum is calculated from actual generated outcomes, with an exact generated
case-count assertion; it remains greater than 50 of each at full depth. The
10,000-item incremental contract, 1,001-event pagination, and pack-size boundary
fixtures stay intact. Coverage scope, thresholds and exclusions are unchanged.

Harness test and direct-child command timeouts use `PM_TEST_TIME_SCALE`
(default 1, deep 3), validated finite/positive and rounded up before children
spawn. Packed commands have a five-minute base watchdog with SIGKILL; their
suite has a twenty-minute base test timeout. Workflow job limits independently
bound the gate. Product lock waits, request budgets, and evaluated/reused
operation counts remain unscaled. The incremental performance test already
asserts operation counts and only reports elapsed time diagnostically.

`test:install` already proves npm and Bun project installs, npx and native
bunx launches, project-local binaries and global host installs against the
same packed extension. The extra PR Bun step is a package-graph/CLI smoke,
not another release gate. Full depth is deferred to deep CI after merge.

Baseline [main run 42818809945](https://github.com/unbraind/pm-lint/actions/runs/42818809945)
was on November 10: creation-to-completion 80m49s (22), 94m14s (26). Full npm
gates took 6m16s/5m43s; repeated Bun 26 took 5m43s. The slowest 500-sequence
repair model took about 191–194s; packed acceptance took about 97s. Local quick
proof and the PR CI snapshot are recorded in the tracker and PR. Timings across
different hosts do not establish a same-hardware speed ratio.
