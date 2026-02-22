# @lushly-dev/afd-testing

Testing utilities for Agent-First Development.

## Installation

```bash
npm install @lushly-dev/afd-testing --save-dev
# or
pnpm add @lushly-dev/afd-testing -D
```

## Overview

This package provides utilities for testing AFD commands:

- **Validators**: Validate command results and definitions
- **Surface Validation**: Cross-command semantic quality analysis (similarity, schema overlap, naming, injection detection)
- **Test Helpers**: Easy command testing with validation
- **Assertions**: Custom assertions for command results
- **Mock Server**: In-memory MCP server for testing
- **JTBD Scenario Runner**: Jobs-to-be-Done scenario testing with YAML files
- **Fixtures**: Pre-seeded test data with inheritance and overrides
- **Step References**: Dynamic references between scenario steps
- **Scenario Commands**: List, evaluate, coverage, create, and suggest scenarios
- **MCP Agent Integration**: Expose commands as MCP tools with agent hints

## Surface Validation (Semantic Quality)

Cross-command analysis that detects semantic collisions, naming ambiguities, schema overlaps, and prompt injection risks. Designed for command sets of 50+ where agents struggle to pick the right tool.

### Basic Usage

```typescript
import { validateCommandSurface } from '@lushly-dev/afd-testing';

const result = validateCommandSurface(commands, {
  similarityThreshold: 0.7,
  schemaOverlapThreshold: 0.8,
  strict: false,
});

console.log(result.valid);          // true if no errors (or no errors+warnings in strict mode)
console.log(result.summary);        // { commandCount, errorCount, warningCount, infoCount, ... }
console.log(result.findings);       // SurfaceFinding[] with rule, severity, message, suggestion
```

### Input Types

`validateCommandSurface()` accepts both `ZodCommandDefinition[]` (from `@lushly-dev/afd-server`) and `CommandDefinition[]` (from `@lushly-dev/afd-core`). Input is auto-detected via duck-typing.

### Validation Rules

| Rule | Severity | Description |
|------|----------|-------------|
| `similar-descriptions` | Warning | Command pairs with highly similar descriptions (cosine similarity) |
| `schema-overlap` | Warning | Command pairs sharing a high percentage of input fields |
| `naming-convention` | Error | Command names not matching kebab-case `domain-action` pattern |
| `naming-collision` | Error | Command names that collide when separators are normalized |
| `missing-category` | Info | Commands without a category field |
| `description-injection` | Error | Descriptions containing prompt injection patterns |
| `description-quality` | Warning | Descriptions that are too short or missing action verbs |
| `orphaned-category` | Info | Categories containing only one command |
| `schema-complexity` | Warning/Info | Input schemas too complex for agents (unions, nesting, constraints) |

### Options

```typescript
interface SurfaceValidationOptions {
  similarityThreshold?: number;        // Default: 0.7 (70% similarity triggers warning)
  schemaOverlapThreshold?: number;     // Default: 0.8 (80% field overlap triggers warning)
  detectInjection?: boolean;           // Default: true
  checkDescriptionQuality?: boolean;   // Default: true
  minDescriptionLength?: number;       // Default: 20
  enforceNaming?: boolean;             // Default: true
  namingPattern?: RegExp;              // Default: /^[a-z][a-z0-9]*-[a-z][a-z0-9-]*$/
  skipCategories?: string[];           // Categories to exclude from analysis
  strict?: boolean;                    // Treat warnings as errors
  suppressions?: string[];             // Suppress specific findings
  additionalInjectionPatterns?: InjectionPattern[];
  checkSchemaComplexity?: boolean;    // Default: true
  schemaComplexityThreshold?: number; // Default: 13 (warning threshold)
}
```

### Suppressions

Suppress findings at the rule level or for specific command pairs:

