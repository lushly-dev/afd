---
name: afd-typescript
description: >
  TypeScript implementation patterns for AFD commands using Zod schemas,
  @lushly-dev/afd-server, and @lushly-dev/afd-core. Covers command definition, schema design,
  error handling, MCP server setup, and testing. Use when: implementing
  commands in TypeScript, setting up MCP servers, writing Zod schemas,
  or debugging TypeScript AFD code.
  Triggers: typescript afd, ts command, zod schema, defineCommand,
  @lushly-dev/afd-server, @lushly-dev/afd-core, typescript implementation.
---

# AFD TypeScript Implementation

Patterns for implementing AFD commands in TypeScript.

## Package Imports

```typescript
// Core types
import type { CommandResult, CommandError } from '@lushly-dev/afd-core';

// Server utilities
import { defineCommand, success, error, createMcpServer } from '@lushly-dev/afd-server';

// Schema validation
import { z } from 'zod';
```

## Command Definition

### Basic Command

```typescript
import { z } from 'zod';
import { defineCommand, success, error } from '@lushly-dev/afd-server';

const inputSchema = z.object({
  title: z.string().min(1).max(200),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
});

export const createTodo = defineCommand({
  name: 'todo-create',
  description: 'Create a new todo item',
  category: 'todo',
  mutation: true,
  version: '1.0.0',
  input: inputSchema,
  errors: ['VALIDATION_ERROR'],

  async handler(input) {
    const parsed = inputSchema.parse(input);
    const todo = await store.create(parsed);

    return success(todo, {
      reasoning: `Created todo "${todo.title}" with ${parsed.priority} priority`,
      confidence: 1.0,
    });
  },
});
```

### Command with Context

```typescript
export const updateTodo = defineCommand({
  name: 'todo-update',
  description: 'Update a todo item',
  category: 'todo',
  mutation: true,
  input: updateSchema,
  errors: ['NOT_FOUND', 'NO_CHANGES'],

  async handler(input, context) {
    // context.traceId - Correlation ID for logging
    // context.userId - Authenticated user (if available)
    console.log(`[${context.traceId}] Updating todo ${input.id}`);

    const todo = await store.get(input.id);
    if (!todo) {
      return error('NOT_FOUND', `Todo ${input.id} not found`, {
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

const PORT = process.env.PORT ?? 3100;
server.listen(PORT, () => {
  console.log(`MCP server running at http://localhost:${PORT}`);
});
```

### With Middleware

```typescript
import {
  createMcpServer,
  createLoggingMiddleware,
  createTimingMiddleware,
  createRateLimitMiddleware,
} from '@lushly-dev/afd-server';

const server = createMcpServer({
  name: 'my-app',
  version: '1.0.0',
  commands: allCommands,
  middleware: [
    createLoggingMiddleware({ level: 'info' }),
    createTimingMiddleware(),
    createRateLimitMiddleware({ maxRequests: 100, windowMs: 60000 }),
  ],
  cors: {
    origin: ['http://localhost:5173'],
    methods: ['GET', 'POST', 'OPTIONS'],
  },
});
```

## Command Registry Pattern

```typescript
// commands/create.ts
export const createTodo = defineCommand({...});

// commands/list.ts
export const listTodos = defineCommand({...});

// commands/index.ts
import { createTodo } from './create.js';
import { listTodos } from './list.js';
import { getTodo } from './get.js';

export { createTodo, listTodos, getTodo };

export const allCommands = [
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

// Always parse inside handler to apply defaults
async handler(rawInput: z.input<typeof schema>) {
  const input = schema.parse(rawInput);
  // input.priority is guaranteed to exist now
}
```

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
