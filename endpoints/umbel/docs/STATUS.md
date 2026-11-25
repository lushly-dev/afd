# Umbel status

Epic: [#1546](https://github.com/lushly-dev/afd/issues/1546). File new work for this area as its sub-issue.

Read this before anything else in the area, and update it before you end a
session that changed Umbel. It is the source of truth for progress: an agent
should never have to scan the codebase to learn what is current.

This file is the index: the phases, the steps not merged yet, the open follow-ups and the session log since the last archive. What it held to 2026-11-23, the documents table, finished phases' detail, merged step lines, closed follow-ups and the session log, moved verbatim to the archive files [listed at the end](#archive).

## Overview

Where Umbel stands, on one screen, as of 2026-11-23. It sums up the sections below; the [Phases](#phases) table, the step lines and the [decision log](decisions.md) win where they differ.

| Phase | State | Waits for |
| --- | --- | --- |
| 0 to 4 | Done, the last on 2026-11-03 | Nothing |
| [AFD prerequisites](#afd-prerequisites) | Done but MCP prompts, as rechecked 2026-11-23 in its detail | MCP prompts, an open follow-up |
| [5. Auth and hosted](#phase-5-auth-and-hosted) | Specification approved 2026-11-04 | Its exit, after the steps not yet done, in the plan's order |
| [6. Backends](#phase-6-backends) | Specification approved 2026-11-09 | Its steps in the plan's order, beside phase 5's; some wait on phase 5's later steps and its exit |
| 7. Distribution and guides | Not started | Phases 5 and 6's exits |
| [Further first-class plugins](#further-first-class-plugins) | `components` and `ideas` specified and built in plans of their own | Each plugin's own status |

- **Open now:** the steps not merged, one line each under [phase 5](#phase-5-auth-and-hosted) and [phase 6](#phase-6-backends); the [open follow-ups](#follow-ups-not-yet-issues).
- **Owner decisions open:** phase 5's [waiting on the owner](#phase-5-auth-and-hosted) is empty since D203 (2026-11-23). The [decision log](decisions.md#open-decisions) has two open: [O4, the default embedding model for knowledge search](decisions.md#open-decisions) (answered for record lanes by D166 and D167; it gates the optional lanes after phase 2), and [O1, the first external integration](decisions.md#open-decisions) (it gates the federation specification).
- **Where a session writes:** its step's line under [Phase detail](#phase-detail), then a row at the end of its area's tables. Follow-ups: [phase 5](#follow-ups-phase-5-auth-and-hosted), [6](#follow-ups-phase-6-backends), [plugin contract](#follow-ups-the-plugin-contract-worlds-and-the-component-journal), [`components`](#follow-ups-the-components-plugin), [`ideas`](#follow-ups-the-ideas-plugin-and-its-host-records), [every other area](#follow-ups-every-other-area). Session log: [phase 5](#sessions-phase-5-auth-and-hosted), [6](#sessions-phase-6-backends), [plugin contract](#sessions-the-plugin-contract-worlds-and-the-component-journal), [`components`](#sessions-the-components-plugin), [`ideas`](#sessions-the-ideas-plugin-and-its-host-records), [every other area](#sessions-every-other-area). The rules: [How to keep this file](#how-to-keep-this-file). History: [Archive](#archive).

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
- **A step edits its own lines and no others.** Every planned step of a phase
  in progress has one line under its phase's **Steps**, made before the step
  starts: `not started`, `in progress` with the branch or pull request, or
  done or merged with the date and the pull request. A step changes that line,
  adds one row to its area's table in the session log and, if it raises any,
  rows to its area's table in the follow-ups. It edits no other line. A
  first-class plugin's steps are in its own status file or specification.
  A blank line parts the step lines not done yet, because
  git reports a conflict when two branches change adjacent lines.
  A step that reaches the exit also updates its phase's row in the Phases
  table, which names no step as done or next. A specification outside the
  numbered phases (auth profiles, a world, the component journal) keeps its
  steps in its own status block.
- **No sentence or cell says which steps are done, not done, next or latest.**
  Read the step lines: a step can start when it is not started and the steps
  its plan's Order names for it are done. Such a summary is one line every
  step rewrites, so every open branch conflicts on it though nothing
  disagrees. The rows of the Documents and Phases tables are not added to: a
  decision goes in [decisions.md](decisions.md), a step on its own line.
- **A new row goes at the end of its area's table,** never into the table
  that ends 2026-11-18. Two pull requests from different areas then insert at
  different places. Two from the same area still insert at the same place:
  the one that merges second keeps both rows.
- **A line stays within the limit** in `scripts/policy/doc-line-limits.json`,
  which `scripts/check-doc-lines.mjs` enforces. A longer line that was already
  here is listed there and frozen: it may get shorter, never longer. A record
  that needs more room goes in the specification, linked from its line. Git
  history keeps the wording of what was moved or shortened.
- **A frozen line is not edited.** When a frozen follow-up's status changes, add a row to its area's
  table that names the old row by its date and first words and gives the new status. A frozen
  line that has gone stale may lose the stale clause (record its new length and `sha256` in the
  policy); nothing is added to it.
- **Archive, never delete.** When finished phases' detail, merged step lines, closed follow-up
  rows and session-log rows outgrow a few screens, move them, verbatim, to a new
  `STATUS.archive-<year>-<month>-<part>.md` beside this file, each at most about 45 KB so one read
  holds it; list it under Archive, add it to `scripts/policy/doc-line-limits.json` and move any
  policy entry of a moved line with it; a row this file keeps rewritten keeps its cap, and its
  archived original gets the same cap. Check the move: every line this file had, counted with
  repeats, is in the index or an archive. An archived line is not edited.
- **The overview stays one screen and true.** It sums up the Phases table, the open work and the
  owner's open decisions, and names no step as done or next. A change to a phase's row, or to a
  decision the owner has open, changes its line in the overview in the same pull request; where
  they differ, the Phases table, the step lines and the decision log win.

## Documents

What each document's row said, to 2026-11-18, is [archived](STATUS.archive-2026-11-documents.md) with the decision ranges the table listed to D198.

- [Architecture](architecture.md), [Proposal](proposal.md) (the architecture wins where they differ), [Decision log](decisions.md), [Trajectory watch](trajectory.md), [Research](research.md), [Sources](sources.md)
- Phase specifications: [0](phases/0-host-skeleton/spec.md), [1](phases/1-plugin-contract/spec.md) with [world 1.1.0](phases/1-plugin-contract/world-1.1.spec.md) and the [component journal](phases/1-plugin-contract/component-journal.spec.md), [2](phases/2-knowledge/spec.md), [3](phases/3-memory-context/spec.md), [4](phases/4-curator/spec.md), [5](phases/5-auth-hosted/spec.md) with [auth profiles](phases/5-auth-hosted/auth-profiles.spec.md), [6](phases/6-backends/spec.md)
- Plugins: [components](plugins/components/spec.md); [records host](plugins/ideas/host-records.spec.md), [ideas](plugins/ideas/spec.md) and its [review host](plugins/ideas/host-review.spec.md)

## Phases

| Phase | State | Owner | Evidence | Next gate |
| --- | --- | --- | --- | --- |
| AFD prerequisites | Done for phase 0, including step 0 of the phase 0 plan (2026-10-31), and for phases 1 to 5 but MCP prompts (rechecked 2026-11-23 in [the detail](#afd-prerequisites)) | Owner's sessions; step 0 by the phase 0 owning agent | [#523](https://github.com/lushly-dev/afd/pull/523), [#526](https://github.com/lushly-dev/afd/pull/526), [#539](https://github.com/lushly-dev/afd/pull/539), [#538](https://github.com/lushly-dev/afd/pull/538), [#555](https://github.com/lushly-dev/afd/pull/555), [#556](https://github.com/lushly-dev/afd/pull/556) and [#560](https://github.com/lushly-dev/afd/pull/560) and step 0, [#567](https://github.com/lushly-dev/afd/pull/567), merged | Later phases' rows of the prerequisites table, each before the phase that needs it |
| 0. Host skeleton | Done 2026-11-01: exit criterion met | Phase 0 owning agent | [Specification](phases/0-host-skeleton/spec.md) ([#564](https://github.com/lushly-dev/afd/pull/564)); steps [#567](https://github.com/lushly-dev/afd/pull/567), [#570](https://github.com/lushly-dev/afd/pull/570), [#572](https://github.com/lushly-dev/afd/pull/572), [#573](https://github.com/lushly-dev/afd/pull/573), [#574](https://github.com/lushly-dev/afd/pull/574), [#575](https://github.com/lushly-dev/afd/pull/575); exit run [run 41263228249](https://github.com/lushly-dev/afd/actions/runs/41263228249) | None |
| 1. Plugin contract | Done 2026-11-01: exit criterion met; `umbel.yml` [run 41298630706](https://github.com/lushly-dev/afd/actions/runs/41298630706) green on `main` at `886c3b4d` | Phase 1 owning agent | [Specification](phases/1-plugin-contract/spec.md) ([#583](https://github.com/lushly-dev/afd/pull/583), `880779ff`); step 0a: the [AFD proposal](../../../docs/features/complete/mcp-resources-skills/mcp-resources-skills.proposal.md) and [`spec/mcp-resources.md`](../../../spec/mcp-resources.md); step 0b: [#608](https://github.com/lushly-dev/afd/pull/608); step 1: [#606](https://github.com/lushly-dev/afd/pull/606); step 2a: [#610](https://github.com/lushly-dev/afd/pull/610); step 2b: [#612](https://github.com/lushly-dev/afd/pull/612); step 3: [#611](https://github.com/lushly-dev/afd/pull/611); step 5: [#613](https://github.com/lushly-dev/afd/pull/613); step 4: [#620](https://github.com/lushly-dev/afd/pull/620); step 6: [#622](https://github.com/lushly-dev/afd/pull/622); step 7: [#623](https://github.com/lushly-dev/afd/pull/623); step 8: [#624](https://github.com/lushly-dev/afd/pull/624) | None |
| 2. Knowledge | **Done 2026-11-01: exit criterion met**. Each step's pull request is in [the row as it stood](STATUS.archive-2026-11-phases-0-1.md#phases-rows-as-they-stood-on-2026-11-23) | Phase 2 owning agent | [Specification](phases/2-knowledge/spec.md) ([#625](https://github.com/lushly-dev/afd/pull/625)) | None for phase 2. Phases 3, 5 and 6 are unblocked |
| 3. Memory and context | **Done 2026-11-03: exit criterion met** ([phase detail](STATUS.archive-2026-11-phase-3-1.md#phase-3-memory-and-context)). Each step's pull request is in [the row as it stood](STATUS.archive-2026-11-phases-0-1.md#phases-rows-as-they-stood-on-2026-11-23) | Phase 3 owning agent | [Specification](phases/3-memory-context/spec.md) ([#685](https://github.com/lushly-dev/afd/pull/685)) | None for phase 3. Phase 4 is unblocked |
| 4. Curator | **Done 2026-11-03: exit criterion met** ([phase detail](STATUS.archive-2026-11-phase-4-1.md#phase-4-curator)). Each step's pull request is in [the row as it stood](STATUS.archive-2026-11-phases-0-1.md#phases-rows-as-they-stood-on-2026-11-23) | Phase 4 owning agent | [Specification](phases/4-curator/spec.md) ([#749](https://github.com/lushly-dev/afd/pull/749)) | None for phase 4. Phase 7 now needs phases 5 and 6 |
| 5. Auth and hosted | Specification approved 2026-11-04 ([spec](phases/5-auth-hosted/spec.md)), under the owner's 2026-10-31 delegation, with the owner's answers of 2026-11-04, after an independent review and a revision. Each step's state is its line under [phase detail](#phase-5-auth-and-hosted) | Phase 5 owning agent | [Specification](phases/5-auth-hosted/spec.md), on `lush/umbel-phase-5-spec` | Its exit criterion, after the steps not yet done, in the plan's order |
| 6. Backends | Specification written 2026-11-09 ([spec](phases/6-backends/spec.md)) and revised the same day after its independent review; **approved 2026-11-09** with the owner's answers (PostgreSQL first, several servers behind one address in this phase, a 30-day default recovery window). Each step's state is its line under [phase detail](#phase-6-backends). Steps 2 and 4e wait on phase 5's steps 8 to 11 (tasks, usage, `memory-erase`, the erasure sweep), and step 11 on phase 5's exit | Phase 6 owning agent | [Specification](phases/6-backends/spec.md), on `lush/umbel-phase-6-spec-approved` | Its steps in the plan's order, beside phase 5's remaining steps |
| 7. Distribution and guides | Not started | None | None | Phases 5 and 6 exit criteria met (phase 4's was met 2026-11-03) |
| Further first-class plugins | Unblocked 2026-11-01 (phase 2 exit criterion met). `components` and `ideas` are specified and built in steps of their own plans; each one's state is in its own status, linked from [phase detail](#further-first-class-plugins) | `components`: its owning agent. `ideas`: the Ideas plan's owning agent | [Components specification](plugins/components/spec.md); [Ideas plugin specification](plugins/ideas/spec.md) | Each plugin's own, in its status. Others: each gets its own specification (D18, D150) |

## Phase detail

Phases 0 to 4 are done: their detail is archived, with phase 5's detail and merged steps and what the Phases table said of each plugin to 2026-11-18 (see [Archive](#archive)). The AFD prerequisites stay here whole, as their row says some remain; an open phase below keeps the lines a step still edits.

### AFD prerequisites

- **State:** done for phase 0, including the two additions the phase 0
  specification puts in its step 0 (added 2026-10-31); the rows for phases 1
  to 5 remain. Last verified 2026-10-31 against `main` at `57c731d2`; the
  step 0 rows on 2026-10-31 at `045b6feb`.
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
  checks green; `tests/tool_strategies_vectors.rs` runs every case of
  `spec/tool-strategies.json` over stdio and Streamable HTTP in both MCP eras.
  Python ([#555](https://github.com/lushly-dev/afd/pull/555), `51f8d9d8`) and
  TypeScript ([#556](https://github.com/lushly-dev/afd/pull/556), `0d9720a1`)
  landed first. C++ (step 4) waits on its MCP target (parity D2, #341) and
  does not block Umbel. The [hybrid status](../../../docs/features/complete/hybrid-tool-strategy/STATUS.md)
  tracks it.
- **Done:** step 0 of the
  [phase 0 plan](phases/0-host-skeleton/spec.md#step-0-the-afd-pull-request),
  a process-shared mode for the Rust `FileJournalSink` behind the new
  `journal-file-shared` feature (D29) and `DirectClient::with_interface`
  (D34), merged in [#567](https://github.com/lushly-dev/afd/pull/567) as
  `045b6feb` on 2026-10-31 with all nine checks green (Rust fmt, clippy and
  test; Rust docs.rs build; todo conformance for TypeScript and Python, Rust
  and C++; TypeScript on Node 22 and 24; Python 3.11 and 3.12). Run locally
  first: everything `rust.yml` runs, the Rust todo backend's checks with
  `--locked`, and `pnpm check`. The spec needed no amendment.
- **Not done:** the later rows of the
  [prerequisites table](architecture.md#afd-prerequisites): resources,
  prompts and Skills over MCP (phases 1 and 2, shared with Loam), output
  budgets (phase 2; specified in step 0a, implemented in Rust in step 0b),
  the MCP approval relay in Rust (phase 4; done in phase 5 step 0d,
  2026-11-07, with the host-verified mode and `HumanRelay`), token
  verification, `scopes` and `credentials` (phase 5; done in Rust in its step
  0b, 2026-11-07) and the Rust MCP Tasks runtime (phase 5; done in its step
  0e, 2026-11-07).
  [#532](https://github.com/lushly-dev/afd/issues/532) is done (phase 5 step 0c,
  2026-11-07, in TypeScript, Python and Rust).
- **Rechecked 2026-11-23** ([#1803](https://github.com/lushly-dev/afd/issues/1803)): of the rows above only MCP prompts remain, the follow-up of 2026-11-01. Resources and Skills over MCP are done (phase 1's steps 0a and 0b: [`spec/mcp-resources.md`](../../../spec/mcp-resources.md), [#608](https://github.com/lushly-dev/afd/pull/608)), and output budgets are done in every language (2026-11-22, [its status](../../../docs/features/complete/output-budgets/STATUS.md)).
- **Note:** the hybrid strategy, resources, prompts, the Skills over MCP
  extension and output budgets are AFD-wide features; each needs a
  `docs/features` proposal, spec first, before Rust implements it (D25).

### Phase 5. Auth and hosted

- **Detail and merged steps:** [archived 2026-11-23](STATUS.archive-2026-11-phase-5-1.md#phase-5-auth-and-hosted).
- **Steps** ([plan](phases/5-auth-hosted/spec.md#16-implementation-plan); one line each, so parallel pull requests touch different lines):
  - 11, the erasure sweep: not started. It needs step 3, and builds its outbox row into the erasure steps step 10 shares between forget and erase.

  - 12, the exit: not started. It needs every other step.
- **Build notes:** heavy steps follow the plan's build note. Steps 5 to 12 take `umbel-testkit-idp` from
  `[dev-dependencies]`.
- **Waiting on the owner:** nothing (the review of D158 to D188 finished 2026-11-23 in [#2270](https://github.com/lushly-dev/afd/pull/2270), D203). The gateway question was decided 2026-11-09 (a separate direct address), and
  step 5b built it; step 6's rejection reason was settled by the coordinator (the person reads and confirms it).
  A library (embedder) person's `memory-confirm` was settled 2026-11-09 as a technical choice (an assurance method of
  its own, allowed only for the operator), and step 10 built it.
- **Follow-ups:** the [specification's list](phases/5-auth-hosted/spec.md#follow-ups).

### Phase 6. Backends

- **State:** specification approved 2026-11-09; its row in the [Phases](#phases) table and the
  [specification](phases/6-backends/spec.md) carry the rest.
- **Steps** ([plan](phases/6-backends/spec.md#11-implementation-plan); one line each, made before the step starts, so parallel pull requests touch different lines):
  - 1, shapes: not started.

  - 2, traits version 3 and the embedded backend certified: not started.

  - 3, test clusters: not started.

  - 4a, PostgreSQL: connections, roles, migration: not started.

  - 4b, PostgreSQL: encryption and the keyring: not started.

  - 4c, PostgreSQL: documents and graph: not started.

  - 4d, PostgreSQL: index: not started.

  - 4e, PostgreSQL: memory: not started.

  - 4f, PostgreSQL: certified: not started.

  - 5, the host: backends per space: not started.

  - 6, archives: not started.

  - 7, moves: not started.

  - 8, operations: not started.

  - 9, shared deployments: not started.

  - 10, store-held collections: not started.

  - 11, the exit: not started.

### Further first-class plugins

- **What the Phases table gave each plugin to 2026-11-18:** [archived 2026-11-23](STATUS.archive-2026-11-phase-5-2.md#further-first-class-plugins).
- **Where each plugin's steps are:** `components` in the
  [Component Briefs status](../../../docs/features/complete/component-briefs/STATUS.md) and the
  [components specification](plugins/components/spec.md)'s amendments; `ideas` in the
  [Ideas status](../../../docs/features/complete/ideas/STATUS.md). A plugin's step edits those and its
  rows in the session log, not the Phases table.

## Follow-ups not yet issues

A new row goes at the end of its area's table. The last table holds every area's rows raised
to 2026-11-18; a row there is still edited in place when its status changes, unless it is frozen.

### Follow-ups: phase 5, auth and hosted

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |

### Follow-ups: phase 6, backends

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |

### Follow-ups: the plugin contract, worlds and the component journal

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-25 | Compiled-call bound, deadline and SQLite cap ([D204](decisions.md)) | Tasks take compiled-call turns like any call and have no deadline, so one owner's tasks can hold every turn (32 tasks against the default 16) and leave inline calls `HOST_UMBEL_PLUGIN_BUSY`. Decide whether tasks get a share of `limits.compiled_calls` of their own, or a cap per owner | Open |

### Follow-ups: the `components` plugin

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |

### Follow-ups: the `ideas` plugin and its host records

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-23 | The audit of 2026-11-23 ([#1803](https://github.com/lushly-dev/afd/issues/1803)) | Corrects the frozen row of 2026-11-11, "What an `ideas` plugin asks of the host", which leaves P15 to P18 for step A2: P15's host part shipped in steps A3 and H0 to H3 ([#1080](https://github.com/lushly-dev/afd/pull/1080), [#1137](https://github.com/lushly-dev/afd/pull/1137)), P16 and P17 were closed as not planned on 2026-11-22 ([#2012](https://github.com/lushly-dev/afd/issues/2012)) and P18 moved to [#2011](https://github.com/lushly-dev/afd/issues/2011), as the [Ideas status](../../../docs/features/complete/ideas/STATUS.md), now complete, records | Open: P18, as #2011 |
| 2026-11-23 | The audit of 2026-11-23 ([#1803](https://github.com/lushly-dev/afd/issues/1803)) | The local person page (D180) records assurance `local`, which cannot tell a person's click from an agent driving a browser ([the review host specification, 6.5](plugins/ideas/host-review.spec.md#65-what-the-local-page-proves-and-what-turning-it-on-relaxes)); a space admits it to verified content only when its `verified_levels` lists `local`. Carried from the row of 2026-11-12, "The local person page (D180) records assurance `local`", archived since the setting it asked for is built | Open: a limit of the local page, which has no login |

### Follow-ups: every other area

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-23 | The audit of 2026-11-23 ([#1803](https://github.com/lushly-dev/afd/issues/1803)) | A `cursor` adapter profile: read its transcript format and decide whether to push at all, as the [phase 3 specification's follow-ups](phases/3-memory-context/spec.md#follow-ups) say. Carried from the row of 2026-11-02, "`memory-erase` is deferred to phase 5", archived since its other parts are done | Open, when asked |
| 2026-11-24 | Umbel bug sweep ([#2238](https://github.com/lushly-dev/afd/issues/2238)) | Updates the 2026-11-12 row, "The `hybrid_surface` test binary died once with SIGBUS": `Recorder::drop` now closes its channel and joins the `umbel-usage` writer thread before returning | Closed in [#2425](https://github.com/lushly-dev/afd/pull/2425) (#2238) |
| 2026-11-24 | The suggested-command spellings fix ([#2448](https://github.com/lushly-dev/afd/pull/2448), [#2459](https://github.com/lushly-dev/afd/pull/2459)) | The specifications under `docs/` still quote the old spellings the code no longer uses, in their error tables and prose: `umbel store-records-reindex`, `umbel workspace-doctor`, `umbel plugin-show <plugin>` and `umbel store-documents-hold` in [host-records.spec.md](plugins/ideas/host-records.spec.md), `umbel ideas-review-apply --review …`, `umbel ideas-export`, `umbel store-records-reindex` (lines 571 and 1043) and `umbel person-page-serve` (line 1057) in the [Ideas specification](plugins/ideas/spec.md), `umbel plugin-show components` in the [components specification](plugins/components/spec.md), `umbel curator-run --space` and `umbel curator-run` (line 457) in [phase 4's](phases/4-curator/spec.md), and `umbel doctor` in [auth profiles](phases/5-auth-hosted/auth-profiles.spec.md). Left as written, since the code wins; correct them in an amendment row of each specification | Open |
| 2026-11-24 | The suggested-command spellings fix ([#2448](https://github.com/lushly-dev/afd/pull/2448), [#2459](https://github.com/lushly-dev/afd/pull/2459)) | On macOS (Rust 1.100.0, load 70 to 110), `cargo test -p umbel --test it` aborts with SIGABRT and no message while the `plugin_mounted` tests run beside the rest; it did so in all four runs, one of them on `main`'s sources. With `--skip plugin_mounted::` the other 1,076 pass, and `plugin_mounted::` alone passes its 34. It aborted again in full `pnpm verify` runs the same day, and twice when run alone at load 6 to 9; split as above, it passes. Not yet seen on CI's Linux. Tracked in [#2458](https://github.com/lushly-dev/afd/issues/2458) | Open |

### Follow-ups: to 2026-11-18, every area

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-10-30 | Design session | Decide the first external integration, open decision O1; it sets the connector contract | Open, owner's decision |
| 2026-10-30 | Design session | Harness channels must negotiate MCP 2025-11-25 or earlier; keep the SDK's compatibility on push paths and re-check watchlist row W15 | Open |
| 2026-10-30 | Design session | Refresh the trajectory watchlist rows before each phase specification, in particular W2 and W3 ahead of 2027-03-30 | Open, recurring; refreshed 2026-10-31 for phase 0 |
| 2026-10-30 | End-to-end review | Reconcile vocabulary and the proposal record with the Agent Engine proposal, whose modules are Umbel's plugins and whose loop overlaps the curator | Open |
| 2026-10-31 | Phase 0 review | AFD: an accessor for `McpServer`'s default instructions, so a host can add a line without replacing them | Open, AFD, if wanted |
| 2026-10-31 | Phase 0 specification | Windows in the `umbel.yml` matrix (key permissions, file locks, signals) | Partial Windows support, merged in [#1296](https://github.com/lushly-dev/afd/pull/1296) (2026-11-15): hosted trust files are judged by owner and ACL; Windows test and conformance portability is implemented. Independent index opens are coordinated since [#1283](https://github.com/lushly-dev/afd/issues/1283) (2026-11-16 row), and `.managed.json` since [#1463](https://github.com/lushly-dev/afd/issues/1463) (2026-11-17 row). Open: the Windows leg of `umbel.yml` itself, which the owner has not approved; the doctor's `state.keys` and `stores.memory_modes`, still unchecked on Windows; the keys, token and stores the host creates owner-only on Unix get no narrowed ACL on Windows (they inherit their directory's); no Windows test of a console interrupt stopping `serve --http` (the SIGINT and SIGTERM test is Unix-only) |
| 2026-11-01 | Phase 0 step 4 | AFD's Rust schema validation has no `pattern` keyword, so a schema using it is refused at registration and the handler checks the `consumer` pattern itself (spec "Amendments from step 4"); decide whether AFD adds `pattern` across languages (see `spec/validation.md`) | Open |
| 2026-11-01 | Phase 1 review | Operating-system sandboxing for stdio mounts: a stdio child runs as the host's user and can read `state/keys/` and every space (owner decision 2) | Open, a later phase; owner to place |
| 2026-11-01 | Phase 1 specification | A precompiled component cache; wasmtime's `Component::deserialize` is `unsafe`, which the crate forbids | Open, phase 7 or when startup cost is measured |
| 2026-11-01 | Phase 1 specification | A mount's tool snapshot under `state/`, so one-shot CLI calls do not spawn every mounted server | Open, a later phase |
| 2026-11-01 | Phase 1 specification | WIT world 2.0.0 on WASI 0.3 when a wasmtime long-term line supports the async component model (about 60), or the owner decides to leave the long-term line (W17, restated after review) | Open |
| 2026-11-01 | Phase 1 specification | MCP prompts in AFD servers, after the resources and Skills proposal of step 0a | Open, AFD; recorded as the next step of the [proposal](../../../docs/features/complete/mcp-resources-skills/mcp-resources-skills.proposal.md#implementation-plan) on 2026-11-01 |
| 2026-11-01 | Phase 1 specification | The `http` and `secrets` grants, each with a required per-instance `allow` list, and moving an HTTP mount's `bearer_env` under `secrets` | Open, the first plugin that needs outbound calls; `secrets` by phase 5 |
| 2026-11-01 | Phase 1 step 6 | Remove the three `--suppress` rules from `tests/scripts/external-clients.sh`: Umbel's built-in command descriptions need an action verb and 20 characters, `event-list`'s schema is complex, and the todo example's overlap and complexity warnings need a decision | Open, a later phase: step 8 changes nothing under `src/`, where the descriptions and `event-list` live |
| 2026-11-01 | Phase 2 specification | Store grants for components: WIT world `umbel:plugin/plugin@1.1.0` with store imports | Open, the first phase that needs a component reading stores. 2026-11-16: world 1.1.0 carries no store import (D189); store grants for components wait for a later minor version of world 1 and the owner's decision, asked on [#1364](https://github.com/lushly-dev/afd/issues/1364). Answered 2026-11-16 (D192, D193): read-only `documents` and `index` in world 1.2.0 when a component first needs them, tracked in [#1381](https://github.com/lushly-dev/afd/issues/1381); no write grant in protocol 1 |
| 2026-11-01 | Phase 2 specification | Documents as MCP resources (`kb://`) once a permission-filtered listing exists | Open, after phase 5 |
| 2026-11-01 | Phase 2 specification | Restore from `store-backup` | Open, phase 6 |
| 2026-11-01 | Phase 2 specification revision | Measure chunk sizes against S57 (about 250-token chunks with overlap) with the eval harness once its baseline exists | Open, after phase 2 step 9 |
| 2026-11-01 | Phase 2 specification | A per-collection option to block, not only flag, content the write scan matches | Open, when a deployer asks |
| 2026-11-01 | Phase 2 specification | Watching collection roots instead of an explicit `knowledge-refresh` | Open, later |
| 2026-11-01 | Phase 2 step 3 | A snippet is 240 characters; section 8.2's 480 for the detailed form needs a length on `IndexQuery` (C11) | Open, when a deployer asks: step 6 kept 240 characters for both formats ([F5](phases/2-knowledge/spec.md#amendments-from-step-6)) |
| 2026-11-01 | Phase 2 step 4 | `store-check` cannot exclude a trace that is "open" (started, not finished) because the journal appends only finished entries; its 60-second rule is the only exclusion, so a handler that runs longer than a minute and whose store changes are older than that can be reported once as a missing journal entry (a warning, never a failure) | Open, accepted ([amendment D10](phases/2-knowledge/spec.md#amendments-from-step-4)) |
| 2026-11-01 | Phase 2 step 5 | `scripts/affected/suites.mjs` mirrors `umbel.yml` for `pnpm verify` and was not updated for the `knowledge` job's three new crates or the `check` job's matching `--exclude`s, because changing that file scopes every package for `ci.yml` (a full TypeScript run); verify still tests the crates (through `--workspace`) and lints them. Mirror the workflow the next time a pull request touches `suites.mjs` anyway | Open, phase 2 owning agent |
| 2026-11-01 | Phase 2 step 5 | A plugin id cannot hold a hyphen (`^[a-z][a-z0-9]{0,31}$`), so `sources-filesystem` is the plugin `sources` and owns the `sources-` domain; a connector plugin for another system (O1) will need its own domain, or phase 1's grammar will need to separate a plugin's id from its domain | Open, O1 |
| 2026-11-01 | Phase 2 step 4 | The `umbel.yml` `check` and `msrv` jobs now build SQLite and tantivy through the host's default feature; measure their time on the first hosted run and raise or split their timeouts if needed | Open, phase 2 owning agent, after the first hosted run |
| 2026-11-01 | Phase 2 step 6 | `scripts/affected/suites.mjs` mirrors `umbel.yml` for `pnpm verify` and was not updated for the `knowledge` job's new crate or the `check` job's matching `--exclude` (the same reason as step 5); verify still tests and lints the crate through `--workspace`. Mirror the workflow the next time a pull request may rescope `ci.yml` | Open, phase 2 owning agent |
| 2026-11-01 | Phase 2 step 9 | Graph expansion scores a neighbour at 0.3 x its parent's whole score, so link neighbours of a strong match outrank weaker direct matches: nDCG@10 of the exact queries is 0.9368 with expansion and 1.0 without (cross-space 0.8181 against 0.8842), while multi-hop recall goes from 0 to 1 ([Amendments](phases/2-knowledge/spec.md#follow-ups)). A normalised or capped share is a ranking change to try against the baseline in its own pull request | Open, when a deployer asks |
| 2026-11-01 | Phase 2 step 9 | A byte-identical eval report across Linux and macOS is not asserted (tantivy's IDF uses the platform's `ln`); the baseline's 0.02 tolerance absorbs it. Compare the two hosted legs' uploaded reports on the first scheduled macOS run | Open, phase 2 owning agent, after the first scheduled run |
| 2026-11-01 | Shared plugin manifest proposal | The [shared plugin manifest proposal](../../../docs/features/complete/plugin-manifest/plugin-manifest.proposal.md), written for Loam's phase 1, keeps every Umbel manifest key and meaning and needs no Umbel change. Umbel's manifest versions 1 and 2 conform to its core version 1 as they are. It replaces the "Room for Loam" plan (phase 1 specification section 2; D37's consequence) of Loam referencing this schema's `$defs`: `plugin.kind`, `domain`, `command` and `expose` are closed and Umbel-specific. Optional for Umbel: its step 3 (the core vectors in `tests/schemas.rs`; a later manifest version that `$ref`s the core). If Umbel agrees, it annotates D37 and "Room for Loam" to point there. The proposal also covers Umbel instances joining Loam as headless mounted apps, over loopback HTTP with the bearer token or stdio, and needs nothing from Umbel for that. It asks Umbel's owner U1 to U4: CORS for a browser-hosted Loam (recommended no for now; it would amend D32 for preflights), reach beyond loopback before phase 5 (recommended no), a host description or server card, and unifying space with Loam's scope. Owner questions 2 and 5 ask whether Umbel should carry and project `ui`, and accept a multi-member Loam over one principal per transport (D32) | Open, Umbel's choice; this pull request changes no Umbel decision |
| 2026-11-01 | Phase 2 step 7b | A bare nested name in inline code (`apply_step` for `Type::apply_step`) is not a `mentions` edge, only a qualified name or a top-level symbol's name is ([I1](phases/2-knowledge/spec.md#amendments-from-step-7b)); a symbol table that follows the code documents would be needed for the rest | Open, when a deployer asks |
| 2026-11-01 | Phase 2 step 7b | The `knowledge` job gained the `code` feature's tree-sitter build (about 16 CPU seconds) and two legs for the crate without it (clippy and the tests); measure the job on its first hosted run against the 15-minute timeout. `scripts/affected/suites.mjs` does not mirror the two new legs either (see the step 6 row) | Open, phase 2 exit |
| 2026-11-01 | Phase 2 step 7b | Symbols are Rust, Python, TypeScript and JavaScript definitions only (no fields, enum variants, Python module constants, or other languages); each language is a grammar crate and a query file | Open, when a deployer asks |
| 2026-11-11 | Ideas proposal | What an `ideas` plugin asks of the host, each as a general change with a fallback inside the plugin: durable, agent-writable records that carry their standing, which amends principles 8 and 9 and D9 and is read with D98 (P1); indexed plugin records (P2); matching by words and by meaning on the index trait, which builds the embedding lane and answers O4 for spaces of short records (P3); a graph with more than one writer, declared edge kinds and record origins (P4); content identity for documents (P5); shared run and proposal shapes in the SDK (P6); demand signals a plugin can read (P13). It also proposes one hierarchy semantics with vectors, and a Rust engine for it in `foundations/`, shared with Violet (P7), and asks phase 6 to certify a managed PostgreSQL over direct connections (P10). An instance is to run hosted over stateless MCP, on one machine once phase 5 exits. The [Ideas proposal](../../../docs/features/active/ideas/ideas.proposal.md), section 6, has each change with what happens if it is declined. Since the 2026-11-11 revision the list also holds a review on the person page (P15), erasure for a plugin's records (P16), uploads that pass through no model (P17) and guidance from a plugin (P18) | Open. On 2026-11-11 the owner directed that the Ideas plan carry on through its phases and that each change be host work, on the proposal's recommendation (its section 11). P1 is decided as D157 (2026-11-11, step A1), under the owner's direction and not yet read by him, a documents-only change that amends principles 8 and 9 and D9 and is read with D98. Nothing else in Umbel changes until each change is specified here and approved: P2, P3 and P15 to P18 in step A2, the rest in its phase E. P2 and P3 were specified 2026-11-11 in the [records host specification](plugins/ideas/host-records.spec.md) (D158 to D171), under the owner's direction and not yet read by him; P15 to P18 remain for step A2. Progress is in the [Ideas status](../../../docs/features/active/ideas/STATUS.md) |
| 2026-11-11 | Records host specification | The PostgreSQL backend must implement `DocumentStore`'s eleven record-lane methods and pass the suite's `lane`, `standing` and `matching` groups, with terms and key values found by lookup value and text sealed, as phase 6 plans for memory. Phase 6's specification was written before them and is not edited by the records specification. The two also name the same numbers, store traits version 3 (D133, D170) and workspace configuration version 6 (D142, D170): whichever lands second takes the next number and renames its schema file | Open. For the phase 6 owning agent, as an amendment to its specification before the step that certifies PostgreSQL. The [records host specification](plugins/ideas/host-records.spec.md), sections 1, 15.1 and 17. 2026-11-11: step B1 of the records specification takes store traits version 3 and configuration version 6 (`schemas/workspace-config.v6.json`) in its pull request; `main` at `e5de4194` held neither from phase 6, so once that pull request merges, phase 6 is the one that takes the next numbers |
| 2026-11-12 | Records host specification, step B4's review | The `hybrid_surface` test binary died once with SIGBUS (signal 10) during `cargo test --locked --workspace`, after nine of its thirteen tests had passed and with no test failed; it passed three times alone and in the next full run. The crash report shows the `umbel-usage` recorder thread in `usage::recorder::Writer::run` reading the WAL shared-memory mapping of `usage.sqlite3` ("FS pagein error"): most likely the recorder outliving a test's temporary directory, so its mapping's file is gone under it. Raised by step B4's review; not fixed there | Open: whoever next owns the usage recorder or that test, to join the recorder thread before a test's directory is dropped |
| 2026-11-12 | Records host specification, step B4's review | Since the match bound counts a kind's postings whoever wrote them, a principal who may write to a declared kind can push it past 4 000 000 postings and stop matching for every reader of it. Declared kinds have no write quota, and the doctor's `records.size` counts records, not postings | Partially closed 2026-11-23 in step B6 ([#2320](https://github.com/lushly-dev/afd/pull/2320), [#2003](https://github.com/lushly-dev/afd/issues/2003)): `records.size` now warns past both 100 000 records and 4 000 000 postings (`LaneStatus.postings`, A62). Still open: a write quota on declared puts (step A3 or a host step). The same writer can also watch the size and timing of others' writes by padding the kind to the bound (the specification's section 14, after the focused review) |
| 2026-11-12 | Ideas plan, step A3 | The [Ideas plugin specification](plugins/ideas/spec.md) and its [review host specification](plugins/ideas/host-review.spec.md) had one independent review on 2026-11-12, all findings taken | Open: a focused pass on the revision, before steps H0 and C1 |
| 2026-11-12 | Ideas plan, step A3 | `ideas-ask` and `ideas-find` rank by words only even after a meaning lane is served, since the host's ranked find has none | Open: a host change after step B6 |
| 2026-11-12 | Ideas plan, step A3 | Workspace configuration version 7 is taken by D180's `[person]` keys; phase 6's specification also names configuration numbers (D170's renumbering rule) | Open: whichever lands second renumbers |
| 2026-11-17 | Component journal specification | A deployer-chosen journal mode for a mounted tool, the same `[plugins.<id>.journal]` key on a mounted instance | Open, the first deployer who needs it |

## Session log

A session adds its row at the end of its area's table. The rows the log held when it was split
on 2026-11-23 are in the [session archives](#archive), in the tables they were written in.

### Sessions: phase 5, auth and hosted

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-23 | Owner review of D158 to D188 ([#1932](https://github.com/lushly-dev/afd/issues/1932), D201, D203) | In [#2270](https://github.com/lushly-dev/afd/pull/2270). Drafted [review-d158-d188.md](review-d158-d188.md) covering all 28 unread entries (24 owner-judgment, 4 technical) with D157 as context; recorded the owner's 2026-11-23 answers as D203 in [decisions.md](decisions.md) (27 confirmed, D186 amended so `better-auth` ships provisional and `entra` no longer widens host-wide `max_token_lifetime_s`, updating [auth-profiles.spec.md](phases/5-auth-hosted/auth-profiles.spec.md) and clearing unread marks across the four specs); filed D165's write-quota follow-up as [#2342](https://github.com/lushly-dev/afd/issues/2342) under `#1546`; completed phase 5's checkpoint line, releasing steps 11 and 12. Verified 2026-11-23: all 28 IDs, local links/anchors, `check-doc-lines`, `check-portability`, `pnpm verify`, and independent review. Docs only; no Rust built or run. |

### Sessions: phase 6, backends

| Date | Session | What changed |
| --- | --- | --- |

### Sessions: the plugin contract, worlds and the component journal

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-23 | Rust 1.100 and a WASI 0.3 plan ([#1805](https://github.com/lushly-dev/afd/issues/1805)) | `rust-toolchain.toml` moves from 1.98.0 to 1.100.0 with the repository's other pins; `rust-version` stays 1.97. [architecture.md](architecture.md)'s host WIT world entry gains a planned (undecided) note: world 2.0.0 on WASI 0.3 beside the 1.x worlds on 0.2, `wasm32-wasip3` now Tier 2 on the pinned toolchain, and the start still gated on a wasmtime long-term line with the async component model (D38, D39, #1851; wasmtime stays on 48.0.8). Cargo 1.100 moves integration-test binaries from `<target>/debug/deps/` to `<target>/debug/build/<package>/<hash>/out/`, so `tests/support/components.rs` and `mounted.rs` find the target directory from `CARGO_TARGET_TMPDIR` instead of the test binary's path. Components built with 1.100 also import `wasi:clocks/wall-clock` (under the `clock` grant, from the call's context) and report `exit(3)` through WASI's `exit-with-code`, so `plugin_component.rs` pins both and phase 1's specification records them. Verified 2026-11-23 on macOS (`aarch64-apple-darwin`), Rust 1.100.0: umbel.yml's fmt, clippy `-D warnings` (workspace, `wasm32-wasip2`, store crates), the component builds, `cargo test` of the store crates, the todo conformance runs and `external-clients.sh` in `pnpm verify`; the workspace `cargo test` with the target and build directories on one path, 2,729 passed and the 2 above fixed, then `plugin_component` 26 of 26. |
| 2026-11-25 | Compiled-call bound, deadline and SQLite cap ([D204](decisions.md)) | On branch `t3/umbel-call-limits`. A host-wide `CompiledGate` (`src/plugins/compiled_gate.rs`) wraps every handler a compiled plugin registers, SDK, raw handler and finished definition (through AFD's new `CommandDefinition::map_handler`): `limits.compiled_calls` turns (default 16) and, for a call neither a task nor the host's CLI, a deadline (`limits.compiled_timeout_ms`, default 25 000, at most 29 000 so AFD's 30 s MCP timer never answers first). No turn in time: `HOST_UMBEL_PLUGIN_BUSY`, retryable, never ran; cancelled while waiting: `COMMAND_CANCELLED`; started and not finished in time: `OUTCOME_UNKNOWN`; an async handler is then aborted and frees its turn, while an SDK call keeps its turn until its blocking thread returns, is refused later host services, and has its late result logged and dropped. `umbel-store-embedded`'s `ConnectionLimit` (`store.max_connections`, default 32) counts per limit and per thread, covers first opens and settings reads, and answers `STORE_BUSY` past `store.lock_timeout_ms`. Verification is in the pull request |

### Sessions: the `components` plugin

| Date | Session | What changed |
| --- | --- | --- |

### Sessions: the `ideas` plugin and its host records

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-23 | README `public_origin` snippet test ([#2008](https://github.com/lushly-dev/afd/issues/2008), epic [#1546](https://github.com/lushly-dev/afd/issues/1546)) | `first-party/tests/ideas_first_use.rs` opens the Ideas README's "Reading the page from another computer" `[person.local]` table, with `public_origin`, in place of the local instance's: the link the agent gives names the public origin, and the person reads and approves a review through that origin's `Host` and `Origin`. Run with `cargo test -p umbel-first-party --test ideas_first_use` on macOS; the Umbel gate's result is in the pull request |
| 2026-11-23 | Umbel host step B6: records exit, scale timings, query plans and postings check ([#2003](https://github.com/lushly-dev/afd/issues/2003)) | Merged in [#2320](https://github.com/lushly-dev/afd/pull/2320). Added `LaneStatus.postings` and extended doctor `records.size` to warn past both 100 000 records and 4 000 000 postings. Added `tests/records_exit.rs` (MCP HTTP/stdio + CLI end-to-end exit covering put, key/text find, match + standing equality, own-collection attestation and lapse, terminal affirmation, `verified_only` under both `verified_admits`, reindex after declaration change and undeclared edit, and the stub eval gate both ways) and `tests/records_scale.rs` (ignored release 10k/100k benchmark with `testkit` sub-part timings, concurrent writer wait, and 23-statement `EXPLAIN QUERY PLAN`). Query-plan inspection fixed an O(N^2) sort in `reindex_vectors` (`l.id` index pagination + catch-up sweeps: 100k vector backfill 1 336 s -> 9.04 s). Recorded A62–A64, review fixes R50–R58, and macOS release timings (100k: put 4.0 ms words / 6.3 ms with vector, match 1 text 409 ms words / 4.80 s fused, 64 texts 12.5 s words / 19.8 s fused, rebuild 25.5 s words / 34.1 s with vectors, concurrent writer wait 83.6 ms) in [host-records.spec.md](plugins/ideas/host-records.spec.md). Linux CI scale timings (`#[ignore]`) and external phase 0 corpus eval remain outside this run. |

### Sessions: every other area

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-23 | Umbel crate and test layout ([#1774](https://github.com/lushly-dev/afd/issues/1774)) | In [#2357](https://github.com/lushly-dev/afd/pull/2357). Moved `umbel-knowledge` and `umbel-memory` binaries into `first-party/` and `umbel-todo` into `bins/todo/` (`umbel-todo`), removing `umbel` from `[dependencies]` of all three plugin libraries. Consolidated 267 top-level `tests/*.rs` files across 14 crates into one `tests/it/main.rs` per crate (plus `tests/it_logs/main.rs` in `umbel` for the five global-subscriber log-capture modules). Measured `cargo test --locked --workspace --no-run` (fresh `CARGO_TARGET_DIR`, `CARGO_PROFILE_DEV_DEBUG=line-tables-only`, `CARGO_BUILD_JOBS=4`, Windows x64 MSVC, Rust 1.98.0): target dir **47.98 GB -> 7.60 GB (-84.2%)**, test executables **311 -> 58 (-81.4%)**, cold wall time **595.9 s -> 584.7 s**. Because target-dir bloat is already cut by 84.2% without touching `src/`, extracting the hosted stack into a separate crate is deferred. |
| 2026-11-24 | Umbel bug sweep ([#2389](https://github.com/lushly-dev/afd/issues/2389), [#2238](https://github.com/lushly-dev/afd/issues/2238), [#1924](https://github.com/lushly-dev/afd/issues/1924), [#1175](https://github.com/lushly-dev/afd/issues/1175)) | In [#2425](https://github.com/lushly-dev/afd/pull/2425). Fixed `meaning::read_file_bounded` returning `Io(PermissionDenied)` instead of `NotRegularFile` for directories on Windows (#2389); joined the `umbel-usage` writer thread in `Recorder::drop` after closing its channel so the writer cannot touch a workspace's SQLite WAL/SHM files after drop (#2238, also addressing the 2026-11-12 `hybrid_surface` SIGBUS follow-up); updated `tests/support/components.rs` and `mounted.rs` to search `CARGO_TARGET_DIR`, `CARGO_TARGET_TMPDIR`'s parent, and `<workspace>/target` when Cargo's `build.build-dir` is set (#1924); recorded stdout end reason (`StdoutEnd`: EOF, I/O error, line limit) in `LimitedRead` and `ChildWatch::diagnose` (Refs #1175; #1175 stays open pending reproduction of the original macOS flake with diagnostics). |
| 2026-11-24 | Suggested commands spelled as the CLI takes them ([#2448](https://github.com/lushly-dev/afd/pull/2448), [#2459](https://github.com/lushly-dev/afd/pull/2459)) | Error suggestions, warnings, doctor checks, the `ideas-guide` result's `confirmAt.terminal`, two skills, the Ideas README and two descriptions in `workspace-config.v7.json` told the reader to run `umbel store-check`, `umbel workspace-doctor`, `umbel doctor`, `umbel plugin-show <plugin>` or `umbel ideas-review-apply --review …`, which the command line refuses. Each now reads `umbel <domain> <action>` with the command's own input keys (`umbel plugin show plugin=<id>`). New `src/cli/suggested_commands.rs` parses every shipped `umbel …` line outside `docs/` and `tests/` with the binary's parser and requires a command the command line runs and keys from its schema; on the old strings it reports 41. Verification is in the pull request; the `it` binary's SIGABRT under load is the follow-up row above |
| 2026-11-24 | Non-task inline cancellation in `grants::task_guard` ([#2317](https://github.com/lushly-dev/afd/issues/2317)) | In [#2521](https://github.com/lushly-dev/afd/pull/2521). `grants::task_guard` now returns `Refusal::Cancelled` (`COMMAND_CANCELLED`) when `!context.is_task() && context.is_cancelled()`, so timed-out or cancelled inline plugin calls on `spawn_blocking` (including `GuardedWriter::applied`/`replace`/`clear`/`commit` and `CallServices::wasi_line`) stop receiving host services promptly while space-readability revocation (`TASK_SPACE_UNREADABLE`) and `testkit::note_task_service` stay strictly gated on `context.is_task()` and externally cancelled in-flight calls preserve their `CommandResult`. Unit tests in `src/plugins/grants.rs` and `src/plugins/component/wasi.rs` and barrier-synchronized integration tests in `tests/it/grants.rs` added; verification in the pull request. |

## Archive

Moved verbatim on 2026-11-23 ([#1803](https://github.com/lushly-dev/afd/issues/1803)); nothing in them is current.

| File | Holds |
| --- | --- |
| [STATUS.archive-2026-11-phases-0-1.md](STATUS.archive-2026-11-phases-0-1.md) | Phases 0 and 1, and the Phases rows the split shortened |
| [STATUS.archive-2026-11-documents.md](STATUS.archive-2026-11-documents.md) | The Documents table as it stood, and the decision ranges it listed to D198 |
| [STATUS.archive-2026-11-phase-2.md](STATUS.archive-2026-11-phase-2.md) | Phase 2, knowledge |
| [STATUS.archive-2026-11-phase-3-1.md](STATUS.archive-2026-11-phase-3-1.md) | Phase 3, memory and context, with the 2026-11-02 handoff (part 1 of 2) |
| [STATUS.archive-2026-11-phase-3-2.md](STATUS.archive-2026-11-phase-3-2.md) | Phase 3, memory and context, with the 2026-11-02 handoff (part 2 of 2) |
| [STATUS.archive-2026-11-phase-4-1.md](STATUS.archive-2026-11-phase-4-1.md) | Phase 4, the curator (part 1 of 2) |
| [STATUS.archive-2026-11-phase-4-2.md](STATUS.archive-2026-11-phase-4-2.md) | Phase 4, the curator (part 2 of 2) |
| [STATUS.archive-2026-11-phase-5-1.md](STATUS.archive-2026-11-phase-5-1.md) | Phase 5's detail and merged steps, and what the Phases table gave each further plugin to 2026-11-18 (part 1 of 2) |
| [STATUS.archive-2026-11-phase-5-2.md](STATUS.archive-2026-11-phase-5-2.md) | Phase 5's detail and merged steps, and what the Phases table gave each further plugin to 2026-11-18 (part 2 of 2) |
| [STATUS.archive-2026-11-follow-ups.md](STATUS.archive-2026-11-follow-ups.md) | Follow-up rows closed, done, filed, settled or superseded |
| [STATUS.archive-2026-11-sessions-1.md](STATUS.archive-2026-11-sessions-1.md) | The session log to 2026-11-23 (part 1 of 6) |
| [STATUS.archive-2026-11-sessions-2.md](STATUS.archive-2026-11-sessions-2.md) | The session log to 2026-11-23 (part 2 of 6) |
| [STATUS.archive-2026-11-sessions-3.md](STATUS.archive-2026-11-sessions-3.md) | The session log to 2026-11-23 (part 3 of 6) |
| [STATUS.archive-2026-11-sessions-4.md](STATUS.archive-2026-11-sessions-4.md) | The session log to 2026-11-23 (part 4 of 6) |
| [STATUS.archive-2026-11-sessions-5.md](STATUS.archive-2026-11-sessions-5.md) | The session log to 2026-11-23 (part 5 of 6) |
| [STATUS.archive-2026-11-sessions-6.md](STATUS.archive-2026-11-sessions-6.md) | The session log to 2026-11-23 (part 6 of 6) |