```typescript
const result = validateCommandSurface(commands, {
  suppressions: [
    'missing-category',                        // Suppress all missing-category findings
    'schema-complexity:auth-sign-in',           // Suppress for a single command
    'similar-descriptions:user-get:user-fetch', // Suppress only this pair (order-independent)
  ],
});
```

### CLI Integration

```bash
# Run surface validation against a connected MCP server
afd validate --surface

# With custom threshold
afd validate --surface --similarity-threshold 0.8

# Skip categories and suppress rules
afd validate --surface --skip-category internal --suppress missing-category

# Strict mode (warnings = errors)
afd validate --surface --strict --verbose
```

## Agent Integration (Phase 3)

MCP server and tools for AI agent integration.

### MCP Server

Start an MCP server exposing all scenario commands:

```typescript
import { createMcpTestingServer, runStdioServer } from '@lushly-dev/afd-testing';

// Create server with command handler
const server = createMcpTestingServer({
  handler: async (command, input) => registry.execute(command, input),
});

// Start with stdio transport
await runStdioServer(server);
```

### MCP Tools

All scenario commands are exposed as MCP tools:

| Tool | Description |
|------|-------------|
| `scenario_list` | List and filter scenarios |
| `scenario_evaluate` | Run scenarios with reporting |
| `scenario_coverage` | Calculate coverage metrics |
| `scenario_create` | Generate scenario files |
| `scenario_suggest` | AI-powered suggestions |

### Agent Hints

All results include `_agentHints` for AI interpretation:

```typescript
import { enhanceWithAgentHints } from '@lushly-dev/afd-testing';

const result = await scenarioEvaluate({ handler, directory });
const enhanced = enhanceWithAgentHints(result, 'scenario.evaluate');

// Result includes:
// _agentHints: {
//   shouldRetry: false,
//   relatedCommands: ['scenario.suggest --context failed'],
//   nextSteps: ['Review failed scenarios', 'Run with --verbose'],
//   interpretationConfidence: 0.95
// }
```

### scenario.suggest

AI-powered scenario suggestions based on context:

```typescript
import { scenarioSuggest } from '@lushly-dev/afd-testing';

// Suggest based on changed files
const changed = await scenarioSuggest({
  context: 'changed-files',
  files: ['src/commands/todo/create.ts'],
});

// Suggest for uncovered commands
const uncovered = await scenarioSuggest({
  context: 'uncovered',
  directory: './scenarios',
  knownCommands: ['todo-create', 'todo-list', 'todo-delete'],
});

// Suggest for failed scenarios
const failed = await scenarioSuggest({
  context: 'failed',
  directory: './scenarios',
});

// Suggest test variations for a command
const command = await scenarioSuggest({
  context: 'command',
  command: 'todo-create',
  includeSkeleton: true,  // Include generated scenario YAML
});

// Natural language query
const natural = await scenarioSuggest({
  context: 'natural',
  query: 'error handling for invalid input',
});

for (const s of changed.data.suggestions) {
  console.log(`${s.name} (${s.confidence}): ${s.reason}`);
}
```

## App Adapters (Phase 4)

Adapters enable the framework to work with different AFD applications.

### Adapter Interface

Each app provides an adapter implementing:

```typescript
interface AppAdapter {
  name: string;          // e.g., 'todo', 'violet', 'noisett'
  version: string;
  cli: CliConfig;        // CLI command configuration
  fixture: FixtureConfig; // How to apply/reset fixtures
  commands: CommandsConfig; // Available commands
  errors: ErrorsConfig;   // Known error codes
  jobs: JobsConfig;       // User goals/jobs
}
```

### Using the Registry

```typescript
import {
  registerAdapter,
  detectAdapter,
  todoAdapter,
  createGenericAdapter,
} from '@lushly-dev/afd-testing';

// Register built-in adapter
registerAdapter(todoAdapter);

// Create and register custom adapter
const myAdapter = createGenericAdapter('myapp', {
  commands: ['myapp-create', 'myapp-list'],
  errors: ['NOT_FOUND', 'VALIDATION_ERROR'],
});
registerAdapter(myAdapter);

// Auto-detect adapter from fixture
const fixture = { app: 'todo', todos: [] };
const adapter = detectAdapter(fixture);
console.log(adapter?.name); // 'todo'
```

