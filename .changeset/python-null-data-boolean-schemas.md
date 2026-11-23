---
"afd-python": patch
---

### Fixed

- **A step that succeeded with `null` data reads as `null`** ([#1961](https://github.com/lushly-dev/afd/issues/1961); `spec/pipeline-variables.md`). This applies to `execute_pipeline`, `afd-pipe` and `DirectClient.pipe`, and matches TypeScript.
  - **Before:** `$prev` and `$steps.<alias>` read such a step as absent, so a reference to it was dropped from an object, and `$eq` against `null` was false.
  - **No data:** a step whose result has no data at all is still absent. `StepResult.data` is now set only when the result's data was set.
- **Boolean schemas are accepted wherever a schema may appear** ([#2047](https://github.com/lushly-dev/afd/issues/2047); `spec/validation.md`), as in C++.
  - **`true`:** it is `{}`.
  - **`false`:** it is `not: {}`, whose issue is `invalid_type` with `expected: "never"`.
  - **Command paths:** schema registration, the missing-field details, the `oneOf` discriminator and the surface complexity score all handle a boolean property. `@server.command` and `afd-schema`'s TypeScript export already handled one (#2192).
  - **Before:** registration refused `"properties": {"x": true}` and a `$ref` to a `true` definition.
