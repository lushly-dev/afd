# Schema Examples

> Proposal: Attach valid input examples to commands so agents can reference concrete payloads instead of inferring from schema alone

---
status: complete
created: 2026-02-22
origin: Schema complexity scoring — the `auth-sign-in` command scores 17 (high complexity) due to its discriminated union input. The schema-complexity rule suggests "Add input examples to the description to guide agent usage" but there's no structured way to provide examples. Agents must reverse-engineer valid inputs from JSON Schema constraints (`oneOf`, `enum`, `pattern`) — exactly the kind of task where examples outperform specifications.
effort: S (1-2 days)
package: "@lushly-dev/afd-server", "@lushly-dev/afd-testing", "@lushly-dev/afd-core"
---

## Problem

Complex schemas describe *constraints* but not *usage*. An agent reading a discriminated union schema sees:

```json
{
  "oneOf": [
    {
      "type": "object",
      "properties": {
        "method": { "const": "credentials" },
        "email": { "type": "string", "format": "email" },
        "password": { "type": "string" }
      },
      "required": ["method", "email", "password"]
    },
    {
      "type": "object",
      "properties": {
        "method": { "const": "oauth" },
        "provider": { "type": "string", "enum": ["google", "github"] },
        "scopes": { "type": "array", "items": { "type": "string" } }
      },
      "required": ["method", "provider"]
    }
  ]
}
```

To construct valid input, the agent must:
1. Parse the `oneOf` structure
2. Understand `const` means a literal value
3. Choose a variant
4. Collect required fields for that variant
5. Respect format/enum constraints

Versus seeing an example:

```json
{ "method": "credentials", "email": "user@example.com", "password": "secret" }
```

The example communicates the same information in a form agents can directly reference.

### Where This Hits Hardest

| Schema Pattern | Agent Without Examples | Agent With Examples |
|----------------|----------------------|-------------------|
| Discriminated unions | Must parse `oneOf` + `const` | Copy example, swap values |
| Nested objects | Must build tree from properties | Copy structure, fill values |
| Pattern constraints | Must interpret regex | See valid format directly |
| Enum values | Must enumerate options | See a chosen value in context |
| Optional fields | Doesn't know which to include | Sees typical usage patterns |

The schema-complexity scoring rule already identifies commands that need this help. But there's no structured field to deliver it — today the only option is embedding examples in the description string, which isn't parseable or validatable.

## Proposed Solution

### `examples` Field on `ZodCommandOptions`

```typescript
const authSignIn = defineCommand({
  name: 'auth-sign-in',
  description: 'Authenticate with credentials or OAuth provider',
  input: AuthSignInSchema,
  examples: [
    {
      title: 'Sign in with email and password',
      input: { method: 'credentials', email: 'user@example.com', password: 'secret' },
    },
    {
      title: 'Sign in with Google OAuth',
      input: { method: 'oauth', provider: 'google', scopes: ['email', 'profile'] },
    },
  ],
  async handler(input, context) { /* ... */ },
});
```

### Type: `CommandExample<TInput>`

```typescript
interface CommandExample<TInput = unknown> {
  /** Short description of what this example demonstrates */
  title: string;

  /** A valid input payload — validated against the input schema at build time */
  input: TInput;
}
```

The generic `TInput` is inferred from the command's `inputSchema`, so examples are type-checked:

```typescript
defineCommand({
  input: z.object({ title: z.string() }),
  examples: [
    { title: 'Valid', input: { title: 'Buy milk' } },          // ✓
    { title: 'Invalid', input: { title: 42 } },                // ← Type error
    { title: 'Missing', input: {} },                            // ← Type error
  ],
});
```

### Schema Validation at Build Time

`defineCommand()` validates each example's `input` against the Zod schema at definition time (not runtime). Invalid examples fail fast:

```
Error: Example "Sign in with Google" for command "auth-sign-in" fails schema validation:
  - provider: Expected "google" | "github", received "facebook"
```

This ensures examples stay in sync with the schema as it evolves.

### MCP Tool Exposure

Examples appear in MCP tool `_meta`:

