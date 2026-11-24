# Loam status archive: design review, phases 0 and 1

Moved verbatim from [STATUS.md](STATUS.md) on 2026-11-23 ([#1803](https://github.com/lushly-dev/afd/issues/1803)), which is the index and the
current record. A line here keeps the wording it had when it was moved and is not updated after:
a status recorded here may have changed since, though the detail of a phase still open (its
decisions, what its exit has not proven) still applies unless the index or the phase's
specification says otherwise. A link to `#heading` in a moved line named a heading of STATUS.md as
it stood then; the heading is in this file or, through "Headings in other files" at the end, in
another archive file, which the index lists under [Archive](STATUS.md#archive). A moved line is
never edited; a change of status goes in the index.

## Phases rows as they stood on 2026-11-23

The index shortened these rows, pointed their links at the archive files or, after the audit of 2026-11-23, replaced a stale clause; here is each as it was.

| Phase | State | Owner | Evidence | Next gate |
| --- | --- | --- | --- | --- |
| AFD prerequisites | Phase 0 and phase 2 rows done; phase 1's resources row done; phase 1's manifest row approved 2026-11-01 ([shared plugin manifest](../../../docs/features/complete/plugin-manifest/plugin-manifest.proposal.md)); its `spec/` core (step 1, spec first) is done ([`spec/plugin-manifest.md`](../../../spec/plugin-manifest.md), [#677](https://github.com/lushly-dev/afd/pull/677), `9be3ad12`), and its step 2, Loam's profile, is in progress with phase 1, whose block below says what has merged ([phase 1 specification](phases/1-app-contract/spec.md)); the phase 3 and 5 rows open | AFD sessions | [#576](https://github.com/lushly-dev/afd/pull/576) (#527), [#569](https://github.com/lushly-dev/afd/pull/569) (#528), [#581](https://github.com/lushly-dev/afd/pull/581); MCP resources specified in [#588](https://github.com/lushly-dev/afd/pull/588), Rust in [#608](https://github.com/lushly-dev/afd/pull/608), TypeScript in [#615](https://github.com/lushly-dev/afd/pull/615) | The shared plugin manifest's step 1 (`spec/`) lands before or with the phase 1 specification; see the phase detail |
| 2. Scope, projects and documents | Exited 2026-11-09: E1 to E14 and D1 to D10 pass in `loam.yml` and `ci.yml` on `main` ([run 42699728786](https://github.com/lushly-dev/afd/actions/runs/42699728786) and [run 42699734639](https://github.com/lushly-dev/afd/actions/runs/42699734639) at `9815022f`; [exit run](#exit-run-2026-11-09)). E5 through a test-only handler, which does not prove identity over MCP or a hosted server; E6 through a test-only relay, which does not prove a hosted server or more than one person | Phase 2 agent | [Scope and projects](phases/2-scope-projects/spec.md) and [documents](phases/2-documents/spec.md) (D35); follow-ups filed as #851 to #889 | None; phase 4 may start, and phase 2's part of phase 5's and the collaboration service's gates is met |
| 3. Identity | **Local criterion met 2026-11-22**: P3-E1 to E20 pass in `loam.yml` and `ci.yml` on `main` (runs 45049749709 and 45049752180 at `31b409fb`; [local exit run](#local-exit-run-2026-11-22)), through a test-only auth host and handler, but two P3-E8 cases left to the server. Specification approved by the coordinator 2026-11-09 ([phase 3 specification](phases/3-identity/spec.md)); the owner's questions answered (D95 to D98, D110, D111). Each step's state is its line under [phase detail](#3-identity) | The phase 3 owning agent | [Phase 3 specification](phases/3-identity/spec.md) | The exit: step 10's hosted criterion, P3-H1 to P3-H5, on phase 6's development profile (10.2); #852 and #853 close there |
| 4. Settings, experiments, notifications, overlays | **Exited 2026-11-23**: P4-E1 to E17 (E11 withdrawn) pass in `loam.yml` and `ci.yml` on `main` at `b1f08138` ([local exit run](#local-exit-run-2026-11-23)); the exit is local (D126). Specification approved 2026-11-13 ([#1139](https://github.com/lushly-dev/afd/pull/1139)); the owner's Q1 to Q5 answered 2026-11-18 (D154 to D158). Each step's state is its line under [phase detail](#4-settings-experiments-notifications-overlays) | The phase 4 owning agent | [Phase 4 specification](phases/4-settings/spec.md) | None: phase 4 has exited (D125, D126) |
| 5. Bus, copilot and mounted servers | **Specification approved** by the coordinator 2026-11-17, under the owner's standing grant ([phase 5 specification](phases/5-copilot/spec.md), [#1358](https://github.com/lushly-dev/afd/pull/1358)); the owner answered Q1 to Q7 the same day, each as recommended, so D141 to D152 are decided. The desktop path first, in three milestones (D141): **A, the desktop copilot** (the runtime in the shell, model access through the Rust host, autonomy enforced, labels and taint, a mounted person-only command approved in the shell, fresh-context units, mail as the first consumer); B, the rest of the local criterion; C, the hosted criterion. Eleven jobs as scenarios, a slice of nine; its reviews are recorded in the specification. Each step's state is its line under [phase detail](#5-bus-copilot-and-mounted-servers) | The phase 5 owning agent | [Phase 5 specification](phases/5-copilot/spec.md) | **Milestone A needs no hosted work** (D129): its gates (step 0a's spike, D153's IPC gate before step 2, and step 0c) are recorded in the phase detail and the session log; its critical path is phase 4's steps 6 and 8, and its desktop rows rest on phase 6's step 11; its mail step needs the engine's step F changes; step 9 waits for the amendment that gives installing a path with no terminal (the owner's condition on Q2). **Milestone C still needs M1** and phase 3's step 10 (the hosted MCP criterion). The exit needs A, B and C; phase 7 waits for it (Q5) |
| 6. Hosts and distribution | **M1, the development profile, reached 2026-11-23** at `4197b2ad` ([M1 exit run](#m1-exit-run-2026-11-23)). Specification approved by the coordinator 2026-11-09 ([phase 6 specification](phases/6-hosts/spec.md), [#895](https://github.com/lushly-dev/afd/pull/895)); hosted lane first; the owner's Q1 and Q2 answered on 2026-11-12 (D112, D113). Each step's state is its line under [phase detail](#6-hosts-and-distribution) | The phase 6 owning agent | [Phase 6 specification](phases/6-hosts/spec.md) | M1 reached: phase 3's step 10 and phase 5's milestone C are unblocked; M2 unblocks the collaboration service (D100); the desktop lane and distribution gate nothing before phase 7. Local first (D129, 2026-11-16): M3, with step 12's installers (D134), comes before M2. Step 11b, inbound MCP and the CLI (10.8, D137 to D140), follows step 11 in M3. Steps 8 to 10 are held (D164) |

## Session-log rows as they stood on 2026-11-23

Rows written after the split stay in the index; where one linked a heading the split moved, the index points the link at the archive file. Here is each as it was.

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-23 | Phase 6 step 7, M1 ([#2065](https://github.com/lushly-dev/afd/issues/2065)) | The development profile reached: `--phase 6 --milestone m1` in the exit check's `PHASES` table, "Units" split into its `loam` job and hosted job halves after D162, `loam-exit-check.p6.minimums.json` set from runs 45289167638 and 45289171400 at `4197b2ad`, attempt 1, after prep 4 ([#2359](https://github.com/lushly-dev/afd/pull/2359)) closed the clauses the review found unasserted. Phase 3's step 10 and phase 5's milestone C unblocked. [M1 exit run](#m1-exit-run-2026-11-23) |

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

### 0. Kernel, chrome and design foundation

- **State:** exited 2026-11-01. Every exit test, E1 to E10, passes in
  `loam.yml` on `main` ([run 41367284963](https://github.com/lushly-dev/afd/actions/runs/41367284963), at `1405e3c0`, after step 7 merged).
  Last verified 2026-11-01 against `main` at `1405e3c0`; the measured
  results are in the specification's
  [section 11.1](phases/0-kernel-chrome/spec.md#111-results-of-step-7-2026-11-01).
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
  - 2, theme: merged in [#635](https://github.com/lushly-dev/afd/pull/635).
    Loam's Violet tree (three themes, each with compact density), the
    committed token contract, `theme:build` and `theme:check`, contrast floors
    per theme, and the `loam-lint-tokens` lint with its corpus; `loam.yml`
    runs `theme:check` and `lint:tokens`.
  - 3, components onto Violet themes: merged in
    [#639](https://github.com/lushly-dev/afd/pull/639). `violet-elements`
    generates its `light`, `dark` and `high-contrast` presets from Loam's
    committed export, and `theme:check` holds its fallbacks to light.
  - 4, design document and skill: merged in
    [#640](https://github.com/lushly-dev/afd/pull/640). [design.md](design.md)
    and the `loam-design` skill record every rule with its tokens, and decide
    that the resting field border must meet 3:1 (a theme and component
    follow-up in the specification).
  - 5, kernel: merged in [#638](https://github.com/lushly-dev/afd/pull/638).
    `createKernel` with the two registries, name refusal, the commands, the
    layout validator, the palette index, the journal options and the test
    kit at `/testing`; decisions in section 6.7, and the kernel bundle's Zod
    overrun recorded in section 8.1 for step 7.
  - 6, Specimen high contrast: merged in
    [#628](https://github.com/lushly-dev/afd/pull/628); it amended section 4,
    because the bench emulates media in its native host.
  - 7, chrome and web: merged in
    [#653](https://github.com/lushly-dev/afd/pull/653). The parts, palette,
    chords, layout classes, router seam and theme application, the web host
    over IndexedDB, the Chromium suite passing E1 to E10 locally, and the
    budget with measured values; decisions in sections 7.1, 8.1 and 11.1.
  - 8, exit: merged in [#665](https://github.com/lushly-dev/afd/pull/665).
    The exit run is [run 41367284963](https://github.com/lushly-dev/afd/actions/runs/41367284963) on `main`; the open follow-ups are filed as
    issues #655 to #664 and linked from the specification's Follow-ups table.
- **The theme since the exit** ([#1430](https://github.com/lushly-dev/afd/issues/1430)):
  - `violet-elements`' token interface version 2, with the Refined restyle of the components (branch
    `lush/violet-elements-refined`, not merged as of 2026-11-17): it adds `font.family.heading` and
    `shadow.well`, which the tree supplies as new component ids (117 component and 19 shell ids,
    136 in the contract), and five `color.field.*` ids the tree already had. `view`'s ceiling 26,100.
  - AFD's theme, Refined (D159; branch `lush/afd-theme-refined`, cut from the restyle, not merged as of
    2026-11-17): the tree's values, the `violet-elements` export, built-in set and fallbacks are the
    approved set from the AFD site's review pages, except dark `color.border.strong` (an added stone-450 for
    3:1 with margin on the subtle surface) and four values carried over from Lushly's palette (high contrast's pressed
    surface and state icons, dark's success icon). A read-only field's line is `color.border.strong` and
    its placeholder `color.text.secondary`, and `pairs.ts` measures field pairs over page, card, subtle
    and floating. The chrome, console and two apps read `font.family.*` in place of
    literal stacks; `@lushly-dev/loam-theme` ships Inter, Space Grotesk and IBM Plex Mono (`fonts/`, six
    latin woff2, 115,268 bytes, SIL OFL 1.1), linked by `loam-web`. Budget (2026-11-17, under D115):
    `cssMinified` 8,496 to 10,500 (measured 10,251: `loam-theme.css` 8,217 to 8,431, the fonts'
    `@font-face` rules 1,820); a new row, `fontsBytes`, 115,268 of 116,000; first paint 302,919 and
    94,392 gzip, within its ceilings. After the base merged `main` (2026-11-18): first paint 304,186
    against the base's 303,794 at `c8a5f7b6` (+392), so `jsMinified` 304,000 to 304,700 under D115; gzip
    94,807, CSS 10,292. Lushly's palette is in history at `599be245` and in Lushly
    ([lushly#2468](https://github.com/lushly-dev/lushly/issues/2468)).

### 1. App contract

- **State:** exited 2026-11-02. Every exit test, E1 to E13, passes in `loam.yml` on `main`
  ([run 41452945001](https://github.com/lushly-dev/afd/actions/runs/41452945001), at `d7b8f9fc`), E3 and E4 **through a test-only relay** (D64). Last verified 2026-11-02 against `main` at
  `d7b8f9fc`.
- **Done:** the [specification](phases/1-app-contract/spec.md), deciding D59 to
  D68 and deciding L1 to L10 of the shared plugin manifest proposal.
- **Not proved:** a hosted server, multi-member use, stdio and the desktop (D64). The mounted proof (D57) runs
  through a test-only relay until phase 6 serves the route.
- **Steps** ([plan](phases/1-app-contract/spec.md#15-implementation-plan); one
  line each, so parallel pull requests touch different lines):
  - 0a, AFD browser-safe MCP transport: merged in [#694](https://github.com/lushly-dev/afd/pull/694). `@lushly-dev/afd-client/streamable-http` exports `StreamableHttpTransport` and its types, with no `eventsource` of ours or Node.js builtin in its graph, within the 340,000-byte budget.
  - 0b, AFD adapters without inline styles: merged in [#680](https://github.com/lushly-dev/afd/pull/680). `RenderOptions.styling: 'classes'` replaces every `style` attribute with `afd-status-<type>` and `afd-bold`, which `css/afd-theme.css` defines.
  - 1, manifest package: merged in [#689](https://github.com/lushly-dev/afd/pull/689): `@lushly-dev/loam-manifest`, with the three schemas, standalone validators, readers, catalogs and Loam's profile in the core's conformance test.
  - 2, SDK and CLI: merged in [#693](https://github.com/lushly-dev/afd/pull/693): `@lushly-dev/loam-sdk` (root and `/view`) and `@lushly-dev/loam-cli` (`app new`, `app check`, `app pack`, `deployment check`, `deployment write`, `checkApp`, `singleFileHtml`), with the file rules' cases and E13's CLI part.
  - 3, kernel version 1: merged in [#698](https://github.com/lushly-dev/afd/pull/698): kernel interface 1 with its ports, `src/apps/` for native and view loaded dynamically, the app commands, the port's checks, overlays' state, per-app layout, keybindings and replay with apps, and `@lushly-dev/loam-testing`.
  - 4, chrome and web, native apps: merged in [#700](https://github.com/lushly-dev/afd/pull/700): the chrome's app surfaces in a chunk of their own (`loam-mount`, `loam-list`, the nav's entries, the header, status items, toast and modal, the kit), the web host's deployment read and `serveDeployment`, hello native and tally, with E1, E5, E6, E7's browser part, E9's Chromium part and E11 so far.
  - 5, sandboxed view: merged in [#703](https://github.com/lushly-dev/afd/pull/703). The proxy on a second origin, `loam-view-frame`, the broker in the kernel, the handler frame and hello view, with E2 and its `ext-apps` conformance fixture in real frames; [9.7](phases/1-app-contract/spec.md#97-decided-by-step-5) records what the browser and a security review changed.
  - 6, console: merged in [#702](https://github.com/lushly-dev/afd/pull/702): `@lushly-dev/loam-console`, the console in main's mount for every app with no main surface (commands, forms from input schemas, results through the adapters as text under the real CSP), with E10 and E11's console part, and first paint unchanged.
  - 7, mounted, against Umbel: merged in [#704](https://github.com/lushly-dev/afd/pull/704): hello mounted and a stock `umbel` in the console through a test-only relay, with discovery, exposure, pinning, the journal's marks and replay with Umbel stopped, so E3, E4 and E9's mounted part hold and nothing proves a hosted server yet; [9.9](phases/1-app-contract/spec.md#99-decided-by-step-7) records what Umbel and the browser changed.
  - 8, exit: merged in [#714](https://github.com/lushly-dev/afd/pull/714). The exit run is [run 41452945001](https://github.com/lushly-dev/afd/actions/runs/41452945001); `loam.yml`'s
    `mounted` job first ran in [#705](https://github.com/lushly-dev/afd/pull/705), because #704's read a gate output
    that is never set. Follow-ups are filed as #706 to #713 and linked from the specification.

## Headings in other files

A moved line above links a heading of STATUS.md that is now in another archive file. Each heading here keeps that link working and points on to it.

### Exit run, 2026-11-09

In [STATUS.archive-2026-11-phase-2-2.md](STATUS.archive-2026-11-phase-2-2.md#exit-run-2026-11-09).

### Local exit run, 2026-11-22

In [STATUS.archive-2026-11-phases-3-6-1.md](STATUS.archive-2026-11-phases-3-6-1.md#local-exit-run-2026-11-22).

### 3. Identity

In [STATUS.archive-2026-11-phases-3-6-1.md](STATUS.archive-2026-11-phases-3-6-1.md#3-identity).

### Local exit run, 2026-11-23

In [STATUS.archive-2026-11-phases-3-6-1.md](STATUS.archive-2026-11-phases-3-6-1.md#local-exit-run-2026-11-23).

### 4. Settings, experiments, notifications, overlays

In [STATUS.archive-2026-11-phases-3-6-1.md](STATUS.archive-2026-11-phases-3-6-1.md#4-settings-experiments-notifications-overlays).

### 5. Bus, copilot and mounted servers

In [STATUS.archive-2026-11-phases-3-6-2.md](STATUS.archive-2026-11-phases-3-6-2.md#5-bus-copilot-and-mounted-servers).

### M1 exit run, 2026-11-23

In [STATUS.archive-2026-11-phases-3-6-2.md](STATUS.archive-2026-11-phases-3-6-2.md#m1-exit-run-2026-11-23).

### 6. Hosts and distribution

In [STATUS.archive-2026-11-phases-3-6-2.md](STATUS.archive-2026-11-phases-3-6-2.md#6-hosts-and-distribution).
