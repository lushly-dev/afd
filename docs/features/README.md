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
| [Loam](../../endpoints/loam/README.md) | AFD Loam, an application shell for AFD apps: a TypeScript kernel for the browser, Tauri desktop and hosted server, and a FAST-AF chrome on a Violet design foundation, with shell-level projects, documents, identity, settings, overlays, a copilot and an in-shell app builder. Phases 0 to 2 have exited (the kernel and chrome, the app contract, scope, projects and documents); phases 3, identity, and 6, hosts, are in progress. Unpublished. Documented in `endpoints/loam/`; exact state in its [STATUS.md](../../endpoints/loam/docs/STATUS.md) |
| [Mail](./active/mail/STATUS.md) | Approved engine specification; the skeleton, store, iCloud sync, read/search commands, all of B5 (the MCP server, background sync and account removal: #1138, #1144, #1177) and B7's iCloud acceptance run (#1187) are merged, and phase C is under way on iCloud (C1 and both parts of C2 merged). The owner deferred Gmail (B0, B6 and B7's Gmail half) on 2026-11-14; it, the later engine phases and the Loam app remain. |
| [Ideas](./active/ideas/STATUS.md) | Active daily-loop implementation. Host B1 to B4, plugin C1 to C5 and the local person page H3 are merged, and the owner's first use ran on 2026-11-13 (fixes in #1186); whether it meets C5's exit is his call. Host B5/B6, the hosted exit and later plan scope remain. |
| [Python Parity Closure](./active/python-parity/STATUS.md) | Active name-cleanup subplan of Language Parity Closure. Fresh Alfred measurement: 88 missing names on 2026-11-13, matching its budget; core ergonomics are done, pipeline/similarity exports and remaining helpers are not. |
| [Language Parity Closure](./active/parity-closure/STATUS.md) | Shared-contract vectors and stabilization have landed. Runtime and surface gaps, C++'s MCP target, Python defaults/CLI/auth, and the contract 1.0 decision remain. |
| [Software Factory](./active/software-factory/STATUS.md) | The merge lane from Lushly's fleet v2 as a shared botcore plugin: cells hand reviewed branches to one lane that validates, merges and ejects, and a foreman starts cells on the plan with the most room. Phase 0 is done; Phase 1 is in progress: botcore's host changes (#1181), the plugin's foundation and intake (#1183), and its queue, events and records (#1185) are merged. [Proposal](./active/software-factory/software-factory.proposal.md) |
| [MCP Resources and Skills](./active/mcp-resources-skills/STATUS.md) | Specification, Rust and TypeScript are merged. Python, C++ and the final vectors/conformance work remain; prompts are separate future scope. |
| [MCP Authorization](./active/mcp-authorization/STATUS.md) | Shared specification and Rust/TypeScript token verification and pre-dispatch scopes are merged. Principal-bound confirmations are in all three server languages. Python authorization and remaining host-verified confirmation ports are open. |
| [MCP Tasks](./active/mcp-tasks/STATUS.md) | Shared specification and Rust's owner-checked task store and server pilot merged. TypeScript, Python and a shared task-capable todo case remain. |
| [Output Budgets](./active/output-budgets/STATUS.md) | Specification and Rust are merged. TypeScript, Python, C++ and the final vectors/skills step remain. |
| [Factory Gateway](./active/factory-gateway/factory-gateway.proposal.md) | The factory's one door to GitHub: a service in `botcore-factory`, on the always-on machine, that holds the credential as a GitHub App, serves typed commands to each kind of caller (cell, session, foreman, lane, owner) with its own token, keeps GitHub as the record of claims with itself as their only writer, merges only heads the lane recorded as validated, shares and settles GitHub reads, journals every write with the caller it acted for, and wakes the lane and foreman on events. An MVP (G1, one writer) then milestones to review records, events, no credential outside the gateway and interactive sessions, each updating the skills, scripts and `AGENTS.md` that use it under a checked process manifest. Active by the owner's direction of 2026-11-14 with fifteen jobs as scenarios, walked by three readers and reviewed; nothing built; status in [STATUS.md](./active/factory-gateway/STATUS.md) |
| [To-do Reference Example](./active/todo-reference/todo-reference.proposal.md) | Bring the to-do examples up to current AFD in all four languages: fixes first, then approvals, undo with `todo-restore`, the journal and deterministic context, contexts, local-db storage and jobs run in CI; FAST-AF and React frontends on `violet-elements`; DirectClient through the tool surface. Started 2026-11-14 at the owner's request; phase 1 (fixes) merged in #1231; phase 2 (the TypeScript reference: undo, approvals, history, the journal, CI checks and SQLite storage) done in #1248 to #1263; phase 3 (the FAST-AF and React pages on violet-elements, approvals in the page) done in #1275 and #1276; phase 4 (the copilot on DirectClient with `allow` in #1281, its page with in-page approvals and the view in #1303) done; phase 5 (the other languages: Python in #1319, Rust in #1335, C++ next) in progress; status in [STATUS.md](./active/todo-reference/STATUS.md) |

## Complete Features

| Feature | Description |
|---------|-------------|
| [Component Briefs](./complete/component-briefs/STATUS.md) | One call that tells an agent how to use every component on a page: Specimen builds an evidence-labelled pack per component library, and Umbel's `components` plugin serves it in batches; agents here get it from the `umbel` server in `.mcp.json`, and a hook names it before the first `violet-*` write. Completed 2026-11-13 with all ten exit criteria met as the owner decided them; phase D and the remaining follow-ups are GitHub issues, listed in the status file |
| [Specimens](./complete/specimens/STATUS.md) | Specimen, the native component bench that replaced Storybook for AFD's FAST-AF stories and Lushly's, on npm as a preview. T01 to T08 and T12 done; completed 2026-11-14. Partially complete archive: optional T09 to T11 are [#1211](https://github.com/lushly-dev/afd/issues/1211) and [#1212](https://github.com/lushly-dev/afd/issues/1212), follow-ups [#1169](https://github.com/lushly-dev/afd/issues/1169) |
| [Platform Monorepo](./complete/platform-monorepo/STATUS.md) | Foundations and endpoints imported into this repository with provenance (phases 0 to 4), and Botcore's publishing cut over; completed 2026-11-14. Partially complete archive: the other publisher cutovers and the source repositories' retirement are the owner's, in [#463](https://github.com/lushly-dev/afd/issues/463) and [#783](https://github.com/lushly-dev/afd/issues/783) |
| [MCP 2026-07-28 upgrade](./complete/mcp-2026-07-28/STATUS.md) | Every AFD MCP surface on the stateless 2026-07-28 spec, served dual-era, and the follow-on proposals (phases 0 to 7); completed 2026-11-14. Partially complete archive: Python and C++ structured results ([#465](https://github.com/lushly-dev/afd/issues/465)) are done, and phase 8's legacy removal is the owner's decision in [#469](https://github.com/lushly-dev/afd/issues/469) |
| [MCP Confirmations](./complete/mcp-confirmations/STATUS.md) | `confirmPrompt` enforced through MCP elicitation with an acknowledgement fallback, in TypeScript, Python and Rust servers and TypeScript's client; completed 2026-11-14. Partially complete archive: C++ [#467](https://github.com/lushly-dev/afd/issues/467), Python's client [#468](https://github.com/lushly-dev/afd/issues/468) and the phase 4 decision [#552](https://github.com/lushly-dev/afd/issues/552) |
| [Versioning and Release](./complete/versioning/STATUS.md) | Independent semver and release paths for each implementation and the shared contract, with first publications and drift checks; completed 2026-11-14. Partially complete archive: declaring contract 1.0 is [#541](https://github.com/lushly-dev/afd/issues/541) and live per-language site versions [#551](https://github.com/lushly-dev/afd/issues/551) |
| [Hybrid Tool Strategy](./complete/hybrid-tool-strategy/STATUS.md) | A fourth MCP tool strategy, up to 8 first-class tools beside the meta-tools, specified and implemented in TypeScript, Python and Rust; completed 2026-11-14. Partially complete archive: C++ [#1202](https://github.com/lushly-dev/afd/issues/1202) (blocked on [#341](https://github.com/lushly-dev/afd/issues/341)) and the four-language step [#1203](https://github.com/lushly-dev/afd/issues/1203) |
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
| [Agent-First Design](./proposed/agent-first-design/agent-first-design.proposal.md) | How design work is done when a person and an agent build an AFD app: a fixed architecture, default patterns, voice and guidance that a company or product can customize, replace or add to, a panel of agents that reviews before a person does, and a person who decides at set points and before release. It frames Patterns, Design Decisions, Screens from Jobs, Pointing and Scales. Scaffold 2026-11-14: a model, thirteen draft jobs as sentences with the owner's rank, a design direction and a specification of the phase 0 bench, whose application has seventeen jobs as scenarios against drafted commands. The proposal's own jobs have no commands or scenarios yet; status in [STATUS.md](./proposed/agent-first-design/STATUS.md) |
| [Chat History Panel](./proposed/chat-history-panel/) | Chat history UI component |
| [Code Client](./proposed/code-client/) | Code-based client research |
| [Design Decisions](./proposed/design-decisions/STATUS.md) | Draft with scenarios, one fresh-reader walk and an independent review, revised 2026-11-13. Owner ranking and shared-convention decisions remain; nothing implemented. |
| [Design to Code](./proposed/design-to-code/) | Figma-to-code generation pipeline |
| [MCP Progress](./proposed/mcp-progress/mcp-progress.proposal.md) | A progress hook on the command context, delivered as MCP progress notifications, `/stream` chunks and DirectClient callbacks (MCP follow-on, rank 3) |
| [Multi-Tool Registration](./proposed/multi-tool-registration/) | Batch MCP tool registration |
| [Patterns](./proposed/patterns/patterns.proposal.md) | Patterns above components: what a recurring piece of interface is for, what every implementation must keep and what may change, with gates written against roles, names and geometry that Specimen runs on any implementation; a working region saved as a copy with its revision and provenance; the component pack and Umbel's `components` plugin extended to hold and serve them. First draft 2026-11-12 with nine jobs as scenarios; nothing implemented or measured, and phase 0 tests its claims before any format; status in [STATUS.md](./proposed/patterns/STATUS.md) |
| [Plugin Discovery](./proposed/plugin-discovery/) | Auto-discovery of AFD plugins |
| [Pointing](./proposed/pointing/STATUS.md) | Draft with scenarios, one fresh-reader walk and an independent review, revised 2026-11-13. Owner ranking and shared-convention decisions remain; nothing implemented. |
| [Rust Distribution](./proposed/rust-distribution/) | Rust-based distribution layer |
| [Rust Support](./proposed/rust-support/) | Core crate published as 0.1.0; broader MCP transport and distribution proposal remains open |
| [Scales](./proposed/scales/scales.proposal.md) | Sizes limited by a rule, named by purpose and derived from one another, in place of names by position, with Violet's reference transforms to be built. Scaffold 2026-11-13: problem, what exists and six draft jobs, waiting on the owner's answer to the direction; status in [STATUS.md](./proposed/scales/STATUS.md) |
| [Screens from Jobs](./proposed/screens-from-jobs/STATUS.md) | Draft with scenarios, one fresh-reader walk and an independent review, revised 2026-11-13. Uses Design Decisions' capture sets and review; owner approval remains, nothing implemented. |
| [Skill Knowledge Layer](./proposed/skill-knowledge-layer/) | Skills as structured knowledge for agents |
| [Violet in Loam](./proposed/violet-app/violet-app.proposal.md) | The first app of the owner's local Loam: Violet's token trees as a `violet-tree` document type in a native app that runs Violet's engine in the page, with the mounted `violet-server` behind the same port once phase 5 or a plugin's own engine allows. Approved 2026-11-16 with fifteen jobs as scenarios, twenty-two drafted commands and ten gaps in Violet (seven filed, #1322 to #1328); nothing implemented; status in [STATUS.md](./proposed/violet-app/STATUS.md) |
| [Zero Chat Tools](./proposed/zero-chat-tools/) | Canvas-aware AFD commands for Zero chat agent |

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
| zero-chat-tools | Proposed | Targets the external `fabric-ux-prototype` app |

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

A status file exists so that an agent never has to scan the codebase to learn what is current: it names what is done with evidence, what is not, and what future sessions must know. The [Umbel status](../../endpoints/umbel/docs/STATUS.md) is the reference shape.

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

A proposal that adds or changes commands is ready for review when its jobs are written as scenarios, they pass the checks, and readers who did not write them have walked the paths. A revision needs the walk again only when it adds jobs or commands.
