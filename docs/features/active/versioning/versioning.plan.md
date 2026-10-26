# Versioning and Release Plan

**Current delivery, 2026-10-13:** all four distribution tracks have published releases: the nine npm packages are at 2.1.0, Python `afd` is at 0.9.0, Rust `afd` is at 0.1.0 on crates.io, and C++ `afd-cpp` is released as `cpp-v0.1.0`. Fresh consumers were verified for each track. Rust trusted publishing is configured; the 0.1.0 bootstrap is complete, and a future version must show its OIDC upload. See the [npm/Python receipt](../../../operations/stabilization-release.md) and [Rust/C++ receipt](../../../operations/native-first-releases.md). The dated notes and September snapshot below preserve their state at the time; use those receipts for current release outcomes.

**Execution update, 2026-10-11:** Python 0.9.0 is published and its downloaded
wheel passed all 12 supported-interpreter/extra checks. All nine npm packages
are published at 2.1.0 through #338, after verified historical 2.0.0 recovery;
downloaded artifacts, tags and fresh consumers passed. #347 and #369 are closed.
The tables below preserve the accepted plan's September snapshot,
including its initial 2.0.1 estimate. Use
[release readiness](../../../operations/stabilization-release.md) for current
release commits, workflow receipts and consumer verification. Rust and C++
release work remains separate.

