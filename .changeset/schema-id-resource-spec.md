---
"afd-spec": patch
---

[`validation.md`](./validation.md): a string `$id` starts a schema resource, as in Draft 2020-12, and a local `$ref` resolves against the nearest one around it, or else the root ([#1700](https://github.com/lushly-dev/afd/issues/1700)). Before, the subset said `$id` did not change how `$ref` resolves. The `$id` value is never resolved as a URI. The new `ref-embedded-resource` case in `vectors/validation.json`, an envelope whose `data` schema has its own `$id` and `$defs`, runs in all four languages.
