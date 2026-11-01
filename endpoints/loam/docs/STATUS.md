# Loam status

Read this before anything else in the area, and update it before you end a
session that changed Loam. It is the source of truth for progress: an agent
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
  those blocks; the phase folder holds the detail (decisions D16 and D17).
- **Dates are absolute.** Never "last week".

## Documents

| Document | State | Evidence | Verified |
| --- | --- | --- | --- |
| [Architecture](architecture.md) | The through line; drafted 2026-10-30 and 2026-10-31, revised after review; the owner read the whole set and approved the direction on 2026-11-01 | [#524](https://github.com/lushly-dev/afd/pull/524), the set and the review fixes | 2026-10-31: three independent reviews (AFD and repository accuracy, cross-document coherence, external facts); every relative link and anchor resolved; portability gate passed |
| [Proposal](proposal.md) | Rationale; the architecture wins where they differ | Same | Same |
| [Decision log](decisions.md) | D1 to D49; D22 decided by the owner on 2026-10-30, D25 to D49 on 2026-10-31; no decision open; review corrections marked in consequences | Same | Same |
| [Landscape](landscape.md) | Opportunities OP1 to OP12 with dispositions; OP1 to OP8 closed as D39 to D46, OP12 as D47 to D49 | Same | 2026-10-31: primary pages read for the platform, product and standards claims; secondary claims marked |
| [Trajectory watch](trajectory.md) | Current as of 2026-10-31; movements 1 to 8, R1 to R18, W1 to W28 | Same | External claims fact-checked against primary sources on 2026-10-31 |
| [Research](research.md), [Sources](sources.md) | Current as of 2026-10-31; S01 to S79 | Same | Same |

## Phases

| Phase | State | Owner | Evidence | Next gate |
| --- | --- | --- | --- | --- |
| Design review | Done 2026-11-01 | Owner | This document set; the owner's approval in the session of 2026-11-01 | None |
| AFD prerequisites | Phase 0 and phase 2 rows done; phase 1's resources row done; the manifest proposal (phase 1) and the phase 3 and 5 rows open | AFD sessions | [#576](https://github.com/lushly-dev/afd/pull/576) (#527), [#569](https://github.com/lushly-dev/afd/pull/569) (#528), [#581](https://github.com/lushly-dev/afd/pull/581); MCP resources specified in [#588](https://github.com/lushly-dev/afd/pull/588), Rust in [#608](https://github.com/lushly-dev/afd/pull/608), TypeScript in [#615](https://github.com/lushly-dev/afd/pull/615) | The shared plugin manifest proposal before phase 1; see the phase detail |
| 0. Kernel, chrome and design foundation | Specification approved 2026-11-01; implementation in progress (see the steps below) | Phase 0 agent | [Phase 0 specification](phases/0-kernel-chrome/spec.md) | The next unstarted steps in the phase 0 block below |
| 1. App contract | Not started | None | None | Phase 0 exit criterion met |
| 2. Scope, projects and documents | Not started | None | None | Phase 1 exit criterion met |
| 3. Identity | Not started | None | None | Phase 1 exit criterion met; the hosted criterion also needs phase 6's hosted lane at its development profile |
| 4. Settings, experiments, notifications, overlays | Not started | None | None | Phase 2 exit criterion met |
| 5. Bus, copilot and mounted servers | Not started | None | None | Phases 2 and 3 exit criteria met and phase 6's hosted lane at its development profile |
| 6. Hosts and distribution | Not started | None | None | Phase 1 exit criterion met; the hosted lane must reach its development profile before phases 3 and 5 need it, while the desktop lane and distribution gate nothing before phase 7 |
| 7. Builder | Not started | None | None | Phases 4, 5 and 6 exit criteria met |
| 8. Guides and the first consumer | Not started | None | None | Phase 7 exit criterion met |
| Collaboration service (unnumbered) | Not started | None | None | Phases 2 and 6 exit criteria met; its own specification (D46) |

## Phase detail

### Design review

- **State:** done 2026-11-01: the owner read the full set as a whole and
  approved the direction ("It is done, start the work").
- **Done:** research across loved application layouts, plugin shells, web
  platform isolation and overlay primitives, client-side runtimes, identity,
  experiments, agent runtimes, documents and multiplayer
  ([research](research.md), [sources](sources.md)); the AI-first shell
  [landscape](landscape.md); the proposal, architecture, decision log and
  trajectory watch; name collision checks and the name (D22); every open
  decision closed by the owner (D22, D25 to D49); the feature index row;
  three independent reviews on 2026-10-31 and their fixes, recorded in the
  session log; the set proposed in
  [#524](https://github.com/lushly-dev/afd/pull/524).
- **Done:** the owner's read of the full set as a whole, 2026-11-01.
- **Not done:** nothing.

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
    [MCP resources and skills](../../../docs/features/active/mcp-resources-skills/STATUS.md),
    [#615](https://github.com/lushly-dev/afd/pull/615), merged 2026-11-01
    as `c80a9b4d`).
- **Not done:**
  - Phase 1: the shared plugin manifest proposal.
  - Phase 3: the TypeScript token-verification layer, `scopes` and
    `credentials` (MCP Authorization proposal).
  - Phase 5: the `apps` exposure flag (D30); agent, delegation, run and
    session records proposed to the Agent Engine.
  - Phase 6, optional: a fetch-style `createMcpHandler`.
  Nothing waits on Rust parity since D25, and the FAST-AF and Violet units
  are consumable from the workspace.
- **Note:** the shared plugin manifest, the `apps` exposure flag, `_meta`
  forwarding, declared journal fields, and serving MCP Apps resources from
  AFD servers are AFD-wide changes; each that crosses languages needs a
  `docs/features` proposal, spec first, before Loam implements against it
  (D15). Scope itself stays a field Loam adds to the command context (D31).

### 0. Kernel, chrome and design foundation

- **State:** specification approved by the owner on 2026-11-01;
  implementation in progress. Last verified 2026-11-01 against `main` at
  `85d938bf`; the specification's evidence is listed in its
  [status block](phases/0-kernel-chrome/spec.md#status).
- **Done:** the [specification](phases/0-kernel-chrome/spec.md), deciding
  D50 to D53.
- **Steps** ([plan](phases/0-kernel-chrome/spec.md#12-implementation-plan);
  one line each, so parallel pull requests touch different lines):
  - 0a, AFD browser stores: merged in
    [#629](https://github.com/lushly-dev/afd/pull/629). `IndexedDbAdapter`,
    `runDataAdapterContract` at `/testing` and `IndexedDbJournalSink` with its
    writer lock; sections 3 and 6.6 amended (`lock()`, `close()`, error codes).
  - 0b, Violet preloaded source and high contrast: merged in
    [#627](https://github.com/lushly-dev/afd/pull/627). `VioletRuntime` takes
    a preloaded source in place of `apiUrl`; `useSystemPreference` takes a
    high-contrast theme; decisions recorded in section 3.
  - 1, scaffold: merged in [#626](https://github.com/lushly-dev/afd/pull/626).
    The four packages build with empty sources; `loam.yml` runs build,
    typecheck, units and a Chromium boot test under the CSP. Steps 2 and 7
    add `theme:check`, `lint:tokens` and `budget` to it.
  - 2, theme: not started.
  - 3, components onto Violet themes: not started.
  - 4, design document and skill: not started.
  - 5, kernel: not started.
  - 6, Specimen high contrast: merged in
    [#628](https://github.com/lushly-dev/afd/pull/628); it amended section 4,
    because the bench emulates media in its native host.
  - 7, chrome and web: not started.
  - 8, exit: not started.

Phases 1 to 8 have no detail yet; add a heading in this shape when one
starts.

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-10-30 | Design session | Decide the name, open decision O1 | Closed 2026-10-30: the owner chose Loam (D22); crate `afd-loam`, packages `@lushly-dev/loam-*`, area `endpoints/loam/` |
| 2026-10-30 | Design session | Decide the rail rule for apps that support both scopes, open decision O2 | Closed 2026-10-31 as D29 |
| 2026-10-30 | Discussion with the owner | Decide the copilot SDK, open decision O9 | Closed 2026-10-31: TanStack AI 1.0 (D27); the spike of its headless client inside a web-component panel with DirectClient tools and an approval interrupt is the first task of the phase 5 specification |
| 2026-10-30 | Discussion with the owner | Inventory Lushly's copilot and TanStack server code (approval evidence exchange, execution origin, AI client interfaces, chat transport) for extraction into shared libraries; decide their home, an AFD package or a Loam package, in the phase 5 specification; D19 keeps them generic | Open |
| 2026-10-30 | Discussion with the owner | Decide in the phase 2 specification whether documents split into their own phase specification | Closed 2026-10-31 as D35: their own specification beside scope and projects |
| 2026-10-30 | Design session | Write the `docs/features` proposal for the shared plugin manifest, reconciled with Umbel's manifest and Plugin Discovery, before phase 1 | Open |
| 2026-10-30 | Design session | Write the `docs/features` proposal for the `apps` exposure flag (D30), specified for every language | Open |
| 2026-10-30 | Design session | Port the view-state commands to the `afd` crate or specify them for the kernel; the TypeScript package stays the contract | Closed 2026-10-31 by D25: the kernel is TypeScript and uses the package directly |
| 2026-10-30 | Design session | Reconcile vocabulary with Umbel: "surface" means a shell UI region here and a transport there; add the cross-reference from Umbel's glossary, which does not mention Loam yet | Open |
| 2026-10-30 | Design session | When packages land, add a `pnpm-workspace.yaml` glob for `endpoints/loam/*` and the units to the release inventory; `architecture.json` lists foundation families only, so it needs nothing (D14, corrected 2026-10-31); units start quarantined | Open |
| 2026-10-30 | Design session | Refresh the trajectory watchlist rows before each phase specification, in particular W1, W2 and W6 ahead of phase 1 | Open, recurring |
| 2026-10-30 | Design session | The Lushly support application is specified in Lushly's repository; record here only the generic shell needs it surfaces, as they appear | Open, recurring |
| 2026-10-31 | Discussion with the owner | Move `violet-elements` onto Violet themes through the runtime in place of its local theme registries (D28), with baked-in defaults and every edit recorded in `foundations/fast-af/provenance/adaptations.json`; coordinate with Lushly's transition to Violet throughout, specified in Lushly's repository; a phase 0 deliverable until an issue owns it | Specified 2026-11-01 as step 3 of the [phase 0 specification](phases/0-kernel-chrome/spec.md), as data and custom properties rather than through the runtime (D50); open until that step merges |
| 2026-10-31 | Discussion with the owner | Write the Loam design document and its authoring skill, declared in `skills/exports.json`, before the chrome grows past a skeleton (D26); add the token-only lint and the component checklist to the phase 0 specification | Specified 2026-11-01 in the phase 0 specification (sections 2.5 to 2.7, step 4); open until step 4 merges |
| 2026-10-31 | Discussion with the owner | Set the operations and budgets of the accelerator admission rule (D37) in the phase 0 specification | Closed 2026-11-01: operations A1 to A5 and their budgets in the phase 0 specification, section 8.2 |
| 2026-10-31 | Landscape research | Decide O10 to O17, the opportunities the landscape opens | Closed 2026-10-31 as D39 to D46 by the owner |
| 2026-10-31 | Landscape research | Before the phase 5 specification, verify WebMCP's shipping shape and milestone against chromestatus, which on 2026-10-31 showed the feature as proposed with a trial extension to Chrome 162 requested (W20) | Open |
| 2026-10-31 | Multiplayer discussion | Choose the CRDT library behind the document store interface in the collaboration specification (W28), and add a two-client journal-replay scenario to the test kit | Open |
| 2026-10-31 | Builder discussion | Specify the sandbox policy for drafts built in the shell, including kit delivery into the sandbox and the content security policy, in the phase 7 specification (D47) | Open |
| 2026-10-31 | Builder discussion | Write the builder agent's skills, the SDK skill and the design skill, in `skills/exports.json`, so the same guidance serves the copilot and repository agents | Open |
| 2026-10-31 | Review | Write the AFD changes the review found missing: a browser-safe entry for `createDirectRegistry`, the journal and the approval middleware with WebCrypto; MCP forwarding a declared `_meta` key into the command context; journal entries that keep declared context fields; AFD contexts and the lazy strategy in the direct registry; optionally a fetch-style `createMcpHandler` | Closed 2026-11-01: the browser-safe direct registry ([#527](https://github.com/lushly-dev/afd/issues/527), [#576](https://github.com/lushly-dev/afd/pull/576)) and declared context fields ([#528](https://github.com/lushly-dev/afd/issues/528), [#569](https://github.com/lushly-dev/afd/pull/569)) merged and moved to `docs/features/complete/`; the optional fetch-style handler is not filed and stays a phase 6 option |
| 2026-10-31 | Review | Umbel's architecture says Umbel joins the `architecture.json` families, which list foundations only; endpoints are classified by path. Umbel's D22 on name enforcement is correct, because the Rust registry refuses bad names. Raised with the Umbel session on 2026-10-31 | Sent to Umbel |
| 2026-10-31 | Review | Revisit D45 when the runtime adapter is stable: Chrome 148 shipped the Prompt API on pages, so Chrome meets its condition | Open |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-10-30 | Design session with the owner | Research run and synthesized; README, proposal, architecture, decision log (D1 to D20, O1 to O8), trajectory watch, research, sources and this status file drafted; the feature index row added. Planning only: no code |
| 2026-10-30 | Discussion with the owner | The owner confirmed that apps are web components in TypeScript, HTML and CSS with no transport or Rust knowledge needed (D21, principle 12, the SDK boundary in the architecture). The owner asked what the colliding Loam projects are and floated "AFD Shell"; the `afd shell` CLI subcommand was found to clash, and O1 was rewritten with the plain alternatives |
| 2026-10-30 | Discussion with the owner | The owner chose Loam over "AFD App Shell", "AFD Workbench" and Coldframe; O1 closed as D22; README, proposal, architecture and this file updated to drop the working-name wording |
| 2026-10-30 | Discussion with the owner | Documents added as shell resources with types as contributions (D23, principle 17, the editor area, New, references); the copilot added as a shell section on AFD records with a runtime adapter (D24); eight TypeScript runtimes surveyed for O9 with TanStack AI recommended, the Copilot SDK set aside for its process model and the owner's session experience; Lushly reuse noted; research sections 6 and 7, sources S43 to S53 and watchlist rows W15 to W19 added |
| 2026-10-31 | Discussion with the owner | Language choice revisited per part: TypeScript first, Rust only where measured (D25 supersedes D8, closes O4); the design foundation on Violet made a phase 0 deliverable with a design document, skill and component checklist (D26); TanStack AI decided (D27 closes O9). Proposal, architecture, decisions, research, sources, trajectory, README and the feature index updated; Rust-only prerequisites removed |
| 2026-10-31 | Discussion with the owner | The owner clarified that the shared components should be fed by Violet themes, with Loam and Lushly as two design systems on one component set and Lushly's own transition to Violet starting there (D28); the design foundation, principle 18, the libraries and prerequisites tables, the research and the follow-ups updated |
| 2026-10-31 | Discussion with the owner | The owner confirmed the recommendations on every open question: O2 to O8 closed as D29 to D34, and the four follow-up questions decided as D35 (documents in their own specification), D36 (Hono), D37 (the accelerator admission rule) and D38 (components take Violet's exported custom properties with baked-in defaults). No decision is open |
| 2026-10-31 | Landscape research | Surveyed AI-first shells and platforms: chat products as shells, OS and browser agent hosts, agents as members, agent managers, agent-rendered UI, the interface of trust; [landscape](landscape.md) written with OP1 to OP11; sources S55 to S74; trajectory movements 7 and 8, reservations R13 to R17, watchlist W20 to W27; open decisions O10 to O17 with recommendations |
| 2026-10-31 | Multiplayer discussion | The owner adopted all eight landscape opportunities (D39 to D46) and raised multiplayer from a reserved backend to a shell-level collaboration service for every document type and run, learning from an earlier one-type service: sync on the journal with CRDT updates as commands, presence in the type's selection model, sharing with link generations and authorization epochs, threads on locators (D46). Proposal section, architecture principle 19, component, grant, binding interface and glossary, research section 9, sources S75 to S78, trajectory R18 and W28 added |
| 2026-10-31 | Builder discussion | The owner's vision of building and publishing apps from the copilot without a repository recorded as D47, with the console as every app's first UI and a usage view (D48) and the builder promises, document type kit, triggers and actions, affordance tests, packaging (D49). Builder added as phase 7 and the guides phase renumbered to 8; principle 20, the builder component, `app-*` commands, the artifact lifecycle, the security rule and glossary added; the proposal's building-inside-Loam section and first proof 10 written; landscape OP12 added |
| 2026-10-31 | Commit and review | The set opened as [#524](https://github.com/lushly-dev/afd/pull/524). Three independent reviews ran: AFD and repository accuracy, cross-document coherence, external facts. Fixed: four AFD gaps added as prerequisites (browser-safe registry, `_meta` forwarding, journal context fields, contexts in the direct registry) and D31 and D36 corrected; D39 to D45 carried into the architecture's components, interfaces, commands, phases and glossary; Rust-kernel, agent-panel and `trait` leftovers removed; "handoff" renamed "delegation" to avoid AFD's handoff pattern; commands made singular and verb-final (`setting-*`, `event-list`, `document-link-list`, `app-usage-get`); a minimal console moved into phase 1; phase 6's hosted lane gating phases 3 and 5; Health made a native app; facts corrected for Firefox 159 scoped registries, Chrome 148 Prompt API, TanStack AI's harness, the Copilot SDK's GA and BYOK, Tauri 2.12, Grafana, Slack Code, Stack Overflow and others |
| 2026-10-31 | AFD proposals | The two AFD areas the review found were written as feature proposals with status files, the browser-safe direct registry and declared context fields, filed as #527 and #528, and linked from the prerequisites table |
| 2026-11-01 | Owner's review | The owner read the full set and approved the direction ("It is done, start the work"); the design review closed. The AFD prerequisites row brought up to date: the phase 0 and phase 2 rows are merged in AFD (#576, #569, #581, #589); TypeScript MCP resources, the phase 1 blocker, started. Phase 0's specification started |
| 2026-11-01 | Phase 0 specification | The [phase 0 specification](phases/0-kernel-chrome/spec.md) written: four packages under `endpoints/loam/packages/`, the token contract and Loam's Violet tree, the shared components moved onto a committed Violet export (D50), the design document and the `loam-design` skill, the token-only lint, kernel interface version 0, the phase 0 commands with `appearance` and `palette` (D51), stores version 0 on IndexedDB for browser and desktop (D52), Specimen high contrast (D53), the bundle budget and the accelerator rule's operations and budgets (D37), and the exit tests |
| 2026-11-01 | Owner's approval | The owner approved the phase 0 specification, deciding D50 to D53, and granted autonomy across phases: commit, merge, fix and approve later specifications without checking in unless a question blocks on the owner. D53's wording aligned with the specification (light scheme plus `prefers-contrast: more`; forced colors tested in Loam's suite) |
| 2026-11-01 | Phase 0 step 6 | Specimen's `high-contrast` theme context (D53) merged in [#628](https://github.com/lushly-dev/afd/pull/628): the light scheme with `prefers-contrast: more`, emulated by the native host over CDP, checked at capture, offered by the static preview and run by all three drivers. Section 4 of the specification amended: since #616 the mapping lives in `host/src/page.rs`, not `bench-runtime.ts` |
| 2026-11-01 | Phase 0 step 1 | The scaffold: four private, quarantined packages under `endpoints/loam/packages/`, the workspace glob, four release-inventory entries, `loam.yml`, `AGENTS.md` rows and a repository contract test. Steps 0a, 0b and 6 started in parallel. The phase 0 block now has one line per step |
| 2026-11-01 | Phase 0 step 0b | [#627](https://github.com/lushly-dev/afd/pull/627) merged: `VioletRuntime` applies a preloaded source with no token server (`switchNode` takes a new source, `ThemeManager` themes carry one), and `useSystemPreference` chooses a high-contrast theme under `prefers-contrast: more` or `forced-colors: active`. Four details the specification left open were decided and recorded in its section 3: the either/or config union, an optional `resolvedAt`, no cache with a source, and `Theme.source` |
| 2026-11-01 | Phase 0 step 0a | [#629](https://github.com/lushly-dev/afd/pull/629): `IndexedDbAdapter`, the exported adapter contract suite and `IndexedDbJournalSink` with its writer lock, parity rows, READMEs, skills and a minor changeset for local-db and afd-core. The spec's section 3 and 6.6 gained `lock()`, `close()`, `IndexedDbJournalError` and its codes (`JOURNAL_LOCKED`, `JOURNAL_LOCK_UNAVAILABLE`, `JOURNAL_CLOSED`, storage errors), and the contract suite's `vitest` peer dependency. An independent review's lock-race findings were fixed before merge |
