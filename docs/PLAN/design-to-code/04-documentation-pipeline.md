# 04 - Documentation Pipeline

> **Goal**: Auto-generate comprehensive documentation from command schemas and Figma designs, ensuring specs are always in sync with implementation.

## The Vision: Living Documentation

Documentation that:
- **Never drifts** — Generated from source of truth
- **Always complete** — Every command and component documented
- **Multi-format** — API docs, UI specs, Storybook, all from same source
- **Validated** — CI fails if docs are out of sync

## Documentation Outputs

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         DOCUMENTATION PIPELINE                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  SOURCES                          OUTPUTS                               │
│  ─────────                        ───────                               │
│                                                                         │
│  ┌──────────────┐                 ┌──────────────────────────────────┐ │
│  │ AFD Commands │────────────────►│ API Reference (OpenAPI 3.0)      │ │
│  │ (Zod Schema) │                 │ Command Reference (Markdown)     │ │
│  └──────────────┘                 │ TypeScript Types (.d.ts)         │ │
│         │                         │ Test Scaffolds (Vitest)          │ │
│         │                         └──────────────────────────────────┘ │
│         │                                                               │
│         ▼                                                               │
│  ┌──────────────┐                 ┌──────────────────────────────────┐ │
│  │ Figma Design │────────────────►│ UI Component Specs (Markdown)    │ │
│  │ + Bindings   │                 │ Storybook Stories (CSF3)         │ │
│  └──────────────┘                 │ Accessibility Checklist          │ │
│         │                         │ Design Token Docs                │ │
│         │                         └──────────────────────────────────┘ │
│         │                                                               │
│         ▼                                                               │
│  ┌──────────────┐                 ┌──────────────────────────────────┐ │
│  │   Combined   │────────────────►│ Living Specification             │ │
│  │   Context    │                 │ Changelog (auto-generated)       │ │
│  └──────────────┘                 │ Coverage Report                  │ │
│                                   └──────────────────────────────────┘ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## CLI Commands

### `afd docs generate`

Generate all documentation:

```bash
# Generate all docs
afd docs generate

# Output:
# ✓ API Reference → docs/api/openapi.json
# ✓ Command Reference → docs/commands/
# ✓ TypeScript Types → src/types/generated.d.ts
# ✓ Test Scaffolds → tests/generated/
# ✓ Storybook Stories → .storybook/stories/generated/

# Generate specific outputs
afd docs generate --only api
afd docs generate --only commands
afd docs generate --only types
afd docs generate --only storybook
```

### `afd docs sync`

Sync with Figma designs:

```bash
# Sync from Figma file
afd docs sync --figma "https://figma.com/file/xxx"

# Output:
# ✓ Fetched 12 components with AFD bindings
# ✓ UI Specs → docs/ui/
# ✓ Storybook Stories → .storybook/stories/
# ✓ Design Tokens → tokens/figma.json
```

### `afd docs validate`

Validate documentation is in sync:

```bash
afd docs validate

# Output:
# Checking documentation sync...
# 
# Commands: 12/12 documented ✓
# UI Components: 8/8 have specs ✓
# Storybook: 8/8 have stories ✓
# Types: Up to date ✓
# 
# Warnings:
# ⚠ 2 commands missing examples
# ⚠ 1 component missing accessibility notes
# 
# ✓ Documentation is in sync
```

### `afd docs watch`

Watch mode for development:

```bash
afd docs watch

# Watching for changes...
# [10:15:32] Schema changed: todo.create
#            → Regenerating command docs
#            → Updating OpenAPI spec
#            → Updating TypeScript types
# [10:15:33] Done ✓
```

## Generated Outputs

### 1. OpenAPI Specification

```yaml
# docs/api/openapi.yaml

openapi: 3.0.3
info:
  title: Todo App API
  description: Generated from AFD command schemas
  version: 1.0.0

paths:
  /api/todo.create:
    post:
      operationId: todo.create
      summary: Creates a new todo item
      tags: [todo, mutation]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/TodoCreateInput'
            examples:
              simple:
                summary: Simple todo
                value:
                  title: "Buy groceries"
              highPriority:
                summary: High priority
                value:
                  title: "Urgent task"
                  priority: "high"
      responses:
        '200':
          description: Success
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CommandResult_Todo'
        '400':
          description: Validation error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CommandError'

components:
  schemas:
    TodoCreateInput:
      type: object
      required: [title]
      properties:
        title:
          type: string
          minLength: 1
          description: The todo title
        priority:
          type: string
          enum: [high, medium, low]
          default: medium
          description: Task priority level

    CommandResult_Todo:
      type: object
      properties:
        success:
          type: boolean
        data:
          $ref: '#/components/schemas/Todo'
        error:
          $ref: '#/components/schemas/CommandError'
        confidence:
          type: number
          minimum: 0
          maximum: 1
        warnings:
          type: array
          items:
            $ref: '#/components/schemas/Warning'

    Todo:
      type: object
      properties:
        id:
          type: string
        title:
          type: string
        priority:
          type: string
          enum: [high, medium, low]
        completed:
          type: boolean
        createdAt:
          type: string
          format: date-time
```

