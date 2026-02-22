# Command Format

Reference for command file structure and YAML frontmatter syntax.

## File Structure

```markdown
---
# YAML Frontmatter
description: Brief description for /help
argument-hint: [param]
allowed-tools: [Read, Write]
---

# Command Body (Markdown)
Instructions for Claude...
```

## Frontmatter Fields

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `description` | string | Shown in `/help` menu, used for discovery (< 256 chars) |

### Optional Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `argument-hint` | string | -- | UI hint showing expected parameters |
| `allowed-tools` | array | all | Tool whitelist (see [permissions.md](permissions.md)) |
| `model` | string | session | Override model (e.g., `claude-3-5-sonnet-20241022`) |
| `hooks` | object | -- | Command-level lifecycle hooks (see [hooks.md](hooks.md)) |

## Example: Complete Frontmatter

```yaml
---
description: Generate a detailed code review with security focus
argument-hint: [file-or-directory]
allowed-tools:
  - Read
  - Bash(git diff *)
  - Bash(git log *)
model: claude-3-5-sonnet-20241022
hooks:
  PostToolUse:
    - matcher: Write
      command: "npx prettier --write $FILE"
---
```

## File Naming

| Pattern | Example | Invocation |
|---------|---------|------------|
| Root file | `review.md` | `/review` |
| Nested file | `dev/review.md` | `/dev:review` |
| Hyphenated | `code-review.md` | `/code-review` |

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Missing `---` delimiters | Add `---` before and after frontmatter |
| Using tabs | Use spaces for YAML indentation |
| Empty description | Always provide meaningful description |
| Special characters in description | Quote strings with `:`, `#`, etc. |
| Description > 256 chars | Keep descriptions concise |

## Template: Basic Command

```markdown
---
description: {Brief description for /help menu}
argument-hint: [{param1}] [{param2}]
allowed-tools:
  - Read
  - Bash(git *)
---

# {Command Title}

{One-line description of what this command does.}

## Context

!git status
@docs/guidelines.md

## Task

Using $ARGUMENTS, {describe the task Claude should perform}.

## Output Format

{Specify how results should be formatted.}

## Constraints

- {Negative constraint 1}
- {Negative constraint 2}
```

## Template: Advanced Command

```markdown
---
description: {Detailed description}
argument-hint: [{param1}] [{param2}]
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash(git diff *)
  - Bash(git log *)
model: claude-3-5-sonnet-20241022
hooks:
  PostToolUse:
    - matcher: Write
      command: "npx prettier --write $FILE"
---

# {Command Title}

{Detailed description with security considerations.}

## Context Gathering

### Project Configuration
@.eslintrc.json
@tsconfig.json

### Current State
!git status
!git diff --staged

## Task

Using $ARGUMENTS, perform the following:

<instructions>
1. {Step 1}
2. {Step 2}
3. {Step 3}
</instructions>

## Output Format

<output_format>
## Summary
{Brief summary}

## Findings
| Category | Finding | Severity |
|----------|---------|----------|
| ... | ... | ... |
</output_format>

## Constraints

- Never {dangerous action} without explicit confirmation
- Always {safety requirement}
- Do not {prohibited action}

## Escalation

If any of the following occur, stop and ask for guidance:
- {Condition requiring human review}
- {Edge case not covered}
```
