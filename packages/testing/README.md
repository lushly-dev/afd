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

### Subprocess Scenario Execution

`ScenarioExecutor` can run each step through the installed `afd` CLI. The
server URL and transport are passed to each `afd call` without changing the
developer's saved CLI connection:

```typescript
import { ScenarioExecutor } from '@lushly-dev/afd-testing';

const executor = new ScenarioExecutor({
  cliPath: '/path/to/afd',
  serverUrl: 'http://localhost:3100/mcp',
  transport: 'http',
});
```

The wrapper uses the public CLI contract: positional JSON input plus
`--format json`. Malformed CLI output is reported as a scenario parse error.

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
| `unresolved-prerequisite` | Error | `requires` entry references a command not in the surface |
| `circular-prerequisite` | Error | Circular dependency cycle in the `requires` graph |
| `missing-output-schema` | Info | Command does not declare an `output` schema |
| `missing-context` | Info | Command has no `contexts` array (when server has configured contexts) |

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
  additionalInjectionPatterns?: InjectionPattern[]; // Added to the built-in patterns
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

// Handle JSON-RPC requests programmatically
const server = createMcpTestingServer({
  commandHandler: async (command, input) => registry.execute(command, input),
  cwd: process.cwd(), // tools may only read and write inside this directory
});

// Or serve over stdio: one JSON-RPC message per line on stdin, responses on stdout
await runStdioServer({
  commandHandler: async (command, input) => registry.execute(command, input),
});
```

`commandHandler` runs the commands that `scenario-evaluate` executes. Every path
argument (`directory`, `scenarios`, `output`, and the fixture files that scenarios
name) is resolved against `cwd`; a path that leaves it, including through a
symlinked directory, returns `PATH_OUTSIDE_WORKSPACE`. Tool arguments are checked
against each tool's `inputSchema` (types, enums, required fields, no unknown
fields) and invalid input returns `VALIDATION_ERROR`. Notifications (messages
without an `id`) get no response.

### MCP Tools

All scenario commands are exposed as MCP tools:

| Tool | Description |
|------|-------------|
| `scenario-list` | List and filter scenarios, including files that failed to parse |
| `scenario-evaluate` | Run scenarios and return a report (`failFast`, `timeout`, `concurrency`, `format`, `output`) |
| `scenario-coverage` | Calculate command, error and job coverage |
| `scenario-create` | Generate a scenario file from a template |
| `scenario-suggest` | Heuristic suggestions from keyword and file-name rules (no AI model) |

### Agent Hints

All results include `_agentHints` for AI interpretation:

```typescript
import { enhanceWithAgentHints, scenarioEvaluate } from '@lushly-dev/afd-testing';

const result = await scenarioEvaluate({ handler, directory });
const enhanced = enhanceWithAgentHints('scenario-evaluate', result);

// Result includes:
// _agentHints: {
//   shouldRetry: false,
//   relatedCommands: ['scenario-coverage', 'scenario-suggest'], // tool names only
//   nextSteps: ['Run scenario-coverage to check test coverage'],
//   interpretationConfidence: 0.95
// }
```

### scenario-suggest

Heuristic scenario suggestions based on context. Each strategy applies keyword and
file-name rules; no AI model is called, and each suggestion's `confidence` is the
fixed score of the rule that produced it:

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

`fixture.apply` receives `context.handler`, which returns each command's real
`CommandResult`. Stop at the first failed result: `applyFixture` fails the
fixture on any failed command (naming it and its error code) whether or not the
adapter stops, and it returns the adapter's `warnings` to the caller.

## Scenario Commands (Phase 2)

Batch operations and management commands for JTBD scenarios.

### scenario-list

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

Files that fail to parse are returned in `parseErrors` (and as `PARSE_ERROR`
warnings) instead of being dropped. `recursive: false` searches only the top
directory, `pattern` matches file names (default `*.scenario.yaml`), and `format`
(`'table' | 'json' | 'names'`) adds a `formattedOutput`. `status: 'passed'` or
`'failed'` returns `UNSUPPORTED_FILTER`, because scenario-list keeps no run history.

### scenario-evaluate

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
  failFast: true,  // After the first failing scenario, report the rest as 'skip'
});

// Parallel execution
const parallel = await scenarioEvaluate({
  handler,
  directory: './scenarios',
  concurrency: 4,  // Run 4 scenarios at once
  timeout: 30000,  // 30s per scenario; a timed-out scenario is cancelled and reported as an error
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

Scenario files that fail to parse are reported as `error` scenarios
(`error.type: 'parse_error'`) and make the exit code 1; they are never skipped
silently. The report summary counts `passedScenarios`, `failedScenarios`,
`errorScenarios` and `skippedScenarios`.

### scenario-coverage

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
  output: './coverage.md',  // Optional: also write the report to a file
});
console.log(markdown.data.formattedOutput);
```

### scenario-create

Generate scenario files from templates.

