# Phase 05 - Developer Experience

> **Goal**: Create scripts, documentation, and onboarding materials that let developers run any backend+frontend combination in under 5 minutes.

---

## Deliverables

| Deliverable | Purpose |
|-------------|---------|
| Root package.json scripts | One-command startup for any combination |
| READMEs at every level | Self-documenting structure |
| Conformance test runner | Validate any backend |
| Example commands cheatsheet | Quick reference |

---

## Root package.json Scripts

Add these scripts to the root `package.json`:

```json
{
  "scripts": {
    "// Examples": "-------------------------------------------",
    "example:todo:ts": "pnpm --filter @afd/example-todo-ts start",
    "example:todo:ts:dev": "pnpm --filter @afd/example-todo-ts dev",
    "example:todo:py": "cd packages/examples/todo/backends/python && python -m src.server",
    
    "example:todo:vanilla": "pnpm --filter @afd/example-todo-vanilla dev",
    "example:todo:react": "pnpm --filter @afd/example-todo-react dev",
    
    "example:todo:test": "pnpm --filter @afd/example-test-runner test",
    "example:todo:test:ts": "pnpm example:todo:ts & sleep 2 && pnpm example:todo:test",
    "example:todo:test:py": "pnpm example:todo:py & sleep 2 && pnpm example:todo:test"
  }
}
```

---

## Conformance Test Runner

### Package Structure

```
packages/examples/_shared/test-runner/
├── src/
│   ├── index.ts        # Main entry
│   ├── runner.ts       # Test executor
│   ├── loader.ts       # Load test cases from JSON
│   ├── client.ts       # MCP client for testing
│   └── assertions.ts   # Result validation
├── package.json
├── tsconfig.json
└── README.md
```

### package.json

```json
{
  "name": "@afd/example-test-runner",
  "version": "1.0.0",
  "description": "Conformance test runner for AFD examples",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "afd-test": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "node dist/index.js",
    "test:verbose": "node dist/index.js --verbose"
  },
  "dependencies": {
    "chalk": "^5.3.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0"
  }
}
```

### Runner Implementation

```typescript
// src/runner.ts
import { loadTestCases, TestCase } from './loader.js';
import { McpClient } from './client.js';
import { validateResult } from './assertions.js';
import chalk from 'chalk';

interface RunnerOptions {
  backendUrl: string;
  testCasesPath: string;
  verbose: boolean;
}

export async function runTests(options: RunnerOptions): Promise<boolean> {
  const { backendUrl, testCasesPath, verbose } = options;
  
  console.log(chalk.blue(`\nRunning conformance tests against ${backendUrl}\n`));
  
  const client = new McpClient(backendUrl);
  const testCases = await loadTestCases(testCasesPath);
  
  let passed = 0;
  let failed = 0;
  const failures: Array<{ test: TestCase; error: string }> = [];
  
  for (const test of testCases) {
    try {
      // Run setup commands
      for (const setup of test.setup || []) {
        await client.call(setup.command, setup.input);
      }
      
      // Run the test command
      const result = await client.call(test.command, test.input);
      
      // Validate expectations
      const validation = validateResult(result, test.expect);
      
      if (validation.pass) {
        passed++;
        console.log(chalk.green(`  ✓ ${test.name}`));
        if (verbose && test.description) {
          console.log(chalk.gray(`    ${test.description}`));
        }
      } else {
        failed++;
        failures.push({ test, error: validation.message });
        console.log(chalk.red(`  ✗ ${test.name}`));
        console.log(chalk.red(`    ${validation.message}`));
      }
      
      // Run cleanup commands
      for (const cleanup of test.cleanup || []) {
        await client.call(cleanup.command, cleanup.input);
      }
      
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ test, error: message });
      console.log(chalk.red(`  ✗ ${test.name}`));
      console.log(chalk.red(`    Error: ${message}`));
    }
  }
  
  // Summary
  console.log('\n' + chalk.blue('─'.repeat(50)));
  console.log(chalk.bold(`\nResults: ${passed} passed, ${failed} failed\n`));
  
  if (failures.length > 0 && verbose) {
    console.log(chalk.red('\nFailure Details:\n'));
    for (const { test, error } of failures) {
      console.log(chalk.red(`  ${test.name}:`));
      console.log(chalk.gray(`    Command: ${test.command}`));
      console.log(chalk.gray(`    Input: ${JSON.stringify(test.input)}`));
      console.log(chalk.red(`    Error: ${error}\n`));
    }
  }
  
  return failed === 0;
}
```