**Native release update, 2026-10-12:** [cpp-v0.1.0](https://github.com/lushly-dev/afd/releases/tag/cpp-v0.1.0) is published from `a311562` (#377), after all post-merge gates passed. Fresh tagged FetchContent and installed find_package consumers passed. Rust `afd` 0.1.0 is also published on crates.io from that commit, with verified downloaded default/no-default consumers and docs.rs. Its `rust-v0.1.0` workflow passed and skipped the existing upload; the exact GitHub trusted publisher is configured. The bootstrap token is revoked; a future new version must demonstrate the OIDC upload. See the [native release receipt](../../../operations/native-first-releases.md).

## Overview

At proposal acceptance on 2026-09-27, the four implementations were TypeScript 2.0.0, Python 0.8.0, Rust 0.1.0 and C++ 0.1.0. This proposal:
- keeps implementation versions **independent**;
- adds a versioned **AFD contract** that says which implementations are compatible;
- shows each package's own version wherever versions appear;
- records the original distribution blockers and release sequence in the dated snapshot below.

| Field | Value |
|---|---|
| Status | Active: accepted 2026-09-27, with every recommendation (V1–V6); first releases are published and the independent version policy remains ongoing |
| Author | jasfalk |
| Updated | 2026-10-13 |
| Related | [Language parity](../../../language-parity.md), [Parity closure plan](../parity-closure/parity-closure.plan.md), the `do-release` skill, `.github/workflows/release.yml`, `.github/workflows/publish-python.yml` |

## Accepted plan snapshot (verified 2026-09-26)

All of the following was verified on 2026-09-26.

| | TypeScript (9 npm packages, one fixed group) | Python `afd` | Rust `afd` crate | C++ `afd-cpp` |
|---|---|---|---|---|
| Version on `main` | 2.0.0 | 0.8.0 | 0.1.0 | 0.1.0 |
| Latest published | **npm 1.0.0** (2026-03-16) | PyPI 0.8.0 | Never published. The name `afd` is free on crates.io. | None; consumed through CMake |
| Last tag | `@lushly-dev/*@1.0.0` | `python-v0.8.0` (2026-09-05) | None | None. `cpp-v0.1.0` is planned. |
| Unreleased on `main` | **2.0.0** (breaking; release PR #252 merged 2026-09-24), plus one pending changeset (2.0.1) | 8 commits, including 3 breaking ones (#225, #232, #250). The wire format moved to camelCase, so 0.8.0 on PyPI does not match the current contract. | Everything | Everything |
| Release path | `changesets/action` in `release.yml` | A `python-v*` tag or a GitHub Release triggers `publish-python.yml` | None defined | Tag plus GitHub Release (`do-release` skill) |
| Changelog | Per package (changesets) | None; entries go to the root `CHANGELOG.md` | None | `packages/cpp/CHANGELOG.md` |
| Blocked by | **(1)** The 2.0.0 publish failed with `E404 Not Found - PUT …/@lushly-dev%2fafd-adapters`, next to npm's notice that 2FA-bypass tokens are being restricted, so the npm credential is not accepted. **(2)** Since then, every Release run fails to open the version PR: "GitHub Actions is not permitted to create or approve pull requests." | — | Nothing: V4 is decided (publish) | Nothing: the stale-docs fixes merged in #301 |

**Where versions appear today:**
- **README:** one npm badge, which shows 1.0.0, and a blanket "Status: Beta" badge. The language badges show toolchain versions. "Rust 1.70+" is unverified: `Cargo.toml` has no `rust-version`, and the toolchain is pinned to 1.98.
- **`site/index.html`:** the hero badge hardcodes **"Beta v0.6.0"**, which matches no package.
- **`docs/language-parity.md`:** a hardcoded version row.
- **`.claude/CLAUDE.md` and `AGENTS.md`:** "All `@lushly-dev/*` packages share one version". That is true for npm only. #289 makes `AGENTS.md` the only agent guide.

## Why the numbers differ, and why that is fine

- **TypeScript 2.0** records npm's own breaking history: 1.0 in March, then 2.0 for Node 22.12 and the removed deprecated APIs. It says nothing about the other languages.
- **Python 0.x, Rust 0.1 and C++ 0.1** honestly signal APIs that are not yet 1.0.
- **Protocol ecosystems version this way.** MCP's own SDKs each have their own version and declare which protocol revisions they support. OpenTelemetry publishes a specification version, versions each language SDK independently, and keeps a compliance matrix. AFD already has the equivalent of the protocol, in `spec/`, and the compliance matrix, in `docs/language-parity.md`. It only lacks a version on the contract.

## Options

| Option | Summary | Verdict |
|---|---|---|
| A. Lockstep | Every implementation carries one version, such as 2.x. | **Reject.** Python 0.8 → 2.0 and Rust and C++ 0.1 → 2.0 would claim a maturity and parity they do not have. It would force empty major releases whenever any language breaks, and changesets only covers npm anyway. |
| B. Independent semver plus a contract version | Each implementation follows semver on its own API. A separate `MAJOR.MINOR` contract version names the wire and behavior contract it implements. | **Recommend.** |
| C. Majors aligned to contract generations | Python 2.x means "implements contract 2". | Possible once every implementation is past 1.0. Not now. |

## Proposal

### 1. A versioned AFD contract

- **Scope:**
  - `spec/wire`, `spec/pipeline-variables.md` and `spec/vectors`;
  - the error-code and validation specs from [parity plan Wave 1](../parity-closure/parity-closure.plan.md#wave-1-shared-contract);
  - the todo conformance suite, and later the protocol conformance tier.
- **Format:** `MAJOR.MINOR`.
  - A **minor** version adds without breaking: a new optional field, a new error code, a new vector for existing behavior.
  - A **major** version changes an existing fixture or vector, or removes or renames a wire field.
- **Source of truth:** `spec/VERSION`, with the history in `spec/CHANGELOG.md`.
- **Each implementation exports the version it implements:**
  - TypeScript: `AFD_CONTRACT_VERSION` from `@lushly-dev/afd-core`;
  - Python: `afd.CONTRACT_VERSION`;
  - Rust: `afd::CONTRACT_VERSION`;
  - C++: `afd::contract_version`.
- **Agents can read it:** `afd-help` output includes `contractVersion`.
- **Checked:** `alfred parity` compares the four constants with `spec/VERSION` and reports any mismatch.
- **1.0** is declared when all four languages load every vector file (parity Wave 1). Until then the constants read `1.0-rc`.

### 2. A version policy for each implementation

| Implementation | Scheme | Next release | Toward the next milestone |
|---|---|---|---|
| TypeScript | semver; the npm packages stay one fixed group | Publish **2.0.0**, then **2.0.1** (see [Unblock releases](#4-unblock-releases-first)) | Majors only for TypeScript API breaks |
| Python | semver 0.x | **0.9.0**, carrying the breaking wire change to camelCase. Then **0.10.0** for the D5 server defaults. | **1.0** after parity Wave 2 (Python) and the protocol conformance tier |
| Rust | semver 0.x | **0.1.0** on crates.io (V4) | **1.0** after the `server` feature and parity Wave 2 |
| C++ | semver 0.x. Before 1.0, a minor version may break the API, as the README says. | **0.1.0** as `cpp-v0.1.0` | **1.0** after real host use |

**Maturity labels for each implementation** replace the blanket badge: TypeScript **Beta**, Python **Beta**, Rust **Preview**, C++ **Preview**.

**Tags.** Every non-npm implementation uses `<language>-vX.Y.Z`: `python-v` (already used), `rust-v` (new) and `cpp-v`. C++ switches from the planned `afd-cpp-v` before its first tag. npm keeps the changesets form `@lushly-dev/<pkg>@X.Y.Z`.

**Changelogs.** Each implementation keeps its own:
- add `python/CHANGELOG.md` and `packages/rust/CHANGELOG.md`;
- the root `CHANGELOG.md` becomes an index that links to all of them.

### 3. Showing versions

- **README.** Replace the single npm badge with a table of implementations: Implementation | Package | Latest release | Status | Contract. The release column uses dynamic shields.io badges, which cannot go stale:
  - `npm/v/@lushly-dev/afd-core`
  - `pypi/v/afd`
  - `crates/v/afd`, once published
  - `github/v/tag/lushly-dev/afd?filter=cpp-v*`
- **Site.** Do this work in the afd.dev redesign (#299), which replaces `site/index.html` and is held until upcoming changes, C++ among them, are on the page.
  - Remove the hardcoded "Beta v0.6.0" hero badge. Show "AFD contract 1.0" there if a version is wanted.
  - List the four implementations, each with its badge, status and install line.
  - #299's deploy workflow already stamps the npm version into `llms.txt`; add the other three implementations' versions there too.
  - #301 has already fixed the current page's package names and language list.
- **`docs/language-parity.md`.** Keep the version row, and add a Contract row. The release checklist updates both.
- **`AGENTS.md`** (after #289 removes `.claude/CLAUDE.md`). Say that "one version" applies to the npm packages, and list where each implementation's version lives.
- **Drift check.** `scripts/check-versions.mjs` runs in `pnpm check`. It reads the four manifests and the contract constants:
  - `package.json`, `pyproject.toml` and `python/src/afd/__init__.py`;
  - `Cargo.toml`;
  - `packages/cpp/CMakeLists.txt`.

  It fails when a version written into `docs/language-parity.md` or `site/index.html` disagrees with them.

### 4. Original September release sequence

This records the original September sequence; the first release outcomes are now
complete. npm and Python outcomes are recorded in
[release readiness](../../../operations/stabilization-release.md); Rust and C++
receipts are in the [native handoff](../../../operations/native-first-releases.md).
Future versions follow the `do-release` skill.

Steps marked **(admin)** need a repository or npm owner. They change security settings, so an agent should not do them.

1. **(admin) npm authentication.**
   - Done: npm trusted publishing (OIDC) is configured. `release.yml` requests `id-token: write` and provenance, and each of the 9 packages trusts `lushly-dev/afd` → `release.yml`. The 2.0.0 and 2.1.0 uploads used it.
   - Done: `NODE_AUTH_TOKEN` is removed from `release.yml`. There is no token fallback.
2. **(admin) GitHub.** Under Settings → Actions → General → Workflow permissions, allow GitHub Actions to create and approve pull requests. Alternatively, give `changesets/action` a GitHub App token.
3. **Publish 2.0.0.**
   - Re-run the failed Release run for `b4a94e6` (2026-09-24, run `35950563235`).
   - That commit has no pending changesets and the same `release.yml`, so changesets publishes and tags exactly 2.0.0.
   - The next push to `main` then opens the 2.1.0 release PR. So npm gets 2.0.0 (from the re-run of run `35950563235` on `b4a94e6`) and then 2.1.0: the pending changesets are minor and patch, and internal peer ranges use `workspace:^` with `onlyUpdatePeerDependentsWhenOutOfRange`, so Changesets no longer escalates them to 3.0.0.
4. **Python 0.9.0.**
   1. Create `python/CHANGELOG.md` from the Python entries since `python-v0.8.0`.
   2. Bump `pyproject.toml` and `__version__`.
   3. Tag `python-v0.9.0`.
   4. Fix `publish-python.yml` so the version check also runs for GitHub Release events.
5. **C++ 0.1.0 — complete 2026-10-12.** Published `cpp-v0.1.0` from `a311562` (#377). Post-merge CI, fresh tagged consumers, the tag badge and pinned installation snippets are verified; the feature record is in `complete/cpp-support/`.
6. **Rust 0.1.0 — complete 2026-10-12.** The crate is published on crates.io; `rust-v0.1.0` passed its tag checks, the trusted publisher is configured, and future versions use the OIDC workflow. A new version still needs an actual OIDC upload receipt.
7. **`do-release` skill — complete.** The skill covers all four implementations, their tag schemes and the contract version.

## Decisions

All six were accepted as recommended on 2026-09-27.

| # | Decision | Outcome |
|---|---|---|
| V1 | How implementations are versioned | Independent semver plus a contract version (option B) |
| V2 | Contract format and when to declare 1.0 | `MAJOR.MINOR`; 1.0 at the end of parity Wave 1, `1.0-rc` until then |
| V3 | Tag scheme | `<language>-vX.Y.Z` for Python, Rust and C++; C++ changes before its first tag |
| V4 | Publish Rust to crates.io now | Yes, 0.1.0, to claim `afd` while it is free |
| V5 | Publish 2.0.0 or skip to 2.0.1 on npm | Publish 2.0.0 by re-running its Release run |
| V6 | The root `CHANGELOG.md` | An index that links to each implementation's changelog |

## Exit criteria

- npm, PyPI, crates.io and the C++ tags each carry the version on `main`, and the Release workflow is green.
- The README and site show every implementation's version from a live source. There is no blanket version.
- `spec/VERSION` exists. All four implementations export a matching constant, and `alfred parity` checks it.
- `scripts/check-versions.mjs` runs in `pnpm check`.
- The `do-release` skill documents all four release paths.
