# Language parity closure status

**State:** Active. Waves 0 and 1 (except contract 1.0) are merged; Wave 2 and Wave 3 are partly merged; Wave 4 has not started. No exit criterion is fully met.
**Last updated:** 2026-10-31, against `origin/main` `5875e301`.

The [plan](./parity-closure.plan.md) holds the decisions (D1–D8) and waves. [`docs/language-parity.md`](../../../language-parity.md) is the per-row source of truth; this file summarizes progress by wave and links evidence.

## Done / merged

| Item | Evidence |
| --- | --- |
| Wave 0 (all rows) | #286, #289, #304, #305, #306, #315, #301 (see the plan's Wave 0 table) |
| Wave 1.1, 1.4: pipeline-variable and batch-control vectors in all four suites | #317 |
| Wave 1.2: `spec/error-codes.md` and shared catalog, D4 | #326; catalog now 45 codes (`spec/vectors/error-codes.json`) |
| Wave 1.3: validation spec and vectors, 34 cases / 130 tests in all four suites | #316, then #367 (closed #310, #311, #312, #332) |
| Wave 1.5, 1.6 (TypeScript): canonical metadata, reconnect default 3 | #308 |
| 2026-10-10 stabilization candidate (executor controls, reference bound, Python sessions/client, discovery/errors, protocol tier, integration assurance) | #367, merged 2026-10-11; closed 31 issues including #283, #314, #325, #329, #330, #333, #353, #354, #361, #363, #364 |
| Contract version constant `1.0-rc` in all four languages, checked by `alfred parity` and `scripts/check-versions.mjs` | #313 |
| Wave 2 Python: core registry, middleware and timeout exports | #405 (#348, closed 2026-10-26) |
| D7 (Wave 3, TypeScript): MCP Streamable HTTP server and client | #391, #392 ([MCP 2026-07-28](../mcp-2026-07-28/STATUS.md)) |
| Python HTTP hardening (`transport_security`, body cap) on `mcp` 2.x | #393 |
| D1 (Wave 3, Rust): `server` feature: stdio and Streamable HTTP, strategies, meta-tools, bootstrap, context tools; todo backend moved onto it | #394, #523, #526 (2026-10-31) |
| Rust engine active-context scoping | #526 |
| Cross-language features added outside this plan with parity in all four languages: actor/clock/random, journal and replay, approval policy | #406, #413–#415; #433, #439, #440, #444; #432, #449–#451 |

## Not done

- **Wave 1.7 / contract 1.0:** `spec/VERSION` still reads `1.0-rc`. The plan's trigger (1.1–1.4 pass in all four languages) appears met but 1.0 has not been declared. Needs an owner decision.
- **D5, Python defaults:** `create_server` still defaults to `tool_strategy="individual"` (`python/src/afd/server/factory.py`), and bootstrap is always registered. Python 0.10.0 shipped (#454) without D5, contrary to the plan and the versioning plan. Related strategy-list differences: #533 (open).
- **Wave 2 Python:** one executor, `DirectClient` boundary (exposure, `allow`, middleware), `failure()` options, decorator `errors`/`execution_time`, handoff default policy, export cleanup (`missing_from_python` budget 88; see [Python parity](../python-parity/STATUS.md)).
- **Wave 2 Rust:** result metadata stamping, `on_command`/`on_error` hooks, cancellation token, `list_by_tags`, built-in middleware, stream executor, example validation (matrix rows "No" on 2026-10-31).
- **Wave 2 C++:** retry/rate-limit/telemetry middleware, `compose_middleware`, `list_by_tags`, `command_to_mcp_tool` emitting `_meta` (matrix: "Deferred"/"No").
- **Wave 2 TypeScript:** `MockServer` still imports only from `@lushly-dev/afd-core` (matrix defect 20). D8 (engine enforces `CommandContext.timeout`): no enforcement found in `packages/server/src` by grep; unverified.
- **Wave 3:** Python CLI `batch` and `stream` (matrix: "no `batch`, `stream` or `scenario`"); D2 C++ `afd::mcp_stdio` (#341, open).
- **Wave 4:** Python auth adapter (matrix: No); D6 N/A rows not yet all recorded (unverified).
- **Tracking:** the plan asked for one `parity` issue per wave item; only some exist (#341, #458, #465, #467, #468, #533 open).

## Verification evidence

- PR and issue states read with `gh` on 2026-10-31; #367 `closingIssuesReferences` lists the 31 closed issues.
- Spot checks on `5875e301`: `spec/VERSION`, `create_server` signature, `packages/testing/src/mock-server.ts` imports, `alfred/tests/test_parity.py` budgets (Python 88, Rust 9, C++ 76).
- Not re-run: language test suites, conformance, `alfred parity`.

## Observed issues

- The plan's 2026-10-10 "Stabilization candidate" said the work was unmerged; it merged in #367. Corrected with a dated note on 2026-10-31; the table keeps its original wording.
- D5 slipped past the release it was assigned to (Python 0.10.0).

## Follow-ups

- Owner decision: declare contract 1.0 now, or redefine its trigger.
- Decide #533, then implement D5 in a Python release.
- File `parity` issues for the open Wave 2–4 items so they can be assigned.

## Notes

- The plan's header still says "Updated 2026-10-10"; this file supersedes it for current state.
