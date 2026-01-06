# Todo Example

Multi-stack implementation of a Todo application demonstrating **Agent-First Development (AFD)** patterns. This example features both TypeScript and Python backends that are validated against a shared conformance test suite.

## Architecture

- **Spec-First**: All backends must comply with the [API Contract](./spec/test-cases.json).
- **Multi-Stack**: Identical functionality implemented in TypeScript and Python.
- **MCP-Native**: Backends are Model Context Protocol (MCP) servers, ready for AI agents.
- **Thin UI**: Frontends are thin surfaces that invoke commands via MCP.
- **Shared Storage**: Both backends use the same JSON file for data persistence.

## Quick Start

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Run Conformance Tests

The conformance suite validates that a backend correctly implements the required commands and logic.

**TypeScript Backend:**

```bash
npx tsx dx/run-conformance.ts ts
```

**Python Backend:**

```bash
npx tsx dx/run-conformance.ts py
```

### 3. Start a Backend (Manual)

**TypeScript:**

```bash
cd backends/typescript
pnpm dev
```

**Python:**

```bash
cd backends/python
# Ensure PYTHONPATH includes the local afd library
$env:PYTHONPATH = "../../../python/src"
python src/server.py
```

### 4. Start a Frontend

**Vanilla JS:**

```bash
pnpm dev:web
```

**React:**

```bash
pnpm dev:react
```

## Storage Configuration

Both backends support file-based storage (default) or in-memory storage:

| Variable | Default | Description |
|----------|---------|-------------|
| `TODO_STORE_TYPE` | `file` | `file` for shared JSON storage, `memory` for isolated in-memory |
| `TODO_STORE_PATH` | `data/todos.json` | Path to the shared JSON file |

File-based storage enables:
- **MCP/HTTP Sharing**: MCP clients (stdio) and HTTP server see the same todos
- **Cross-Backend Sharing**: TypeScript and Python backends share the same data
- **Remote Change Detection**: UI polls for changes made via CLI or MCP

## Frontend Features

Both Vanilla JS and React frontends demonstrate AFD UX principles:

### Trust & Transparency
- **Toast Notifications**: Show command results with confidence bars, execution time, and warnings
- **TrustPanel**: Displays confidence scores, reasoning, sources, and execution plans
- **CommandLog**: Real-time log of all MCP command calls

### User Control
- **ConfirmModal**: Confirmation dialogs for destructive operations (delete, clear)
- **ErrorRecovery**: Error panels with retry functionality and actionable suggestions
- **Batch Operations**: Select all, toggle selected, delete selected

### Multi-Surface Awareness
- **Remote Change Detection**: Polls every 3 seconds for external changes
- **Batched Notifications**: Groups multiple changes into single toast (e.g., "4 items added")
- **Source Indicators**: Shows "🌐 Remote change" for changes from CLI/MCP

### Filtering & Navigation
- **Filter Buttons**: All / Pending / Completed views
- **URL Parameters**: `?view=pending` for direct linking (Vanilla)

## Mix and Match

Any backend works with any frontend because they share the same command schemas:

| Backend    | Frontend | Command                          |
| ---------- | -------- | -------------------------------- |
| TypeScript | Vanilla  | `pnpm dev:ts` + `pnpm dev:web`   |
| TypeScript | React    | `pnpm dev:ts` + `pnpm dev:react` |
| Python     | Vanilla  | `pnpm dev:py` + `pnpm dev:web`   |
| Python     | React    | `pnpm dev:py` + `pnpm dev:react` |

## API Contract

The source of truth for this example is the [test-cases.json](./spec/test-cases.json) file, which defines the expected inputs, outputs, and state transitions for all commands.

## Commands

| Command | Description |
|---------|-------------|
| `todo-create` | Create a new todo |
| `todo-list` | List todos with filtering/pagination |
| `todo-get` | Get a single todo by ID |
| `todo-update` | Update a todo's properties |
| `todo-toggle` | Toggle completion status |
| `todo-delete` | Delete a todo |
| `todo-clear` | Clear completed todos |
| `todo-stats` | Get statistics |
| `todo-createBatch` | Create multiple todos |
| `todo-toggleBatch` | Toggle multiple todos |
| `todo-deleteBatch` | Delete multiple todos |

## Performance Features

This example demonstrates two levels of batching:

### Domain-Level Batch Commands

The todo app exposes batch operations as dedicated commands:

```bash
# Create multiple todos at once
afd call todo.createBatch '{"todos": [{"title": "Task 1"}, {"title": "Task 2"}]}'

# Toggle multiple todos
afd call todo.toggleBatch '{"ids": ["id1", "id2"]}'

# Delete multiple todos
afd call todo.deleteBatch '{"ids": ["id1", "id2"]}'
```

These return partial success semantics with confidence scores based on success rate.

### Transport-Level Batching (`@afd/core`)

For calling multiple different commands in a single roundtrip, use the `afd.batch` tool:

```bash
# Execute multiple different commands in one request
afd batch 'todo.create:{"title":"Task 1"}' 'todo.list:{}' 'todo.stats:{}'
```

Or via the client SDK:

```typescript
import { AFDClient } from '@afd/client';

const client = new AFDClient('http://localhost:3100/sse');
await client.initialize();

const result = await client.batch({
  commands: [
    { command: 'todo.create', input: { title: 'Task 1' } },
    { command: 'todo.create', input: { title: 'Task 2' } },
    { command: 'todo.list', input: {} }
  ],
  options: { stopOnError: false }
});

console.log(result.summary); // { total: 3, successCount: 3, failureCount: 0, skippedCount: 0 }
console.log(result.confidence); // Aggregated confidence score
```

### Streaming (for long-running commands)

The `@afd/core` streaming types enable progress updates for long-running operations:

```typescript
import { AFDClient } from '@afd/client';

const client = new AFDClient('http://localhost:3100/sse');
await client.initialize();

// Stream with progress updates
for await (const chunk of client.stream('todo.list', { limit: 1000 })) {
  if (chunk.type === 'progress') {
    console.log(`Progress: ${chunk.progress * 100}%`);
  } else if (chunk.type === 'complete') {
    console.log('Done:', chunk.data);
  }
}

// Or with callbacks
const controller = client.streamWithCallbacks('todo.list', { limit: 1000 }, {
  onProgress: (chunk) => console.log(`${chunk.progress * 100}%`),
  onComplete: (chunk) => console.log('Done:', chunk.data),
  onError: (chunk) => console.error('Error:', chunk.error)
});

// Cancel if needed
controller.abort();
```

See `@afd/core/batch` and `@afd/core/streaming` for type definitions.