### 2. Command Reference (Markdown)

```markdown
<!-- docs/commands/todo.create.md -->
<!-- AUTO-GENERATED - DO NOT EDIT -->

# todo.create

Creates a new todo item.

## Overview

| Property | Value |
|----------|-------|
| **Category** | todo |
| **Type** | Mutation |
| **Tags** | mutation, core |

## Input Schema

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `title` | string | Yes | — | The todo title (min 1 char) |
| `priority` | enum | No | `"medium"` | `"high"` \| `"medium"` \| `"low"` |

### TypeScript Type

\`\`\`typescript
interface TodoCreateInput {
  title: string;
  priority?: "high" | "medium" | "low";
}
\`\`\`

## Output

Returns `CommandResult<Todo>` with these UX fields:
- `confidence` — Always 1.0 for create operations
- `warnings` — Validation warnings if any

### Success Response

\`\`\`json
{
  "success": true,
  "data": {
    "id": "todo-123",
    "title": "Buy groceries",
    "priority": "medium",
    "completed": false,
    "createdAt": "2025-12-31T10:00:00Z"
  },
  "confidence": 1.0
}
\`\`\`

### Error Response

\`\`\`json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Title is required",
    "suggestion": "Provide a non-empty title"
  }
}
\`\`\`

## Examples

### Simple Todo

\`\`\`bash
afd call todo.create '{"title": "Buy groceries"}'
\`\`\`

### High Priority

\`\`\`bash
afd call todo.create '{"title": "Urgent task", "priority": "high"}'
\`\`\`

## Side Effects

- Creates database record
- May trigger notifications

## UI Implementation

- **Component**: `TodoCreateForm`
- **Figma**: [View Design](https://figma.com/file/xxx)
- **Storybook**: [View Stories](/storybook/?path=/story/todo-create)

## Related Commands

- `todo.list` — List all todos
- `todo.update` — Update a todo
- `todo.delete` — Delete a todo

---
*Generated from schema version 1.0.0 on 2025-12-31*
```

### 3. UI Component Spec

```markdown
<!-- docs/ui/TodoCreateForm.md -->
<!-- AUTO-GENERATED from Figma + AFD bindings -->

# TodoCreateForm

Form component for creating new todos.

## Overview

| Property | Value |
|----------|-------|
| **AFD Command** | `todo.create` |
| **Figma** | [View Design](https://figma.com/file/xxx) |
| **Generated Code** | `components/TodoCreateForm.tsx` |

## Anatomy

\`\`\`
┌─────────────────────────────────────┐
│ ┌─────────────────────────────────┐ │
│ │ Warning Banner (if warnings)    │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ Error Banner (if error)         │ │
│ └─────────────────────────────────┘ │
│                                     │
│ Title *                             │
│ ┌─────────────────────────────────┐ │
│ │ [Text Input]                    │ │
│ └─────────────────────────────────┘ │
│                                     │
│ Priority                            │
│ ┌─────────────────────────────────┐ │
│ │ [Select: High/Medium/Low]       │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │      [Create Todo Button]       │ │
│ └─────────────────────────────────┘ │
│                                     │
│ [Confidence Indicator] (if < 0.9)   │
└─────────────────────────────────────┘
\`\`\`

## Input Bindings

| Layer | Schema Field | Type | Required |
|-------|--------------|------|----------|
| `titleInput` | `title` | string | Yes |
| `prioritySelect` | `priority` | enum | No |
| `submitButton` | (action) | — | Yes |

## Output Bindings

| Layer | UX Field | Condition |
|-------|----------|-----------|
| `errorBanner` | `error` | When `!success` |
| `warningBanner` | `warnings` | When `warnings.length > 0` |
| `confidenceIndicator` | `confidence` | When `confidence < 0.9` |

## States

| State | Trigger | Visual Changes |
|-------|---------|----------------|
| Default | Initial load | Empty form |
| Filled | User input | Values shown |
| Loading | Submit clicked | Button disabled, spinner |
| Success | `result.success` | Form cleared, feedback |
| Error | `!result.success` | Error banner visible |
| Warning | `warnings.length > 0` | Warning banner visible |

## Variants

| Variant | Description | Use Case |
|---------|-------------|----------|
| `compact` | Single row, inline | Quick entry |
| `full` | Stacked, with hints | Primary form |

## Design Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--spacing-form-gap` | 16px | Between fields |
| `--color-error` | #DC2626 | Error states |
| `--color-warning` | #D97706 | Warning states |
| `--color-action` | #2563EB | Submit button |

