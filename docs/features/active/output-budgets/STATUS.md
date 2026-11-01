# Output budgets: status

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

- **State:** approved 2026-11-01 under the owner's delegation of 2026-10-31; the owner approved the
  direction with the Umbel phase 2 specification (D64, [#625](https://github.com/lushly-dev/afd/pull/625),
  merged as `e996aad1`). Step 0 (`spec/`) merged as [#630](https://github.com/lushly-dev/afd/pull/630)
  (`f1f8ff79`, Umbel phase 2 step 0a). Rust implements it (Umbel phase 2 step 0b); TypeScript,
  Python and C++ do not yet.
- **Last verified:** 2026-11-01 against `main` at `e996aad1`. Current behavior read from
  `packages/server/src` (`execution.ts` `executeCommand` and `runHandler`, `context-fields.ts`,
  `meta-argument.ts`, `mcp-modern.ts`, `http-handler.ts`, `tool-router.ts`, `journal.ts`,
  `direct-registry.ts`), `packages/core/src` (`commands.ts`, `command-execution.ts`,
  `pipeline-executor.ts`, `journal.ts`), `packages/client/src` (`direct.ts`, `direct-types.ts`),
  `python/src/afd/server` (`factory.py` `_execute_command` and `_run_handler`, `context_fields.py`,
  `meta_argument.py`, `tool_router.py`, `journal.py`) and `python/src/afd/direct.py`,
  `packages/rust/src` (`commands.rs` `CommandRegistry::execute` and `middleware_chain`,
  `context_fields.rs`, `journal.rs`, `server/router.rs`, `server/context_hook.rs`,
  `server/meta_argument.rs`, `server/meta_tools.rs`, `server/strategy.rs`, `direct.rs`),
  `packages/cpp/src` (`registry.cpp`, `context_fields.cpp`, `batch_execution.cpp`,
  `pipeline_execution.cpp`) and the C++ todo backend's `mcp_stdio.cpp`; a search of all of them for
  `budget`, `truncat`, `maxBytes` and `max_bytes` found no result-size mechanism. External rules
  checked the same day against MCP 2026-07-28: the `_meta` key format and reserved prefixes
  (basic overview), the tools page (`structuredContent`, `outputSchema` conformance, `isError`, no
  size limit or truncation rule) and `schema.ts` (`Tool._meta`, `Result._meta`). Every `bytes` value
  in `spec/output-budgets.json` was computed with Node 24 (`Buffer.byteLength(JSON.stringify(v))`).
  `pnpm check` and the alfred parity tests passed on the pull request.
- **Done:** step 0, the specification ([#630](https://github.com/lushly-dev/afd/pull/630)), and step
  1, Rust (Umbel phase 2 step 0b): `packages/rust/src/output_budget.rs` and its wiring in
  `commands.rs`, `journal*.rs` and the MCP server's router, tool lists, `afd-detail` and `afd-help`;
  `OUTPUT_BUDGET_EXCEEDED` in the shared catalog, `vectors/error-codes.json` and all four constants;
  `tests/output_budget.rs` runs every case of `spec/output-budgets.json` in process and over
  Streamable HTTP and stdio in both MCP eras. The one case it skips is the measure case with a lone
  surrogate (a Rust string cannot hold one).
- **Not done:** steps 2 to 5 of the proposal's [implementation plan](output-budgets.proposal.md#implementation-plan):
  TypeScript, Python and C++, then the vectors move, the `meta-tools.json` description and the
  skills.

## Implementation plan

| Step | State | Evidence | Next gate |
| --- | --- | --- | --- |
| 0. `spec/` | Written (Umbel phase 2 step 0a) | New [`spec/output-budgets.md`](../../../../spec/output-budgets.md) and [`spec/output-budgets.json`](../../../../spec/output-budgets.json); amendments to `command-metadata.md`, `context-fields.md`, `journal.md`, `error-codes.md`, `protocol-conformance.md`, `vectors/README.md` and `CHANGELOG.md`; parity rows Planned. `spec/VERSION` stays `1.0-rc` | Merge |
| 1. Rust | Done (Umbel phase 2 step 0b) | `packages/rust` `src/output_budget.rs`, `tests/output_budget.rs`; the error code in all four languages | Merge |
| 2. TypeScript | Not started | None | Step 1 is done: the error-code constant `ErrorCodes.OUTPUT_BUDGET_EXCEEDED` exists |
| 3. Python | Not started | None | Step 1 is done: `ErrorCodes.OUTPUT_BUDGET_EXCEEDED` exists |
| 4. C++ | Not started | None | Step 1 is done: `error_codes::OUTPUT_BUDGET_EXCEEDED` exists; MCP after parity D2 ([#341](https://github.com/lushly-dev/afd/issues/341)) |
| 5. Vectors, `meta-tools.json`, conformance rows, skills | Not started | None | Steps 1 to 4 |

## Open questions

None. The choices the Umbel phase 2 plan left open are made in the proposal's
[choices](output-budgets.proposal.md#choices-this-proposal-made) and stated in the spec.

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-01 | Step 0 session | Add `OUTPUT_BUDGET_EXCEEDED` to the shared catalog, `vectors/error-codes.json` and the four constants in step 1, as `error-codes.md` requires of a new code | Done in step 1 (Rust, Umbel phase 2 step 0b) |
| 2026-11-01 | Step 0 session | Name `dev.afd/outputBudget` in the `meta` description of `spec/meta-tools.json` once every language accepts it; TypeScript and Rust compare that file byte for byte | Open, step 5 |
| 2026-11-01 | Step 0 session | Move `spec/output-budgets.json` into `spec/vectors/` (and the loader table in `vectors/README.md`) in the step that makes the fourth language load it | Open, step 5 |
| 2026-11-01 | Step 0 session | Budgets on streamed chunks, if a streaming command needs one (B7 leaves streams unchecked) | Open |
| 2026-11-01 | Step 0 session | The `build-mcp-servers` skill describes output budgets in general terms; point it at the spec once a language implements it | Open: Rust now implements it; the skill is Botcore's shared source, so the edit belongs in step 5 |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-01 | Step 0 session (Umbel phase 2 step 0a) | Proposal, this status file, `spec/output-budgets.md` and its cases, the `command-metadata.md`, `context-fields.md`, `journal.md`, `error-codes.md`, `protocol-conformance.md`, `vectors/README.md` and `CHANGELOG.md` amendments, parity rows; Umbel's status, architecture prerequisites row and phase 2 specification (amendments from step 0a). No code |
| 2026-11-01 | Step 1 session (Umbel phase 2 step 0b) | Rust implementation in `packages/rust` (declaration, ask, effective budget, the check after the handler, report, batches and pipelines, journal and replay, tool lists, `afd-detail`, `afd-help`); `OUTPUT_BUDGET_EXCEEDED` added to the shared catalog, `vectors/error-codes.json` and the TypeScript, Python, Rust and C++ constants; `tests/output_budget.rs` over `spec/output-budgets.json`; parity rows, changelogs and the `afd-rust` skill updated |
