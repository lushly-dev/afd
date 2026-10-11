# Publication and verification follow-up

Date: 2026-10-11. Base: `f19257e404f69061149c5ed51a30a622a4450568`,
the squash merge of stabilization PR #367. Its 21 PR checks and subsequent main
workflows passed. This follow-up prepares Python 0.9.0 and adds browser evidence;
it does not upload packages or create release tags.

## Python 0.9.0 candidate

The manifest, module version, three dependent lockfiles and parity Version row
agree on 0.9.0. The dated changelog includes camelCase migration guidance and
preserves the following 0.10.0 milestone. No third-party Python dependency version
or runtime behavior changed in this follow-up.

The implementation agent executed the supported Python matrix in isolated
environments: **2,537 tests on each of 3.10, 3.11 and 3.12**, required Ruff checks,
three lock checks and **12 fresh wheel installations**, covering base/client/server/CLI
on each interpreter. All passed, including the original base-import consumer
reproduction. The 0.9.0 wheel's SHA256 is
`fe7ba61cc856488cafa9750f389118383010893e7910e3b0d81c25e6cd965ed6`.
Its runtime payload differs from the previously tested stabilization wheel only
in the version string.

PyPI still serves 0.8.0. [#347](https://github.com/lushly-dev/afd/issues/347)
remains open until the published replacement passes the same isolated checks.
Local wheel evidence does not establish successful PyPI authentication/upload.

## Browser/provider evidence

The auth implementation agent added an opt-in Playwright/Chromium suite using
the actual Better Auth 1.7.2 memory provider over loopback HTTP, the vanilla client,
AFD's adapter, React hooks and SessionSync. Two lifecycle cases exercise
BroadcastChannel and localStorage fallback independently. A third exercises
expiry. Tests verify HttpOnly/SameSite metadata, reload restoration, isolation of
a fresh context, sign-in/out propagation, lock ownership, actual session renewal,
browser cookie expiry before provider refetch, and independent rejection of
revoked/expired cookies. They use disposable synthetic users and per-test origins.

Node 24.21.0 validation passed **147 auth tests**, **three browser cases**,
typecheck and focused lint. A separate path-filtered workflow installs the matching
Chromium binary and runs the suite; the default TypeScript gate needs no browser
binary. Remote execution of this new workflow must be verified on the final PR.

A fresh independent Sol reviewer inspected source, dependencies, workflow pins,
wheel metadata, release docs and receipts. Reviewers were separate from authors,
used the same Codex harness with behavioral read-only isolation, and executed no
validation. The initial pass identified three P2 test issues: raw cookie assertion
diagnostics, provider refetch obscuring attribution of cookie expiry, and exact
expiry equality across independently renewing tabs. All three were corrected;
the final browser run passed. The focused review checks these corrections without
repeating the broad review. No product runtime change was required.

HTTPS Secure-cookie enforcement, cross-site SameSite policy, OAuth callbacks and
upstream token refresh, other browser engines, simultaneous lock atomicity,
Convex deployment and hosted persistence remain outside executed coverage.
Disposable hosted configuration was absent; those checks were **not run**.
[#362](https://github.com/lushly-dev/afd/issues/362) remains open with explicit
staging requirements in the auth/local-db READMEs.

## Combined validation and dependency disposition

The coordinator executed `pnpm check` under Node 24.21.0; all nine steps passed.
A separate executor used isolated Python environments and ran Alfred lint,
**65 tests**, wheel build/base CLI smoke, **26 Python todo tests**, Rust backend
fmt/clippy/**38 tests**, C++ backend release build/CTest (**1/1**), and all four
todo conformance suites (**34/34 each**). Scope hashes stayed unchanged during
that validation. Unchanged native-library matrices are covered by #367/main CI;
this follow-up does not claim a newly executed full sanitizer/platform matrix.

Fresh audits report **one high and one moderate** finding in development tools,
**zero production findings**, and no suppressions. Neither remaining advisory has
a released fix. The corrected dependency record includes Knip's braces path and
distinguishes js-yaml's library path from its argparse CLI path. Unresolved work
is preserved in [#371](https://github.com/lushly-dev/afd/issues/371); this is not a
clean full audit or blanket risk acceptance.

## npm publication

[#369](https://github.com/lushly-dev/afd/issues/369) tracks restoration of all nine
fixed-group publications. npm still serves 1.0.0. The accepted release sequence
retains the historical 2.0.0 candidate before 2.1.0; the former lacks October fixes.
The historical failed run and its rerun deadline, credential requirements and
maintainer publication steps are recorded in
[release readiness](../operations/stabilization-release.md).

Release PR #338 refreshed to `e63c7f5959ff4fba47acf88894f82e8da80a1cb6`
on stabilization base `f19257e`. An independent read-only reviewer found consistent
nine-package versions, changelogs and changeset consumption. Its initially waiting
CI, Conformance and Alfred runs were approved; all six resulting checks passed.
Any subsequent head/base change requires fresh check inspection. Packed-artifact
and fresh-consumer evidence found one new blocker: view-state's declarations
imported the optional local-db peer even when persistence was unused. Runtime
and browser bundles passed; strict TypeScript compilation failed with TS2307.
The #373 repair makes the declarations self-contained while preserving the full
structural DataAdapter contract, including bidirectional assignment and read
access to batching, health and removal. An isolated regression builds/packs the
actual packages and strictly compiles root and `/commands` without local-db, then
checks compatibility with the peer present. It runs through the existing tooling
gate. Focused validation passed 67 view-state tests and 10 repository-contract
tests. A separate read-only review covered this new correction; its path-normalization
finding was corrected. Native Windows execution remains unverified; the test uses
the existing repository gate's pnpm launcher pattern.

All other executed nine-package consumers passed, including actual
loopback MCP/client/CLI calls, offline CLI selection, provider integration,
declarations with optional peers enabled, minimal auth/testing imports with peers
absent, browser bundling and DOM rendering. The fresh installed consumer audit
reported zero advisories without workspace overrides. These checks used Node 24;
Node 22 artifact consumers were not rerun separately.

A separate executor built and packed historical `b4a94e6` 2.0.0, checked all nine
export/type/bin targets and rewritten dependencies, and passed fresh imports,
DirectClient, server execution, CLI version/help and minimal auth/testing imports.
Its fresh dependency resolution also audited clean; this does not establish that
the historical lockfile is clean or that October behavior fixes are present.
Actual publishing authentication, published-version installation and tags remain
separate requirements; no registry repair is claimed from a version-PR refresh.

Detailed local receipts and final GitHub state are retained in the session's
`afd-publication-verification-2026-10-11` evidence directory. They distinguish
author executions, independent source review and coordinator gates. No stale,
pending or skipped check is treated as a pass.
