# Behavior vectors

Language-neutral test cases for AFD behavior, with expected values produced by the TypeScript
reference implementation. Where `spec/wire` pins the *shapes* of results, these pin *behavior*.

| File | Covers | Generator |
| --- | --- | --- |
| `pipeline-variables.json` | Reference resolution and `when` conditions ([`spec/pipeline-variables.md`](../pipeline-variables.md)) against one fixed pipeline context | `generate-pipeline-variables.mjs` |
| `batch-controls.json` | Batch and pipeline execution controls: `stopOnError`, `parallelism`, the batch `timeout` and pipeline `timeoutMs` deadlines, `continueOnFailure`, `UNSUPPORTED_OPTION`, and envelope validation | `generate-batch-controls.mjs` |
| `validation.json` | Command input validation ([`spec/validation.md`](../validation.md)): unknown keys, the `VALIDATION_ERROR` shape, length units, the JSON Schema subset, explicit `null` and defaults | `generate-validation.mjs` |

## Contract

- Every language loads every file in its test suite and requires identical results. Where a
  language does not load a file yet, the entry is tracked in the
  [parity closure plan](../../docs/features/active/parity-closure/parity-closure.plan.md):

  | Language | `pipeline-variables.json` | `batch-controls.json` | `validation.json` |
  | --- | --- | --- | --- |
  | TypeScript | `packages/core/src/pipeline-variables-vectors.test.ts` | `packages/core/src/batch-controls-vectors.test.ts` | `packages/server/src/validation-vectors.test.ts` |
  | Python | `python/tests/test_pipeline_vectors.py` | `python/tests/test_batch_controls_vectors.py` | Not yet ([#310](https://github.com/lushly-dev/afd/issues/310)) |
  | Rust | `packages/rust/tests/pipeline_vectors.rs` | `packages/rust/tests/batch_controls_vectors.rs` | Not yet ([#311](https://github.com/lushly-dev/afd/issues/311)) |
  | C++ | `packages/cpp/tests/vectors_test.cpp` | `packages/cpp/tests/batch_vectors_test.cpp` | Not yet ([#312](https://github.com/lushly-dev/afd/issues/312)) |

- Changes to `spec/vectors` run the Python, Rust and C++ workflows as well as `ci.yml`.

### `pipeline-variables.json`

- Build the pipeline context from `context`. `previous` is the index of the step that `$prev`
  reads.
- `resolved: false` means the reference does not resolve: TypeScript's `undefined`, and absent in
  the spec. Inside a step input, an unresolved reference is omitted from its object.
- `resolved: true` gives the `value`. For a literal (`$9.99`, `$$prev`), that is the literal string.
- Each condition evaluates to `expected`. The first operand of a comparison is a reference: a
  literal there is absent, so `{"$exists": "$$prev"}` is `false`.

### `batch-controls.json`

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

## Regenerating

After an intentional TypeScript change:

```bash
pnpm -F @lushly-dev/afd-core build
pnpm -F @lushly-dev/afd-server build
node spec/vectors/generate-pipeline-variables.mjs
node spec/vectors/generate-batch-controls.mjs
node spec/vectors/generate-validation.mjs
npx biome format --write spec/vectors
```

- `generate-validation.mjs` defines its cases as Zod schemas, because that is how TypeScript
  commands declare input. It records the JSON Schema TypeScript advertises for each case.
- The TypeScript test builds the same cases and fails until the file is regenerated.

A change to these files is a behavior change. Make it in every language that consumes them, in
the same pull request.
