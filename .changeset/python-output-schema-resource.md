---
"afd-python": minor
---

### Breaking changes

- **A `$ref` outside the subset fails at registration** ([#1910](https://github.com/lushly-dev/afd/issues/1910); `spec/validation.md`). The subset is `#`, `#/$defs/<name>` and `#/definitions/<name>`, as in Rust. Before, any deeper pointer under `#/$defs/` or `#/definitions/` was followed, such as `#/$defs/A/properties/x`. A pointer into a nested `$id` subschema then resolved that subschema's own references against the wrong resource. Name the target as its own definition instead.

### Fixed

- **`command_result_output_schema` follows the validators' resource rule:** `data` keeps its definitions only when its `$id` is a string that is not a bare fragment. In any other `data` schema, a `"$ref": "#"` naming `data` becomes `"#/properties/data"`. Before, it named the envelope, which is the form a recursive root schema takes. Draft-07 `dependencies` schemas are retargeted too.
- **The output schema's nullable pass walks only schema positions.** A `required` list inside a `const`, `enum`, `default` or `examples` value is data, and is now left as it is. The pass also decodes `~1` and `~0` in a reference.
