# @lushly-dev/afd-core

Core types and utilities for Agent-First Development.

## Installation

```bash
npm install @lushly-dev/afd-core
# or
pnpm add @lushly-dev/afd-core
```

## Overview

This package provides the foundational types used across all AFD packages:

- **CommandResult** - Standard result type with UX-enabling fields
- **CommandError** - Actionable error structure
- **CommandDefinition** - Full command schema with handler
- **MCP types** - Model Context Protocol types for agent communication

## Entry points

| Import | Contents | Runs in |
|--------|----------|---------|
| `@lushly-dev/afd-core` | All types and helpers, plus the deprecated connector re-exports; not `platform` | Node.js (see below) |
| `@lushly-dev/afd-core/commands` | Command types, `defaultExpose`, `validateCommandName`, `createCommandRegistry`, MCP tool conversion | Node.js and browsers |
| `@lushly-dev/afd-core/result` | `CommandResult`, `success`, `failure`, `error`, `isSuccess`, `isFailure` | Node.js and browsers |
| `@lushly-dev/afd-core/connectors` | `GitHubConnector`, `PackageManagerConnector` and their types | Node.js only |
| `@lushly-dev/afd-core/platform` | `exec`, `findUp`, `isWindows` and other process helpers | Node.js only |

### Connectors are moving out of the root entry

`GitHubConnector` and `PackageManagerConnector` spawn processes through
`node:child_process`. Import them from the `connectors` subpath:

```typescript
import { GitHubConnector, PackageManagerConnector } from '@lushly-dev/afd-core/connectors';
```

The root entry still re-exports them, marked `@deprecated`, so existing imports
keep working. **These root re-exports will be removed in the next major
version.** Until then they block browser bundling: any bundle that imports the
root entry, even `import { success } from '@lushly-dev/afd-core'`, pulls in
`node:child_process`, `node:fs`, `node:os` and `node:path`, and a browser build
(for example `esbuild --bundle --platform=browser`) fails. Browser code should
import from `@lushly-dev/afd-core/result` and `@lushly-dev/afd-core/commands`,
or define commands through `@lushly-dev/afd-server/define`.

## Usage

### Creating Command Results

```typescript
import { success, failure, type CommandResult } from '@lushly-dev/afd-core';

// Successful result with UX-enabling fields
const result: CommandResult<Document> = success(
  { id: 'doc-123', title: 'My Document' },
  {
    confidence: 0.95,
    reasoning: 'Document created with all required fields',
    sources: [{ type: 'template', title: 'Default Template' }]
  }
);

// Failed result with actionable error
const error = failure({
  code: 'VALIDATION_ERROR',
  message: 'Title is required',
  suggestion: 'Provide a title and try again',
  retryable: false
});
```

### Using Type Guards

```typescript
import { isSuccess, isFailure } from '@lushly-dev/afd-core';

if (isSuccess(result)) {
  console.log(result.data); // Typed as T (undefined for void commands)
}

if (isFailure(result)) {
  console.log(result.error); // TypeScript knows error exists
}
```

`isSuccess` checks only `success === true`, so a void command's `success(undefined)` is a success.
`isFailure` checks only `success === false`, so every result is exactly one of the two, and
`{ success: false }` without an `error` is a failure. Results built with `failure()` always carry an
`error`; read one from an untrusted peer defensively (`result.error?.code`).

### Defining Commands

```typescript
import {
  type CommandDefinition,
  createCommandRegistry,
  success,
  validationError
} from '@lushly-dev/afd-core';

interface CreateDocInput {
  title: string;
  content?: string;
}

interface Document {
  id: string;
  title: string;
  content: string;
}

const createDocument: CommandDefinition<CreateDocInput, Document> = {
  name: 'document-create',
  description: 'Creates a new document',
  category: 'documents',
  parameters: [
    { name: 'title', type: 'string', description: 'Document title', required: true },
    { name: 'content', type: 'string', description: 'Document content' }
  ],
  handler: async (input) => {
    if (!input.title) {
      return failure(validationError('Title is required'));
    }
    
    const doc = await db.createDocument(input);
    return success(doc, {
      confidence: 1.0,
      reasoning: 'Document created successfully'
    });
  }
};

// Register and execute
const registry = createCommandRegistry();
registry.register(createDocument);

const result = await registry.execute('document-create', { title: 'Test' });
```

The registry follows the same rules as the MCP server:

- Pass `{ interface: 'mcp' }` (or `'cli'`, `'agent'`, `'palette'`) as the context to
  `execute`, `executeBatch` or `executeStream` and the command's `expose` options are
  checked on every entry point, including each batch entry.
- `executeBatch` validates the whole request with `isBatchRequest()` before running
  anything, and `options.timeout` is a deadline at any `parallelism`.
- A handler that throws returns `COMMAND_EXECUTION_ERROR` without the exception message
  or stack. Pass `createCommandRegistry({ devMode: true })` to include them.

Batch and stream execution live in `executeBatch()` and `executeStream()`, which take an
`execute` callback like `executePipeline()`, so other hosts can reuse the same semantics. The MCP
server uses them too.