## Accessibility

- [ ] Labels associated with inputs (`htmlFor`)
- [ ] Required fields marked (`aria-required`)
- [ ] Error messages linked (`aria-describedby`)
- [ ] Focus trapped in modal variant
- [ ] Keyboard navigation works
- [ ] Color contrast meets WCAG AA

## Test Scenarios

1. **Happy path**: Enter title, submit, see success
2. **Validation**: Submit empty, see error
3. **Loading**: Submit, see loading state
4. **Error recovery**: See error, fix, submit again
5. **Keyboard**: Tab through form, submit with Enter

---
*Generated from Figma file v42 on 2025-12-31*
```

### 4. Storybook Stories

```typescript
// .storybook/stories/generated/TodoCreateForm.stories.tsx
// AUTO-GENERATED - DO NOT EDIT

import type { Meta, StoryObj } from '@storybook/react';
import { TodoCreateForm } from '@/components/TodoCreateForm';
import { fn } from '@storybook/test';

const meta: Meta<typeof TodoCreateForm> = {
  title: 'Forms/TodoCreateForm',
  component: TodoCreateForm,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Form for creating new todos. Bound to AFD command `todo.create`.',
      },
    },
    afd: {
      command: 'todo.create',
      figmaUrl: 'https://figma.com/file/xxx',
    },
  },
  argTypes: {
    onSuccess: { action: 'success' },
    onError: { action: 'error' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    onSuccess: fn(),
    onError: fn(),
  },
};

export const Compact: Story = {
  args: {
    variant: 'compact',
    onSuccess: fn(),
    onError: fn(),
  },
};

export const WithError: Story = {
  args: {
    onSuccess: fn(),
    onError: fn(),
  },
  play: async ({ canvasElement }) => {
    // Simulate error state
    const form = canvasElement.querySelector('form');
    form?.dispatchEvent(new Event('submit', { bubbles: true }));
  },
};

export const WithWarnings: Story = {
  parameters: {
    mockData: {
      commandResult: {
        success: true,
        data: { id: 'todo-1', title: 'Test' },
        warnings: [
          { code: 'LONG_TITLE', message: 'Title is quite long', severity: 'info' },
        ],
      },
    },
  },
};

export const LowConfidence: Story = {
  parameters: {
    mockData: {
      commandResult: {
        success: true,
        data: { id: 'todo-1', title: 'Test' },
        confidence: 0.65,
      },
    },
  },
};
```

### 5. Living Specification

Combined documentation portal:

```markdown
<!-- docs/specification/index.md -->

# Todo Application Specification

> Auto-generated from AFD commands and Figma designs
> Last sync: 2025-12-31T10:00:00Z

## Commands

| Command | Description | UI Component |
|---------|-------------|--------------|
| [todo.create](./commands/todo.create.md) | Creates a new todo | [TodoCreateForm](./ui/TodoCreateForm.md) |
| [todo.list](./commands/todo.list.md) | Lists all todos | [TodoList](./ui/TodoList.md) |
| [todo.toggle](./commands/todo.toggle.md) | Toggles completion | [TodoItem](./ui/TodoItem.md) |
| [todo.delete](./commands/todo.delete.md) | Deletes a todo | [TodoItem](./ui/TodoItem.md) |

## Coverage

| Metric | Value | Status |
|--------|-------|--------|
| Commands documented | 12/12 | ✓ |
| Commands with examples | 10/12 | ⚠ |
| UI components | 8/8 | ✓ |
| Storybook stories | 8/8 | ✓ |
| Accessibility audited | 6/8 | ⚠ |

## Recent Changes

