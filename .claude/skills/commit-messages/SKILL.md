---
name: commit-messages
description: >
  Generate clear, consistent commit messages following Conventional Commits
  format with AFD-specific scopes. Use when: writing commits, reviewing staged
  changes, understanding commit conventions, or generating commit messages.
  Triggers: commit, commit message, write commit, generate commit, staged changes,
  conventional commits, git commit.
---

# Commit Messages Skill

Generate consistent commit messages following Conventional Commits with AFD scopes.

## Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

## Types

| Type | Description | Example |
|------|-------------|---------|
| `feat` | New feature or capability | `feat(testing): add multi-app adapter support` |
| `fix` | Bug fix | `fix(client): resolve SSE reconnection timeout` |
| `docs` | Documentation changes | `docs: update command schema guide` |
| `style` | Formatting, no code change | `style: fix linter warnings` |
| `refactor` | Code change, no feature/fix | `refactor(server): extract middleware factory` |
| `test` | Adding or updating tests | `test(core): add CommandResult validation tests` |
| `chore` | Maintenance tasks | `chore: update dependencies` |
| `perf` | Performance improvements | `perf(server): optimize batch execution` |
| `build` | Build system changes | `build: update tsconfig for ESM` |
| `ci` | CI/CD changes | `ci: add conformance test workflow` |

## AFD Scopes

| Scope | When to use |
|-------|-------------|
| `core` | @afd/core package changes |
| `server` | @afd/server package changes |
| `client` | @afd/client package changes |
| `cli` | @afd/cli package changes |
| `testing` | @afd/testing package changes |
| `todo-ts` | TypeScript todo example |
| `todo-py` | Python todo example |
| `rust` | Rust crate changes |
| `docs` | Documentation (can omit scope) |
| `deps` | Dependency updates |

## Rules

### Subject Line

1. **Max 50 characters** - Keep it concise
2. **Present tense** - "add" not "added"
3. **Imperative mood** - "fix bug" not "fixes bug"
4. **No period** at the end
5. **Lowercase** - Start with lowercase letter

### Body (Optional)

1. **Wrap at 72 characters**
2. **Explain what and why**, not how
3. **Separate from subject** with blank line
4. **Use bullet points** for multiple changes

### Footer (Optional)

1. **Breaking changes** - Start with `BREAKING CHANGE:`
2. **Issue references** - `Closes #123` or `Fixes #456`
3. **Co-authors** - `Co-authored-by: Name <email>`

## Examples

### Simple Feature

```
feat(cli): add --format flag for output formatting
```

### Feature with Body

```
feat(testing): add JTBD scenario runner

- Parse YAML scenario files with fixtures
- Support step references (${{ steps[0].data.id }})
- Generate JUnit XML reports for CI integration
- Validate scenarios without execution (dry run)

Closes #45
```

### Bug Fix

```
fix(server): handle empty batch requests gracefully

Return structured error with INVALID_BATCH_REQUEST code
instead of throwing unhandled exception.

Fixes #123
```

### Breaking Change

```
feat(core)!: rename CommandResponse to CommandResult

BREAKING CHANGE: All imports of CommandResponse must be
updated to CommandResult. The structure remains the same.

Migration:
- import { CommandResponse } -> import { CommandResult }
- CommandResponse<T> -> CommandResult<T>
```

### Documentation

```
docs: add Phase 3 agent integration documentation

- MCP server setup guide
- AI-friendly hints (_agentHints) usage
- scenarioSuggest command reference
```

### Refactor

```
refactor(server): extract command execution into pipeline

No functional changes. Prepares for middleware support
by separating parsing, validation, and execution phases.
```

### Performance

```
perf(client): implement connection pooling for HTTP transport

Reduces connection overhead for high-frequency command calls.
Benchmark shows 40% improvement in throughput.
```

### Multi-Package Change

```
feat(core,server): add streaming result support

Introduces StreamChunk type for progressive result delivery.
Server now supports SSE-based streaming for long operations.
```

## Commit Message Generation Process

When generating a commit message:

1. **Analyze staged changes** - `git diff --staged`
2. **Identify the type** - Is it a feature, fix, refactor, etc.?
3. **Determine the scope** - Which package(s) are affected?
4. **Write subject** - Concise description of the change
5. **Add body if needed** - For complex changes, explain why
6. **Add footer if needed** - Issue refs, breaking changes

## Anti-Patterns

### Avoid

```
# Too vague
fix: bug fix

# Wrong tense
feat(cli): added new command

# Too long
feat(server): implement comprehensive middleware system with logging, timing, rate limiting, and authentication support

# No scope when needed
feat: add batch execution  # Which package?

# Mixing concerns
feat(server): add middleware and fix timeout bug  # Split into two commits
```

### Prefer

```
# Specific
fix(client): prevent duplicate SSE connections on reconnect

# Present tense
feat(cli): add new command

# Concise with body for details
feat(server): add middleware system

Includes:
- Logging middleware with configurable levels
- Timing middleware for performance tracking
- Rate limiting with sliding window

# Clear scope
feat(server): add batch execution support

# Atomic commits
feat(server): add middleware pipeline
fix(server): handle timeout in long-running commands
```

## Integration with AFD Workflow

When committing AFD changes, ensure:

1. **Command changes** - Test via CLI before committing
2. **Schema changes** - Include migration notes if breaking
3. **New commands** - Include test coverage
4. **Documentation** - Update relevant docs with code changes

## Related Skills

- `pr-review` - PR review standards
- `afd-developer` - Core AFD methodology
