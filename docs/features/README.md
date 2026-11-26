# AFD Features

Feature specifications organized by lifecycle stage.

## Stages

| Stage | Description |
|-------|-------------|
| [proposed/](./proposed/) | Draft proposals awaiting review |
| [active/](./active/) | Approved features in implementation |
| [complete/](./complete/) | Shipped scope (reference archive); any unshipped remainder is explicitly marked and linked to follow-up issues |

## Active Features

Cross-language gaps (TypeScript, Python, Rust, C++) are tracked in [Language Parity](../language-parity.md), and the Language Parity Closure plan closes them. The Python plan covers export names only; the Rust one is complete.

| Feature | Description |
|---------|-------------|
| [Umbel](../../endpoints/umbel/README.md) | AFD Umbel, an empty Rust host for capability plugins over MCP and CLI, with knowledge, memory and context as first-party plugins. Phases 0 to 4 are done (the host skeleton, the plugin contract, knowledge, memory and context, the curator); phase 5, auth and hosted, is in progress, and phase 6's specification is approved. Unpublished. Documented in `endpoints/umbel/`; exact state in its [STATUS.md](../../endpoints/umbel/docs/STATUS.md) |
| [Loam](../../endpoints/loam/README.md) | AFD Loam, an application shell for AFD apps: a TypeScript kernel for the browser, Tauri desktop and hosted server, and a FAST-AF chrome on a Violet design foundation, with shell-level projects, documents, identity, settings, overlays, a copilot and an in-shell app builder. Phases 0 to 2 have exited (the kernel and chrome, the app contract, scope, projects and documents); phases 3 to 6 are in progress (identity; settings, notifications and overlays; the copilot; hosts). Unpublished. Documented in `endpoints/loam/`; exact state in its [STATUS.md](../../endpoints/loam/docs/STATUS.md) |
| [Mail](./active/mail/STATUS.md) | Approved engine specification; the engine is being built a step at a time, on iCloud first: the owner deferred Gmail (B0, B6 and B7's Gmail half) on 2026-11-14. The later engine phases and the Loam app follow. Each step's state is its own line in the status file. |
| [Python Parity Closure](./active/python-parity/STATUS.md) | Active name-cleanup subplan of Language Parity Closure. Fresh Alfred measurement: 88 missing names on 2026-11-13, matching its budget; core ergonomics are done, pipeline/similarity exports and remaining helpers are not. |
| [Language Parity Closure](./active/parity-closure/STATUS.md) | Shared-contract vectors and stabilization have landed. Runtime and surface gaps, C++'s MCP target, Python defaults/CLI/auth, and the contract 1.0 decision remain. |
| [Software Factory](./active/software-factory/STATUS.md) | The merge lane from Lushly's fleet v2 as a shared botcore plugin: cells hand reviewed branches to one lane that validates, merges and ejects, and a foreman starts cells on the plan with the most room. Phase 0 is done; Phase 1 is in progress, and each of its pieces has its own line in the status file. [Proposal](./active/software-factory/software-factory.proposal.md) |
| [Formal Verification](./active/formal-verification/formal-verification.proposal.md) | The approved factory pilot holds the earliest live claimant rule in one shared fixture, a triage scenario and the commands that release a claim. Further verification methods await evidence from the pilot. [Status](./active/formal-verification/STATUS.md) |
| [Apps Exposure](./active/apps-exposure/STATUS.md) | The `apps` exposure flag and app-to-app calls (Loam phase 5 step 0b, D30, #884): a command's `expose.apps` and a host's grant check let one app call another's command, and every other app call gets one `CALL_NOT_GRANTED` before lookup; the plugin manifest's core version 2 carries the flag. Spec, TypeScript and Rust done; Python and C++ are [#1513](https://github.com/lushly-dev/afd/issues/1513). [Proposal](./active/apps-exposure/apps-exposure.proposal.md) |
| [Approver Client](./active/approver-client/STATUS.md) | Approval evidence from an approver client and the approval display rules (Loam phase 5 step 0c, D146, D150): a server-named MCP client gets a held call's token, carries it back in `_meta["dev.afd/approval"]` bound to its credentials, and shows the action only when a person can read it in full. Spec, TypeScript and Rust done; Python and C++ are [#1466](https://github.com/lushly-dev/afd/issues/1466). [Proposal](./active/approver-client/approver-client.proposal.md) |
| [Disk Hygiene](./active/disk-hygiene/STATUS.md) | Development machines stop filling up with worktrees, build output and caches: T3 Code removes the worktrees it creates, and botcore's `disk-*` commands prune caches, strip build output from idle worktrees and remove other finished worktrees on a schedule, on macOS, Windows and Linux. Each piece's state is its own line in the status file. [Proposal](./active/disk-hygiene/disk-hygiene.proposal.md) |
| [Merge Conflicts](./active/merge-conflicts/STATUS.md) | Fewer pull requests in conflict with `main`: shared lines that every pull request edited are reshaped, provenance records resolve by command, Python, Botcore and spec changelogs move to one file per pull request, and a merge queue follows. Its STATUS has one line per pull request. |
| [Architecture Review](./active/architecture-review/STATUS.md) | Follow-up work from an architecture review of the whole repository on 2026-11-21: a schema-defined contract and a decision on a core with profiles, one admission pipeline per language that AFD's own endpoints use, journals and local data with a lifecycle, and quality checks and architecture boundaries across every language. One line per issue under [#1732](https://github.com/lushly-dev/afd/issues/1732); each issue carries its evidence |
| [Factory Gateway](./active/factory-gateway/factory-gateway.proposal.md) | The factory's one door to GitHub: a service in `botcore-factory`, on the always-on machine, that holds the credential as a GitHub App, serves typed commands to each kind of caller (cell, session, foreman, lane, owner) with its own token, keeps GitHub as the record of claims with itself as their only writer, merges only heads the lane recorded as validated, shares and settles GitHub reads, journals every write with the caller it acted for, and wakes the lane and foreman on events. An MVP (G1, one writer) then milestones to review records, events, no credential outside the gateway and interactive sessions, each updating the skills, scripts and `AGENTS.md` that use it under a checked process manifest. Active by the owner's direction of 2026-11-14 with fifteen jobs as scenarios, walked by three readers and reviewed; nothing built; status in [STATUS.md](./active/factory-gateway/STATUS.md) |
| [Skill Usage](./active/skill-usage/STATUS.md) | Which skills agents load, read from what the harnesses already record instead of from hooks in the skills: botcore's `skill-usage-*` commands collect the loads T3 Code's store shows for its Claude and Codex threads into a per-machine record and report them, and a missed-trigger report says which merged changes needed a skill that no session loaded. |
| [Test Effectiveness](./active/test-effectiveness/STATUS.md) | What each check observed, caught, missed and cost, a reviewer's finding followed to the check added for it and shown failing, how often review reported what a check caught, and what came of each change to the checks: botcore's `gate-outcome-*` commands read GitHub's runs, `main`'s fix commits, what `pnpm verify` saw and what reviewers found, and replay a proposed trigger or tier change over the history before the owner decides. Approved 2026-11-24 under epic [#1387](https://github.com/lushly-dev/afd/issues/1387); each piece's state is its own line in the status file. [Proposal](./active/test-effectiveness/test-effectiveness.proposal.md) |
| [Controls](./active/controls/STATUS.md) | A designed path for an agent inside an application to read and fill the controls on a screen: `control-list`, `control-set`, `control-restore` and `control-choices` beside view state, a binder with no handler per control, and a state contract for components. Approved 2026-11-24 under epic [#1385](https://github.com/lushly-dev/afd/issues/1385); phase A ([#2487](https://github.com/lushly-dev/afd/issues/2487)), the registry and the four commands, is built. [Proposal](./active/controls/controls.proposal.md), [phase A specification](./active/controls/spec.md) |
| [Pointing](./active/pointing/STATUS.md) | Show an agent which element on a rendered screen you mean (two-step climb, pointer URI, Pick mode, bounded source-tied point, staleness checks), leave pinned notes, and preview token corrections before they are written. Approved 2026-11-22 under [#1110](https://github.com/lushly-dev/afd/issues/1110) with 9 jobs ranked across Slice 1 Targeting ([#2046](https://github.com/lushly-dev/afd/issues/2046), [#2042](https://github.com/lushly-dev/afd/issues/2042), [#2043](https://github.com/lushly-dev/afd/issues/2043)), Slice 2 Notes ([#2044](https://github.com/lushly-dev/afd/issues/2044)), and Slice 3 Preview ([#2045](https://github.com/lushly-dev/afd/issues/2045)). [Proposal](./active/pointing/pointing.proposal.md) |
| [Patterns](./active/patterns/STATUS.md) | Patterns above components: what a recurring piece of interface is for, what every implementation must keep and what may change, portable role/name/geometry gates in Specimen, saved screen-region copies with revision and provenance, Pack Format 2, and Umbel `components` plugin serving. Phase 0 ([#1966](https://github.com/lushly-dev/afd/issues/1966), [#2122](https://github.com/lushly-dev/afd/pull/2122)) closed 2026-11-22 with owner decision **go with changes**; Phase A specification ([#2133](https://github.com/lushly-dev/afd/issues/2133)) open in [spec.md](./active/patterns/spec.md) and [Umbel Amendment A31](../../endpoints/umbel/docs/plugins/components/spec.md#amendment-a31-patterns-and-saved-copies-1073) with all ten scenarios verified; Phases B–D gated on Phase A exit. [Proposal](./active/patterns/patterns.proposal.md) |
| [Screens from Jobs](./active/screens-from-jobs/STATUS.md) | The screen in a job's state as the unit seen and checked: an AFD `.scenario.yaml` drives a fresh Specimen browser render via a private `integrations/specimen-afd-runner` (Specimen T11, [#1212](https://github.com/lushly-dev/afd/issues/1212)), capturing marked steps into Design Decisions capture sets while keeping headless execution unchanged. Approved 2026-11-22 under epic [#1109](https://github.com/lushly-dev/afd/issues/1109) with eleven jobs split into three slices; Phase 1 (`afd-testing`) is planned and unblocked, Phases 2–6 follow Design Decisions Phase 1/4; status in [STATUS.md](./active/screens-from-jobs/STATUS.md) |
| [Scales](./active/scales/STATUS.md) | Two-stage size system — hand-picked `ref.*` ramps (spacing, paired type size/line, radius, target) plus purpose-named semantic tokens with governed off-ramp reasons and a coordinated `contractVersion: 3` cutover across `violet-elements`, Loam and repo-wide consumers (derived-value transforms dropped). Approved and promoted 2026-11-22 under epic [#1111](https://github.com/lushly-dev/afd/issues/1111) with eight jobs as scenarios across Slice 1 Phase 1 ([#2195](https://github.com/lushly-dev/afd/issues/2195), planned), Slice 1 Phase 2 ([#2197](https://github.com/lushly-dev/afd/issues/2197), blocked on #2195), and Slice 2 Phase 3 ([#2198](https://github.com/lushly-dev/afd/issues/2198), optional, blocked on #2195). [Proposal](./active/scales/scales.proposal.md) |
| [Design Decisions](./active/design-decisions/STATUS.md) | Content-addressed Specimen capture sets, side-by-side variant comparison, committed decision records with reasons and evidence, a review that surfaces only what gates cannot settle (grouped by cause, largest first), and human-elicited confirmations on `endpoints/specimen-server`. Approved 2026-11-22 under epic [#1108](https://github.com/lushly-dev/afd/issues/1108) with ten jobs across Slice 1 (Phases 1–5: [#2209](https://github.com/lushly-dev/afd/issues/2209)–[#2213](https://github.com/lushly-dev/afd/issues/2213)) and Slice 2 (Phase 6: [#2214](https://github.com/lushly-dev/afd/issues/2214)); Phase 1 ([#2209](https://github.com/lushly-dev/afd/issues/2209)) is planned and unblocked. [Proposal](./active/design-decisions/design-decisions.proposal.md) |
| [Loam OS](./active/loam-os/STATUS.md) | An AFD-native operating system built for agents first and used by people through a web-based Loam shell: starts as a Rust host under `endpoints/` on Umbel's host library that runs branch validation in isolated, credential-free Linux containers (M0–M2), then agent sessions (M3), a person's approval surface (M4), a bootable image (M5), and the Loam shell desktop beyond M5. Approved and promoted from `proposed/agent-os` on 2026-11-25 under epic [#2595](https://github.com/lushly-dev/afd/issues/2595) with all eighteen jobs kept in proposed build order; M0 ([#2596](https://github.com/lushly-dev/afd/issues/2596)) is planned. [Proposal](./active/loam-os/loam-os.proposal.md) |
| [Agent-First Design](./active/agent-first-design/STATUS.md) | Versioned AFD default result-state patterns (`afd-defaults`), copied pattern overrides with source digests and waivers, modality-enforced persona panels with blind calibration, a unified pre-ship decision card queue and release gate, and post-release command-journal observation. Phase 0 closed 2026-11-24 (**go with changes**, [#2530](https://github.com/lushly-dev/afd/pull/2530)); Phase A exit approved 2026-11-24 under epic [#2544](https://github.com/lushly-dev/afd/issues/2544) with [spec.md](./active/agent-first-design/spec.md) (15 commands, 12 verified scenarios, [#2537](https://github.com/lushly-dev/afd/pull/2537)), companion amendments applied to Patterns, Design Decisions and Screens from Jobs, and Q4 confidence-band cleanup filed as [#2545](https://github.com/lushly-dev/afd/issues/2545); Phases B–D follow. [Proposal](./active/agent-first-design/agent-first-design.proposal.md) |

## Complete Features

| Feature | Description |
|---------|-------------|
| [Verified Recovery](./complete/verified-recovery/STATUS.md) | Errors' recovery advice that a program can follow and a test can check: known wrong suggestions fixed across `botcore-factory` and Umbel with Python `expect.error.suggestion` parity ([#2433](https://github.com/lushly-dev/afd/pull/2433), [#2448](https://github.com/lushly-dev/afd/pull/2448), [#2459](https://github.com/lushly-dev/afd/pull/2459)); `CommandError.recovery` (`call`, `fix-input`, `retry`, `external`, `stop`) specified in [`spec/recovery.md`](../../spec/recovery.md) with schema, vectors and wire fixtures across TypeScript, Python, Rust and C++ ([#2442](https://github.com/lushly-dev/afd/pull/2442)); scenario `expect.error.recovery` and `follow` in TypeScript and Python runners plus recoveries on every factory refusal ([#2476](https://github.com/lushly-dev/afd/pull/2476)); small-worlds exploration pilot on the factory ([#2518](https://github.com/lushly-dev/afd/pull/2518)); and engine-emitted recoveries with shared callability checks and updated default server instructions in all four languages ([#2539](https://github.com/lushly-dev/afd/pull/2539)). Completed 2026-11-25 (closes [#2424](https://github.com/lushly-dev/afd/issues/2424)); remaining follow-ups are tracked as [#2607](https://github.com/lushly-dev/afd/issues/2607)–[#2613](https://github.com/lushly-dev/afd/issues/2613). [Proposal](./complete/verified-recovery/verified-recovery.proposal.md) |
| [Violet in Loam](./complete/violet-app/STATUS.md) | Violet's token trees in local Loam as a `violet-tree` document type (`@lushly-dev/loam-app-violet`) running `@lushly-dev/violet-afd/worker` in the page: 7 `violet-afd` gaps ([#1942](https://github.com/lushly-dev/afd/pull/1942)), write-path hardening ([#2090](https://github.com/lushly-dev/afd/pull/2090)), Loam's DTCG tree ([#2166](https://github.com/lushly-dev/afd/pull/2166), exit criterion 3), plugin specification ([#2251](https://github.com/lushly-dev/afd/pull/2251)), first slice with 15/15 scenarios, 72 Specimen captures + axe checks and D109 boundary enforcement ([#2355](https://github.com/lushly-dev/afd/pull/2355), exit criteria 1–2), constraint audit + DTCG round-trip ([#2513](https://github.com/lushly-dev/afd/pull/2513)), and owner desktop Loam verification (exit criterion 4; manual WebView2 checks for §9.3 steps 3 and 5 waived in favor of automated coverage). Completed 2026-11-24 (closes [#1556](https://github.com/lushly-dev/afd/issues/1556)); mounting `violet-server` behind the same engine port awaits Loam phase 5 / plugin-engine ([#1781](https://github.com/lushly-dev/afd/issues/1781)), and Lushly's tree stays in the private Lushly repository. [Proposal](./complete/violet-app/violet-app.proposal.md) |
| [MCP Authorization](./complete/mcp-authorization/STATUS.md) | OAuth 2.1 protected-resource layer (M1–M8), per-caller `ResourceProvider` (`cacheScope: "private"`), `tasks/*` authorization, and host-verified confirmation (`HumanRelay`, private relay evidence and `inputDigests`), specified in [`spec/authorization.md`](../../spec/authorization.md) and [`spec/authorization.json`](../../spec/authorization.json) (13/13 sections, 184 cases) and implemented across Rust (#798, #810, #835, #1898), TypeScript (#934, #1050, #2034, #2338, #2514) and Python (#2025, #2134, #2162, #2193, #2360, #2541); C++ is stdio-only by design. Completed 2026-11-24 with all sub-issues closed (closing [#1552](https://github.com/lushly-dev/afd/issues/1552)); Decision A8 (issuer claim profiles) remains separate follow-on work recorded in the status file. [Proposal](./complete/mcp-authorization/mcp-authorization.proposal.md) |
| [Output Budgets](./complete/output-budgets/STATUS.md) | Per-command output budgets ([`spec/output-budgets.md`](../../spec/output-budgets.md), B1–B8, Umbel D64): declarations, per-call asks over MCP and in process, post-handler size checks (`OUTPUT_BUDGET_EXCEEDED` on reads, warning on mutations), batches/pipelines, journal/replay, `spec/vectors/output-budgets.json`, `spec/meta-tools.json` and skills across Rust ([#633](https://github.com/lushly-dev/afd/pull/633)), Python ([#2186](https://github.com/lushly-dev/afd/pull/2186)), C++ ([#2187](https://github.com/lushly-dev/afd/pull/2187)) and TypeScript ([#2215](https://github.com/lushly-dev/afd/pull/2215)). Completed 2026-11-22 (closes [#1555](https://github.com/lushly-dev/afd/issues/1555)); streamed chunks remain unchecked per B7 (open follow-up in status file). |
| [MCP Resources and Skills](./complete/mcp-resources-skills/STATUS.md) | MCP resources (R1–R6), the Skills over MCP extension (`io.modelcontextprotocol/skills`, S1–S7), extra tool `_meta` (T1–T3) and advertised input schemas (V1–V2) specified in [`spec/mcp-resources.md`](../../spec/mcp-resources.md) and implemented across Rust (#608), TypeScript (#615, #2138), Python (#1981, #2192) and C++ (#1983, #2226), with [`spec/vectors/mcp-resources.json`](../../spec/vectors/mcp-resources.json) enforced across all four languages by `alfred parity` (#1986). Completed 2026-11-22 (closing epic [#1554](https://github.com/lushly-dev/afd/issues/1554)); MCP prompts and Loam-driven `DirectClient` resources remain separate follow-up scope recorded in the status file. |
| [Ideas](./complete/ideas/STATUS.md) | Umbel's `ideas` plugin v1 daily loop (14 commands, host records B1–B4, review host H0–H3, local/private-network review page `public_origin`, first-use fixes) shipped and confirmed in daily use on 2026-11-22 ([#2005](https://github.com/lushly-dev/afd/issues/2005)); epic [#1548](https://github.com/lushly-dev/afd/issues/1548) closed. Partially complete archive: host B6 ([#2003](https://github.com/lushly-dev/afd/issues/2003)) and P18 manifest instructions ([#2011](https://github.com/lushly-dev/afd/issues/2011)) moved under Umbel epic [#1546](https://github.com/lushly-dev/afd/issues/1546); optional cloud OAuth ([#2007](https://github.com/lushly-dev/afd/issues/2007)), P14 scenario runner ([#2009](https://github.com/lushly-dev/afd/issues/2009)) and P15 relay ([#2010](https://github.com/lushly-dev/afd/issues/2010)) stay open unparented; post-v1 phases ([#2012](https://github.com/lushly-dev/afd/issues/2012)–[#2015](https://github.com/lushly-dev/afd/issues/2015)) closed as not planned |
| [MCP Tasks](./complete/mcp-tasks/STATUS.md) | Long-running commands as MCP tasks under SEP-2663 (`io.modelcontextprotocol/tasks`): shared contract ([`spec/command-metadata.md#tasks`](../../spec/command-metadata.md#tasks)), Rust server pilot (#817), TypeScript server and client (#2034, [#1971](https://github.com/lushly-dev/afd/issues/1971)), Python server and client (#2134, [#1972](https://github.com/lushly-dev/afd/issues/1972)), and the shared todo `--suite tasks --mode modern` acceptance suite. Completed 2026-11-22 with all four phases and sub-issues merged (closing [#1553](https://github.com/lushly-dev/afd/issues/1553)); C++ is not planned. |
| [To-do Reference Example](./complete/todo-reference/STATUS.md) | The to-do examples brought up to current AFD in all four languages: approvals, undo with `todo-restore`, history, the journal and replay, contexts, SQLite storage shared by TypeScript and Python, and ten jobs run as scenarios in CI; the FAST-AF and React pages on `violet-elements`; the DirectClient copilot on the tool surface with `allow` and approvals; one 50-case suite every backend passes. Completed 2026-11-18 with all six exit criteria met. Partially complete archive: open follow-ups are listed in the status file, among them [#1317](https://github.com/lushly-dev/afd/issues/1317) and [#1329](https://github.com/lushly-dev/afd/issues/1329) |
| [Component Briefs](./complete/component-briefs/STATUS.md) | One call that tells an agent how to use every component on a page: Specimen builds an evidence-labelled pack per component library, and Umbel's `components` plugin serves it in batches; agents here get it from the `umbel` server in `.mcp.json`, and a hook names it before the first `violet-*` write. Completed 2026-11-13 with all ten exit criteria met as the owner decided them; phase D and the remaining follow-ups are GitHub issues, listed in the status file |
| [Specimens](./complete/specimens/STATUS.md) | Specimen, the native component bench that replaced Storybook for AFD's FAST-AF stories and Lushly's, on npm as a preview. T01 to T08 and T12 done; completed 2026-11-14. Partially complete archive: optional T09 to T11 are [#1211](https://github.com/lushly-dev/afd/issues/1211) and [#1212](https://github.com/lushly-dev/afd/issues/1212), follow-ups [#1169](https://github.com/lushly-dev/afd/issues/1169) |
| [Platform Monorepo](./complete/platform-monorepo/STATUS.md) | Foundations and endpoints imported into this repository with provenance (phases 0 to 4), and Botcore's publishing cut over; completed 2026-11-14. Partially complete archive: the other publisher cutovers and the source repositories' retirement are the owner's, in [#463](https://github.com/lushly-dev/afd/issues/463) and [#783](https://github.com/lushly-dev/afd/issues/783) |
| [MCP 2026-07-28 upgrade](./complete/mcp-2026-07-28/STATUS.md) | Every AFD MCP surface on the stateless 2026-07-28 spec, served dual-era, and the follow-on proposals (phases 0 to 7); completed 2026-11-14. Partially complete archive: Python and C++ structured results ([#465](https://github.com/lushly-dev/afd/issues/465)) are done, and phase 8's legacy removal is the owner's decision in [#469](https://github.com/lushly-dev/afd/issues/469) |
| [MCP Confirmations](./complete/mcp-confirmations/STATUS.md) | `confirmPrompt` enforced through MCP elicitation with an acknowledgement fallback, in TypeScript, Python and Rust servers and TypeScript's client; completed 2026-11-14. Partially complete archive: C++ [#467](https://github.com/lushly-dev/afd/issues/467), Python's client [#468](https://github.com/lushly-dev/afd/issues/468) and the phase 4 decision [#552](https://github.com/lushly-dev/afd/issues/552) |
| [Versioning and Release](./complete/versioning/STATUS.md) | Independent semver and release paths for each implementation and the shared contract, with first publications and drift checks; completed 2026-11-14. Partially complete archive: declaring core 1.0, decided 2026-11-21, is [#1926](https://github.com/lushly-dev/afd/issues/1926) and live per-language site versions [#551](https://github.com/lushly-dev/afd/issues/551) |
| [Hybrid Tool Strategy](./complete/hybrid-tool-strategy/STATUS.md) | A fourth MCP tool strategy, up to 8 first-class tools beside the meta-tools, specified and implemented in TypeScript, Python and Rust; completed 2026-11-14. C++ ([#1202](https://github.com/lushly-dev/afd/issues/1202)) and the four-language step ([#1203](https://github.com/lushly-dev/afd/issues/1203)) followed on 2026-11-18, so every language serves it and loads `spec/vectors/tool-strategies.json` |
| [Shared Plugin Manifest](./complete/plugin-manifest/STATUS.md) | One manifest format for Loam apps and Umbel plugins: the host-neutral core in `spec/`, Loam's profile, validation, packaging and mounted discovery (steps 0 to 2); completed 2026-11-14. Partially complete archive: optional and triggered steps 3 to 8 are [#1204](https://github.com/lushly-dev/afd/issues/1204) to [#1208](https://github.com/lushly-dev/afd/issues/1208) and [#884](https://github.com/lushly-dev/afd/issues/884), with follow-ups [#1209](https://github.com/lushly-dev/afd/issues/1209) and [#1210](https://github.com/lushly-dev/afd/issues/1210) |
| [Browser-Safe Direct Registry](./complete/browser-direct-registry/proposal.md) | The `@lushly-dev/afd-server/direct` entry point: the validating registry, journal, WebCrypto approvals, AFD contexts with a per-call `activeContext`, and an optional MCP tool surface, in a browser, worker or webview. Completed 2026-11-01; status in [STATUS.md](./complete/browser-direct-registry/STATUS.md) |
| [Declared Context Fields](./complete/declared-context-fields/proposal.md) | Host-declared, schema-validated request values carried in `_meta` and in process, validated on every surface, listed by `server/discover` and `afd-help`, and kept by the journal when declared safe; in TypeScript, Python, Rust and C++. Completed 2026-10-31; status in [STATUS.md](./complete/declared-context-fields/STATUS.md) |
| [AFD Bot (Alfred)](./complete/afd-bot/proposal.md) | Partially complete archive: lint, parity and quality commands shipped; unbuilt schema/release checks and Tier 2 commands await disposition in #553. |
| [AFD PyPI Publishing](./complete/afd-pypi-publishing/) | Python package publishing to PyPI |
| [Auth Adapter](./complete/auth-adapter/) | Provider-agnostic authentication adapter for AFD servers |
| [C++ Support](./complete/cpp-support/) | Engine-free C++20 AFD core, published as `cpp-v0.1.0`; shared conformance and fresh tagged CMake consumers verified (#270, #327). |
| [Command Prerequisites](./complete/command-prerequisites/) | Declarative `requires` field for planning-order dependencies |
| [Contextual Tool Loading](./complete/contextual-tool-loading/contextual-tool-loading.proposal.md) | Partially complete archive: context commands and flat scoping shipped; suggestions, hierarchy and UI-derived defaults await disposition in #554. |
| [Command Trust Config](./complete/command-trust-config/) | Per-command trust levels and exposure control |
| [Command Exposure & Undo](./complete/command-exposure-undo/) | Command visibility and undo support |
| [Command Pipeline](./complete/command-pipeline/) | Declarative command chaining |
| [Handoff Pattern](./complete/handoff-pattern/) | Real-time protocol handoff |
| [Lazy Loading & Discovery](./complete/lazy-loading-discovery/) | `afd-discover`/`afd-detail`/`afd-call` tool strategy for lazy command enumeration |
| [Middleware Defaults](./complete/middleware-defaults/) | Zero-config observability bundle (`defaultMiddleware()`) |
| [Platform Utils](./complete/platform-utils/) | Cross-platform `exec`, `findUp` and GitHub/package-manager connectors in `afd-core` (#92) and Python (#155) |
| [Output Shape Predictability](./complete/output-shape-predictability/) | Optional `output` Zod schema for agent response shape introspection |
| [Rust Parity Closure](./complete/rust-parity/) | Closed the export-surface gap between TypeScript and Rust (78 missing exports to 0 in #181), tracked with `alfred parity`. The remaining behavioral work is Wave 2 of Language Parity Closure. |
| [Schema Complexity Scoring](./complete/schema-complexity-scoring/) | Weighted input schema complexity analysis |
| [Schema Examples](./complete/schema-examples/) | Concrete input examples on commands for agent consumption |
| [Semantic Quality Validation](./complete/semantic-quality-validation/) | Cross-command surface analysis for naming, schema overlap, injection |
| [View State](./complete/view-state/) | Unified UI view state management via `@lushly-dev/afd-view-state` commands |

## Proposed Features

| Feature | Description |
|---------|-------------|
| [Agent Engine](./proposed/agent-engine/proposal.md) | Research and proposed new packages for modular, controllable, ongoing agentic work |
| [Chat History Panel](./proposed/chat-history-panel/) | Chat history UI component |
| [Code Client](./proposed/code-client/) | Code-based client research |
| [Design to Code](./proposed/design-to-code/) | Figma-to-code generation pipeline |
| [MCP Client Features](./proposed/mcp-client-features/STATUS.md) | Readiness of AFD servers, Botcore and Umbel for Claude's MCP client features (Skills over MCP, Tasks, Elicitation, tool search and tracked File Uploads) under epic [#2497](https://github.com/lushly-dev/afd/issues/2497). [Proposal](./proposed/mcp-client-features/mcp-client-features.proposal.md) |
| [MCP Progress](./proposed/mcp-progress/mcp-progress.proposal.md) | A progress hook on the command context, delivered as MCP progress notifications, `/stream` chunks and DirectClient callbacks (MCP follow-on, rank 3) |
| [Multi-Tool Registration](./proposed/multi-tool-registration/) | Batch MCP tool registration |
| [Plugin Discovery](./proposed/plugin-discovery/) | Auto-discovery of AFD plugins |
| [Rust Distribution](./proposed/rust-distribution/) | Rust-based distribution layer |
| [Rust Support](./proposed/rust-support/) | Core crate published as 0.1.0; broader MCP transport and distribution proposal remains open |
| [Skill Knowledge Layer](./proposed/skill-knowledge-layer/) | Skills as structured knowledge for agents |

### Closeout (2026-11-14)

The active plans were reviewed again against `main`, after the reconciliation below. Plans that
were near complete, or whose remaining work is only blocked, deferred or the owner's, moved to
`complete/`: Specimens, Platform Monorepo, the MCP 2026-07-28 upgrade, MCP Confirmations,
Versioning and Release, Hybrid Tool Strategy and the Shared Plugin Manifest. Component Briefs had
already moved on 2026-11-13. Each one's status file and proposal name the issues that carry what
remains; eleven were filed for it ([#1202](https://github.com/lushly-dev/afd/issues/1202) to [#1212](https://github.com/lushly-dev/afd/issues/1212)), and the rest already existed.
Software Factory moved to `active/` with a status file, because Phase 1 has started. The other
active plans keep unblocked work: a language port or substantial product scope. Specimen, Violet
and Botcore provenance records follow the moved and edited files.

### Lifecycle reconciliation (2026-11-13)

Reviewed every feature folder against its status ledger, current source and merged history on
`main` at `1024546b`; closure blockers were checked against GitHub. Implementation test suites
were not rerun to infer feature completion.

- Specimens' proposal and original review moved beside its active implementation plan; it is
  one active feature, not a second unstarted proposal. Import provenance follows the move.
- Every active folder now has a `STATUS.md`. Its linked evidence and remaining gates take
  precedence over historical snapshots, candidate notes and unchecked design checklists.
- No remaining active plan met all of its closure criteria. In particular, the Python export
  subplan stays active under Language Parity Closure; its missing-name count is still 88.
- Alfred and Contextual Tool Loading remain archives of shipped scope with explicit partial
  completion and existing follow-ups [#553](https://github.com/lushly-dev/afd/issues/553) and
  [#554](https://github.com/lushly-dev/afd/issues/554). No remainder was silently dropped.
- Rust Support stays proposed with implemented core/WASM/server scope identified. Progress
  notifications stay proposed: Rust's task status-message hook is not that delivery mechanism.
- The older audit [#537](https://github.com/lushly-dev/afd/pull/537) was still open and unmerged
  when checked; its proposed status files were not evidence of work on `main`.

Verification for this reconciliation: local Markdown links and anchors were checked with a
Markdown parser (code samples excluded), every active folder has a status ledger, and every
feature folder is indexed. Specimen's three provenance checks and the repository version check
passed. `pnpm verify` stopped at preflight: this machine has no `cargo` or `openssl`, so the
planned TypeScript, Specimen and Loam suites were **not run**.

### Historical lifecycle audit (2026-10-25, #349)

Each proposed folder was compared with the code on `main`, merged PRs and the active and complete plans. A folder moves only when the evidence supports it.

| Folder | Disposition | Evidence and remaining scope |
|--------|-------------|------------------------------|
| platform-utils | Complete (moved) | TypeScript #92, Python #155; no remaining scope |
| rust-support | Proposed, partially shipped | Core, WASM, crates.io 0.1.0 (#379) and the `server` feature (#394) shipped; `cargo-dist`, proc macro and examples, and client interop remain |
| rust-distribution | Proposed (research) | Mint is a private framework in another repository; nothing in this repo |
| code-client | Proposed (research) | No code-generation client in `packages/client` |
| design-to-code | Proposed | No Figma or schema-export code in the repo |
| multi-tool-registration | Proposed | No `afd register` command in `packages/cli` |
| plugin-discovery | Proposed | No `AfdPlugin` or discovery option in `afd-server` |
| skill-knowledge-layer | Proposed | No `skill` option, `validateCommandSkills()` or `skill-docs` command |
| chat-history-panel | Proposed | No session-history UI; `packages/examples/chat` is a WebSocket server |

At that audit, no folder was superseded. The current lifecycle reconciliation above updates
that snapshot; the older disposition notes remain historical evidence.

## Feature Structure

Each feature folder contains:

```
feature-name/
├── <feature>.proposal.md  # The what/why (required; older folders name it proposal.md)
├── scenarios/       # The jobs the feature serves, one *.scenario.yaml each (required when it adds or changes commands)
├── spec.md          # The how (after approval)
├── STATUS.md        # Exactly what is done and not done, how it was verified, and follow-ups not yet issues; kept current by every session once work starts
└── assets/          # Diagrams, screenshots (optional)
```

> **Plan files and `.gitignore`.** `.gitignore` ignores `*.plan.md` everywhere except `docs/features/active/` (and `PLAN/` and `archive/`). A `*.plan.md` written under `proposed/` or `complete/` is silently left out of commits; `git status` does not list it. Name plans outside `active/` without the `.plan` suffix, for example `complete/<feature>/plan.md`, and check that `git status` shows any new plan file before committing.

A status file exists so that an agent never has to scan the codebase to learn what is current: it names what is done with evidence, what is not, and what future sessions must know. The [Umbel status](../../endpoints/umbel/docs/STATUS.md) is the reference shape. Each step has its own line there, made before the step starts, and no sentence says which steps are done or next: a line every step rewrites puts every open pull request in conflict. Each file's "How to keep this file" has its rules. A status stays an index of what is current: when its history outgrows a few screens, its finished phases' detail, merged step lines, closed follow-ups and session log move verbatim to dated `STATUS.archive-*.md` files beside it, each at most about 45 KB so one read holds it, as Loam's and Umbel's did on 2026-11-23.

## Jobs first

A feature that adds or changes commands starts from the jobs it serves. Each job is written as an AFD scenario file in the feature's `scenarios/` folder before the commands are specified, and the proposal is held to them:

- A job that cannot be written with the drafted commands is a gap in the design.
- A drafted command no job uses is cut, or the proposal says why it stays.
- The exit criteria start from "every scenario passes".
- Readers who did not write the jobs walk the paths before the owner is asked to decide.
- The owner cuts, adds and ranks the jobs.

Once the feature is built, the same files move beside the code and run as its acceptance tests. The steps, the checks that work before anything is built, and what a scenario cannot express are in [jobs first](../../.claude/skills/afd/references/jobs-first.md). Features with no commands (tooling, CI, releases, documentation) skip this.

## Workflow

```
Proposed → Review → Active → Implementation → Complete
```

Moving a feature to `active/` opens its epic, an issue of type `Epic` whose sub-issues are the work, and its `STATUS.md` names it on the line under the title; the epic closes when its whole scope is done, which for an epic other plans share is not when this one completes ([epics](../../.claude/skills/triage-issues/references/epics.md)).

A proposal that adds or changes commands is ready for review when its jobs are written as scenarios, they pass the checks, and readers who did not write them have walked the paths. A revision needs the walk again only when it adds jobs or commands.
