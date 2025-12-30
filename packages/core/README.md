# @afd/core

Core types and utilities for Agent-First Development.

## Installation

```bash
npm install @afd/core
# or
pnpm add @afd/core
```

## Overview

This package provides the foundational types used across all AFD packages:

- **CommandResult** - Standard result type with UX-enabling fields
- **CommandError** - Actionable error structure
- **CommandDefinition** - Full command schema with handler
- **MCP types** - Model Context Protocol types for agent communication

## Usage

### Creating Command Results

```typescript
import { success, failure, type CommandResult } from '@afd/core';

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
import { isSuccess, isFailure } from '@afd/core';

if (isSuccess(result)) {
  console.log(result.data); // TypeScript knows data exists
}

if (isFailure(result)) {
  console.log(result.error); // TypeScript knows error exists
}
```

### Defining Commands

```typescript
import {
  type CommandDefinition,
  createCommandRegistry,
  success,
  validationError
} from '@afd/core';

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
  name: 'document.create',
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

const result = await registry.execute('document.create', { title: 'Test' });
```

### Creating Errors

```typescript
import {
  validationError,
  notFoundError,
  rateLimitError,
  createError
} from '@afd/core';

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
} from '@afd/core';

// Convert command to MCP tool format
const tool: McpTool = commandToMcpTool(createDocument);

// Create MCP request
const request: McpRequest = createMcpRequest('tools/call', {
  name: 'document.create',
  arguments: { title: 'New Doc' }
});
```

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
