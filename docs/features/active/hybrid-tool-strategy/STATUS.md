# Hybrid tool strategy status

Read this before the [proposal](hybrid-tool-strategy.proposal.md). It records exactly what is done
and what is not, so an agent never has to scan the code to learn what is current. It follows the
shape of the [Umbel status](../../../../endpoints/umbel/docs/STATUS.md).

## How to keep this file

- "Done" means merged to `main` with evidence linked. Anything else is "in progress" or "open",
  with what remains spelled out.
- Record how you verified it, the command or check, and the absolute date.
- Write down follow-ups that are not yet issues, with the date and who raised them; link the issue
  when one exists.
- Never delete history. Mark an entry superseded and point to what replaced it.

## Status block

- **State:** approved by the owner on 2026-10-31 with every recommendation; the six open questions
  are answered in the proposal's [owner decisions](hybrid-tool-strategy.proposal.md#owner-decisions-2026-10-31).
  Step 0 (`spec/`) merged in [#538](https://github.com/lushly-dev/afd/pull/538) as `977a0a35`;
  Python implements the strategy in a pull request open for review (step 2); no other language does
  yet. Step 1 (TypeScript) can start or is in progress.
- **Last verified:** 2026-10-31, against `main` at `85f49a3f`, for step 2: `cd python && uv lock --check`,
  ruff (F821, F841, B904) and `uv run pytest -q` (2,962 passed on Python 3.14), the Python todo backend's
  pytest and its 34-case and 5-case confirmation conformance suites (2025 and modern), and the alfred
  tests. Earlier: 2026-10-31, against `main` at `5875e301`, for step 0: every statement about
  current behavior in [`spec/tool-strategies.md`](../../../../spec/tool-strategies.md) was re-read
  from `packages/server/src` (`tools.ts`, `tool-router.ts`, `command-names.ts`,
  `command-routing.ts`, `mcp-modern.ts`, `server-types.ts`), `python/src/afd/server` (`tools.py`,
  `factory.py`, `tool_router.py`) and the Rust `server` feature as merged in #526
  (`packages/rust/src/server.rs`, `server/strategy.rs`, `server/router.rs`, `builtin_names.rs`,
  `commands.rs`). Earlier: 2026-10-31, against `main` at `cdfbbfb7`. Every claim in the proposal's "How
  the strategies work today" was read from the code it cites: `packages/server/src` (`tools.ts`,
  `tool-router.ts`, `command-routing.ts`, `context-scope.ts`, `mcp-modern.ts`, `server.ts`,
  `server-types.ts`, `command-names.ts`, `bootstrap/afd-help.ts`), `python/src/afd/server`
  (`tools.py`, `factory.py`, `tool_router.py`, `types.py`), `packages/rust/src/server.rs` and
  `packages/examples/todo/backends/cpp/src/mcp_stdio.cpp`, and from `spec/command-metadata.md`,
  `spec/error-codes.md` and `spec/protocol-conformance.md`.
