# Behavior vectors

Language-neutral test cases for AFD behavior, with expected values produced by the TypeScript
reference implementation. Where `spec/wire` pins the *shapes* of results, these pin *behavior*.

| File | Covers | Generator |
| --- | --- | --- |
| `pipeline-variables.json` | Reference resolution and `when` conditions ([`spec/pipeline-variables.md`](../pipeline-variables.md)) against one fixed pipeline context | `generate-pipeline-variables.mjs` |
| `error-codes.json` | The shared error-code catalog of [`spec/error-codes.md`](../error-codes.md), in catalog order | Written by hand; TypeScript's `ErrorCodes` must equal it |

## Contract

- A language that implements the behavior loads the file and requires identical results.
  - `pipeline-variables.json`: C++ (`packages/cpp/tests/vectors_test.cpp`). TypeScript, Python and
    Rust are not yet wired in (parity closure plan, item 1.1).
  - `error-codes.json`: all four. TypeScript `packages/core/src/errors.test.ts`, Python
    `python/tests/test_error_codes.py`, Rust `packages/rust/tests/error_codes.rs`, C++
    `packages/cpp/tests/vectors_test.cpp`.
- `resolved: false` means the reference does not resolve: TypeScript's `undefined`, and absent in
  the spec.

## Regenerating

After an intentional TypeScript change:

```bash
pnpm -F @lushly-dev/afd-core build
node spec/vectors/generate-pipeline-variables.mjs
```

A change to these files is a behavior change. Make it in every language that consumes them, in
the same pull request.
