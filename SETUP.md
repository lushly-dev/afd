# Setup

First-time setup guide for the AFD monorepo. Run these steps once to get a working development environment.

The repository holds AFD's libraries in four languages and the projects that grew up around them (see [the README](README.md#the-rest-of-the-repository)). You don't need every toolchain: Node and pnpm cover most of it, and the rest is only needed for the area you work on.

## Prerequisites

Everyone needs these:

| Tool | Version | Check |
|------|---------|-------|
| Node.js | 26 LTS for development (`.nvmrc`); packages support 22.12+, Violet and the hosted fixtures need 24+ | `node -v` |
| pnpm | 12.22.0 (pinned in `package.json`) | `pnpm -v` |
| Git | Any recent | `git --version` |

Add these for the area you touch:

| Tool | Version | Needed for | Check |
|------|---------|-----------|-------|
| Python | 3.11+ | `python/`, `alfred/`, `endpoints/botcore/`, `endpoints/health/` | `python --version` |
| uv | Latest | The Python projects above | `uv --version` |
| Rust | 1.100.0 for Umbel, Loam Mail and Specimen's host (each has a `rust-toolchain.toml` that pins it, and Umbel's adds the `wasm32-wasip2` target; `rustup` installs what they name); the `afd` crate supports 1.85+ | `packages/rust/`, `endpoints/umbel/`, `endpoints/loam/plugins/`, Specimen's native host | `rustc --version` |
| CMake and a C++20 compiler | CMake 3.25+; GCC 12+, Clang 16+, Apple Clang 15+ or MSVC 2022 | `packages/cpp/` | `cmake --version` |
| Chromium | The build Playwright names; install it with `pnpm -F <package> exec playwright install chromium` | The browser suites of Specimen, FAST-AF, Violet, Loam and the Health dashboard | |
| OpenSSL | Any recent | Loam's hosted suite and `pnpm test:hosted:local` | `openssl version` |

### Windows

On Windows 11, use the tools above and run repository commands from Git Bash. These setup steps address Windows tool and checkout behavior:

