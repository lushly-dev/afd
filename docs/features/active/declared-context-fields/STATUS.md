# Declared context fields: status

Read this before working on the feature, and update it before ending a
session that changed it.

## State

| Item | State | Evidence | Verified |
|---|---|---|---|
| [Proposal](./proposal.md) | Approved 2026-10-31 and moved to `active/`; open questions decided the same day | [#528](https://github.com/lushly-dev/afd/issues/528) | 2026-10-31: `_meta` handling read in `packages/server/src/mcp-modern.ts` and `python/src/afd/server/factory.py`; journal allowlist read in `spec/journal.md` and `packages/core/src/journal.ts`; the `extra` maps confirmed in the Python, Rust and C++ command contexts, at `d8419ae5` |
| Spec: `spec/context-fields.md`, journal changes, fixtures | Not started; after the direct registry's parts 1 and 2, in its own pull request apart from the hybrid strategy's spec change | None | |
| TypeScript reference | Not started | None | |
| Python | Not started | None | |
| Rust | Not started; #523's context hook merged 2026-10-31 | None | |
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

## Session log

| Date | Session | What changed |
|---|---|---|
| 2026-10-31 | Loam review follow-up | Proposal and status written from the Loam review's finding that request values cannot reach commands over MCP and that the journal cannot keep them |
| 2026-10-31 | Owner decisions | Open questions replaced by "Decisions"; delivery gains the `_meta`-only and shared-reader rules; the journal's size marker became the `contextOmitted` list; section 5 records the `meta` argument for #466 |
| 2026-10-31 | Pre-implementation check | Approved and moved to `active/`. #523 recorded as merged, the `meta` argument moved to #466's scope, and the order set: after the direct registry's parts 1 and 2, with the spec change landing apart from the hybrid strategy's |