`executeStream()` does not stream incrementally: the command runs to completion, then its result is
turned into chunks (one `data` chunk per array item, or one for any other value, then `complete`).
`StreamableCommand` is metadata only.

### Creating Errors

```typescript
import {
  validationError,
  notFoundError,
  rateLimitError,
  createError
} from '@lushly-dev/afd-core';

// Pre-built error factories
const err1 = validationError('Invalid email format');
const err2 = notFoundError('Document', 'doc-123');
const err3 = rateLimitError(60); // Retry after 60 seconds

// Custom errors
const err4 = createError('CUSTOM_ERROR', 'Something went wrong', {
  suggestion: 'Try doing X instead',
  retryable: true,
  details: { foo: 'bar' }
});
```

### MCP Integration

```typescript
import {
  createMcpRequest,
  commandToMcpTool,
  type McpRequest,
  type McpTool
} from '@lushly-dev/afd-core';

// Convert command to MCP tool format
const tool: McpTool = commandToMcpTool(createDocument);

// Create MCP request
const request: McpRequest = createMcpRequest('tools/call', {
  name: 'document-create',
  arguments: { title: 'New Doc' }
});
```

### Pipelines

`executePipeline` runs chained steps; the server's `afd-pipe` tool and `DirectClient.pipe` both use it.
Variable references follow [`spec/pipeline-variables.md`](../../spec/pipeline-variables.md), which
Python and Rust implement too:

```typescript
import { executePipeline } from '@lushly-dev/afd-core';

const result = await executePipeline(
  {
    input: { userId: 'u-1' }, // any JSON value; steps read it as $input
    steps: [
      { command: 'user-get', input: { id: '$input.userId' }, as: 'user' },
      { command: 'order-list', input: { userId: '$prev.id', currency: '$$USD' } },
      { command: 'invoice-send', input: { email: '$steps.user.email' }, when: { $exists: '$prev.items[0]' } },
    ],
  },
  (name, input, context) => registry.execute(name, input, context)
);
```

- A string is a reference only when the **whole string** is `$prev`, `$first`, `$steps[N]`,
  `$steps.<alias>` or `$input`, optionally followed by `.<path>` (`user.name`, `items[2]`, `items.2`).
  `$prev` is the last successful step. Other strings (`$9.99`, `$HOME`) pass through unchanged,
  `$$` sends a literal `$` (`'$$USD'` becomes `'$USD'`), and strings over 1024 characters are literals.
- `$input` is the request's `input` field. **It is never the executor's `context`**; before this
  change it resolved to that context, so trace IDs, auth or other host values could be copied into a
  command input.
- Paths follow only own keys of plain JSON objects and in-bounds array indices. `constructor`,
  `__proto__`, any `__`-prefixed segment and array `length` never resolve.
- An unresolved reference is omitted from an object and becomes `null` in an array. In `when`
  conditions it is absent: `$exists` is false and every comparison with it is false.
- Step inputs or a request `input` nested deeper than 64 levels fail with `VALIDATION_ERROR` before
  any step runs. A malformed request fails with `INVALID_PIPELINE_REQUEST`.
- Step data is copied (`structuredClone`) when it is recorded and when it is resolved, so a handler
  that mutates its input cannot change another step's data.
- Steps run one after another. `options.parallel: true` and a step with `stream: true` are not
  implemented: the offending step (step 0 for `parallel`) fails with `UNSUPPORTED_OPTION` and every
  other step is skipped, before any command runs. `PipelineStep.stream` and `options.onProgress` are
  deprecated; `onProgress` is accepted but never called.

## Types

### CommandResult<T>

The standard return type for all AFD commands:

```typescript
interface CommandResult<T> {
  // Core fields
  success: boolean;
  data?: T;
  error?: CommandError;
  
  // UX-enabling fields
  confidence?: number;      // 0-1
  reasoning?: string;       // Why this result
  sources?: Source[];       // Information sources
  plan?: PlanStep[];        // Multi-step plan
  alternatives?: Alternative<T>[];
  warnings?: Warning[];
  metadata?: ResultMetadata;
}
```

### CommandError

Actionable error structure:

```typescript
interface CommandError {
  code: string;           // Machine-readable code
  message: string;        // Human-readable message
  suggestion?: string;    // What user can do
  retryable?: boolean;    // Can retry help?
  details?: Record<string, unknown>;
  cause?: CommandError | Error;
}
```

`wrapError()` turns a thrown `Error` into a plain `CommandError`: it keeps the message
and any `code`, `suggestion` and `retryable` fields, drops everything else (such as a
Node system error's `path`), never puts the stack in `details`, and keeps `cause` only
when it is a `CommandError`. `isCommandError()` returns `false` for `Error` instances.

### CommandDefinition

Full command schema:

```typescript
interface CommandDefinition<TInput, TOutput> {
  name: string;
  description: string;
  category?: string;
  parameters: CommandParameter[];
  returns?: JsonSchema;
  errors?: string[];
  handler: CommandHandler<TInput, TOutput>;
  version?: string;
  tags?: string[];
  mutation?: boolean;
  executionTime?: 'instant' | 'fast' | 'slow' | 'long-running';
}
```

## License

MIT
