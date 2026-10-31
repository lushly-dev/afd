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
  Nothing in `spec/` or code has changed.
- **Last verified:** 2026-10-31, against `main` at `cdfbbfb7`. Every claim in the proposal's "How
  the strategies work today" was read from the code it cites: `packages/server/src` (`tools.ts`,
  `tool-router.ts`, `command-routing.ts`, `context-scope.ts`, `mcp-modern.ts`, `server.ts`,
  `server-types.ts`, `command-names.ts`, `bootstrap/afd-help.ts`), `python/src/afd/server`
  (`tools.py`, `factory.py`, `tool_router.py`, `types.py`), `packages/rust/src/server.rs` and
  `packages/examples/todo/backends/cpp/src/mcp_stdio.cpp`, and from `spec/command-metadata.md`,
  `spec/error-codes.md` and `spec/protocol-conformance.md`.
- **Done:** the proposal and this file, merged in [#522](https://github.com/lushly-dev/afd/pull/522) as `9a35907f` on 2026-10-31. No implementation step has merged.
- **In progress:** nothing. Decision 6's alignment, [#533](https://github.com/lushly-dev/afd/issues/533), is open (checked 2026-10-31).
- **Not done:** every row of the proposal's implementation plan
  (spec, TypeScript, Python, Rust, C++, parity and skills).

## Implementation plan

| Step | State | Evidence | Next gate |
| --- | --- | --- | --- |
| 0. `spec/` | Not started | None | Proposal approved 2026-10-31; ready to start |
| 1. TypeScript | Not started | None | Step 0 merged |
| 2. Python | Not started | None | Step 0 merged |
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

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-10-31 | Design session | Proposal and this status file written after Umbel decision D27; no `spec/` or code changes. [#522](https://github.com/lushly-dev/afd/pull/522) |
| 2026-10-31 | Owner review | The owner approved the proposal with every recommendation; the open questions became the proposal's owner decisions. Decision 6's alignment work filed as [#533](https://github.com/lushly-dev/afd/issues/533). [#522](https://github.com/lushly-dev/afd/pull/522) |
| 2026-10-31 | D1 landed | Parity D1 merged in [#526](https://github.com/lushly-dev/afd/pull/526); the Rust step's gate and API shape updated. [#534](https://github.com/lushly-dev/afd/pull/534) |
