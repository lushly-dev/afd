# Rust Parity Closure Plan

## Overview

When this plan was written, the Rust AFD crate covered the core result model, batch primitives, streaming basics, pipelines, bootstrap helpers, and handoff metadata, but it lagged the TypeScript barrel export surface in meaningful ways.

The canonical parity check is:

```bash
uv run --project alfred alfred parity --path .
```

On March 21, 2026, that command reported:

- `typescript`: 183 exports
- `python`: 170 exports
- `rust`: 130 exports
- `missing_from_rust`: 78 exports

This plan tracked the Rust-side closure work only. TypeScript remains the source of truth for parity, and Python drift is out of scope except where it clarifies intended AFD behavior.

## Status

| Field | Value |
|---|---|
| Status | Complete |
| Author | jasfalk |
| Updated | 2026-09-26 |
| Shipped In | 98af776, "Complete Rust export parity (#181)" |
| Package | `packages/rust` |
| Source Of Truth | `uv run --project alfred alfred parity --path .` |
| Depends On | Existing Rust crate foundation in `docs/features/proposed/rust-support/` |

## Outcome

All five waves shipped in #181 on March 21, 2026. It added `connectors.rs`, `mcp.rs`, `similarity.rs`, and `telemetry.rs`, and extended `batch.rs`, `commands.rs`, `errors.rs`, `handoff.rs`, `pipeline.rs`, `result.rs`, `streaming.rs`, and the `lib.rs` re-exports. At that commit, `alfred parity` reported `rust`: 211 exports and `missing_from_rust`: 0.

On September 26, 2026, `alfred parity` reports:

- `typescript`: 186 exports
- `python`: 179 exports
- `rust`: 225 exports
- `missing_from_rust`: 10 exports

None of the 10 remaining gaps are from this plan's list. Each one entered the TypeScript barrel after #181:

| Missing from Rust | TypeScript export | Added to the TypeScript barrel in |
|---|---|---|
| `commands_to_mcp_tools` | `commandsToMcpTools` | #225 |
| `is_mcp_exposed` | `isMcpExposed` | #225 |
| `max_similarity_input_length` | `MAX_SIMILARITY_INPUT_LENGTH` | #232 |
| `truncate_name` | `truncateName` | #232 |
| `command_registry_options` | `CommandRegistryOptions` | #250 |
| `execute_batch` | `executeBatch` | #250 |
| `execute_stream` | `executeStream` | #250 |
| `execution_failure` | `executionFailure` | #250 |
| `executor_options` | `ExecutorOptions` | #250 |
| `stream_executor_options` | `StreamExecutorOptions` | #251 |

This plan no longer tracks them. `NAME_GAP_BUDGET` in `alfred/tests/test_parity.py` holds `missing_from_rust` at 10 or fewer, and the Alfred workflow runs that test on pushes to main and pull requests that touch `packages/**`. When a gap closes, lower the budget.

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