```typescript
import { scenarioCreate, listTemplates } from '@lushly-dev/afd-testing';

// See available templates
const templates = listTemplates();
// [
//   { name: 'blank', description: 'One placeholder step to replace with the command under test' },
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

`name` and `filename` must be plain file names (no path separators); choose the
location with `directory`. `commands: ['todo-create', 'todo-list']` adds one step
per command expecting success. Every generated file is parsed before it is
written, so a template never produces a scenario the runner would reject.

## JTBD Scenario Runner

Test user journeys and jobs-to-be-done through YAML scenario files.

### Scenario Structure

```yaml
# scenarios/create-and-complete-todo.scenario.yaml
name: Create and complete a todo
description: Tests the complete lifecycle of a todo item
job: create-and-complete
tags: [smoke, crud]
timeout: 30000                          # Optional: per-scenario timeout in ms

fixture:
  file: ../fixtures/seeded-todos.json   # Relative to this scenario file

steps:
  - description: Create a new todo
    command: todo-create
    input:
      title: Buy groceries
      priority: high
    expect:
      success: true
      data:
        title: Buy groceries
        completed: false

  - description: Complete the todo
    command: todo-toggle
    input:
      id: ${{ steps[0].data.id }}        # Reference a previous step
    expect:
      success: true
      data:
        completed: true

  - description: Delete the todo
    command: todo-delete
    input:
      id: ${{ steps[0].data.id }}
    expect:
      success: true
```

The parser is strict: an unknown field at any level (a typo such as `fixtures:` or
`date:`) is a parse error rather than something silently ignored. `verify`,
`isolation` and `dependsOn` are not implemented, so they are rejected with a
"not supported" error instead of producing a green run that checked nothing.
Parse errors report the line number and never echo the file's contents.

### Running Scenarios

```typescript
import { InProcessExecutor, parseScenarioFile, TerminalReporter } from '@lushly-dev/afd-testing';

const parsed = await parseScenarioFile('scenarios/create-and-complete-todo.scenario.yaml');
if (!parsed.success) {
  console.error('Parse error:', parsed.error);
  process.exit(1);
}

// The handler receives the run's AbortSignal as an optional third argument
const executor = new InProcessExecutor({
  handler: async (command, input, context) =>
    myCommandRegistry.execute(command, input, { signal: context?.signal }),
});

// Optionally cancel the whole run from outside
const result = await executor.execute(parsed.scenario, { signal: AbortSignal.timeout(60_000) });

new TerminalReporter().reportScenario(result);

// 'pass', 'fail', 'partial', 'error' (fixture, timeout, abort...) or 'skip'
process.exit(result.outcome === 'pass' ? 0 : 1);
```

When a scenario times out or is aborted, the running step is abandoned, the
remaining steps are skipped, and the result has `outcome: 'error'` with
`error: { type: 'timeout' | 'aborted', message }`. `ScenarioExecutor` (which runs
steps through the `afd` CLI) behaves the same way and kills the CLI process.

### Dry Run Mode

Validate scenarios without executing them using `validateScenario()`:

```typescript
import { validateScenario, InProcessExecutor } from '@lushly-dev/afd-testing';

// Structure, step references, expectations and fixture files
const validation = await validateScenario(parsed.scenario, { checkFixtures: true });

if (!validation.valid) {
  console.error('Validation errors:', validation.errors);
  // Example: ["Step 3: Invalid reference to step 4 (can only reference earlier steps)"]
  process.exit(1);
}

// Or use dryRun in the executor: loads the fixture, but runs no command
const executor = new InProcessExecutor({ handler, dryRun: true });
const result = await executor.execute(parsed.scenario);
```

### Error Messages

When assertions fail, detailed messages show expected vs actual values:

```typescript
// result.stepResults[n].error for a failed step:
{
  type: 'expectation_mismatch',
  message: '2 assertions failed:\n  - data.total: expected 99, got 2\n  - data.completed: expected true, got false'
}
```

### Fixtures

Fixtures pre-seed test data before the first step. A fixture is applied through
the adapter for its `app` (see [App Adapters](#app-adapters-phase-4)): a
registered adapter, the built-in `todo` adapter, or the generic adapter for a
fixture with a `setup` or `data` command list. Every command's real
`CommandResult` is checked: the first failed command stops the fixture and the
scenario is reported as an `error` at the fixture step
(`error.type: 'fixture_failed'`, naming the command and its error code), and no
step runs. A fixture for an app with no adapter is an error, not a no-op.

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
fixture:
  file: fixtures/base.json          # Main fixture file, relative to the scenario file
  base: common.json                 # Optional base, relative to the main fixture file
  overrides:                        # Optional inline overrides
    todos:
      - title: Override todo
```

Merge order is base → file → overrides; arrays are replaced, not concatenated.

#### Supported Fixture Structures

**Todo App** (`todo-clear` with `{ all: true }` unless `clearFirst` is `false`, then
`todo-create` per todo and `todo-toggle` for completed ones):
```json
{
  "app": "todo",
  "clearFirst": true,
  "todos": [
    { "title": "string", "priority": "low|medium|high", "completed": false }
  ]
}
```

