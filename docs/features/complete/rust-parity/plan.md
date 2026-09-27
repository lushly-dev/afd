# Rust Parity Closure Plan

## Overview

When this plan was written, the Rust AFD crate covered the core result model, batch primitives, streaming basics, pipelines, bootstrap helpers, and handoff metadata, but it lagged the TypeScript barrel export surface in meaningful ways.

The canonical name check is:

```bash
uv run --project alfred alfred parity --path .
```

Counts over time:

| Date | TypeScript exports | Rust exports | `missing_from_rust` |
|---|---|---|---|
| 2026-03-21 (plan written) | 183 | 130 | 78 |
| 2026-03-21 (`98af776`, #181) | 183 | 211 | 0 |
| 2026-09-26 (`0777217`) | 186 | 225 | 10 (budget 10 in `alfred/tests/test_parity.py`) |

**Waves 1–5 are closed** (#181 and later). The wire-shape and batch-default drift reported by the [2026-09-23 review](../../../reviews/2026-09-23-quality-review.md) is also fixed. The remaining work is behavioral. The name metric cannot see it, so it is tracked in [`docs/language-parity.md`](../../../language-parity.md).

This plan tracked the Rust-side closure work only. TypeScript remains the source of truth for parity, and Python drift is out of scope except where it clarifies intended AFD behavior.

## Status

| Field | Value |
|---|---|
| Status | Complete: export names. Behavioral gaps are tracked in [`docs/language-parity.md`](../../../language-parity.md) |
| Author | jasfalk |
| Updated | 2026-09-26 |
| Shipped In | 98af776, "Complete Rust export parity (#181)" |
| Package | `packages/rust` |
| Source Of Truth | `uv run --project alfred alfred parity --path .` for names; [`docs/language-parity.md`](../../../language-parity.md) for behavior |
| Depends On | Existing Rust crate foundation in `docs/features/proposed/rust-support/` |

## Outcome

All five waves shipped in #181 on March 21, 2026. It added `connectors.rs`, `mcp.rs`, `similarity.rs`, and `telemetry.rs`, and extended `batch.rs`, `commands.rs`, `errors.rs`, `handoff.rs`, `pipeline.rs`, `result.rs`, `streaming.rs`, and the `lib.rs` re-exports. At that commit, `missing_from_rust` was 0.

None of the 10 names missing today are from this plan's list. Each one entered the TypeScript barrel after #181:

| Name | Added to the TypeScript barrel in | Verdict |
|---|---|---|
| `is_mcp_exposed` | #225 | Export artifact: use `is_exposed_to(cmd, CommandInterface::Mcp)` |
| `max_similarity_input_length` | #232 | Export artifact: public at `afd::similarity::MAX_SIMILARITY_INPUT_LENGTH`, not re-exported at the root |
| `truncate_name` | #232 | Exists but private (`commands.rs`); counts chars, where TypeScript counts UTF-16 units |
| `execute_batch` | #250 | Exists as `CommandRegistry::execute_batch`. There is no free function over an executor callback. |
| `commands_to_mcp_tools` | #225 | A missing convenience: `list_by_exposure(Mcp)` plus `command_to_mcp_tool` |
| `execute_stream`, `stream_executor_options` | #250, #251 | Genuine gap: Rust has no stream executor |
| `execution_failure` | #250 | Genuine gap: a crash maps to `INTERNAL_ERROR`, not `COMMAND_EXECUTION_ERROR` |
| `executor_options`, `command_registry_options` | #250 | There is no `devMode`. Rust never includes panic payloads, so these are N/A unless a dev mode is wanted. |

`NAME_GAP_BUDGET` in `alfred/tests/test_parity.py` holds `missing_from_rust` at 10 or fewer, and the Alfred workflow runs that test on pushes to main and pull requests that touch `packages/**`. When a gap closes, lower the budget.

## Remaining Behavioral Work

The name check cannot see these gaps. They are tracked in [`docs/language-parity.md`](../../../language-parity.md), not in this plan; close them there, or accept them there as Rust-specific.

- **Error handling:**
  - Single `CommandRegistry::execute` does not catch panics.
  - `error_codes` has no `COMMAND_EXECUTION_ERROR`.
- **Result guards:** `is_success` requires `data`, and `is_failure` requires `error`, unlike TypeScript.
- **Missing from the single-command engine:**
  - result metadata stamping (`executionTimeMs`, `commandVersion`, `traceId`);
  - active-context scoping;
  - `onCommand` and `onError` hooks;
  - a cancellation signal;
  - `list_by_tags`.
- **Missing surfaces:** built-in middleware (trace ID, logging, timing, retry, rate limit, telemetry), and an MCP server with tool strategies and meta-tools.
- **Validation:**
  - undeclared keys pass through, where TypeScript strips them;
  - the message text differs;
  - lengths are counted in code points;
  - there is no `minItems`, `maxItems`, `additionalProperties: false` or combinators;
  - `pattern` regexes are compiled on each call.
- **Metadata:** `destructive`, `confirmPrompt` and `undoable` are missing. Examples are not validated, and `returns` is not surfaced by `afd-schema`.
- **Handoff guards:** `is_handoff_protocol` and `is_handoff_command` mean different things from TypeScript, and `handoff:<p>` tags are ignored.
- **Tests:** `spec/vectors/pipeline-variables.json` is not consumed.

## Problem

Before this work, Rust exposed only part of the AFD public surface expected by the TypeScript core package. The gaps were not cosmetic:

- core command ergonomics are missing (`ExposeOptions`, `defaultExpose`, `CommandExample`, `CommandMiddleware`, `validateCommandName`)
- the MCP type and helper layer is substantially incomplete
- pipeline condition types and executor-facing exports are incomplete
- telemetry, similarity, connector, and streaming helpers are missing
- some TypeScript helper constructors are missing even where Rust has adjacent functionality

This creates three problems:

1. the Rust implementation is harder to use consistently across examples and docs
2. the public API story drifts across languages even when concepts are shared
3. parity regressions are easy to miss because the missing areas are spread across multiple modules

## Starting Point (2026-03-21)

> These clusters closed in #181. For the current state, see [Outcome](#outcome).

The official parity command reported these Rust gap clusters:

- `24` MCP exports missing
- `24` pipeline exports missing
- `8` connector exports missing
- `5` command/core helper exports missing
- `4` handoff exports missing
- `4` streaming exports missing
- `4` telemetry exports missing
- `3` error exports missing
- `2` similarity exports missing
- `1` batch export missing

The Rust crate layout relevant to this work was:

- `packages/rust/src/commands.rs`
- `packages/rust/src/errors.rs`
- `packages/rust/src/handoff.rs`
- `packages/rust/src/pipeline.rs`
- `packages/rust/src/streaming.rs`
- `packages/rust/src/batch.rs`
- `packages/rust/src/lib.rs`

## Scope

### In Scope

- close the `missing_from_rust` list reported by `alfred parity`
- add missing public Rust types and helper functions where TypeScript already defines the public contract
- update `packages/rust/src/lib.rs` re-exports to match the intended public surface
- add or extend Rust tests for newly exposed behavior
- keep docs honest about any intentionally deferred items

### Out of Scope

- closing `missing_from_python`
- removing Rust-only exports from `extra_in_rust` unless they clearly conflict with the public API direction
- implementing Python-only or platform-only utilities that are not part of the TypeScript source-of-truth barrel
- private Mint distribution work

## Principles

- parity means behavior, not just names; do not add placeholder exports with no meaningful implementation
- TypeScript is the contract source, but Rust should stay idiomatic where implementation details differ
- prefer finishing one module family cleanly over scattering tiny partial fixes across the crate
- each wave should leave `lib.rs` and tests in a coherent state

## Workstreams

### Wave 1: Core Ergonomics And Low-Risk Helpers

Goal: close the smallest, highest-leverage missing exports first.

Target areas:

- `commands.rs`
  - `CommandExample`
  - `CommandMiddleware`
  - `ExposeOptions`
  - `defaultExpose`
  - `validateCommandName`
- `errors.rs`
  - `error`
  - `ErrorCode`
  - `wrapError` equivalent
- `batch.rs`
  - `BatchWarning`
- `streaming.rs`
  - `StreamableCommand`
  - `isStreamableCommand`
  - `consumeStream`
  - `createTimeoutController` or an honest Rust equivalent
- `lib.rs`
  - export alignment for all of the above

Why first:

- small blast radius
- improves everyday API ergonomics
- creates patterns for later parity additions

### Wave 2: Telemetry And Handoff Helper Completion

Goal: finish the missing support surfaces around trust signals and protocol transitions.

Target areas:

- `telemetry.rs` or equivalent new module if needed
  - `TelemetryEvent`
  - `TelemetrySink`
  - `createTelemetryEvent`
  - `isTelemetryEvent`
- `handoff.rs`
  - `createHandoff`
  - `CreateHandoffOptions`
  - `defaultReconnectPolicy`
  - `isReconnectPolicy`

Why second:

- these are well-bounded features with clear TypeScript precedents
- they unblock richer examples and downstream parity stories without requiring the full MCP stack rewrite first

### Wave 3: MCP Surface Parity

Goal: close the full protocol-type gap in one coherent pass.

Target areas:

- request/response helpers
  - `createMcpRequest`
  - `createMcpResponse`
  - `createMcpErrorResponse`
- protocol guards
  - `isMcpRequest`
  - `isMcpResponse`
  - `isMcpNotification`
- public types
  - `McpClientCapabilities`
  - `McpContent`
  - `McpError`
  - `McpErrorCode`
  - `McpImageContent`
  - `McpInitializeParams`
  - `McpInitializeResult`
  - `McpNotification`
  - `McpRequest`
  - `McpResourceContent`
  - `McpResponse`
  - `McpServerCapabilities`
  - `McpTextContent`
  - `McpToolCallParams`
  - `McpToolCallResult`
  - `McpToolsListResult`
  - `textContent`
  - `McpErrorCodes`

Why this is its own wave:

- the missing items form a protocol family
- consistency matters more here than piecemeal export closure
- this work likely touches serialization, validation, and docs together

### Wave 4: Pipeline Surface Parity

Goal: align Rust with the TypeScript pipeline contract, including conditions and executor helpers.

Target areas:

- `PipelineConditionAnd`
- `PipelineConditionEq`
- `PipelineConditionExists`
- `PipelineConditionGt`
- `PipelineConditionGte`
- `PipelineConditionLt`
- `PipelineConditionLte`
- `PipelineConditionNe`
- `PipelineConditionNot`
- `PipelineConditionOr`
- `isAndCondition`
- `isEqCondition`
- `isExistsCondition`
- `isGtCondition`
- `isGteCondition`
- `isLtCondition`
- `isLteCondition`
- `isNeCondition`
- `isNotCondition`
- `isOrCondition`
- `isPipelineCondition`
- `CommandExecutor`
- `executePipeline`
- `resolveReference`

Why this is a separate wave:

- pipeline parity affects execution semantics, not just typing
- this is one of the largest remaining clusters
- it deserves focused tests instead of being mixed into protocol work

### Wave 5: Connector And Similarity Completion

Goal: finish the remaining ecosystem-facing helpers.

Target areas:

- connector types
  - `GitHubConnectorOptions`
  - `Issue`
  - `IssueCreateOptions`
  - `IssueFilters`
  - `PackageManager`
  - `PackageManagerConnectorOptions`
  - `PrCreateOptions`
  - `PullRequest`
- similarity helpers
  - `calculateSimilarity`
  - `findSimilarTools`

Why last:

- important for breadth, but not required to make the Rust core feel structurally complete
- easier to slot in once the protocol and pipeline foundations are settled

## Testing Strategy

Each wave should include:

- targeted Rust unit tests in `packages/rust`
- serialization tests for shared public types where relevant
- one parity check run before merge:

```bash
uv run --project alfred alfred parity --path .
```

Recommended checkpoint commands:

```bash
cargo test
uv run --project alfred alfred parity --path .
```

## Acceptance Criteria

- `missing_from_rust` is reduced to zero, or any remaining entries are explicitly documented as intentionally non-parity items with a reason
- `packages/rust/src/lib.rs` reflects the intended public AFD Rust surface cleanly
- newly exported items have real implementations or well-tested Rust-native equivalents
- the parity command is used as the final verification gate for each wave

## Open Questions

### 1. MCP Module Shape

The Rust crate currently re-exports several MCP-adjacent command types from `commands.rs`, but the missing MCP surface suggests a dedicated `mcp.rs` module may now be cleaner.

Recommendation:

- allow a new Rust module split if it reduces confusion and makes parity easier to maintain

### 2. Timeout Controller Semantics

`createTimeoutController` is a JavaScript-shaped helper. Rust may need an equivalent with a different internal design.

Recommendation:

- match the public intent, not the JS implementation detail
- document the Rust-native timeout model if naming must stay aligned

### 3. Connector Depth

Some connector items may be type-only parity shims if the full runtime integration is not yet in scope.

Recommendation:

- add shared public types first
- only add runtime connector behavior when the Rust crate is ready to support it honestly

## Follow-On Work

Still open:

- whether `docs/features/proposed/rust-support/` should move from proposed to complete
- whether `alfred parity` should gain a narrower Rust-only mode or machine-readable wave summaries

Settled: parity is part of regular CI through the `NAME_GAP_BUDGET` test in the Alfred workflow (see [Outcome](#outcome)), not the Rust workflow.
