---
"afd-spec": patch
---

The CommandResult envelope and local `$ref` follow one rule for schema resources ([#1910](https://github.com/lushly-dev/afd/issues/1910)):

- **[`command-metadata.md`](./command-metadata.md#structured-results):** an output schema keeps its definitions inside `data` only when it starts a schema resource, meaning a string `$id` that is not a bare fragment. This is the validators' test; before, any `$id` counted. In any other output schema, a `"$ref": "#"` that named its root becomes `"#/properties/data"` (in every schema position, draft-07 `dependencies` included), since `#` names the envelope once `data` is nested in it.
- **New vector:** [`vectors/output-schema.json`](./vectors/output-schema.json) holds the envelope each language builds.
- **[`validation.md`](./validation.md):** a `$ref` of `#/$defs/<name>` or `#/definitions/<name>` takes exactly one JSON Pointer token. A deeper pointer fails at registration, such as one that reaches into a nested `$id` subschema and would resolve its references in the wrong resource.
