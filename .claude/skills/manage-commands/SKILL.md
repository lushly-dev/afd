---
name: manage-commands
source: botcore
description: >
  Creates, validates, and organizes Claude slash commands with consistent patterns and automated quality checks. Covers frontmatter syntax (description, argument-hint, allowed-tools, model, hooks), variable injection ($ARGUMENTS, $1/$2, quoted args), context operators (! for bash stdout, @ for file injection), tool permissions (Bash wildcards, MCP patterns, subagent scoping), command namespacing (directory structure, scoping rules, naming conventions), and lifecycle hooks (PreToolUse, PostToolUse, Stop). Use when creating new slash commands, debugging command invocations, organizing command libraries, configuring tool permissions, or setting up command-level hooks. Triggers: command, slash command, /command, argument, allowed-tools, context injection, namespace, hooks, permissions, frontmatter.

version: 1.0.0
triggers:
  - command
  - slash command
  - /command
  - argument
  - allowed-tools
  - context injection
  - namespace
  - hooks
  - permissions
  - frontmatter
  - !bash
  - @file
  - variable injection
portable: true
---

# Managing Commands

Create and maintain Claude slash commands with consistent patterns, proper permissions, and automated validation.

## Capabilities

1. **Create commands** -- Generate new slash commands from templates with proper frontmatter and body structure
2. **Validate commands** -- Lint commands for missing fields, permission gaps, and structural issues
3. **Organize commands** -- Namespace commands into logical directories with consistent naming
4. **Configure permissions** -- Scope allowed-tools to minimum required access using wildcards and patterns
5. **Wire hooks** -- Attach lifecycle hooks for auto-formatting, validation, and cleanup
6. **Inject context** -- Use `!` and `@` operators to gather runtime context without user intervention

## Routing Logic

| Request type | Load reference |
|--------------|----------------|
| Frontmatter syntax, field schema | [references/format.md](references/format.md) |
| Variable injection ($ARGUMENTS, $1, $2) | [references/variables.md](references/variables.md) |
| Context operators (!, @) | [references/context-injection.md](references/context-injection.md) |
| Tool permissions, Bash wildcards, MCP | [references/permissions.md](references/permissions.md) |
| Directory organization, naming | [references/namespacing.md](references/namespacing.md) |
| Lifecycle hooks (Pre/PostToolUse) | [references/hooks.md](references/hooks.md) |
| Full technical specification | [references/specification.md](references/specification.md) |

## Core Principles

### 1. Explicit Invocation

Commands are user-triggered macros invoked with `/command-name`. They are not auto-discovered like skills. Design each command for a specific, repeatable workflow.

### 2. Deterministic Context Gathering

Use `!` (bash injection) and `@` (file injection) to fetch context automatically before Claude processes. Never ask users to paste content that can be gathered programmatically.

```markdown
## Context
!git diff --staged
@docs/STYLE_GUIDE.md

## Task
Review the staged changes against the style guide.
```

### 3. Least Privilege

Restrict `allowed-tools` to the minimum set required. Use scoped patterns rather than blanket access.

```yaml
# Scoped (preferred)
allowed-tools:
  - Bash(git diff *)
  - Bash(git status)
  - Read

# Blanket (avoid)
allowed-tools:
  - Bash(*)
```

### 4. Structured Output

Always specify the expected output format in the command body. Use Markdown tables, code blocks, XML tags, or bullet lists so Claude produces consistent results.

### 5. Namespace by Domain

Group related commands into subdirectories. The directory name becomes the namespace prefix, invoked with a colon separator.

```
.claude/commands/
  dev/lint.md       -->  /dev:lint
  git/commit.md     -->  /git:commit
  quick-fix.md      -->  /quick-fix
```

## Quick Reference

### Command File Structure

```markdown
---
description: Brief description for /help menu
argument-hint: [param1] [param2]
allowed-tools: [Read, Bash(git *)]
---

# Command Title

Instructions for Claude...

## Context
!git status
@docs/guidelines.md

## Task
Using $ARGUMENTS, perform the requested action.

## Output Format
Use a Markdown table for results.

## Constraints
- Do not modify files outside src/
```

### Frontmatter Fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `description` | Yes | string | Shown in `/help` menu (< 256 chars) |
| `argument-hint` | No | string | UI hint for expected parameters |
| `allowed-tools` | No | array | Tool whitelist (defaults to all) |
| `model` | No | string | Override default model |
| `hooks` | No | object | Command-level lifecycle hooks |

### Variable Injection

| Syntax | Description | Example |
|--------|-------------|---------|
| `$ARGUMENTS` | All arguments as string | "fix the login bug" |
| `$1`, `$2` | Positional arguments | `$1`="FRONTEND", `$2`="HIGH" |
| `!command` | Bash stdout injection | `!git diff --staged` |
| `@path` | File content injection | `@docs/STYLE.md` |

### Namespace Conventions

| File path | Invocation |
|-----------|------------|
| `commands/review.md` | `/review` |
| `commands/dev/review.md` | `/dev:review` |
| `commands/git/commit.md` | `/git:commit` |

### Recommended Namespaces

| Namespace | Purpose |
|-----------|---------|
| `dev` | Development workflows (lint, review, test) |
| `git` | Version control (commit, pr, branch) |
| `ops` | Operations (deploy, rollback, logs) |
| `docs` | Documentation (readme, changelog) |
| `db` | Database operations (migrate, seed) |

### Tool Permission Patterns

| Pattern | Scope |
|---------|-------|
| `Bash(git *)` | Any git subcommand |
| `Bash(npm test)` | Exact command only |
| `mcp__github__*` | All GitHub MCP tools |
| `Task(agent-name)` | Specific subagent |

## Workflow: Create a New Command

1. **Choose scope** -- Project (`.claude/commands/`) or global (`~/.claude/commands/`)
2. **Pick namespace** -- Place in subdirectory if it belongs to a domain group
3. **Write frontmatter** -- Include `description`; add `argument-hint` and `allowed-tools` as needed
4. **Gather context** -- Use `!` and `@` operators to pull in relevant state
5. **Define task** -- Write clear instructions referencing `$ARGUMENTS` or positional variables
6. **Specify output** -- Describe the expected output format
7. **Add constraints** -- List what Claude should not do
8. **Validate** -- Check that `!` commands are covered by `allowed-tools` and `@` files exist

## Checklist

- [ ] `description` is concise (< 256 chars) and meaningful
- [ ] `argument-hint` provided when arguments are expected
- [ ] `allowed-tools` scoped to minimum required access
- [ ] Every `!command` is covered by an `allowed-tools` entry
- [ ] Every `@path` references a file that exists in the repo
- [ ] Output format is specified in the command body
- [ ] Negative constraints are included where appropriate
- [ ] File uses lowercase-hyphenated naming (`code-review.md`, not `CodeReview.md`)
- [ ] YAML frontmatter uses spaces (not tabs) for indentation

## When to Escalate

- **Complex orchestration** -- If a command needs multi-step agent coordination, consider a skill instead
- **Dynamic tool discovery** -- If the command needs to find tools at runtime, use MCP
- **Cross-project patterns** -- If the same command appears in multiple projects, extract to a shared skill or global command
- **Security policies** -- Global enforcement (blocking `rm -rf`, etc.) belongs in `settings.json` hooks, not individual commands
- **Hook failures** -- If command-level hooks produce unexpected behavior, check Claude Code version compatibility (hooks require 2.1.0+)
