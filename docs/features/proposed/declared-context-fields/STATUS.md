# Declared context fields: status

Read this before working on the feature, and update it before ending a
session that changed it.

## State

| Item | State | Evidence | Verified |
|---|---|---|---|
| [Proposal](./proposal.md) | Proposed 2026-10-31; open questions decided 2026-10-31; not yet approved for implementation | [#528](https://github.com/lushly-dev/afd/issues/528) | 2026-10-31: `_meta` handling read in `packages/server/src/mcp-modern.ts` and `python/src/afd/server/factory.py`; journal allowlist read in `spec/journal.md` and `packages/core/src/journal.ts`; the `extra` maps confirmed in the Python, Rust and C++ command contexts, at `d8419ae5` |
| Spec: `spec/context-fields.md`, journal changes, fixtures | Not started | None | |
| TypeScript reference | Not started | None | |
| Python | Not started | None | |
| Rust | Not started; unblocked: PR #523's `McpServer::with_context_hook` merged 2026-10-31 | None | 2026-10-31: `with_context_hook` in `packages/rust/src/server.rs` on main |
| C++ journal | Not started | None | |

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
  (proposal, section 5).

## Not done

Everything in the proposal's "Done when" list.

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
|---|---|---|---|
| 2026-10-31 | Proposal | Decide the meta-tool `meta` argument together with #466 item 2 | Decided 2026-10-31: one `meta` object on all five meta-tools; recorded on #466, which writes it into `spec/command-metadata.md` |
| 2026-10-31 | Proposal | Decide the four open questions before the spec is written | Done 2026-10-31; see the proposal's "Decisions" |

## Session log

| Date | Session | What changed |
|---|---|---|
| 2026-10-31 | Loam review follow-up | Proposal and status written from the Loam review's finding that request values cannot reach commands over MCP and that the journal cannot keep them |
| 2026-10-31 | Owner decisions | Open questions replaced by "Decisions"; delivery gains the `_meta`-only and shared-reader rules; the journal's size marker became the `contextOmitted` list; section 5 records the `meta` argument for #466 |
