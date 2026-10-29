# Tool Permissions

Reference for `allowed-tools` configuration in command frontmatter.

## Syntax

```yaml
allowed-tools:
  - ToolName
  - ToolName(pattern)
  - mcp__server__tool
```

When `allowed-tools` is omitted, all tools are available. When specified, only listed tools (and their patterns) are permitted.

## Built-in Tools

| Tool | Description |
|------|-------------|
| `Read` | Read file contents |
| `Write` | Create/overwrite files |
| `Edit` | Modify existing files |
| `Bash` | Execute shell commands |
| `Grep` | Search file contents |
| `Glob` | Find files by pattern |
| `WebSearch` | Search the web |
| `Task` | Spawn subagents |

## Bash Wildcards

Restrict which shell commands can execute:

| Pattern | Allows |
|---------|--------|
| `Bash(*)` | Any command (dangerous -- avoid) |
| `Bash(git *)` | Any git subcommand |
| `Bash(npm test:*)` | npm test scripts only |
| `Bash(node --version)` | Exact command only |

### Examples

```yaml
# Git operations only
allowed-tools:
  - Bash(git *)

# Specific npm scripts
allowed-tools:
  - Bash(npm run lint)
  - Bash(npm run test)

# Multiple patterns
allowed-tools:
  - Bash(git *)
  - Bash(npm *)
  - Bash(node *)
```

## MCP Permissions

For Model Context Protocol tools:

| Pattern | Allows |
|---------|--------|
| `mcp__*` | All MCP tools (dangerous) |
| `mcp__github__*` | All GitHub MCP tools |
| `mcp__github__create_issue` | Specific tool only |

### Examples

```yaml
# All GitHub operations
allowed-tools:
  - mcp__github__*

# Specific operations only
allowed-tools:
  - mcp__github__list_issues
  - mcp__github__create_issue
```

## Subagent Permissions

Control which agents can be spawned:

```yaml
allowed-tools:
  - Task(researcher)
  - Task(security-auditor)
```

## Permission Profiles

### Read-Only (Safe for Analysis)

```yaml
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash(git log *)
  - Bash(git diff *)
```

### Git Workflow

```yaml
allowed-tools:
  - Read
  - Bash(git *)
```

### Full Access (Use Sparingly)

```yaml
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash(*)
```

## Principle of Least Privilege

Always scope permissions to the minimum required:

```yaml
# Too permissive
allowed-tools:
  - Bash(*)

# Scoped appropriately
allowed-tools:
  - Bash(git diff *)
  - Bash(git status)
  - Read
```

Key rules:
- Start with no `allowed-tools` only if the command truly needs all tools
- Prefer exact commands over wildcards when possible
- Use `Bash(git *)` rather than `Bash(*)` for git-focused commands
- Add MCP tool permissions only for the specific operations needed
