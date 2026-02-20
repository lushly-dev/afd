# JTBD Scenario Testing

Test user journeys through YAML scenario files with fixtures and step references.

## Scenario File Structure

```yaml
# scenarios/create-and-complete-todo.scenario.yaml
scenario:
  name: "Create and complete a todo"
  tags: ["smoke", "crud"]

setup:
  fixture:
    file: "fixtures/seeded-todos.json"

steps:
  - name: "Create todo"
    command: todo.create
    input:
      title: "Buy groceries"
    expect:
      success: true
      data:
        title: "Buy groceries"

  - name: "Complete todo"
    command: todo.toggle
    input:
      id: "${{ steps[0].data.id }}"  # Reference previous step
    expect:
      success: true
```

## Step References

Reference data from previous steps: `${{ steps[N].data.path }}`

```yaml
steps:
  - name: "Create"
    command: todo.create
    input: { title: "Test" }
    # Result: { data: { id: "todo-123" } }

  - name: "Update"
    command: todo.update
    input:
      id: "${{ steps[0].data.id }}"    # → "todo-123"
      title: "Updated"
```

## Fixtures

Pre-seed test data before scenario execution:

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
# Via conformance runner
cd packages/examples/todo
npx tsx dx/run-conformance.ts ts  # Test TypeScript backend
npx tsx dx/run-conformance.ts py  # Test Python backend
```

```typescript
// Programmatically
import { parseScenario, InProcessExecutor } from '@lushly-dev/afd-testing';
const scenario = parseScenario(yaml);
const result = await executor.run(scenario);
```

## Dry Run Validation

Validate scenarios without executing:

```typescript
import { validateScenario } from '@lushly-dev/afd-testing';

const validation = validateScenario(scenario, {
  availableCommands: ['todo-create', 'todo-get'],
});

if (!validation.valid) {
  console.error(validation.errors);
  // ["Unknown command 'todo-unknown' in step 3"]
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