### Built-in Adapters

| Adapter | App | Description |
|---------|-----|-------------|
| `todoAdapter` | Todo | The AFD Todo example app |
| `genericAdapter` | Generic | Fallback for unknown apps |

### Creating a Custom Adapter

```typescript
import { createGenericAdapter, type AppAdapter } from '@lushly-dev/afd-testing';

// Simple approach: use factory
const myAdapter = createGenericAdapter('myapp', {
  version: '1.0.0',
  cliCommand: 'myapp-cli',
  commands: ['myapp-create', 'myapp-list', 'myapp-delete'],
  errors: ['NOT_FOUND', 'INVALID_INPUT'],
  jobs: ['manage-items', 'cleanup'],
});

// Advanced: full custom adapter
const customAdapter: AppAdapter = {
  name: 'custom',
  version: '1.0.0',
  cli: {
    command: 'custom-cli',
    inputFormat: 'json-arg',
    outputFormat: 'json',
  },
  fixture: {
    async apply(fixture, context) {
      // Custom fixture application logic
      return { appliedCommands: [] };
    },
    async reset(context) {
      // Reset app state
    },
  },
  commands: {
    list: () => ['custom-create', 'custom-delete'],
  },
  errors: {
    list: () => ['ERROR_ONE', 'ERROR_TWO'],
  },
  jobs: {
    list: () => ['job-one'],
  },
};
```

## Scenario Commands (Phase 2)

Batch operations and management commands for JTBD scenarios.

### scenario.list

List and filter scenarios in a directory.

```typescript
import { scenarioList } from '@lushly-dev/afd-testing';

// List all scenarios
const result = await scenarioList({ directory: './scenarios' });

// Filter by job
const filtered = await scenarioList({
  directory: './scenarios',
  job: 'todo-management',
});

// Filter by tags
const tagged = await scenarioList({
  directory: './scenarios',
  tags: ['smoke', 'p0'],
});

// Search in scenario names
const searched = await scenarioList({
  directory: './scenarios',
  search: 'create',
});

// Sort results
const sorted = await scenarioList({
  directory: './scenarios',
  sortBy: 'stepCount',
  sortOrder: 'desc',
});

console.log(`Found ${result.data.total} scenarios`);
console.log(`Filtered: ${result.data.filtered}`);
for (const s of result.data.scenarios) {
  console.log(`  ${s.name}: ${s.stepCount} steps [${s.tags.join(', ')}]`);
}
```

### scenario.evaluate

Batch execute scenarios with parallel support and multiple output formats.

```typescript
import { scenarioEvaluate } from '@lushly-dev/afd-testing';

// Basic evaluation
const result = await scenarioEvaluate({
  handler: async (command, input) => registry.execute(command, input),
  directory: './scenarios',
});

console.log(`Exit code: ${result.data.exitCode}`);
console.log(`Passed: ${result.data.report.summary.passedScenarios}`);

// With filtering and fail-fast
const filtered = await scenarioEvaluate({
  handler,
  directory: './scenarios',
  job: 'todo-management',
  tags: ['smoke'],
  failFast: true,  // Stop on first failure
});

// Parallel execution
const parallel = await scenarioEvaluate({
  handler,
  directory: './scenarios',
  concurrency: 4,  // Run 4 scenarios at once
  timeout: 30000,  // 30s per scenario
});

// Output formats for CI
const junit = await scenarioEvaluate({
  handler,
  directory: './scenarios',
  format: 'junit',
  output: './test-results.xml',  // Write to file
});

// Available formats: 'terminal', 'json', 'junit', 'markdown'
```

### scenario.coverage

Calculate coverage metrics across commands, errors, and jobs.

