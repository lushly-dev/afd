# Gates

What each gate covers, the traps between them, and the rules for changing them.

The sources of truth are `lefthook.yml` (the hooks and `pnpm check`), `.github/workflows/` (each workflow's `paths` and jobs) and `scripts/affected/` (the scope and the local suites). `pnpm verify --list` prints the plan for a change, so this page lists no workflow's steps; it holds what those files do not say on their face.

## What runs where

- **Pre-commit** fixes the staged files with Biome and typechecks the packages that own them, with their dependents. **Commit-msg** runs commitlint; `commitlint.config.js` has the types and scopes.
- **Pre-push** runs the full lint, the affected packages' tests and typecheck, and the repository-wide checks. It neither installs nor builds, and packages import each other's `dist`, so it fails on stale output: run `pnpm install` after pulling `main`, and `pnpm build` (or `pnpm check`) after changing a package another one imports. A push that only updates the factory lane's refs (`refs/factory/queue/*`, `refs/factory/hosts/*`) runs nothing: a queue ref hands a branch to the lane, which validates it.
- **`pnpm check`** is pre-push plus the affected build and coverage, and is exactly what `ci.yml` runs: if it passes locally, that workflow passes remotely. On pull requests `ci.yml` runs only the `.nvmrc` Node.
- **`pnpm check` is TypeScript only.** It does not touch Python, Rust, C++, Alfred, Botcore, Health or Umbel. For Specimen, FAST-AF, Violet, Loam and the Health dashboard it builds the packages and runs only their browser-free, store-free units.
- **`pnpm verify`** runs `pnpm check`, then, for each workflow whose `pull_request.paths` match the change, the steps `scripts/affected/suites.mjs` lists for it. A suite's `remote` line names what only the workflow covers: other operating systems, Node and Python versions, Firefox and WebKit, sanitizers.
- **The release-tooling suites** run inside the tooling tests only when one of `RELEASE_INPUTS` changes (`scripts/run-tooling-tests.mjs`: `scripts/`, the workflows, `.changeset/`, `.release/`, `.nvmrc`, the root manifest, the lockfile).

## Scope

`scripts/affected.mjs` diffs against the merge base with `origin/main` (`AFD_BASE` in CI) and selects the packages that own changed files, their dependents and, for `pnpm-lock.yaml`, the importers whose resolved dependencies changed. A build adds the scope's dependencies. `pnpm affected` prints the selection and the reason for each package. Lint and the repository-wide checks always run whole.

- A package's own test file selects that package without its dependents. A family's provenance records select no package.
- The files in `GLOBAL_FILES` (`scripts/affected/scope.mjs`: the root manifests and configs, `ci.yml` and the scope scripts) select the whole workspace. `suites.mjs` does not.
- The workflows' path filters do not exempt documentation: a README under `packages/rust/` triggers Rust, Conformance, Alfred, Umbel, Loam and Loam's plugins. Read `pnpm verify --list --files <paths>` before choosing what to touch.

## Daily-only legs

The slowest legs run only on the daily schedule and on manual runs: C++ under TSan, on macOS and Windows, with packaging, benchmarks, fuzzing and Emscripten; Umbel on macOS and on its MSRV; fast-element on Firefox and WebKit; `ci.yml` over the whole workspace on the older supported Node versions.

A pull request cannot show a break in them, so read the daily results (`gh run list --event schedule`). GitHub can start a scheduled run hours late, so a run missing that morning has not necessarily been skipped.

## Unit notes

Only what a failing gate will not explain.

- **Imported families** (FAST-AF, Violet, Specimen, Botcore, Health) are changed here, never in their source repositories first. An edit to an imported file fails the tooling tests until the family's provenance records it; that includes a file a build rewrites, such as FAST-AF's API reports.
  - Specimen and FAST-AF: `node scripts/release/provenance.mjs <family> "<reason>"`. Specimen's record also covers its feature documents under `docs/features/`, so an edit to its `STATUS.md` needs recording too.
  - Violet: `foundations/violet/provenance/adaptations.json`.
  - Botcore: `endpoints/botcore/scripts/record_provenance.py`.
  - Health: `endpoints/health/provenance/provenance.json` and its pinned digest; any added file needs a row.
  - Two branches that edit different files of one unit always conflict in its records' hash lines. `pnpm base:sync` merges records-only conflicts three ways with `scripts/provenance-merge.mjs`, as the factory lane does, and refuses a value both sides changed differently: record that file again by hand. Then run the unit's provenance test.
  - A `package.json` change to dependency ranges alone, as Dependabot makes, is not an adaptation in the three npm families (Specimen, FAST-AF, Violet): their records also hold the manifest's digest with its ranges blanked.
- **FAST-AF:** do not run the upstream `check:v3` scopes or sync from lushly-dev/fast-af, which is frozen. Microsoft FAST releases of `fast-element` come in as a three-way merge from the last release taken, never as copied files: the [FAST-AF README](../../../../foundations/fast-af/README.md#microsoft-fast) has the steps.
- **Violet** lints with its own Biome configuration (`foundations/violet/biome.json`). The root Biome config skips its directories, so `pnpm lint` says nothing about them.
- **Health:** its source repository is private. Never import private Health inventories, reports, history or configuration.
- **Health dashboard:** its committed fixtures must equal the Health CLI's output, so a schema or CLI change in `endpoints/health/` that breaks one fails `fixtures:check` and the browser suite.
- **Umbel:** `Cargo.lock` is committed (the `.gitignore` negates it), so update it with the dependencies. Umbel depends on `packages/rust` by path, so a change there can break it. No `.wasm` file is committed; the suites build the components. One build took its target directory to 14 GB.
- **Loam:**
  - A change to the kernel's `SESSION_50` needs `pnpm -F @lushly-dev/loam-chrome session:record`, which regenerates the chrome's committed journal fixture.
  - An added, removed or retyped theme id needs `pnpm -F @lushly-dev/loam-theme theme:check --write`, which regenerates `contract/tokens.json`.
  - `test:mounted` builds a stock `umbel`; `LOAM_UMBEL_TARGET_DIR` gives that build a target directory of its own.
- **Hosted fixtures:** `pnpm test:hosted:local` needs no credentials and is not evidence about a hosted provider. [Hosted verification](../../../../docs/operations/hosted-verification.md) covers that.

## Changing CI, the scope scripts or a test's inputs

- **Watch it fail.** A new or edited check, hook or gate script is not done until it has been seen red: plant the exact violation it exists to catch in a real file, run it and confirm the output names that violation, remove the plant (restore from a copy, not `git restore`), and see it green. Say in the pull request what you planted and what it printed. A gate also ships with a test that feeds it a violating fixture. The `maintain-gates` skill has the rest: properties over shapes, exemptions that expire, tolerances that reach what they exempt.
- **Skipped tests are registered.** `.only` fails `pnpm check`; an unconditional `.skip`, `.todo` or Playwright `.fixme` in a JavaScript or TypeScript test needs an entry (owner, reason, issue) in `scripts/policy/test-quarantine.json`, and fails once its test recovers. A skip that depends on the environment is written as `skipIf`, `runIf` or Playwright's `test.skip(condition, reason)` instead.
- A new pull-request workflow needs an entry in `scripts/affected/suites.mjs`, or `pnpm verify` cannot run it locally. The tooling tests fail until it has one. `ci.yml` and `ci-ok.yml` are the exceptions.
- `ci-ok` (`ci-ok.yml`, `scripts/ci-verdict.mjs`) is one verdict per pull request: it waits for every workflow the head commit started and passes when each passed or was skipped. It finishes last. Re-running a failed workflow does not re-run it, so re-run `ci-ok` afterwards. `main` requires it. A pull request opened with `GITHUB_TOKEN` starts no workflows, so it gets no `ci-ok`: the Release workflow opens Changesets' release pull request with the release App's token for that reason, and warns when it cannot (then close and reopen the pull request to start its checks).
- **On a merge group** (`merge_group`, the commit a merge queue builds; the queue is not on for `main` yet, so sessions still merge as step 9 says) `ci-ok` is asked for again, and it has to mean the same thing there.
  - No `paths` filter applies to a merge group, so every workflow that runs on pull requests has the trigger and starts for every queued pull request. A path-filtered one opens with the `queue` job (`Merge queue paths`), which runs `node scripts/affected.mjs trigger <its file>`: the files the group adds to its base (`merge_group.base_sha`) against the workflow's own `pull_request.paths`. Every other job needs it, so a group outside the paths costs that one short job. On every other event the job passes straight through; it is never skipped, because a skipped job skips whatever needs it.
  - `ci-ok` checks credit on the commits the group adds (`commit-credit.mjs --merge-group`). GitHub writes the queue's squash message, `Co-authored-by` lines included, and no `--body-file` reaches it, so any such line fails the group. It then waits for a `merge_group` run of every workflow that has the trigger and fails if one has not started within 15 minutes: a pull request has no such list, since its path filters decide what runs.
  - `scripts/merge-group-contract.test.mjs` holds the rules. A new pull-request workflow needs `merge_group:` and, with `paths`, the `queue` job copied from another workflow with its own file name. A job that needs `queue` opens its `if` with `needs.queue.outputs.run == 'true'`; a job behind such a job uses no status function (`always()`, `!cancelled()`), which would run it for every group. `node scripts/merge-group-contract.mjs` names what is wrong.
- A package test that reads a file outside its package, another package's test files included, must be declared in `EXTRA_INPUTS` (`scripts/affected/scope.mjs`). Without it, a change to that file skips the test.
- The FAST-AF, Violet, Specimen, Health dashboard, Loam, Umbel and Conformance workflows open with an `Affected units` job (`node scripts/affected.mjs gate`), so a lockfile or shared-input change runs their jobs only when it reaches them. A gate must name every package whose suites its jobs run.
- Pin an action to a full commit SHA with a `# vX.Y.Z` comment. Dependabot updates them.
- Give a pull-request workflow the concurrency group the others use, so a newer push cancels the run it supersedes.
- AGENTS.md lists no workflows or per-unit suites, so a new one needs no line there. Add a unit note here only for something a failing gate will not explain.

## Dependencies and the lockfile

- `pnpm-workspace.yaml` sets a three-day `minimumReleaseAge`, matching Dependabot's, because a lockfile holding a younger version fails every Dependabot npm update. A newly published dependency waits until it is three days old unless `minimumReleaseAgeExclude` lists it.
- Merge pull requests that change `pnpm-lock.yaml` one at a time. Rebase each onto the new `main` first (`@dependabot rebase` on Dependabot's) and merge it only after its checks pass on that base. Two lockfile changes that each pass can merge without a conflict and still leave a lockfile `pnpm install --frozen-lockfile` rejects, which fails every workflow on `main` (#937).

## Rust builds and disk

Every worktree adds its own copy of the workspace crates and test binaries to a shared `CARGO_TARGET_DIR`, and Cargo never removes one: a shared directory reached 162 GB in a week. The repository's `.cargo/config.toml` therefore turns off incremental compilation and dependency debug info, and builds on a shared machine run with `CARGO_BUILD_JOBS=4`.

`pnpm rust:sweep` evicts builds that nothing has read for three days and wipes a target directory still over 60 GB (`--dry-run`, `--days`, `--max-gb`). `pnpm verify` runs it before its Rust suites. Never run it while cargo is running.
