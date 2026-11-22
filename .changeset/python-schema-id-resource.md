---
"afd-python": patch
---

### Fixed

- **A `$ref` inside a subschema with its own `$id` resolves against that subschema** ([#1700](https://github.com/lushly-dev/afd/issues/1700); `spec/validation.md`, "Annotations"): the JSON Schema input validator read `$id` as an annotation only and resolved every local `$ref` against the root, so a schema whose nested `$id` subschema holds its own `$defs`, such as a structured-result envelope's `data` schema, was refused at registration. A string `$id` now starts a schema resource, as in Draft 2020-12. The `$id` value is never resolved as a URI.
