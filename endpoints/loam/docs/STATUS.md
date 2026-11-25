# Loam status

Epic: [#1541](https://github.com/lushly-dev/afd/issues/1541). File new work for this area as its sub-issue.

Read this before anything else in the area, and update it before you end a
session that changed Loam. It is the source of truth for progress: an agent
should never have to scan the codebase to learn what is current.

This file is the index: the phases, the steps not merged yet, the open follow-ups and the session log since the last archive. What it held to 2026-11-23, finished phases' detail, merged step lines, closed follow-ups and the session log, moved verbatim to the archive files [listed at the end](#archive).

## Overview

Where Loam stands, on one screen, as of 2026-11-23. It sums up the sections below; the [Phases](#phases) table, the step lines and the [decision log](decisions.md) win where they differ.

| Phase | State | Waits for |
| --- | --- | --- |
| Design review, 0, 1 and 2 | Done or exited, the last on 2026-11-09 | Nothing |
| [3. Identity](#3-identity) | Local criterion met 2026-11-22 | Its exit: the hosted criterion, P3-H1 to P3-H5, on phase 6's development profile, which M1 reached |
| [4. Settings, experiments, notifications, overlays](STATUS.archive-2026-11-phases-3-6-1.md#4-settings-experiments-notifications-overlays) | Exited 2026-11-23; the exit is local (D126) | Nothing |
| [5. Bus, copilot and mounted servers](#5-bus-copilot-and-mounted-servers) | Specification approved 2026-11-17; three milestones (D141) | Milestone A, the desktop copilot, needs no hosted work; C needs phase 3's hosted criterion; the exit needs A, B and C |
| [6. Hosts and distribution](#6-hosts-and-distribution) | M1, the development profile, reached 2026-11-23 | M3 before M2 (D129); M2 and the exit wait for the owner to reopen the hosted lane (D164) |
| 7, 8 and the collaboration service | Not started | Phase 7: phases 4, 5 and 6's exits. Phase 8: phase 7's. The service: phase 6's exit (D46) |

- **Open now:** each open phase's steps not merged, one line each under [3](#3-identity), [5](#5-bus-copilot-and-mounted-servers) and [6](#6-hosts-and-distribution); the [AFD prerequisites](#afd-prerequisites), where phase 5's records for the Agent Engine remain; the [open follow-ups](#follow-ups-not-yet-issues); and the rules of [the frozen hosted lane](#the-frozen-hosted-lane).
- **Owner decisions waiting:** reopening the hosted lane (D162, D164), which holds phase 6's steps 8 to 10, its exit and phase 7 behind it. Phase 2's questions [open with the owner and not depended on](#2-scope-projects-and-documents): WebRTC from a view (#711), D65's reach, and whether an agent may ever cause a person's unsaved edits to be lost. The decision log's [open decisions](decisions.md#open-decisions) are all closed.
- **Where a session writes:** its step's line under [Phase detail](#phase-detail), then a row at the end of its area's tables. Follow-ups: [phase 3](#follow-ups-phase-3-identity), [4](#follow-ups-phase-4-settings-experiments-notifications-overlays), [5](#follow-ups-phase-5-bus-copilot-and-mounted-servers), [6](#follow-ups-phase-6-hosts-and-distribution), [every other area](#follow-ups-every-other-area). Session log: [phase 3](#sessions-phase-3-identity), [4](#sessions-phase-4-settings-experiments-notifications-overlays), [5](#sessions-phase-5-bus-copilot-and-mounted-servers), [6](#sessions-phase-6-hosts-and-distribution), [every other area](#sessions-every-other-area). The rules: [How to keep this file](#how-to-keep-this-file). History: [Archive](#archive).

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
  line or is linked from it. A step changes that line, adds one row to its
  area's table in the session log and, if it raises any, rows to its area's
  table in the follow-ups. It edits no other line.
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
  the one that merges second keeps both rows.
- **A line stays within the limit** in `scripts/policy/doc-line-limits.json`,
  which `scripts/check-doc-lines.mjs` enforces. A longer line that was already
  here is listed there and frozen: it may get shorter, never longer. A record
  that needs more room goes in the phase specification, linked from its line.
  Git history keeps the wording of what was moved or shortened.
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

## The frozen hosted lane

The owner froze the hosted lane on 2026-11-21 (D162, D164; [#1930](https://github.com/lushly-dev/afd/issues/1930)). What that means for a session:

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
| 3. Identity | **Local criterion met 2026-11-22**: P3-E1 to E20 pass in `loam.yml` and `ci.yml` on `main` (runs 45049749709 and 45049752180 at `31b409fb`; [local exit run](STATUS.archive-2026-11-phases-3-6-1.md#local-exit-run-2026-11-22)), through a test-only auth host and handler, but two P3-E8 cases left to the server. Specification approved by the coordinator 2026-11-09 ([phase 3 specification](phases/3-identity/spec.md)); the owner's questions answered (D95 to D98, D110, D111). Each step's state is its line under [phase detail](#3-identity) | The phase 3 owning agent | [Phase 3 specification](phases/3-identity/spec.md) | The exit: step 10's hosted criterion, P3-H1 to P3-H5, on phase 6's development profile (10.2); #852 and #853 close there |
| 4. Settings, experiments, notifications, overlays | **Exited 2026-11-23**: P4-E1 to E17 (E11 withdrawn) pass in `loam.yml` and `ci.yml` on `main` at `b1f08138` ([local exit run](STATUS.archive-2026-11-phases-3-6-1.md#local-exit-run-2026-11-23)); the exit is local (D126). Specification approved 2026-11-13 ([#1139](https://github.com/lushly-dev/afd/pull/1139)); the owner's Q1 to Q5 answered 2026-11-18 (D154 to D158). Each step's state is its line under [phase detail](STATUS.archive-2026-11-phases-3-6-1.md#4-settings-experiments-notifications-overlays) | The phase 4 owning agent | [Phase 4 specification](phases/4-settings/spec.md) | None: phase 4 has exited (D125, D126) |
| 5. Bus, copilot and mounted servers | **Specification approved** by the coordinator 2026-11-17, under the owner's standing grant ([phase 5 specification](phases/5-copilot/spec.md), [#1358](https://github.com/lushly-dev/afd/pull/1358)); the owner answered Q1 to Q7 the same day, each as recommended, so D141 to D152 are decided. The desktop path first, in three milestones (D141): **A, the desktop copilot** (the runtime in the shell, model access through the Rust host, autonomy enforced, labels and taint, a mounted person-only command approved in the shell, fresh-context units, mail as the first consumer); B, the rest of the local criterion; C, the hosted criterion. Eleven jobs as scenarios, a slice of nine; its reviews are recorded in the specification. Each step's state is its line under [phase detail](#5-bus-copilot-and-mounted-servers) | The phase 5 owning agent | [Phase 5 specification](phases/5-copilot/spec.md) | **Milestone A needs no hosted work** (D129): its gates (step 0a's spike, D153's IPC gate before step 2, and step 0c) are recorded in the phase detail and the session log; its critical path is phase 4's steps 6 and 8, and its desktop rows rest on phase 6's step 11; its mail step needs the engine's step F changes; step 9 follows the amendment that gives installing a path with no terminal (D165 to D168). **Milestone C still needs M1** and phase 3's step 10 (the hosted MCP criterion). The exit needs A, B and C; phase 7 waits for it (Q5) |
| 6. Hosts and distribution | **M1, the development profile, reached 2026-11-23** at `4197b2ad` ([M1 exit run](STATUS.archive-2026-11-phases-3-6-2.md#m1-exit-run-2026-11-23)). Specification approved by the coordinator 2026-11-09 ([phase 6 specification](phases/6-hosts/spec.md), [#895](https://github.com/lushly-dev/afd/pull/895)); hosted lane first; the owner's Q1 and Q2 answered on 2026-11-12 (D112, D113). Each step's state is its line under [phase detail](#6-hosts-and-distribution) | The phase 6 owning agent | [Phase 6 specification](phases/6-hosts/spec.md) | M1 reached: phase 3's step 10 and phase 5's milestone C are unblocked; M2 unblocks the collaboration service (D100); the desktop lane and distribution gate nothing before phase 7. Local first (D129, 2026-11-16): M3, with step 12's installers (D134), comes before M2. Step 11b, inbound MCP and the CLI (10.8, D137 to D140), follows step 11 in M3. Steps 8 to 10 are held (D164) |
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
  - 10, the hosted criterion and the exit: not started. It waits for phase 6's development profile.
- **Follow-ups:** in the [specification](phases/3-identity/spec.md#follow-ups).

### 5. Bus, copilot and mounted servers

- **Detail and merged steps:** [archived 2026-11-23](STATUS.archive-2026-11-phases-3-6-2.md#5-bus-copilot-and-mounted-servers).
- **Not done, beyond the steps below:** the amendment that gives the plugin install, its approver token and the model key a path with no terminal, before step 9; the macOS and Linux keychain paths, which no suite exercises.
- **Rechecked 2026-11-23** ([#1803](https://github.com/lushly-dev/afd/issues/1803)): the amendment is written and approved, [no-terminal-install.amendment.md](phases/5-copilot/no-terminal-install.amendment.md) (D165 to D168, 2026-11-22, [#2217](https://github.com/lushly-dev/afd/pull/2217)), and step 9 builds it; the keychain paths stay open.
- **Steps** ([plan](phases/5-copilot/spec.md#19-implementation-plan); one line each, made before the step starts, so parallel pull requests touch different lines):
  - 7, mail on the desktop: not started.

  - 8, milestone A: not started.

  - 9, plugin engines: not started.

  - 10, the bus (native `calls`, `event-list`, `shell-open`): not started.

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
  - 8, M2, the production profile: not started. Held by D164 until the owner reopens the hosted lane.

  - 9, the OCI image: not started. Held by D164 until the owner reopens the hosted lane.

  - 10, M4's documents: not started. Held by D164 until the owner reopens the hosted lane.

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

### Follow-ups: phase 4, settings, experiments, notifications, overlays

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-23 | #1673's review (Opus) | A journal written from step 7 to #1673 carries `replaced` only when true, so a server's own bare `{ type: 'object' }` from that window loses its shortcut on replay, and a journaled `keybinding-list` that lists a binding of it diverges; no field tells it from step 6's ([R11](phases/4-settings/spec.md#follow-ups)) | Accepted: fails closed |

### Follow-ups: phase 5, bus, copilot and mounted servers

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-21 | Phase 5 step 3 | A shell command whose own handler refuses (a document of another scope) is asked before its handler runs; run the shell's resource checks before the mode ([phase 5's follow-ups](phases/5-copilot/spec.md#follow-ups)) | Open |
| 2026-11-21 | Phase 5 step 3 | P5-A8's cards and axe in the desktop suite (WebView2, WebKitGTK); step 3 ran them in Chromium only | Open |
| 2026-11-22 | Phase 5 step 4 | Attachments stay refused until they are read as the person and given as content that taints (#1508's third item) ([phase 5's follow-ups](phases/5-copilot/spec.md#follow-ups)) | Open |
| 2026-11-22 | Phase 5 step 4's trust review | An app's activation-client reads are untraced; a replay rebuilds no taint, and a copilot session does not replay yet (after #2056); a tainted session's prompts and toasts are phase 4's paths alone; sources named by title ([phase 5's follow-ups](phases/5-copilot/spec.md#follow-ups)) | Open |
| 2026-11-22 | Phase 5 step 5 | The desktop's `http` mount lane on MCP 2026-07-28 before step 7 (the Rust host sends no 2026-07-28 headers, so an `http` instance releases nothing); `deployment check` cannot see held commands; a replay carries no preview ([phase 5's follow-ups](phases/5-copilot/spec.md#follow-ups)) | The `http` lane done 2026-11-22 ([#2137](https://github.com/lushly-dev/afd/issues/2137)); the other two open |
| 2026-11-22 | #2137 | The Rust host sends no `Mcp-Param-*` header for a tool's `x-mcp-header` arguments; TRACE spans must stay off in the desktop's subscriber, since Tauri records IPC bodies on them; the inbox and card collapse a preview's spaces, and default-ignorable characters show as themselves; a transport made after discovery's deadline is never closed ([phase 5's follow-ups](phases/5-copilot/spec.md#follow-ups)) | Open |
| 2026-11-22 | Phase 5 step 6's trust review | `copilot.turn.units` and the other turn limits as settings; a failed unit's reason on the turn's call; a stored outcome answered again opened as a unit ([phase 5's follow-ups](phases/5-copilot/spec.md#follow-ups)) | Open |

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

A session adds its row at the end of its area's table. The rows the log held when it was split
on 2026-11-23 are in the [session archives](#archive), in the tables they were written in.

### Sessions: phase 3, identity

| Date | Session | What changed |
| --- | --- | --- |

### Sessions: phase 4, settings, experiments, notifications, overlays

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-23 | Phase 4 follow-ups (#1672, #1673) | `t3/loam-batch-followups-refined-ui`: a journaled mounted catalog from before step 7 takes a bare `{ type: 'object' }` schema as `replaced`, and discovery always writes the flag (#1673); units for `ensure`'s disposal guards (#1673); a `prompt-settle` nested in a wrapper's input drops its act's `result`, the branch the ninth round removed, restored (#1672); a kernel-level unit for a failed settle write and `lossy` on the claim-release regression (#1672); spec records corrected (R11's omitted schema, F6 in a modal, the auth gate's reason). The auth-gate replay item is [#2253](https://github.com/lushly-dev/afd/issues/2253); first paint is [#2107](https://github.com/lushly-dev/afd/issues/2107). Verified 2026-11-23: `pnpm verify --keep-going` (load timeouts only, each passing alone) and, after merging `origin/main`, `budget`, kernel 1,732 and manifest 1,185 ([#2299](https://github.com/lushly-dev/afd/pull/2299)) |
| 2026-11-23 | Phase 4 follow-up batch (`#2099`, `#2106`, `#2110`) | [#2346](https://github.com/lushly-dev/afd/pull/2346): Added Chromium key-by-key fallback test for an oversized settings section in `web/test/browser/settings.test.ts` (#2099); added sticky toast and `hello-greet` action notice controls to `apps/hello` with Chromium inbox coverage in `inbox.test.ts` (#2106); added `EXPERIMENT_OVERDUE` warning with UTC-day boundary to `checkApp`, `appCheck`, and `loam app check --date` (#2110). No ceiling raised. Verified 2026-11-23: `pnpm verify --keep-going` (21/21 steps on `f1c4cb666`), `check-doc-lines.mjs`, and `budget`. |
| 2026-11-23 | Phase 4 journal replay follow-ups ([#2253](https://github.com/lushly-dev/afd/issues/2253), [#2300](https://github.com/lushly-dev/afd/issues/2300)) | `t3/loam-mail-journal-replay` ([#2345](https://github.com/lushly-dev/afd/pull/2345)): wrapped the kernel auth gate (`principalGate`, `authGate`, stage A auth) in `observeGate` (`journal-provenance.ts`) and persisted `gateRefusal` on `notification-act` so session (`unauthenticated`, `loading`) and hosted `principalGate` refusals replay to `same` and diverge on tamper (#2253); added `observeThrows` (`kernel.ts`) so only thrown `COMMAND_EXECUTION_ERROR` entries are marked `lossy: true, unreplayable: true` (`journal-redact.ts`) while explicit handler refusals stay replayable (#2300). D115 ceilings (`budget.mjs`, `first-paint.test.ts`): `jsMinified` 346,600→347,600 (347,192), `jsGzip` 109,500→109,900 (109,494), `kernelMinified` 161,900→163,300 (162,843). |
| 2026-11-25 | Inject journal wrapper provenance/redaction from `late` ([#2107](https://github.com/lushly-dev/afd/issues/2107)) | `t3/loam-2107-late-provenance`: moved `journal-provenance.ts` and `redactWrapped` out of first paint (`kernel.ts`, 1,500→1,263 lines) into `late/journal-wrappers.ts`, injected through `LateParts.wrappers` while keeping stage-A `redactSafely` fail-closed, `thrownTraces` cleanup, wrapper-name collision guards, and post-rebuild `mcpOptions`. Ceilings (`budget.mjs`, `first-paint.test.ts`, vs `main` `bd30d790b`): lowered `jsMinified` 350,300→346,000 (344,982), `jsGzip` 105,000→103,600 (102,691), `kernelMinified` 164,800→159,000 (158,530); D115 raised `lateMinified` 139,700→144,700 (144,170). Verified 2026-11-25: `check-kernel-domains.mjs`, `check-doc-lines.mjs`, `budget`, kernel units, and `pnpm verify --keep-going`. |

### Sessions: phase 5, bus, copilot and mounted servers

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-22 | Phase 5 step B0 (Bus & Events) | [#2256](https://github.com/lushly-dev/afd/pull/2256): drafted, two-model reviewed (Gemini 4 Neon + GPT-6.2 Astra `high`) and owner-decided the Milestone B Bus & Events amendment ([sections 9.1 to 9.4](phases/5-copilot/spec.md#9-milestone-b-the-bus-and-the-rest-of-the-local-criterion)) for step 10 (`calls` with AFD `expose.apps` / `createAppCallRegistry` retiring `APPS_TWIN`, `event-list` + per-app `event_app` index + atomic durable-journal catch-up + kernel-filtered `onBusEvent`/`eventsChanged` + Mail/Trillium catch-up, `shell-open` + `ResourceLinkV2` + shared `canOpenInboxTarget`, kernel interface 6, manifest v3, T29–T32, P5-B1–P5-B4; Q-B1–Q-B3 approved as D169–D171 in [decisions.md](decisions.md)) and added draft scenarios for jobs 12–13 in `scenarios/milestone-b/`; all blockers from both reviews resolved ([review record](phases/5-copilot/spec.md#review-2026-11-22-b0-bus-and-events)); docs & scenarios only |
| 2026-11-23 | #1539, step 2's follow-up | `t3/loam-batch-followups-refined-ui`: `copilot.test.ts` gives both projection readers (`readProjection`'s `copilotAdmitted`, `readBoot`'s `copilotOf`) a `kind` that is not a string, ids that break the pattern, an array and a `null` entry, and the pattern's 32-character edge; each case fails against a reader with its check removed. Verified 2026-11-23: `copilot.test.ts` 10/10 and manifest 1,185 ([#2299](https://github.com/lushly-dev/afd/pull/2299)) |

### Sessions: phase 6, hosts and distribution

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-23 | [#1655](https://github.com/lushly-dev/afd/issues/1655), desktop `tauri-driver` teardown and session retry | [#2310](https://github.com/lushly-dev/afd/pull/2310): isolated `tauri-driver` in its own process group (POSIX) / tree-kill (Windows), verified driver and `loam-desktop` exit before returning (throwing `DriverTeardownError` if any process survives), reaped tracked drivers on `exit`/`SIGTERM`/`SIGINT`, bounded total startup (`STARTUP_BUDGET_MS` 100 s) with one retry on `POST /session` timeout using a fresh driver and fresh data directory, and restored `SESSION_COMMAND_TIMEOUT_MS` (180 s) via `remoteModifier`. |
| 2026-11-23 | Phase 6 step 12 ([#2202](https://github.com/lushly-dev/afd/pull/2202), [#1462](https://github.com/lushly-dev/afd/issues/1462)) | Desktop installers and updater (10.6, 10.7, 11.3, P6-D5): `tauri-plugin-updater` 2.14.1 in Rust only (off without `LOAM_UPDATER_PUBKEY` and `LOAM_UPDATER_ENDPOINT`, HTTPS-only on feed and download URL, `no_proxy`, `requireSignedVersion: true`, zero `updater:*` JS permissions), `@tauri-apps/cli` 2.12.4 and desktop icons, `build:installers` staging unsigned installers + `SHA256SUMS.txt` + size JSON, `test:installers` (P6-D5 HTTPS update install & refusal suite), and `Desktop on Windows` + installer steps/uploads in `loam-desktop.yml` (`WORKFLOWS.desktop.jobs` and `suites.mjs` updated). Verified on Windows 11 (Node 26.13.1): `Loam_0.1.0_x64_en-US.msi` (6.55 MiB) built and hashed, P6-D5 3/3 passed (real `ShellExecuteW` install), Rust fmt/clippy/test 72/72 passed, `test:tooling` 938/938 passed; Linux/macOS installers and Windows WebDriver suite left to CI (`loam-desktop.yml`). [Its record](phases/6-hosts/spec.md#status) |
| 2026-11-23 | [#1930](https://github.com/lushly-dev/afd/issues/1930), the hosted lane frozen (D162, D164) | [#2287](https://github.com/lushly-dev/afd/pull/2287): `architecture.json`'s `lanes` lists the hosted lane once; `check:boundaries` refuses an import of it from outside, and `scripts/affected` gives a lane's paths to its packages alone, stops a lane package's change at the lane and leaves the lane out of `pnpm check`. `loam.yml`'s local jobs leave out `loam-host`, and its hosted job alone builds, typechecks and tests it, gated by `--lane loam-hosted`. The copilot frame's policy moved to `@lushly-dev/loam-cli/frame-policy`; `local` mode constructs `LocalAuthAdapter`. See [the frozen hosted lane](#the-frozen-hosted-lane) |
| 2026-11-23 | Rust 1.100 and Tauri 2.12.7 ([#1805](https://github.com/lushly-dev/afd/issues/1805)) | The desktop crate's `rust-toolchain.toml` and the mail engine's move from 1.98.0 to 1.100.0 with the repository's other pins; `rust-version` stays 1.98, a floor, not a pin. `tauri` `=2.12.5` to `=2.12.7` and `tauri-build` `=2.7.4` to `=2.7.6` (both 2026-11-18): 2.12.6 fixes a deadlock when an event is emitted off the main thread with the `tracing` feature Loam enables, and 2.12.7 serves `.js`, `.css` and `.svg` by extension, not sniffed content. `Webview::on_message` is unchanged, so `tests/acl.rs`'s exemption list holds. The mail engine's two new clippy findings (an `if` returning a bool literal in `is_allowed_https_url`, an unreachable `match` on `Infallible` in the IMAP double) are rewritten without changing behaviour. No `@tauri-apps` npm package is in the workspace. Verified 2026-11-23 on macOS (`aarch64-apple-darwin`), Rust 1.100.0, in `pnpm verify`: `loam-desktop.yml`'s and `loam-plugins.yml`'s suites (fmt, clippy `-D warnings` with and without `test-doubles`, `cargo test`, `cargo build`, so `tests/acl.rs`) passed; the Loam package and app tests timed out under other sessions' load and passed on a rerun, `test/capabilities.test.ts` with them. |
| 2026-11-23 | Phase 6 step 7, M1 ([#2065](https://github.com/lushly-dev/afd/issues/2065)) | The development profile reached: `--phase 6 --milestone m1` in the exit check's `PHASES` table, "Units" split into its `loam` job and hosted job halves after D162, `loam-exit-check.p6.minimums.json` set from runs 45289167638 and 45289171400 at `4197b2ad`, attempt 1, after prep 4 ([#2359](https://github.com/lushly-dev/afd/pull/2359)) closed the clauses the review found unasserted. Phase 3's step 10 and phase 5's milestone C unblocked. [M1 exit run](STATUS.archive-2026-11-phases-3-6-2.md#m1-exit-run-2026-11-23) |
| 2026-11-24 | `afd-cli` OAuth 2.1 client ([#912](https://github.com/lushly-dev/afd/issues/912)) | `t3/cli-oauth-client` ([#2528](https://github.com/lushly-dev/afd/pull/2528)): specified M9 in [`spec/authorization.md`](../../../spec/authorization.md) with language-neutral client vectors in `spec/authorization-client.json` and capability `mcp.auth.cli-client`; implemented OAuth 2.1 PKCE (S256) with RFC 9728 / RFC 8414 / OIDC discovery, CIMD (`https://afd.dev/oauth/cli-client.json`) and pre-registered confidential/public clients, RFC 8707 `resource`, RFC 9207 `iss`, loopback `127.0.0.1` callback, separate owner-only `tokens.json` store with automatic refresh/rotation and `--header`/`AFD_HEADERS` override, `afd auth` (`login`, `status`, `refresh`, `logout`), and strict redaction; Python CLI parity filed as [#2491](https://github.com/lushly-dev/afd/issues/2491). Hosted lane stays frozen under D164. |
| 2026-11-25 | Desktop security hardening (D54, D168, macOS keychain) | [#2601](https://github.com/lushly-dev/afd/pull/2601) (`t3/loam-desktop-security`): enforced a fixed desktop CSP ceiling and HTML5 head-scoped `<meta>` parser in `site.rs` (`desktop_shell_policy`, refusing widened/unknown/duplicate/non-head `<meta>` with `404` and emitting a Rust-constructed canonical header) and amended D168 / step 9b so `managed` mode serves signed shell files from `EmbeddedAssets`; extracted `src-tauri/src/keychain.rs` and switched macOS lookup to native `Security.framework` ordered search-list + `apple-native-keyring-store = "=1.0.2"` / `keyring-core = "=1.0.1"` fallback, and hardened `loam-cli` `copilot-key.ts` on macOS (4,094-byte line cap, stderr check, read-back verification); centralized boot-time `__TAURI_INTERNALS__.invoke` capture in `web/src/desktop-ipc.ts` (preserving `null` when absent at boot) and amended D54, `architecture.md`, and step 9d consent disclosure for `native` apps. |

### Sessions: every other area

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-23 | D115's end and first contentful paint's ceiling ([#1929](https://github.com/lushly-dev/afd/issues/1929), part) | `budget` runs `ceiling-raises`, which, once `D115_ENDS_ON` in `web/scripts/ceiling-amendments.mjs` holds the date D161 records, fails a ceiling raised, added or removed without its amendment, reason and approval (phase 0's 8.1, phase 2's 2.4, phase 3's 13); inert while the date is unset. E1's throttled first contentful paint is asserted at 1,275 ms in `loam.yml`'s Chromium job ([phase 2's 2.5](phases/2-scope-projects/spec.md#25-first-contentful-paints-ceiling-d161)). The date is proposed to the owner in the pull request; D161 records it when the owner names it |
| 2026-11-23 | Firefox and WebKit suites ([#706](https://github.com/lushly-dev/afd/issues/706), [#2311](https://github.com/lushly-dev/afd/pull/2311)) | `loam.yml` gains `Firefox suites` (Linux) and `WebKit suites` (macOS: Playwright's Linux WebKit, the GTK port, has no scoped registries), running E1 (the mount and its scoped registry), E2 (the sandboxed view) and phase 4's I8 chord through `vitest.engines.config.ts` (`test:firefox`, `test:webkit`); `pnpm verify` runs them too. Firefox 157.0 and WebKit 27.2: 6.1 holds in both, WebRTC is reachable in both, and both pages handle `Mod+Alt+P` (whether a desktop browser keeps it first is [#2268](https://github.com/lushly-dev/afd/issues/2268)); the per-engine results, the GTK port's among them, are in the phase 1 specification's [9.7](phases/1-app-contract/spec.md#97-decided-by-step-5), and E2 now tests what renders rather than Chromium's error URL. D34's polyfill branch fails ([#2254](https://github.com/lushly-dev/afd/issues/2254), an owner decision): native apps do not work in a Firefox before 159 or Playwright's GTK build (the desktop's WebKitGTK unmeasured). Linux WebKit's chord is [#2314](https://github.com/lushly-dev/afd/issues/2314); the forced-colors title bar fails axe in Firefox and the GTK port, [#2255](https://github.com/lushly-dev/afd/issues/2255), pinned exactly in E2 |
| 2026-11-23 | Loam bug batch ([#2179](https://github.com/lushly-dev/afd/issues/2179), [#2119](https://github.com/lushly-dev/afd/issues/2119), [#2118](https://github.com/lushly-dev/afd/issues/2118), [#2016](https://github.com/lushly-dev/afd/issues/2016), [#1952](https://github.com/lushly-dev/afd/issues/1952)) | `ui.menus`' refusal names its deferral (#2095); a replay runs a notice's action again under its own trace and tape, and a recorded copilot call runs its gates again with the taint it journaled; the `inputBytes` refusal unit and P4-E1's scope-change test wait for what they read. Records in [phase 4's follow-ups](phases/4-settings/spec.md#follow-ups). Budgets raised under D115 (`budget.mjs`): the kernel alone 159,600 to 161,900 (measured 161,391 with `main` at `b868f8c1`); `apps` 474,000 to 474,500 (474,014). Verified 2026-11-23: `pnpm verify` |
| 2026-11-23 | Refined in the console and apps ([#1485](https://github.com/lushly-dev/afd/issues/1485), [#1486](https://github.com/lushly-dev/afd/issues/1486)) | Cards lose their drawn edge (the console's notice and output, hello's and tally's `x-card`, notes' picker: surface step, `shadow.card`, `radius.lg`); the console's failure and notes' conflict keep their state border, their only edge in high contrast. Checklist's editor and hello's page draw their native field as a well and their button as a key, on tokens. A view's frame gets the shell's faces: `styles.css.fonts` with each file inline as `data:`, `font-src data:` added to the frame's policy (D62 amended; [phase 1's 6.1 and 6.2](phases/1-app-contract/spec.md#61-the-sandbox-proxy)). D115: `viewMinified` 27,200 to 28,900 (28,754 against `main` at `2e63c766`, 26,891). Verified 2026-11-23 in Chromium on the web shell (`view.test.ts`, `checklist.test.ts`: Inter loaded in hello's frame, no violation) and by `pnpm verify`; the desktop engines (WKWebView, WebKitGTK) were not run |
| 2026-11-23 | Cerulean 235° accent ramp (D172) | `t3/violet-cerulean-accent` ([#2407](https://github.com/lushly-dev/afd/pull/2407)): switched Refined Violet selection, focus ring, accent and light primary hover/pressed tokens to the owner-approved OKLCH 235° cerulean ramp (`#28769e` light / `#3d92bf` dark focus, `#1b5f80` / `#a1d4f3` accent/selected ink, `#dfecf4` / `#c0daeb` / `#162832` fills, `#2f383e` / `#262e33` light primary hover/pressed) while keeping `color.state.success.*` mint/green, primary ink/paper and high contrast unchanged. Updated `violet-source-citation`'s `.link` to read `var(--_text-link, var(--color-accent-text, #1b5f80))` for light/dark/high-contrast AA contrast, regenerated exports, fallbacks, CEM, Specimen pack records and `loam-app.toml`, and updated `design.md`, `decisions.md` (D172), `loam-design` skill and `violet-elements` README/changelog/changeset. Verified 2026-11-23: `pnpm verify` |
| 2026-11-23 UTC | Loam batch (#2181, #1484, #1473, #1778, #2116) | [#2367](https://github.com/lushly-dev/afd/pull/2367): **#2181:** `scripts/loam-exit-check.mjs` accepts the 2026-11-09 four-job `loam.yml` shape for standalone `--phase 2` and resolves compacted `UNKNOWN STEP` log lines from step timestamps and `##[group]` markers (verified live on phase 2, 3 and 4 exit runs). **#1473:** clarified string `enum` values and D63's trusted-host install wording in [phase 5's spec](phases/5-copilot/spec.md) and [decisions.md](decisions.md). **#1778:** split `loam-kernel/src/` into 10 domains with `scripts/check-kernel-domains.mjs` in `check:boundaries`, declarative staged chunks in `vite.config.ts`, and collapsed private versioned interfaces (zero ceiling raises). **#2116:** added `experiments.test.ts` units proving boot stops journaling `experiment-settle` once current (unlisted, `removed`, no-experiments). **#1484:** aligned shell buttons, field wells, floating menus/dialogs and `documents-section.ts`'s pickers (`violet-select`) with Refined; under D115 raised `signInMinified` (10,500→11,600), `surfacesMinified` (99,600→100,100), `documentsMinified` (56,314→73,000) and `editorMoveMinified` (4,205→5,900), first paint within `346,600` / `109,500` (`346,362` / `109,223` on `1bb9c7e28`; `components-brief` unavailable; violet-elements sources read directly). |
| 2026-11-24 | Loam bug sweep ([#2381](https://github.com/lushly-dev/afd/issues/2381), [#2380](https://github.com/lushly-dev/afd/issues/2380), [#2366](https://github.com/lushly-dev/afd/issues/2366), [#2325](https://github.com/lushly-dev/afd/issues/2325)) | [#2432](https://github.com/lushly-dev/afd/pull/2432) (`t3/fix-loam-bug-sweep`): **#2381/#2380:** set `forced-color-adjust: none` with `SelectedItem`/`SelectedItemText` on pressed `.quiet` toolbar toggles (`chrome/src/elements/styles.ts`) and checked checklist `.box` (`apps/checklist/src/editor-styles.ts`), covered in Chromium `accessibility.test.ts` and `checklist.test.ts`. **#2366:** gated `loam.yml`'s `test:webkit` step to `platform: 'darwin'` in `scripts/sync-ci.mjs` (`suites.generated.mjs`) and `scripts/affected.mjs` (`planSuites`/`suiteRemoteOnly`), with unit tests in `scripts/affected.test.mjs`. **#2325:** answered `copilot-*` entries from record in `replayKernel`, re-ran nested writes inside re-run notice actions, called `rerun.done` on early returns and throws in `kernel.ts`, marked `contextOmitted: ['taint']` entries unreplayable in `journal-redact.ts` and `replayKernel`, and journaled/replayed `taint` in `enforce.ts`'s `nestedGate` (`journal-order.ts`). D115 (`budget.mjs`): `kernelMinified` 163,300→163,900 (163,350). (#2384 skipped: already claimed by PR #2415.) |
| 2026-11-24 | violet-elements per-element entries ([#1785](https://github.com/lushly-dev/afd/issues/1785)) | `lush/violet-per-component-define`: Loam imports violet-elements only through public subpaths (`<name>/define` to register, `<name>` for a class, `icons/system-<name>`); `chrome`'s and `console`'s package tests now forbid `dist/` imports, and the spec's section 7 rule is amended. `budget.mjs`'s first-paint chunk `violet-icon` is now `violet-icon.define`; no ceiling raised. Verified 2026-11-24: chrome 310 and console 82 tests, chrome/console/web typecheck, `budget` |
| 2026-11-24 | The `violet-` prefix ([#1786](https://github.com/lushly-dev/afd/issues/1786), phase 4) | `lush/violet-css-prefix`: every token property is `--violet-<id>`, named by violet-runtime's `tokenCustomProperty` (shared with violet-core's exporter and `violet-elements`, which copies it at `theme:build` under D50). The theme's contract moves to version 2 (same 138 ids; `shell.*` and density take the prefix too, Loam keeps its own sheet); the component export keeps format version 1. `scripts/codemods/violet-prefix.mjs` moved the chrome, console, apps, plugins, lint fixtures and the `loam-design` skill; `loam-lint-tokens` reads `--violet-shell-*` and `--violet-ref-*`. Migration note in [design.md](design.md#the-violet-prefix). Under D115, `budget.mjs` raises the 15 rows the longer names put over (first paint's JavaScript 347,600 to 349,900 minified and 109,900 to 110,300 gzip, its CSS 10,500 to 12,600, and twelve chunks), each to its measurement plus about 300 bytes |
| 2026-11-25 | afd-server refuses afd-auth's middleware without `isVerifiedCredentials` ([#2524](https://github.com/lushly-dev/afd/pull/2524)) | `composeMiddleware` now carries afd-auth's credentials mark, so first paint's JavaScript grows. Under D115, `budget.mjs` and `first-paint.test.ts` raise it from 349,900 to 350,300 minified (measured 349,989 against `main` at `11ed11650`); gzip (110,125 of 110,300) and every other row stay within their ceilings. Verified 2026-11-25 UTC: `pnpm budget` and `test/browser/scope/first-paint.test.ts` (8 passed) |
| 2026-11-24 | Loam sub-issue batch ([#2301](https://github.com/lushly-dev/afd/issues/2301), [#2105](https://github.com/lushly-dev/afd/issues/2105), [#862](https://github.com/lushly-dev/afd/issues/862)) | [#2534](https://github.com/lushly-dev/afd/pull/2534) (`t3/advance-loam-epic-1541`): **#2301:** `AppSurfaces.#leave` checks only the leaving app's elements and parked-out nodes, and `#sync` re-checks focus before fallback, so teardown never steals focus from `loam-inbox`; `inbox.test.ts` covers the race. **#2105:** `journalsCommand` journals agent/app `notification-list` reads (keeping `kernelJournalOptions` and shell reads unjournaled, plus `JOURNAL_REPLAY` replay guard, inbox `recordOrder`, budget-cut `replay: 'recorded'`, `listedUnit` redaction, and `CONFIRMATION_OWN`). **#862:** one `$initial` group (`name: 'index'`, `includeDependenciesRecursively: false`) collapses first paint from 14 chunks to 1 (`349,129` min, `104,075` gzip on `adae8843`); `jsGzip` 110,300→105,000, D115 `kernelMinified` 163,900→164,800 (164,413 with #2514), `lateSettingsMinified` 129,900→130,500 (130,186), `urlMinified` 6,600→6,900 (6,601). (#2255 measured and released: Firefox `SelectedItem` `#3399ff`/`#ffffff` is 2.94:1.) |
| 2026-11-25 | Strict-CSP Zod `jitless` docs ([#664](https://github.com/lushly-dev/afd/issues/664)) | [#2555](https://github.com/lushly-dev/afd/pull/2555) (`t3/loam-664-zod-jitless`): documented classic `z.object()`'s `$ZodObjectJIT` `new Function` CSP violation, single-chunk `config({ jitless: true })`, and code-split `zodJitlessByDefault` / `(globalThis.__zod_globalConfig ??= {}).jitless = true` in `.claude/skills/afd-typescript/SKILL.md` (AFD leaves `jitless` to the host), and closed the follow-up row in [phase 0's spec](phases/0-kernel-chrome/spec.md#follow-ups). Verified 2026-11-25: `node scripts/check-doc-lines.mjs` and `pnpm verify --keep-going` (`ci.yml` + `alfred.yml`, 139 pytest passed). |
| 2026-11-25 | `auth-sign-in` off the agent surface (afd-auth) | `t3/sign-in-not-for-agents`: afd-auth's `auth-sign-in` is no longer exposed to agents, so the kernel's agent interface neither lists it nor runs it: an agent's call is `COMMAND_NOT_EXPOSED` before the journal, where it was `HUMAN_REQUIRED` from the identity gate and journaled. `auth-sign-out` still answers `HUMAN_REQUIRED`. A journal that recorded an agent's sign-in before this replays it from its record (`testing.ts`), and the identity gate's `UNAUTHORIZED` suggestion tells an agent to ask the person. The kernel and browser tests that pinned the old answer now assert the new one. Verified 2026-11-25 UTC: `pnpm budget`, the kernel suite (1,760 passed) and `test/browser/shell.test.ts` with `identity/agent-members.test.ts` (5 passed) |
| 2026-11-24 | Scales Phase 2 ([#1111](https://github.com/lushly-dev/afd/issues/1111), [#2197](https://github.com/lushly-dev/afd/issues/2197)) | [#2532](https://github.com/lushly-dev/afd/pull/2532) (`t3/scales-contract-cutover`): added Stage 1 `ref.{space,radius,target,type}.*` ramps and ten inherited Violet constraints (nine `ramp` rules + `no-positional-names`) in `@lushly-dev/loam-theme`, wired `validateConstraints` into `resolveTree()`/`theme:check` (errors block, warnings report as notes), bumped `CONTRACT_VERSION` `2 -> 3` (123 ids: 104 component, 19 shell), `COMPONENT_EXPORT_VERSION` `1 -> 2`, and `violet-elements/tokens/interface.json` + `violet-afd` `SPECIMEN_INTERFACE` `4 -> 5` (96 ids). Retired 16 positional ladder ids, added `space.inline.hairline` (`2px`), renamed 25 semantic ids across Loam chrome/console/apps/plugins, `violet-elements`, `health-dashboard`, `todo/frontends/shared`, `site/fast-af`, `design.md` and `loam-design` skill; all bundle ceilings stayed within budget (`budget.mjs` unchanged). |
| 2026-11-25 | `secret` commands in the journal (afd-server) | `t3/secret-commands`: afd-server's journal never records a command that declares `secret` without `redact`, and tells `redact` which calls are secret; the kernel's redactor keeps the entry of any secret command but `auth-sign-in` without its input or result (`journal-redact.ts`). Under D115, `budget.mjs` raises `@lushly-dev/loam-kernel` alone from 159,000 to 160,100 minified (measured 159,823 against `main` at `e62387541`). Verified 2026-11-25 UTC: `pnpm budget` and the kernel suite (1,766 passed) |
| 2026-11-25 | Loam phase 2 Specimen captures ([#868](https://github.com/lushly-dev/afd/issues/868), [#873](https://github.com/lushly-dev/afd/issues/873)) | `t3/loam-868-873-specimen-captures`: added comfortable and compact Specimen captures for `loam-embed` (`editor-embed-ready`, `editor-embed-depth`, `editor-embed-cycle` under a stub `loam-shell` via `createKit`), the documents inspector mounted in `loam-inspector` via `syncInspector` (`documents-inspector`), `notes-editor` with the link picker open and with its embed list (`notes-editor-picker`, `notes-editor-embeds`), and the documents sidebar's modal Rename and Links dialogs with ARIA snapshots (`:modal`, background tree excluded) and Specimen axe checks (`documents-tree-rename`, `documents-tree-links`), verified across light, dark and high-contrast in `specimen.test.ts` and updated [phase 2's follow-ups](phases/2-documents/spec.md#follow-ups) (filed [#2577](https://github.com/lushly-dev/afd/issues/2577) for `notes-editor.ts:105`'s `ariaLabel` binding). Zero production or budget changes. Verified 2026-11-25: `pnpm verify --keep-going`, `specimen.test.ts` (P2-D10 14/14), `budget`, `check-doc-lines.mjs`. |
| 2026-11-25 | Engine errors carry a recovery (verified recovery's step 5, epic [#2424](https://github.com/lushly-dev/afd/issues/2424)) | [#2539](https://github.com/lushly-dev/afd/pull/2539): `afd-server`'s engine errors gain a structured `recovery`, decided with their suggestion by one callability test (`canCall` in `command-routing.ts`). The first build pulled a new `scope-view` chunk into first paint; `canCall` now takes the caller's view from its callers instead, so first paint requests the same chunks as before. Under D115, `budget.mjs` raises `@lushly-dev/loam-kernel` alone from 160,100 to 161,000 (measured 160,603 with `main` at `ad9e42890` merged, after #2576's 159,823) and first paint's `jsMinified` (and `first-paint.test.ts`) from 346,000 to 346,800 (measured 346,326, on top of #2576), each with its reason beside it; gzip (103,157 of 103,600) and `inbound` (42,472 of 42,500) stay within their ceilings |
| 2026-11-24 | Refined follow-ups in Checklist and Hello ([#2378](https://github.com/lushly-dev/afd/issues/2378), [#2379](https://github.com/lushly-dev/afd/issues/2379)) | [#2522](https://github.com/lushly-dev/afd/pull/2522) (`t3/advance-afd-theme-epic`, draft pending owner UX look): Checklist's ticked `.box` in `apps/checklist/src/editor-styles.ts` now uses `color.control.selected.{background,border,foreground}` (matching `violet-checkbox` across light, dark and high contrast while preserving forced-colors `SelectedItem`/`SelectedItemText`); Hello (`apps/hello/src/pages/main.html`, `apps/hello/src/elements.ts`) and Checklist (`apps/checklist/src/editor-styles.ts`) `h1` headings now use `font.family.heading` (Space Grotesk); `design.md` history updated. Verified 2026-11-24 on Windows (Node 26.13.1) with `pnpm verify` (`test:webkit` and desktop remote-only suites left to CI). |

## Archive

Moved verbatim on 2026-11-23 ([#1803](https://github.com/lushly-dev/afd/issues/1803)); nothing in them is current.

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
