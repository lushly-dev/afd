# Context Injection

Reference for `!` (bash) and `@` (file) operators that inject runtime context into command prompts.

## Bash Injection (!)

Execute a shell command and inject its stdout into the prompt before Claude processes it.

### Syntax

```markdown
!command [args]
```

### Examples

```markdown
# Current git status
!git status

# Staged changes
!git diff --staged

# Recent commits
!git log -5 --oneline

# List files
!ls -la src/

# Environment info
!node --version
```

### Security Requirement

Commands used with `!` must be covered by `allowed-tools`. If the frontmatter restricts tools, any `!` invocation that is not covered will fail.

```yaml
---
allowed-tools:
  - Bash(git *)
  - Bash(ls *)
  - Bash(node --version)
---

!git diff --staged    # Covered by Bash(git *)
!ls src/              # Covered by Bash(ls *)
!node --version       # Covered by exact match
!rm -rf /             # BLOCKED - not in allowed-tools
```

## File Injection (@)

Read file contents and inject them into the prompt.

### Syntax

```markdown
@path/to/file
```

### Examples

```markdown
# Project guidelines
@docs/CONTRIBUTING.md

# Configuration
@.eslintrc.json

# Style guide
@docs/STYLE_GUIDE.md

# Specific source file
@src/components/Button.tsx
```

### Path Resolution

Paths are relative to the project root (the directory containing `.claude/`).

## Combined Usage

```markdown
---
description: Review staged changes against style guide
allowed-tools:
  - Bash(git diff *)
  - Read
---

# Code Review

## Style Guide
@docs/STYLE_GUIDE.md

## Staged Changes
!git diff --staged

## Task
Review the staged changes against the style guide.
Output findings as a Markdown table.
```

## Best Practices

| Do | Don't |
|----|-------|
| Fetch context automatically | Ask users to paste content |
| Use specific, scoped commands | Use `Bash(*)` wildcard |
| Reference existing project docs | Duplicate content inline |
| Keep injections focused | Inject entire codebases |
| Verify `@` files exist in repo | Reference non-existent paths |
| Ensure `!` commands are in allowed-tools | Forget to add permissions |
