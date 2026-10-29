# Platform monorepo status

Tracking: [#463](https://github.com/lushly-dev/afd/issues/463). Updated 2026-10-28.

| Phase | State | Evidence / next gate |
| --- | --- | --- |
| 0 — Inventory | Complete for initial scope | Current source/package/license/export/publisher inventory and baseline captured; authorization/scope decisions recorded in spec. Refresh source and registry authority again at each import/handoff. |
| 1 — Shared infrastructure | Locally verified; awaiting PR CI and merge | Explicit admission, guarded version/artifact operations, native guards, durable claims, protocol ownership, static boundaries and coverage planning implemented. Independent review approved after corrections. No source imports yet. |
| 2 — Botcore/Alfred | Waiting for Phase 1 | Refresh Botcore main, preserve artifact/skill identities, implement unified catalog contracts. |
| 3 — Foundations | Waiting for safeguards | Specimen/Violet native separation and maintained FAST runtime/components. |
| 4 — Health/Violet endpoints | Waiting for foundation contracts | Health MIT extraction and Violet admission authorized; Creator excluded. |
| 5 — Publisher cutovers | Not started | Existing source publishers retain authority; explicit per-distribution records and live verification required. |

## Authorization and decisions

- Jason authorized implementation, sub-agents, fixes, commits, and verified merges between phases after #462 merged.
- Health reusable extraction under MIT approved; private inventories/reports/history/access configuration excluded.
- Violet inclusion approved. Creator excluded. Lushly remains separate.
- Existing mandatory quality gates remain binding; no root-path relocation or publisher cutover is implied by this checkpoint.

## Verification receipts

- Baseline AFD `2243f4fc`: frozen install and `pnpm check` passed on Node 24.21.0/pnpm 10.30.1. One warm local timing sample, recorded in inventory.md.
- Independent inventory agents inspected source states and current package contracts read-only.
- Phase 1 `pnpm check` passed: boundaries, build, lint, coverage tests, typecheck, portability, sizes, orphan checks, versions and tooling tests. The first run found an outdated publishing-step assertion; the contract test was updated for the native admission guard and passed.
- Todo conformance passed 34/34 for TypeScript, Python, Rust and C++. Python backend passed 26 tests on Python 3.12.14; Rust backend fmt/clippy and 39 tests passed; C++ release build and its test passed.
- Independent source review found and verified fixes for intent bypass, durable partial-publication recovery, restored-intent claims, workflow argument ordering, native holds/prerequisites, dependency queries and upload ordering/readback. The last targeted prerequisite regression passed before approval.
- Documentation links/fences and historical snapshot hashes passed. No registry upload, deployment, tag push, publisher transfer or source import occurred during this checkpoint.
- PR CI and landed-content verification remain outstanding; Phase 1 is not marked complete until those pass.

## Prepared candidates outside the repository

Botcore, Specimen, FAST-AF, Violet and Health work is being prepared in disposable staging directories. Their checks are candidate evidence, not acceptance of an AFD import. Source repositories remain unchanged and authoritative. Specimen native/adapter/CLI artifacts and Botcore wheels have isolated consumer evidence; FAST-AF's Firefox/WebKit matrix is incomplete because pinned browser downloads failed. Exact source/allowlist/artifact identities will be recorded with each admitted import.
