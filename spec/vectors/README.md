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
| `human-relay.json` | The relay's pending list ([`spec/confirmations.md`](../confirmations.md#the-pending-list)): the whole `CONFIRMATION_REQUIRED` refusal for a relay's pending decision, and the decision ids and links that are an internal error instead | Specification-authored |
| `app-calls.json` | App-to-app calls ([`spec/app-calls.md`](../app-calls.md)): the `apps` exposure flag's default, and which calls with the `apps` interface run or get the one `CALL_NOT_GRANTED` refusal | Specification-authored |
| `tool-strategies.json` | The hybrid tool strategy ([`spec/tool-strategies.md`](../tool-strategies.md#conformance)): each server's `tools/list` names in order, its `ttlMs`, call outcomes, and the configurations that must fail construction | Specification-authored |
| `mcp-resources.json` | MCP resources, the Skills extension, extra tool `_meta` keys and catalog validation ([`spec/mcp-resources.md`](../mcp-resources.md#conformance)): `toolMetaKeys`, a two-skill catalog (`skills/list`, `resources/list`, reads, `skills/get`, errors) and `catalogFailures` | Specification-authored |
| `output-budgets.json` | Per-command output budgets ([`spec/output-budgets.md`](../output-budgets.md#conformance)): declarations (B1), asks and effective budgets (B2–B4), canonical-JSON byte measurement (B5), read/mutation enforcement and reports (B5–B6), per-item batch budgets (B7), and journal recording (B8) | Specification-authored |
| `approval-tokens.json` | Approval tokens ([`spec/approvals.md`](../approvals.md)): canonical JSON, the keyed input and actor digests, the payload layout, every acceptance and rejection reason, and rule 6 token delivery (`tokenDelivery`) | Format-generated (`generate-approval-tokens.mjs`) |
| `approver-client.json` | Approval evidence from an approver client and the approval display rules ([`spec/approvals.md`](../approvals.md#approval-evidence-from-an-approver-client)): an approver's token and its principal binding, the `_meta` carrier over MCP, and every display limit and hidden range | Format-generated (`generate-approver-client.mjs`) |
| `journal-context-cap.json` | The journal's 4096-byte cap on a declared context field's value ([`spec/journal.md`](../journal.md#declared-context-fields)): values just at, under and over it, where number spelling, multibyte UTF-8 and escapes decide kept or omitted | Format-generated (`generate-journal-context-cap.mjs`) |
| `journal-seams.json` | The dispatch id ([`spec/dispatch.md`](../dispatch.md#the-dispatch-id), I1 to I4) and the approval summary ([`spec/approvals.md`](../approvals.md#the-approval-summary), rules 1 to 5). No language is a documented gap | Specification-authored |
| `idempotency.json` | Idempotency keys ([`spec/idempotency.md`](../idempotency.md)): what a command declares, the key's form, delivery and derived keys, the engine's step, the retry rule, the `TIMEOUT` recovery and the journal member. Python, Rust and C++ are documented gaps | Specification-authored |
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
   `tool-strategies.json`, `mcp-resources.json`, `output-budgets.json`, `journal-seams.json`,
   `idempotency.json`, and
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
  [parity closure plan](../../docs/features/complete/parity-closure/parity-closure.plan.md):

  | Language | `pipeline-variables.json` | `batch-controls.json` | `execution-controls.json` | `validation.json` | `error-codes.json` | `recovery.json` | `dispatch.json` | `approval-tokens.json` | `journal-context-cap.json` | `approver-client.json` | `tool-strategies.json` | `mcp-resources.json` | `output-budgets.json` | `app-calls.json` | `output-schema.json` | `journal-seams.json` | `idempotency.json` | `human-relay.json` |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | TypeScript | `packages/core/src/pipeline-variables-vectors.test.ts` | `packages/core/src/batch-controls-vectors.test.ts` | `packages/server/src/execution-controls-vectors.test.ts` | `packages/server/src/validation-vectors.test.ts` | `packages/core/src/errors.test.ts` | `packages/server/src/recovery-vectors.test.ts` | `packages/server/src/dispatch-vectors.test.ts` | `packages/server/src/approval-vectors.test.ts` | `packages/server/src/journal-context-cap-vectors.test.ts` | `packages/server/src/approver-client-vectors.test.ts` | `packages/server/src/tool-strategies-vectors.test.ts` | `packages/server/src/mcp-resources-vectors.test.ts` | `packages/server/src/output-budget-vectors.test.ts` | `packages/core/src/app-calls-vectors.test.ts`, `packages/server/src/app-calls-vectors.test.ts` | `packages/server/src/output-schema-vectors.test.ts` | `packages/server/src/journal-seams-vectors.test.ts` | `packages/server/src/idempotency-vectors.test.ts` | `packages/server/src/human-relay-vectors.test.ts` |
  | Python | `python/tests/test_pipeline_vectors.py` | `python/tests/test_batch_controls_vectors.py` | `python/tests/test_execution_controls_vectors.py` | `python/tests/test_validation_vectors.py` | `python/tests/test_error_codes.py` | `python/tests/test_recovery_vectors.py` | `python/tests/test_dispatch_vectors.py` | `python/tests/test_approval_vectors.py` | `python/tests/test_journal_context_cap_vectors.py` | `python/tests/test_approver_client_vectors.py` (every case skipped: a gap) | `python/tests/test_tool_strategies_vectors.py` | `python/tests/test_mcp_resources_vectors.py`, `python/tests/test_tool_meta.py` | `python/tests/test_output_budget_vectors.py` | `python/tests/test_app_calls_vectors.py` | `python/tests/test_output_schema_vectors.py` | `python/tests/test_journal_seams_vectors.py` | `python/tests/test_idempotency_vectors.py` (every case skipped: a gap) | `python/tests/test_human_relay_vectors.py` |
  | Rust | `packages/rust/tests/pipeline_vectors.rs` | `packages/rust/tests/batch_controls_vectors.rs` | `packages/rust/tests/execution_controls_vectors.rs` | `packages/rust/tests/validation_vectors.rs` | `packages/rust/tests/error_codes.rs` | `packages/rust/tests/recovery_vectors.rs` | `packages/rust/tests/dispatch_vectors.rs` | `packages/rust/tests/approval_vectors.rs` | `packages/rust/tests/journal_context_cap_vectors.rs` | `packages/rust/tests/approver_client_vectors.rs` (the carrier with `server-auth`) | `packages/rust/tests/tool_strategies_vectors.rs` (the `server` feature) | `packages/rust/tests/mcp_resources_vectors.rs` (the `server` feature) | `packages/rust/tests/output_budget_vectors.rs` | `packages/rust/tests/app_calls_vectors.rs` | `packages/rust/tests/output_schema_vectors.rs` | `packages/rust/tests/journal_seams_vectors.rs` (the relay and elicitation cases with `server`) | `packages/rust/tests/idempotency_vectors.rs` (every case skipped: a gap) | `packages/rust/tests/human_relay_vectors.rs` (`server` feature) |
  | C++ | `packages/cpp/tests/vectors_test.cpp` | `packages/cpp/tests/batch_vectors_test.cpp` | `packages/cpp/tests/execution_controls_vectors_test.cpp` | `packages/cpp/tests/vectors_test.cpp` | `packages/cpp/tests/vectors_test.cpp` | `packages/cpp/tests/recovery_vectors_test.cpp` | `packages/cpp/tests/dispatch_vectors_test.cpp` | `packages/cpp/tests/approval_vectors_test.cpp` | `packages/cpp/tests/journal_context_cap_vectors_test.cpp` | `packages/cpp/tests/approver_client_vectors_test.cpp` (every case skipped: a gap) | `packages/cpp/tests/tool_strategies_vectors_test.cpp` (`AFD_BUILD_MCP_STDIO`) | `packages/cpp/tests/mcp_resources_vectors_test.cpp` (`AFD_BUILD_MCP_STDIO`), `packages/cpp/tests/tool_meta_test.cpp` | `packages/cpp/tests/output_budget_vectors_test.cpp` | `packages/cpp/tests/app_calls_vectors_test.cpp` | `packages/cpp/tests/vectors_test.cpp` | `packages/cpp/tests/journal_seams_vectors_test.cpp` (the relay case skipped: no `HumanRelay`; the elicitation cases with `AFD_BUILD_MCP_STDIO`) | `packages/cpp/tests/idempotency_vectors_test.cpp` (every case skipped: a gap) | `packages/cpp/tests/human_relay_vectors_test.cpp` (every case skipped: a gap) |

- Changes to `spec/vectors` run the Python, Rust and C++ workflows as well as `ci.yml`.
- **A documented gap.** A file may name, in its top-level `gaps`, the languages that load it but
  do not implement its behavior yet, each with its tracking issue. Such a language's suite loads
  the file, checks that it is still listed, and skips every case with that issue as the reason, so
  its run shows the gap instead of failing. Implementing the behavior means running the cases and
  removing the language from `gaps`. `approver-client.json` has one (Python and C++,
  [#1466](https://github.com/lushly-dev/afd/issues/1466)), and `journal-seams.json` lists every
  language that has not implemented it ([#2682](https://github.com/lushly-dev/afd/issues/2682)): it
  was written with the specification, before any implementation, and TypeScript
  ([#2680](https://github.com/lushly-dev/afd/issues/2680)), Rust
  ([#2681](https://github.com/lushly-dev/afd/issues/2681)), Python and C++
  ([#2682](https://github.com/lushly-dev/afd/issues/2682)) have left it, so it lists none. `idempotency.json` listed all
  four for the same reason; TypeScript left it with its implementation
  ([#2675](https://github.com/lushly-dev/afd/issues/2675)), and Python, Rust and C++ stay listed
  ([#2676](https://github.com/lushly-dev/afd/issues/2676)).
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
top-level `gaps` (`python.hooks` [#2788](https://github.com/lushly-dev/afd/issues/2788),
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

[Approval evidence from an approver client](../approvals.md#approval-evidence-from-an-approver-client)
and the [approval display rules](../approvals.md#approval-display), from Loam phase 5's
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

[App-to-app calls](../app-calls.md), the `apps` exposure flag and the one
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

### `idempotency.json`

Idempotency keys ([`spec/idempotency.md`](../idempotency.md)). `metaKey` is the `_meta` key the
key travels in. No implementation exists yet, so the file fixes what a harness must build and
check; the first language to implement a section may sharpen a case's wording but not its meaning.
A `null` in an `expect` means the member or annotation is absent. A language without a surface a
case needs (C++ has no HTTP server and no tasks, and its default build cannot throw) skips that
case and says so.

- **`declaration.cases`** (D1, D2): a command defined with `command`'s fields reports `idempotency`
  in its tool `_meta` as `metaIdempotency`, and the MCP annotation `idempotentHint` as given.
- **`key.form`** (K2): `key`, or `repeat` written `times` times, is `valid` as a caller's key or
  not.
- **`key.derived`** (K4): the key of the item or step at `index` of a `batch` or `pipeline` whose
  request carried `base`.
- **`key.delivery`** (K1 to K6): a call to a command that declares nothing, whose handler notes the
  key it reads from the context. `via` is where the caller puts `key`: `meta` (`_meta[metaKey]`),
  `meta-argument` (the `meta` argument of `afd-call`), `context` (an in-process call), or `input`
  (a member of the command's input named `idempotencyKey`, which is not the key). `keyIsNull`
  sends an explicit `null`. With `kind`, the request is a batch or pipeline of `items` calls. With
  `nested`, the outer call's handler runs the same command once more through the registry,
  passing its own context on unchanged, and that nested handler, which does not nest again, notes
  what it reads. In `expect`: `success` and
  `code` are the result's, `handlerRuns` is how many times a handler ran, `handlerSeesKey` and
  `handlerSeesKeys` are what the handlers noted, `nestedHandlerSeesKey` what the nested one did,
  and `detailsMeta` is the error's `details.meta`.
- **`step`** (S1 to S11, S13): `setup` gives the step's options, a clock the harness sets, the
  input schema, one declared context field, the commands and two actors. A case makes its `calls`
  in order against one server and one store; a call without `actor` runs as `agent`, and
  `actor: null` gives it none.
  - A call has `command`, `input` and optionally `key` and `context` (its declared context field
    values); with `kind: "batch"` it has `commands` and the request's `key`.
  - `at` sets the clock, in milliseconds, before the call. `timeoutMs` gives the call that
    deadline, counted on the same clock from when it was made; a call without it has no deadline,
    whatever the engine's default.
  - `approved` says whether the harness's approval step admits the call (`order-approve` only).
  - `heldInHandler` holds the call inside its handler until every call marked `whileFirstIsHeld`
    has returned; use a barrier, never a timer. Where the held call has a `timeoutMs`, its caller
    is answered at the deadline while the handler stays held.
  - `outlivesDeadline`: the handler returns its usual result only after the call's deadline has
    passed. The calls of a case run one after another, so the handler moves the clock to just
    past the deadline itself (the deadline plus 1); moving it further would make the next call's
    `at` move the clock backwards.
  - `cancelledDuringReserve`: the harness's store holds `reserve` until the call's own
    cancellation signal has fired, then lets it through. The harness fires the signal the call
    was given (Python's `context.signal`), never by cancelling the call's task: a cancelled task
    never learns its reservation's identity, so it could not release it, and the case's second
    call would fail.
  - `asTask` makes the call as an MCP task and reads the task's result.
  - `inputNotCanonical` gives an input the language's canonical JSON refuses.
  - `connection` names which of two connections the call arrives on.
  - A case's `seed.reservation` puts a reservation in the store before the first call: made at
    `madeAt` for that command, input, key and actor, by a call with no deadline, and not settled.
  - A case's `surface` is where the calls are made: `http-without-credentials` (over HTTP, on a
    server whose host has not declared that its hook identifies callers),
    `http-with-unbindable-credentials` (over HTTP with verified credentials whose client id is
    empty), or `two-stdio-connections` (two stdio connections whose servers share one host
    store). Without it the calls are in process.
  - A case's `engine` says which engine it is for, by what the engine does when a call's deadline
    passes (S7): `continues`, `waits`, `cancels` or `drops`. A language runs the one that names
    its engine and skips the other three.
  - In a call's `expect`: `success`, `data`, `code`, `retryable` and `recovery` are the result's;
    `replay` is whether its `metadata.idempotentReplay` is `true` (`false` means the member is
    absent); `metadata` gives members the result's metadata must also hold; `detailsMeta` and
    `detailsReason` are `details.meta` and `details.reason`; `internalError` means the call fails
    as M8's internal error, with a message that names no one; `items` are a batch's item results,
    in order.
  - A case's `handlerRuns` is how many times any handler started in the whole case.
- **`step.options`** (S8): a server given these `ttlMs` and `leaseMs`, whose default deadline is
  `defaultTimeoutMs`, is built (`valid: true`) or refuses its configuration.
- **`retry.cases`** (R1, R2, S6, S11): one call through the retry middleware with its defaults to
  a command with `command`'s fields. `key` says whether the call carries a key, `retryMutations`
  sets the host's option, `withStep` adds the engine's step, `handlerFailsWith` replaces the
  handler's first failure, `declarationUnreadable` puts the middleware where it cannot read the
  command's declaration, and `asTask` makes the call as an MCP task. `expect` gives the final
  result and `handlerRuns`.
- **`timeoutRecovery.cases`** (R3): a call to a command with `command`'s fields, carrying a key or
  not (`key`), on a server with the step unless `withStep` is `false`. `expect` is the `TIMEOUT`
  the engine gives when the handler outlives the call's deadline, and its `recovery`.
- **`journal.cases`**: a recorded call to a command that declares nothing, or with `kind` a batch
  of `items` such calls. `entryIdempotencyKey` and `entryIdempotencyKeys` are the entries'
  `idempotencyKey` members. `digestHashHasMember`: the entry's `contextDigest.hash` equals the
  hash the harness computes from [`spec/journal.md`](../journal.md#context-digest-no-secrets)'s
  formula with `"idempotencyKey": <key>` in the hashed object and the key's name left out of
  `keys`. With `replay`, the entries are replayed: `handlerSeesKey` and `handlerSeesKeys` are
  what the replayed handlers read, and `status` the replay's verdict.

### `journal-seams.json`

Two sections, each with a prose `setup` and `cases` of `{ description, rule, run, expect }`. The
file was written before any implementation, so it fixes what a harness must build and check; a
language that implements a section may sharpen a case's wording but not its meaning. TypeScript's
harness runs the token cases on the execution engine, `direct` through a DirectClient, and `relay`
and `elicitation` over MCP HTTP. Rust runs every case
(`packages/rust/tests/journal_seams_vectors.rs`). A Rust middleware cannot set the id at all, so
its `overwrite` layer passes on a fresh context with the value in `extra` under the id's name, and
its caller's `context` value goes in `extra` too: neither reaches a later link.

**`dispatchId`** ([`spec/dispatch.md`](../dispatch.md#the-dispatch-id)). The setup's commands and
two observer middleware layers each note the dispatch id they read. `run.command` and `run.input`
are the call; `run.commands` are a batch's items and `run.steps` a pipeline's steps; `run.traceId`
is the trace id the caller sets on the request. `run.kind` is `call` (one
call), `calls` (`count` calls with the same input and trace id), `batch` or `pipeline`; `context`
sets values on the call's context before it runs, under the language's own spelling of each name
(`dispatch_id` in Python, Rust and C++), `middleware` replaces the outer layer
(`overwrite`, `retry-once`), `journal: true` records the call with the journal recorder, and
`random` is the sequence of values the call's `context.random` returns, in order.
`expect` holds only what the case checks:

- `handlerRuns`: how many times a handler ran. `distinctIds`: how many different ids all readers
  noted. `readers`: the readers whose notes are compared, when not all of them.
- `wellFormed`: every noted id matches `format.pattern`. `never`: values no reader may note.
- `success` and `data`: the result. `resultHasId: false`: no member of the result, its metadata
  included, is named `dispatchId` or holds the id.
- `entries`, `entryHasId: false`: the journal has that many entries, and no member of the entry
  is named for the id or holds it. `digestHashOmitsId: true`: the entry's `contextDigest.hash`
  equals the hash the harness computes itself from [`spec/journal.md`](../journal.md#context-digest-no-secrets)'s
  formula with the id's name left out of `keys`. The entry stores only the hash, so nothing less
  shows that the name stayed out.
- `handlerDraws`: the values the handler read from `context.random`. An engine that drew the id
  from that source would hand the handler a later value.

**`approvalSummary`** ([`spec/approvals.md`](../approvals.md#the-approval-summary)).
The setup takes its secrets, clock, actors and bindings from `approval-tokens.json`, and its
nonce store notes every key it is asked to consume. `run.via` says how the call is admitted
(`token`, `direct`, `relay`, `elicitation`, or `none` for a command without a policy), and
`binding` names a binding of that file, whose fixed token the call carries. A case without one
gives `command` and `input`, or with `kind: "batch"` the `commands` of one `afd-batch` request
approved up front. What varies a call:

- `tamper: "signature"`: the token's last character is replaced by another base64url character.
- `hook: "fail"`: the hook refuses, by the language's own failure signal.
- `thenRetry`: the same call is made again with the same token. `replay: "within-ttl"` and `count`:
  the server allows reuse, and the call is made `count` times.
- `holdFirst`: the call is first made with no evidence and is held; it is then made again with the
  token that hold issued, which the harness takes from `onApprovalRequired`'s request.
- `decisionId`: the decision id the harness's relay answers with.

`expect`:

- `hookCalls`, `handlerRuns`, `success`, `code`, `order` (the hook and the handler, in the order
  they ran) and `retry` (the result of repeating the call with the same token; its `reason` is the
  error's `details.reason`).
- `members`: the summary's member names, sorted. `via`: its `via`. `fromBinding`: the members that
  must equal the binding's. `issuedAt` and `expiresAt`: `now`, or `now + ttlMs`, of
  `approval-tokens.json`.
- `dispatchIdIsHandlers`: the dispatch id the hook is given is the one the handler reads.
- `summaryNeverHolds`: each entry is the name of a member of the case's binding (`token`, `nonce`,
  `payload`), whose value must appear nowhere in the summary's JSON, or otherwise a literal value
  that must not.
- `approvalIdIs`: the summary's `approvalId` equals the `approvalId` of the entry of
  `approval-tokens.json`'s `approvalIds` with that description.
- `approvalIdFromSpentKey`: each summary's `approvalId` equals the unpadded base64url SHA-256 of
  `approval`, a zero byte and a key the nonce store was asked to consume for that call. The step
  draws these nonces itself, so no fixed value can be given.
- `distinctApprovalIds`, `distinctDispatchIds`: across the hook's calls.
- `requestApprovalIdIsSummarys`: the `approvalId` on the held call's request equals the summary's.

A language without a surface a case needs (C++ has no `HumanRelay`) skips that case and says so.

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
