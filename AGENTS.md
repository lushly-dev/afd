# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Documentation Policy**: Skills are the source of truth for detailed knowledge.
> This file is a routing table. See [afd skill](skills/afd/) for core AFD patterns.
> **First time?** See [SETUP.md](SETUP.md) for installation, tooling, and environment setup.

## Commands

| Command | Purpose |
|---------|---------|
| `pnpm build` | Build all packages |
| `pnpm test` | Run all tests |
| `pnpm -F @lushly-dev/afd-core test` | Test a specific package |
| `pnpm lint` | Biome lint check |
| `pnpm lint:fix` | Auto-fix lint issues |
| `pnpm typecheck` | TypeScript type checking |
| `pnpm check` | Quality gate (lint + typecheck + test + build) |
| `cd packages/server && pnpm vitest run src/server.test.ts` | Run single test file |

## Architecture

AFD (Agent-First Development) — AI agents are first-class users. All functionality exposed as commands before any UI.

```
packages/
├── core/       # @lushly-dev/afd-core — Foundational types (CommandResult, CommandError, CommandDefinition)
├── server/     # @lushly-dev/afd-server — MCP server factory (defineCommand, createMcpServer)
├── client/     # @lushly-dev/afd-client — MCP client + DirectClient
├── auth/       # @lushly-dev/afd-auth — Provider-agnostic auth adapter
├── cli/        # @lushly-dev/afd-cli — Command-line tool
├── testing/    # @lushly-dev/afd-testing — JTBD scenario runner + surface validation
├── adapters/   # @lushly-dev/afd-adapters — Frontend adapters for rendering CommandResult
└── examples/
    ├── todo/                # Multi-stack example (TS, Python, Rust backends)
    └── todo-directclient/   # DirectClient + AI integration example

python/  # Python AFD package (pip install afd) — CommandResult, MCP server/client, middleware, validation, telemetry, batch/streaming, testing, handoff
alfred/  # Quality bot — lint, parity, quality (see alfred/AGENTS.md)
```

## Key Conventions

- **Command naming**: `domain-action` kebab-case — `todo-create`, `user-get`, `order-list`
- **CommandResult**: Always return `success(data, { reasoning, confidence })` or `failure({ code, message, suggestion })`
- **Errors**: Always include `suggestion` for recovery guidance
- **Testing**: Vitest with explicit imports, tests in `src/**/*.test.ts`
- **Imports**: Use `import type` for type-only, `node:` prefix for Node.js builtins
- **Lint**: Biome — tab indent, single quotes, no `any`, no unused imports

## Skill Index

| Skill | When to Use |
|-------|-------------|
| [afd](skills/afd/) | Core AFD patterns, command design, workflow |
| [afd-developer](skills/afd-developer/) | AFD philosophy, honesty check, define-validate-surface |
| [afd-python](skills/afd-python/) | Python implementation with Pydantic, FastMCP |
| [afd-typescript](skills/afd-typescript/) | TypeScript patterns, Zod schemas, defineCommand, createMcpServer |
| [afd-rust](skills/afd-rust/) | Rust implementation patterns |
| [afd-auth](skills/afd-auth/) | Auth adapter, middleware, commands, session sync, React hooks |
| [afd-directclient](skills/afd-directclient/) | DirectClient, pipe() pipelines, pipeline variable resolution |
| [afd-contracts](skills/afd-contracts/) | TypeSpec-based contract system for multi-layer API schema sync |
