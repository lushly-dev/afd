# Umbel status

Read this before anything else in the area, and update it before you end a
session that changed Umbel. It is the source of truth for progress: an agent
should never have to scan the codebase to learn what is current.

## How to keep this file

- **Say exactly what is done and exactly what is not.** "Done" means merged
  to `main` with evidence linked: a pull request, a commit, a passing check.
  Anything else is "in progress" or "open" with what remains spelled out.
- **Record how you verified it**: the command or check, and the date.
- **Write down follow-ups that are not yet issues.** If a future agent must
  know it but nobody owns it yet, it goes in the follow-ups table with a date
  and who raised it. Promote it to an issue when it gets an owner, and link
  the issue here.
- **Never delete history.** Mark an entry superseded and point to what
  replaced it.
- **Every phase specification carries the same block**: state, last verified
  with date and evidence, done, not done, follow-ups. This file aggregates
  those blocks; the phase folder holds the detail (decisions D20 and D24).
- **Dates are absolute.** Never "last week".

## Documents

| Document | State | Evidence | Verified |
| --- | --- | --- | --- |
| [Architecture](architecture.md) | Revised after the 2026-10-30 end-to-end review and corrected in the 2026-10-31 handoff check; the through line | Merged in [#491](https://github.com/lushly-dev/afd/pull/491), [#493](https://github.com/lushly-dev/afd/pull/493) and [#516](https://github.com/lushly-dev/afd/pull/516); handoff corrections in [#519](https://github.com/lushly-dev/afd/pull/519) | 2026-10-30: three independent reviews (AFD alignment, coherence, external facts); relative links, fences and diagrams rendered. 2026-10-31: links, anchors and every D, O, R, W and S reference re-checked on `main` |
| [Proposal](proposal.md) | Approved rationale; the architecture wins where they differ | #491, #493 and #516 | Same as above |
| [Decision log](decisions.md) | D1 to D36; open decisions O1 and O3 to O5; O2 closed as D27 on 2026-10-31 | D1 to D12 in #491; D13 to D20 in #493; D21 to D26 and the O list in #516; D27 in [#522](https://github.com/lushly-dev/afd/pull/522); D28 to D36 proposed with the phase 0 specification, in review | Same as above; 2026-10-31: D27's links and the O2 references re-checked |
| [Trajectory watch](trajectory.md) | Current as of 2026-10-30; rows carry R and W numbers; W1, W2, W5, W6, W12 and W15 refreshed 2026-10-31 for phase 0 | #493; corrections in #516; the refresh with the phase 0 specification, in review | External claims fact-checked against primary sources on 2026-10-30; the refreshed rows on 2026-10-31 |
| [Phase 0 specification](phases/0-host-skeleton/spec.md) | Proposed 2026-10-31; awaiting the owner's approval (D24) | In review, pull request below | 2026-10-31 against `main` at `472b5f68`: links and anchors resolve |
| [Research](research.md), [Sources](sources.md) | Current as of 2026-10-30, with corrected figures | #491; corrections in #516 | Same as above |

## Phases

| Phase | State | Owner | Evidence | Next gate |
| --- | --- | --- | --- | --- |
| AFD prerequisites | Done for phase 0 | Owner's sessions | [#523](https://github.com/lushly-dev/afd/pull/523), [#526](https://github.com/lushly-dev/afd/pull/526), [#539](https://github.com/lushly-dev/afd/pull/539), [#538](https://github.com/lushly-dev/afd/pull/538), [#555](https://github.com/lushly-dev/afd/pull/555), [#556](https://github.com/lushly-dev/afd/pull/556) and [#560](https://github.com/lushly-dev/afd/pull/560) merged | Later phases' rows of the prerequisites table, each before the phase that needs it |
| 0. Host skeleton | Specification in review | Phase 0 owning agent | [Specification](phases/0-host-skeleton/spec.md), proposed 2026-10-31 | The owner approves the specification (D24); then implementation step 1 |
| 1. Plugin contract | Not started | None | None | Phase 0 exit criterion met |
| 2. Knowledge | Not started | None | None | Phase 1 exit criterion met |
| 3. Memory and context | Not started | None | None | Phase 2 exit criterion met |
| 4. Curator | Not started | None | None | Phase 3 exit criterion met |
| 5. Auth and hosted | Not started | None | None | Phase 2 exit criterion met |
| 6. Backends | Not started | None | None | Phase 2 exit criterion met |
| 7. Distribution and guides | Not started | None | None | Phases 4, 5 and 6 exit criteria met |
| Further first-class plugins | Not started | None | None | Phase 2 exit criterion met; each gets its own specification (D18) |

## Phase detail

### AFD prerequisites

- **State:** done for phase 0; the rows for phases 1 to 5 remain. Last
  verified 2026-10-31 against `main` at `57c731d2`.
- **Done:** Rust `structuredContent` and top-level `outputSchema` (the Rust
  part of #465, which stays open for Python and C++) and the per-request
  context hook (`McpServer::with_context_hook`), both merged in
  [#523](https://github.com/lushly-dev/afd/pull/523) as `77f176d3` with all
  nine checks green.
- **Done:** the Rust grouped, individual and lazy strategies, the five
  meta-tools and AFD contexts (language parity D1), merged in
  [#526](https://github.com/lushly-dev/afd/pull/526) as `03815e26` with all
  eleven checks green and the todo conformance suite at 34/34 in both MCP eras
  and with confirmations. Every route carries `structuredContent` and runs the
  context hook once per call; `grouped` is now the Rust default, which the
  owner accepted on 2026-10-31.
- **Done:** [#531](https://github.com/lushly-dev/afd/issues/531), a panic in
  the server's own request handling hanging the MCP request, fixed in
  [#539](https://github.com/lushly-dev/afd/pull/539) as `2552748c`; a
  handler's panic was already a `COMMAND_EXECUTION_ERROR` result. The hybrid
  strategy's spec step, [`spec/tool-strategies.md`](../../../spec/tool-strategies.md),
  merged in [#538](https://github.com/lushly-dev/afd/pull/538) as `977a0a35`.
- **Done:** the hybrid tool strategy (D27) in Rust,
  `ToolStrategy::Hybrid` with `McpServer::with_first_class_tools`, merged in
  [#560](https://github.com/lushly-dev/afd/pull/560) as `57c731d2` with all 25
  checks green; `tests/server_hybrid.rs` runs every case of
  `spec/tool-strategies.json` over stdio and Streamable HTTP in both MCP eras.
  Python ([#555](https://github.com/lushly-dev/afd/pull/555), `51f8d9d8`) and
  TypeScript ([#556](https://github.com/lushly-dev/afd/pull/556), `0d9720a1`)
  landed first. C++ (step 4) waits on its MCP target (parity D2, #341) and
  does not block Umbel. The [hybrid status](../../../docs/features/active/hybrid-tool-strategy/STATUS.md)
  tracks it.
- **Not done:** the later rows of the
  [prerequisites table](architecture.md#afd-prerequisites): resources,
  prompts and Skills over MCP (phases 1 and 2, shared with Loam), output
  budgets (phase 2), the MCP approval relay in Rust (phase 4), token
  verification, `scopes` and `credentials` (phase 5, with
  [#532](https://github.com/lushly-dev/afd/issues/532)) and the Rust MCP Tasks
  runtime (phase 5).
- **Note:** the hybrid strategy, resources, prompts, the Skills over MCP
  extension and output budgets are AFD-wide features; each needs a
  `docs/features` proposal, spec first, before Rust implements it (D25).

### Phase 0. Host skeleton

- **State:** specification in review. Last verified 2026-10-31 against
  `main` at `472b5f68`.
- **Done:** nothing merged. The [specification](phases/0-host-skeleton/spec.md)
  is written and proposes decisions D28 to D36 with the architecture
  amendments they need (embedded storage moved to phase 2, versioned shapes
  under `endpoints/umbel/schemas/`, four glossary terms, the Rust telemetry
  middleware as a phase 2 prerequisite).
- **Not done:** the owner's approval; all six implementation steps in the
  specification's plan (scaffold, workspace, registry and CLI, journal and
  events, MCP surfaces, exit); the exit criterion.
- **Follow-ups:** the six in the specification's follow-ups table, mirrored
  below.

Phases 1 to 7 have no detail yet; add a heading in this shape when one
starts.

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-10-30 | Design session | Land the phase 0 prerequisites in `packages/rust`; the lazy strategy, meta-tools and contexts are already parity item D1 and #465 is open | Done 2026-10-31: see the AFD prerequisites detail above |
| 2026-10-30 | Design session | Decide the execution model, open decision O2 | Done 2026-10-31: the owner chose the hybrid strategy, recorded as [D27](decisions.md) in [#522](https://github.com/lushly-dev/afd/pull/522), open until merged |
| 2026-10-30 | Design session | Decide the first external integration, open decision O1; it sets the connector contract | Open, owner's decision |
| 2026-10-30 | Design session | When crates land, add the units under `endpoints/umbel/` to the release inventory (`scripts/release/inventory.json`, D21); units start quarantined. Corrected 2026-10-31: `architecture.json` needs no change, since the boundary check classifies endpoint manifests by path | Open; specified 2026-10-31 as step 1 of the [phase 0 plan](phases/0-host-skeleton/spec.md#11-implementation-plan) (one unit, `umbel`, private, no route) |
| 2026-10-30 | Design session | Harness channels must negotiate MCP 2025-11-25 or earlier; keep the SDK's compatibility on push paths and re-check watchlist row W15 | Open |
| 2026-10-30 | Design session | Refresh the trajectory watchlist rows before each phase specification, in particular W2 and W3 ahead of 2027-03-30 | Open, recurring; refreshed 2026-10-31 for phase 0 |
| 2026-10-30 | End-to-end review | Write `docs/features` proposals, spec first, for the hybrid tool strategy, for resources, prompts and Skills over MCP in AFD servers reconciled with the Skill Knowledge Layer (shared with Loam, which also needs `ui://` resources), and for per-tool output budgets | Open. Hybrid tool strategy: [proposal](../../../docs/features/active/hybrid-tool-strategy/hybrid-tool-strategy.proposal.md) written and approved 2026-10-31; the other two not started |
| 2026-10-30 | End-to-end review | Reconcile vocabulary and the proposal record with the Agent Engine proposal, whose modules are Umbel's plugins and whose loop overlaps the curator | Open |
| 2026-10-30 | End-to-end review | Over MCP, the Rust approval middleware includes approval tokens by default; Umbel must turn that off on the MCP path. Re-checked 2026-10-31: [#518](https://github.com/lushly-dev/afd/pull/518) closed #460 with the private in-process exchange, and the default on the MCP path is unchanged | Open |
| 2026-10-31 | Owner review | Confirmation `requestState` is bound to the command and input, not the actor; with the context hook admitting several actors, one could replay another's confirmation | Issue [#532](https://github.com/lushly-dev/afd/issues/532); needed before phase 5 |
| 2026-10-31 | Owner review | A panicking command handler hangs the Rust MCP request | Done: fixed in [#539](https://github.com/lushly-dev/afd/pull/539) |
| 2026-10-31 | Phase 0 specification | AFD: let `DirectClient` take the CLI interface, so the Umbel CLI stops checking `expose.cli` itself (D34) | Open |
| 2026-10-31 | Phase 0 specification | AFD: the Rust telemetry middleware, which replaces Umbel's interim one (D33); in the prerequisites table for phase 2 | Open |
| 2026-10-31 | Phase 0 specification | A journal sink failure never changes a command's result; decide whether audited mutations need a fail-closed mode before phase 2 writes records | Open, phase 2 specification |
| 2026-10-31 | Phase 0 specification | Several stdio harnesses on one workspace contend for the writer lock (D29); consider `umbel serve --stdio --proxy <url>` | Open, phase 1 or 7 specification |
| 2026-10-31 | Phase 0 specification | Windows in the `umbel.yml` matrix | Open, phase 7 |
| 2026-10-31 | Phase 0 specification | An external client check, `afd validate` against `umbel serve --http`, in CI | Open, phase 1 |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-10-30 | Design session with the owner | Proposal, research and sources written and merged ([#491](https://github.com/lushly-dev/afd/pull/491)); name decided; diagrams, trajectory watch, trajectory reservations, decisions D13 to D20 and this status file in [#493](https://github.com/lushly-dev/afd/pull/493), merged |
| 2026-10-30 | End-to-end review | Three independent reviews and a verification pass. Moved the area from `umbel/` to `endpoints/umbel/` (D21 supersedes D6). Command names brought into AFD's rule (D22); glossary (D23); phase specification path and approval (D24); AFD-first map and prerequisites table (D25); open decisions numbered O1 to O5. Principal moved onto AFD's actor and credentials; event log defined as a journal projection; candidates moved from the host to the curator; permission filtering moved into the store query; memory classes clarified; Skills given three delivery paths; Open Knowledge Format updated to v0.2; library versions and Rust 1.97 recorded; retrieval figures, SharePoint, Codex, events and authorization claims corrected. #493 had merged at its earlier head, so these went in [#516](https://github.com/lushly-dev/afd/pull/516), merged |
| 2026-10-30 | Design session with the owner | Spaces added at the owner's request: isolated knowledge bases inside one deployment (principle 16, D26), with the three levels of coupling in the architecture's data and content section, per-space phases and glossary entries; O5 narrowed to tenancy beyond spaces. [#516](https://github.com/lushly-dev/afd/pull/516), merged |
| 2026-10-31 | Handoff check | Re-checked every document against `main` before handoff. Pull request states corrected: #493 and #516 merged, and D21 to D26 came in #516. [#518](https://github.com/lushly-dev/afd/pull/518) closed #460 and gave Rust the private in-process approval exchange, so the approval rows now name only the MCP approval relay, which language parity tracks without an issue yet. The rmcp prerequisite was removed: the crate commits no lock, and its 3.7 requirement already resolves 3.8.0. Links, anchors and every D, O, R, W and S reference resolve. [#519](https://github.com/lushly-dev/afd/pull/519) |
| 2026-10-31 | Execution-model decision | The owner decided O2: the hybrid strategy, with code mode later and optional, recorded as D27. O2 references in the proposal, architecture and this file now point at D27; the hybrid prerequisite is required for phase 0. Wrote the AFD [hybrid tool strategy proposal](../../../docs/features/active/hybrid-tool-strategy/hybrid-tool-strategy.proposal.md) with its status file; no `spec/` or code changes. Links and anchors checked. [#522](https://github.com/lushly-dev/afd/pull/522), open |
| 2026-10-31 | Loam cross-review | From the Loam proposal's end-to-end review: corrected the placement rule (D21 consequence, the architecture's repository placement and the follow-up) so Umbel's units join only the release inventory, since `architecture.json` lists foundation families only and endpoint manifests are classified by path; noted on O3 that Loam's app manifest will extend Umbel's; marked the resources prerequisite as shared with Loam; added "surface" to the glossary with Loam's different meaning. Checked and unchanged: D22's registry enforcement holds in Rust (`CommandRegistry::register` rejects invalid names); the architecture's one use of "handoff" is AFD's pattern. Loam keeps Umbel's event field names where the shapes overlap. [#522](https://github.com/lushly-dev/afd/pull/522), open |
| 2026-10-31 | Owner review of the blockers | The owner accepted every recommendation: #523 merged first and #526 rebased onto it; grouped becomes the Rust default; the hybrid proposal approved and moved to `docs/features/active/` with the six answers recorded; issues [#531](https://github.com/lushly-dev/afd/issues/531), [#532](https://github.com/lushly-dev/afd/issues/532) and [#533](https://github.com/lushly-dev/afd/issues/533) filed. [#522](https://github.com/lushly-dev/afd/pull/522) |
| 2026-10-31 | Owner review of the blockers | [#526](https://github.com/lushly-dev/afd/pull/526) rebased onto #523, integrated (structured results and the context hook on every route) and merged as `03815e26`. Of the phase 0 prerequisites, only the hybrid strategy and [#531](https://github.com/lushly-dev/afd/issues/531) remain. [#534](https://github.com/lushly-dev/afd/pull/534) |
| 2026-10-31 | Phase 0 blockers | [#531](https://github.com/lushly-dev/afd/issues/531) fixed in [#539](https://github.com/lushly-dev/afd/pull/539); the hybrid spec merged in [#538](https://github.com/lushly-dev/afd/pull/538). Only the hybrid implementation remains among the AFD prerequisites. [#540](https://github.com/lushly-dev/afd/pull/540) |
| 2026-10-31 | Phase 0 blockers | The hybrid strategy merged in TypeScript, Python and Rust ([#556](https://github.com/lushly-dev/afd/pull/556), [#555](https://github.com/lushly-dev/afd/pull/555), [#560](https://github.com/lushly-dev/afd/pull/560)). Every AFD prerequisite for phase 0 is done; phase 0 now waits only on its specification and the owner's approval (D24). [#562](https://github.com/lushly-dev/afd/pull/562) |
| 2026-10-31 | Phase 0 specification | Wrote the [phase 0 specification](phases/0-host-skeleton/spec.md) at the D24 path: one `umbel` package (library and binary) on the `afd` crate's `server` feature, MSRV 1.97, `umbel.yml`, a quarantined inventory unit with no route; the workspace layout, `umbel.toml` version 1 with spaces and the default space, the writer lock and the doctor; six built-in commands with `workspace-show` and `event-list` first-class under the hybrid strategy; the CLI envelope and exit codes; the context hook and principal version 0; the journal projection, event and cursor version 0, provenance envelope version 0; the tests for the exit criterion and a six-step plan. Decisions D28 to D36, architecture amendments and the trajectory refresh in the same pull request; O3 left open. Spec in review, not approved |
