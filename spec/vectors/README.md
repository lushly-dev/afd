# Behavior vectors

Language-neutral test cases for AFD behavior, with expected values produced by the TypeScript
reference implementation. Where `spec/wire` pins the *shapes* of results, these pin *behavior*.

| File | Covers | Generator |
| --- | --- | --- |
| `pipeline-variables.json` | Reference resolution and `when` conditions ([`spec/pipeline-variables.md`](../pipeline-variables.md)) against one fixed pipeline context | `generate-pipeline-variables.mjs` |
| `validation.json` | Command input validation ([`spec/validation.md`](../validation.md)): unknown keys, the `VALIDATION_ERROR` shape, length units, the JSON Schema subset, explicit `null` and defaults | `generate-validation.mjs` |

## Contract

- A language that implements the behavior loads the file and requires identical results.
- Who loads each file:

| File | TypeScript | Python | Rust | C++ |
| --- | --- | --- | --- | --- |
| `pipeline-variables.json` | Not yet | Not yet | Not yet | `packages/cpp/tests/vectors_test.cpp` |
| `validation.json` | `packages/server/src/validation-vectors.test.ts` | Not yet | Not yet | Not yet |

- The "Not yet" entries are tracked in the
  [parity closure plan](../../docs/features/active/parity-closure/parity-closure.plan.md):
  - for `pipeline-variables.json`, by item 1.1;
  - for `validation.json`, by [#310](https://github.com/lushly-dev/afd/issues/310) (Python),
    [#311](https://github.com/lushly-dev/afd/issues/311) (Rust) and
    [#312](https://github.com/lushly-dev/afd/issues/312) (C++).
- `pipeline-variables.json`: `resolved: false` means the reference does not resolve. That is
  TypeScript's `undefined`, and absent in the spec.
- `validation.json`:
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
node spec/vectors/generate-validation.mjs
npx biome format --write spec/vectors
```

- `generate-validation.mjs` defines its cases as Zod schemas, because that is how TypeScript
  commands declare input. It records the JSON Schema TypeScript advertises for each case.
- The TypeScript test builds the same cases and fails until the file is regenerated.

A change to these files is a behavior change. Make it in every language that consumes them, in
the same pull request.
