# Phase 02 - Restructure

> **Goal**: Reorganize `packages/examples/` to support multiple backends and frontends per example, establishing a pattern for future examples.

---

## Current Structure

```
packages/examples/
└── todo-app/                    # Mixed backend + frontend
    ├── src/
    │   ├── commands/            # TypeScript commands (11)
    │   ├── store/               # In-memory store
    │   ├── server.ts            # MCP server
    │   └── types.ts
    ├── ui/                      # Vanilla JS frontend
    │   ├── index.html
    │   └── app.js
    ├── package.json
    └── README.md

python/examples/
└── todo_server.py               # Python backend (6 commands, incomplete)
```

**Problems:**
- Backend and frontend mixed in same package
- No shared spec between TypeScript and Python
- Python example is incomplete and in a different location
- Adding new backends/frontends would be messy

---

## Target Structure

```
packages/examples/
├── _shared/                     # Shared across ALL examples
│   ├── test-runner/             # Conformance test runner
│   │   ├── src/
│   │   │   ├── runner.ts        # Main test executor
│   │   │   ├── loader.ts        # Load test cases from JSON
│   │   │   └── assertions.ts    # Result validation helpers
│   │   ├── package.json
│   │   └── README.md
│   └── README.md                # Explains shared utilities
│
├── todo/                        # Todo example
│   ├── spec/                    # API contract
│   │   ├── commands.schema.json
│   │   ├── test-cases.json
│   │   └── README.md
│   │
│   ├── backends/
│   │   ├── typescript/          # @afd/example-todo-ts
│   │   │   ├── src/
│   │   │   │   ├── commands/
│   │   │   │   ├── store/
│   │   │   │   ├── server.ts
│   │   │   │   └── types.ts
│   │   │   ├── package.json
│   │   │   ├── tsconfig.json
│   │   │   └── README.md
│   │   │
│   │   └── python/              # Move from python/examples/
│   │       ├── src/
│   │       │   ├── commands/
│   │       │   ├── store.py
│   │       │   └── server.py
│   │       ├── pyproject.toml
│   │       └── README.md
│   │
│   ├── frontends/
│   │   ├── vanilla/             # @afd/example-todo-vanilla
│   │   │   ├── index.html
│   │   │   ├── app.js
│   │   │   ├── style.css
│   │   │   ├── package.json     # For dev server (vite or similar)
│   │   │   └── README.md
│   │   │
│   │   └── react/               # @afd/example-todo-react (new)
│   │       ├── src/
│   │       ├── package.json
│   │       └── README.md
│   │
│   └── README.md                # How to run any combination
│
└── README.md                    # Examples overview
```

---

## Migration Steps

### Step 1: Create folder structure

```bash
# Create new structure
mkdir -p packages/examples/_shared/test-runner/src
mkdir -p packages/examples/todo/spec
mkdir -p packages/examples/todo/backends/typescript/src
mkdir -p packages/examples/todo/backends/python/src
mkdir -p packages/examples/todo/frontends/vanilla
mkdir -p packages/examples/todo/frontends/react/src
```

### Step 2: Move TypeScript backend

| From | To |
|------|-----|
| `packages/examples/todo-app/src/commands/` | `packages/examples/todo/backends/typescript/src/commands/` |
| `packages/examples/todo-app/src/store/` | `packages/examples/todo/backends/typescript/src/store/` |
| `packages/examples/todo-app/src/server.ts` | `packages/examples/todo/backends/typescript/src/server.ts` |
| `packages/examples/todo-app/src/types.ts` | `packages/examples/todo/backends/typescript/src/types.ts` |
| `packages/examples/todo-app/package.json` | `packages/examples/todo/backends/typescript/package.json` |
| `packages/examples/todo-app/tsconfig.json` | `packages/examples/todo/backends/typescript/tsconfig.json` |
| `packages/examples/todo-app/vitest.config.ts` | `packages/examples/todo/backends/typescript/vitest.config.ts` |

**Update package.json:**
```json
{
  "name": "@afd/example-todo-ts",
  "description": "Todo example - TypeScript backend"
}
```

### Step 3: Move Vanilla JS frontend

| From | To |
|------|-----|
| `packages/examples/todo-app/ui/index.html` | `packages/examples/todo/frontends/vanilla/index.html` |
| `packages/examples/todo-app/ui/app.js` | `packages/examples/todo/frontends/vanilla/app.js` |

**Create new files:**
- `packages/examples/todo/frontends/vanilla/package.json` — Minimal package for dev server
- `packages/examples/todo/frontends/vanilla/README.md` — How to run

### Step 4: Move Python backend

| From | To |
|------|-----|
| `python/examples/todo_server.py` | `packages/examples/todo/backends/python/src/server.py` |

