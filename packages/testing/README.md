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
- **JTBD Scenario Runner**: Jobs-to-be-Done scenario testing with YAML files
- **Fixtures**: Pre-seeded test data with inheritance and overrides
- **Step References**: Dynamic references between scenario steps

## JTBD Scenario Runner

Test user journeys and jobs-to-be-done through YAML scenario files.

### Scenario Structure

```yaml
# scenarios/create-and-complete-todo.scenario.yaml
scenario:
  name: "Create and complete a todo"
  description: "Tests the complete lifecycle of a todo item"
  tags: ["smoke", "crud"]

setup:
  fixture:
    file: "fixtures/seeded-todos.json"

steps:
  - name: "Create a new todo"
    command: todo.create
    input:
      title: "Buy groceries"
      priority: "high"
    expect:
      success: true
      data:
        title: "Buy groceries"
        completed: false

  - name: "Complete the todo"
    command: todo.toggle
    input:
      id: "${{ steps[0].data.id }}"  # Reference previous step
    expect:
      success: true
      data:
        completed: true

  - name: "Delete the todo"
    command: todo.delete
    input:
      id: "${{ steps[0].data.id }}"
    expect:
      success: true
```

### Running Scenarios

```typescript
import { parseScenario, InProcessExecutor, ConsoleReporter } from '@afd/testing';
import { readFile } from 'node:fs/promises';

// Parse scenario file
const yaml = await readFile('scenarios/my-scenario.yaml', 'utf-8');
const parseResult = parseScenario(yaml);

if (!parseResult.success) {
  console.error('Parse error:', parseResult.error);
  process.exit(1);
}

// Create executor with your command handler
const executor = new InProcessExecutor(
  async (command, input) => {
    // Execute command against your system
    return myCommandRegistry.execute(command, input);
  },
  { basePath: './scenarios' }
);

// Run scenario
const result = await executor.run(parseResult.scenario);

// Report results
const reporter = new ConsoleReporter();
reporter.report([result]);

// Exit with appropriate code
process.exit(result.status === 'passed' ? 0 : 1);
```

### Dry Run Mode

Validate scenarios without executing them using `validateScenario()`:

```typescript
import { parseScenario, validateScenario, InProcessExecutor } from '@afd/testing';

// Validate scenario structure before execution
const validation = validateScenario(parseResult.scenario, {
  availableCommands: ['todo.create', 'todo.get', 'todo.list', 'todo.toggle'],
  fixtures: fixtureIndex,  // Optional: Map<string, FixtureData>
});

if (!validation.valid) {
  console.error('Validation errors:', validation.errors);
  // Example: ["Unknown command 'todo.unknown' in step 3"]
  process.exit(1);
}

// Or use dryRun option in executor
const executor = new InProcessExecutor(handler, {
  basePath: './scenarios',
  dryRun: true,  // Validates but doesn't execute
});

const result = await executor.run(scenario);
// result.steps will have status 'skipped' with reason
```

### Error Messages

When assertions fail, detailed messages show expected vs actual values:

```typescript
// Example assertion failure output:
// "2 assertions failed: data.total: expected 99, got 2; data.completed: expected true, got false"

// In scenario results:
{
  name: "Check stats",
  status: "failed",
  error: "2 assertions failed: data.total: expected 99, got 2; data.completed: expected true, got false"
}
```

### Fixtures

Fixtures pre-seed test data before scenario execution.

#### JSON Fixture File

```json
// fixtures/seeded-todos.json
{
  "app": "todo",
  "clearFirst": true,
  "todos": [
    { "title": "Existing todo 1", "priority": "high" },
    { "title": "Existing todo 2", "priority": "low", "completed": true }
  ]
}
```

#### Using Fixtures in Scenarios

```yaml
setup:
  fixture:
    file: "fixtures/base.json"        # Main fixture file
    base: "fixtures/common.json"       # Optional base (inherited)
    overrides:                         # Optional inline overrides
      todos:
        - title: "Override todo"
```

#### Fixture Inheritance

```yaml
# Override priority of merge: base → file → overrides
setup:
  fixture:
    base: "common-setup.json"          # Applied first
    file: "specific-setup.json"        # Merged on top
    overrides:                         # Highest priority
      clearFirst: false
```

#### Supported Fixture Structures

**Todo App:**
```json
{
  "app": "todo",
  "clearFirst": true,
  "todos": [
    { "title": "string", "priority": "low|medium|high", "completed": false }
  ]
}
```

**Violet Design System:**
```json
{
  "app": "violet",
  "nodes": [
    { "id": "string", "name": "string", "type": "root|product", "parentId": "string" }
  ],
  "operations": [
    { "type": "add|override|subtract", "nodeId": "string", "token": "string", "value": "any" }
  ],
  "constraints": [
    { "nodeId": "string", "id": "string", "type": "enum|range", "tokens": ["string"] }
  ]
}
```

**Generic (Custom Apps):**
```json
{
  "app": "custom",
  "setup": [
    { "command": "custom.init", "input": { "key": "value" } }
  ]
}
```

#### Programmatic Fixture Loading

Use `loadFixture()` and `applyFixture()` for direct fixture handling:

```typescript
import { loadFixture, applyFixture, AppliedCommand } from '@afd/testing';

// Load fixture from file
const fixture = await loadFixture('fixtures/test-data.json', {
  basePath: './scenarios',
  baseFile: 'fixtures/common.json',  // Optional inheritance
  overrides: { clearFirst: true },    // Optional inline overrides
});

// Apply fixture to your system
const result = await applyFixture(fixture, async (command, input) => {
  return myRegistry.execute(command, input);
});

// Result includes applied commands with full details
console.log(result.appliedCommands);
// [
//   { command: 'store.clear', input: {} },
//   { command: 'todo.create', input: { title: 'Test', priority: 'high' } }
// ]
console.log(`Applied ${result.appliedCommands.length} commands`);
```

### Step References

Reference data from previous steps using `${{ steps[N].path }}` syntax.

#### Reference Syntax

```yaml
# Exact reference (preserves type)
input:
  id: "${{ steps[0].data.id }}"           # Returns actual type (string, number, etc.)

# Embedded reference (string interpolation)  
input:
  message: "Created todo ${{ steps[0].data.id }}"  # Returns string

# Nested paths
input:
  name: "${{ steps[0].data.user.profile.name }}"

# Array access
input:
  firstItem: "${{ steps[0].data.items[0].name }}"
```

#### Reference Examples

```yaml
steps:
  - name: "Create user"
    command: user.create
    input:
      email: "test@example.com"
    # Result: { data: { id: "user-123", email: "test@example.com" } }

  - name: "Create todo for user"
    command: todo.create
    input:
      title: "My todo"
      userId: "${{ steps[0].data.id }}"     # → "user-123"
    # Result: { data: { id: "todo-456" } }

  - name: "Get todo"
    command: todo.get
    input:
      id: "${{ steps[1].data.id }}"         # → "todo-456"

  - name: "Verify ownership"
    command: todo.verify
    input:
      todoId: "${{ steps[1].data.id }}"     # → "todo-456"
      userId: "${{ steps[0].data.id }}"     # → "user-123"
```

### Expectations

#### Success Expectations

```yaml
expect:
  success: true
  data:
    title: "Expected title"
    completed: false
```

#### Partial Data Matching

```yaml
expect:
  success: true
  data:
    title: "Expected title"     # Only checks title
    # Other fields ignored
```

#### Error Expectations

```yaml
expect:
  success: false
  error:
    code: "NOT_FOUND"
    message: "Todo not found"   # Optional
```

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