### Assertions Implementation

```typescript
// src/assertions.ts
interface ValidationResult {
  pass: boolean;
  message: string;
}

export function validateResult(
  actual: unknown,
  expected: Record<string, unknown>
): ValidationResult {
  for (const [path, expectedValue] of Object.entries(expected)) {
    const actualValue = getNestedValue(actual, path);
    
    if (actualValue !== expectedValue) {
      return {
        pass: false,
        message: `Expected ${path} to be ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`,
      };
    }
  }
  
  return { pass: true, message: '' };
}

function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  
  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  
  return current;
}
```

---

## README Templates

### Root Examples README (`packages/examples/README.md`)

```markdown
# AFD Examples

Working examples demonstrating Agent-First Development patterns.

## Available Examples

### Todo App

A simple todo application with multiple backend and frontend implementations.

| Component | Language/Framework | Commands |
|-----------|-------------------|----------|
| [TypeScript Backend](./todo/backends/typescript/) | TypeScript + Zod | 11 |
| [Python Backend](./todo/backends/python/) | Python + Pydantic | 11 |
| [Vanilla Frontend](./todo/frontends/vanilla/) | Vanilla JS | — |
| [React Frontend](./todo/frontends/react/) | React 18 | — |

**Quick Start:**

```bash
# Terminal 1: Start a backend
pnpm example:todo:ts     # TypeScript
# OR
pnpm example:todo:py     # Python

# Terminal 2: Start a frontend
pnpm example:todo:vanilla  # Vanilla JS at :5173
# OR
pnpm example:todo:react    # React at :5174
```

**Run Conformance Tests:**

```bash
# Start a backend, then:
BACKEND_URL=http://localhost:3100 pnpm example:todo:test
```

## Pattern Overview

Each example follows the same structure:

```
example-name/
├── spec/           # API contract (JSON Schema + test cases)
├── backends/       # One folder per language
│   ├── typescript/
│   └── python/
├── frontends/      # One folder per framework
│   ├── vanilla/
│   └── react/
└── README.md
```

This structure demonstrates AFD's core principle: **commands are the application, surfaces are interchangeable**.

## Adding New Implementations

### New Backend

1. Create folder: `example/backends/{language}/`
2. Implement all commands from `spec/commands.schema.json`
3. Expose endpoints: `GET /health`, `POST /message`, `GET /sse`
4. Run conformance tests to verify

### New Frontend

1. Create folder: `example/frontends/{framework}/`
2. Read `BACKEND_URL` from environment (default: `http://localhost:3100`)
3. Call commands via MCP JSON-RPC
4. Display AFD metadata (confidence, reasoning, warnings, etc.)

## Shared Utilities

- **[_shared/test-runner/](./_shared/test-runner/)** — Conformance test runner
```

### Example README (`packages/examples/todo/README.md`)

```markdown
# Todo Example

A simple todo application demonstrating AFD patterns.

## Quick Start

### 1. Start a Backend

Choose one:

```bash
# TypeScript
pnpm example:todo:ts

# Python
pnpm example:todo:py
```

Server runs at `http://localhost:3100`.

### 2. Start a Frontend

Choose one:

```bash
# Vanilla JS (port 5173)
pnpm example:todo:vanilla

# React (port 5174)
pnpm example:todo:react
```

### 3. Mix and Match

Any backend works with any frontend!

| Backend | Frontend | Commands |
|---------|----------|----------|
| TypeScript | Vanilla | `pnpm example:todo:ts` + `pnpm example:todo:vanilla` |
| TypeScript | React | `pnpm example:todo:ts` + `pnpm example:todo:react` |
| Python | Vanilla | `pnpm example:todo:py` + `pnpm example:todo:vanilla` |
| Python | React | `pnpm example:todo:py` + `pnpm example:todo:react` |

## API Contract

See [spec/README.md](./spec/README.md) for the full API specification.

### Commands

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
| `todo.createBatch` | mutation | Create multiple todos |
| `todo.deleteBatch` | mutation | Delete multiple todos |
| `todo.toggleBatch` | mutation | Toggle multiple todos |

## Conformance Testing

Verify a backend implements the spec correctly:

```bash
# Start your backend, then:
BACKEND_URL=http://localhost:3100 pnpm example:todo:test
```

## AFD Patterns Demonstrated

### Command-First Development

