# Declared context fields: status

Read this before working on the feature, and update it before ending a
session that changed it.

## State

| Item | State | Evidence | Verified |
|---|---|---|---|
| [Proposal](./proposal.md) | Complete 2026-10-31 and moved to `complete/`: every "Done when" item is met in TypeScript, Python, Rust and C++ (#565, #566, #568). The meta-tool `meta` argument ships with #466 | [#528](https://github.com/lushly-dev/afd/issues/528) | 2026-10-31: `_meta` handling read in `packages/server/src/mcp-modern.ts` and `python/src/afd/server/factory.py`; journal allowlist read in `spec/journal.md` and `packages/core/src/journal.ts`; the `extra` maps confirmed in the Python, Rust and C++ command contexts, at `d8419ae5` |
| Spec: `spec/context-fields.md`, journal changes, fixtures | Done for declaration, in-process values and the journal; conformance rows for `_meta` delivery come with delivery | `spec/context-fields.md`, `spec/journal.md` ("Declared context fields"), `spec/wire/journal.jsonl` lines 5 and 6, `spec/CHANGELOG.md` | 2026-10-31: lines 1 to 4 byte for byte unchanged; all four languages record lines 5 and 6 with TypeScript's hashes |
| TypeScript reference | Done: declaration, in-process values, journal and replay; `_meta` delivery on both eras over HTTP and stdio and on the AFD HTTP lanes; `server/discover` and `afd-help` | `packages/server/src/context-fields.ts`, `execution.ts`, `journal.ts`, `journal-replay.ts`, `context-fields.test.ts`, `journal-wire.test.ts`; changeset `declared-context-fields-journal` | 2026-10-31: server and core suites pass |
| Python | Done: declaration, in-process values, journal and replay; `_meta` delivery on both eras over Streamable HTTP, SSE and stdio; `server/discover` and `afd-help` (`tests/test_context_fields_mcp.py`) | `python/src/afd/server/context_fields.py`, `afd/core/journal.py`, `afd/server/journal.py`, `factory.py`, `tests/test_context_fields.py`, `tests/test_journal_wire.py` | 2026-10-31: pytest passes |
| Rust | Done: declaration, in-process values, journal and replay; `_meta` delivery on both eras over Streamable HTTP and stdio after the context hook; `server/discover` and `afd-help` (`tests/server_context_fields.rs`) | `packages/rust/src/context_fields.rs`, `commands.rs`, `journal.rs`, `journal/recorder.rs`, `journal/replay.rs`, `tests/context_fields.rs`, `tests/journal_wire.rs` | 2026-10-31: fmt, clippy and tests with and without default features pass |
| C++ | Declaration, in-process values, journal and replay done (no MCP server) | `packages/cpp/include/afd/context_fields.hpp`, `src/context_fields.cpp`, `src/registry.cpp`, `src/journal.cpp`, `src/journal_replay.cpp`, `tests/context_fields_test.cpp`, `tests/journal_wire_test.cpp` | 2026-10-31: dev and noexcept-nortti builds and ctest pass |

## Done

- The current behavior of every language recorded in the proposal's
  "Today".
- The compatibility rule chosen so existing journal hashes and fixtures
  keep matching.
- The four open questions decided by the owner: `VALIDATION_ERROR` for an
  invalid value, a `contextOmitted` list for oversize values, no HTTP
  header delivery, and AFD contexts kept separate from declared fields
  (proposal, "Decisions").
- The owner chose one `meta` argument on the meta-tools for #466 item 2
  (proposal, section 5). It ships with #466, outside this proposal's
  "Done when".
- The owner approved the proposal and its order (proposal, "Effort and
  order").

## Not done

Everything in the proposal's "Done when" list.

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
|---|---|---|---|
| 2026-10-31 | Proposal | Decide the meta-tool `meta` argument together with #466 item 2 | Decided 2026-10-31: one `meta` object on all five meta-tools; recorded on #466, which writes it into `spec/command-metadata.md` |
| 2026-10-31 | Proposal | Decide the four open questions before the spec is written | Done 2026-10-31; see the proposal's "Decisions" |
| 2026-10-31 | Rust implementation | Rust measures the 4096-byte cap with serde's number spelling and UTF-8 key order; JavaScript's spelling (as `canonical_json` writes it with the `approval` feature) would make a value within a few bytes of the cap agree with the other languages | Open |
| 2026-10-31 | C++ implementation | `alfred parity` counts the new C++ `context_field` name as missing from TypeScript (192, was 191): TypeScript's `ContextField` lives in `@lushly-dev/afd-server`, which parity does not read | Open; accepted |
| 2026-10-31 | Rust delivery | Rust's `afd-batch` `context` argument (older than this feature) also fills an item's `extra`, so a caller can supply a declared field outside `_meta`; it is still validated and is a claim either way, but the spec does not mention it. Decide whether the meta-tool `meta` argument (#466 item 2) replaces it | Open |

## Session log

| Date | Session | What changed |
|---|---|---|
| 2026-10-31 | Loam review follow-up | Proposal and status written from the Loam review's finding that request values cannot reach commands over MCP and that the journal cannot keep them |
| 2026-10-31 | Owner decisions | Open questions replaced by "Decisions"; delivery gains the `_meta`-only and shared-reader rules; the journal's size marker became the `contextOmitted` list; section 5 records the `meta` argument for #466 |
| 2026-10-31 | Pre-implementation check | Approved and moved to `active/`. #523 recorded as merged, the `meta` argument moved to #466's scope, and the order set: after the direct registry's parts 1 and 2, with the spec change landing apart from the hybrid strategy's |
| 2026-10-31 | Journal contract | `spec/context-fields.md`, journal `context` and `contextOmitted`, two fixture lines, and declaration, in-process values, journal and replay in TypeScript, Python, Rust and C++; absent or `null` is no value, `afd-*` commands do not enforce `required`, `session` and `source` reserved |
| 2026-10-31 | TypeScript delivery | `tools/call` `_meta` on both eras over Streamable HTTP and stdio, `/message`, `/rpc`, `/batch` and `/stream`; `createContext` wins; discovery in `server/discover` (by wrapping the SDK's `_ondiscover`) and `afd-help`; conformance rows; `context-fields-mcp.test.ts` |
| 2026-10-31 | Python and Rust delivery | `tools/call` `_meta` delivery and discovery in Python (public SDK handler hook) and Rust (`DiscoverResult.meta`); conformance rows filled; the feature's done-when list is complete apart from #466's `meta` argument |
| 2026-10-31 | Completion | Moved to `docs/features/complete/`; #528 closed. Open follow-ups stay in the table above |
