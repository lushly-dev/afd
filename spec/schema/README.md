# Result and error schemas

Normative JSON Schema 2020-12 definitions for AFD's wire types and the rules that apply where the
schema alone cannot state them. Every implementation (TypeScript, Python, Rust, C++ and any future
implementation) produces wire payloads that validate against these schemas.

Every rule here is normative. **MUST**, **MUST NOT**, **SHOULD** and **MAY** are used as in
RFC 2119.

## Schemas

| File | `$id` | Covers |
| --- | --- | --- |
| [`error.json`](./error.json) | `https://afd.dev/spec/schema/error.json` | `CommandError` |
| [`result.json`](./result.json) | `https://afd.dev/spec/schema/result.json` | `CommandResult`, `ResultMetadata`, `Source`, `PlanStep`, `Alternative`, `Warning` |
| [`output-envelope.json`](./output-envelope.json) | `https://afd.dev/spec/schema/output-envelope.json` | Standalone MCP top-level `outputSchema` envelope |
| [`batch.json`](./batch.json) | `https://afd.dev/spec/schema/batch.json` | `BatchResult`, `BatchCommandResult`, `BatchSummary`, `BatchTiming`, `BatchWarning` |
| [`pipeline.json`](./pipeline.json) | `https://afd.dev/spec/schema/pipeline.json` | `PipelineResult`, `PipelineMetadata`, `StepResult`, step aggregations |
| [`stream.json`](./stream.json) | `https://afd.dev/spec/schema/stream.json` | `StreamChunk` (`progress`, `data`, `complete`, `error`) |

The schemas reference one another by relative URI (`error.json`, `result.json#/$defs/...`). A
validator loads every file in this directory into its schema registry before compiling one.

## Wire rules beyond the schema

### Key naming and omitted optional fields

- All AFD envelope keys are `camelCase`.
- Unset optional fields **MUST** be omitted on the wire, never serialized as `null`.
- Free-form payload fields — `CommandResult.data`, `CommandError.details`,
  `CommandError.recovery.input`, `CommandResult.undoArgs`, `Alternative.data`, `PlanStep.result`, `Warning.details`,
  `DataChunk.data`, `CompleteChunk.data`, `PipelineResult.data`, `StepResult.data` and extra keys in
  `ResultMetadata` — **MAY** hold `null` or arbitrary key conventions chosen by the command.

### `CommandResult`

- `success` is the sole success/failure discriminant:
  - When `success` is `true`, `error` **MUST** be absent; `data` **MAY** be omitted for a void
    command or set to any JSON value (including `null`).
  - When `success` is `false`, `error` **MUST** be present and `data` **MUST** be absent on
    server and command wire payloads (`result.json` enforces this). Client-synthesized
    `DirectClient` `UNKNOWN_TOOL` and `McpClient` `INPUT_REQUIRED` failures attach structured
    `data` on the client side as documented in [`../error-codes.md`](../error-codes.md).
  - Type guards (`isSuccess` / `isFailure`) read only `success` so consumers handle defensive wire
    inputs without throwing.
- `confidence` and `Alternative.confidence` and `Source.relevance` are bounded in `[0, 1]`.
- `PlanStep.progress` is bounded in `[0, 100]` (percentage 0–100; existing callers emitting a 0–1
  fraction remain within the numeric range).
- `ResultMetadata` is open (`additionalProperties: true`) so hosts and commands may attach custom
  keys (such as `dev.afd/outputBudget`). Its standard keys (`executionTimeMs`, `commandVersion`,
  `traceId`, `timestamp`, `actorKind`) follow the schema types.
- `metadata.actorKind` carries only the calling principal's kind (`human`, `agent`, `service`,
  `script` or `test`), never an actor id or display label. Consumers **SHOULD** tolerate unknown
  future kinds leniently on read rather than failing deserialization.

### `CommandError`

