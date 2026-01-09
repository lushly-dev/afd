# Command Design

Patterns for designing AFD commands with Zod schemas.

## Command Structure

```typescript
import { z } from 'zod';
import { defineCommand, success, error } from '@afd/server';

export const myCommand = defineCommand({
  // Identity
  name: 'domain.action',           // e.g., 'todo.create', 'user.update'
  description: 'What this command does',
  category: 'domain',              // Groups related commands
  version: '1.0.0',
  
  // Behavior
  mutation: true,                  // Does this change state?
  
  // Schema
  input: z.object({...}),          // Zod schema for input validation
  errors: ['NOT_FOUND', 'VALIDATION_ERROR'],  // Expected error codes
  
  // Implementation
  async handler(input, context) {
    // Business logic here
    return success(data, { reasoning: '...' });
  },
});
```

## Input Schemas with Zod

### Basic Types

```typescript
const inputSchema = z.object({
  // Required string
  title: z.string().min(1).max(200),
  
  // Optional with default
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  
  // Optional field
  description: z.string().max(1000).optional(),
  
  // Number with constraints
  count: z.number().int().positive().max(100),
  
  // Boolean
  completed: z.boolean().default(false),
  
  // UUID
  id: z.string().uuid(),
  
  // Email
  email: z.string().email(),
  
  // Date as ISO string
  dueDate: z.string().datetime().optional(),
});
```

### Array and Object Types

```typescript
const inputSchema = z.object({
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

### Refinements

```typescript
const inputSchema = z.object({
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
}).refine(
  (data) => new Date(data.endDate) > new Date(data.startDate),
  { message: 'End date must be after start date' }
);
```

## Success Responses

Always include UX-enabling metadata:

```typescript
// Basic success
return success(todo);

// With reasoning (recommended)
return success(todo, {
  reasoning: `Created todo "${todo.title}" with ${input.priority} priority`,
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

Errors should be actionable:

```typescript
// Not found
return error('NOT_FOUND', `Todo ${input.id} not found`, {
  suggestion: 'Use todo.list to see available todos',
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

// Rate limited
return error('RATE_LIMITED', 'Too many requests', {
  suggestion: 'Wait 60 seconds before retrying',
});
```

## Standard Error Codes

| Code | When to use |
|------|-------------|
| `NOT_FOUND` | Resource doesn't exist |
| `VALIDATION_ERROR` | Input fails schema validation |
| `FORBIDDEN` | User lacks permission |
| `CONFLICT` | Resource state prevents action |
| `RATE_LIMITED` | Too many requests |
| `INTERNAL_ERROR` | Unexpected server error |
| `NO_CHANGES` | Update had nothing to change |

## Naming Conventions

### Command Names

Format: `domain.action`

```
✅ Good:
todo.create
todo.list
todo.update
user.authenticate
document.search

❌ Bad:
createTodo       (not namespaced)
todo_create      (wrong separator)
TodoCreate       (not lowercase)
```

### Categories

Group related commands:

```typescript
// All user commands
'user.create', 'user.update', 'user.delete', 'user.list'

// All document commands  
'document.create', 'document.search', 'document.export'
```

## Context Object

The second argument to handler provides execution context:

```typescript
async handler(input, context) {
  // context.traceId - Correlation ID for logging
  // context.userId - Authenticated user (if available)
  // context.custom - Custom middleware data
  
  console.log(`[${context.traceId}] Processing request`);
}
```

## Complete Example

```typescript
import { z } from 'zod';
import { defineCommand, success, error } from '@afd/server';
import { store } from '../store/memory.js';
import type { Todo } from '../types.js';

const inputSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  description: z.string().max(1000).optional(),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
});

export const createTodo = defineCommand<typeof inputSchema, Todo>({
  name: 'todo.create',
  description: 'Create a new todo item',
  category: 'todo',
  mutation: true,
  version: '1.0.0',
  input: inputSchema,
  errors: ['VALIDATION_ERROR'],
  
  async handler(input, context) {
    const todo = store.create({
      title: input.title,
      description: input.description,
      priority: input.priority,
    });
    
    return success(todo, {
      reasoning: `Created todo "${todo.title}" with ${input.priority} priority`,
      confidence: 1.0,
    });
  },
});
```
