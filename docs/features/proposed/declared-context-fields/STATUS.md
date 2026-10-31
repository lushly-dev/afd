# Declared context fields: status

Read this before working on the feature, and update it before ending a
session that changed it.

## State

| Item | State | Evidence | Verified |
|---|---|---|---|
| [Proposal](./proposal.md) | Proposed 2026-10-31, not yet approved | [#528](https://github.com/lushly-dev/afd/issues/528) | 2026-10-31: `_meta` handling read in `packages/server/src/mcp-modern.ts` and `python/src/afd/server/factory.py`; journal allowlist read in `spec/journal.md` and `packages/core/src/journal.ts`; the `extra` maps confirmed in the Python, Rust and C++ command contexts, at `d8419ae5` |
| Spec: `spec/context-fields.md`, journal changes, fixtures | Not started | None | |
| TypeScript reference | Not started | None | |
| Python | Not started | None | |
| Rust | Not started; waits on PR #523's context hook | None | |
| C++ journal | Not started | None | |

## Done

- The current behavior of every language recorded in the proposal's
  "Today".
- The compatibility rule chosen so existing journal hashes and fixtures
  keep matching.

## Not done

Everything in the proposal's "Done when" list.

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
|---|---|---|---|
| 2026-10-31 | Proposal | Decide the meta-tool `meta` argument together with #466 item 2 | Open |
| 2026-10-31 | Proposal | Decide the four open questions before the spec is written | Open, owner's decision |

## Session log

| Date | Session | What changed |
|---|---|---|
| 2026-10-31 | Loam review follow-up | Proposal and status written from the Loam review's finding that request values cannot reach commands over MCP and that the journal cannot keep them |