- `code` (non-empty string) and `message` (string) are required on the wire.
- `suggestion` is **optional on the wire** so consumers accept compact errors (such as a stream
  error chunk), and **SHOULD** be present on every error a command or engine emits to tell the
  caller how to recover. It is free text, and nothing checks that following it helps. The contract
  pins the text of a few engine suggestions (the `VALIDATION_ERROR` layout in
  [`../vectors/validation.json`](../vectors/validation.json), `CALL_NOT_GRANTED` in
  [`../vectors/app-calls.json`](../vectors/app-calls.json)) and limits which meta-tools a
  suggestion may name ([`../error-codes.md`](../error-codes.md#suggestions-name-only-tools-the-host-provides)).
  The TypeScript and Python testing packages warn `MISSING_SUGGESTION` when one is absent, and
  scenarios can assert its text (`expect.error.suggestion`); no surface rule reads suggestions.
- `retryable`, when omitted, is read by consumers as `false` (not retryable). The shared catalog's
  retryability rules are pinned in [`../error-codes.md`](../error-codes.md) and
  [`../vectors/error-codes.json`](../vectors/error-codes.json).
- `recovery` is optional: the step `suggestion` describes, structured so a program can follow it
  and a test can check it (`call`, `fix-input`, `retry`, `external` or `stop`). The schema keeps
  each field to its kind, requires `retryable: true` with a `retry` recovery and forbids it with
  `stop`. A consumer reads a recovery it does not understand as none
  ([`../recovery.md`](../recovery.md)).
- `cause` on the wire is always another `CommandError`. Native language exceptions and stack traces
  **MUST NOT** be serialized into `cause` or `details` (stack traces belong in `details` only when
  `devMode` is explicitly enabled).

### `BatchResult`

- Partial-success semantics: `success` is `true` whenever the batch itself executed, even if some
  or all items failed. `success` is `false` only when the batch itself was rejected or failed before
  running (`results` is empty and `error` is present).
- Summary invariant: `summary.total === summary.successCount + summary.failureCount + summary.skippedCount`.
  When `success` is `true`, `results.length === summary.total`.
- Aggregated confidence: `(successRatio * 0.5) + (avgCommandConfidence * 0.5)` where
  `successRatio = successCount / total` and `avgCommandConfidence` is the mean of successful
  commands' confidences (defaulting to `1` when a successful command omits `confidence`, and `0`
  when no command succeeded); an empty batch has confidence `1`.

### `PipelineResult`

- `data` holds the last successful step's `data` and **MUST** be omitted when no step succeeded.
- A pipeline rejected before any step runs (for example `INVALID_PIPELINE_REQUEST`, a refused
  confirmation, or an up-front approval refusal) returns one synthetic step with `index: -1`,
  `command: ""`, `status: "failure"`, `executionTimeMs: 0` and the rejection `error`.
- `metadata.completedSteps <= metadata.totalSteps`.
- `metadata.confidence` is the minimum confidence across successful steps (`0` when none
  succeeded; steps that omit `confidence` default to `1`).

### `StreamChunk`

- Discriminated by `type`: `progress`, `data`, `complete`, `error`.
- `data` chunk `index` starts at `0` and increases monotonically.
- A well-formed stream terminates with either a `complete` chunk or an `error` chunk.

### Advertised MCP `outputSchema` envelope

[`output-envelope.json`](./output-envelope.json) defines the standalone `outputSchema` envelope
every MCP server advertises for a command tool that declares an output schema
([`../command-metadata.md#structured-results`](../command-metadata.md#structured-results)).
Each implementation builds its envelope from this shape by:

1. substituting the command's output schema for `properties.data` (stripping any nested `$schema`),
2. hoisting `$defs` and `definitions` from `data` to the envelope root unless `data` declares its
   own `$id`, and
3. keeping `error` typed with `code`, `message`, `suggestion` and `retryable` (`code` and `message`
   required, additional properties open so `details` and `cause` validate).

Unlike `result.json`, the advertised MCP envelope omits `additionalProperties: false` and external
`$ref`s so every MCP client validator can compile it standalone and accept all optional
`CommandResult` UX fields.

## Conformance

- Every golden wire fixture in [`../wire/`](../wire/README.md) validates against its schema in
  TypeScript, Python, Rust and C++ tests.
- Every implementation's `commandResultOutputSchema` / `command_result_output_schema` helper is
  tested equal to [`output-envelope.json`](./output-envelope.json).
- The todo conformance runner (`packages/examples/todo/dx/conformance.ts`) validates every
  `CommandResult` returned by every backend against [`result.json`](./result.json).
