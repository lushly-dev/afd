# AFD Todo App Example

A complete working example demonstrating Agent-First Development patterns.

This todo app shows how the same commands can be used via:
- **CLI** - Direct command invocation with `afd call`
- **MCP** - AI agent access via Model Context Protocol
- **Web UI** - Browser-based interface

## Quick Start

```bash
# From the afd root directory
pnpm install
pnpm build

# Start the todo server
node packages/examples/todo-app/dist/server.js
```

The server will start at `http://localhost:3100`.

## Using the CLI

Connect to the server and interact with commands:

```bash
# Connect to the server
afd connect http://localhost:3100/sse

# List available commands
afd tools

# Create a todo
afd call todo.create '{"title": "Learn AFD", "priority": "high"}'

# List todos
afd call todo.list '{}'

# Toggle completion
afd call todo.toggle '{"id": "todo-xxx-xxx"}'

# Get statistics
afd call todo.stats '{}'
```

## Using the Web UI

1. Start the server (see Quick Start)
2. Open `packages/examples/todo-app/ui/index.html` in a browser
3. The UI connects to the same MCP server and uses the same commands

## Commands

| Command | Type | Description |
|---------|------|-------------|
| `todo.create` | mutation | Create a new todo |
| `todo.list` | query | List todos with filtering |
| `todo.get` | query | Get a single todo by ID |
| `todo.update` | mutation | Update todo fields |
| `todo.toggle` | mutation | Toggle completion status |
| `todo.delete` | mutation | Delete a todo |
| `todo.clear` | mutation | Clear completed todos |
| `todo.stats` | query | Get statistics |

## Command Examples

### todo.create

```json
// Input
{
  "title": "Buy groceries",
  "description": "Milk, eggs, bread",
  "priority": "medium"
}

// Output
{
  "success": true,
  "data": {
    "id": "todo-1234567890-abc",
    "title": "Buy groceries",
    "description": "Milk, eggs, bread",
    "priority": "medium",
    "completed": false,
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  },
  "reasoning": "Created todo \"Buy groceries\" with medium priority",
  "confidence": 1.0
}
```

### todo.list

```json
// Input - all pending high-priority todos
{
  "completed": false,
  "priority": "high",
  "sortBy": "createdAt",
  "sortOrder": "desc",
  "limit": 10
}

// Output
{
  "success": true,
  "data": {
    "todos": [...],
    "total": 5,
    "hasMore": false
  },
  "reasoning": "Found 5 todos (pending, high priority), returning 5 starting at offset 0",
  "confidence": 1.0
}
```

### todo.toggle

```json
// Input
{
  "id": "todo-1234567890-abc"
}

// Output
{
  "success": true,
  "data": {
    "id": "todo-1234567890-abc",
    "title": "Buy groceries",
    "completed": true,
    "completedAt": "2024-01-15T11:00:00.000Z",
    ...
  },
  "reasoning": "Marked as completed: \"Buy groceries\"",
  "confidence": 1.0
}
```

## Project Structure

```
todo-app/
├── src/
│   ├── commands/          # Command definitions
│   │   ├── create.ts      # todo.create
│   │   ├── list.ts        # todo.list
│   │   ├── get.ts         # todo.get
│   │   ├── update.ts      # todo.update
│   │   ├── toggle.ts      # todo.toggle
│   │   ├── delete.ts      # todo.delete
│   │   ├── clear.ts       # todo.clear
│   │   ├── stats.ts       # todo.stats
│   │   └── index.ts       # Export all
│   ├── store/
│   │   └── memory.ts      # In-memory storage
│   ├── types.ts           # Type definitions
│   └── server.ts          # MCP server entry point
├── ui/
│   ├── index.html         # Web UI
│   └── app.js             # UI JavaScript
├── package.json
└── tsconfig.json
```

## Key AFD Patterns Demonstrated

### 1. Command-First Development

Every feature is defined as a command before any UI is built:

```typescript
const createTodo = defineCommand({
  name: 'todo.create',
  description: 'Create a new todo item',
  input: z.object({
    title: z.string().min(1).max(200),
    priority: z.enum(['low', 'medium', 'high']).default('medium'),
  }),
  async handler(input) {
    const todo = store.create(input);
    return success(todo);
  },
});
```

### 2. CLI Validation

Commands are testable via CLI before UI development:

```bash
# Test the command works
afd call todo.create '{"title": "Test"}'

# Test error handling
afd call todo.get '{"id": "nonexistent"}'
```

### 3. UX-Enabling Schemas

Commands return data that enables good UI/agent experiences:

```typescript
return success(todo, {
  reasoning: `Created todo "${todo.title}" with ${input.priority} priority`,
  confidence: 1.0,
  warnings: [
    { code: 'PERMANENT', message: 'This action cannot be undone' }
  ],
});
```

### 4. Dual Interface

The same commands power both the CLI and the web UI. The UI is a thin wrapper:

```javascript
// UI calls the same commands
const result = await callTool('todo.create', { 
  title: 'New todo', 
  priority: 'high' 
});
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3100 | Server port |
| `HOST` | localhost | Server host |
| `LOG_LEVEL` | info | Log level (info, debug) |

## Extending the Example

To add a new command:

1. Create a new file in `src/commands/` (e.g., `archive.ts`)
2. Define the command with `defineCommand`
3. Add to the exports in `src/commands/index.ts`
4. Rebuild: `pnpm build`
5. Test via CLI: `afd call todo.archive '{"id": "..."}'`
6. (Optional) Add UI support

## Testing

The todo app includes comprehensive automated tests demonstrating AFD testing patterns:

```bash
# Run all tests
pnpm test

# Run with watch mode
pnpm test:watch
```

### Test Structure

```
src/commands/__tests__/
├── commands.test.ts      # Unit tests (31 tests)
└── performance.test.ts   # Performance tests (13 tests)
```

### Unit Tests (`commands.test.ts`)

Tests for every command covering:
- Happy path execution
- Error handling (NOT_FOUND, NO_CHANGES, etc.)
- Input validation
- AFD compliance (CommandResult structure, confidence, reasoning, warnings)

```typescript
// Example: AFD compliance test
it('success results include confidence', async () => {
  const result = await createTodo.handler({ title: 'Test', priority: 'medium' }, {});
  expect(result.confidence).toBeGreaterThanOrEqual(0);
  expect(result.confidence).toBeLessThanOrEqual(1);
});
```

### Performance Tests (`performance.test.ts`)

Establishes baselines and detects regressions:

| Test Category | Purpose |
|---------------|---------|
| Single Operation | Individual command latency |
| Query Performance | List/filter/stats with data |
| Batch Operations | Bulk create/clear timing |
| Latency Percentiles | p50/p95/p99 tracking |

```bash
# Performance summary output:
📊 Performance Summary
Command             Duration    Threshold   Status
────────────────────────────────────────────────────────
todo.create         0.85ms      10ms        ✓
todo.get            0.06ms      5ms         ✓
bulk list (100)     0.09ms      50ms        ✓
```

### Why Test Commands Directly?

Testing at the command layer (not through HTTP) isolates:
- Pure business logic performance
- No network latency
- No serialization overhead
- Consistent, reproducible results

This is a core AFD principle: **if commands are fast in isolation, they'll be fast everywhere**.

## Related

- [AFD Documentation](../../../docs/)
- [@afd/server](../../server/) - Server utilities used by this example
- [@afd/cli](../../cli/) - CLI tool for testing commands
