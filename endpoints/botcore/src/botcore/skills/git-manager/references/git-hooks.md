# Git Hooks Automation

Setup and configuration guides for Husky, Lefthook, and lint-staged to enforce code quality and commit conventions.

## Git Hooks Overview

Git hooks are scripts that run automatically at specific points in the git workflow. The most commonly automated hooks:

| Hook | Trigger | Common Use |
|---|---|---|
| `pre-commit` | Before creating a commit | Lint, format, type-check staged files |
| `commit-msg` | After commit message is written | Validate conventional commit format |
| `pre-push` | Before pushing to remote | Run tests, check for secrets |
| `post-merge` | After a merge completes | Install dependencies, run migrations |
| `post-checkout` | After switching branches | Install dependencies, notify of changes |
| `prepare-commit-msg` | Before commit message editor opens | Insert template, ticket number |

## Husky

The most popular git hooks manager for Node.js projects. Uses a `.husky/` directory with shell scripts for each hook.

### Setup

```bash
# Install
npm install -D husky

# Initialize (creates .husky/ directory and adds prepare script)
npx husky init

# This creates:
# .husky/pre-commit  (with default 'npm test')
# Adds "prepare": "husky" to package.json
```

### Configure Hooks

```bash
# Pre-commit: run lint-staged
echo 'npx lint-staged' > .husky/pre-commit

# Commit-msg: validate conventional commits
npm install -D @commitlint/cli @commitlint/config-conventional
echo 'npx commitlint --edit "$1"' > .husky/commit-msg

# Pre-push: run tests
echo 'npm test' > .husky/pre-push
```

### Commitlint Configuration

```javascript
// commitlint.config.js
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', [
      'feat', 'fix', 'docs', 'style', 'refactor',
      'test', 'chore', 'perf', 'build', 'ci', 'revert'
    ]],
    'scope-empty': [1, 'never'],        // Warn if no scope
    'subject-max-length': [2, 'always', 72],
    'body-max-line-length': [1, 'always', 100],
  }
};
```

### When to Use Husky

- Node.js / JavaScript / TypeScript projects
- Teams already using npm/yarn/pnpm
- Simple hook needs (1-3 hooks)
- Projects where all contributors have Node.js installed

## Lefthook

A fast, language-agnostic git hooks manager. Configured via YAML. Does not require Node.js.

### Setup

```bash
# Install (multiple options)
brew install lefthook                    # macOS
go install github.com/evilmartians/lefthook@latest  # Go
npm install -D lefthook                  # Node.js
pip install lefthook                     # Python

# Initialize
lefthook install
```

### Configuration

```yaml
# lefthook.yml
pre-commit:
  parallel: true
  commands:
    lint:
      glob: "*.{js,ts,jsx,tsx}"
      run: npx eslint --fix {staged_files}
      stage_fixed: true
    format:
      glob: "*.{js,ts,jsx,tsx,json,md}"
      run: npx prettier --write {staged_files}
      stage_fixed: true
    typecheck:
      glob: "*.{ts,tsx}"
      run: npx tsc --noEmit
    python-lint:
      glob: "*.py"
      run: ruff check {staged_files}
    rust-fmt:
      glob: "*.rs"
      run: cargo fmt -- --check

commit-msg:
  commands:
    commitlint:
      run: npx commitlint --edit {1}

pre-push:
  parallel: true
  commands:
    test:
      run: npm test
    secrets:
      run: npx secretlint "{push_files}"
```

### Key Lefthook Features

| Feature | Description |
|---|---|
| `parallel: true` | Run commands in parallel (faster) |
| `glob` | Filter files by pattern |
| `{staged_files}` | Placeholder for staged file paths |
| `stage_fixed: true` | Auto-stage files modified by the hook |
| `exclude` | Skip files matching pattern |
| `skip` | Skip hook based on conditions |
| `fail_text` | Custom error message |

### When to Use Lefthook

- Polyglot projects (Go + Python + TypeScript, etc.)
- Teams that want parallel hook execution
- Projects where not everyone has Node.js
- Large repos where hook speed matters
- Monorepos with different languages per package

## lint-staged

Runs commands only on staged files. Pairs with Husky or Lefthook for the pre-commit hook.

### Setup

```bash
npm install -D lint-staged
```

