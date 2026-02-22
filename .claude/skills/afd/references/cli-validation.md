# CLI Validation

Testing commands via CLI before building UI.

## The Honesty Check

> "If it can't be done via CLI, the architecture is wrong."

CLI validation is a quality gate that:
- Forces proper abstraction
- Ensures all actions are centralized
- Prevents UI-only code paths
- Enables automation and testing

## CLI Commands

### Connection

```bash
# Connect to MCP server
afd connect http://localhost:3100/sse

# Check connection status
afd status

# Disconnect
afd disconnect
```

### Discovery

```bash
# List all available commands
afd tools

# Filter by category
afd tools --category todo

# Get details for specific command
afd tools todo.create
```

### Execution

```bash
# Call a command with JSON arguments
afd call todo.create '{"title": "Test", "priority": "high"}'

# Call with no arguments
afd call todo.stats '{}'

# Pretty print output
afd call todo.list '{}' --pretty
```

### Interactive Mode

```bash
# Start interactive shell
afd shell

# In shell:
> tools
> call todo.create {"title": "Interactive test"}
> call todo.list {}
> exit
```

## Validation Workflow

### Step 1: Start Server

```bash
# In one terminal
node packages/examples/todo-app/dist/server.js

# Expected output:
# Todo MCP Server running at http://localhost:3100
# SSE endpoint: http://localhost:3100/sse
# Health check: http://localhost:3100/health
```

### Step 2: Connect

```bash
afd connect http://localhost:3100/sse

# Expected output:
# ✓ Connected to http://localhost:3100/sse
# Server: todo-app v1.0.0
# Available tools: 8
```

### Step 3: Discover Commands

```bash
afd tools

# Expected output:
# Available tools (8):
#
# todo.create    Create a new todo item
# todo.list      List todos with filtering
# todo.get       Get a single todo by ID
# ...
```

### Step 4: Test Happy Path

```bash
# Create
afd call todo.create '{"title": "Buy groceries", "priority": "high"}'
# → success: true, data: { id: "todo-xxx", title: "Buy groceries", ... }

# List
afd call todo.list '{"priority": "high"}'
# → success: true, data: { todos: [...], total: 1 }

# Get
afd call todo.get '{"id": "todo-xxx"}'
# → success: true, data: { id: "todo-xxx", ... }
```

### Step 5: Test Error Cases

```bash
# Not found
afd call todo.get '{"id": "nonexistent"}'
# → success: false, error: { code: "NOT_FOUND", message: "...", suggestion: "..." }

# Validation error (empty title)
afd call todo.create '{"title": ""}'
# → success: false, error: { code: "VALIDATION_ERROR", ... }

# No changes
afd call todo.update '{"id": "todo-xxx"}'
# → success: false, error: { code: "NO_CHANGES", ... }
```

### Step 6: Test Mutations

```bash
# Toggle completion
afd call todo.toggle '{"id": "todo-xxx"}'
# → success: true, reasoning: "Marked as completed"

# Verify state changed
afd call todo.get '{"id": "todo-xxx"}'
# → completed: true

# Delete
afd call todo.delete '{"id": "todo-xxx"}'
# → success: true, warnings: [{ code: "PERMANENT", ... }]

# Verify deleted
afd call todo.get '{"id": "todo-xxx"}'
# → success: false, error: { code: "NOT_FOUND" }
```

### Step 7: Surface Validation

```bash
# Run cross-command semantic quality checks
afd validate --surface

# With custom similarity threshold
afd validate --surface --similarity-threshold 0.8

# Strict mode + verbose output
afd validate --surface --strict --verbose

# Skip categories and suppress rules
afd validate --surface --skip-category internal --suppress missing-category
```

Surface validation detects:
- Similar descriptions (cosine similarity above threshold)
- Schema overlap (shared input fields)
- Naming convention violations and collisions
- Prompt injection patterns in descriptions
- Description quality issues (too short, missing verbs)
- Orphaned categories (single command)
- Schema complexity (unions, nesting, constraints that cause agent input errors)

## Validation Checklist

Before building UI, verify:

- [ ] **Happy path works** - Create, read, update, delete all succeed
- [ ] **Error cases handled** - NOT_FOUND, VALIDATION_ERROR, etc.
- [ ] **Reasoning included** - Success results explain what happened
- [ ] **Suggestions provided** - Error results guide recovery
- [ ] **Warnings present** - Destructive actions warn users
- [ ] **State changes correctly** - Mutations actually update data

## Common Issues

### Connection Failed

```bash
afd connect http://localhost:3100/sse
# Error: Connection failed

# Fixes:
# 1. Check server is running
# 2. Check port matches
# 3. Check /health endpoint works
curl http://localhost:3100/health
```

### Command Not Found

```bash
afd call todo.create '{"title": "Test"}'
# Error: Tool not found: todo.create

# Fixes:
# 1. Check spelling
# 2. Run `afd tools` to see available commands
# 3. Verify command is registered in server
```

### Invalid JSON

```bash
afd call todo.create {title: "Test"}
# Error: Invalid JSON

# Fix: Use proper JSON with quoted keys
afd call todo.create '{"title": "Test"}'
```

### Validation Error

```bash
afd call todo.create '{"title": ""}'
# Error: VALIDATION_ERROR - Title is required

# Fix: Provide valid input per schema
afd call todo.create '{"title": "Valid title"}'
```

## Automated Validation

Create a validation script:

```bash
#!/bin/bash
# validate-commands.sh

set -e

echo "Connecting..."
afd connect http://localhost:3100/sse

echo "Testing todo.create..."
afd call todo.create '{"title": "Test", "priority": "high"}' > /tmp/created.json
ID=$(jq -r '.data.id' /tmp/created.json)

echo "Testing todo.list..."
afd call todo.list '{}' | jq '.data.total'

echo "Testing todo.get..."
afd call todo.get "{\"id\": \"$ID\"}" | jq '.success'

echo "Testing todo.toggle..."
afd call todo.toggle "{\"id\": \"$ID\"}" | jq '.success'

echo "Testing todo.delete..."
afd call todo.delete "{\"id\": \"$ID\"}" | jq '.success'

echo "Testing error case..."
afd call todo.get '{"id": "nonexistent"}' | jq '.error.code'

echo "All tests passed!"
```

## CI Integration

Add CLI validation to CI pipeline:

```yaml
# .github/workflows/validate.yml
name: Validate Commands

on: [push, pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
      
      - run: pnpm install
      - run: pnpm build
      
      # Start server in background
      - run: node packages/examples/todo-app/dist/server.js &
      - run: sleep 2
      
      # Run validation
      - run: ./scripts/validate-commands.sh
```