```json
{
  "name": "auth-sign-in",
  "description": "Authenticate with credentials or OAuth provider",
  "inputSchema": { ... },
  "_meta": {
    "examples": [
      {
        "title": "Sign in with email and password",
        "input": { "method": "credentials", "email": "user@example.com", "password": "secret" }
      }
    ]
  }
}
```

### Surface Validation Integration

The existing `schema-complexity` rule can reduce severity when examples are present:

```typescript
// In checkSchemaComplexity:
if (result.score >= threshold) {
  const hasExamples = cmd.examples && cmd.examples.length > 0;
  findings.push({
    rule: 'schema-complexity',
    severity: hasExamples ? 'info' : (result.score >= 13 ? 'warning' : 'info'),
    message: hasExamples
      ? `Command "${cmd.name}" has ${tier} schema complexity (score: ${score}) but provides examples`
      : `Command "${cmd.name}" has ${tier} schema complexity (score: ${score})`,
    // ...
  });
}
```

A complex schema with examples is less of a concern than one without — the agent has concrete reference payloads.

### `afd-help` Integration

`afd help auth-sign-in` shows examples alongside the schema:

```
auth-sign-in — Authenticate with credentials or OAuth provider

Input Schema:
  method: "credentials" | "oauth" (required)
  email: string (required for credentials)
  password: string (required for credentials)
  provider: "google" | "github" (required for oauth)

Examples:
  Sign in with email and password:
    { "method": "credentials", "email": "user@example.com", "password": "secret" }

  Sign in with Google OAuth:
    { "method": "oauth", "provider": "google", "scopes": ["email", "profile"] }
```

## Benefits

| Without | With |
|---------|------|
| Agent reverse-engineers valid input from constraints | Agent copies and adapts a concrete payload |
| Complex schemas cause trial-and-error | Examples demonstrate correct usage per variant |
| Description-embedded examples aren't parseable | Structured `examples` array is machine-readable |
| Schema changes silently break informal examples | Build-time validation catches stale examples |
| schema-complexity warning with no mitigation | Examples reduce severity — documented mitigation path |

## Design Decisions

1. **Separate from description**: Examples are structured data, not prose in the description string. This makes them parseable by agents, validatable against the schema, and separately renderable in tooling.

2. **Validated at define-time**: Examples are parsed against the Zod schema when `defineCommand()` is called. This is a one-time cost during server startup, not per-request overhead. Invalid examples fail immediately.

3. **`title` is required**: Each example needs a short label explaining what it demonstrates. For discriminated unions, each variant should have its own titled example.

4. **No output examples**: This proposal covers input examples only. Output examples would pair with the output-shape-predictability proposal and could be added as a follow-up (`outputExamples` on `CommandExample`).

5. **Severity reduction, not suppression**: Examples reduce `schema-complexity` severity from `warning` to `info` rather than suppressing the finding entirely. The schema is still complex — the examples just make it more navigable.

6. **Python parity**: The Python `@server.command` decorator gets the same `examples` parameter, validated against the Pydantic model.

## Implementation Plan

- [ ] Define `CommandExample<TInput>` type in `@lushly-dev/afd-core`
- [ ] Add `examples?: CommandExample<z.input<TInput>>[]` to `ZodCommandOptions`
- [ ] Add `examples?: CommandExample[]` to `ZodCommandDefinition`
- [ ] Validate examples against input schema in `defineCommand()`
- [ ] Add `examples` to `CommandDefinition` interface
- [ ] Expose examples in MCP tool `_meta`
- [ ] Add `examples?: CommandExample[]` to `SurfaceCommand`
- [ ] Reduce `schema-complexity` severity when examples present
- [ ] Add `examples` to `afd-help` output
- [ ] Add `examples` to Python `@server.command` decorator
- [ ] Add tests:
  - Examples pass schema validation
  - Invalid examples throw at define-time
  - Examples appear in MCP tool metadata
  - Examples appear in `toCommandDefinition()` output
  - schema-complexity severity reduced with examples
  - Type inference catches bad example input
- [ ] Update playground with examples on `auth-sign-in`
