# JTBD Scenario Testing

Test user journeys through YAML scenario files with fixtures and step references.

## Scenario File Structure

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
  - description: Create todo
    command: todo-create
    input:
      title: Buy groceries
    expect:
      success: true
      data:
        title: Buy groceries

  - description: Complete todo
    command: todo-toggle
    input:
      id: ${{ steps[0].data.id }}        # Reference a previous step
    expect:
      success: true
      data:
        completed: true
```

The parser is strict. An unknown field at any level is a parse error, and
`verify`, `isolation` and `dependsOn` are rejected as not supported. A matcher
object (`{ exists: true }`, `{ gte: 1 }`, `{ length: 3 }`) may contain only
matcher keys; use `{ equals: {...} }` to compare a literal object.

## Step References

Reference data from previous steps: `${{ steps[N].data.path }}`. A reference
that does not resolve fails the step with `reference_error`.

```yaml
steps:
  - description: Create
    command: todo-create
    input: { title: Test }
    # Result: { data: { id: "todo-123" } }

  - description: Update
    command: todo-update
    input:
      id: ${{ steps[0].data.id }}    # → "todo-123"
      title: Updated
```

## Fixtures

Pre-seed test data before scenario execution. The first failed fixture command
fails the scenario at the fixture step (`error.type: 'fixture_failed'`), and no
step runs.

```json
// fixtures/seeded-todos.json
{
  "app": "todo",
  "clearFirst": true,
  "todos": [
    { "title": "Existing todo", "priority": "high" }
  ]
}
```

## Running Scenarios

```bash
# Cross-backend conformance suite for the todo example
cd packages/examples/todo
pnpm test:conformance:ts   # also :py and :rs
```

```typescript
// Programmatically
import { InProcessExecutor, parseScenarioFile } from '@lushly-dev/afd-testing';

const parsed = await parseScenarioFile('scenarios/create-and-complete-todo.scenario.yaml');
if (!parsed.success) throw new Error(parsed.error);

const executor = new InProcessExecutor({ handler: myCommandHandler });
const result = await executor.execute(parsed.scenario);
// result.outcome: 'pass' | 'fail' | 'partial' | 'error' | 'skip'
```

## Dry Run Validation

Validate scenarios without executing:

```typescript
import { validateScenario } from '@lushly-dev/afd-testing';

// Structure, step references, expectations and fixture files
const validation = await validateScenario(parsed.scenario, { checkFixtures: true });

if (!validation.valid) {
  console.error(validation.errors);
  // ["Step 3: Invalid reference to step 4 (can only reference earlier steps)"]
}
```

## Scenario Commands

```typescript
import {
  scenarioList,
  scenarioEvaluate,
  scenarioCoverage,
} from '@lushly-dev/afd-testing';

// List scenarios
const list = await scenarioList({
  directory: './scenarios',
  tags: ['smoke'],
});

// Batch evaluate
const result = await scenarioEvaluate({
  handler: myCommandHandler,
  directory: './scenarios',
  concurrency: 4,
  format: 'junit',
  output: './test-results.xml',
});

// Check coverage
const coverage = await scenarioCoverage({
  directory: './scenarios',
  knownCommands: ['todo-create', 'todo-list', 'todo-delete'],
});
console.log(`Coverage: ${coverage.data.summary.commands.coverage}%`);
```
