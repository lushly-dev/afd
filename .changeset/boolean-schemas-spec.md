---
"afd-spec": patch
---

[`validation.md`](./validation.md) states that a boolean schema may appear wherever a schema may ([#2047](https://github.com/lushly-dev/afd/issues/2047)):

- **`true`** is `{}`: it accepts any value, and an absent required property under it is reported as `nonoptional`.
- **`false`** is `not: {}`: it accepts no value, with an `invalid_type` issue and `expected: "never"`.
- **What stays as it was:** `additionalProperties: false` keeps its `unrecognized_keys` rule, and the root of an input schema stays an object.
- **New vector case:** `vectors/validation.json` adds `boolean-schemas`. TypeScript generates it from `z.unknown()` and `z.never()` and rewrites their schemas to `true` and `false`.

[`pipeline-variables.md`](./pipeline-variables.md) now states that a reference to a successful step with no `data` is absent, while a step whose `data` is `null` resolves to `null`.

[`vectors/pipeline-variables.json`](./vectors/pipeline-variables.json) also adds two steps that succeeded, one with `null` data and one with none ([#1961](https://github.com/lushly-dev/afd/issues/1961)). The out-of-bounds index case moves to `$steps[5]`.

Behaviour change: in all four languages, a boolean schema is now validated wherever a schema may appear, and a step that succeeded with `null` data resolves to `null`. Before, Python and Rust refused `true` and `false` except as `additionalProperties`, C++ reported `false` as `invalid_value`, and Python read a `null`-data step as absent. The two vector files gain cases for these: `boolean-schemas`, and the null-data and no-data steps.
