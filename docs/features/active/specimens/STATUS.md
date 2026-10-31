# Specimens status

Read this before the implementation plan. This ledger records verified progress, known gaps and the next gates. Last reconciled **2026-10-31** against fetched main `cdfbbfb7`, which contains [PR #517](https://github.com/lushly-dev/afd/pull/517) as `459f8965` and [PR #521](https://github.com/lushly-dev/afd/pull/521) (T01) as `cdfbbfb7`. T02 is implemented on branch `lush/specimens-t02-cpu`. Named source SHAs retain the measured/reviewed checkpoints.

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
| Cached fallback sourcemaps and warm Node CPU profiling | Done / merged | [#517](https://github.com/lushly-dev/afd/pull/517), `459f8965`, read back on `origin/main` on 2026-10-31; [CPU study](cpu-hotspot-validation.md), ordinary layout-preserving comparisons and browser/HTTP regressions | Broader frozen-input performance evidence (T02) |
| Updated monorepo resource matrix and runtime alias compatibility | Done / merged | [#517](https://github.com/lushly-dev/afd/pull/517), `459f8965`; [rerun](monorepo-resource-validation.md), 14 completed jobs / 832 verified captures on 2026-10-30 | Attribution of the CPU increase (T02) and incumbent measurements (T04) |
| T01 frozen inputs and retained-story inventory | Done / merged | [#521](https://github.com/lushly-dev/afd/pull/521), `cdfbbfb7`, content read back on `origin/main` on 2026-10-31; [record](frozen-inputs-inventory.md): Lushly `b8906b75` and FAST-AF `24e4eb86` snapshots bound by Git blob, lockfile-to-install agreement and package digests; 858 / 407 indexed stories inventoried; recorded twice with identical results on 2026-10-31 | One font and browser condition for T03/T04 (G12) |
| T02 CPU increase attribution | Implemented on branch | `lush/specimens-t02-cpu`; [record](cpu-attribution-validation.md): 16 ordinary historical/current-input ABBA jobs (1,280 verified captures), 4 contended jobs and 4 warmed profiles on 2026-10-31; host contention is the best-supported explanation; fixed-work speed probe added to the resource runner | Controlled synthetic-load pair; owner decision on the proposed probe gate; main delivery |
| Full replacement | In progress; workstream 0 gate open | Native API, four AFD definitions, JSON CLI, static page and resource pilots | Compatibility adapter, full runner, operational replacement and qualified consumer cutover |
| Distribution | Quarantined | [Release inventory](../../../../scripts/release/inventory.json) and [split transition](../platform-monorepo/specimen-transition.md), read back on 2026-10-30 | Publisher authority and guarded release admission; no registry-publication claim |

The native core is `foundations/specimen`; AFD bindings are `integrations/specimen-afd`; the CLI is `endpoints/specimen-cli`. All three units are quarantined. The current native full suite has **125 tests** (#517's 100, 19 T01 input-tool tests and 6 T02 frozen-snapshot and speed-probe tests), with integration/CLI suites separate and **12 packed-artifact consumer checks**. On 2026-10-31 the T02 branch passed all eleven `pnpm check` stages and `pnpm test:specimen` on Node 24.21.0. These are local receipts, not hosted CI or consumer qualification.

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
| [Frozen inputs and inventory](frozen-inputs-inventory.md) | T01: accepted revisions, bound installs/assets/browsers/host, declared policy, retained-story inventory and operational obligations |

## Workstream progress

| Workstream | State | Verified progress | Exit still open / next gate |
| --- | --- | --- | --- |
| 0. Feasibility and observation | In progress | Native cases, scoped observations/diffs, screenshots/index, lifecycle, shell ceiling, calibrated whole-job accounting, optional worker and real consumer batches; frozen inputs, inventory and owner-confirmed tolerances (T01, merged); CPU increase best explained by host contention (T02, on branch) | Representative incumbent cost/check equivalence, cross-driver context and complete budget accounting; tasks T03–T04 |
| 1. Compatibility slice | Not started as a delivered adapter | Explicit metadata loading and native custom renderers only | Refreshed retained-CSF inventory; positive/failing reference pairs; exercised schema/context/token-map/runner contracts; validate/inspect and preview-first codemod; T05 |
| 2. Full runner and operations | Not started | Native action/checkpoint subset and static build are reusable foundations | Exact discovery/outcome parity, plays/helpers, axe, ready-checkpoint profiler, CEM/typechecks, scaffold and flake/worker integration; T06 |
| 3. Coverage and replacement gates | Not started | Unknown/unsupported observation channels remain explicit | Represented/asserted/verified obligations, coverage/suggest, Fastbot adapters and every rule's passing/failing retirement evidence; T07 |
| 4. Qualified cutover | Not started | No consumer Storybook configuration or required gate removed | Three qualifying full runner pairs per consumer, full consumer gates, human review, dependency report and rollback checkpoint; T08 |
| 5. Violet context and impact | Not started | Native theme contexts are available; these are not Violet node/snapshot support | Offline snapshots, versioned token/name maps, conservative dependencies, node matrices, impact and token fixtures; T09 |
| 6. Optional Violet lens | Not started | Native static index and screenshots exist | Lens over accepted commands with matching context, results and incomplete states; T10 |

### Workstream 0 verification block

- **State:** in progress, full exit criterion open.
- **Last verified:** 2026-10-31; main `cdfbbfb7` (including #517 and #521), the [T01 record](frozen-inputs-inventory.md) and the [T02 record](cpu-attribution-validation.md); 2026-10-30 for the linked ordinary monorepo resource receipts.
- **Done / merged:** bounded native observation/lifecycle/static tooling, command/CLI split, calibrated macOS recorder, lazy loading and opt-in worker. Initial native honesty fixtures and the five-case capture-only interpretation experiment are recorded in the implementation history.
- **Merged since the native milestone:** cached dev maps, dual Node profiler diagnostics and the current ordinary FAST-AF/Lushly rerun (#517). The six preliminary flat-copy comparison jobs remain excluded from accepted performance claims.
- **Merged in #521:** T01 snapshots, input manifests, story inventory and the baseline policy, whose tolerances the owner confirmed on 2026-10-31.
- **Implemented on branch:** T02 attribution, the runner's fixed-work speed probe and frozen-snapshot support for the consumer runners.
- **Not done:** equivalent Storybook/Vitest baselines, full driver/asset/dependency conditions, remaining budgets and broader acceptance below. Native wrappers do not prove retained stories, plays, axe, coverage or operational parity.
- **Follow-ups:** T03–T04, with every CPU comparison pair carrying a host-condition control (T02). No Rust rewrite or concurrent-session capacity is accepted by these pilots.

## Known gaps and scope limits

| ID | Gap / limit | Evidence and required follow-up |
| --- | --- | --- |
| G01 | Input baseline recorded on branch; runtime fonts unfrozen | [T01](frozen-inputs-inventory.md) binds Lushly `b8906b75` (Violet now vendored) and FAST-AF `24e4eb86` source, installs, generated inputs and story inventory. Earlier `70d48221` measurements keep their drifted inputs. Both incumbents still load Google Fonts live. T03/T04 MUST pick one font condition for both runners. |
| G02 | CPU rise best explained by host contention; cross-session CPU is host-sensitive | [T02](cpu-attribution-validation.md): within a session, changing Lushly's inputs made no measurable difference (+0.65% / +0.69%, all jobs inside the probe band). FAST-AF's input cells are held for repeatability and host noise, so its input effect is unmeasured. Quiet-host jobs were 43–51% below the 2026-10-30 rerun on identical code and inputs. A job under external contention reproduced the rerun's Lushly value (53.73 versus 54.43). Job CPU tracks a fixed-work probe (r = 0.999 / 0.960). This is consistent with contention, not proof: a controlled synthetic-load pair remains outstanding. Admission's two-core reserve does not ensure comparable conditions, so cross-session ratios MUST carry a host-condition control. A probe-based comparison gate is proposed and awaits the owner. |
| G03 | No equivalent incumbent resource or full-suite baseline | Native wrappers exercise eight components, not retained CSF or identical incumbent work. T04/T05 MUST compare the actual Storybook/Vitest-addon path with equivalent cases, checks and readiness before any savings or replacement claim. |
| G04 | Cross-driver context and complete provenance are unproven | CLI versus static-page media preferences and the future Vitest driver still need viewport/`matchMedia`/units/theme parity. Capture 0.1 does not yet provide every proposed installed-version, font/resource, clock/random or context identity. T03/T06 MUST settle and test these fields and lifecycle semantics. |
| G05 | Structured evidence has declared limits | TrustedHTML/non-string HTML remains conservatively opaque in the consumer pilot; closed/foreign roots, raster content, pseudo-element geometry and natural animations have limits. T03 MUST preserve those limits until tested support exists. ARIA is not axe; screenshots are not pixel comparison; `requireVisual` remains insufficient. Pixel comparison is optional, not an added cutover prerequisite. |
| G06 | Full build/load budgets are unmeasured | The native shell ceiling is 50,000 minified JavaScript bytes; 25,569 was an earlier feasibility receipt. Interaction, axe and total 1,300,000-byte categories, compression and actual loaded bytes still need complete accounting in T04. |
| G07 | Plugin, runner and command scope remains incomplete | No retained-CSF adapter/codemod, frozen plugin contracts, CEM/schema enrichment or application-command runner. Only list/render/diff/build exist, with narrower inputs than the full proposal. Experimental resource/profile scripts are not public `specimen-profile`. T05/T06/T09/T11 own the remaining command surfaces. |
| G08 | Consumer operational replacements and coverage are absent | No full export/policy parity, axe enforcement, contract/profile-rule retirement, CEM/typecheck/scaffold/flake replacement, evidence-backed coverage or three-run qualification. T06–T08 MUST retain existing rules during overlap. |
| G09 | Long worker lifetimes, concurrent capacity and platform cleanup lack proof | Ten rounds do not establish a plateau; Lushly open-worker footprint remains roughly 34–39 MiB above round one. Only one admitted job was tested. A blocked/SIGKILLed worker can leave descendants; Windows cleanup and non-macOS whole-family accounting remain unverified. Additional capacity/platform claims MUST await separate bounded evidence. |
| G10 | Violet context, token/event channels and lens are absent | Native light/dark wrapper checks do not implement offline node snapshots, composed token maps or observed impact. T09/T10 MUST retain unknown/incomplete results and keep optional scope outside core cutover gates; core declared-event history belongs to T06. |
| G11 | Publication admission remains open | #517 merged the cached-map/profile changes and latest rerun as `459f8965`. All three packages remain quarantined with no publisher recorded. Future plugin allocation and release dependencies MUST be reconciled with the monorepo inventory before release/cutover. |
| G12 | Incumbents and candidate run different browsers, and AFD has no runner for its FAST-AF stories | Chromium 153 (Lushly, Playwright 1.63.0), 145 (FAST-AF, 1.58.2) and 156 (Specimen, 1.64.0); axe-core 4.13.0 and 4.11.1. FAST-AF's Storybook, Fastbot and CI scope remain upstream against a frozen copy of the stories AFD now owns. T03/T04 MUST run each pair on one browser build or report the difference; T06–T08 MUST settle where the FAST-AF suite runs. |

## Current resource decision

The latest two reuse pairs keep in-process execution as the default. Isolated reuse uses approximately **19–27% more CPU for FAST-AF** and **31–33% more for Lushly**, with higher active peaks than the corresponding in-process jobs. Closing the worker leaves about **43 MiB / 38 MiB** in the coordinator, **88–89% below** the in-process post-close footprint. Reuse saves **19–23% CPU** against the current per-round restart controls. On a quiet host on 2026-10-31 ([T02](cpu-attribution-validation.md)), isolated reuse cost **21.6% more CPU for Lushly** (26.78 versus 22.02 core-seconds, all jobs inside the probe band), with isolated coordinators about 96% idle in the warmed profiles. FAST-AF's same-session figures are held for host noise.

These outcomes support an opt-in worker reused across related captures and explicitly closed afterward. They do not establish a safe number of simultaneous agent sessions. The runtime remains TypeScript; the experimental macOS observer is C. A Rust candidate MUST target a confirmed cost and include native/WASM packaging and boundary overhead in its comparison. The confirmed optimization so far is Vite fallback-map caching.

## Follow-ups not yet issues

All rows were reconciled on 2026-10-31. No owner or issue is claimed; T01 was taken on in this session without an issue.

| Follow-up | Next task / completion record | State |
| --- | --- | --- |
| Freeze current FAST-AF/Lushly source/dependency/assets and refresh retained-story inventory | T01; [record](frozen-inputs-inventory.md) | Implemented on branch `lush/specimens-implementation`; tolerances confirmed 2026-10-31; main delivery open |
| Choose one font and browser condition for incumbent/candidate pairs | T03/T04; G01, G12 | Open, unassigned |
| Decide where the AFD-owned FAST-AF stories run before upstream Storybook retires | T06–T08; G12 | Open, unassigned |
| Explain the current CPU increase before selecting another optimization | T02; [record](cpu-attribution-validation.md) | Implemented on branch `lush/specimens-t02-cpu`: host contention is the best-supported explanation; no optimization selected |
| Run a controlled synthetic-load ABBA pair on a quiet host | T02 follow-up; the direct contention test this session could not complete | Open, unassigned |
| Decide whether CPU comparison pairs must pass a fixed-work probe gate (within 10% of the session's quietest probe) | Owner decision before T04; T02 proposal | Open, awaiting owner |
| Investigate Playwright per-call overhead (36–47% of busy Node self time; stack preparation 162–524 ms per profile) | Later resource work; T02 profiles | Open, unassigned |
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
| 2026-10-31 | T01 frozen inputs and inventory | Branch evidence, `lush/specimens-implementation`. Lushly `b8906b75` / FAST-AF `24e4eb86` snapshots: 5,822 / 2,699 tracked files bound, installed lock equals lockfile, 858 / 407 stories inventoried with 0 index mismatches, 7 / 2 unreadable stories kept explicit (5 unknown plays), browser divergence recorded, tolerances declared and confirmed by the owner. No measurement ran. |
| 2026-10-31 | T02 CPU increase attribution | Branch evidence, `lush/specimens-t02-cpu`. 16 ordinary historical/current-input ABBA jobs (1,280 verified captures, no held attempts), 27 load-plan attempts (22 held, 1 failed, 4 completed under contention), 4 warmed profiles. Lushly input effect not measurable; FAST-AF input cells held; native source unchanged; host contention best-supported; speed probe added to the runner; frozen fallback hardened after review. |
