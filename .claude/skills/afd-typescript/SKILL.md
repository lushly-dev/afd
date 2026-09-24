---
name: afd-typescript
description: >
  TypeScript implementation patterns for AFD commands using Zod schemas,
  @lushly-dev/afd-server, and @lushly-dev/afd-core. Covers command definition, schema design,
  error handling, MCP server setup, embeddable Node handlers, and testing. Use when: implementing
  commands in TypeScript, setting up MCP servers, writing Zod schemas,
  or debugging TypeScript AFD code.
  Triggers: typescript afd, ts command, zod schema, defineCommand,
  createMcpServer, createMcpHandler, @lushly-dev/afd-server, @lushly-dev/afd-core,
  typescript implementation.
---

# AFD TypeScript Implementation

Patterns for implementing AFD commands in TypeScript.

## Parity Rule

TypeScript often serves as the reference implementation for the shared AFD surface, but parity SHOULD still be defined by framework-agnostic capabilities and agent-visible behavior rather than literal module symmetry.

- Core AFD surfaces MUST stay framework-agnostic.
- React or browser integrations SHOULD stay in examples or ecosystem layers.
- Cross-language implementations MAY use idiomatic APIs when they preserve the same command contract and behavior.
- Shared parity features to keep aligned include output schemas, validated examples, prerequisite metadata, context scoping, grouped/lazy discovery strategies, and the `afd-call` / `afd-batch` / `afd-pipe` / `afd-discover` / `afd-detail` tool family.

## Package Imports

```typescript
// Core types
import type { CommandResult, CommandError } from '@lushly-dev/afd-core';

// Server utilities
import {
  defineCommand,
  success,
  error,
  createMcpServer,
  createMcpHandler,
} from '@lushly-dev/afd-server';

// Schema validation
import { z } from 'zod';

// View state (UI state management via commands)
import { ViewStateRegistry } from '@lushly-dev/afd-view-state';
import { createViewStateCommands } from '@lushly-dev/afd-view-state/commands';
```

## Command Definition

### Basic Command

```typescript
import { z } from 'zod';
import { defineCommand, failure, success } from '@lushly-dev/afd-server';

const inputSchema = z.object({
  title: z.string().min(1).max(200),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
});

const Todo = z.object({
  id: z.string(),
  title: z.string(),
  priority: z.enum(['low', 'medium', 'high']),
  completed: z.boolean(),
});

export const createTodo = defineCommand({
  name: 'todo-create',
  description: 'Create a new todo item',
  category: 'todo',
  mutation: true,
  expose: { mcp: true },       // Required for MCP clients — commands are private by default
  requires: ['auth-sign-in'],  // Planning-order dependency (metadata only)
  version: '1.0.0',
  input: inputSchema,
  output: Todo,                // Output schema — agents see response shape before calling
  contexts: ['task-management'],  // Only visible in task-management context
  errors: ['VALIDATION_ERROR'],

  // `input` has already been validated and parsed against `inputSchema` (defaults applied)
  async handler(input) {
    const todo = await store.create(input);

    return success(todo, {
      reasoning: `Created todo "${todo.title}" with ${input.priority} priority`,
      confidence: 1.0,
    });
  },
});
```

> **Exposure is opt-in.** Remote MCP clients can only list and call commands that declare
> `expose: { mcp: true }`. Omitting `expose` (or `expose.mcp`) keeps a command private to
> in-process callers such as `server.execute()`. This applies to tool listing, discovery,
> `afd-call`, batches, pipelines, and streaming.

### Command with Context

```typescript
export const updateTodo = defineCommand({
  name: 'todo-update',
  description: 'Update a todo item',
  category: 'todo',
  mutation: true,
  expose: { mcp: true },
  input: updateSchema,
  errors: ['NOT_FOUND', 'NO_CHANGES'],

  async handler(input, context) {
    // context.traceId - Correlation ID for logging
    // Other context values (e.g. an authenticated user) are only present
    // when your own middleware sets them.
    console.error(`[${context.traceId}] Updating todo ${input.id}`); // stderr: stdout carries stdio JSON-RPC

    const todo = await store.get(input.id);
    if (!todo) {
      return failure({
        code: 'NOT_FOUND',
        message: `Todo ${input.id} not found`,
        suggestion: 'Use todo-list to see available todos',
      });
    }

    // ... update logic
  },
});
```

