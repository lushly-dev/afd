# Surface validation

Cross-command lint for the agent contract: descriptions an agent can't tell apart, overlapping
schemas, bad names, injection text and broken prerequisites. Run it with `afd validate --surface`
against a connected server, or `validateCommandSurface(commands, options)` from
`@lushly-dev/afd-testing`, which accepts `ZodCommandDefinition[]` or core `CommandDefinition[]`.
The options interface and defaults are in "Surface Validation" in `packages/testing/README.md`.

`afd validate --surface` reads any tool strategy: grouped tools are expanded through
`_meta.actions`, lazy and hybrid servers through `afd-discover` and `afd-detail`, and AFD's own
tools (`afd-call`, `afd-help`, `afd-context-*` and the rest) are skipped.

## Rules

| Rule | Severity | Fires when | Fix |
|------|----------|------------|-----|
| `similar-descriptions` | Warning | Token cosine similarity of two descriptions is at or above `similarityThreshold` (0.7) | Say what distinguishes them: object, scope, side effect |
| `schema-overlap` | Warning | Shared top-level input fields divided by the two commands' combined fields is at or above `schemaOverlapThreshold` (0.8) | Merge them, or differentiate the inputs |
| `naming-convention` | Error | A name doesn't match `namingPattern` (default `/^[a-z][a-z0-9]*-[a-z][a-z0-9-]*$/`) | Rename to `domain-action` |
| `naming-collision` | Error | Names collide once separators are normalized (`user-create`, `userCreate`, `user_create`) | Keep one |
| `missing-category` | Info | No `category` | Set one, or suppress |
| `description-injection` | Error | The description matches a prompt-injection pattern (below) | Describe the command; don't instruct the agent |
| `description-quality` | Warning | Shorter than `minDescriptionLength` (20) or no action verb (get, create, list, search, ...) | Start with a verb and say what it returns or changes |
| `orphaned-category` | Info | A category holds one command | Usually a misclassification |
| `schema-complexity` | Warning or Info | The input schema scores high (below) | Flatten, split, or add `examples` |
| `unresolved-prerequisite` | Error | A `requires` entry names a command not in the surface | Fix the name, or register it |
| `circular-prerequisite` | Error | `requires` forms a cycle | Break the cycle |
| `missing-output-schema` | Info | No `output` schema | Declare one so agents can plan pipelines |
| `missing-context` | Info | No `contexts` while `configuredContexts` is set | Scope it, or confirm it is universal |

`strict: true` (CLI `--strict`) counts warnings as errors.

## Injection patterns

`INJECTION_PATTERNS` covers imperative overrides ("ignore previous", "disregard above"), role
assignment ("you are a", "you must always"), system-prompt fragments ("system prompt", `<<SYS`)
and hidden instructions ("always call this", "never use this").
`additionalInjectionPatterns: [{ id, pattern, description, example }]` adds to that list and never
replaces it; only `detectInjection: false` turns detection off.

## Schema complexity

Score = fields + depth×3 + unions×5 + intersections×2 + enums + patterns×2 + bounds + an
optional-field ratio term (0 to 4). Nullable wrappers (`anyOf: [T, { type: 'null' }]`) are not
unions, and `const` (from `z.literal()`) is not an enum.

| Score | Tier | Finding |
|-------|------|---------|
| 0-5 | low | None |
| 6-12 | medium | Info |
| 13-20 | high | Warning at or above `schemaComplexityThreshold` (13) |
| 21+ | critical | Warning |

A command with `examples` gets Info instead of Warning. The rule never produces an error.
`computeComplexity(jsonSchema)` returns `{ score, tier, breakdown }` for one schema.

## Suppressions

```typescript
validateCommandSurface(commands, {
  suppressions: [
    'missing-category',                         // the whole rule
    'schema-complexity:auth-sign-in',           // one command
    'similar-descriptions:user-get:user-fetch', // one pair, either order
  ],
});
```

On the CLI: `--suppress <rule>` or `--suppress rule:cmdA:cmdB` (repeatable),
`--skip-category <name>` and `--similarity-threshold <n>`. Suppressed findings stay in `findings`
with `suppressed: true` but don't count toward `valid` or the summary counts.