Every feature is a command before it's a UI element.

### CLI Validation

Test commands without any frontend:

```bash
afd connect http://localhost:3100/sse
afd call todo.create '{"title": "Test"}'
afd call todo.list '{}'
```

### UX-Enabling Schemas

Commands return metadata that enables good UI:

- `confidence` — How confident is this result?
- `reasoning` — Why did this happen?
- `warnings` — What should the user know?
- `alternatives` — What other options exist?
- `error.suggestion` — How to recover from errors?

### Dual Interface

Same commands work via CLI, MCP, and UI.
```

### Spec README (`packages/examples/todo/spec/README.md`)

```markdown
# Todo API Specification

This document defines the contract that all todo backends must implement.

## Endpoints

All backends must expose:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check, returns `{ "status": "ok", "name": "...", "version": "..." }` |
| `/message` | POST | MCP JSON-RPC endpoint |
| `/sse` | GET | SSE transport for MCP |

## Commands

See [commands.schema.json](./commands.schema.json) for the complete JSON Schema.

## Test Cases

See [test-cases.json](./test-cases.json) for conformance tests.

Run tests:

```bash
BACKEND_URL=http://localhost:3100 pnpm example:todo:test
```
```

---

## Commands Cheatsheet

Create a quick reference file: `packages/examples/todo/COMMANDS.md`

```markdown
# Todo Commands Cheatsheet

Quick reference for all todo commands.

## Create

```bash
afd call todo.create '{"title": "Buy groceries", "priority": "high"}'
```

## List

```bash
# All todos
afd call todo.list '{}'

# Filtered
afd call todo.list '{"completed": false, "priority": "high"}'

# Paginated
afd call todo.list '{"limit": 10, "offset": 0}'
```

## Get

```bash
afd call todo.get '{"id": "todo-123"}'
```

## Update

```bash
afd call todo.update '{"id": "todo-123", "title": "New title", "priority": "low"}'
```

## Toggle

```bash
afd call todo.toggle '{"id": "todo-123"}'
```

## Delete

```bash
afd call todo.delete '{"id": "todo-123"}'
```

## Clear Completed

```bash
afd call todo.clear '{}'
```

## Stats

```bash
afd call todo.stats '{}'
```

## Batch Operations

```bash
# Create multiple
afd call todo.createBatch '{"todos": [{"title": "Task 1"}, {"title": "Task 2"}]}'

# Delete multiple
afd call todo.deleteBatch '{"ids": ["todo-1", "todo-2"]}'

# Toggle multiple
afd call todo.toggleBatch '{"ids": ["todo-1", "todo-2"]}'

# Set all to complete
afd call todo.toggleBatch '{"ids": ["todo-1", "todo-2"], "completed": true}'
```
```

---

## Tasks

### Scripts
- [ ] Add example scripts to root package.json
- [ ] Create convenience scripts for common combinations
- [ ] Add test scripts that start backend automatically

### Test Runner
- [ ] Create test runner package structure
- [ ] Implement test case loader
- [ ] Implement MCP client for testing
- [ ] Implement result assertions
- [ ] Add verbose mode with failure details

### Documentation
- [ ] Create root examples README
- [ ] Create todo example README
- [ ] Create spec README
- [ ] Create commands cheatsheet
- [ ] Create backend README template
- [ ] Create frontend README template
- [ ] Update main AFD README with examples section

### Onboarding
- [ ] Verify 5-minute onboarding flow works
- [ ] Add troubleshooting section to READMEs
- [ ] Create "Adding a New Backend" guide
- [ ] Create "Adding a New Frontend" guide

---

## Validation Criteria

Phase 05 is complete when:

1. `pnpm example:todo:ts` starts TypeScript backend
2. `pnpm example:todo:py` starts Python backend
3. `pnpm example:todo:vanilla` starts Vanilla frontend
4. `pnpm example:todo:react` starts React frontend
5. `pnpm example:todo:test` runs conformance tests
6. New developer can run an example in < 5 minutes following README
7. All READMEs are complete and accurate

---

## Summary

After completing all phases, the AFD examples will demonstrate:

1. **Multiple backends** (TypeScript, Python) implementing the same API
2. **Multiple frontends** (Vanilla JS, React) consuming any backend
3. **Conformance tests** validating all implementations
4. **Clear documentation** enabling easy onboarding and extension

This proves AFD's core promise: **commands ARE the application, surfaces are interchangeable**.