## Zod Schema Patterns

### Basic Types

```typescript
const schema = z.object({
  // Required string with constraints
  title: z.string().min(1).max(200),

  // Optional with default
  priority: z.enum(['low', 'medium', 'high']).default('medium'),

  // Optional field (can be undefined)
  description: z.string().max(1000).optional(),

  // Number with constraints
  count: z.number().int().positive().max(100),

  // Boolean with default
  completed: z.boolean().default(false),

  // UUID validation
  id: z.string().uuid(),

  // Email validation
  email: z.string().email(),

  // ISO date string
  dueDate: z.string().datetime().optional(),
});
```

### Arrays and Nested Objects

```typescript
const schema = z.object({
  // Array of strings
  tags: z.array(z.string()).max(10).default([]),

  // Array of objects
  items: z.array(z.object({
    name: z.string(),
    quantity: z.number().int().positive(),
  })),

  // Nested object
  address: z.object({
    street: z.string(),
    city: z.string(),
    zip: z.string().regex(/^\d{5}$/),
  }).optional(),
});
```

### Refinements and Transforms

```typescript
// Cross-field validation
const dateRangeSchema = z.object({
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
}).refine(
  (data) => new Date(data.endDate) > new Date(data.startDate),
  { message: 'End date must be after start date' }
);

// Transform input
const normalizedSchema = z.object({
  email: z.string().email().transform(e => e.toLowerCase()),
  name: z.string().transform(n => n.trim()),
});
```

### Union Types (Ordering Matters!)

```typescript
// Order from most specific to least specific
const TokenValueSchema = z.union([
  z.string(),
  z.object({ web: z.string(), ios: z.string() }).strict(),
  z.record(z.string(), z.unknown()), // Most permissive last
]);
```

## Success Responses

```typescript
// Basic success
return success(todo);

// With reasoning (recommended)
return success(todo, {
  reasoning: `Created todo "${todo.title}"`,
});

// With confidence (for AI-generated content)
return success(suggestion, {
  reasoning: 'Generated based on user history',
  confidence: 0.85,
});

// With warnings (for mutations with side effects)
return success(result, {
  reasoning: 'Deleted 5 items',
  warnings: [
    { code: 'PERMANENT', message: 'This action cannot be undone' },
  ],
});

// With suggestions (guide next steps)
return success(user, {
  reasoning: 'User created successfully',
  suggestions: ['Add profile photo', 'Set notification preferences'],
});
```

## Error Responses

```typescript
// Not found
return error('NOT_FOUND', `Todo ${input.id} not found`, {
  suggestion: 'Use todo-list to see available todos',
});

// Validation error
return error('VALIDATION_ERROR', 'Title cannot be empty', {
  suggestion: 'Provide a title between 1 and 200 characters',
});

// Permission denied
return error('FORBIDDEN', 'You cannot modify this resource', {
  suggestion: 'Contact the owner to request access',
});

// Conflict
return error('CONFLICT', 'Email already registered', {
  suggestion: 'Use user.login instead, or reset password',
});

// No changes
return error('NO_CHANGES', 'No fields to update', {
  suggestion: 'Provide at least one field to update',
});
```

## MCP Server Setup

### Basic Server

```typescript
import { createMcpServer } from '@lushly-dev/afd-server';
import { allCommands } from './commands/index.js';

const server = createMcpServer({
  name: 'my-app',
  version: '1.0.0',
  commands: allCommands,
});

await server.start();
console.error(`MCP server running at ${server.getUrl()}`);
```

Only commands declaring `expose: { mcp: true }` appear in `tools/list` and can be called
remotely; `server.execute()` can still run private commands in-process.

### Embeddable Node Handler

