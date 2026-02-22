# Command Namespacing

Reference for organizing commands into logical groups using directory structure.

## Directory Structure

```
.claude/commands/
  dev/                  # Development commands
    lint.md            --> /dev:lint
    review.md          --> /dev:review
    test.md            --> /dev:test
  git/                  # Git operations
    commit.md          --> /git:commit
    pr.md              --> /git:pr
  ops/                  # Operations
    deploy.md          --> /ops:deploy
    logs.md            --> /ops:logs
  quick-fix.md         --> /quick-fix
```

## Invocation Syntax

| File Path | Invocation |
|-----------|------------|
| `commands/review.md` | `/review` |
| `commands/dev/review.md` | `/dev:review` |
| `commands/git/commit.md` | `/git:commit` |

The colon (`:`) separates the namespace from the command name. Subdirectory depth maps directly to the namespace prefix.

## Recommended Namespaces

| Namespace | Purpose | Example Commands |
|-----------|---------|------------------|
| `dev` | Development workflows | lint, review, test, format |
| `git` | Version control | commit, pr, branch, merge |
| `ops` | Operations | deploy, rollback, logs |
| `docs` | Documentation | readme, changelog, api-docs |
| `db` | Database operations | migrate, seed, backup |
| `onboard` | New team members | setup, tour, intro |

## Scoping Rules

### Project Commands

Location: `.claude/commands/` in the project root.

Only available when Claude Code runs in that project directory.

### Global Commands

Location: `~/.claude/commands/`

Available across all projects for the current user.

### Priority

Project commands override global commands with the same name. If both `.claude/commands/review.md` and `~/.claude/commands/review.md` exist, the project version is used.

## Naming Conventions

| Good | Avoid |
|------|-------|
| `code-review.md` | `CodeReview.md` |
| `dev/lint.md` | `Dev/Lint.md` |
| `quick-fix.md` | `quick_fix.md` |

Rules:
- Use lowercase filenames with hyphens as separators
- Use lowercase directory names
- Avoid underscores, camelCase, or PascalCase

## Discovery

List available commands:
- Type `/` to see autocomplete suggestions
- Type `/dev:` to see commands within the `dev` namespace
- Use `/help` to see descriptions for all commands