```typescript
import { scenarioCoverage } from '@lushly-dev/afd-testing';

// Basic coverage
const result = await scenarioCoverage({
  directory: './scenarios',
});

console.log(`Commands tested: ${result.data.summary.commands.tested}`);
console.log(`Jobs covered: ${result.data.summary.jobs.count}`);

// Coverage against known commands
const detailed = await scenarioCoverage({
  directory: './scenarios',
  knownCommands: ['todo-create', 'todo-list', 'todo-get', 'todo-update', 'todo-delete'],
  knownErrors: ['NOT_FOUND', 'VALIDATION_ERROR', 'UNAUTHORIZED'],
});

console.log(`Command coverage: ${detailed.data.summary.commands.coverage}%`);
console.log(`Untested commands:`, detailed.data.summary.commands.untested);

// Per-command details
for (const cmd of detailed.data.commandCoverage) {
  console.log(`${cmd.command}: ${cmd.stepCount} steps, error tests: ${cmd.hasErrorTests}`);
}

// Format for reporting
const markdown = await scenarioCoverage({
  directory: './scenarios',
  format: 'markdown',
});
console.log(markdown.data.formattedOutput);
```

### scenario.create

Generate scenario files from templates.

```typescript
import { scenarioCreate, listTemplates } from '@lushly-dev/afd-testing';

// See available templates
const templates = listTemplates();
// [
//   { name: 'blank', description: 'Empty scenario with just job and description' },
//   { name: 'crud', description: 'Create, Read, Update, Delete test pattern' },
//   { name: 'error-handling', description: 'Tests for error cases and validation' },
//   { name: 'workflow', description: 'Multi-step workflow with state verification' },
// ]

// Create blank scenario
const result = await scenarioCreate({
  name: 'my-new-scenario',
  job: 'My user job',
  description: 'Tests the my user job workflow',
  directory: './scenarios',
  tags: ['smoke', 'p0'],
});

// Create from CRUD template
const crud = await scenarioCreate({
  name: 'todo-crud',
  job: 'Manage todo items',
  directory: './scenarios',
  template: 'crud',  // Generates create/read/update/delete/verify steps
});

// Create error handling tests
const errors = await scenarioCreate({
  name: 'todo-errors',
  job: 'Handle todo errors',
  directory: './scenarios',
  template: 'error-handling',  // Generates validation and not-found tests
});

// Create with custom steps
const custom = await scenarioCreate({
  name: 'custom-workflow',
  job: 'Custom workflow',
  directory: './scenarios',
  steps: [
    { description: 'Step 1', command: 'action-first', expectSuccess: true },
    { description: 'Step 2', command: 'action-second', expectData: { status: 'done' } },
  ],
});
```

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
    command: todo-create
    input:
      title: "Buy groceries"
      priority: "high"
    expect:
      success: true
      data:
        title: "Buy groceries"
        completed: false

  - name: "Complete the todo"
    command: todo-toggle
    input:
      id: "${{ steps[0].data.id }}"  # Reference previous step
    expect:
      success: true
      data:
        completed: true

  - name: "Delete the todo"
    command: todo-delete
    input:
      id: "${{ steps[0].data.id }}"
    expect:
      success: true
```

### Running Scenarios

```typescript
import { parseScenarioString, InProcessExecutor, TerminalReporter } from '@lushly-dev/afd-testing';
import { readFile } from 'node:fs/promises';

// Parse scenario file
const yaml = await readFile('scenarios/my-scenario.yaml', 'utf-8');
const parseResult = parseScenarioString(yaml);

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
const reporter = new TerminalReporter();
reporter.report([result]);

// Exit with appropriate code
process.exit(result.status === 'passed' ? 0 : 1);
```

### Dry Run Mode

Validate scenarios without executing them using `validateScenario()`:

```typescript
import { parseScenarioString, validateScenario, InProcessExecutor } from '@lushly-dev/afd-testing';

