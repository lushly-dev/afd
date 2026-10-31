# MCP 2026-07-28 status

**State:** Active. Phases 0–7 are merged; follow-ups #465, #466 and #469 are open, and Phase 8 (legacy removal) waits on #469.
**Last updated:** 2026-10-31, against `origin/main` `5875e301`.

The [proposal](./proposal.md) is the design and acceptance contract; the [migration note](./migration.md) is the user-facing summary. This file records progress against them.

## Done / merged

| Item | PR | Merged | Notes |
| --- | --- | --- | --- |
| Phase 0: spike, decisions D1–D9, Phase 0 findings | #390 | 2026-10-25 | D10 raised; resolved by [MCP confirmations](../mcp-confirmations/STATUS.md) |
| Phase 1: TypeScript server, `/mcp` and dual-era stdio | #391 | 2026-10-25 | TS backend 34/34 in `legacy`, `auto`, `modern` |
| Phase 2: TypeScript client, CLI, testing | #392 | 2026-10-25 | `input_required` surfacing landed later with confirmations (#435) |
| Phase 3: Python on `mcp` 2.x | #393 | 2026-10-25 | Released in Python `afd` 0.10.0 (#454, 2026-10-27) |
| Phase 4: Rust `server` feature, dual-era Rust and C++ backends | #394 | 2026-10-25 | Rust `server` feature needs Rust 1.88; core stays 1.82 |
| Phase 5: annotations, TypeScript `outputSchema` and `structuredContent` | #395 | 2026-10-25 | Deferred items moved to #465 and #466 |
| Phase 6: conformance matrix, parity rows, migration note | #396 | 2026-10-25 | |
| Phase 7: follow-on proposals (confirmations, authorization, progress, tasks) | #407 | 2026-10-26 | Confirmations accepted and active; the other three are in `proposed/` |
| Follow-up links in docs | #471 | 2026-10-29 | Linked #465–#469 |
| #465, Rust part: `structuredContent` and `outputSchema` in the `server` feature | #523 | 2026-10-31 | `with_advertise_output_schema(false)` opt-out; per-request context hook |
| Rust grouped/lazy strategies, meta-tools, bootstrap and contexts (the Phase 4 deviation handed to parity D1) | #526 | 2026-10-31 | `structuredContent` on every route; default strategy now `Grouped` |

## Not done

- **#465** (open): `structuredContent` and top-level `outputSchema` in Python and the C++ todo backend. Rust is done (#523, #526).
- **#466** (open): item 2 (meta-tool context) was decided by the owner on 2026-10-31 as one optional `meta` argument (recorded in #530, `proposed/declared-context-fields`); not implemented, and `spec/command-metadata.md` does not record it yet. Items 1 (`title`) and 3 (`x-mcp-header`) are undecided.
- **#469** (open): open questions 4 (3.0 removal window), 5 (authorization in 2.x), 6 (link vs replace parity Wave 3) and 8 (confirm Rust MSRV split). Answers go in the proposal's decisions section.
- **#341** (open): C++ `afd::mcp_stdio` library target; the todo backend's `mcp_stdio.cpp` is still the pattern to copy.
- **Phase 8**: legacy removal (`/sse`, `/message`, `Mcp-Session-Id`, `SessionStore`, deprecated transports). Blocked on #469 question 4.

## Verification evidence

- PR merge states and dates read with `gh pr view` on 2026-10-31.
- `.github/workflows/conformance.yml` on `5875e301` runs `--mode modern` for the TypeScript, Python, Rust and C++ backends.
- `docs/language-parity.md` "MCP tool fields" row (2026-10-31): TypeScript Yes, Rust Yes, Python and C++ Partial (annotations only).
- Not re-run locally in this audit; no fresh conformance receipt.

## Observed issues

- Phase 2–4 and 6 inline statuses in the proposal still said "implemented on branch" after merge; corrected to the merging PRs on 2026-10-31.

## Follow-ups

- When #465 closes, update the proposal's status line and the `spec/command-metadata.md` table.
- When #469 is answered, record the decisions in the proposal and plan Phase 8.
- Move this folder to `complete/` after Phase 8 ships, or earlier if the owner decides Phase 8 is tracked separately (it needs the 3.0 major).

## Notes

- Phase 7 follow-ons other than confirmations (authorization, progress, tasks) are separate proposals in `docs/features/proposed/` and are not tracked here.
