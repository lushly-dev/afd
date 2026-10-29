# Commands Specification

Complete technical reference for Claude slash commands.

## Command vs Skill

| Aspect | Command | Skill |
|--------|---------|-------|
| Invocation | Explicit (`/command`) | Automatic (model discovers) |
| Structure | Single `.md` file | Directory with `SKILL.md` |
| Context | Added to main conversation history | Can fork context via subagent |
| Best for | User-driven workflows | Domain expertise |

## File Format

```markdown
---
description: Required description
argument-hint: [optional] [params]
allowed-tools: [Tool1, Tool2]
model: optional-model-override
hooks:
  PostToolUse:
    - matcher: ToolName
      command: "script.sh"
---

# Command Body

Instructions, context injection, prompts...
```

## Frontmatter Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `description` | string | Yes | Help menu text (< 256 chars) |
| `argument-hint` | string | No | Parameter format hint |
| `allowed-tools` | array | No | Tool whitelist |
| `model` | string | No | Model override |
| `hooks` | object | No | Lifecycle hooks |

## Variable Injection

| Syntax | Description |
|--------|-------------|
| `$ARGUMENTS` | Full argument string |
| `$1`, `$2`, ... | Positional arguments (space-delimited, quotes preserve spaces) |
| `!command` | Bash stdout injection (must be in allowed-tools) |
| `@path` | File content injection (relative to project root) |

## Tool Permission Patterns

| Pattern | Scope |
|---------|-------|
| `Bash(*)` | All bash (dangerous) |
| `Bash(git *)` | Git subcommands |
| `mcp__server__*` | All tools from an MCP server |
| `mcp__github__create_issue` | Specific MCP tool |
| `Task(agent)` | Specific subagent |

## Directory Structure

```
.claude/commands/           # Project scope
~/.claude/commands/         # Global scope

# Namespaced
.claude/commands/dev/       --> /dev:*
.claude/commands/git/       --> /git:*
```

Project commands override global commands with the same name.

## Lifecycle Hooks

| Event | Timing | Use |
|-------|--------|-----|
| `UserPromptSubmit` | Before model | Input validation |
| `PreToolUse` | Before tool | Blocking dangerous operations |
| `PostToolUse` | After tool | Auto-formatting, linting |
| `Stop` | End of turn | Cleanup, logging |

Hook scripts that exit non-zero block the associated tool invocation (for `PreToolUse`).

## Design Principles

### 1. Deterministic Context
Fetch context with `!` and `@` rather than asking users to provide it.

### 2. Guided Reasoning
Provide checklists, structured output formats, and step-by-step instructions.

### 3. External Standards
Reference project configs (`@.eslintrc.json`, `@tsconfig.json`) rather than duplicating rules.

### 4. Least Privilege
Scope `allowed-tools` to the minimum required for the command's purpose.

## Quality Checklist

- [ ] Description is concise (< 256 chars)
- [ ] `argument-hint` provided when arguments are expected
- [ ] `allowed-tools` scoped appropriately
- [ ] Every `!` command is covered by allowed-tools permissions
- [ ] Every `@` path references a file that exists
- [ ] Output format is specified
- [ ] Negative constraints are included
- [ ] File naming is lowercase-hyphenated

## Portability

Commands travel with the repository. When sharing commands across teams or repos:
- Ensure all `@`-referenced files exist in the target repo
- Document required tools and MCP servers
- Test across different environments and operating systems