// Validate scenario structure before execution
const validation = validateScenario(parseResult.scenario, {
  availableCommands: ['todo-create', 'todo-get', 'todo-list', 'todo-toggle'],
  fixtures: fixtureIndex,  // Optional: Map<string, FixtureData>
});

if (!validation.valid) {
  console.error('Validation errors:', validation.errors);
  // Example: ["Unknown command 'todo-unknown' in step 3"]
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
    { "command": "custom-init", "input": { "key": "value" } }
  ]
}
```

#### Programmatic Fixture Loading

Use `loadFixture()` and `applyFixture()` for direct fixture handling:

```typescript
import { loadFixture, applyFixture, AppliedCommand } from '@lushly-dev/afd-testing';

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
//   { command: 'store-clear', input: {} },
//   { command: 'todo-create', input: { title: 'Test', priority: 'high' } }
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
    command: user-create
    input:
      email: "test@example.com"
    # Result: { data: { id: "user-123", email: "test@example.com" } }

  - name: "Create todo for user"
    command: todo-create
    input:
      title: "My todo"
      userId: "${{ steps[0].data.id }}"     # → "user-123"
    # Result: { data: { id: "todo-456" } }

  - name: "Get todo"
    command: todo-get
    input:
      id: "${{ steps[1].data.id }}"         # → "todo-456"

  - name: "Verify ownership"
    command: todo-verify
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
import { testCommand, assertSuccess, assertHasReasoning } from '@lushly-dev/afd-testing';
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
import { validateCommandDefinition, validateResult } from '@lushly-dev/afd-testing';

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
import { testCommandMultiple } from '@lushly-dev/afd-testing';

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
} from '@lushly-dev/afd-testing';

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
import { createMockServer, createMockCommand } from '@lushly-dev/afd-testing';

// Create server with mock commands
const server = createMockServer([
  createMockCommand('document-get', (input) => ({
    id: input.id,
    title: 'Test Document',
  })),
]);

// Add more commands
server.register(createMockCommand('document-create', (input) => ({
  id: 'new-id',
  title: input.title,
})));

// Handle requests
const response = await server.handleRequest({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: {
    name: 'document-get',
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
} from '@lushly-dev/afd-testing';

// Simple mock that returns static data
const getUser = createSuccessCommand('user-get', {
  id: 'user-1',
  name: 'Test User',
});

// Mock with dynamic behavior
const createDoc = createMockCommand('document-create', (input) => ({
  id: `doc-${Date.now()}`,
  title: input.title,
  createdAt: new Date().toISOString(),
}));

// Mock that always fails
const deleteProtected = createFailureCommand('protected-delete', {
  code: 'FORBIDDEN',
  message: 'Cannot delete protected resource',
});

// Create registry with all mocks
const registry = createTestRegistry([getUser, createDoc, deleteProtected]);

// Execute commands
const result = await registry.execute('document-create', { title: 'New Doc' });
```

## Validation Rules

### Command Definition Validation

| Rule | Severity | Description |
|------|----------|-------------|
| `MISSING_NAME` | Error | Command must have a name |
| `INVALID_NAME_FORMAT` | Warning | Name should use kebab-case (`domain-action`) |
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

### Surface Validation Rules

| Rule | Severity | Description |
|------|----------|-------------|
| `similar-descriptions` | Warning | Command pair descriptions exceed similarity threshold |
| `schema-overlap` | Warning | Command pair input schemas share too many fields |
| `naming-convention` | Error | Command name doesn't match naming pattern |
| `naming-collision` | Error | Command names collide when separators are removed |
| `missing-category` | Info | Command has no category assigned |
| `description-injection` | Error | Description contains prompt injection patterns |
| `description-quality` | Warning | Description too short or missing action verb |
| `orphaned-category` | Info | Category contains only one command |
| `schema-complexity` | Warning/Info | Input schema too complex for agents (scored by fields, depth, unions, constraints) |

## License

MIT
