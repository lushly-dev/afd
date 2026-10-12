# Local harness and native release preparation

Scope: [#362](https://github.com/lushly-dev/afd/issues/362), C++ first release
[#327](https://github.com/lushly-dev/afd/issues/327), compiler repairs
[#342](https://github.com/lushly-dev/afd/issues/342)/
[#344](https://github.com/lushly-dev/afd/issues/344), and Rust first publication
[#376](https://github.com/lushly-dev/afd/issues/376).
Base: `f2d00cdf33187b5403a6df56b577db5a7b103d52`.

The candidate adds test infrastructure and release documentation. Published
AuthAdapter/DataAdapter APIs and npm/Python versions are unchanged. No hosted
application, OAuth client or Convex deployment was provisioned. No tag, registry
upload or publishing-setting change is part of this preparation.

## Implementation and evidence boundaries

- Better Auth: actual SQLite-backed provider/client, Chromium, HTTPS, test OAuth
  authorization-code/PKCE callback, two tabs, denial/recovery, persistent-process
  restart and independent provider read-backs. The local OAuth fixture is a test
  provider; external identity-provider configuration remains unverified.
- Convex: actual installed SDK hooks/provider, deployable auth/functions/schema,
  opt-in runner and scoped cleanup contract. Local type checks, bundling, runner
  regressions and disconnected browser startup are not a deployed-provider pass.
- Persistence: SQLite REST fixture with actual HttpAdapter/ViewStateRegistry,
  separate write/read processes around server restart, independent durable
  read-backs, atomic batch/rollback, unavailable/recovery and two scoped principals.
- C++: compiler/frontend-specific warnings, true MSVC 19.30 minimum, configure
  regressions and a Windows clang-cl CI case. Release remains a 0.1.0 candidate.
- Rust: dated 0.1.0 release notes, migration/contract documentation and conditional
  registry installation instructions. Git/path installation remains available.

The [hosted handoff](../operations/hosted-verification.md) defines remaining H1/H2/H3
evidence and cleanup. The [native release handoff](../operations/native-first-releases.md)
defines publication and downloaded/tagged-consumer verification.

## Validation record

The executor retains complete local logs outside the checkout, including runtime
versions and command lines. `pnpm check` and `pnpm test:hosted:local` passed on the
candidate working tree; the latter is also a path-filtered, credential-free CI job.
Independent reviewers inspect source and report findings; they do not execute
validation or provision services.

The combined fixture gate passed Better Auth's dedicated typecheck, seven runner
regressions and all eleven real local lifecycle phases; Convex's eight runner
regressions, typecheck, actual CLI dependency preflight, bundle and disconnected
browser startup; and persistence's seven regressions including the complete
restart lifecycle. All explicitly external provider checks remain not run.

Secondary validation passed Alfred Ruff and 65 tests, Python todo 26 tests, Rust
todo fmt/clippy and 38 tests, C++ todo Release CTest 1/1, and each of the four todo
conformance suites 34/34. These checks used isolated scratch environments and do
not replace the full supported-interpreter Python release matrix already recorded
for published 0.9.0.

Rust preparation passed fmt, default/no-default clippy and tests (281/277), the
wasm check and `cargo publish --dry-run --allow-dirty` (38 packaged files). This is
a package preview without upload; repeat a clean dry-run at the reviewed merge.
C++ preparation passed dev and no-exceptions/no-RTTI CTest (3/3 each), fresh
installed find_package and source FetchContent consumers, clang-format 22.1.8 and
34/34 C++ conformance. Real Windows and Linux sanitizer/compiler matrix jobs
remain CI work. The macOS ASan startup hang was reproduced before `main` and
remains [#331](https://github.com/lushly-dev/afd/issues/331).

## Review and closure

Independent lanes cover Better Auth/runner orchestration, Convex auth and cleanup,
durable persistence, and native compiler/release preparation. Initial review
found false-positive outage/category checks, raw warning leakage, unbounded or
interrupted cleanup, missing independent renewal/deletion read-backs, OAuth
identity/timeout cleanup gaps and a Windows job that could miss the affected
Clang version. The three harness lanes cleared their focused repairs in source;
executor regressions and the combined gate passed afterward. The Windows gate
now installs checksum-verified LLVM 22.1.8 and asserts the actual compiler version.
Native focused review also cleared the version-selection repair; actual Windows
execution remains required. The final executor receipt retains all dispositions
and command results.

Keep #362 open until hosted assertions, infrastructure restart and external
account/grant/deployment cleanup receipts are reviewed. Keep #327/#376 open until
the native releases exist and fresh consumers verify the published source.
Local preparation alone does not establish registry delivery or hosted behavior.
