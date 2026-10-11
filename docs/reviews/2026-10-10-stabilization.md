# October 2026 stabilization

Base: `ddb166364aa36b6ec4e14992bdc6b867e79e4148`, refreshed from origin/main on 2026-10-10. Tracker: [#350](https://github.com/lushly-dev/afd/issues/350). Candidate branch: `codex/afd-oct-stabilization`.

## Outcome and ownership

The stabilization round uses package owners, regression tests, independent source review, then integrated quality gates. The original checkout remains unchanged; implementation is isolated in a managed worktree. Source fixes do not establish published-package delivery.

| Lane | Issues | Implemented behavior |
|---|---|---|
| TypeScript client | #351, #352 | Bounded direct deadlines, preserved schemas and metadata, renewal ownership/coalescing across RPC and streams |
| Core/server | #314, #333, #363, #366 | Canonical failed batch results and MCP metadata; no new queued work after cancellation; truthful started-work outcomes |
| Python schema/control | #310, #283, #329, #330, #332 | Advertised schema validation, defaults/null/required behavior, fractional timeouts, UTF-16 reference caps, inflight draining |
| Python transport/session | #353, #354, #325 | Trusted session isolation and bounded contexts, direct deadlines, null success, bounded SSE, reconnect ownership and unknown-tool results |
| Rust | #311, #282, #283, #284 | Additive whole-schema registration/export, validation vectors, null/default/cap corrections |
| C++ | #312, #343, #355, #356, #363 | Validation parity, safe numeric narrowing and worker unwinding, constant-time successful dispatch, queued cancellation/deadline precedence |
| CLI/local-db | #357, #358 | Nonzero failed JSON stream exits, malformed-batch rollback, consistent record ID validation |
| Provider/persistence proof | #362, #364 | Real Better Auth and local HTTP tests; vanilla session-store compatibility; optional hosted harness |
| Delivery/assurance | #328, #347, #359, #360, #361 | Vector-loader gate, isolated Python package/publish checks, dependency updates, bounded live protocol acceptance tier |
| Documentation/test reliability | #334, #335, #337, #365 | Removed phantom APIs, restored migration notes, reconciled parity claims, deterministic timing regressions |

Named implementation agents were `stabilize_ts_client`, `stabilize_ts_core_server`, `stabilize_python_validation`, `stabilize_python_client`, `stabilize_python_sessions`, `stabilize_rust`, `stabilize_cpp`, `stabilize_cli_localdb`, `stabilize_delivery`, `stabilize_integration_proof`, `stabilize_alfred_vectors`, `stabilization_contract_decisions`, and `stabilization_docs`. Sol handled integrated work and review; Luna handled bounded work. Each had explicit file ownership. All used the shared worktree; they were separate agent contexts, not separate filesystem sandboxes.

## Review evidence

Fresh reviewers did not author implementation and were instructed to inspect source and owner receipts without executing validation. This was procedural read-only isolation, not an enforced tool restriction. Validation results below belong to implementation owners or the coordinator/executor, not to reviewers.

| Independent lane | Passes and disposition |
|---|---|
| Python | Broad pass found stale initial SSE teardown, healthy-session output validation misclassification, and sibling-reference cycle tracking; all repaired with regressions. Focused pass passed. Also repaired the baseline raw-registry validation bypass and missing-field reporting. |
| Native | Broad pass found reachable Rust references escaping compilation, const suppressing enum, C++ absent boolean required fields, and timeout/cancellation precedence. Focused pass closed these; final blocker verification closed Rust nonoptional error alignment. |
| TypeScript | Broad pass found delayed stream failures unnecessarily renewing a replacement session. Four real loopback regressions failed before repair; focused verification closed the fix and metadata read-type compatibility; bounded #366 exception redaction was also approved. |
| Delivery/assurance | Passed after exact-name internal-helper classification restored unchanged Alfred gap budgets. No additional workflow or packaging blocker found. |

The initial full workspace gate also caught a metadata type mismatch in the testing package that package-local checks had missed. The new metadata producer now emits a structurally compatible schema object while preserving the existing public Record consumer contract, without casts. A subsequent full build and typecheck passed.

## Validation receipts

Final integrated gate results are recorded before the PR is opened. Local Node is 24.21.0 with pnpm 10.30.1; Python supported versions are 3.10.21, 3.11.16 and 3.12.14. Focused Python owner tests also ran under 3.14.3 and are not substituted for the supported matrix.

| Check | Result |
|---|---|
| TypeScript full pnpm check | Passed: build, lint, typecheck, test coverage, portability, file-size, orphan-files, versions and tooling tests |
| Python supported matrix | 2537 passed on each of 3.10/3.11/3.12; lockfile and required Ruff checks passed. First runs exposed two scheduler-sensitive tests, repaired in #365 |
| Isolated Python wheel | All 12 fresh environments passed: 3 interpreters × base/client/server/cli; actual base DirectClient and server registration exercised under isolated imports |
| Rust | fmt; default/no-default clippy; 281/277 tests; wasm32 compilation passed |
| C++ | Native and UBSan 139 cases/2143 assertions; no-exceptions unity/macro checks 135/2123; wasm32 Node24 130/2053; all CTest 2/2 |
| Todo conformance | All four languages 34/34 each; Python backend 26 tests, Rust backend 38 tests plus fmt/clippy passed |
| Alfred | 65 tests and Ruff passed; all vector loaders covered, unchanged name-gap budgets Python97/Rust9/C++73 |
| Real integrations | Auth147 passed using installed Better Auth1.7.2; local-db156 passed, one hosted test explicitly skipped; 13 Python process/network protocol cases and TypeScript loopback protocol cases included |
| Dependency audits | Production0; full2 (one high, one moderate), both unresolved development tooling dependencies |

Final Python runtime manifest SHA-256: `34383399039ce5e4aaa49f1deec7f7c579f3e25663114c3021130dc79614be56`. Wheel SHA-256: `52440c217d115f0ef234e51bb921132a6f917d4c70641050b67194f0b9f367dd`. Test-only reliability edits left runtime/wheel inputs unchanged. Concurrent matrix runs also hit two 10-second server-fixture startup timeouts; unchanged-source sequential full runs passed. Those failures are retained as local load-related evidence limits, not silently counted as passes.

The bounded protocol acceptance inventory is [spec/protocol-conformance.md](../../spec/protocol-conformance.md). The shared validation vectors contain34 cases/130 tests; native implementations reject unsupported optional keywords at registration rather than silently accepting them. Vector coverage and todo results are not full MCP certification.

## Remaining delivery and evidence limits

- #347 remains open until a new published Python artifact fixes base-only installation. npm source2.0.0 and pending2.1.0 changesets are not proof of registry delivery. See [release readiness](../operations/stabilization-release.md).
- #360 retains two development advisories without upstream fixes, with concrete dependency paths and reachability notes. Production audit is clean.
- #362 remains partial: real local Better Auth and HTTP persistence are proven, but hosted persistence, browser multi-tab/OAuth and Convex service behavior are not established. The optional hosted test was skipped, not passed.
- Local ASan and TSan runtimes failed on empty programs before AFD execution. UBSan and wasm passed; Linux sanitizers, MSVC and fuzzing require the corresponding CI jobs. No unavailable check is counted as passed.
- Native transport omissions and other intentional parity gaps remain documented in [language parity](../language-parity.md). This round does not add a general Rust/C++ MCP server or claim exhaustive protocol compliance.

No packages were published, release tags created, or main merged by this stabilization implementation round. PR readiness and exact-head CI are separate from release authorization.
