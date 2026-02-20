# Contributing to AFD

Thanks for your interest in contributing to Agent-First Development! This guide covers the basics of getting set up and submitting changes.

## Prerequisites

- **Node.js** >= 20.0.0
- **pnpm** >= 9.0.0

## Getting Started

```bash
# Clone the repo
git clone https://github.com/lushly-dev/afd.git
cd afd

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

## Development Workflow

### Building

```bash
# Build everything
pnpm build

# Build a specific package
pnpm -F @lushly-dev/afd-core build
pnpm -F @lushly-dev/afd-server build
```

### Testing

```bash
# Run all tests
pnpm test

# Run tests for a specific package
pnpm -F @lushly-dev/afd-core test

# Run a single test file
cd packages/server && pnpm vitest run src/server.test.ts

# Watch mode
pnpm -F @lushly-dev/afd-server test:watch
```

### Linting & Formatting

We use [Biome](https://biomejs.dev/) for linting and formatting.

```bash
# Check for issues
pnpm lint

# Auto-fix issues
pnpm lint:fix

# Format code
pnpm format
```

### Type Checking

```bash
pnpm typecheck
```

## Code Style

- **Indentation**: Tabs
- **Quotes**: Single quotes
- **Trailing commas**: ES5 style
- **Imports**: Use `import type { ... }` for type-only imports
- **Node builtins**: Use `node:` prefix (e.g., `node:fs`, `node:path`)
- **No `any`**: Use proper types instead of `any`
- **Command naming**: Use `domain-action` kebab-case format (e.g., `todo-create`, `user-get`)

## Submitting Changes

1. Fork the repository
2. Create a feature branch from `main`
3. Make your changes
4. Ensure `pnpm lint`, `pnpm test`, and `pnpm build` all pass
5. Submit a pull request

### Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/) format:

```
feat(core): add pipeline timeout support
fix(server): handle empty input validation
docs: update command naming conventions
chore: update dependencies
```

### Pull Request Guidelines

- Keep PRs focused on a single concern
- Include tests for new functionality
- Update documentation if behavior changes
- Ensure all CI checks pass before requesting review

## Package Structure

```
packages/
  core/       - Foundational types (CommandResult, errors)
  server/     - MCP server factory with Zod validation
  client/     - MCP client + DirectClient
  cli/        - Command-line interface
  testing/    - JTBD scenario runner
  adapters/   - Frontend rendering adapters
```

## Questions?

Open an issue on [GitHub](https://github.com/lushly-dev/afd/issues) for questions or discussion.
