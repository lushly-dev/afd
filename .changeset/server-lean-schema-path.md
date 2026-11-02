---
"@lushly-dev/afd-server": minor
---

Add `defineCommandWithSchema`, exported from the root, `/define` and `/direct`: a command whose JSON Schema you already have, validated by a classic or a Zod Mini schema. A host that defines every command this way and uses `createDirectRegistry` and `createJournalMiddleware` bundles `zod/v4/core` and neither classic Zod nor `toJSONSchema`; an entry-point test holds that. `defineCommand` keeps its signature and computes the schema, then calls it.

The bound of `ZodCommandOptions` and `ZodCommandDefinition`, `output`, and the parameters of `validateInput`, `validateInputEnhanced`, `validateOrThrow`, `isValid`, `zodToJsonSchema` and `getRequiredFields`, widen from classic's `ZodType` to `$ZodType` of `zod/v4/core`. `ZodCommandDefinition` with no type argument still reads as classic, so `command.inputSchema.safeParse(input)` compiles as before. **Two fields a caller reads widen too: `ZodCommandDefinition.outputSchema` and `ContextField.schema` are now `$ZodType`,** so code calling `.safeParse` on them, or assigning them to `z.ZodType`, needs `safeParse` from `zod/v4/core` or a cast. Nothing in this repository does. Validation now parses through `zod/v4/core`, whose results are the same for a classic schema.

With no Zod locale loaded, as on Zod Mini alone, `VALIDATION_ERROR` and a context field's errors rebuild the bare `Invalid input` from the issue, as Zod's English does for a wrong type, a value, a size other than a file's, an unknown key, a regex or a discriminator. A format keeps its own name, and a rarer code stays bare with its path. With a locale loaded nothing changes.

Small run-time changes for a classic caller:

- `.exactOptional()` now counts as optional when fields are reported: such a field is no longer listed under `Missing required field(s)`, and an object wrapped in it now reports its fields.
- A definition wrong in two ways at once may report the other error: `defineCommand` converts its schemas before checking `advertisedInputSchema`, and warns on a bad name after converting, so a conversion that throws comes first.
- A schema is recognised by `_zod`, not by a `safeParse` method. An object with only `safeParse`, which the types never allowed, is now refused as a context field and throws in `validateInput` and `isValid`. A schema built from `zod/v4/core` alone is now accepted. `isObjectSchema` answers `true` for a Zod Mini object, though its parameter stays typed as classic.
