# Specimens status

Read this before the implementation plan. This ledger records verified progress, known gaps and the next gates. Last reconciled **2026-10-30** against reviewed branch source `ea359184` and fetched main base `40b6a7cc`. [PR #517](https://github.com/lushly-dev/afd/pull/517) records delivery of the branch milestones; use its merge state and resulting commit for current main delivery. Named source SHAs retain the measured/reviewed checkpoints.

## Keeping this current

- Sessions that change Specimen MUST update the affected state, last verification, remaining work and follow-ups here. Dates MUST be absolute and evidence MUST identify its revision and scope.
- **Done / merged** means the relevant content is verified on `main`. **Implemented on branch** means source and local checks exist but the work has not been verified on `main`. A passing pilot MUST NOT close a broader workstream or consumer migration gate.
- Historical receipts MUST remain dated and linked. Held, failed, diagnostic and ordinary runs MUST remain distinguishable. New measurements MUST NOT relabel earlier evidence.
- Follow-ups without issues or owners MUST remain explicit. Assignments and issue links MUST be added when work is actually taken on; the next implementation tasks are currently unassigned.
- This adopts the state/evidence/next-gate pattern in [Umbel status](../../../../endpoints/umbel/docs/STATUS.md) and [its phase architecture](../../../../endpoints/umbel/docs/architecture.md#9-phases). Specimen's proposal remains its acceptance contract; this ledger records progress against it.

## Current delivery state

| Area | State | Evidence and last verification | Still open |
| --- | --- | --- | --- |
| Native feasibility, consumer probes, calibrated macOS measurement, lazy runtime and optional worker | Done / merged as the bounded native milestone | [#476](https://github.com/lushly-dev/afd/pull/476), `05dad725`; ancestry and split contracts verified against `origin/main` on 2026-10-30 | Complete workstream 0 acceptance, incumbent parity and release admission |
| Cached fallback sourcemaps and warm Node CPU profiling | Implemented; [delivery record #517](https://github.com/lushly-dev/afd/pull/517) | `22c6106c`; [CPU study](cpu-hotspot-validation.md), ordinary layout-preserving comparisons and browser/HTTP regressions | Main delivery readback via #517; broader frozen-input performance evidence remains open |
| Updated monorepo resource matrix and runtime alias compatibility | Implemented; [delivery record #517](https://github.com/lushly-dev/afd/pull/517) | `71505dc6`, `bb54a03b`; [rerun](monorepo-resource-validation.md), 14 completed jobs / 832 verified captures on 2026-10-30 | Attribution of the CPU increase, frozen current dependency/assets and incumbent measurements |
| Full replacement | In progress; workstream 0 gate open | Native API, four AFD definitions, JSON CLI, static page and resource pilots | Compatibility adapter, full runner, operational replacement and qualified consumer cutover |
| Distribution | Quarantined | [Release inventory](../../../../scripts/release/inventory.json) and [split transition](../platform-monorepo/specimen-transition.md), read back on 2026-10-30 | Publisher authority and guarded release admission; no registry-publication claim |

The native core is `foundations/specimen`; AFD bindings are `integrations/specimen-afd`; the CLI is `endpoints/specimen-cli`. All three units are quarantined. The current native full suite has **100 tests**, with integration/CLI suites separate and **12 packed-artifact consumer checks**. The last code-bearing branch passed `pnpm check`, `pnpm test:specimen` and pre-push hooks on Node 24.21.0. These are local receipts, not hosted CI or consumer qualification.

## Documents and their roles

| Document | Role |
| --- | --- |
| [Implementation plan](implementation.md) | Current package architecture, ordered tasks, dependencies and acceptance evidence |
| [Proposal](../../proposed/specimens/specimens.proposal.md) | Full target behavior and workstreams 0–6; unimplemented requirements remain binding |
| [Original review](../../proposed/specimens/review.md) | Design findings and the rationale for the acceptance gates |
| [Native consumer pilot](consumer-validation.md) | Eight real components through authored native wrappers; no retained-CSF equivalence |
| [Whole-process measurement](resource-validation.md) | Calibration, accountable CPU/memory scope and resource guards |
| [Heap/cache lifetime](heap-lifetime-validation.md) | Lazy initialization and optional isolated runtime; diagnostic and ordinary evidence separated |
| [Worker reuse](worker-reuse-validation.md) | Historical 90/70-capture reuse/restart matrix |
| [Warm CPU study](cpu-hotspot-validation.md) | Confirmed map hotspot, fix, valid matched controls and excluded preliminary cohort |
| [Monorepo rerun](monorepo-resource-validation.md) | Latest ordinary resource results and historical input differences |

## Workstream progress

| Workstream | State | Verified progress | Exit still open / next gate |
| --- | --- | --- | --- |
| 0. Feasibility and observation | In progress | Native cases, scoped observations/diffs, screenshots/index, lifecycle, shell ceiling, calibrated whole-job accounting, optional worker and real consumer batches | Frozen inputs, representative incumbent cost/check equivalence, cross-driver context, complete budget accounting and accepted resource/latency tolerances; tasks T01–T04 |
| 1. Compatibility slice | Not started as a delivered adapter | Explicit metadata loading and native custom renderers only | Refreshed retained-CSF inventory; positive/failing reference pairs; exercised schema/context/token-map/runner contracts; validate/inspect and preview-first codemod; T05 |
| 2. Full runner and operations | Not started | Native action/checkpoint subset and static build are reusable foundations | Exact discovery/outcome parity, plays/helpers, axe, ready-checkpoint profiler, CEM/typechecks, scaffold and flake/worker integration; T06 |
| 3. Coverage and replacement gates | Not started | Unknown/unsupported observation channels remain explicit | Represented/asserted/verified obligations, coverage/suggest, Fastbot adapters and every rule's passing/failing retirement evidence; T07 |
| 4. Qualified cutover | Not started | No consumer Storybook configuration or required gate removed | Three qualifying full runner pairs per consumer, full consumer gates, human review, dependency report and rollback checkpoint; T08 |
| 5. Violet context and impact | Not started | Native theme contexts are available; these are not Violet node/snapshot support | Offline snapshots, versioned token/name maps, conservative dependencies, node matrices, impact and token fixtures; T09 |
| 6. Optional Violet lens | Not started | Native static index and screenshots exist | Lens over accepted commands with matching context, results and incomplete states; T10 |

### Workstream 0 verification block

- **State:** in progress, full exit criterion open.
- **Last verified:** 2026-10-30; source/package readback at `bb54a03b`, main import `05dad725`, and the linked ordinary monorepo resource receipts.
- **Done / merged:** bounded native observation/lifecycle/static tooling, command/CLI split, calibrated macOS recorder, lazy loading and opt-in worker. Initial native honesty fixtures and the five-case capture-only interpretation experiment are recorded in the implementation history.
- **Implemented on branch:** cached dev maps, dual Node profiler diagnostics and the current ordinary FAST-AF/Lushly rerun. The six preliminary flat-copy comparison jobs remain excluded from accepted performance claims.
- **Not done:** equivalent Storybook/Vitest baselines, full driver/asset/dependency conditions, remaining budgets and broader acceptance below. Native wrappers do not prove retained stories, plays, axe, coverage or operational parity.
- **Follow-ups:** T01–T04, including a frozen-input investigation of Lushly CPU. No Rust rewrite or concurrent-session capacity is accepted by these pilots.

## Known gaps and scope limits

| ID | Gap / limit | Evidence and required follow-up |
| --- | --- | --- |
| G01 | Current source, installed dependencies, assets and story inventory are not one frozen accepted consumer baseline | Lushly source was held at `70d48221`, but its linked Violet build changed (63 selected files modified, 18 added). The proposal's 2026-10-28 file/play counts remain historical. T01 MUST refresh exports/effective policies and bind source, installed bytes, fonts/assets and cache conditions. |
| G02 | CPU rose in the monorepo rerun; cause unconfirmed | FAST-AF isolated median CPU is 56.37 core-seconds, +10.37% against the valid post-cache cohort; Lushly is 54.43, +81.17% against the older reuse cohort. Those baselines differ in age and inputs. T02 MUST use frozen inputs and distinguish diagnostic attribution from ordinary whole-job acceptance. |
| G03 | No equivalent incumbent resource or full-suite baseline | Native wrappers exercise eight components, not retained CSF or identical incumbent work. T04/T05 MUST compare the actual Storybook/Vitest-addon path with equivalent cases, checks and readiness before any savings or replacement claim. |
| G04 | Cross-driver context and complete provenance are unproven | CLI versus static-page media preferences and the future Vitest driver still need viewport/`matchMedia`/units/theme parity. Capture 0.1 does not yet provide every proposed installed-version, font/resource, clock/random or context identity. T03/T06 MUST settle and test these fields and lifecycle semantics. |
| G05 | Structured evidence has declared limits | TrustedHTML/non-string HTML remains conservatively opaque in the consumer pilot; closed/foreign roots, raster content, pseudo-element geometry and natural animations have limits. T03 MUST preserve those limits until tested support exists. ARIA is not axe; screenshots are not pixel comparison; `requireVisual` remains insufficient. Pixel comparison is optional, not an added cutover prerequisite. |
| G06 | Full build/load budgets are unmeasured | The native shell ceiling is 50,000 minified JavaScript bytes; 25,569 was an earlier feasibility receipt. Interaction, axe and total 1,300,000-byte categories, compression and actual loaded bytes still need complete accounting in T04. |
| G07 | Plugin, runner and command scope remains incomplete | No retained-CSF adapter/codemod, frozen plugin contracts, CEM/schema enrichment or application-command runner. Only list/render/diff/build exist, with narrower inputs than the full proposal. Experimental resource/profile scripts are not public `specimen-profile`. T05/T06/T09/T11 own the remaining command surfaces. |
| G08 | Consumer operational replacements and coverage are absent | No full export/policy parity, axe enforcement, contract/profile-rule retirement, CEM/typecheck/scaffold/flake replacement, evidence-backed coverage or three-run qualification. T06–T08 MUST retain existing rules during overlap. |
| G09 | Long worker lifetimes, concurrent capacity and platform cleanup lack proof | Ten rounds do not establish a plateau; Lushly open-worker footprint remains roughly 34–39 MiB above round one. Only one admitted job was tested. A blocked/SIGKILLed worker can leave descendants; Windows cleanup and non-macOS whole-family accounting remain unverified. Additional capacity/platform claims MUST await separate bounded evidence. |
| G10 | Violet context, token/event channels and lens are absent | Native light/dark wrapper checks do not implement offline node snapshots, composed token maps or observed impact. T09/T10 MUST retain unknown/incomplete results and keep optional scope outside core cutover gates; core declared-event history belongs to T06. |
| G11 | Publication admission remains open; main delivery has a separate record | [PR #517](https://github.com/lushly-dev/afd/pull/517) records main delivery of the cached-map/profile changes and latest rerun. All three packages remain quarantined with no publisher recorded. Future plugin allocation and release dependencies MUST be reconciled with the monorepo inventory before release/cutover. |

## Current resource decision

The latest two reuse pairs keep in-process execution as the default. Isolated reuse uses approximately **19–27% more CPU for FAST-AF** and **31–33% more for Lushly**, with higher active peaks than the corresponding in-process jobs. Closing the worker leaves about **43 MiB / 38 MiB** in the coordinator, **88–89% below** the in-process post-close footprint. Reuse saves **19–23% CPU** against the current per-round restart controls.

These outcomes support an opt-in worker reused across related captures and explicitly closed afterward. They do not establish a safe number of simultaneous agent sessions. The runtime remains TypeScript; the experimental macOS observer is C. A Rust candidate MUST target a confirmed cost and include native/WASM packaging and boundary overhead in its comparison. The confirmed optimization so far is Vite fallback-map caching.

## Follow-ups not yet issues

All rows were reconciled on 2026-10-30. No new owner or issue is claimed by this documentation update.

| Follow-up | Next task / completion record | State |
| --- | --- | --- |
| Freeze current FAST-AF/Lushly source/dependency/assets and refresh retained-story inventory | T01; record exact input manifests and unresolved assets/policies | Open, unassigned |
| Explain the current CPU increase before selecting another optimization | T02; warmed profiles and ordinary matched CPU/memory readback | Open, unassigned |
| Extend profiler regression fixtures for rejected identity/nonce, duplicate roles and error receipts | T02 diagnostic hardening; existing source rejection paths reviewed, additional negative fixtures remain open | Open, unassigned |
| Close driver/observation and complete resource/budget feasibility evidence | T03/T04; explicit decision on workstream 0 exit | Open, unassigned |
| Deliver the supported retained-CSF compatibility slice and codemod | T05; positive/failing reference receipts | Open, unassigned |
| Deliver full runner/operations, coverage replacements and qualified migration | T06–T08; separate rule retirement, full qualification and rollback records | Open, unassigned |
| Settle future plugin placement, application-command runner scope and release admission | T05/T08/T09/T11 plus release inventory; `specimen-afd` currently means command bindings | Open, unassigned |
| Extend lifetime/concurrency/platform evidence only under stated budgets | Separate experiment after T01/T04; preserve admission and cleanup failures | Open, unassigned |
| Implement offline Violet impact and optional lens | T09/T10; separate consumer-backed acceptance | Open, unassigned |

## Session / evidence log

| Date | Record | State and retained evidence |
| --- | --- | --- |
| 2026-10-28 | Native feasibility and consumer/resource/heap/reuse pilots | Historical source receipts; [implementation history](implementation.md#historical-feasibility-receipts) and each validation document retain scope, counts and limitations |
| 2026-10-29 | Warm CPU study | `22c6106c`, branch evidence; ~85% less sampled warm map work, 3–9% lower CPU in two valid ordinary pairs; preliminary flat-copy cohort excluded |
| 2026-10-30 | Main import readback | `05dad725` / #476 verified on main; native/AFD/CLI split and quarantine preserved |
| 2026-10-30 | Monorepo refresh | `71505dc6` / `bb54a03b`, branch evidence; 14 completed jobs, 832 verified captures, 32 creates/closes, one held admission, stable selected inputs and no owned survivors |
| 2026-10-30 | Plan reconciliation | Added this ledger, current package/command boundaries, known gaps and T01–T11; retained the original proposal gates and historical validation records |
| 2026-10-30 | Independent merge review | Full 24-file review at `ea359184`, followed by focused verification of the corrected CPU-range wording and optional negative-profiler-fixture follow-up; no merge blockers. Main delivery is tracked by #517. |