Use `createMcpHandler()` when a framework or platform owns the HTTP server lifecycle and expects a Node request handler:

```typescript
import { createServer } from 'node:http';
import { createMcpHandler } from '@lushly-dev/afd-server';
import { allCommands } from './commands/index.js';

const handler = createMcpHandler({
  name: 'my-app',
  version: '1.0.0',
  commands: allCommands,
  host: '127.0.0.1',
  port: 3100,
});

createServer((req, res) => {
  void handler(req, res);
}).listen(3100, '127.0.0.1');
```

Use `createMcpServer()` for the batteries-included standalone server. Use `createMcpHandler()` when you need AFD to plug into an existing Node HTTP host.

### Tool Strategies and Bootstrap Tools

`toolStrategy` defaults to `'grouped'`: one tool per group (the command's `category`, else
the first name segment) taking `{ action, params }`, plus `afd-detail`, `afd-call`,
`afd-batch` and `afd-pipe`. Each grouped tool lists every action's command name, input
schema, `requires`, `examples`, `mutation` and `outputSchema` in `_meta.actions`; small
groups also inline the per-action schemas as `params.anyOf` branches titled with the
action. Use `toolStrategy: 'individual'` for one tool per command.

```typescript
const server = createMcpServer({
  name: 'my-app',
  version: '1.0.0',
  commands: allCommands,
  bootstrap: true, // afd-help, afd-docs, afd-schema (default: false)
});
```

`bootstrap: true` registers `afd-help`, `afd-docs` and `afd-schema` as MCP tools. They
describe only MCP-exposed commands in the active context; `afd-schema` with
`format: 'typescript'` also returns generated input types. Do not add
`getBootstrapCommands()` output to `commands` as well: server creation throws on duplicate
names and on names the server owns (`afd-call`, `afd-batch`, `afd-pipe`, `afd-discover`,
`afd-detail`; the bootstrap names with `bootstrap: true`; the `afd-context-*` names with
`contexts`).

### Lazy Strategy (Large Command Sets)

```typescript
const server = createMcpServer({
  name: 'my-app',
  version: '1.0.0',
  commands: allCommands,
  toolStrategy: 'lazy',  // Exposes afd-discover, afd-detail, afd-call, afd-batch, afd-pipe
});
```

The expected agent workflow in lazy mode is `afd-discover -> afd-detail -> afd-call`. `afd-call`, `afd-batch`, and `afd-pipe` remain available across all tool strategies; `lazy` just keeps discovery constant-cost for large command sets. Meta-tool arguments are validated: bad `afd-call`/`afd-discover`/`afd-detail` arguments return `VALIDATION_ERROR`, bad batch or pipeline envelopes `INVALID_BATCH_REQUEST`/`INVALID_PIPELINE_REQUEST`.

### With Contexts

```typescript
const server = createMcpServer({
  name: 'my-app',
  version: '1.0.0',
  commands: allCommands,
  contexts: [
    { name: 'editing', description: 'Document editing tools' },
    { name: 'reviewing', description: 'Review and approval tools' },
  ],
});
```

### With Middleware

```typescript
import {
  createMcpServer,
  defaultMiddleware,
  createRateLimitMiddleware,
} from '@lushly-dev/afd-server';

// Recommended: defaultMiddleware() gives trace IDs, logging, and slow-command warnings
const server = createMcpServer({
  name: 'my-app',
  version: '1.0.0',
  commands: allCommands,
  middleware: [
    ...defaultMiddleware(),  // Trace IDs, logging, slow-command warnings
    createRateLimitMiddleware({ maxRequests: 100, windowMs: 60000 }),
  ],
});

// Selective disable or custom options
const server2 = createMcpServer({
  name: 'my-app',
  version: '1.0.0',
  commands: allCommands,
  middleware: defaultMiddleware({
    logging: { logInput: true },
    timing: { slowThreshold: 500 },
  }),
});
```

## Command Registry Pattern