### Configuration

```json
// package.json (or .lintstagedrc.json)
{
  "lint-staged": {
    "*.{js,ts,jsx,tsx}": [
      "eslint --fix",
      "prettier --write"
    ],
    "*.{json,md,yml,yaml}": [
      "prettier --write"
    ],
    "*.css": [
      "stylelint --fix",
      "prettier --write"
    ],
    "*.py": [
      "ruff check --fix",
      "ruff format"
    ]
  }
}
```

### Advanced Configuration

```javascript
// lint-staged.config.js
export default {
  '*.{js,ts,jsx,tsx}': (files) => {
    // Run ESLint on changed files
    const eslint = `eslint --fix ${files.join(' ')}`;
    // Run tsc on the whole project (not per-file)
    const tsc = 'tsc --noEmit';
    return [eslint, tsc];
  },
  '*.{json,md}': 'prettier --write',
};
```

### When to Use lint-staged

- Always, in combination with Husky or Lefthook
- Keeps pre-commit hooks fast by only checking changed files
- Prevents committing linting errors, formatting issues, or type errors

## Tool Comparison

| Feature | Husky | Lefthook | lint-staged |
|---|---|---|---|
| Purpose | Hook manager | Hook manager | Staged file runner |
| Language | Node.js | Go (standalone binary) | Node.js |
| Configuration | Shell scripts in `.husky/` | YAML (`lefthook.yml`) | JSON/JS |
| Parallel execution | No (manual) | Yes (built-in) | Yes (per-glob) |
| File filtering | Via lint-staged | Built-in globs | Built-in globs |
| Speed | Good | Faster | N/A (paired with above) |
| Polyglot support | Node.js ecosystem | Any language | Node.js ecosystem |
| Install overhead | npm dependency | Single binary | npm dependency |

### Recommended Combinations

| Project Type | Stack |
|---|---|
| Node.js / TypeScript | Husky + lint-staged + commitlint |
| Polyglot (Go + TS + Python) | Lefthook (handles everything) |
| Monorepo (Node.js) | Husky + lint-staged + commitlint (root level) |
| Monorepo (polyglot) | Lefthook (root level, per-package globs) |
| Rust / Go only | Lefthook (no Node.js needed) |

## Monorepo Hook Configuration

### Husky + lint-staged in a Monorepo

```json
// Root package.json
{
  "lint-staged": {
    "packages/core/**/*.ts": ["eslint --fix", "prettier --write"],
    "packages/server/**/*.ts": ["eslint --fix", "prettier --write"],
    "packages/cli/**/*.ts": ["eslint --fix", "prettier --write"],
    "**/*.md": "prettier --write"
  }
}
```

### Lefthook in a Monorepo

```yaml
# lefthook.yml
pre-commit:
  parallel: true
  commands:
    core-lint:
      root: packages/core/
      glob: "*.{ts,tsx}"
      run: npx eslint --fix {staged_files}
    server-lint:
      root: packages/server/
      glob: "*.{ts,tsx}"
      run: npx eslint --fix {staged_files}
    format:
      glob: "*.{ts,tsx,json,md}"
      run: npx prettier --write {staged_files}
```

## Skipping Hooks

Hooks can be skipped when necessary, but this should be rare and intentional:

```bash
# Skip all hooks (escape hatch):
git commit --no-verify -m "chore: emergency fix"
git push --no-verify

# Skip specific Lefthook hooks:
LEFTHOOK_EXCLUDE=typecheck git commit -m "wip: in-progress"
```

**Warning**: Agents should never skip hooks unless explicitly instructed by a human. Hooks are the primary quality gate for commits.

## Agentic Hook Considerations

1. **Respect all hooks** -- Agents must not use `--no-verify` unless explicitly told to
2. **Handle hook failures gracefully** -- If a pre-commit hook fails, fix the issue and create a new commit (do not amend)
3. **Expect formatting changes** -- Hooks may auto-format files; the agent should re-stage formatted files
4. **Timeout awareness** -- Some hooks (type checking, tests) may take time; agents should wait patiently
5. **Do not modify hook configuration** -- Changing `.husky/`, `lefthook.yml`, or lint-staged config requires human approval
6. **CI hooks differ from local hooks** -- CI may run additional checks not present locally