**Generic (any app):** commands to run in order, `data` first, then `setup`.
```json
{
  "app": "custom",
  "setup": [
    { "command": "custom-init", "input": { "key": "value" } }
  ]
}
```

For any other structure, register an adapter with `registerAdapter()`.

#### Programmatic Fixture Loading

Use `loadFixture()` and `applyFixture()` for direct fixture handling:

```typescript
import { applyFixture, loadFixture } from '@lushly-dev/afd-testing';

const loaded = await loadFixture(
  { file: 'fixtures/test-data.json', base: 'common.json', overrides: { clearFirst: true } },
  { basePath: './scenarios', validate: true }
);
if (!loaded.success) throw new Error(loaded.error);

// The handler must return each command's CommandResult
const result = await applyFixture(loaded.data, (command, input) =>
  myRegistry.execute(command, input)
);

if (!result.success) {
  console.error(result.error); // "Fixture command 'todo-create' failed with VALIDATION_ERROR: ..."
}
console.log(result.appliedCommands, result.warnings);
```

### Step References

Reference data from previous steps using `${{ steps[N].path }}` syntax.

#### Reference Syntax

```yaml
# Exact reference (preserves type)
input:
  id: "${{ steps[0].data.id }}"           # Returns actual type (string, number, etc.)

# Embedded reference (string interpolation; objects are embedded as JSON)
input:
  message: "Created todo ${{ steps[0].data.id }}"  # Returns string

# Nested paths
input:
  name: "${{ steps[0].data.user.profile.name }}"

# Array access
input:
  firstItem: "${{ steps[0].data.items[0].name }}"
```

A reference that does not resolve (a step that has not run, or a path with no
value) fails the step with a `reference_error`; it is never sent as an empty
string or `undefined`.

#### Reference Examples

```yaml
steps:
  - description: Create user
    command: user-create
    input:
      email: test@example.com
    expect: { success: true }
    # Result: { data: { id: "user-123", email: "test@example.com" } }

  - description: Create todo for user
    command: todo-create
    input:
      title: My todo
      userId: ${{ steps[0].data.id }}     # → "user-123"
    expect: { success: true }

  - description: Get todo
    command: todo-get
    input:
      id: ${{ steps[1].data.id }}         # → the new todo's id
    expect: { success: true }
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

#### Matchers

An object whose keys are **all** matcher keys is a matcher; any other object is
a nested set of field assertions. Mixing the two (for example
`{ exists: true, name: Bob }`), a typo next to a matcher (`{ matches: '^A', matchs: 'x' }`)
or a matcher with the wrong type of value is a parse error.

| Matcher | Example | Passes when |
|---------|---------|-------------|
| `equals` | `settings: { equals: { exists: true } }` | Value deep-equals (use it for literal objects that look like matchers) |
| `contains` | `name: { contains: box }` | String contains the substring |
| `matches` | `id: { matches: '^todo-' }` | String matches the regular expression |
| `exists` / `notExists` | `createdAt: { exists: true }` | Value is (not) null or undefined |
| `length` | `items: { length: 3 }` | Array or string has this length |
| `includes` | `tags: { includes: urgent }` | Array contains the value |
| `gte` / `lte` | `count: { gte: 5 }` | Number is at least / at most the value |
| `between` | `score: { between: [1, 10] }` | Number is within the inclusive range |

#### Error Expectations

```yaml
expect:
  success: false
  error:
    code: "NOT_FOUND"            # Exact
    message: "Todo not found"    # Optional: message contains this text
    suggestion:                  # Optional: a string to contain, or a matcher
      contains: todo-list
```

`data` is only checked when `success` is `true`, and `error` only when it is
`false`; the parser rejects the other combinations.

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

A case with `expectError` passes only if the command fails with exactly that
error code; a success does not satisfy it.

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

The mock server follows the real server's remote rules, so scenario tests see production
semantics:

- Only commands with `expose: { mcp: true }` are listed and callable; any other command
  returns `COMMAND_NOT_EXPOSED`. Commands built with `createMockCommand`,
  `createSuccessCommand` and `createFailureCommand` are exposed to MCP.
- `tools/call` with `name: 'afd-batch'` runs a batch: a malformed request is rejected
  before anything runs, `options.timeout` is a deadline at any `parallelism`, and every
  entry is exposure-checked.
- A handler that throws returns `COMMAND_EXECUTION_ERROR` without the exception message
  or stack, unless you pass `createMockServer(commands, { devMode: true })`.

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
| `unresolved-prerequisite` | Error | `requires` entry references a command not in the surface |
| `circular-prerequisite` | Error | Circular dependency cycle in the `requires` graph |
| `missing-output-schema` | Info | Command does not declare an `output` schema |
| `missing-context` | Info | Command has no `contexts` array (when server has configured contexts) |

## License

MIT
