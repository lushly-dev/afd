# Command-Level Hooks

Reference for embedding lifecycle hooks in command frontmatter.

## Hook Types

| Hook | Trigger | Use Case |
|------|---------|----------|
| `UserPromptSubmit` | Before model processes | Input validation, PII redaction |
| `PreToolUse` | Before tool executes | Block dangerous commands |
| `PostToolUse` | After tool completes | Auto-format, lint, notify |
| `Stop` | Session/turn ends | Cleanup, logging |

## Syntax in Frontmatter

```yaml
---
description: Code review with auto-formatting
hooks:
  PostToolUse:
    - matcher: Write
      command: "npx prettier --write $FILE"
    - matcher: Edit
      command: "npx prettier --write $FILE"
---
```

## Hook Properties

| Property | Type | Description |
|----------|------|-------------|
| `matcher` | string | Tool name to match (e.g., `Write`, `Bash`, `Edit`) |
| `command` | string | Shell command to run when the hook fires |

## Examples

### Auto-Format on Write

```yaml
hooks:
  PostToolUse:
    - matcher: Write
      command: "npx prettier --write $FILE"
```

### Lint After Edit

```yaml
hooks:
  PostToolUse:
    - matcher: Edit
      command: "npx eslint --fix $FILE"
```

### Block Dangerous Commands

```yaml
hooks:
  PreToolUse:
    - matcher: Bash
      command: "scripts/check-safe.sh"
```

If the hook script exits with a non-zero code, the tool invocation is blocked.

## Global vs Command Hooks

| Scope | Location | When to Use |
|-------|----------|-------------|
| Global | `settings.json` | Universal policies (block `rm -rf`, enforce formatting everywhere) |
| Command | Command frontmatter | Workflow-specific behavior (format only in review commands) |

### Global Hooks (settings.json)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "command": "scripts/block-rm-rf.sh"
      }
    ]
  }
}
```

### Command Hooks (frontmatter)

```yaml
---
hooks:
  PostToolUse:
    - matcher: Write
      command: "npx prettier --write $FILE"
---
```

## Environment Compatibility

Command-level hooks require Claude Code 2.1.0+. In older versions, the command still works but hooks are silently ignored.

## Best Practices

| Do | Don't |
|----|-------|
| Keep hook scripts fast | Run long-running processes |
| Log hook outcomes | Fail silently |
| Test hooks independently | Embed untested scripts |
| Document hook behavior | Hide side effects |
| Use global hooks for policies | Put security enforcement in individual commands |
