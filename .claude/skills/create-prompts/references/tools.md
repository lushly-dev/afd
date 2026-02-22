# Tool Scoping in Prompt Files

How to control which tools a prompt can access.

## The `tools` Frontmatter Field

```yaml
tools: ["editFiles", "search", "mcp_nexus/*"]
```

The `tools` array restricts the prompt to only the listed tools. If omitted, the prompt inherits all tools available to the current agent.

## Tool Priority

When multiple layers define tools, this priority applies:

1. **Prompt file `tools`** (highest priority)
2. **Custom agent `tools`** (if prompt uses `agent: <name>`)
3. **Default agent tools** (lowest priority)

## Tool Types

### Built-in Tools

Standard VS Code Copilot tools:

| Tool        | Purpose                          |
| ----------- | -------------------------------- |
| `editFiles` | Create and edit files            |
| `search`    | Semantic search across workspace |
| `terminal`  | Run terminal commands            |
| `fetch`     | Fetch web content                |
| `usages`    | Find symbol usages               |
| `problems`  | Get workspace diagnostics        |

### MCP Server Tools

Reference all tools from an MCP server using the wildcard pattern:

```yaml
tools: ['mcp_nexus/*']           # All Nexus MCP tools
tools: ['mcp_github/*']          # All GitHub MCP tools
```

Or reference specific MCP tools:

```yaml
tools: ["mcp_nexus_nexus_execute", "mcp_nexus_server_status"]
```

### Extension-Contributed Tools

Tools provided by VS Code extensions. Reference by their tool ID.

## Runtime Behavior

- **Unavailable tools are silently ignored** -- no error if a listed tool is not loaded
- **Empty `tools` array** -- no tools available
- **No `tools` field** -- all default tools available
- **`tools` with `agent: agent`** -- only listed tools, plus agent has autonomous capabilities

## Scoping Guidelines

| Scenario           | Recommended `tools`                         |
| ------------------ | ------------------------------------------- |
| Read-only analysis | `['search']`                                |
| File generation    | `['editFiles', 'search']`                   |
| MCP queries only   | `['mcp_server/*']`                          |
| Full autonomy      | Omit `tools` (use all defaults)             |
| Terminal + files   | `['terminal', 'editFiles', 'search']`       |
| Init/bootstrap     | `['mcp_server/*']` (status checks + search) |

## Example: Scoped Security Review

```yaml
---
description: "Perform a security review"
agent: agent
tools: ["search", "editFiles", "terminal"]
---
```

This restricts the security review to searching, editing, and terminal -- preventing accidental use of MCP tools or other extensions.
