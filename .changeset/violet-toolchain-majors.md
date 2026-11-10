---
'@lushly-dev/violet-core': minor
'@lushly-dev/violet-afd': minor
'@lushly-dev/violet-cli': minor
'@lushly-dev/violet-server': patch
---

Violet moves to Zod 4, commander 15 and nanoid 6. `@lushly-dev/violet-core` and `@lushly-dev/violet-afd` export Zod 4 schemas, so code that composes them needs Zod 4 too; the inferred types are unchanged. Commands accept and reject the same input as before, but a validation error's issues use Zod 4's default wording (for example "Invalid input: expected string, received undefined" instead of "Required"); custom messages, the `VALIDATION_ERROR` code and the suggestion are unchanged. Command JSON Schemas now come from Zod's `z.toJSONSchema` instead of `zod-to-json-schema` and describe the same input, with some constructs spelled differently (`oneOf` for discriminated unions, `propertyNames` on records, safe-integer bounds on integers and a pattern beside `format: "date-time"`). The `violet` CLI rejects extra command arguments ("too many arguments") instead of ignoring them; its options and help text are unchanged. nanoid 6 supports Node 22, 24 and 26 or later.