**Create new files:**
- `packages/examples/todo/backends/python/pyproject.toml`
- `packages/examples/todo/backends/python/README.md`

### Step 5: Delete old structure

After verifying everything works:

```bash
rm -rf packages/examples/todo-app
rm python/examples/todo_server.py
```

### Step 6: Update imports and references

- Update `pnpm-workspace.yaml` to include new package paths
- Update root `package.json` scripts
- Update any documentation referencing old paths

---

## Package Configuration

### TypeScript Backend (`packages/examples/todo/backends/typescript/package.json`)

```json
{
  "name": "@afd/example-todo-ts",
  "version": "1.0.0",
  "description": "Todo example - TypeScript backend implementing AFD patterns",
  "type": "module",
  "main": "dist/server.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/server.js",
    "dev": "tsx watch src/server.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@afd/core": "workspace:*",
    "@afd/server": "workspace:*",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "tsx": "^4.7.0",
    "vitest": "^1.4.0"
  }
}
```

### Vanilla Frontend (`packages/examples/todo/frontends/vanilla/package.json`)

```json
{
  "name": "@afd/example-todo-vanilla",
  "version": "1.0.0",
  "description": "Todo example - Vanilla JS frontend",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "preview": "vite preview"
  },
  "devDependencies": {
    "vite": "^5.2.0"
  }
}
```

### Python Backend (`packages/examples/todo/backends/python/pyproject.toml`)

```toml
[project]
name = "afd-example-todo-python"
version = "1.0.0"
description = "Todo example - Python backend implementing AFD patterns"
requires-python = ">=3.10"
dependencies = [
    "afd>=0.1.0",
    "pydantic>=2.0.0",
]

[project.scripts]
todo-server = "src.server:main"
```

---

## pnpm-workspace.yaml Updates

```yaml
packages:
  - "packages/*"
  - "packages/examples/_shared/*"
  - "packages/examples/todo/backends/*"
  - "packages/examples/todo/frontends/*"
```

---

## README Templates

### Example README (`packages/examples/todo/README.md`)

```markdown
# Todo Example

Demonstrates AFD patterns with a simple todo application.

## Quick Start

### 1. Start a backend

**TypeScript:**
```bash
pnpm --filter @afd/example-todo-ts start
```

**Python:**
```bash
cd packages/examples/todo/backends/python
python -m src.server
```

### 2. Start a frontend

**Vanilla JS:**
```bash
pnpm --filter @afd/example-todo-vanilla dev
```

**React:**
```bash
pnpm --filter @afd/example-todo-react dev
```

### 3. Run conformance tests

```bash
BACKEND_URL=http://localhost:3100 pnpm example:todo:test
```

## Mix and Match

Any backend works with any frontend:

| Backend | Frontend | How to Run |
|---------|----------|------------|
| TypeScript | Vanilla | `pnpm example:todo:ts` + `pnpm example:todo:vanilla` |
| TypeScript | React | `pnpm example:todo:ts` + `pnpm example:todo:react` |
| Python | Vanilla | `pnpm example:todo:py` + `pnpm example:todo:vanilla` |
| Python | React | `pnpm example:todo:py` + `pnpm example:todo:react` |

## API Contract

See [spec/README.md](./spec/README.md) for the full API contract.
```

### Backend README Template

```markdown
# Todo Backend - [Language]

[Language] implementation of the Todo API.

## Quick Start

```bash
[install command]
[start command]
```

Server runs at `http://localhost:3100`.

## Commands

| Command | Type | Description |
|---------|------|-------------|
| `todo.create` | mutation | Create a new todo |
| ... | ... | ... |

## Conformance

Run conformance tests:

```bash
BACKEND_URL=http://localhost:3100 pnpm example:todo:test
```

## Implementation Notes

[Any language-specific notes]
```

---

## Tasks

- [ ] Create folder structure
- [ ] Move TypeScript backend files
- [ ] Update TypeScript package.json and imports
- [ ] Move Vanilla JS frontend files
- [ ] Create Vanilla frontend package.json
- [ ] Move Python backend files
- [ ] Create Python pyproject.toml
- [ ] Update pnpm-workspace.yaml
- [ ] Create README files for each component
- [ ] Create examples overview README
- [ ] Delete old todo-app folder
- [ ] Verify builds still work
- [ ] Update root package.json scripts

---

## Validation Criteria

Phase 02 is complete when:

1. New folder structure is in place
2. `pnpm install` works with new workspace config
3. TypeScript backend builds and starts
4. Vanilla frontend serves and connects to backend
5. All existing tests pass

---

## Next Phase

[Phase 03 - Backends](./03-backends.plan.md) — Bring Python to parity with TypeScript
