# Browser-safe direct registry: status

Read this before working on the feature, and update it before ending a
session that changed it.

## State

| Item | State | Evidence | Verified |
|---|---|---|---|
| [Proposal](./proposal.md) | Approved 2026-10-31 and moved to `active/`; open questions decided the same day | [#527](https://github.com/lushly-dev/afd/issues/527) | 2026-10-31: the browser bundles in "Today" measured with esbuild 0.27.7 against `packages/server/dist`, whose sources are unchanged on `main` at `03815e26`; the Rust parity row read from #526 |
| Part 1: `/direct` entry and bundle test | Done | `packages/server/src/direct.ts`, the `./direct` export, `src/entry-points.test.ts` (renamed from `define.test.ts`), server README, `afd-typescript` and `afd-directclient` skills, changeset `server-direct-entry` | 2026-10-31: browser bundle has no MCP SDK, `node:` import or Node-only core subpath; 32.2 KB for the registry, journal and `defineCommand` (budget 35 KB), 59.8 KB for every export (budget 66 KB), esbuild 0.27.7 |
| #458: shared approval-token vectors, before part 2 | Done: `spec/vectors/approval-tokens.json`, loaded by all four suites | #458; `packages/server/src/approval-vectors.test.ts` runs in `ci.yml` | 2026-10-31: TypeScript 65 tests, Python 42, Rust 2 (every case), C++ 2 (278 assertions); `alfred parity` vectors: 0 gaps |
| Part 2: approvals on WebCrypto | Not started; unblocked by #458 | None | |
| Part 3: contexts and the tool surface in process | Done in its pull request, ahead of part 2, which waits for the owner's security review | `packages/server/src/direct-registry.ts` (`contexts`, the `activeContext` call option, `listTools`, the `tools` option), `direct-tool-surface.ts` (`createDirectToolSurface`), `confirmation-gate.ts` (split from `confirmations.ts`), `direct-tool-surface.test.ts` (the shared test against `createMcpHandler`), `direct-registry-contexts.test.ts`, `entry-points.test.ts`; `packages/client/src/direct.ts` (`activeContext`, `listTools`), `direct-tools.test.ts`; server and client READMEs, `afd-typescript` and `afd-directclient` skills, `docs/language-parity.md`, `spec/error-codes.md`, `spec/tool-strategies.md` (H8), changeset `direct-registry-tool-surface` | 2026-10-31: tool lists and call results equal over the MCP 2026-07-28 lane for `individual`, `grouped`, `lazy` and `hybrid`, with and without bootstrap tools, in no context, `writing` and `billing` (58 tests); browser bundles, esbuild 0.27.7: 37.3 KB for the registry, journal and `defineCommand` (budget 39 KB, no router module in the output), 67.6 KB with `createDirectToolSurface` (budget 74 KB), 94.4 KB for every export (budget raised from 66 KB to 104 KB) |

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

- Part 2 (approvals on WebCrypto), and with it the approval middleware in `/direct`.
- The Chromium test of the proposal's "Done when" list, which needs part 2.
- Part 3 is implemented but not merged; the "Done when" items it covers (the shared test, the
  README, skills and parity row) close when it lands.

## Interpretations in part 3

- **The call option is `activeContext`**, not the proposal's example `{ context: 'billing' }`: it
  matches Rust's `CommandContext::with_active_context` and does not collide with the command
  context argument it sits beside. `DirectClient` takes it in its call options, beside `traceId`
  and `timeout`, and passes it as the registry's option.
- **Exposure is the registry's interface.** Where the MCP server lists, routes and describes its
  MCP-exposed commands, the surface uses the commands exposed to the registry's `interface`
  (`'agent'` by default), and exposes its own context and bootstrap tools to it. With
  `interface: 'mcp'` the surface sees exactly the server's commands.
- **An unknown context** is a protocol error (`-32602`) on the MCP lane, which has no
  `CommandResult` to give. In process it is `CONTEXT_NOT_FOUND` from `execute`, with the MCP lane's
  suggestion ("Use one of: ..."), and a `RangeError` from `listTools`. A registry with no contexts
  refuses any `activeContext`, where the MCP lane ignores `_meta["dev.afd/context"]` on a server
  without contexts: failing closed seemed safer for a typed option.
- **Only non-command tool names go through the router**: the meta-tools, and grouped tools under
  `grouped`. Commands, context tools and bootstrap tools run through the engine directly, which
  gives the same result and keeps the caller's `traceId`. Grouped calls route by the surface's
  strategy, whatever `listTools({ strategy })` asked for.
- **The context tools' hint** is the 2026-07-28 lane's text about `_meta`, word for word, as Rust's
  in-process registry gives it, so the shared test compares equal results.
- **Suggestions** name `afd-discover` and the context tools only when the surface serves them
  (`spec/error-codes.md`, "Suggestions name only tools the host provides"). Without a surface the
  registry now ends `COMMAND_NOT_FOUND` with "Check the command name against the available
  commands." (it used to point to `afd-discover`), and `COMMAND_NOT_IN_CONTEXT` names the command's
  contexts, as Rust and C++ do.
- **`allow` filters tools by name**, as `call()` checks it. Allowing a meta-tool or a grouped tool
  lets a `DirectClient` reach every command the registry exposes through it; the docs say to hide
  commands with `expose: { agent: false }` instead.

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
|---|---|---|---|
| 2026-10-31 | Proposal | Remove the stale comment in `packages/server/src/define.ts` that says the core root re-exports the process-spawning connectors; the core root now bundles for the browser | Done in part 1: the comment and the matching test comment now say why `/define` keeps to the narrow core subpaths |
| 2026-10-31 | Proposal | Decide the three open questions before part 1's specification | Done 2026-10-31; see the proposal's "Decisions" |
| 2026-10-31 | Part 3 | DirectClient `allow` checks tool names only: a client that allows `afd-call`, `afd-batch`, `afd-pipe` or a grouped tool reaches every command the registry exposes. Enforce `allow` per routed command (an `allow` call option checked inside the registry) | Open |

## Session log

| Date | Session | What changed |
|---|---|---|
| 2026-10-31 | Loam review follow-up | Proposal and status written from the Loam review's finding that the direct registry, journal and approvals cannot be bundled for a browser |
| 2026-10-31 | Owner decisions | Open questions replaced by "Decisions"; part 3 now names the typed call option and `DirectClient.listTools` filtered by the allowlist |
| 2026-10-31 | Pre-implementation check | Approved and moved to `active/`. Corrected the Node-free claim for the router and tool list, set the size budgets from measurement, put #458 before part 2, sequenced part 3 after the hybrid strategy, matched context enter and exit to the 2026-07-28 lane, and updated Rust parity for #526 |
| 2026-10-31 | #458 | Shared approval token vectors landed and loaded by TypeScript, Python, Rust and C++, so part 2 is held to known answers in `ci.yml` |
| 2026-10-31 | Part 1 | `/direct` entry, browser bundle test and two measured size budgets; `/define` comment corrected; README, skills and changeset |
| 2026-10-31 | Part 3 | `confirmations.ts` split so the router and tool list are Node-free; contexts and the per-call `activeContext` option in `createDirectRegistry`; `createDirectToolSurface` injected as `tools`, with `listTools`, meta-tool routing and stateless context tools; `DirectClient` `activeContext` and `listTools`; a shared test against `createMcpHandler` for every strategy and context; a third size budget and a check that a host without the surface bundles no router module. The implemented option name is `activeContext` (the proposal's example was `{ context: 'billing' }`); see "Interpretations in part 3" |
