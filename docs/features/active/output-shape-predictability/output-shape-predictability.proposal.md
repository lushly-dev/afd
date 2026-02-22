# Output Shape Predictability

> Proposal: Declare and validate command output schemas so agents know what they'll get back before calling

---
status: captured
created: 2026-02-22
origin: Playground testing — agent called `todo-list` and received `CommandResult<Todo[]>`, but had to *infer* the shape of `Todo` from the response. When piping `todo-list` → `todo-update`, the agent guessed field names (`$prev.data[0].id`) without any schema guarantee. The `returns` field exists on `CommandDefinition` but is always hardcoded to `{ type: 'object', description: 'Command result' }` — a meaningless placeholder.
effort: M (3-5 days)
package: "@lushly-dev/afd-server", "@lushly-dev/afd-testing", "@lushly-dev/afd-core"
---

## Problem

Commands declare their **input** schema precisely (via Zod) but their **output** is opaque. Agents face three consequences:

### 1. Pipeline Field References Are Guesswork

```typescript
// Agent builds a pipeline — must guess what `todo-list` returns
const pipeline = [
  { command: 'todo-list', input: {}, as: 'todos' },
  { command: 'todo-update', input: { id: '$todos.data[0].id', done: true } },
  //                                     ^^^^^^^^^^^^^^^^^^^^^^
  //                                     Is it .id? .todoId? .uuid?
  //                                     Is data an array? Is [0] safe?
];
```

Without an output schema, the agent discovers the shape only after execution — meaning pipeline construction requires a speculative call first.

### 2. `returns` Exists But Is a Placeholder

The `CommandDefinition` interface already has a `returns?: JsonSchema` field. But `defineCommand()` always sets it to:

```typescript
returns: { type: 'object', description: 'Command result' }
```

This tells the agent nothing. It's the equivalent of `any` for outputs.

### 3. MCP Tool Descriptions Lack Output Context

MCP tool listings show input schemas but no output schemas. An agent browsing available tools sees *what to send* but not *what comes back*. For tool selection, knowing the output shape is as important as knowing the input.

## Proposed Solution

### `output` Schema on `ZodCommandOptions`

Add an optional `output` Zod schema to command definitions:

```typescript
const Todo = z.object({
  id: z.string(),
  title: z.string(),
  done: z.boolean(),
  createdAt: z.string().datetime(),
});

const todoList = defineCommand({
  name: 'todo-list',
  description: 'List all todos',
  input: z.object({ filter: z.enum(['all', 'active', 'done']).optional() }),
  output: Todo.array(),  // NEW
  mutation: false,
  async handler(input, context) {
    const todos = await db.listTodos(input.filter);
    return success(todos);
  },
});
```

### Schema Generation

`defineCommand()` converts the output Zod schema to JSON Schema (same as input) and stores it on `ZodCommandDefinition`:

```typescript
export interface ZodCommandDefinition<TInput, TOutput> {
  // ...existing fields...

  /** Zod schema for output validation (optional) */
  outputSchema?: ZodType;

  /** JSON Schema for the output data shape (derived from outputSchema) */
  outputJsonSchema?: JsonSchema;
}
```

### `toCommandDefinition()` Populates `returns`

When converting to `CommandDefinition`, the output schema populates the existing `returns` field instead of the hardcoded placeholder:

```typescript
toCommandDefinition(): CommandDefinition {
  return {
    ...fields,
    returns: outputJsonSchema ?? { type: 'object', description: 'Command result' },
  };
}
```

### MCP Tool Metadata

Expose the output schema in MCP tool `_meta` alongside existing metadata:

```typescript
_meta: {
  mutation: false,
  requires: ['auth-sign-in'],
  outputSchema: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        done: { type: 'boolean' },
      },
      required: ['id', 'title', 'done'],
    },
  },
}
```

### Type Safety

The `output` schema constrains the handler's return type:

```typescript
// Type error: handler must return Todo[]
const todoList = defineCommand({
  name: 'todo-list',
  input: z.object({}),
  output: Todo.array(),
  async handler(input, context) {
    return success('not a todo array');  // ← Type error
  },
});
```

This is achieved by inferring `TOutput` from the output Zod schema:

```typescript
function defineCommand<TInput extends ZodType, TOutput>(options: {
  output?: ZodType<TOutput>;
  handler: (input: z.infer<TInput>, ctx: CommandContext) => Promise<CommandResult<TOutput>>;
}): ZodCommandDefinition<TInput, TOutput>;
```

### Surface Validation Rule

A new rule **`missing-output-schema`** flags commands that don't declare output schemas:

```typescript
{
  rule: 'missing-output-schema',
  severity: 'info',
  message: 'Command "todo-list" has no output schema — agents cannot predict response shape',
  commands: ['todo-list'],
  suggestion: 'Add an `output` Zod schema to help agents construct pipelines and process results.',
}
```

Severity is `info` by default — this is advisory. Output schemas are opt-in, not mandatory.

### Pipeline Variable Resolution Enhancement

With output schemas available, pipeline variable resolution can validate `$prev.field` references at construction time:

```typescript
// Before: fails at runtime with "Cannot read property 'id' of undefined"
// After: fails at construction with "Field 'todoId' not found in todo-list output schema.
//         Available fields: id, title, done, createdAt"
```

## Benefits

| Without | With |
|---------|------|
| Agent guesses output shape | Agent reads output schema before calling |
| Pipeline field refs are speculative | Pipeline refs validated against schema |
| `returns` is a useless placeholder | `returns` is an accurate JSON Schema |
| MCP tools show input only | MCP tools show input + output shapes |
| `CommandResult<T>` is invisible to agents | `T` is explicitly documented |

## Design Decisions

1. **Optional, not required**: Output schemas are opt-in. Adding them to existing commands is incremental and backward-compatible. The surface validation rule is `info` severity.

2. **Zod schema, not just JsonSchema**: Using Zod (like input) enables type inference for handler return types. The JSON Schema is derived automatically.

3. **`output` not `returns`**: The field on `ZodCommandOptions` is named `output` (matching `input`) rather than `returns` (which is the `CommandDefinition` field name). This keeps the API symmetric: `input`/`output`.

4. **No runtime validation of output**: The output schema is metadata for agents, not a runtime guard. Validating every handler response against the schema would add overhead to every command call. Type checking catches most mismatches at build time.

5. **Schema describes `data`, not `CommandResult`**: The output schema describes the shape of `CommandResult.data`, not the full `CommandResult` envelope. The envelope is standard and documented separately.

6. **Pipeline validation deferred**: Static pipeline variable validation is a natural follow-up but is not required for the initial implementation. The output schema alone is valuable for agent tool selection.

## Implementation Plan

- [ ] Add `output?: ZodType` to `ZodCommandOptions` in `schema.ts`
- [ ] Add `outputSchema?` and `outputJsonSchema?` to `ZodCommandDefinition`
- [ ] Convert output Zod schema to JSON Schema in `defineCommand()`
- [ ] Populate `returns` from output JSON Schema in `toCommandDefinition()`
- [ ] Expose `outputSchema` in MCP tool `_meta`
- [ ] Add `outputJsonSchema?` to `SurfaceCommand`
- [ ] Add `missing-output-schema` surface validation rule
- [ ] Add `output` to Python `@server.command` decorator
- [ ] Add tests:
  - Output schema converts to JSON Schema
  - `returns` populated correctly on `CommandDefinition`
  - MCP tool `_meta` includes output schema
  - Type inference constrains handler return type
  - Surface rule fires for commands without output schema
  - Surface rule does not fire when output schema is present
- [ ] Update playground experiment with output schemas on existing commands
