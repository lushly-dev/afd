# Output budgets: status

Epic: [#1555](https://github.com/lushly-dev/afd/issues/1555). File new work for this area as its sub-issue.

Read this before the [proposal](output-budgets.proposal.md). It records exactly what is done and
what is not, so an agent never has to scan the code to learn what is current. It follows the shape
of the [Umbel status](../../../../endpoints/umbel/docs/STATUS.md).

## How to keep this file

- "Done" means merged to `main` with evidence linked. Anything else is "in progress" or "open",
  with what remains spelled out.
- Record how you verified it, the command or check, and the absolute date.
- Write down follow-ups that are not yet issues, with the date and who raised them; link the issue
  when one exists.
- Never delete history. Mark an entry superseded and point to what replaced it.

## Status block

- **State:** complete 2026-11-22 (approved 2026-11-01 under D64, [#625](https://github.com/lushly-dev/afd/pull/625),
  `e996aad1`). All six steps (0–5) are implemented across `spec/`, Rust, TypeScript, Python and C++;
  this folder moved from `active/` to `complete/` in Step 5 ([#1993](https://github.com/lushly-dev/afd/issues/1993)).
- **Last verified:** 2026-11-22 against `main` at `9c3f9f2` (Step 5 branch `lush/output-budgets-step5`).
  All four languages pass `spec/vectors/output-budgets.json` (Rust and C++ skip only the
  lone-surrogate `measure` case), `spec/meta-tools.json` matches byte for byte across all four
  languages, `alfred parity` reports 0 vector gaps, and `scripts/check-vector-drift.mjs` accepts
  `output-budgets.json` as `authored`.
- **Done:**
  - Step 0 (`spec/`, [#630](https://github.com/lushly-dev/afd/pull/630), `f1f8ff79`): specification and hand-authored cases.
  - Step 1 (Rust, [#633](https://github.com/lushly-dev/afd/pull/633), `13c2a8f4`): Rust B1–B8 plus `OUTPUT_BUDGET_EXCEEDED` in all four languages.
  - Step 2 (TypeScript, [#2215](https://github.com/lushly-dev/afd/pull/2215), `9c3f9f2`): TypeScript B1–B8 (closes #1989).
  - Step 3 (Python, [#2186](https://github.com/lushly-dev/afd/pull/2186), `b53d7cf`): Python B1–B8 (closes #1990).
  - Step 4 (C++, [#2187](https://github.com/lushly-dev/afd/pull/2187), `f0a1a8d`): C++ B1–B8 (closes #1991).
  - Step 5 ([#2246](https://github.com/lushly-dev/afd/pull/2246), closes [#1993](https://github.com/lushly-dev/afd/issues/1993)): promoted `output-budgets.json` to `spec/vectors/`, renamed four-language vector loaders, added `dev.afd/outputBudget` to `spec/meta-tools.json` across all four languages, updated conformance/parity/feature docs and all six skills (including Botcore's `mcp-builder`).
- **Not done:** none for the epic scope. Streamed chunks remain unchecked per B7 (open follow-up below).

## Implementation plan

| Step | State | Evidence | Next gate |
| --- | --- | --- | --- |
| 0. `spec/` | Done ([#630](https://github.com/lushly-dev/afd/pull/630)) | [`spec/output-budgets.md`](../../../../spec/output-budgets.md), cases (now [`spec/vectors/output-budgets.json`](../../../../spec/vectors/output-budgets.json)), spec amendments | Merged (`f1f8ff79`) |
| 1. Rust | Done ([#633](https://github.com/lushly-dev/afd/pull/633)) | `packages/rust/src/output_budget.rs`, `packages/rust/tests/output_budget_vectors.rs`; `OUTPUT_BUDGET_EXCEEDED` in all 4 languages | Merged (`13c2a8f4`) |
| 2. TypeScript | Done ([#2215](https://github.com/lushly-dev/afd/pull/2215), closes #1989) | `packages/core/src/output-budget.ts`, `packages/server/src/output-budget.ts`, `packages/server/src/output-budget-vectors.test.ts` (all cases incl. lone surrogate), DirectClient `outputBudget`, D115 ceilings updated | Merged (`9c3f9f2`) |
| 3. Python | Done ([#2186](https://github.com/lushly-dev/afd/pull/2186), closes #1990) | `python/src/afd/core/output_budget.py`, `python/tests/test_output_budget_vectors.py`, `python/tests/test_output_budget_mcp.py` (all cases in process & over Streamable HTTP, SSE, stdio, both eras) | Merged (`b53d7cf`) |
| 4. C++ | Done ([#2187](https://github.com/lushly-dev/afd/pull/2187), closes #1991) | `packages/cpp/include/afd/output_budget.hpp`, `packages/cpp/src/output_budget.cpp`, `packages/cpp/tests/output_budget_vectors_test.cpp` (in process & `afd::mcp_stdio`, both eras; skips lone surrogate) | Merged (`f0a1a8d`) |
| 5. Vectors, `meta-tools.json`, conformance rows, skills | Done ([#2246](https://github.com/lushly-dev/afd/pull/2246), closes [#1993](https://github.com/lushly-dev/afd/issues/1993)) | `spec/vectors/output-budgets.json` + `VECTOR_MANIFEST`, 4-language `meta-tools.json` parity, capability manifests, docs moved to `complete/`, 6 skills updated + Botcore provenance | None |

## Open questions

None. The choices the Umbel phase 2 plan left open are made in the proposal's
[choices](output-budgets.proposal.md#choices-this-proposal-made) and stated in the spec.

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-01 | Step 0 session | Add `OUTPUT_BUDGET_EXCEEDED` to the shared catalog, `vectors/error-codes.json` and the four constants in step 1, as `error-codes.md` requires of a new code | Done in step 1 ([#633](https://github.com/lushly-dev/afd/pull/633)) |
| 2026-11-01 | Step 0 session | Name `dev.afd/outputBudget` in the `meta` description of `spec/meta-tools.json` once every language accepts it; TypeScript and Rust compare that file byte for byte | Done in step 5 ([#1993](https://github.com/lushly-dev/afd/issues/1993)) |
| 2026-11-01 | Step 0 session | Move `spec/output-budgets.json` into `spec/vectors/` (and the loader table in `vectors/README.md`) in the step that makes the fourth language load it | Done in step 5 ([#1993](https://github.com/lushly-dev/afd/issues/1993)) |
| 2026-11-01 | Step 0 session | Budgets on streamed chunks, if a streaming command needs one (B7 leaves streams unchecked) | Open |
| 2026-11-01 | Step 0 session | The `build-mcp-servers` skill describes output budgets in general terms; point it at the spec once a language implements it | Done in step 5 ([#1993](https://github.com/lushly-dev/afd/issues/1993)) |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-01 | Step 0 session (Umbel phase 2 step 0a) | Proposal, this status file, `spec/output-budgets.md` and its cases, the `command-metadata.md`, `context-fields.md`, `journal.md`, `error-codes.md`, `protocol-conformance.md`, `vectors/README.md` and `CHANGELOG.md` amendments, parity rows; Umbel's status, architecture prerequisites row and phase 2 specification (amendments from step 0a). No code |
| 2026-11-01 | Step 1 session (Umbel phase 2 step 0b) | Rust implementation in `packages/rust` (declaration, ask, effective budget, the check after the handler, report, batches and pipelines, journal and replay, tool lists, `afd-detail`, `afd-help`); `OUTPUT_BUDGET_EXCEEDED` added to the shared catalog, `vectors/error-codes.json` and the TypeScript, Python, Rust and C++ constants; `tests/output_budget.rs` over `spec/output-budgets.json`; parity rows, changelogs and the `afd-rust` skill updated |
| 2026-11-22 | Step 3 session (#1990 / [#2186](https://github.com/lushly-dev/afd/pull/2186)) | Python implementation in `python/` (`OutputBudget`, `output_budget` declaration/surfaces, ask/validation/precedence across MCP both eras + SSE + stdio + `meta` argument + `DirectClient`, `_run_handler` & core registry check, journal & replay); full `spec/output-budgets.json` loader |
| 2026-11-22 | Step 4 session (#1991 / [#2187](https://github.com/lushly-dev/afd/pull/2187)) | C++ implementation in `packages/cpp` (`output_budget.hpp`/`.cpp`, registry validation and `run_handler` check, `execute_stream` skip per B7, reserved context field names, `DirectClient` forwarding, journal and replay, and `afd::mcp_stdio` `_meta`/meta-argument/tool surfaces in both eras); `tests/output_budget_test.cpp` loading `spec/output-budgets.json` (skips lone-surrogate measure case) |
| 2026-11-22 | Step 2 session (#1989 / [#2215](https://github.com/lushly-dev/afd/pull/2215)) | TypeScript implementation in `packages/core`, `packages/server` and `packages/client` (B1–B8 across MCP both eras, AFD HTTP lanes, MCP Tasks, `meta` argument, `createDirectRegistry`/`DirectClient`, buffered `executeStream` skip per B7, journal & replay); full `spec/output-budgets.json` loader; Loam `vite.config.ts` chunk grouping & D115 ceiling bump |
| 2026-11-22 | Step 5 session (#1993 / [#2246](https://github.com/lushly-dev/afd/pull/2246)) | Promoted `spec/output-budgets.json` to `spec/vectors/output-budgets.json` and registered it in `VECTOR_MANIFEST`; renamed all four vector test files; updated `spec/meta-tools.json` and all four language meta-tool definitions to name `dev.afd/outputBudget`; updated `spec/capabilities/` manifests; moved feature docs to `docs/features/complete/output-budgets/`; updated conformance/parity/vector docs and six skills (including Botcore `mcp-builder` + provenance) |
