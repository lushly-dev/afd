# @afd/testing

Testing utilities for Agent-First Development.

## Installation

```bash
npm install @afd/testing --save-dev
# or
pnpm add @afd/testing -D
```

## Overview

This package provides utilities for testing AFD commands:

- **Validators**: Validate command results and definitions
- **Test Helpers**: Easy command testing with validation
- **Assertions**: Custom assertions for command results
- **Mock Server**: In-memory MCP server for testing

## Usage

### Testing Commands

```typescript
import { testCommand, assertSuccess, assertHasReasoning } from '@afd/testing';
import { describe, it, expect } from 'vitest';
import { myCommand } from './my-command';

describe('myCommand', () => {
  it('returns a valid result', async () => {
    const test = await testCommand(myCommand.handler, {
      input: 'test value'
    });

    // Check basic validity
    expect(test.isValid).toBe(true);
    expect(test.isSuccess).toBe(true);

    // Use assertions
    assertSuccess(test.result);
    assertHasReasoning(test.result);

    // Check data
    expect(test.result.data).toBeDefined();
  });

  it('handles errors correctly', async () => {
    const test = await testCommand(myCommand.handler, {
      input: '' // Invalid input
    });

    expect(test.isFailure).toBe(true);
    expect(test.result.error?.suggestion).toBeDefined();
  });
});
```

### Validating Command Definitions

```typescript
import { validateCommandDefinition, validateResult } from '@afd/testing';

// Validate a command definition
const defValidation = validateCommandDefinition(myCommand);
console.log('Definition valid:', defValidation.valid);
console.log('Errors:', defValidation.errors);
console.log('Warnings:', defValidation.warnings);

// Validate a result with options
const resultValidation = validateResult(result, {
  requireConfidence: true,
  requireReasoning: true,
  requireSources: true,
});
```

### Testing Multiple Cases

```typescript
import { testCommandMultiple } from '@afd/testing';

const results = await testCommandMultiple(myCommand.handler, [
  {
    input: { title: 'Valid Title' },
    expectSuccess: true,
    description: 'Valid input should succeed',
  },
  {
    input: { title: '' },
    expectSuccess: false,
    expectError: 'VALIDATION_ERROR',
    description: 'Empty title should fail',
  },
  {
    input: {},
    expectSuccess: false,
    description: 'Missing title should fail',
  },
]);

// Check all tests passed
const allPassed = results.every(r => r.passed);
```

### Custom Assertions

```typescript
import {
  assertSuccess,
  assertFailure,
  assertErrorCode,
  assertConfidence,
  assertHasSources,
  assertAiResult,
} from '@afd/testing';

// Basic assertions
assertSuccess(result); // Throws if not success
assertFailure(result); // Throws if not failure

// Error assertions
assertErrorCode(result, 'NOT_FOUND');
assertHasSuggestion(result);
assertRetryable(result, true);

// UX field assertions
assertConfidence(result, 0.8); // Minimum confidence
assertHasReasoning(result);
assertHasSources(result, 2); // At least 2 sources
assertHasPlan(result);
assertStepStatus(result, 'step-1', 'complete');

// AI result assertion (checks all UX fields)
assertAiResult(result, {
  minConfidence: 0.7,
  requireSources: true,
  requireAlternatives: false,
});
```

### Using Mock Server

```typescript
import { createMockServer, createMockCommand } from '@afd/testing';

// Create server with mock commands
const server = createMockServer([
  createMockCommand('document.get', (input) => ({
    id: input.id,
    title: 'Test Document',
  })),
]);

// Add more commands
server.register(createMockCommand('document.create', (input) => ({
  id: 'new-id',
  title: input.title,
})));

// Handle requests
const response = await server.handleRequest({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: {
    name: 'document.get',
    arguments: { id: 'doc-123' },
  },
});

// Check request log
const log = server.getRequestLog();
console.log('Requests made:', log.length);
```

### Creating Mock Commands

```typescript
import {
  createMockCommand,
  createSuccessCommand,
  createFailureCommand,
  createTestRegistry,
} from '@afd/testing';

// Simple mock that returns static data
const getUser = createSuccessCommand('user.get', {
  id: 'user-1',
  name: 'Test User',
});

// Mock with dynamic behavior
const createDoc = createMockCommand('document.create', (input) => ({
  id: `doc-${Date.now()}`,
  title: input.title,
  createdAt: new Date().toISOString(),
}));

// Mock that always fails
const deleteProtected = createFailureCommand('protected.delete', {
  code: 'FORBIDDEN',
  message: 'Cannot delete protected resource',
});

// Create registry with all mocks
const registry = createTestRegistry([getUser, createDoc, deleteProtected]);

// Execute commands
const result = await registry.execute('document.create', { title: 'New Doc' });
```

## Validation Rules

### Command Definition Validation

| Rule | Severity | Description |
|------|----------|-------------|
| `MISSING_NAME` | Error | Command must have a name |
| `INVALID_NAME_FORMAT` | Warning | Name should use dot notation |
| `MISSING_DESCRIPTION` | Error | Command must have a description |
| `SHORT_DESCRIPTION` | Warning | Description should be detailed |
| `MISSING_PARAMETERS` | Error | Command must have parameters array |
| `MISSING_HANDLER` | Error | Command must have a handler function |
| `MISSING_CATEGORY` | Warning | Command should have a category |
| `MISSING_ERROR_DOCS` | Warning | Command should document error codes |

### Result Validation

| Rule | Severity | Description |
|------|----------|-------------|
| `INVALID_SUCCESS_TYPE` | Error | success must be boolean |
| `MISSING_DATA` | Warning | Success result should have data |
| `MISSING_ERROR` | Error | Failed result must have error |
| `MISSING_CONFIDENCE` | Warning | AI commands should have confidence |
| `INVALID_CONFIDENCE_RANGE` | Error | Confidence must be 0-1 |
| `MISSING_REASONING` | Warning | AI commands should have reasoning |
| `MISSING_SOURCES` | Warning | External data commands should have sources |

### Error Validation

| Rule | Severity | Description |
|------|----------|-------------|
| `INVALID_ERROR_CODE` | Error | Error code must be a string |
| `INVALID_ERROR_MESSAGE` | Error | Error message must be a string |
| `MISSING_SUGGESTION` | Warning | Errors should have suggestions |
| `MISSING_RETRYABLE` | Warning | Errors should indicate if retryable |

## License

MIT