- **Done:** nothing merged.
- **In progress:** step 2, Python, in a pull request open for review (see the session log). Step 0
  (`spec/`) and the proposal itself merged in [#538](https://github.com/lushly-dev/afd/pull/538) and
  [#522](https://github.com/lushly-dev/afd/pull/522).
- **Not done:** every row of the proposal's implementation plan
  (spec, TypeScript, Python, Rust, C++, parity and skills).

## Implementation plan

| Step | State | Evidence | Next gate |
| --- | --- | --- | --- |
| 0. `spec/` | Done | New [`spec/tool-strategies.md`](../../../../spec/tool-strategies.md) and [`spec/tool-strategies.json`](../../../../spec/tool-strategies.json); amendments to `command-metadata.md`, `error-codes.md`, `protocol-conformance.md`, `vectors/README.md` and `CHANGELOG.md`; parity rows. `spec/VERSION` stays `1.0-rc` | Merged in [#538](https://github.com/lushly-dev/afd/pull/538), 22/22 checks green |
| 1. TypeScript | Not started | None | Step 0 merged ([#538](https://github.com/lushly-dev/afd/pull/538)); ready |
| 2. Python | In review | `create_server(tool_strategy="hybrid", first_class_tools=[...])`, `ServerConfig.first_class_tools`, `python/src/afd/server/first_class.py`; `python/tests/test_hybrid_tool_strategy.py` runs every case in `spec/tool-strategies.json`; live SSE, Streamable HTTP (both eras) and stdio cases in `test_mcp_protocol_live.py` and `test_mcp_modern_live.py`; [#555](https://github.com/lushly-dev/afd/pull/555) open, not yet merged | Merged, with CI green |
| 3. Rust | Not started | None | Step 0 merged; parity D1 merged in [#526](https://github.com/lushly-dev/afd/pull/526) |
| 4. C++ | Not started | None | Step 0 and language parity D2 merged |
| 5. Parity matrix, conformance rows, skills | Not started | None | Each language's step merged |

## Open questions

None. The six questions were answered by the owner on 2026-10-31 and are recorded as the
proposal's [owner decisions](hybrid-tool-strategy.proposal.md#owner-decisions-2026-10-31).

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-10-31 | Design session | Parity D1 is in [#526](https://github.com/lushly-dev/afd/pull/526), whose `ToolStrategy` enum is non-exhaustive so hybrid adds a variant; when it merges, re-check that the Rust step still fits and update step 3's size | Done 2026-10-31: #526 merged; step 3 stays S. `ToolStrategy` derives `Copy`, so the Rust step adds a unit `ToolStrategy::Hybrid` with a `McpServer::with_first_class_tools` builder, not a `Hybrid { first_class }` variant |
| 2026-10-31 | Design session | TypeScript and Python list different meta-tools in the individual and grouped strategies, and different tools in `lazy`; `spec/tool-strategies.md` records this until it is decided | Issue [#533](https://github.com/lushly-dev/afd/issues/533) |
| 2026-10-31 | Design session | When every backend has the strategy, consider a `--strategy hybrid` run of the todo conformance suite | Open |
| 2026-10-31 | Step 0 session | `spec/tool-strategies.json` sits in `spec/`, not `spec/vectors/`, because `alfred parity` fails on any vector a language does not load; move it into `spec/vectors/` (and the `vectors/README.md` loader table) in the step that makes the fourth language load it | Open |
| 2026-10-31 | Step 0 session | `spec/error-codes.md` D4 still says "Rust has no MCP server or DirectClient yet" and that Python answers unlisted names with FastMCP's plain text; #526 and #325 changed both. Left for a separate correction | Done 2026-10-31 in [#540](https://github.com/lushly-dev/afd/pull/540) |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-10-31 | Design session | Proposal and this status file written after Umbel decision D27; no `spec/` or code changes. [#522](https://github.com/lushly-dev/afd/pull/522) |
| 2026-10-31 | Owner review | The owner approved the proposal with every recommendation; the open questions became the proposal's owner decisions. Decision 6's alignment work filed as [#533](https://github.com/lushly-dev/afd/issues/533). [#522](https://github.com/lushly-dev/afd/pull/522) |
| 2026-10-31 | D1 landed | Parity D1 merged in [#526](https://github.com/lushly-dev/afd/pull/526); the Rust step's gate and API shape updated. [#534](https://github.com/lushly-dev/afd/pull/534) |
| 2026-10-31 | Step 0 session | Wrote `spec/tool-strategies.md` (all four strategies, H1 to H8 normative), the hand-written hybrid cases in `spec/tool-strategies.json`, and the amendments the proposal lists; re-verified current behavior against `main` at `5875e301`, including Rust after #526. `spec/VERSION` unchanged: an additive change during `1.0-rc` is recorded under the `1.0-rc` entry, as earlier additions were. Pull request open for review |
| 2026-10-31 | Coordinator | Step 0 merged in [#538](https://github.com/lushly-dev/afd/pull/538); corrected the stale D4 paragraph in `spec/error-codes.md`. [#540](https://github.com/lushly-dev/afd/pull/540) |
| 2026-10-31 | Python step | Implemented the strategy in `python/src/afd/server` (H1 to H8) and loaded `spec/tool-strategies.json`. Two corrections it needed, both in `python/CHANGELOG.md` Unreleased: Python advertised `tools.listChanged: true` on the modern era (the SDK derives it from `subscriptions/listen`) although the spec says `false`, now forced to `false` on every strategy; and Python's `COMMAND_NOT_IN_CONTEXT` suggestion differed from the specified wording, now aligned. [#555](https://github.com/lushly-dev/afd/pull/555) open for review |
