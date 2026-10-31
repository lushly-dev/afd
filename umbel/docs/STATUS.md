# Umbel status

Read this before anything else in the area, and update it before you end a
session that changed Umbel. It is the source of truth for progress: an agent
should never have to scan the codebase to learn what is current.

## How to keep this file

- **Say exactly what is done and exactly what is not.** "Done" means merged
  to `main` with evidence linked: a pull request, a commit, a passing check.
  Anything else is "in progress" with what remains spelled out.
- **Record how you verified it**: the command or check, and the date.
- **Write down follow-ups that are not yet issues.** If a future agent must
  know it but nobody owns it yet, it goes in the follow-ups table with a date
  and who raised it. Promote it to an issue when it gets an owner, and link
  the issue here.
- **Never delete history.** Mark an entry superseded and point to what
  replaced it.
- **Every phase specification carries the same block**: state, last verified
  with date and evidence, done, not done, follow-ups. This file aggregates
  those blocks; the phase folder holds the detail.
- **Dates are absolute.** Never "last week".

## Documents

| Document | State | Last changed | Evidence |
| --- | --- | --- | --- |
| [Architecture](architecture.md) | Current. Through line for every phase. Amended 2026-10-30 with diagrams, trajectory reservations and the status convention | 2026-10-30 | [#491](https://github.com/lushly-dev/afd/pull/491), [#493](https://github.com/lushly-dev/afd/pull/493) |
| [Proposal](proposal.md) | Current. Direction approved by the owner 2026-10-30; five decisions still open | 2026-10-30 | #491, #493 |
| [Decision log](decisions.md) | Current. D1 to D20 | 2026-10-30 | #491, #493 |
| [Trajectory watch](trajectory.md) | Current as of 2026-10-30. Refresh the rows a phase depends on before writing its specification | 2026-10-30 | #493 |
| [Research](research.md), [Sources](sources.md) | Current as of 2026-10-30 | 2026-10-30 | #491 |

## Phases

| Phase | State | Owner | Evidence | Next gate |
| --- | --- | --- | --- | --- |
| 0. Host skeleton | Not started | None | None | Specification written and reviewed |
| 1. Plugin contract | Not started | None | None | Phase 0 exit criterion met |
| 2. Knowledge | Not started | None | None | Phase 1 exit criterion met |
| 3. Memory and context | Not started | None | None | Phase 2 exit criterion met |
| 4. Curator | Not started | None | None | Phase 3 exit criterion met |
| 5. Auth and hosted | Not started | None | None | Phase 2 exit criterion met |
| 6. Backends | Not started | None | None | Phase 2 exit criterion met |
| 7. Distribution and guides | Not started | None | None | Phases 4, 5 and 6 exit criteria met |

## Phase detail

### Phase 0. Host skeleton

- **State:** not started.
- **Done:** nothing.
- **Not done:** everything in the phase row of the architecture.
- **Dependencies:** the generic server features the host needs, the lazy
  tool strategy, contexts, resources, prompts and the skills extension, are
  not yet in `packages/rust`; the Rust server implements only the individual
  strategy with tools. They land in the `afd` crate first, so every Rust
  server inherits them.

Phases 1 to 7 have no detail yet; add a heading in this shape when one
starts.

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-10-30 | Design session | Land the lazy strategy, contexts, resources, prompts and the skills extension in `packages/rust` before phase 0; decide whether that is a parity item or its own feature | Open |
| 2026-10-30 | Design session | Decide the execution model: the lazy strategy by default is recommended, with an optional sandboxed code-mode plugin later | Open, owner's decision |
| 2026-10-30 | Design session | Decide the first external integration, a mounted MCP server or a native connector; it sets the connector contract | Open, owner's decision |
| 2026-10-30 | Design session | When crates land, add the `umbel` root to `architecture.json` and the release inventory and classify each crate's layer; units start quarantined | Open |
| 2026-10-30 | Design session | Harness channels still negotiate the 2025 revision; keep the SDK's compatibility on push paths and re-check when Claude Code moves | Open |
| 2026-10-30 | Design session | Refresh the trajectory watchlist rows before each phase specification, in particular MCP Events and the result contract ahead of 2027-03-30 | Open, recurring |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-10-30 | Design session with the owner | Proposal, research and sources written and merged ([#491](https://github.com/lushly-dev/afd/pull/491)); name decided; area created; diagrams, trajectory watch, trajectory reservations in the architecture and decisions D13 to D20, this status file ([#493](https://github.com/lushly-dev/afd/pull/493)) |