| Date | Change | Affected |
|------|--------|----------|
| 2025-12-31 | Added `priority` field | todo.create, TodoCreateForm |
| 2025-12-30 | New command | todo.stats |
| 2025-12-29 | UI redesign | TodoList |

## Resources

- [API Reference (OpenAPI)](./api/openapi.yaml)
- [Storybook](/storybook/)
- [Figma File](https://figma.com/file/xxx)
- [GitHub Repository](https://github.com/xxx)
```

## Implementation

### Documentation Generator

```typescript
// packages/cli/src/commands/docs.ts

import { Command } from 'commander';
import { generateOpenAPI } from '../generators/openapi';
import { generateMarkdown } from '../generators/markdown';
import { generateStorybook } from '../generators/storybook';
import { generateTypes } from '../generators/types';
import { syncFigma } from '../sync/figma';
import { validateDocs } from '../validators/docs';

export const docsCommand = new Command('docs')
  .description('Generate and manage documentation');

docsCommand
  .command('generate')
  .description('Generate documentation from schemas')
  .option('--only <type>', 'Generate only specific type (api|commands|types|storybook)')
  .option('--out <dir>', 'Output directory', 'docs')
  .action(async (options) => {
    const registry = await loadRegistry();
    
    if (!options.only || options.only === 'api') {
      await generateOpenAPI(registry, `${options.out}/api`);
      console.log('✓ API Reference → docs/api/openapi.json');
    }
    
    if (!options.only || options.only === 'commands') {
      await generateMarkdown(registry, `${options.out}/commands`);
      console.log('✓ Command Reference → docs/commands/');
    }
    
    if (!options.only || options.only === 'types') {
      await generateTypes(registry, 'src/types/generated.d.ts');
      console.log('✓ TypeScript Types → src/types/generated.d.ts');
    }
    
    if (!options.only || options.only === 'storybook') {
      await generateStorybook(registry, '.storybook/stories/generated');
      console.log('✓ Storybook Stories → .storybook/stories/generated/');
    }
  });

docsCommand
  .command('sync')
  .description('Sync documentation with Figma')
  .requiredOption('--figma <url>', 'Figma file URL')
  .action(async (options) => {
    const components = await syncFigma(options.figma);
    console.log(`✓ Fetched ${components.length} components with AFD bindings`);
    
    // Generate UI specs
    await generateUISpecs(components, 'docs/ui');
    console.log('✓ UI Specs → docs/ui/');
  });

docsCommand
  .command('validate')
  .description('Validate documentation is in sync')
  .action(async () => {
    const result = await validateDocs();
    
    console.log('\nChecking documentation sync...\n');
    console.log(`Commands: ${result.commands.documented}/${result.commands.total} documented ${result.commands.complete ? '✓' : '✗'}`);
    console.log(`UI Components: ${result.ui.documented}/${result.ui.total} have specs ${result.ui.complete ? '✓' : '✗'}`);
    console.log(`Storybook: ${result.storybook.documented}/${result.storybook.total} have stories ${result.storybook.complete ? '✓' : '✗'}`);
    
    if (result.warnings.length > 0) {
      console.log('\nWarnings:');
      result.warnings.forEach(w => console.log(`⚠ ${w}`));
    }
    
    if (result.valid) {
      console.log('\n✓ Documentation is in sync');
      process.exit(0);
    } else {
      console.log('\n✗ Documentation is out of sync');
      process.exit(1);
    }
  });
```

## CI Integration

```yaml
# .github/workflows/docs.yml

name: Documentation

on:
  push:
    branches: [main]
    paths:
      - 'packages/**/src/**'
      - 'docs/**'
  pull_request:

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup
        uses: actions/setup-node@v4
        with:
          node-version: 20
          
      - run: pnpm install
      
      - name: Generate docs
        run: pnpm afd docs generate
        
      - name: Validate sync
        run: pnpm afd docs validate
        
      - name: Check for changes
        run: |
          if [[ -n $(git status --porcelain docs/) ]]; then
            echo "Documentation is out of date. Run 'afd docs generate' and commit."
            exit 1
          fi
```

## Success Criteria

- [ ] `afd docs generate` produces all output types
- [ ] `afd docs sync` fetches Figma bindings
- [ ] `afd docs validate` catches drift
- [ ] OpenAPI spec validates with swagger-cli
- [ ] Storybook stories render correctly
- [ ] CI fails on documentation drift
- [ ] Watch mode works during development

---

**Next**: [05-validation-sync.md](./05-validation-sync.md) — Keeping everything in sync
