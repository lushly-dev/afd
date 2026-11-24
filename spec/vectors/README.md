# Behavior vectors

Language-neutral test cases for AFD behavior. Where `spec/wire` pins the *shapes* of results,
these pin *behavior*. Specification-authored files are written directly from `spec/*.md`;
mechanically generated files are guarded in CI against unflagged drift
(`scripts/check-vector-drift.mjs`).

| File | Covers | Provenance |
| --- | --- | --- |
| `error-codes.json` | The shared error-code catalog of [`spec/error-codes.md`](../error-codes.md), in catalog order, with `{ code, retryable, profile }` per entry and the reserved `hostPrefix` | Specification-authored |
| `recovery.json` | Structured recovery on `CommandError` ([`spec/recovery.md`](../recovery.md)): whole errors that are valid and invalid under [`schema/error.json`](../schema/error.json), each invalid one with the rule it breaks; valid ones round-trip through each language's native type | Specification-authored |
| `dispatch.json` | Single-command dispatch order ([`spec/dispatch.md`](../dispatch.md)): lookup, exposure, active context, confirmation, input validation, declared context fields, middleware, approval admission, handler, metadata stamping and observer hooks | Specification-authored |
| `execution-controls.json` | Server default deadline, cancellation propagation, batch size/parallelism ceilings and validation issue cap ([`spec/execution-controls.md`](../execution-controls.md)) | Specification-authored |
| `app-calls.json` | App-to-app calls ([`spec/command-metadata.md`](../command-metadata.md#app-to-app-calls)): the `apps` exposure flag's default, and which calls with the `apps` interface run or get the one `CALL_NOT_GRANTED` refusal | Specification-authored |
| `tool-strategies.json` | The hybrid tool strategy ([`spec/tool-strategies.md`](../tool-strategies.md#conformance)): each server's `tools/list` names in order, its `ttlMs`, call outcomes, and the configurations that must fail construction | Specification-authored |
| `mcp-resources.json` | MCP resources, the Skills extension, extra tool `_meta` keys and catalog validation ([`spec/mcp-resources.md`](../mcp-resources.md#conformance)): `toolMetaKeys`, a two-skill catalog (`skills/list`, `resources/list`, reads, `skills/get`, errors) and `catalogFailures` | Specification-authored |
| `output-budgets.json` | Per-command output budgets ([`spec/output-budgets.md`](../output-budgets.md#conformance)): declarations (B1), asks and effective budgets (B2–B4), canonical-JSON byte measurement (B5), read/mutation enforcement and reports (B5–B6), per-item batch budgets (B7), and journal recording (B8) | Specification-authored |
| `approval-tokens.json` | Approval tokens ([`spec/command-metadata.md`](../command-metadata.md#approvals)): canonical JSON, the keyed input and actor digests, the payload layout, every acceptance and rejection reason, and rule 6 token delivery (`tokenDelivery`) | Format-generated (`generate-approval-tokens.mjs`) |
| `approver-client.json` | Approval evidence from an approver client and the approval display rules ([`spec/command-metadata.md`](../command-metadata.md#approval-evidence-from-an-approver-client)): an approver's token and its principal binding, the `_meta` carrier over MCP, and every display limit and hidden range | Format-generated (`generate-approver-client.mjs`) |
| `journal-context-cap.json` | The journal's 4096-byte cap on a declared context field's value ([`spec/journal.md`](../journal.md#declared-context-fields)): values just at, under and over it, where number spelling, multibyte UTF-8 and escapes decide kept or omitted | Format-generated (`generate-journal-context-cap.mjs`) |
| `pipeline-variables.json` | Reference resolution and `when` conditions ([`spec/pipeline-variables.md`](../pipeline-variables.md)) against one fixed pipeline context | Legacy reference-generated (`generate-pipeline-variables.mjs`) |
| `batch-controls.json` | Batch and pipeline execution controls: `stopOnError`, `parallelism`, the batch `timeout` and pipeline `timeoutMs` deadlines, `continueOnFailure`, `UNSUPPORTED_OPTION`, and envelope validation | Legacy reference-generated (`generate-batch-controls.mjs`) |
| `validation.json` | Command input validation ([`spec/validation.md`](../validation.md)): unknown keys, the `VALIDATION_ERROR` shape, length units, the JSON Schema subset, explicit `null` and defaults | Legacy reference-generated (`generate-validation.mjs`) |
| `output-schema.json` | The CommandResult envelope a command tool advertises as its top-level `outputSchema` ([`spec/command-metadata.md`](../command-metadata.md#structured-results)): which `data` schemas keep their definitions, and a `"$ref": "#"` naming `data` retargeted to `#/properties/data` | Legacy reference-generated (`generate-output-schema.mjs`) |

## Authored vs. generated vectors

Every vector file in `spec/vectors/` falls into one of three categories, enforced by
`scripts/check-vector-drift.mjs` in CI:

1. **Specification-authored (mandatory default for all new vectors).** Written directly from the
   normative specification (`spec/*.md`) without deriving expected outcomes from any single
   language's runtime output. Because no implementation judges itself, a bug or dependency upgrade in
   TypeScript, Python, Rust or C++ cannot silently redefine the contract. Every new vector file
   (`error-codes.json`, `recovery.json`, `dispatch.json`, `execution-controls.json`, `app-calls.json`,
   `tool-strategies.json`, `mcp-resources.json`, `output-budgets.json`, and
   `spec/protocol-conformance.json` beside its spec page) **MUST** be specification-authored.
2. **Format-generated (permitted only when hand computation is infeasible).** Allowed strictly for
   vectors whose expected outputs are deterministic cryptographic digests or exact byte/code-unit
   padding derived from documented wire formulas rather than engine verdicts:
   - `approval-tokens.json` (HMAC-SHA256 digests and base64url payloads with fixed nonces),
   - `journal-context-cap.json` (4095/4096/4097-byte UTF-8 canonical JSON padding), and
   - `approver-client.json` (1000-unit boundary payloads and HMAC carrier tokens).
3. **Legacy reference-generated (frozen set).** `validation.json`, `batch-controls.json`,
   `pipeline-variables.json` and `output-schema.json` predate this rule and remain paired with their
   TypeScript generators so existing cross-language coverage is preserved without churn. **No new
   file may be added to this category.** Any change to a generated vector file must pass the CI
   drift and behaviour-change check below.

## Contract

- Every language loads every file in its test suite and requires matching results under each file's
  comparison rules. Validation sibling issues and field lists compare without order, preserving
  duplicates and omitted lists; suggestions follow actual details. Where a
  language does not load a file yet, the entry is tracked in the
  [parity closure plan](../../docs/features/active/parity-closure/parity-closure.plan.md):

  | Language | `pipeline-variables.json` | `batch-controls.json` | `execution-controls.json` | `validation.json` | `error-codes.json` | `recovery.json` | `dispatch.json` | `approval-tokens.json` | `journal-context-cap.json` | `approver-client.json` | `tool-strategies.json` | `mcp-resources.json` | `output-budgets.json` | `app-calls.json` | `output-schema.json` |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | TypeScript | `packages/core/src/pipeline-variables-vectors.test.ts` | `packages/core/src/batch-controls-vectors.test.ts` | `packages/server/src/execution-controls-vectors.test.ts` | `packages/server/src/validation-vectors.test.ts` | `packages/core/src/errors.test.ts` | `packages/server/src/recovery-vectors.test.ts` | `packages/server/src/dispatch-vectors.test.ts` | `packages/server/src/approval-vectors.test.ts` | `packages/server/src/journal-context-cap-vectors.test.ts` | `packages/server/src/approver-client-vectors.test.ts` | `packages/server/src/tool-strategies-vectors.test.ts` | `packages/server/src/mcp-resources-vectors.test.ts` | `packages/server/src/output-budget-vectors.test.ts` | `packages/core/src/app-calls-vectors.test.ts`, `packages/server/src/app-calls-vectors.test.ts` | `packages/server/src/output-schema-vectors.test.ts` |
  | Python | `python/tests/test_pipeline_vectors.py` | `python/tests/test_batch_controls_vectors.py` | `python/tests/test_execution_controls_vectors.py` | `python/tests/test_validation_vectors.py` | `python/tests/test_error_codes.py` | `python/tests/test_recovery_vectors.py` | `python/tests/test_dispatch_vectors.py` | `python/tests/test_approval_vectors.py` | `python/tests/test_journal_context_cap_vectors.py` | `python/tests/test_approver_client_vectors.py` (every case skipped: a gap) | `python/tests/test_tool_strategies_vectors.py` | `python/tests/test_mcp_resources_vectors.py`, `python/tests/test_tool_meta.py` | `python/tests/test_output_budget_vectors.py` | `python/tests/test_app_calls_vectors.py` | `python/tests/test_output_schema_vectors.py` |
  | Rust | `packages/rust/tests/pipeline_vectors.rs` | `packages/rust/tests/batch_controls_vectors.rs` | `packages/rust/tests/execution_controls_vectors.rs` | `packages/rust/tests/validation_vectors.rs` | `packages/rust/tests/error_codes.rs` | `packages/rust/tests/recovery_vectors.rs` | `packages/rust/tests/dispatch_vectors.rs` | `packages/rust/tests/approval_vectors.rs` | `packages/rust/tests/journal_context_cap_vectors.rs` | `packages/rust/tests/approver_client_vectors.rs` (the carrier with `server-auth`) | `packages/rust/tests/tool_strategies_vectors.rs` (the `server` feature) | `packages/rust/tests/mcp_resources_vectors.rs` (the `server` feature) | `packages/rust/tests/output_budget_vectors.rs` | `packages/rust/tests/app_calls_vectors.rs` | `packages/rust/tests/output_schema_vectors.rs` |
  | C++ | `packages/cpp/tests/vectors_test.cpp` | `packages/cpp/tests/batch_vectors_test.cpp` | `packages/cpp/tests/execution_controls_vectors_test.cpp` | `packages/cpp/tests/vectors_test.cpp` | `packages/cpp/tests/vectors_test.cpp` | `packages/cpp/tests/recovery_vectors_test.cpp` | `packages/cpp/tests/dispatch_vectors_test.cpp` | `packages/cpp/tests/approval_vectors_test.cpp` | `packages/cpp/tests/journal_context_cap_vectors_test.cpp` | `packages/cpp/tests/approver_client_vectors_test.cpp` (every case skipped: a gap) | `packages/cpp/tests/tool_strategies_vectors_test.cpp` (`AFD_BUILD_MCP_STDIO`) | `packages/cpp/tests/mcp_resources_vectors_test.cpp` (`AFD_BUILD_MCP_STDIO`), `packages/cpp/tests/tool_meta_test.cpp` | `packages/cpp/tests/output_budget_vectors_test.cpp` | `packages/cpp/tests/app_calls_vectors_test.cpp` | `packages/cpp/tests/vectors_test.cpp` |

- Changes to `spec/vectors` run the Python, Rust and C++ workflows as well as `ci.yml`.
- **A documented gap.** A file may name, in its top-level `gaps`, the languages that load it but
  do not implement its behavior yet, each with its tracking issue. Such a language's suite loads
  the file, checks that it is still listed, and skips every case with that issue as the reason, so
  its run shows the gap instead of failing. Implementing the behavior means running the cases and
  removing the language from `gaps`. Only `approver-client.json` has one (Python and C++,
  [#1466](https://github.com/lushly-dev/afd/issues/1466)).
- A vector file joins this directory once all four languages load it, because `alfred parity`
  fails on any file here that a language does not load. Until then it sits in `spec/` next to the
  page it pins: [`authorization.json`](../authorization.json), for MCP authorization, the principal
  binding of [#532](https://github.com/lushly-dev/afd/issues/532) and the relay input digest
  ([`authorization.md`](../authorization.md#conformance)), is loaded by Rust so far, every case
  (`packages/rust/tests/authorization_cases.rs`, Umbel phase 5 step 0b, with the `server-auth`
  feature), and by TypeScript and Python for its `principalBindings` section only (step 0c); C++,
  which has no HTTP server, never will, so it stays beside this directory.

### `dispatch.json`

Single-command dispatch order ([`spec/dispatch.md`](../dispatch.md)). `setup` defines five commands
(`item-echo`, `secret-rotate`, `item-purge`, `item-approve`, `item-throw`), two contexts
(`planning`, `combat`), and one required declared context field (`tenant`). Each case builds a fresh
registry with two outer/inner observer middleware layers (`mw1`, `mw2`), optionally attaches the
approval middleware (`withApprovalMiddleware`), declared context fields (`withContextFields`), or a
throwing `mw1` (`middleware: "throw"`), and runs one `registry` call or one `mcp` `afd-call` (with
confirmations enforced).

`expect` pins `success`, `code`, `retryable` and `message` (when specified), `data`, the exact
`hooks` sequence (`mw1:before`, `mw2:before`, `handler`, `mw2:after`, `mw1:after`), the `stamped`
metadata fields (`executionTimeMs`, `commandVersion`, `traceId`, `actorKind`), and whether
`onCommand` (with raw input) and `onError` fired. Documented per-language gaps are listed in
top-level `gaps` (`python.hooks` [#1551](https://github.com/lushly-dev/afd/issues/1551),
`rust.stamping` / `rust.hooks` [#546](https://github.com/lushly-dev/afd/issues/546)).

### `pipeline-variables.json`

- Build the pipeline context from `context`. `previous` is the index of the step that `$prev`
  reads.
- `resolved: false` means the reference does not resolve: TypeScript's `undefined`, and absent in
  the spec. Inside a step input, an unresolved reference is omitted from its object.
- `resolved: true` gives the `value`. For a literal (`$9.99`, `$$prev`), that is the literal string.
- Each condition evaluates to `expected`. The first operand of a comparison is a reference: a
  literal there is absent, so `{"$exists": "$$prev"}` is `false`.

### `batch-controls.json`

The normative rules for fractional timeouts, `stopOnError` and caller cancellation are in
[`execution-controls.md`](../execution-controls.md). Concurrent cancellation/failure tests use
barriers in each executor suite; these timer vectors cover deterministic request and deadline behavior.

Each case in `batch` runs `request` through the language's batch executor, and each case in
`pipeline` runs it through the pipeline executor. The executor calls the case's `handlers`, which
are keyed by command name:

| Handler | Behavior |
| --- | --- |
| `{}` | Succeeds at once, with its input as data |
| `{"delayMs": N}` | Takes N ms on the clock, then succeeds with its input |
| `{"untilCancelled": true}` | Runs until the executor cancels it at the deadline, then succeeds with its input |
| `{"fail": {"code", "message"}}` | Fails with that error (after `delayMs`, if also given) |

Run the cases on a fake clock where the language has one:
- TypeScript: Vitest fake timers;
- Rust: Tokio's paused time;
- C++: `ManualClock`, where `delayMs` advances the clock.

Python has no fake clock for asyncio, so its cases run in real time. The deadlines leave wide
margins for that.

`expected` holds:
- `calls`: every handler call as its command and input, in the order the handlers started.
- `peakConcurrency` (batch): the most handlers running at once. A runner that runs one command at a
  time, such as C++'s default `InlineTaskRunner`, may report fewer.
- For a batch that ran:
  - `success: true` and the `summary` counts;
  - `results`, each with `id`, `index`, `command` and `success`, then `data` or `error`;
  - `durationMs: 0`, given only for a command that never ran.
- For a rejected batch: `success: false`, the `error` and no `results`.
- For a pipeline:
  - `data`: the last successful step's, and absent when no step succeeded;
  - `completedSteps` and `totalSteps`;
  - `steps`, each with `index`, `command`, `alias`, `status`, `data` and `error`.

  A rejected pipeline has one synthetic step, with index `-1` and command `""`.

Comparison rules:
- An `error` compares `code` and `message`, and `retryable` only when the vector gives it.
  `suggestion` text is not compared.
- A field the vector leaves out must be absent. For example, a step skipped after a failure has no
  `error`, but a step skipped at the deadline has `PIPELINE_TIMEOUT`.
- A statically typed language may reject an invalid envelope when it parses the request into its
  own types. Rust does this. That counts as the expected rejection, because nothing runs.

### `validation.json`

- [`spec/validation.md`](../validation.md#conformance) says how to compare results.
- A case with `optionalKeywords` must fail to register in a language that does not support one
  of them.
- `exceptions` marks tests where a named language may differ, and says why.
- `issue-count-capped` verifies the `maxValidationIssues = 100` cap in
  [`spec/execution-controls.md`](../execution-controls.md#validation-issue-cap) (replacing the
  pre-cap `issue-count-uncapped` case when
  [#2128](https://github.com/lushly-dev/afd/issues/2128)–[#2131](https://github.com/lushly-dev/afd/issues/2131)
  landed).

### `approval-tokens.json`

The generator takes canonical JSON from the TypeScript reference and builds every token itself from
the documented format, with a fixed nonce per case, so the file pins the format rather than one
implementation's output and is the same on every run. `secrets`, `now`, `ttlMs`, `commands` and
`actors` configure the middleware: every command has `approval: 'required'`, and an `actor` of
`null` means a call without one.

Each case in `bindings` is one call. A language must:
- encode `input` as `canonicalInput`, where it exposes canonical JSON;
- issue, at `now` with the `current` secret, a token whose decoded payload equals `payload` once
  its own random `n` replaces `nonce`, and whose `n` decodes to 16 bytes. A language that can fix
  its random source issues `token` exactly;
- accept `token` for that call.

Each case in `verify` builds one middleware from its `secrets` (names in `secrets`, the first
signs; default `current`), `now` (default the top-level `now`) and `replay` (default single use),
then presents `token` to the call it names once per entry in `expected`. The outcomes must equal
`expected`: `accepted` when the handler ran, else `details.reason` of the `APPROVAL_REQUIRED`
result. The cases cover single use and reuse within the TTL, the expiry boundary, each mismatch
and the order they are checked in, key rotation, changed payloads and MACs, a MAC respelled with
nonzero padding bits, and malformed tokens.

### `approver-client.json`

[Approval evidence from an approver client](../command-metadata.md#approval-evidence-from-an-approver-client)
and the [approval display rules](../command-metadata.md#approval-display), from Loam phase 5's
step 0c. Python and C++ are a [documented gap](#contract) until
[#1466](https://github.com/lushly-dev/afd/issues/1466).

- **`display`.** Each case gives an `input` and its verdict: `shown`, or the refusal
  (`too-long`, `too-many-values`, `too-deep`, `string-too-long`, `key-too-long` or
  `hidden-characters`). A language runs its display function on the input and compares. Every
  limit is tested at and one past its value, lengths in UTF-16 code units (a `🍅` is two), keys in
  canonical order (`"10"` before `"9"`), and every hidden range at its first and last code point
  with neighbours that stay visible. Unpaired surrogates and `not-json` are left to each
  language's own tests: JSON text cannot carry them to every reader.
- **`carrier`.** One MCP server per case, with `todo-delete` (approval required, input
  `{ id: number }`) and `todo-list` (no approval, no input), the approval middleware with
  `secret`, `ttlMs`, the relay set to MCP elicitation, tokens off MCP for other callers, and a clock
  fixed at `now`. `callers` gives each caller's verified credentials, the actor the server maps
  from them (M4's default), its principal binding (M8) and whether the server names it an
  approver. Each step is one MCP 2026-07-28 `tools/call` of `tool` with `arguments`, from
  `caller`, declaring form elicitation when `elicit` is true, and carrying `approval` in
  `_meta["dev.afd/approval"]` when given: a string as it is, or `{ "token": n }` for the
  `details.approvalToken` that step `n` of the case returned. `expected` is `{ "success": true }`,
  or the error's `code` with, when given, whether a token came back (`token`) and
  `details.reason` (absent when the vector has none). A step that returns a token gives its
  decoded `payload` but for the random `n`, which decodes to 16 bytes. `runs` counts the handler
  runs of the case so far.

  TypeScript tells callers apart with `createContext`; Rust verifies each caller's own bearer
  token (`server-auth`), with claims for its `issuer`, `subject` and `clientId`.

### `app-calls.json`

[App-to-app calls](../command-metadata.md#app-to-app-calls), the `apps` exposure flag and the one
`CALL_NOT_GRANTED` refusal, `refusal`, which every refused case must equal byte for byte.

- `exposure`: an `expose` object (`null` for none) and whether it exposes the command to each of
  the five interfaces.
- `registry`: build one registry per case with the three `commands`, each with its `expose`, the
  input schema `input` (an optional integer `by`, default `1`), and a handler that returns
  `{ "command": <its name>, "by": <by> }`. A case's `grant` installs the call grant: `grants`
  grants a command to the caller whose name `registry.grants` maps to a list holding it; `none`
  installs none; `throws` installs one that throws or panics.
- `calls`: the call's `name`, `input`, `interface` (absent: no interface) and `caller`, which the
  host's context field carries (TypeScript `context.caller`, Rust `context.extra["caller"]`).
  `expect` is `refused`, a `code`, or the `data`. A case with `validates` needs a registry that
  validates input, which TypeScript's core registry does not.
- `batches`: a batch run with the case's interface and caller; each item's `expect` as above.
  `requestContext`, where a language's batch request carries a `context` of its own (Rust), is set
  on the request; a language without one leaves it out.

A language whose in-process registry for an `apps` call needs the grant at construction
(TypeScript's `createAppCallRegistry`) checks that creating one with `grant: none` fails instead.

### `journal-context-cap.json`

`json` is a context field's value as JSON text, spelled as a caller might send it: `1.0`, `1e21`,
`-0`, `€` escapes and whitespace reach the language's JSON reader as written. The cap measures
the value's canonical JSON instead: object keys sorted, no whitespace, strings escaped and numbers
written as JavaScript's `JSON.stringify` writes them, so `1.0` is `1`, `1e21` is `1e+21`, `1e20` is
`100000000000000000000` and `-0` is `0`. An integer that a 64-bit float cannot hold exactly is
written as the float JavaScript reads it as: `99999999999999999` is `100000000000000000`. The
generator pads each text with ASCII `x`s until its canonical JSON is 4095, 4096 or 4097 bytes.

For each case a language must:
- parse `json` with its JSON reader;
- measure the UTF-8 canonical JSON of the result as `bytes`, where it exposes the measure;
- journal the value as the declared field `field` (marked `journal: true`) and get `expected`:
  `kept`, the value alone in `context`, or `omitted`, `field` alone in `contextOmitted`.

A value of exactly `maxBytes` bytes is kept. The cases cover strings, whitespace and key order,
whole numbers written with a fraction, exponents, fixed and scientific notation, shortest
round-trip decimals, negative zero, integers past 2^53, two-, three- and four-byte characters,
`\u` escapes, the short escapes, other control characters, the characters JavaScript leaves
unescaped (DEL, U+2028 and U+2029), object keys and nesting.

### `output-budgets.json`

Per-command output budgets ([`spec/output-budgets.md`](../output-budgets.md#conformance), B1–B8).
The six sections (`declarations`, `asks`, `measure`, `checks`, `batch`, `journal`) pin declaration
and ask validation, effective budget computation, canonical-JSON byte measurement without
`metadata`, over-budget read replacement (`OUTPUT_BUDGET_EXCEEDED`), over-budget mutation warnings,
in-budget reports (`metadata["dev.afd/outputBudget"]`), per-item batch checks, and journal
recording. Rust and C++ skip only the lone-surrogate `measure` case, because their UTF-8 string
types cannot hold an unpaired surrogate; TypeScript and Python run every case.

## Regenerating and CI drift guard

`scripts/check-vector-drift.mjs` runs in `pnpm check` (`ci.yml`) and fails whenever:

1. a `spec/vectors/*.json` file or `generate-*.mjs` script is unclassified in `VECTOR_MANIFEST`;
2. a mechanically generated vector file differs from its generator's `--stdout` output when the
   TypeScript build outputs exist; or
3. a mechanically generated vector file changed relative to `main` without a `.changeset/*.md`
   fragment whose body carries a `Behaviour change:` (or `Behavior change:`) line.

After an intentional change to a generated vector file:

```bash
pnpm -F @lushly-dev/afd-core build
pnpm -F @lushly-dev/afd-server build
node spec/vectors/generate-pipeline-variables.mjs
node spec/vectors/generate-batch-controls.mjs
node spec/vectors/generate-validation.mjs
node spec/vectors/generate-approval-tokens.mjs
node spec/vectors/generate-journal-context-cap.mjs
node spec/vectors/generate-approver-client.mjs
node spec/vectors/generate-output-schema.mjs
npx biome format --write spec/vectors
```

Then add a `.changeset/*.md` fragment with a `Behaviour change: ...` line describing the
cross-language impact, and update every language that consumes the changed file in the same pull
request.

- `generate-validation.mjs` defines its cases as Zod schemas, because that is how TypeScript
  commands declare input. It records the JSON Schema TypeScript advertises for each case.
- The TypeScript test builds the same cases and fails until the file is regenerated.
