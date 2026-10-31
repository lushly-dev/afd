# MCP confirmations status

**State:** Active. Phases 1–3 are merged: TypeScript, Python and Rust servers enforce `confirmPrompt`. The C++ backend (#467) and the Python client (#468) remain; Phase 4 is optional and undecided.
**Last updated:** 2026-10-31, against `origin/main` `5875e301`.

The [proposal](./mcp-confirmations.proposal.md) is the design and acceptance contract (decisions C1–C6, accepted 2026-10-25). It resolves decision D10 of [MCP 2026-07-28](../mcp-2026-07-28/STATUS.md).

## Done / merged

| Item | PR | Merged | Notes |
| --- | --- | --- | --- |
| Proposal | #407 | 2026-10-26 | Ranked 1 of 4 MCP Phase 7 follow-ons |
| Phase 1: spec "Confirmations" section, `CONFIRMATION_REQUIRED` / `CONFIRMATION_DECLINED` in all four catalogs, Python and Rust metadata fields | #410 | 2026-10-26 | |
| Phase 2: TypeScript server, client `onElicitation`, `INPUT_REQUIRED`, CLI prompt, `spec/confirmation-cases.json` | #435 | 2026-10-26 | |
| Phase 3: Python and Rust servers, todo backends gate `todo-clear` | #442 | 2026-10-26 | Rust gated individual tools only at this point |
| Rust confirmation gate on grouped tools, `afd-call`, batch and pipeline (one prompt for all gated commands) | #526 | 2026-10-31 | Landed with parity D1 |

## Not done

- **#467** (open): C++ todo backend: acknowledgement path (`confirm: true`, `_meta["dev.afd/confirm"]`) and a `--suite confirmations` CI leg. Elicitation waits on #341 (C++ `afd::mcp_stdio`).
- **#468** (open): Python client `on_elicitation` and the `INPUT_REQUIRED` failure. `spec/error-codes.md` still lists `INPUT_REQUIRED` as "Python planned".
- **Phase 4** (optional, needs its own decision): elicitation for missing input and for offering `undoCommand`. Decision tracked in #552.

## Verification evidence

- PR merge states and dates read with `gh pr view` on 2026-10-31.
- `.github/workflows/conformance.yml` on `5875e301` runs `--suite confirmations` for TypeScript (legacy and modern), Python (legacy and modern) and Rust (modern only; stateless HTTP has no 2025 back channel). No C++ confirmations leg.
- `docs/language-parity.md` `confirmPrompt` row: TypeScript, Python, Rust Yes; C++ Planned.
- Not re-run locally in this audit.

## Observed issues

- The proposal's status line said Phase 3 was "implemented on branch" after #442 merged; corrected on 2026-10-31.

## Follow-ups

- Close out #467 and #468, then decide whether Phase 4 is in scope. If Phase 4 is declined or split into its own proposal, this folder can move to `complete/`.
- C1 notes `'enforce'` as a candidate 3.0 default; that belongs with the 3.0 decision in #469.