- **Git links.** Git for Windows checks links out as files (`core.symlinks=false`), so `.agents/skills` becomes a 17-byte file and `pnpm check:skills` fails with a message naming the fix. Recreate it once per worktree: `rm .agents/skills && (cd .agents && MSYS=winsymlinks:nativestrict ln -s ../.claude/skills skills)`. That needs Developer Mode, or an elevated shell.
- **Python.** `python3` and `python` may be the Microsoft Store stubs (App execution aliases), which exit 9009. Native release tooling needs Python 3.11 or newer: it uses `PYTHON` when set, otherwise the first compatible interpreter among `python3`, `python` and `py -3`. Tools that call `python3` directly still need a real Python first on `PATH` (`uv python install`, then `~/.local/bin` first), or the aliases turned off in Settings → Apps → Advanced app settings.
- **C and C++.** Visual Studio 2022 Build Tools with the C++ workload (MSVC), CMake, and NASM, which `aws-lc-sys` needs to build `packages/rust` (`winget install NASM.NASM`, then put `%LOCALAPPDATA%\bin\NASM` on `PATH`). OpenSSL from `winget install ShiningLight.OpenSSL.Light` (`C:\Program Files\OpenSSL-Win64\bin`).
- **Rust.** `rustup` with the `wasm32-wasip2` target, which Umbel's `rust-toolchain.toml` names. Run Cargo from the crate's directory to select its pinned toolchain; `--manifest-path` alone does not select a nested rustup override.
- **Cargo jobs.** Cargo runs one job per logical core. On a 32-thread machine, Umbel's debug test links then exhaust Windows' commit limit (RAM plus page file). This fails with `LNK1102: out of memory` or `paging file is too small (os error 1455)`, after hours of swapping. Set `CARGO_BUILD_JOBS=8` in your user environment; Umbel's workspace tests then take about 30 minutes. Clearing `target` also removes the `wasm32-wasip2` fixtures the component tests load; `pnpm verify` rebuilds them first.
- **Loam profiles.** Windows PowerShell provisions new and profile-owned directories with private ACLs for the current account, SYSTEM and Administrators before files are written. Existing data-directory ACLs are checked; the host reports `HOST_SECRET_PERMISSIONS` when access cannot be verified. Use a dedicated data directory.
- **Botcore HTTP tokens.** Use a dedicated private directory for `--store`. Botcore creates private files and coordinates operator commands with native Windows locks; unsafe existing permissions are refused. See [the token-store rules](endpoints/botcore/docs/host-composition.md#serving-hosts-over-http).
- **A shared `%TEMP%`.** Some tools grant another group read access to your profile, and so to `%TEMP%`; Codex's sandbox adds `CodexSandboxUsers`. Umbel's tests that write keys make their temporary folders private first ([#2169](https://github.com/lushly-dev/afd/issues/2169)), as Loam's host tests do ([#1483](https://github.com/lushly-dev/afd/pull/1483)). If one still reports a key as too open, point `TMP` and `TEMP` at a folder only you, SYSTEM and Administrators can read, for example `mkdir "$LOCALAPPDATA/afd-private-tmp" && icacls "$(cygpath -w "$LOCALAPPDATA/afd-private-tmp")" /inheritance:r /grant:r "${USERNAME}:(OI)(CI)F" SYSTEM:"(OI)(CI)F" Administrators:"(OI)(CI)F"`.
- **Ownership.** Git refuses a checkout another account owns ("detected dubious ownership"), as on a drive or folder created by an administrator, and so does every script that runs `git`. Prefer taking ownership of the folder; for one command, `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory GIT_CONFIG_VALUE_0=<path>` trusts it without editing your configuration.
- **A fresh worktree** needs `pnpm install --frozen-lockfile` and `pnpm build` before the first commit: the hooks neither install nor build, and packages import each other's `dist`.

Windows runtime and test gaps are tracked in [Specimen #1262](https://github.com/lushly-dev/afd/issues/1262), [Loam's status](endpoints/loam/docs/STATUS.md) and [Umbel's status](endpoints/umbel/docs/STATUS.md). Installing the toolchain alone does not make `pnpm verify --all` green.

## Install

### TypeScript packages

```bash
pnpm install    # Installs deps + Lefthook git hooks
pnpm build      # Build all packages
```

This builds every workspace package, including Specimen, FAST-AF, Violet and Loam, which are TypeScript. Specimen's native host is a separate Rust build (`pnpm -F @lushly-dev/specimen build:host`), needed only to render.

### Python package

```bash
cd python
uv sync --frozen --all-extras
```

### Alfred (quality bot)

```bash
cd alfred
uv sync --frozen --all-extras --dev
```

## Verify

```bash
pnpm test         # Run all tests (Vitest)
pnpm lint         # Biome lint check
pnpm typecheck    # tsc --noEmit
```

```bash
# Python
cd python && uv run pytest -q

# Alfred
cd alfred && uv run alfred --workspace .. lint
```

## Working on one area

`pnpm check` is the TypeScript quality gate: lint, build, typecheck and tests with coverage, over the packages your change affects. It does not run a browser, and it does not cover Python, Rust or C++. Each area below has a fuller suite of its own. `pnpm verify` runs `pnpm check` and then every one of these suites your change would trigger in CI (`pnpm verify --list` shows the plan first).

| Area | Where | Also run |
|------|-------|----------|
| AFD in Python | `python/` | `cd python && uv run pytest -q` |
| AFD in Rust | `packages/rust/` | `cd packages/rust && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test` |
| AFD in C++ | `packages/cpp/` | `cd packages/cpp && cmake --preset dev && cmake --build --preset dev && ctest --preset dev` |
| Specimen | `foundations/specimen/`, `integrations/specimen-*`, `endpoints/specimen-cli/` | `pnpm test:specimen` (Chromium) |
| FAST-AF | `foundations/fast-af/` | `pnpm test:fast-af` (Chromium), and `pnpm test:stories` after changing a component or a story (Chromium, Rust) |
| Violet | `foundations/violet/`, `integrations/violet-afd/`, `endpoints/violet-*` | `pnpm test:violet` (Chromium) |
| Umbel | `endpoints/umbel/` | `cargo fmt`, `cargo clippy`, the WebAssembly component builds and `cargo test --locked --workspace`; its [README](endpoints/umbel/README.md) has the commands |
| Loam | `endpoints/loam/` | Its browser, walk and hosted suites; the [packages README](endpoints/loam/packages/README.md) has the commands (Chromium, Rust, OpenSSL) |
| Botcore | `endpoints/botcore/` | Its own [SETUP.md](endpoints/botcore/SETUP.md) |
| Health | `endpoints/health/`, `endpoints/health-dashboard/` | `cd endpoints/health && uv sync --frozen --extra dev && uv run --frozen pytest -q`; `pnpm -F @lushly-dev/health-dashboard test:browser` (Chromium) |

`pnpm verify --list` prints the full commands your change would run. The workflows in `.github/workflows/` are the definition of what CI runs, and [gates.md](.claude/skills/prepare-pr/references/gates.md) explains what each gate covers.

Rust builds across this repository's worktrees share one target directory, which grows quickly; `pnpm rust:sweep` evicts builds nothing has read for three days.

## Factory gateway (operators only)

The software factory's GitHub writes are moving behind the Factory Gateway, a service on
`random` that writes as the `lushly-factory-gateway` GitHub App. Nothing changes for agents or
sessions yet. Whoever operates it reads the [runbook](docs/operations/factory-gateway.md):
checking it with `gateway-status`, tokens, configuration, updates, the App's key and recovery.

## Disk hygiene

Worktrees, Rust `target/` folders and caches fill a disk fast here: one afd worktree's Rust
output can pass 100 GB. Install botcore as a tool and let its hourly job keep them in check
(the [free-disk-space](.claude/skills/free-disk-space/SKILL.md) skill has the details):

```bash
uv tool install 'lushly-botcore==<version>'   # a persistent install, not uvx
botcore disk-setup                            # from this checkout: registers it, installs the job
botcore disk-status                           # after the first run
```

On macOS the job is a LaunchAgent; approve the permission prompt the first run raises for an
external drive. On Windows it is a Task Scheduler task for your user, without elevation. On
Linux it is a systemd user timer, or a crontab line. `botcore disk-setup --uninstall` removes
it. If you run T3 Code, also turn on its storage cleanup (remove a worktree when its pull
request merges, when its thread is deleted, and after it has been settled for a week).

- **Rust output stays in each worktree.** Leave Cargo's `target/` where it is: the job strips
  it once a worktree is idle, and removing the worktree deletes it. A machine whose worktrees
  sit on a small disk may move Cargo's `build-dir` to a bigger drive that is always attached
  (`build-dir = "/Volumes/Dev/cargo-build/{workspace-path-hash}"` in `~/.cargo/config.toml`).
  Nothing removes that output when a worktree goes, so also add
  `[[aged]] path = "/Volumes/Dev/cargo-build/*"` with `max_age_days = 7` to the machine
  settings; `disk-setup` and `disk-status` warn until you do. Avoid one shared
  `CARGO_TARGET_DIR` for parallel worktrees: their builds wait on its lock and rebuild each
  other's changes.
- **One T3 Code worktree folder per machine**, on a drive that is always mounted: on an
  unplugged drive every new thread's worktree fails at once. When you move it, keep the old
  folder in T3 Code's previous worktree folders, so its cleanup still removes what it made there
  and the disk commands still leave those worktrees to it.
- `disk-status` also warns when a repository has more than 20 idle worktrees
  (`idle_worktree_limit` in the machine settings); usually T3 Code's cleanup rules are off.

## Build & Test Commands

```bash
# Build all packages
pnpm build

# Build specific package
pnpm -F @lushly-dev/afd-core build
pnpm -F @lushly-dev/afd-server build
pnpm -F @lushly-dev/afd-client build
pnpm -F @lushly-dev/afd-adapters build
pnpm -F @lushly-dev/afd-auth build

# Run all tests
pnpm test

# Run tests for specific package
pnpm -F @lushly-dev/afd-core test
pnpm -F @lushly-dev/afd-server test
pnpm -F @lushly-dev/afd-auth test

# Run single test file
cd packages/server && pnpm vitest run src/server.test.ts

# Run tests in watch mode
pnpm -F @lushly-dev/afd-server test:watch

# Lint and format
pnpm lint          # Check with Biome
pnpm lint:fix      # Fix lint issues
pnpm format        # Format code

# Type checking
pnpm typecheck

# Quality gate (all checks)
pnpm check
```

## Git Hooks (Lefthook)

Lefthook manages git hooks. Installed automatically via `pnpm install`.

| Hook | Commands | Trigger |
|------|----------|--------|
| pre-commit | Biome lint and fix (staged), portability, file-size, typecheck of the staged files' packages and their dependents | `git commit` |
| commit-msg | commitlint (conventional commits) | `git commit` |
| pre-push | Full lint; test and typecheck of the affected packages; portability, file-size, orphan-files, versions, test-configs, test-discovery, test-quarantine, boundaries, skills, tooling tests | `git push` |
| check | All pre-push + build of the affected packages | `pnpm check` |

**Check scripts** (`scripts/`):

| Script | What it checks |
|--------|---------------|
| `check-file-size.mjs` | Source files across `packages/`, `python/`, `alfred/`, `foundations/` (excluding upstream Microsoft FAST), `integrations/`, `endpoints/` and `scripts/` (`.ts`, `.tsx`, `.js`, `.mjs`, `.cjs`, `.rs`, `.py`, `.cpp`, `.hpp`): warn >500 lines, error >1500 (matching `botcore.toml`), with frozen grandfathered ceilings in `scripts/policy/file-size-limits.json` that may only shrink. Generated files, tests and Markdown are skipped |
| `check-portability.mjs` | Machine-specific paths (drive letters, user homes) and package managers started without a shell, which fail on Windows. Escape: `// portability-ok: reason` |
| `check-orphan-files.mjs` | Unreferenced `.ts` files across packages (warning only) |
| `check-versions.mjs` | Package versions and the AFD contract version (`spec/VERSION`) against the language constants, `docs/language-parity.md` and the README table |

The gate-discipline scripts are canonical in `scripts/` and mirrored into Botcore's `gate-discipline` skill (`.claude/skills/maintain-gates/scripts/`) by `pnpm skills:sync`, shared with every repository that seeds it:

| Script | What it checks |
|--------|---------------|
| `check-test-configs.mjs` | No Vitest or Vite config sets `passWithNoTests`, and no `package.json` script, workflow, `lefthook.yml` or `scripts/affected` module passes `--passWithNoTests`: a runner that finds no test file must fail, not pass. A new package adds its first test with its config |
| `check-test-discovery.mjs` | Every tracked JS/TS, Python, C++ and Rust test file is claimed by an active test runner reachable from CI, `lefthook.yml` or workspace scripts (or explicitly registered in `scripts/policy/test-discovery.json` with owner, reason and tracking issue), and every active runner matches at least one test file; stale or recovered exemptions fail |
| `check-test-quarantine.mjs` | No `.only` in any JavaScript or TypeScript test, and each unconditional `.skip`, `.todo` or Playwright `.fixme` registered with an owner, reason and issue in `scripts/policy/test-quarantine.json`; an entry whose test recovered fails. Conditional skips (`skipIf`, `runIf`, Playwright's `test.skip(condition, reason)`) need no entry |
| `report-test-changes.mjs` | Not a gate: lists the tests, assertions, snapshots and runner configs a branch deleted, skipped, changed or loosened against its merge base with `origin/main`, for the reviewer and the pull request (`prepare-pr`). Always exits 0 |

Skip hooks: `git commit --no-verify` / `git push --no-verify`

## Code Style

### TypeScript (Biome)

- Tab indentation, single quotes, trailing commas (es5)
- `noExplicitAny: error` — no `any` types
- `useImportType: error` — use `import type { ... }` for type-only imports
- `noUnusedImports: error`, `noUnusedVariables: error`
- `useNodejsImportProtocol: error` — use `node:` prefix for Node.js builtins

### Python (Ruff)

- 100 char line width, Python 3.11 target
- Pytest for testing

## Repo Configuration

`botcore.toml` at repo root sets quality thresholds and tooling:

```toml
[skills]
source_dir = ".claude/skills"
```
