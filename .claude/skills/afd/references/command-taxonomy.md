# Command Taxonomy

AFD commands use a tag-based classification system for filtering, grouping, and permission control.

## Standard Tags

| Category | Tags | Purpose |
|----------|------|---------|
| **Entity** | `todo`, `user`, `document` | Groups commands by domain |
| **Action** | `create`, `read`, `update`, `delete`, `list`, `toggle` | CRUD operations |
| **Scope** | `single`, `batch` | One item vs. multiple |
| **Risk** | `destructive`, `safe` | Warns agents about irreversible actions |
| **Access** | `bootstrap`, `admin`, `public` | Permission filtering |

## Example Usage

```typescript
defineCommand({
  name: 'todo-delete',
  category: 'todo',
  tags: ['todo', 'delete', 'write', 'single', 'destructive'],
  mutation: true,
  // ...
});
```

## Bootstrap Tools

Every AFD MCP server exposes three bootstrap tools for agent onboarding:

| Tool | Description |
|------|-------------|
| `afd-help` | List commands with tag/category filtering |
| `afd-docs` | Generate markdown documentation |
| `afd-schema` | Export JSON schemas for all commands |

```typescript
import { getBootstrapCommands } from '@afd/server';
const bootstrapCmds = getBootstrapCommands(() => myCommands);
```

## Tag-Based Filtering

Agents can filter commands by tags:

```typescript
// List only destructive commands (for confirmation UI)
const tools = await afdHelp({
  tags: ['destructive'],
});

// List read-only commands (safe for background agents)
const safeTools = await afdHelp({
  excludeTags: ['destructive', 'write'],
});
```

## MCP Tool Strategy

Control how commands appear in IDE tool lists:

```typescript
createMcpServer({
  name: 'my-app',
  commands: [/* ... */],
  toolStrategy: 'individual', // 'grouped' (default) | 'individual'
});
```

- **grouped** (default): Commands consolidated by category (cleaner IDE UX)
- **individual**: Each command = separate MCP tool (more precise schemas)
