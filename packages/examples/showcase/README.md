# Feature Showcase

> Runnable demos showing AFD features in action

## Features Covered

| Feature | Package |
|---------|---------|
| Auth Adapter | `@lushly-dev/afd-auth` |
| Default Middleware | `@lushly-dev/afd-server` |
| Surface Validation | `@lushly-dev/afd-testing` |
| Schema Complexity Scoring | `@lushly-dev/afd-testing` |
| Command Prerequisites | `@lushly-dev/afd-server`, `@lushly-dev/afd-testing` |
| Pipelines | `@lushly-dev/afd-client`, `@lushly-dev/afd-core` |
| Expose Options | `@lushly-dev/afd-core` |
| Trust Metadata | `@lushly-dev/afd-server`, `@lushly-dev/afd-core` |

## Quick Start

```bash
cd packages/examples/showcase/backend
pnpm install
pnpm start            # Full end-to-end run
pnpm demo:auth        # Auth adapter only
pnpm demo:middleware   # Middleware only
pnpm demo:surface     # Surface validation only
pnpm demo:pipeline    # Pipeline chaining
pnpm demo:expose      # Expose options + trust metadata
```

## What Each Script Does

### `playground.ts` (full run)

End-to-end demo combining all features:
1. Auth adapter — sign in, session state, auth-gated commands
2. MCP server with defaultMiddleware (trace IDs, logging, slow warnings)
3. Middleware stack — authenticated + unauthenticated command execution
4. Surface validation — 11 rules across 6 commands
5. Schema complexity scoring — breakdown of `auth-sign-in` (score 17, high)
6. Command prerequisites — dependency chain validation

### `auth-demo.ts`

Auth adapter flows: credentials/OAuth sign-in, auth-gated middleware, session transitions, auth commands.

### `middleware-demo.ts`

Default middleware stack: trace IDs, structured logging, slow command warnings, telemetry, custom middleware.

### `surface-demo.ts`

All surface validation rules: naming conventions, similar descriptions, schema overlap, prompt injection, description quality, suppressions, schema complexity scoring (threshold/severity), and prerequisite validation (unresolved + circular detection).

### `pipeline-demo.ts`

Pipeline command chaining with DirectClient: `$prev` data passing, `$steps.alias` cross-references, conditional execution (`when` clauses), aggregated metadata (confidence breakdown, reasoning, warnings), error propagation vs `continueOnFailure`, and timeout handling.

### `expose-trust-demo.ts`

Visibility and safety: `ExposeOptions` (palette/agent/mcp/cli), `defaultExpose` secure defaults, registry filtering by interface, interface-gated execution (`COMMAND_NOT_EXPOSED`), trust metadata (`destructive`, `confirmPrompt`), undo metadata on `CommandResult`, and agent decision flows.
