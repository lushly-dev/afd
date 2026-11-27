# Loam status

Epic: [#1541](https://github.com/lushly-dev/afd/issues/1541). File new work for this area as its sub-issue.

Read this before anything else in the area, and update it before you end a
session that changed Loam. It is the source of truth for progress: an agent
should never have to scan the codebase to learn what is current.

This file is the index: the phases, the steps not merged yet, the open follow-ups and the rules of the session log, whose entries are files in [sessions/](sessions/). What it held to 2026-11-23, finished phases' detail, merged step lines, closed follow-ups and the session log, moved verbatim to the archive files [listed at the end](#archive).

## Overview

Where Loam stands, on one screen, as of 2026-11-23. It sums up the sections below; the [Phases](#phases) table, the step lines and the [decision log](decisions.md) win where they differ.

| Phase | State | Waits for |
| --- | --- | --- |
| Design review, 0, 1 and 2 | Done or exited, the last on 2026-11-09 | Nothing |
| [3. Identity](#3-identity) | Exited 2026-11-26, both parts of its exit (10.1): the hosted criterion beside the local one | Nothing |
| [4. Settings, experiments, notifications, overlays](STATUS.archive-2026-11-phases-3-6-1.md#4-settings-experiments-notifications-overlays) | Exited 2026-11-23; the exit is local (D126) | Nothing |
| [5. Bus, copilot and mounted servers](#5-bus-copilot-and-mounted-servers) | Milestone A, the desktop copilot, reached 2026-11-26; specification approved 2026-11-17; three milestones (D141) | Milestone A, the desktop copilot, needs no hosted work; C's prerequisite, phase 3's hosted criterion, is met ([#2770](https://github.com/lushly-dev/afd/pull/2770)); the exit needs A, B and C |
| [6. Hosts and distribution](#6-hosts-and-distribution) | M1, the development profile, reached 2026-11-23 | M3 before M2 (D129); M2 and the exit wait for the hosted lane, which reopens at phase 5's milestone B (D164, D173) |
| 7, 8 and the collaboration service | Not started | Phase 7: phases 4, 5 and 6's exits. Phase 8: phase 7's. The service: phase 6's exit (D46) |

- **Open now:** each open phase's steps not merged, one line each under [5](#5-bus-copilot-and-mounted-servers) and [6](#6-hosts-and-distribution); the [AFD prerequisites](#afd-prerequisites), where phase 5's records for the Agent Engine remain; the [open follow-ups](#follow-ups-not-yet-issues); and the rules of [the frozen hosted lane](#the-frozen-hosted-lane).
- **Owner decisions waiting:** none on the hosted lane: it reopens when phase 5's milestone B is reached (D173), and until then holds phase 6's steps 8 to 10, its exit and phase 7 behind it. Phase 2's questions [open with the owner and not depended on](#2-scope-projects-and-documents): WebRTC from a view (#711), D65's reach, and whether an agent may ever cause a person's unsaved edits to be lost. The decision log's [open decisions](decisions.md#open-decisions) are all closed.
- **Where a session writes:** its step's line under [Phase detail](#phase-detail), its own file in [sessions/](sessions/) ([Session log](#session-log)), and a row at the end of its area's follow-ups table for each follow-up it raises. Follow-ups: [phase 3](#follow-ups-phase-3-identity), [4](#follow-ups-phase-4-settings-experiments-notifications-overlays), [5](#follow-ups-phase-5-bus-copilot-and-mounted-servers), [6](#follow-ups-phase-6-hosts-and-distribution), [every other area](#follow-ups-every-other-area). The rules: [How to keep this file](#how-to-keep-this-file). History: [Archive](#archive).

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
  those blocks; the phase folder holds the detail (decisions D16 and D17).
- **Dates are absolute.** Never "last week".
- **A step edits its own lines and no others.** Every planned step of a phase
  that has started has one line under its phase's **Steps**, made before the
  step starts. Its state is `not started`, `in progress` with the branch or
  pull request, or `merged in #N` with the date; its record follows on that
  line or is linked from it. A step changes that line, adds its own file to the
  session log and, if it raises any, rows to its area's table in the
  follow-ups. It edits no other line.
  A blank line parts the step lines not merged yet, because
  git reports a conflict when two branches change adjacent lines.
  A step that reaches a milestone or the exit also updates its phase's row in
  the Phases table, which says what the phase waits for and names no step as
  done or next.
- **No sentence or cell says which steps are done, not done, next or latest.**
  Read the step lines: a step can start when it is not started and the steps
  its plan's Order names for it are merged or done. Such a summary is one line
  every step rewrites, so every open branch conflicts on it though nothing
  disagrees.
- **A new row goes at the end of its area's table,** never into the table
  that ends 2026-11-18. Two pull requests from different areas then insert at
  different places. Two from the same area still insert at the same place:
  the one that merges second keeps both rows. A session's record is not a row
  but a file of its own, so two sessions never insert at one place ([#2665](https://github.com/lushly-dev/afd/issues/2665)).
- **A line stays within the limit** in `scripts/policy/doc-line-limits.json`,
  which `scripts/check-doc-lines.mjs` enforces. A longer line that was already
  here is listed there and frozen: it may get shorter, never longer. A record
  that needs more room goes in the phase specification, linked from its line.
  Git history keeps the wording of what was moved or shortened.
- **A frozen line is not edited.** When a frozen follow-up's status changes, add a row to its area's
  table that names the old row by its date and first words and gives the new status. A frozen
  line that has gone stale may lose the stale clause (record its new length and `sha256` in the
  policy); nothing is added to it.
- **Archive, never delete.** When finished phases' detail, merged step lines and closed follow-up
  rows outgrow a few screens, move them, verbatim, to a new
  `STATUS.archive-<year>-<month>-<part>.md` beside this file, each at most about 45 KB so one read
  holds it; list it under Archive, add it to `scripts/policy/doc-line-limits.json` and move any
  policy entry of a moved line with it; a row this file keeps rewritten keeps its cap, and its
  archived original gets the same cap. Check the move: every line this file had, counted with
  repeats, is in the index or an archive. An archived line is not edited. A session file is
  not archived: it stays in `sessions/`, and is not edited once its pull request merges.
- **The overview stays one screen and true.** It sums up the Phases table, the open work and the
  owner's open decisions, and names no step as done or next. A change to a phase's row, or to a
  decision the owner has open, changes its line in the overview in the same pull request; where
  they differ, the Phases table, the step lines and the decision log win.

## The frozen hosted lane

The owner froze the hosted lane on 2026-11-21 (D162, D164; [#1930](https://github.com/lushly-dev/afd/issues/1930)), and on 2026-11-26 kept it frozen until phase 5's milestone B is reached (D173). What that means for a session:

- **Phase 6's steps 4 to 7, the development profile (M1), continue to completion.** Steps 8 (M2, the production profile), 9 (the OCI image) and 10 (M4's documents) do not start until the owner reopens the lane. Phase 3's step 10 and phase 5's milestone C need only M1, so the hold does not reach them; phase 6's exit, and phase 7 behind it, wait for the lane to reopen.
- **Fixes that keep the hosted job green are allowed**, whatever caused the break.
- **The lane is `@lushly-dev/loam-host` and the hosted criterion** (`web/test/hosted/`, `web/vitest.hosted.config.ts`, `web/tsconfig.hosted.json`), listed once in `architecture.json`'s `lanes`. `pnpm check:boundaries` refuses an import of the lane from anywhere else, tests included, and any manifest but the web host's devDependency. Phase 3's identity package is not in it: the local Chromium suite's provider-mode tests use its test auth host.
- **For a change, one job builds and tests it:** `loam.yml`'s "Hosted development profile", whose `hosted` gate opens when a lane path changes, one of the lane's `inputs` does (the files outside it that it reads, such as the browser suite's harness and `web/test/mounted/`, which `check:boundaries` holds complete), or something the server imports does (the kernel, the CLI and the theme it reads, identity, an AFD package). A local-path change, such as the chrome, the console, an app or the web host's source, runs only the local jobs. A break that only the built shell causes shows in `loam.yml`'s daily scheduled run (09:17 UTC), which opens every gate as a manual run (`workflow_dispatch`) does, or when the gate next opens; no pull request waits on it. A change's `pnpm check` (`ci.yml`) leaves the lane out, and `pnpm verify --list` plans the same split; a whole-workspace check (a global file such as the root `tsconfig.json`, `check:all`, `ci.yml`'s daily run) and a root `pnpm build` still build it, since no lane job's paths name those files.
- **`local` mode's identity is `LocalAuthAdapter`** (`@lushly-dev/loam-kernel/local-auth`, a subpath, so the kernel-alone bundle stays without the Mock), the Mock's behaviour under its own name: sign-in, the person's id (`mock-user-<email>`), sessions, passkeys and what the session commands answer are unchanged. `MockAuthAdapter` stays in `@lushly-dev/afd-auth` as the test double. Changing local sign-in needs a decision of its own.

## Documents

| Document | State | Evidence | Verified |
| --- | --- | --- | --- |
| [Architecture](architecture.md) | The through line; drafted 2026-10-30 and 2026-10-31, revised after review; the owner read the whole set and approved the direction on 2026-11-01 | [#524](https://github.com/lushly-dev/afd/pull/524), the set and the review fixes | 2026-10-31: three independent reviews (AFD and repository accuracy, cross-document coherence, external facts); every relative link and anchor resolved; portability gate passed |
| [Proposal](proposal.md) | Rationale; the architecture wins where they differ | Same | Same |
| [Decision log](decisions.md) | Every decision, each with its date, who made it and what it amends; any open decision is listed after the log. This cell names none of them, so a new decision edits the log and not this line | Same | Same |
| [Landscape](landscape.md) | Opportunities OP1 to OP12 with dispositions; OP1 to OP8 closed as D39 to D46, OP12 as D47 to D49 | Same | 2026-10-31: primary pages read for the platform, product and standards claims; secondary claims marked |
| [Trajectory watch](trajectory.md) | Current as of 2026-10-31, with rows refreshed by each phase's specification, as each phase's detail records; movements 1 to 8, R1 to R18, W1 to W39 | Same | External claims fact-checked against primary sources on 2026-10-31 |
| [Research](research.md), [Sources](sources.md) | Current as of 2026-10-31; S01 to S79, and S80 to S87 retrieved 2026-11-09 for phase 3, S88 to S97 the same day for phase 6, S98 to S100 on 2026-11-13 for phase 4, S101 to S106 on 2026-11-16 for phase 5 (proposed) | Same | Same |

## Phases

| Phase | State | Owner | Evidence | Next gate |
| --- | --- | --- | --- | --- |
| Design review | Done 2026-11-01 | Owner | This document set; the owner's approval in the session of 2026-11-01 | None |
| AFD prerequisites | Phase 0, 1 and 2 rows done: the shared plugin manifest's step 1 ([`spec/plugin-manifest.md`](../../../spec/plugin-manifest.md), [#677](https://github.com/lushly-dev/afd/pull/677)) and step 2, Loam's profile, with phase 1's exit on 2026-11-02 ([its status](../../../docs/features/complete/plugin-manifest/STATUS.md)). Phase 3's row done ([#934](https://github.com/lushly-dev/afd/pull/934), [#1050](https://github.com/lushly-dev/afd/pull/1050)); phase 5's records for the Agent Engine open; phase 6's handler optional and unused. Rechecked 2026-11-23 ([detail](#afd-prerequisites)) | AFD sessions | [#576](https://github.com/lushly-dev/afd/pull/576) (#527), [#569](https://github.com/lushly-dev/afd/pull/569) (#528), [#581](https://github.com/lushly-dev/afd/pull/581); MCP resources specified in [#588](https://github.com/lushly-dev/afd/pull/588), Rust in [#608](https://github.com/lushly-dev/afd/pull/608), TypeScript in [#615](https://github.com/lushly-dev/afd/pull/615) | Phase 5's row; see the phase detail |
| 0. Kernel, chrome and design foundation | Exited 2026-11-01: E1 to E10 pass in `loam.yml` on `main` ([run 41367284963](https://github.com/lushly-dev/afd/actions/runs/41367284963) at `1405e3c0`) | Phase 0 agent | [Phase 0 specification](phases/0-kernel-chrome/spec.md); follow-ups filed as #655 to #664 | None; phase 1 may start |
| 1. App contract | Exited 2026-11-02: E1 to E13 pass in `loam.yml` on `main` ([run 41452945001](https://github.com/lushly-dev/afd/actions/runs/41452945001) at `d7b8f9fc`), E3 and E4 through a test-only relay | Phase 1 agent | [Phase 1 specification](phases/1-app-contract/spec.md); the [shared plugin manifest proposal](../../../docs/features/complete/plugin-manifest/plugin-manifest.proposal.md), approved 2026-11-01 | None; phases 2 and 3 may start |
| 2. Scope, projects and documents | Exited 2026-11-09: E1 to E14 and D1 to D10 pass in `loam.yml` and `ci.yml` on `main` ([run 42699728786](https://github.com/lushly-dev/afd/actions/runs/42699728786) and [run 42699734639](https://github.com/lushly-dev/afd/actions/runs/42699734639) at `9815022f`; [exit run](STATUS.archive-2026-11-phase-2-2.md#exit-run-2026-11-09)). E5 through a test-only handler, which does not prove identity over MCP or a hosted server; E6 through a test-only relay, which does not prove a hosted server or more than one person | Phase 2 agent | [Scope and projects](phases/2-scope-projects/spec.md) and [documents](phases/2-documents/spec.md) (D35); follow-ups filed as #851 to #889 | None; phase 4 may start, and phase 2's part of phase 5's and the collaboration service's gates is met |
| 3. Identity | **Exited 2026-11-26**: both parts of 10.1 pass in `loam.yml` and `ci.yml` on `main` (runs 45917448362 and 45917451121 at `19db954e`; [exit run](#exit-run-2026-11-26)): the hosted criterion, P3-H1 to P3-H5, on phase 6's development profile with the server's own provider, kernel and relay, beside the local criterion met 2026-11-22 through a test-only auth host and handler. Specification approved by the coordinator 2026-11-09 ([phase 3 specification](phases/3-identity/spec.md)); the owner's questions answered (D95 to D98, D110, D111). Each step's state is its line under [phase detail](#3-identity) | The phase 3 owning agent | [Phase 3 specification](phases/3-identity/spec.md) | Nothing; #852 and #853 close with the exit's record, [#2770](https://github.com/lushly-dev/afd/pull/2770) |
| 4. Settings, experiments, notifications, overlays | **Exited 2026-11-23**: P4-E1 to E17 (E11 withdrawn) pass in `loam.yml` and `ci.yml` on `main` at `b1f08138` ([local exit run](STATUS.archive-2026-11-phases-3-6-1.md#local-exit-run-2026-11-23)); the exit is local (D126). Specification approved 2026-11-13 ([#1139](https://github.com/lushly-dev/afd/pull/1139)); the owner's Q1 to Q5 answered 2026-11-18 (D154 to D158). Each step's state is its line under [phase detail](STATUS.archive-2026-11-phases-3-6-1.md#4-settings-experiments-notifications-overlays) | The phase 4 owning agent | [Phase 4 specification](phases/4-settings/spec.md) | None: phase 4 has exited (D125, D126) |
| 5. Bus, copilot and mounted servers | **Specification approved** by the coordinator 2026-11-17, under the owner's standing grant ([phase 5 specification](phases/5-copilot/spec.md), [#1358](https://github.com/lushly-dev/afd/pull/1358)); the owner answered Q1 to Q7 the same day, each as recommended, so D141 to D152 are decided. The desktop path first, in three milestones (D141): **A, the desktop copilot** (the runtime in the shell, model access through the Rust host, autonomy enforced, labels and taint, a mounted person-only command approved in the shell, fresh-context units, mail as the first consumer); B, the rest of the local criterion; C, the hosted criterion. Eleven jobs as scenarios, a slice of nine; its reviews are recorded in the specification. Each step's state is its line under [phase detail](#5-bus-copilot-and-mounted-servers) | The phase 5 owning agent | [Phase 5 specification](phases/5-copilot/spec.md) | **Milestone A needs no hosted work** (D129): its gates (step 0a's spike, D153's IPC gate before step 2, and step 0c) are recorded in the phase detail and the session log; its critical path is phase 4's steps 6 and 8, and its desktop rows rest on phase 6's step 11; its mail step needs the engine's step F changes; step 9 follows the amendment that gives installing a path with no terminal (D165 to D168). **Milestone C's prerequisites are met** (M1; phase 3, [#2770](https://github.com/lushly-dev/afd/pull/2770)). The exit needs A, B and C; phase 7 waits for it (Q5) |
| 6. Hosts and distribution | **M1, the development profile, reached 2026-11-23** at `4197b2ad` ([M1 exit run](STATUS.archive-2026-11-phases-3-6-2.md#m1-exit-run-2026-11-23)). Specification approved by the coordinator 2026-11-09 ([phase 6 specification](phases/6-hosts/spec.md), [#895](https://github.com/lushly-dev/afd/pull/895)); hosted lane first; the owner's Q1 and Q2 answered on 2026-11-12 (D112, D113). Each step's state is its line under [phase detail](#6-hosts-and-distribution) | The phase 6 owning agent | [Phase 6 specification](phases/6-hosts/spec.md) | M1 reached: phase 3's step 10 and phase 5's milestone C are unblocked; M2 unblocks the collaboration service (D100); the desktop lane and distribution gate nothing before phase 7. Local first (D129, 2026-11-16): M3, with step 12's installers (D134), comes before M2. Step 11b, inbound MCP and the CLI (10.8, D137 to D140), follows step 11 in M3. Steps 8 to 10 are held until phase 5's milestone B (D164, D173) |
| 7. Builder | Not started | None | None | Phases 4, 5 and 6 exit criteria met |
| 8. Guides and the first consumer | Not started | None | None | Phase 7 exit criterion met |
| Collaboration service (unnumbered) | Not started | None | None | Phase 6's exit criterion; phase 2's met 2026-11-09. Its own specification (D46) |

## Phase detail

The design review and phases 0, 1, 2 and 4 are done or exited: their detail is archived, with each open phase's detail and merged steps (see [Archive](#archive)). The AFD prerequisites stay here whole, since some are open; an open phase below keeps the lines a step still edits, and phase 2 the questions still open with the owner.

### AFD prerequisites

- **State:** phase 0 rows done; phase 2 rows done; phase 1, 3 and 5 rows
  partly open. Last verified 2026-11-01 against `main` at `b0782de7`, from
  the AFD status files of the three features.
- **Done:**
  - The browser-safe `@lushly-dev/afd-server/direct` entry with
    `createDirectRegistry`, the journal, replay and the WebCrypto approval
    middleware, under bundle budgets checked in
    `packages/server/src/entry-points.test.ts`
    ([#527](https://github.com/lushly-dev/afd/issues/527), closed by
    [#576](https://github.com/lushly-dev/afd/pull/576)).
  - AFD contexts and the lazy strategy in the direct registry (#527 part 3),
    and `DirectClient` `allow` enforced per routed command
    ([#581](https://github.com/lushly-dev/afd/pull/581)).
  - Declared context fields: the MCP server forwards a declared `_meta`
    key into the command context, and the journal keeps fields declared
    `journal: true` ([#528](https://github.com/lushly-dev/afd/issues/528),
    closed by [#569](https://github.com/lushly-dev/afd/pull/569)); clients
    that cannot set `_meta` can send the meta-tools' `meta` argument
    ([#589](https://github.com/lushly-dev/afd/pull/589)).
  - Loam's kernel refusing badly named commands needs no AFD change: the
    kernel does it (architecture, prerequisites table).
  - Serving MCP resources, the Skills extension, `ui://` resources with
    `_meta.ui` and extra tool `_meta` from the TypeScript server, on `/mcp`
    and stdio in both eras (step 2 of
    [MCP resources and skills](../../../docs/features/complete/mcp-resources-skills/STATUS.md),
    [#615](https://github.com/lushly-dev/afd/pull/615), merged 2026-11-01
    as `c80a9b4d`).
- **Not done:**
  - Phase 1: the shared plugin manifest is approved
    ([proposal](../../../docs/features/complete/plugin-manifest/plugin-manifest.proposal.md),
    [status](../../../docs/features/complete/plugin-manifest/STATUS.md)), and its step 1, the core
    schema and cases in `spec/` ([`spec/plugin-manifest.md`](../../../spec/plugin-manifest.md)),
    landed in [#677](https://github.com/lushly-dev/afd/pull/677). Its step 2, Loam's profile, reader, `app check` and the mounted
    loader's instances, is phase 1 work, proven against a real Umbel instance (D57). It also
    covers Umbel instances as headless apps (step 8, after Umbel's phase 2 and Loam's phase 5).
    The owner decided its questions on 2026-11-01 (D54 to D58).
  - Phase 3: the TypeScript token-verification layer, `scopes` and
    `credentials` (MCP Authorization proposal).
  - Phase 5: agent, delegation, run and session records proposed to the
    Agent Engine. The `apps` exposure flag (D30) is done: phase 5's step 0b,
    [#1591](https://github.com/lushly-dev/afd/pull/1591), in TypeScript and Rust, with Python and C++ parity
    [#1513](https://github.com/lushly-dev/afd/issues/1513).
  - Phase 6, optional: a fetch-style `createMcpHandler`.
  Nothing waits on Rust parity since D25, and the FAST-AF and Violet units
  are consumable from the workspace.
- **Rechecked 2026-11-23** ([#1803](https://github.com/lushly-dev/afd/issues/1803)): phase 1's item is done but its step 8: the shared plugin manifest's step 2 was done with phase 1's exit on 2026-11-02, and step 8 is deferred to [#1208](https://github.com/lushly-dev/afd/issues/1208) ([its status](../../../docs/features/complete/plugin-manifest/STATUS.md)). Phase 3's item is done: the TypeScript resource-server layer, token verification ([#934](https://github.com/lushly-dev/afd/pull/934)), scopes ([#1050](https://github.com/lushly-dev/afd/pull/1050)) and credentials (M1 to M7, [MCP Authorization's status](../../../docs/features/complete/mcp-authorization/STATUS.md)). Phase 5's records for the Agent Engine stay open; phase 6 does not need the handler (its specification, D36), which stays optional.
- **Note:** the shared plugin manifest, the `apps` exposure flag, `_meta`
  forwarding, declared journal fields, and serving MCP Apps resources from
  AFD servers are AFD-wide changes; each that crosses languages needs a
  `docs/features` proposal, spec first, before Loam implements against it
  (D15). Scope itself stays a field Loam adds to the command context (D31).

### 2. Scope, projects and documents

- **Detail and merged steps:** [archived 2026-11-23](STATUS.archive-2026-11-phase-2-1.md#2-scope-projects-and-documents).
- **Open with the owner, and not depended on:** WebRTC from a view (#711), and D65's reach. Phase 2's views are first-party. Whether an agent may ever cause a person's unsaved edits to be lost; as built it may not.

### 3. Identity

- **Detail and merged steps:** [archived 2026-11-23](STATUS.archive-2026-11-phases-3-6-1.md#3-identity).
- **Steps** ([plan](phases/3-identity/spec.md#19-implementation-plan); one line each, made before the step starts, so parallel pull requests touch different lines):
  - 10, the hosted criterion and the exit: merged in [#2744](https://github.com/lushly-dev/afd/pull/2744) (the tests, 2026-11-26) and [#2770](https://github.com/lushly-dev/afd/pull/2770) (the record); **phase 3 exited 2026-11-26**, its open follow-ups filed as #2771 to #2786 ([exit run](#exit-run-2026-11-26), [its record](phases/3-identity/spec.md#status)).
- **Follow-ups:** in the [specification](phases/3-identity/spec.md#follow-ups).

#### Exit run, 2026-11-26

`node scripts/loam-exit-check.mjs 45917448362 45917451121 --phase 3`, against [`loam.yml` run 45917448362](https://github.com/lushly-dev/afd/actions/runs/45917448362) and [`ci.yml` run 45917451121](https://github.com/lushly-dev/afd/actions/runs/45917451121), both `workflow_dispatch` on `main` at `19db954e` (2026-11-26 in Pacific time, as this file's dates are; 2026-11-27 00:33 UTC on GitHub; after [#2744](https://github.com/lushly-dev/afd/pull/2744), step 10's tests), attempt 1, every job a success but `ci.yml`'s `Pull request title`, which a manual dispatch skips by design: the check passes. Each row counts the passing tests with its title in the places section 18 names, at or above `scripts/loam-exit-check.p3.minimums.json`, which this run set (`--print-minimums`). The local rows and E12's phase 2 rows are as the [local exit run](STATUS.archive-2026-11-phases-3-6-1.md#local-exit-run-2026-11-22) recorded them, at counts at or above its minimums (E8's Units 31, E9's Identity path 372 now); the hosted part, in the `Hosted development profile` job's `Hosted criterion against the development profile` step:

| Row | Passing titles |
| --- | --- |
| P3-E8, Hosted | 2: a listed slug's `project-create` over MCP on a team instance is `HUMAN_REQUIRED` (P3-H5(b)); the gated server kernel runs no instance refresh (the gated refresh is the kernel's unit) |
| P3-H1 | 3 |
| P3-H2 | 6 |
| P3-H3 | 4 |
| P3-H4 | 3 |
| P3-H5 | 5 |
| P3-E16 | This check, both parts |

- **Budgets under D115:** first paint 348,354 of 348,800 bytes and 103,882 of 104,050 gzip; the kernel alone 159,786 of 161,600; `late` 149,751 of 150,050; `late-identity` 66,707 of 67,000; `auth` 73,082 of 73,200; `sign-in` 11,903 of 12,300; `account-menu` 5,667 of 6,000; `account` 40,241 of 40,400; the kernel's `apps` chunks 473,988 of 474,500; the chrome's `surfaces` 102,402 of 102,600.
- **Phase 4 unchanged:** on the same runs `--phase 4` passes; its P4-E14 reads phase 3's local rows alone.
- **Before recording it,** both reviewers, Claude Opus 5.5 and GPT-6.2 Astra at `high`, mapped every clause of P3-H1 to P3-H5 to an assertion that can fail, each with `file:line` and why it fails if the clause broke, and both confirmed "approvable as is": Opus on `d59aed4f8`, Astra on `a07648c1d`; #2744's head `9c3b8b08c` is that tree, merged with `main` and folded, with the status line's number.
- **What it does not prove,** and why: the production profile and the image (phase 6's M2, held by D164); three of E17's direct-request clauses and its clauses outside the passkey path, which stay in the local suites (step 10's deviation 5); the hosted server's instance refresh, which it never runs (deviation 2). The rows through the test-only auth host and handler still prove no hosted lane on their own; the hosted rows do.

### 5. Bus, copilot and mounted servers

- **Detail and merged steps:** [archived 2026-11-23](STATUS.archive-2026-11-phases-3-6-2.md#5-bus-copilot-and-mounted-servers).
- **Not done, beyond the steps below:** the amendment that gives the plugin install, its approver token and the model key a path with no terminal, before step 9; the macOS and Linux keychain paths, which no suite exercises.
- **Rechecked 2026-11-23** ([#1803](https://github.com/lushly-dev/afd/issues/1803)): the amendment is written and approved, [no-terminal-install.amendment.md](phases/5-copilot/no-terminal-install.amendment.md) (D165 to D168, 2026-11-22, [#2217](https://github.com/lushly-dev/afd/pull/2217)), and step 9 builds it; the keychain paths stay open.
- **Steps** ([plan](phases/5-copilot/spec.md#19-implementation-plan); one line each, made before the step starts, so parallel pull requests touch different lines):
  - 7, mail on the desktop: merged as [#2495](https://github.com/lushly-dev/afd/pull/2495).

  - 8, milestone A: reached 2026-11-26, the desktop copilot ([its exit run](phases/5-copilot/spec.md#step-8-milestone-a-2026-11-26)); built in [#2619](https://github.com/lushly-dev/afd/pull/2619), [#2621](https://github.com/lushly-dev/afd/pull/2621) and [#2657](https://github.com/lushly-dev/afd/pull/2657).

  - 9, plugin engines, in the parts of [the amendment's 13.3](phases/5-copilot/no-terminal-install.amendment.md#133-implementation-breakdown-for-step-9):
    - 9a, the plugin manifest (`loam-plugin.v1.json`, `readPluginManifest`), `loam plugin check` and `loam plugin pack` for a directory bundle, and the golden projection fixture's CLI half: merged as [#2735](https://github.com/lushly-dev/afd/pull/2735) ([its record](phases/5-copilot/spec.md#step-9a-2026-11-26)).
    - 9a2, `.loam-plugin` archives in `plugin pack` and `plugin check` (4.4's archive rules): merged as [#2754](https://github.com/lushly-dev/afd/pull/2754).
    - 9b, the Rust keychain, the headless materializer and `bearer_keychain` with the pre-bearer proof, in three parts (split 2026-11-26, one reviewable pull request each):
      - 9b1, the headless materializer's core and the golden fixture's Rust half: `desktop-state.json`'s shape and owner-only read, `deployment.json`, `models.json`, `mounts.json` (`bearer_keychain`, `proof_key`) and `frame-src` from it in pure Rust, byte for byte as `loam deployment write`, and the staged write with `desktop-state.json` last: merged as [#2814](https://github.com/lushly-dev/afd/pull/2814) ([its record](phases/5-copilot/spec.md#step-9b1-2026-11-26)).
      - 9b2, `keychain.rs` `write` and `delete` on the three systems with profile-scoped services, and `mounts.rs` resolving `bearer_keychain` with the pre-bearer `/health` proof: merged as [#2860](https://github.com/lushly-dev/afd/pull/2860) ([its record](phases/5-copilot/spec.md#step-9b2-2026-11-27)).
      - 9b3, managed mode wired into startup: mode detection (`managed` vs `cli`, fail-closed `DESKTOP_STATE_PERMISSIONS` / `DESKTOP_STATE_INVALID`), `desktop-state.lock`, orphan sweep and `shell_build_id`/`.loam-bundles` reconciliation, signed shell from `EmbeddedAssets` (`Assets::get`) with in-memory `frame-src` rewriting, and singleton `Mounts`/`Models` behind `RwLock`: merged as [#2875](https://github.com/lushly-dev/afd/pull/2875) ([its record](phases/5-copilot/spec.md#step-9b3-2026-11-27)).
    - 9c, the engine's service lifecycle and pairing core, `loam-desktop plugin`: not started.
    - 9d, the `host-setup` window, `setup_*`, the Models and Plugins screens, P5-S9-1 to P5-S9-7, and the amendment's deferred changes to phases 1 and 6 and D56, D63, D106 and D108: not started.
    - Mail's `loam-plugin.toml`, `pair`, `unpair` and `/health` (in Mail's folder): merged as [#2912](https://github.com/lushly-dev/afd/pull/2912) (2026-11-27; `loam-plugin.toml`, persistent `proofKey` in migration 25, unauthenticated `GET /health?nonce=` `X-Loam-Proof`, and non-interactive `loam-mail pair` / `unpair` stopped and over `/health`-verified `/cli`).

  - 10, the bus (native `calls`, `event-list`, `shell-open`): merged as [#2714](https://github.com/lushly-dev/afd/pull/2714), [#2748](https://github.com/lushly-dev/afd/pull/2748) and [#2768](https://github.com/lushly-dev/afd/pull/2768) ([its record](phases/5-copilot/spec.md#step-10-the-bus-2026-11-26)); `shell-open`'s mounted view renders in main's slot, with P5-B3's Chromium half, merged as [#2897](https://github.com/lushly-dev/afd/pull/2897); the desktop's half is [#2894](https://github.com/lushly-dev/afd/issues/2894).

  - B0b, milestone B's remaining amendment (section 9.5's exact tables, scenarios and P5-B5 onward, before step 11): not started.

  - 11, specialists, delegations, groups, provider swap: not started.

  - 12, agent packs: not started.

  - 13, the console complete, Violet through the console, Health native: not started.

  - 14, runs: not started.

  - 15, the WebMCP projection (optional): not started.

  - C0, milestone C's amendment: not started.

  - 16, shell commands over MCP: not started.

  - 17, the copilot as a `HostModule`: not started.

  - 18, the exit: not started.
- **Follow-ups:** in the [specification](phases/5-copilot/spec.md#follow-ups).

### 6. Hosts and distribution

- **Detail and merged steps:** [archived 2026-11-23](STATUS.archive-2026-11-phases-3-6-2.md#6-hosts-and-distribution).
- **Steps** ([plan](phases/6-hosts/spec.md#20-implementation-plan); one line each, made before the step starts, so parallel pull requests touch different lines):
  - 8, M2, the production profile: not started. Held by D164 until the hosted lane reopens at phase 5's milestone B (D173).

  - 9, the OCI image: not started. Held by D164 until the hosted lane reopens at phase 5's milestone B (D173).

  - 10, M4's documents: not started. Held by D164 until the hosted lane reopens at phase 5's milestone B (D173).

  - 13, the exit: not started.
- **Follow-ups:** in the [specification](phases/6-hosts/spec.md#follow-ups).

Phases 7 and 8 have no detail yet; add a heading in this shape when one
starts.

## Follow-ups not yet issues

A new row goes at the end of its area's table. The last table holds every
area's rows raised to 2026-11-18; a row there is still edited in place when its
status changes.

### Follow-ups: phase 3, identity

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-21 | Phase 3 step 7 | Seven rows dated 2026-11-21 in the [specification's follow-ups](phases/3-identity/spec.md#follow-ups), from the step and its review: three open, four closed in the specification. Rechecked 2026-11-23 ([the row as it stood](STATUS.archive-2026-11-follow-ups.md#follow-up-rows-as-they-stood-on-2026-11-23)) | Open |
| 2026-11-22 | Phase 3 step 9 | A journaled single sign-on result keeps the authorize URL with its `state`, in the [specification's follow-ups](phases/3-identity/spec.md#follow-ups) | Open |
| 2026-11-26 | Phase 3 step 10, the exit | The rows of 2026-11-21 "Seven rows dated 2026-11-21" and 2026-11-22 "A journaled single sign-on result": every open row of the [specification's follow-ups](phases/3-identity/spec.md#follow-ups) filed at the exit as #2771 to #2786, sub-issues of #1541; the agent-member table's row closed by phase 6's step 5 | Filed |

### Follow-ups: phase 4, settings, experiments, notifications, overlays

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-23 | #1673's review (Opus) | A journal written from step 7 to #1673 carries `replaced` only when true, so a server's own bare `{ type: 'object' }` from that window loses its shortcut on replay, and a journaled `keybinding-list` that lists a binding of it diverges; no field tells it from step 6's ([R11](phases/4-settings/spec.md#follow-ups)) | Accepted: fails closed |

### Follow-ups: phase 5, bus, copilot and mounted servers

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-21 | Phase 5 step 3 | A shell command whose own handler refuses (a document of another scope) is asked before its handler runs; run the shell's resource checks before the mode ([phase 5's follow-ups](phases/5-copilot/spec.md#follow-ups)) | Open |
| 2026-11-21 | Phase 5 step 3 | P5-A8's cards and axe in the desktop suite (WebView2, WebKitGTK); step 3 ran them in Chromium only | Done 2026-11-26 by step 8's prep 1 ([its record](phases/5-copilot/spec.md#step-8s-prep-1-2026-11-25)), WebKitGTK and WebView2 |
| 2026-11-22 | Phase 5 step 4 | Attachments stay refused until they are read as the person and given as content that taints (#1508's third item) ([phase 5's follow-ups](phases/5-copilot/spec.md#follow-ups)) | Done 2026-11-24 ([#1508](https://github.com/lushly-dev/afd/issues/1508)) |
| 2026-11-22 | Phase 5 step 4's trust review | An app's activation-client reads are untraced; a replay rebuilds no taint, and a copilot session does not replay yet (after #2056); a tainted session's prompts and toasts are phase 4's paths alone; sources named by title ([phase 5's follow-ups](phases/5-copilot/spec.md#follow-ups)) | Open |
| 2026-11-22 | Phase 5 step 5 | The desktop's `http` mount lane on MCP 2026-07-28 before step 7 (the Rust host sends no 2026-07-28 headers, so an `http` instance releases nothing); `deployment check` cannot see held commands; a replay carries no preview ([phase 5's follow-ups](phases/5-copilot/spec.md#follow-ups)) | The `http` lane done 2026-11-22 ([#2137](https://github.com/lushly-dev/afd/issues/2137)); the other two open |
| 2026-11-22 | #2137 | The Rust host sends no `Mcp-Param-*` header for a tool's `x-mcp-header` arguments; TRACE spans must stay off in the desktop's subscriber, since Tauri records IPC bodies on them; the inbox and card collapse a preview's spaces, and default-ignorable characters show as themselves; a transport made after discovery's deadline is never closed ([phase 5's follow-ups](phases/5-copilot/spec.md#follow-ups)) | Open |
| 2026-11-22 | Phase 5 step 6's trust review | `copilot.turn.units` and the other turn limits as settings; a failed unit's reason on the turn's call; a stored outcome answered again opened as a unit ([phase 5's follow-ups](phases/5-copilot/spec.md#follow-ups)) | Open |
| 2026-11-24 | #1508 (attachments) | Resolving routed app link payload bodies (`kind: 'app'`) without a tool call needs a manifest-declared route-reader hook so the kernel stays app-agnostic (E5) ([phase 5's follow-ups](phases/5-copilot/spec.md#follow-ups)) | Open |
| 2026-11-26 | Phase 5 step 8 | P6-D1's D52 S1 ceiling (p95 50 ms, enforced on Windows) measured 51.4 ms on the milestone A run's first Windows attempt and passed on its re-run; a hosted runner's noise sits at the ceiling, so it can fail a manual exit run with no change | Open |
| 2026-11-26 | #2410 (D175) | A person's `notification-list` keeps a confirmation's preview without `body`, so one past about 32 KiB is refused on the page it starts (`OUTPUT_BUDGET_EXCEEDED`, whose "list without body" suggestion is wrong here), the bell's unread read with it (likely 0), and it stays so after the confirmation ends until it is archived; by id it reads whole. Predates D175, which makes it routine for large reply sets | [#2801](https://github.com/lushly-dev/afd/issues/2801) |

### Follow-ups: phase 6, hosts and distribution

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-21 | Phase 6 step 4 | `startDevHost`'s `resources` and `accessTokenTtlSeconds` need `createLoamAuthOptions` to take a second resource and a test-only token lifetime (P3-H1, P3-H4) | Open, for phase 3's step 10 |
| 2026-11-21 | Phase 6 step 4 | Set section 14's `tools/list` ceiling from the `Hosted development profile` job's logged samples, plus 25%, with the coordinator | Open |
| 2026-11-21 | Phase 6 step 4 | E8's listed-slug `project-create` over MCP on the hosted server, with a team instance's `projects`: possible from step 4, not yet a case | Open, for phase 3's step 10 or phase 6's step 6 |
| 2026-11-22 | Phase 6 step 4 | The `loam-host` bin loads Better Auth through `bootstrap.ts` even for a `local` deployment's `dev`; load it lazily (P6-H1 measures the child, which does not) | Open |
| 2026-11-22 | Phase 6 step 5 | Three rows dated 2026-11-22 in the [specification's follow-ups](phases/6-hosts/spec.md#follow-ups), from the step and its trust review: `agent-member-settle` atomic, a static `provider` boot that is not told its host, and the hook's remover across processes | Open |
| 2026-11-22 | Phase 6 step 6 | Seven rows dated 2026-11-22 in the [specification's follow-ups](phases/6-hosts/spec.md#follow-ups), from the step, its trust review and its merge with phase 5's step 4: four open, a sign-in in the shell does not discover its mounted instances again, the relay's pre-session counts in memory only, one id's cancellation entry shared and apps-only mounted commands refused on the hosted lane; one half done, a forged relay mark on a static lane (`MOUNT_UNAUTHORIZED` joined `KERNEL_ANSWERS` in [#2137](https://github.com/lushly-dev/afd/issues/2137)); and two closed by step 7's prep 2, a cut stream read as a timeout by the page and P6-H6's rows proved by unit only. Rechecked 2026-11-23 ([the row as it stood](STATUS.archive-2026-11-follow-ups.md#follow-up-rows-as-they-stood-on-2026-11-23)) | Open |
| 2026-11-22 | Phase 6 step 11b | Run P6-D4, P6-D6 and P6-D7 on Windows: `inbound.json`'s DACL from `CreateFileW`, the bridge's console in a release build ("visible in a Windows terminal"), and the rename over a stale `inbound.json` a bridge holds open, all type-checked only | Open, for step 12's Windows job |
| 2026-11-22 | Phase 6 step 11b | A mount's notification (`notify::script`) and a model's event (`models::event_script`) are object literals, so a `"__proto__"` key a server sends sets the detail's prototype; deliver them as `JSON.parse` of a string, as `loam:inbound` now is | Open |
| 2026-11-22 | Phase 6 step 11b | `test/macos/inbound.test.ts`'s `[host] inbound = false` case waits five seconds for the host's setup; give it a signal to wait on | Open |
| 2026-11-22 | Phase 6 step 11b | Whether the desktop's inbound results should carry phase 5's 5.1 labels, so an outside agent can tell content from Loam's own claims; taint marks only a copilot session, whose model Loam holds (step 11b's deviation 10) | Open, for phase 5 |
| 2026-11-26 | Phase 3 step 10 | The rows of 2026-11-21 "`startDevHost`'s `resources` and `accessTokenTtlSeconds`" and "E8's listed-slug `project-create` over MCP": `createLoamAuthOptions` takes `otherResources` and `accessTokenSeconds` (tests only), `startDevHost` passes them, and P3-H5(b) is the case ([phase 3's step 10](phases/3-identity/spec.md#status)) | Done in phase 3's step 10 |

### Follow-ups: every other area

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |

### Follow-ups: raised to 2026-11-18, every area

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-10-30 | Design session | Refresh the trajectory watchlist rows before each phase specification, in particular W1, W2 and W6 ahead of phase 1 | Open, recurring; done for phase 1 on 2026-11-01, phase 2 on 2026-11-02 and phase 3 on 2026-11-09 (W12, R10, R14; W31 to W33 added) in their specifications. Kept here as a standing rule, not filed |
| 2026-10-30 | Design session | The Lushly support application is specified in Lushly's repository; record here only the generic shell needs it surfaces, as they appear | Open, recurring. Kept here as a standing rule, not filed |
| 2026-11-10 | Discussion with the owner | The owner plans further first-party apps: deck and video apps for AI-made presentations and videos, and a mail app (the [Mail proposal](../../../docs/features/active/mail/mail.proposal.md)). He also wants Violet's visualization surface, which is separate today, in Loam; the proposal's first-party list already has a `violet` app (mounted, then native views), so confirm whether that app carries it. Each Loam instance chooses which apps it includes. Each new app gets its own specification and joins the first-party list when it has one; confirm in the phase 6 and 7 specifications that a deployment's app list covers apps kept outside `apps/` Corrected 2026-11-10: only mail as one of several proving apps is the owner's decision; the deck and video apps, Violet's surface in Loam and each instance choosing its apps are what he said he plans. | Open  |
| 2026-11-10 | Discussion with the owner | A shell surface for long-running commands (state, cancel, resume) over AFD's [MCP Tasks](../../../docs/features/complete/mcp-tasks/mcp-tasks.proposal.md): mail import, video rendering and deck generation all need it. Progress notifications are not delivered for tasks, so the surface reads a task's state; the proposed [MCP Progress](../../../docs/features/proposed/mcp-progress/mcp-progress.proposal.md) covers commands that are not tasks. No shell service for it is in the proposal, architecture or decision log ([Mail proposal](../../../docs/features/active/mail/mail.proposal.md), L3) Added 2026-11-10: it needs tasks in the TypeScript client, which the MCP Tasks proposal has not reached ([Mail proposal](../../../docs/features/active/mail/mail.proposal.md), A2). | Open; decide its phase  |
| 2026-11-10 | Discussion with the owner | A kit component for reviewing a batch of proposed changes: the shared content once, what differs per item, one approval for the batch, on D41's approval of a plan. Mail's reply sets and deck slide review are the first two users ([Mail proposal](../../../docs/features/active/mail/mail.proposal.md), L4) | Open; decide its phase |
| 2026-11-13 | Phase 3 step 5, final check of #1182 | Four nits: the shell clears the persona title on a same-person settle (`shell.ts:705-713`); the rail renders twice per persona read (`rail-bands.ts:63-66`); the sweep's local halves could keep different project and landing to narrow deviation 10's gap; re-choosing the active persona drops an undo's `appearance` (`persona.ts:519`) | Open; any later phase 3 step |
| 2026-11-16 | The owner's decisions (D131) | **Linking a local Loam to a hosted one.** The local Loam's copilot connects out to the hosted Loam as the person's connected agent (D98), never the hosted one into a laptop (D64, W30). The hosted Loam may send the person a pointer to a hosted resource, never its content, with access checked on opening. Receiving needs a receiver in the local Loam that pulls from the person's hosted inbox (D120) and/or `event-list`, resumes by cursor, writes into the local inbox, labels arrivals as untrusted content (D41), and works with any AFD server that has an inbox. Real push waits on MCP Events (W11); the hosted MCP surface (D104) does not serve the inbox or events yet | Open; a need for the hosted plan, not current work |
| 2026-11-16 | Phase 6 step 11 (the coordinator) | Give `hello-mcp` `afd-help` and `afd-detail` through Umbel's SDK (`serve_mounted`), so P6-D2's `stdio` rows can mount it, as the specification names, instead of the AFD fixture | Open |
| 2026-11-16 | Phase 6 step 11's trust review | On Windows, put each `stdio` mount's child in a job object with kill-on-close, so what it starts dies with it, as the POSIX process group does | Open |
| 2026-11-16 | Phase 6 step 11's trust review | Refuse a bearer sent over plain `http` to a host other than loopback, in `deployment write`, for every host kind | Open |
| 2026-11-16 | Phase 6 step 11's narrow check | On a `loam:` document (the desktop on macOS and Linux), carry the shell's route in the fragment, which every scheme may rewrite, so the shell's own links (the start page, "All projects", the breadcrumb, an embed) stay in the page instead of reloading it, and the address names the state again. A change to the router in first paint, so it waits for first paint's room | Open |
| 2026-11-16 | Phase 6 step 11 (the coordinator, with the owner's go-ahead; widened 2026-11-17) | Measure D52's S1 and the desktop cold start on a real Linux desktop with a GPU (WebKitGTK), before any store change: CI enforces both on Windows alone, because the GPU-less runner straddles both ceilings (S1 p95 34 to 67 ms against 50 over eight runs; cold start 2,180 to 3,173 ms against 2,500), while WebView2 passes with room. Either Linux figure can block the SQLite amendment, which stays open until then | Open |

## Session log

Each session records itself in its own file in [sessions/](sessions/), added by the pull
request that does the work. Two branches add two different paths, so neither git's merge nor the
merge queue's rebase can conflict on the log, as two rows at the end of one table did
([#2665](https://github.com/lushly-dev/afd/issues/2665)). [sessions/README.md](sessions/README.md) gives the file's shape.

- **Name:** `<date>-<branch>.md`, the date absolute and the branch with each `/` as `-`, so the
  folder lists in date order. A branch that records again edits its own file, which keeps its
  first date.
- **Area:** one line, `- Area:` and one of:
  - `phase 3, identity`
  - `phase 4, settings, experiments, notifications, overlays`
  - `phase 5, bus, copilot and mounted servers`
  - `phase 6, hosts and distribution`
  - `every other area`
- **Lines:** each within the limit, as every line here is: `scripts/check-doc-lines.mjs` checks
  every `.md` file in the folder. A record is prose and takes as many lines as it needs.

An area's sessions: `grep -l "^- Area: phase 5" endpoints/loam/docs/sessions/2*.md`. The tables
the log kept to 2026-11-27 are in the [session archives](#archive), in the tables they were
written in.

## Archive

Moved verbatim on 2026-11-23 ([#1803](https://github.com/lushly-dev/afd/issues/1803)), and the last session tables on 2026-11-27 ([#2665](https://github.com/lushly-dev/afd/issues/2665)); nothing in them is current.

| File | Holds |
| --- | --- |
| [STATUS.archive-2026-11-phases-0-1.md](STATUS.archive-2026-11-phases-0-1.md) | The design review, phases 0 and 1, and the Phases and session-log rows the split changed |
| [STATUS.archive-2026-11-phase-2-1.md](STATUS.archive-2026-11-phase-2-1.md) | Phase 2, scope, projects and documents, with its exit run and the 2026-11-02 handoff (part 1 of 2) |
| [STATUS.archive-2026-11-phase-2-2.md](STATUS.archive-2026-11-phase-2-2.md) | Phase 2, scope, projects and documents, with its exit run and the 2026-11-02 handoff (part 2 of 2) |
| [STATUS.archive-2026-11-phases-3-6-1.md](STATUS.archive-2026-11-phases-3-6-1.md) | Phase 4, and phases 3, 5 and 6's detail and merged steps, with the local exit runs (part 1 of 2) |
| [STATUS.archive-2026-11-phases-3-6-2.md](STATUS.archive-2026-11-phases-3-6-2.md) | Phase 4, and phases 3, 5 and 6's detail and merged steps, with the local exit runs (part 2 of 2) |
| [STATUS.archive-2026-11-follow-ups.md](STATUS.archive-2026-11-follow-ups.md) | Follow-up rows closed, done, filed, settled or superseded |
| [STATUS.archive-2026-11-sessions-1.md](STATUS.archive-2026-11-sessions-1.md) | The session log to 2026-11-23 (part 1 of 4) |
| [STATUS.archive-2026-11-sessions-2.md](STATUS.archive-2026-11-sessions-2.md) | The session log to 2026-11-23 (part 2 of 4) |
| [STATUS.archive-2026-11-sessions-3.md](STATUS.archive-2026-11-sessions-3.md) | The session log to 2026-11-23 (part 3 of 4) |
| [STATUS.archive-2026-11-sessions-4.md](STATUS.archive-2026-11-sessions-4.md) | The session log to 2026-11-23 (part 4 of 4) |
| [STATUS.archive-2026-11-sessions-5.md](STATUS.archive-2026-11-sessions-5.md) | The session log from 2026-11-23 to 2026-11-27, its last tables; moved on 2026-11-27 ([#2665](https://github.com/lushly-dev/afd/issues/2665)) |
