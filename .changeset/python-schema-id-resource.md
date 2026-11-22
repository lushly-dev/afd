---
"afd-python": patch
---

### Fixed

- **A `$ref` inside a subschema with its own `$id` resolves against that subschema** ([#1700](https://github.com/lushly-dev/afd/issues/1700); `spec/validation.md`, "Annotations"): the JSON Schema input validator read `$id` as an annotation only and resolved every local `$ref` against the root, so a schema whose nested `$id` subschema holds its own `$defs`, such as a structured-result envelope's `data` schema, was refused at registration. A string `$id` now starts a schema resource, as in Draft 2020-12. A bare fragment such as `"#node"`, which draft-07 used as an anchor, starts no resource. The `$id` value is never resolved as a URI.
- **The advertised output schema reads a nullable definition in its own resource** (#1700): `command_result_output_schema` stops requiring a property that accepts `null`, which the wire form omits. It looked such a property's `$ref` up from the root of the `data` schema, so a nullable definition inside a nested `$id` subschema was missed, and the envelope required a property the server's own result leaves out.
