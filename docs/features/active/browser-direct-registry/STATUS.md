# Browser-safe direct registry: status

Read this before working on the feature, and update it before ending a
session that changed it.

## State

| Item | State | Evidence | Verified |
|---|---|---|---|
| [Proposal](./proposal.md) | Approved 2026-10-31 and moved to `active/`; open questions decided the same day | [#527](https://github.com/lushly-dev/afd/issues/527) | 2026-10-31: the browser bundles in "Today" measured with esbuild 0.27.7 against `packages/server/dist`, whose sources are unchanged on `main` at `03815e26`; the Rust parity row read from #526 |
| Part 1: `/direct` entry and bundle test | Not started | None | |
| #458: shared approval-token vectors, before part 2 | Done: `spec/vectors/approval-tokens.json`, loaded by all four suites | #458; `packages/server/src/approval-vectors.test.ts` runs in `ci.yml` | 2026-10-31: TypeScript 65 tests, Python 42, Rust 2 (every case), C++ 2 (278 assertions); `alfred parity` vectors: 0 gaps |
| Part 2: approvals on WebCrypto | Not started; unblocked by #458 | None | |
| Part 3: contexts and the tool surface in process | Not started; waits on the hybrid strategy in TypeScript | None | |

## Done

- The browser bundle of each entry measured (proposal, "Today").
- The approval crypto helpers confirmed internal, so part 2 changes no
  public API.
- The router, lazy-tool, context and bootstrap modules confirmed free of
  Node built-ins.
- The three open questions decided by the owner: the `/direct` name, a
  typed call option for the context, and `listTools` on the registry with
  `DirectClient` forwarding it through its allowlist (proposal,
  "Decisions").
- The owner approved the proposal and its order: #458's vectors, part 1,
  part 2, then part 3 after the hybrid strategy.
- Corrections before implementation: `tool-router.js` and `tools.js` reach
  `node:crypto` through `confirmations.js`, so part 3 splits that module;
  the size budget is 35 KB for part 1 and 65 KB after part 3, from
  measurement; part 3 reuses `getToolsList`; context enter and exit report
  `persisted: false` as on the MCP 2026-07-28 lane rather than refusing;
  Rust's registry takes a per-call context since #526.

## Not done

Everything in the proposal's "Done when" list.

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
|---|---|---|---|
| 2026-10-31 | Proposal | Remove the stale comment in `packages/server/src/define.ts` that says the core root re-exports the process-spawning connectors; the core root now bundles for the browser | Open; fold into part 1 |
| 2026-10-31 | Proposal | Decide the three open questions before part 1's specification | Done 2026-10-31; see the proposal's "Decisions" |

## Session log

| Date | Session | What changed |
|---|---|---|
| 2026-10-31 | Loam review follow-up | Proposal and status written from the Loam review's finding that the direct registry, journal and approvals cannot be bundled for a browser |
| 2026-10-31 | Owner decisions | Open questions replaced by "Decisions"; part 3 now names the typed call option and `DirectClient.listTools` filtered by the allowlist |
| 2026-10-31 | Pre-implementation check | Approved and moved to `active/`. Corrected the Node-free claim for the router and tool list, set the size budgets from measurement, put #458 before part 2, sequenced part 3 after the hybrid strategy, matched context enter and exit to the 2026-07-28 lane, and updated Rust parity for #526 |
| 2026-10-31 | #458 | Shared approval token vectors landed and loaded by TypeScript, Python, Rust and C++, so part 2 is held to known answers in `ci.yml` |
