# Behavior vectors

Language-neutral test cases for AFD behavior, with expected values produced by the TypeScript
reference implementation. Where `spec/wire` pins the *shapes* of results, these pin *behavior*.

| File | Covers | Generator |
| --- | --- | --- |
| `pipeline-variables.json` | Reference resolution and `when` conditions ([`spec/pipeline-variables.md`](../pipeline-variables.md)) against one fixed pipeline context | `generate-pipeline-variables.mjs` |

## Contract

- A language that implements the behavior loads the file and requires identical results.
  - C++: `packages/cpp/tests/vectors_test.cpp`.
  - TypeScript, Python and Rust: not yet wired in (follow-on work in the C++ work plan).
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
