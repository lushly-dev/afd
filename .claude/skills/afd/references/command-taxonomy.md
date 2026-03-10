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

Every AFD MCP server exposes bootstrap tools for agent onboarding:

| Tool | Description |
|------|-------------|
| `afd-help` | List commands with tag/category filtering |
| `afd-docs` | Generate markdown documentation |
| `afd-schema` | Export JSON schemas for all commands |
| `afd-context-list` | List configured contexts and active context (when contexts enabled) |
| `afd-context-enter` | Enter a context (filters visible tools) |
| `afd-context-exit` | Exit the current context (restores previous) |

```typescript
import { getBootstrapCommands } from '@lushly-dev/afd-server';
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
  toolStrategy: 'lazy', // 'grouped' (default) | 'individual' | 'lazy'
});
```

- **grouped** (default): Commands consolidated by category (cleaner IDE UX)
- **individual**: Each command = separate MCP tool (more precise schemas)
- **lazy**: Exposes 5 meta-tools (`afd-discover`, `afd-detail`, `afd-call`, `afd-batch`, `afd-pipe`) — agents discover commands at runtime instead of seeing them all upfront. Best for large command sets (50+)

### Lazy Strategy Meta-Tools

| Tool | Description |
|------|-------------|
| `afd-discover` | Filter and list commands by category, tag, or search term (paginated) |
| `afd-detail` | Get full schema for 1–10 commands by name (batch retrieval) |
| `afd-call` | Universal command dispatcher — runs full middleware chain |
| `afd-batch` | Execute multiple commands in one call |
| `afd-pipe` | Execute commands as a pipeline with step references |

`afd-call` is available in **all** strategies (not just lazy). `afd-discover` and `afd-detail` are lazy-only.
