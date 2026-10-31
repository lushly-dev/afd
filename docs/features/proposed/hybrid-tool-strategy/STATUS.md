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

- **State:** proposed, awaiting the owner's review. Not approved; nothing in `spec/` or code has
  changed.
- **Last verified:** 2026-10-31, against `main` at `cdfbbfb7`. Every claim in the proposal's "How
  the strategies work today" was read from the code it cites: `packages/server/src` (`tools.ts`,
  `tool-router.ts`, `command-routing.ts`, `context-scope.ts`, `mcp-modern.ts`, `server.ts`,
  `server-types.ts`, `command-names.ts`, `bootstrap/afd-help.ts`), `python/src/afd/server`
  (`tools.py`, `factory.py`, `tool_router.py`, `types.py`), `packages/rust/src/server.rs` and
  `packages/examples/todo/backends/cpp/src/mcp_stdio.cpp`, and from `spec/command-metadata.md`,
  `spec/error-codes.md` and `spec/protocol-conformance.md`.
- **Done:** the proposal, in the pull request that adds this file.
- **Not done:** owner approval; the open questions; every row of the proposal's implementation plan
  (spec, TypeScript, Python, Rust, C++, parity and skills).

## Implementation plan

| Step | State | Evidence | Next gate |
| --- | --- | --- | --- |
| 0. `spec/` | Not started | None | Owner approves the proposal and answers its open questions |
| 1. TypeScript | Not started | None | Step 0 merged |
| 2. Python | Not started | None | Step 0 merged |
| 3. Rust | Not started | None | Step 0 and language parity D1 merged |
| 4. C++ | Not started | None | Step 0 and language parity D2 merged |
| 5. Parity matrix, conformance rows, skills | Not started | None | Each language's step merged |

## Open questions

The six questions at the end of the [proposal](hybrid-tool-strategy.proposal.md#open-questions-for-the-owner)
are the owner's: the cap, option or metadata, contexts, order, the `afd-help` fields, and the lazy
and meta-tool differences between TypeScript and Python.

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-10-31 | Design session | Parity D1 is in progress in another session; when it merges, re-check that the Rust step still fits its strategy API and update step 3's size | Open |
| 2026-10-31 | Design session | TypeScript and Python list different meta-tools in the individual and grouped strategies, and different tools in `lazy`; `spec/tool-strategies.md` records this until open question 6 is decided | Open |
| 2026-10-31 | Design session | When every backend has the strategy, consider a `--strategy hybrid` run of the todo conformance suite | Open |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-10-31 | Design session | Proposal and this status file written after Umbel decision D27; no `spec/` or code changes |
