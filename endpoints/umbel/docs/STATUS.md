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
| [Architecture](architecture.md) | Revised after the 2026-10-30 end-to-end review; the through line | Merged first in [#491](https://github.com/lushly-dev/afd/pull/491); revisions in [#493](https://github.com/lushly-dev/afd/pull/493), open on 2026-10-30 | 2026-10-30: three independent reviews (AFD alignment, coherence, external facts); relative links, fences and diagrams rendered |
| [Proposal](proposal.md) | Approved rationale; the architecture wins where they differ | #491; #493 open | Same as above |
| [Decision log](decisions.md) | D1 to D26; open decisions O1 to O5 | D1 to D12 in #491; D13 to D26 and the O list after #493 | Same as above |
| [Trajectory watch](trajectory.md) | Current as of 2026-10-30; rows carry R and W numbers | #493 | External claims fact-checked against primary sources on 2026-10-30 |
| [Research](research.md), [Sources](sources.md) | Current as of 2026-10-30, with corrected figures | #491; corrections in #493 | Same as above |

## Phases

| Phase | State | Owner | Evidence | Next gate |
| --- | --- | --- | --- | --- |
| AFD prerequisites | Not started | None | None | The phase 0 rows of the architecture's prerequisites table land in AFD, and open decision O2 is decided |
| 0. Host skeleton | Not started | None | None | Specification written and approved by the owner (D24) |
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

- **State:** not started.
- **Done:** nothing.
- **Not done:** every row of the
  [prerequisites table](architecture.md#afd-prerequisites). Phase 0 needs the
  Rust lazy and grouped strategies, meta-tools and AFD contexts (language
  parity D1), Rust structured content and output schemas (#465), a
  per-request context hook on the Rust MCP server, the rmcp 3.8 lock, and, if
  O2 chooses it, the hybrid strategy as an AFD feature.
- **Note:** the hybrid strategy, resources, prompts, the Skills over MCP
  extension and output budgets are AFD-wide features; each needs a
  `docs/features` proposal, spec first, before Rust implements it (D25).

### Phase 0. Host skeleton

- **State:** not started.
- **Done:** nothing.
- **Not done:** everything in the phase 0 row of the architecture.

Phases 1 to 7 have no detail yet; add a heading in this shape when one
starts.

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-10-30 | Design session | Land the phase 0 prerequisites in `packages/rust`; the lazy strategy, meta-tools and contexts are already parity item D1 and #465 is open | Open |
| 2026-10-30 | Design session | Decide the execution model, open decision O2 | Open, owner's decision |
| 2026-10-30 | Design session | Decide the first external integration, open decision O1; it sets the connector contract | Open, owner's decision |
| 2026-10-30 | Design session | When crates land, add `umbel` to the families in `architecture.json` and to the release inventory under `endpoints/umbel/` (D21); units start quarantined | Open |
| 2026-10-30 | Design session | Harness channels must negotiate MCP 2025-11-25 or earlier; keep the SDK's compatibility on push paths and re-check watchlist row W15 | Open |
| 2026-10-30 | Design session | Refresh the trajectory watchlist rows before each phase specification, in particular W2 and W3 ahead of 2027-03-30 | Open, recurring |
| 2026-10-30 | End-to-end review | Write `docs/features` proposals, spec first, for the hybrid tool strategy, for resources, prompts and Skills over MCP in AFD servers reconciled with the Skill Knowledge Layer, and for per-tool output budgets | Open |
| 2026-10-30 | End-to-end review | Reconcile vocabulary and the proposal record with the Agent Engine proposal, whose modules are Umbel's plugins and whose loop overlaps the curator | Open |
| 2026-10-30 | End-to-end review | Over MCP, the Rust approval middleware includes approval tokens by default; Umbel must turn that off on the MCP path, and #460 tracks the private approval exchange in Rust | Open |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-10-30 | Design session with the owner | Proposal, research and sources written and merged ([#491](https://github.com/lushly-dev/afd/pull/491)); name decided; diagrams, trajectory watch, trajectory reservations, decisions D13 to D20 and this status file in [#493](https://github.com/lushly-dev/afd/pull/493), open |
| 2026-10-30 | End-to-end review | Three independent reviews and a verification pass. Moved the area from `umbel/` to `endpoints/umbel/` (D21 supersedes D6). Command names brought into AFD's rule (D22); glossary (D23); phase specification path and approval (D24); AFD-first map and prerequisites table (D25); open decisions numbered O1 to O5. Principal moved onto AFD's actor and credentials; event log defined as a journal projection; candidates moved from the host to the curator; permission filtering moved into the store query; memory classes clarified; Skills given three delivery paths; Open Knowledge Format updated to v0.2; library versions and Rust 1.97 recorded; retrieval figures, SharePoint, Codex, events and authorization claims corrected. Committed locally; #493 had merged at its earlier head, so these go in a new pull request |
| 2026-10-30 | Design session with the owner | Spaces added at the owner's request: isolated knowledge bases inside one deployment (principle 16, D26), with the three levels of coupling in the architecture's data and content section, per-space phases and glossary entries; O5 narrowed to tenancy beyond spaces. Same pull request |
