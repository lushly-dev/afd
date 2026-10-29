# Platform monorepo status

Tracking: [#463](https://github.com/lushly-dev/afd/issues/463). Updated 2026-10-28.

| Phase | State | Evidence / next gate |
| --- | --- | --- |
| 0 — Inventory | Complete for initial scope | Current source/package/license/export/publisher inventory and baseline captured; authorization/scope decisions recorded in spec. Refresh source and registry authority again at each import/handoff. |
| 1 — Shared infrastructure | Complete | Merged in [#464](https://github.com/lushly-dev/afd/pull/464) at `508f7634`. All ten PR checks passed, landed content matched, and the main Release run passed with no publication intent. |
| 2 — Botcore/Alfred | Locally verified; awaiting PR CI and merge | Botcore imported from live main `7d5c54ca` into `endpoints/botcore/` with file-level provenance; its six distributions and Alfred are quarantined. Alfred hosts the unified catalog. Shared skills are authored in Botcore's bundled source and projected by `skills/exports.json`. |
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
- The first push was rejected: Git hook environment variables escaped into disposable test repositories and changed shared Git settings. The known settings were restored and HEAD/index/branch/origin verified. A sanitized tooling launcher and real-child regression passed independent review; fresh gate/push verification follows in the checkpoint commit.

### Phase 2 checkpoint

- The Codex session preparing Phase 2 stopped when its context compaction failed. Its uncommitted worktree was snapshotted read-only and replayed onto main `c80ebf59`; the only overlaps (`AGENTS.md`, the AFD-owned `do-release` skill) merged without conflict. Its last source edit predates its focused review approval.
- The root `*.plan.md` ignore rule had silently dropped 28 upstream Botcore plan documents that provenance hashes, so the provenance test and package smoke failed on a clean tree. `.gitignore` now admits them under `endpoints/botcore/`.
- A fresh cross-model review of the AFD-side changes found four defects, all fixed with regressions that fail on the earlier code: `.claude/mcp.json` launched the MCP server without the now-required `--workspace`; `dev_*` `path` resolved against the worktree root instead of the selected target and could leave it, including inside a passing plan; host path policy broke `skill_lint` selection by skill name; a plugin command named like an Alfred alias was silently shadowed.
- Local receipts on the final tree: `pnpm check` passed all eleven steps; Botcore 703 tests, Ruff, frozen lock and the six-distribution package smoke passed on Python 3.11 and 3.12; Alfred 129 tests, Ruff, frozen lock and the isolated AFD/Botcore/Alfred wheel smoke against an external workspace passed on both; the configured MCP server answered `initialize`.
- Not verified locally: hosted CI, Botcore's preserved stateful integration scenarios (excluded from the workflow), and any registry interaction. All Botcore and Alfred distributions remain quarantined; no publication, tag or publisher change occurred.

## Prepared candidates outside the repository

Botcore, Specimen, FAST-AF, Violet and Health work is being prepared in disposable staging directories. Their checks are candidate evidence, not acceptance of an AFD import. Source repositories remain unchanged and authoritative. Specimen native/adapter/CLI artifacts and Botcore wheels have isolated consumer evidence; FAST-AF's Firefox/WebKit matrix is incomplete because pinned browser downloads failed. Exact source/allowlist/artifact identities will be recorded with each admitted import.
