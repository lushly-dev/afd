# Specimens implementation

Status: native feasibility milestone committed as `f1bc4488`; exploratory real-consumer pilot validated locally, 2026-10-28. Complete workstream 0 remains open. Branch: `codex/specimens-feasibility`. Base: `bc43019a4acd237e5ef3a2bf65f21564900143aa`.

The [proposal](../../proposed/specimens/specimens.proposal.md) remains the full acceptance contract. This milestone builds the first local observation tool; consumer migration and Storybook removal remain gated by the later compatibility and operational checks.

## Scope

The first package is [`@lushly-dev/specimen`](../../../../packages/specimen/README.md), a TypeScript browser/tooling integration outside AFD's core cross-language parity surface. It adds four AFD definitions and a JSON CLI: list, render, diff and build. Native feasibility fixtures use an explicit metadata manifest rather than automatic CSF discovery.

| Capability | Implementation and proof |
| --- | --- |
| Command contract | Shared Zod input/output validation, typed failures with recovery suggestions, JSON CLI and MCP-exposed definitions |
| Observation | Open-shadow DOM, ARIA, actual geometry/scroll, selected computed CSS, native live state, effective context and source/build provenance |
| Comparison | Version/browser/context/checkpoint compatibility; scoped channel differences; incomplete evidence never becomes unchanged |
| Lifecycle | Fresh browser context per render, bounded readiness, declared disposal on failure/success, context discarded after timeout |
| Loading/build | Metadata-only index, lazy case modules, static output, numeric shell-budget report |
| Regression corpus | CSS-only padding, clipping, live state, accessible names/relationships, generated ids, hover/focus, real viewport versus container, opaque-content limits and readiness/disposal failures |

## Acceptance checklist

- [x] Plain custom-element fixtures render through the same public API used by the CLI.
- [x] Seeded layout changes are observable despite unchanged DOM and ARIA.
- [x] Unknown/unsupported token, event, axe and pixel capabilities are reported explicitly.
- [x] Initial package unit and Chromium integration suite passes.
- [x] Final built-page and animation completeness checks recorded.
- [x] Compiled CLI smoke, shell size and screenshot readback recorded.
- [x] Full TypeScript repository `pnpm check` recorded for the final local source.
- [x] Independent capture-only interpretation experiment recorded.

The complete workstream 0 gate remains open. The later [real-consumer pilot](consumer-validation.md) exercises eight actual FAST-AF/Lushly components with sixteen behavior captures, but frozen current dependency conditions, an incumbent cost baseline, full consumer acceptance and eventual Vitest browser-driver parity remain unestablished. Helper and axe budget categories remain unmeasured until integrated. The proposal's compatibility adapter, full coverage rules, token-impact plugin and consumer cutover have not been implemented.

## Validation receipts

The final local source passed `fnm exec --using=24 -- pnpm check` (exit 0, 37.75 seconds). Its nine stages passed: lint, build, typecheck, coverage tests, portability, file-size, orphan-files, versions and tooling-tests. This is the TypeScript gate on Node 24, not hosted CI or consumer-migration validation.

The new package contains 68 tests: 36 comparison/normalization tests, 14 command/CLI tests and 18 real-Chromium integration tests, with 29 registered native fixtures plus the isolated streaming-project fixture. Browser-only source runs in Chromium and is deliberately outside the Node-process V8 coverage calculation; the integration assertions exercise it directly.

The final compiled CLI ran on Node `v24.21.0` with Chromium `156.0.8078.4`. Its `list`, eight `render` calls, four structural `diff` calls, an insufficient-visual-evidence comparison and a static `build` all emitted one successful `CommandResult` JSON value per invocation. The built shell measured **25,569 minified UTF-8 JavaScript bytes against a 50,000-byte ceiling**, including its emitted static dependencies. The screenshot was read back as a valid rendered button; the static output was independently served over HTTP and exercised in Chromium, including the 375px iframe and theme controls.

An independent agent received only anonymized final captures/diffs, without fixture source or screenshots. It correctly identified the padding/geometry change, live checkbox state change, harmless generated-id churn, broken label relationship, and insufficient overall-appearance evidence. This is a five-case native interpretation result, not proof of arbitrary visual review or consumer parity.

Local ignored artifacts are retained under `test-results/specimens-feasibility/`: `pnpm-check.log`, the gate/CLI JSON receipts, captures/diffs, `baseline.png`, the anonymized assessment input, and the static build/report. They are local working-tree evidence, not publication or deployment receipts.

## Independent source review

A bounded read-only reviewer found four issues. All were corrected and closed by source readback; corresponding executable regressions pass in the final gate:

| Finding | Correction and regression |
| --- | --- |
| Never-ending responses blocked provenance | Only finite document/script/stylesheet responses contribute to the loaded-source digest; EventSource readiness succeeds while its response remains open |
| Ancestor animations were omitted | Body/html/ancestor animation evidence marks layout and styles partial; explicit settled mode is stable |
| Declarative closed roots bypassed attachShadow tracking | HTML construction is conservatively observed in the initialized realm; a real nested declarative closed-root fixture returns partial DOM evidence |
| Public and bench input bounds diverged | Both use one request/context schema; oversized timeout/dimension inputs return `VALIDATION_ERROR` before handler execution |

## Remaining boundaries

The static Theme control applies CSS color-scheme and theme attributes. Forced browser/OS `prefers-color-scheme` parity with the CLI's browser emulation is not proven. Closed-root construction tracking covers the initialized specimen realm and cannot retrospectively inspect pre-existing or untouched foreign-realm internals. The complete proposal gate must account for these limits before general consumer acceptance.

The consumer pilot found and corrected queued-update capture timing and cold Vite reload races. See its [validation record](consumer-validation.md) for measured scope, incomplete evidence and the Rust assessment. Host CPU/memory capacity is now the primary resource outcome. The [whole-process resource pilot](resource-validation.md) adds calibrated macOS accounting and 23 pure resource tests alongside the original 71 package tests. Both real consumer resource jobs passed, with peak sampled process-accounted footprint of approximately 522/562 MiB and waited CPU of 8.12/8.29 core-seconds. These are native workflow baselines, rather than proof of incumbent savings.

Follow-up [Node/Vite heap and cache lifetime profiling](heap-lifetime-validation.md) identified a substantial import/runtime baseline, without evidence that retained closed public handles explain most residual memory. Metadata/listing now avoid heavy imports; render/build initialize lazily. The default stays in process, with an optional owned worker for long-lived hosts that prefer lower post-close retention at a higher repeated-start CPU cost. The package suite now has 108 tests, including real default/worker renders, serial close, immutable configuration, relative build paths, nested IPC failures and active/startup browser cleanup. The [larger reused-worker pilot](worker-reuse-validation.md) passed fourteen jobs and 832 verified captures: reuse reduced CPU against per-round worker restarts and preserved post-close memory recovery, while active peaks and some CPU premiums remained. Current consumer/incumbent comparisons, longer worker lifetimes and the supported CSF compatibility slice remain next work. No consumer Storybook configuration or suite was modified.
