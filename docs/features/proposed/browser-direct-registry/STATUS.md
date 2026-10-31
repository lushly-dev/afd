# Browser-safe direct registry: status

Read this before working on the feature, and update it before ending a
session that changed it.

## State

| Item | State | Evidence | Verified |
|---|---|---|---|
| [Proposal](./proposal.md) | Proposed 2026-10-31, not yet approved | [#527](https://github.com/lushly-dev/afd/issues/527) | 2026-10-31: the browser bundles in "Today" measured with esbuild 0.27.7 against `packages/server/dist` and `packages/core/dist` at `d8419ae5` |
| Part 1: `/direct` entry and bundle test | Not started | None | |
| Part 2: approvals on WebCrypto | Not started | None | |
| Part 3: contexts and the tool surface in process | Not started | None | |

## Done

- The browser bundle of each entry measured (proposal, "Today").
- The approval crypto helpers confirmed internal, so part 2 changes no
  public API.
- The router, lazy-tool, context and bootstrap modules confirmed free of
  Node built-ins.

## Not done

Everything in the proposal's "Done when" list.

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
|---|---|---|---|
| 2026-10-31 | Proposal | Remove the stale comment in `packages/server/src/define.ts` that says the core root re-exports the process-spawning connectors; the core root now bundles for the browser | Open; fold into part 1 |
| 2026-10-31 | Proposal | Decide the three open questions before part 1's specification | Open, owner's decision |

## Session log

| Date | Session | What changed |
|---|---|---|
| 2026-10-31 | Loam review follow-up | Proposal and status written from the Loam review's finding that the direct registry, journal and approvals cannot be bundled for a browser |
