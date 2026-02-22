---
name: write-commits
source: botcore
description: >
  Generates clear, consistent commit messages following Conventional Commits format with project-appropriate scopes and changelog-friendly structure. Covers commit types, scope selection, subject/body/footer rules, breaking changes, multi-package commits, and anti-pattern avoidance. Use when writing commits, reviewing staged changes, generating commit messages, or enforcing commit conventions. Triggers: commit, commit message, write commit, generate commit, staged changes, conventional commits, git commit, changelog.

version: 1.0.0
triggers:
  - commit
  - commit message
  - write commit
  - generate commit
  - staged changes
  - conventional commits
  - git commit
  - changelog
portable: true
---

# Writing Commits

Generate consistent, changelog-friendly commit messages following Conventional Commits format with project-appropriate scopes.

## Capabilities

1. **Commit Message Generation** -- Analyze staged changes and produce well-structured Conventional Commits messages
2. **Type Classification** -- Identify the correct commit type (feat, fix, refactor, docs, etc.) from the nature of the change
3. **Scope Selection** -- Determine the appropriate scope from the project's package or module structure
4. **Breaking Change Handling** -- Format breaking changes with proper markers, migration notes, and footer conventions
5. **Anti-Pattern Detection** -- Identify and correct vague, overly long, mixed-concern, or improperly formatted commit messages
6. **Changelog Alignment** -- Ensure messages are structured for automated changelog generation

## Core Principles

### 1. Conventional Commits Format

Every commit message follows this structure:

```
<type>(<scope>): <subject>

<body>

<footer>
```

- **type** -- Required. Classifies the nature of the change.
- **scope** -- Optional but recommended. Identifies the affected package, module, or area.
- **subject** -- Required. Brief imperative description.
- **body** -- Optional. Explains what and why.
- **footer** -- Optional. Breaking changes, issue references, co-authors.

### 2. Commit Types

| Type | Purpose | Example |
|------|---------|---------|
| `feat` | New feature or capability | `feat(auth): add OAuth2 token refresh` |
| `fix` | Bug fix | `fix(api): resolve timeout on large payloads` |
| `docs` | Documentation only | `docs: update API reference for v2 endpoints` |
| `style` | Formatting, no logic change | `style: fix linter warnings` |
| `refactor` | Code restructuring, no behavior change | `refactor(db): extract query builder` |
| `test` | Adding or updating tests | `test(auth): add token expiry edge cases` |
| `chore` | Maintenance, tooling | `chore: update dependencies` |
| `perf` | Performance improvement | `perf(cache): reduce lookup time with bloom filter` |
| `build` | Build system or external deps | `build: update tsconfig for ESM` |
| `ci` | CI/CD pipeline changes | `ci: add integration test workflow` |

### 3. Subject Line Rules

1. **Max 50 characters** -- Keep it concise
2. **Present tense** -- "add" not "added"
3. **Imperative mood** -- "fix bug" not "fixes bug"
4. **No trailing period**
5. **Lowercase start** -- Begin with a lowercase letter

### 4. Body Rules

1. **Wrap at 72 characters**
2. **Explain what and why**, not how
3. **Separate from subject** with a blank line
4. **Use bullet points** for multiple changes

### 5. Footer Rules

1. **Breaking changes** -- Start with `BREAKING CHANGE:` on its own line
2. **Issue references** -- `Closes #123` or `Fixes #456`
3. **Co-authors** -- `Co-authored-by: Name <email>`

### 6. Scope Selection

Scopes should reflect the project structure. Determine scopes by examining:

- **Monorepo packages** -- Use package names (e.g., `core`, `server`, `cli`)
- **Application layers** -- Use layer names (e.g., `api`, `db`, `ui`)
- **Feature areas** -- Use domain names (e.g., `auth`, `billing`, `search`)
- **Multi-scope changes** -- Comma-separate scopes (e.g., `core,server`)
- **Cross-cutting changes** -- Omit scope when the change is truly global

## Workflow

### Generating a Commit Message

1. **Analyze staged changes** -- Run `git diff --staged` to understand what changed
2. **Identify the type** -- Classify as feat, fix, refactor, docs, etc.
3. **Determine the scope** -- Which package or module is affected
4. **Write the subject** -- Concise imperative description under 50 chars
5. **Add body if needed** -- For non-trivial changes, explain the reasoning
6. **Add footer if needed** -- Issue refs, breaking changes, co-authors

### Breaking Change Format

Use the `!` marker in the type/scope AND a `BREAKING CHANGE:` footer:

```
feat(api)!: rename UserResponse to UserResult

BREAKING CHANGE: All imports of UserResponse must be updated
to UserResult. The structure remains the same.

Migration:
- import { UserResponse } -> import { UserResult }
- UserResponse<T> -> UserResult<T>
```

## Quick Reference: Good vs Bad

### Avoid

```
# Too vague
fix: bug fix

# Wrong tense
feat(cli): added new command

# Too long subject
feat(server): implement comprehensive middleware system with logging, timing, rate limiting, and authentication support

# Missing scope when package is clear
feat: add batch execution

# Mixed concerns (should be two commits)
feat(server): add middleware and fix timeout bug
```

### Prefer

```
# Specific
fix(client): prevent duplicate connections on reconnect

# Present tense, imperative
feat(cli): add format flag for output

# Concise subject with body for details
feat(server): add middleware system

Includes:
- Logging middleware with configurable levels
- Timing middleware for performance tracking
- Rate limiting with sliding window

# Clear scope
feat(server): add batch execution support

# Atomic -- one concern per commit
feat(server): add middleware pipeline
fix(server): handle timeout in long-running commands
```

## Checklist

- [ ] Type accurately reflects the nature of the change
- [ ] Scope matches the affected package or module
- [ ] Subject is under 50 characters
- [ ] Subject uses imperative mood, present tense, lowercase, no period
- [ ] Body (if present) explains what and why, wrapped at 72 characters
- [ ] Breaking changes use both `!` marker and `BREAKING CHANGE:` footer
- [ ] Each commit addresses a single concern (no mixed feat + fix)
- [ ] Issue references use proper format (`Closes #N`, `Fixes #N`)
- [ ] Message is suitable for automated changelog generation

## When to Escalate

| Condition | Action |
|---|---|
| Change spans many packages with unrelated concerns | Split into multiple atomic commits |
| Unclear whether change is feat vs fix vs refactor | Review the diff -- if behavior changes for users it is feat or fix; if not, refactor |
| Breaking change with complex migration | Include detailed migration steps in the body and notify the team |
| Staged changes include unrelated modifications | Unstage unrelated files and commit separately |
| Commit would include secrets or credentials | Stop and remove sensitive content before committing |
