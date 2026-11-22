---
"@lushly-dev/afd-core": patch
---

`commandResultOutputSchema` keeps `data`'s definitions inside it only when `data` starts a schema resource, meaning a string `$id` that is not a bare fragment, the validators' test ([#1910](https://github.com/lushly-dev/afd/issues/1910)). Before, a `data` schema with a fragment or non-string `$id` kept definitions where no local reference could reach them.

When `data` is not a resource, each `"$ref": "#"` that named it becomes `"#/properties/data"` (in every schema position, draft-07 `dependencies` included). Zod emits that form for a recursive root schema. Before, such a reference named the whole envelope, so clients validated nested values against the wrong schema.
