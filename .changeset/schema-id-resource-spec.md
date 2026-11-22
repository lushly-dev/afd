---
"afd-spec": patch
---

[`validation.md`](./validation.md): a string `$id` starts a schema resource, as in Draft 2020-12, and a local `$ref` resolves against the nearest one around it, or else the root ([#1700](https://github.com/lushly-dev/afd/issues/1700)). Before, the subset said `$id` did not change how `$ref` resolves. A bare fragment such as `"#node"`, a draft-07 anchor, starts no resource, and the `$id` value is never resolved as a URI. `$id` leaves the list of annotations with no effect. The new `ref-embedded-resource` case in `vectors/validation.json`, the CommandResult envelope advertised for a `data` schema with its own `$id` and `$defs`, runs in all four languages, and TypeScript also checks it with Ajv.