```typescript
// commands/create.ts
export const createTodo = defineCommand({...});

// commands/list.ts
export const listTodos = defineCommand({...});

// commands/index.ts
import type { ZodCommandDefinition } from '@lushly-dev/afd-server';
import { createTodo } from './create.js';
import { listTodos } from './list.js';
import { getTodo } from './get.js';

export { createTodo, listTodos, getTodo };

// Annotate the array; no `as unknown as` cast is needed
export const allCommands: ZodCommandDefinition[] = [
  createTodo,
  listTodos,
  getTodo,
];
```

## Testing Commands

### Unit Tests

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { store } from '../store/memory.js';
import { createTodo } from './create.js';

beforeEach(() => {
  store.clear();
});

describe('todo-create', () => {
  it('creates todo with required fields', async () => {
    const result = await createTodo.handler(
      { title: 'Test', priority: 'medium' },
      {}
    );

    expect(result.success).toBe(true);
    expect(result.data?.title).toBe('Test');
    expect(result.reasoning).toBeDefined();
  });

  it('uses default priority', async () => {
    const result = await createTodo.handler(
      { title: 'Test' },
      {}
    );

    expect(result.data?.priority).toBe('medium');
  });
});
```

### AFD Compliance Tests

```typescript
describe('AFD Compliance', () => {
  it('success results include reasoning', async () => {
    const result = await createTodo.handler({ title: 'Test' }, {});

    expect(result.success).toBe(true);
    expect(result.reasoning).toBeDefined();
    expect(typeof result.reasoning).toBe('string');
  });

  it('error results include suggestion', async () => {
    const result = await getTodo.handler({ id: 'nonexistent' }, {});

    expect(result.success).toBe(false);
    expect(result.error?.suggestion).toBeDefined();
  });
});
```

### Performance Tests

```typescript
describe('Performance', () => {
  it('todo-create < 10ms', async () => {
    const start = performance.now();
    await createTodo.handler({ title: 'Test' }, {});
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(10);
  });
});
```

## TypeScript Gotchas

### Zod Input vs Output Types

```typescript
// Zod distinguishes between input and output types!
const schema = z.object({
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
});

// z.input<typeof schema>  -> { priority?: 'low' | 'medium' | 'high' }
// z.output<typeof schema> -> { priority: 'low' | 'medium' | 'high' }
```

`defineCommand` uses each side where it belongs:

- The server parses the input before calling the handler, so `handler(input)` receives
  `z.output` (defaults applied, transforms run). No need to re-parse.
- The advertised JSON Schema (`jsonSchema`, MCP `inputSchema`, `afd-detail`) is generated
  in Zod **input** mode: `priority` is optional, and a `.transform()` field is advertised by
  its input type. Transforms in input schemas are fine.
- `examples` are typed as `z.input` and validated at define time, so they may omit defaults.
- `output` schemas are generated in output mode (defaulted fields required).
- `z.number().int()` is advertised as `type: 'integer'`.

### Generic Registry Types

```typescript
// Use 'any' internally, cast at boundaries
class CommandRegistry {
  private commands = new Map<string, CommandDefinition<any, any>>();

  register<TSchema extends z.ZodType, TOutput>(
    command: CommandDefinition<TSchema, TOutput>
  ) {
    this.commands.set(command.name, command as CommandDefinition<any, any>);
  }

  async execute<TOutput>(name: string, input: unknown): Promise<CommandResult<TOutput>> {
    const command = this.commands.get(name);
    return command.handler(input) as CommandResult<TOutput>;
  }
}
```

## Project Configuration

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

### biome.json (Linting)

```json
{
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "trailingCommas": "es5",
      "semicolons": "always"
    }
  },
  "linter": {
    "rules": {
      "correctness": {
        "noUnusedImports": "error",
        "noUnusedVariables": "error"
      },
      "style": {
        "useImportType": "error",
        "useConst": "error"
      },
      "suspicious": {
        "noExplicitAny": "error"
      }
    }
  }
}
```

## Related Skills

- `afd-developer` - Core AFD methodology
- `afd-python` - Python implementation patterns
- `afd-rust` - Rust implementation patterns
