# Feature Playground

> **Status**: 🧪 Experiment  
> **Goal**: Manual testing sandbox for newly merged features

## Features Covered

| Feature | PR | Package |
|---------|-----|---------|
| Auth Adapter | #125 | `@lushly-dev/afd-auth` |
| Default Middleware | #126 | `@lushly-dev/afd-server` |
| Surface Validation | #127 | `@lushly-dev/afd-testing` |

## Quick Start

```bash
cd packages/experiments/feature-playground/backend
pnpm install
pnpm start       # Run the full playground
pnpm test:auth   # Auth adapter only
pnpm test:mw     # Middleware only
pnpm test:surface # Surface validation only
```

## What Each Script Does

### `playground.ts` (full run)

A self-contained script that:
1. Creates a mock auth adapter and signs in
2. Builds an MCP server with auth middleware + defaultMiddleware (trace IDs, logging, slow warnings)
3. Executes commands through the middleware stack — both authenticated and unauthenticated
4. Runs surface validation on the registered command set
5. Prints results with color-coded output

### `auth-demo.ts`

Exercises auth adapter flows:
- Sign in via credentials and OAuth
- Auth-gated command middleware (reject when unauthenticated, pass when authenticated)
- Session state transitions (loading → authenticated → unauthenticated)
- Auth commands (`auth-sign-in`, `auth-sign-out`, `auth-session-get`)

### `middleware-demo.ts`

Exercises the default middleware stack:
- Auto trace ID generation
- Structured logging output
- Slow command warnings (with configurable threshold)
- Telemetry event recording
- Custom middleware composition

### `surface-demo.ts`

Exercises surface validation:
- Naming convention checks (kebab-case enforcement)
- Similar description detection
- Schema overlap detection
- Prompt injection detection
- Description quality checks
- Suppression patterns
