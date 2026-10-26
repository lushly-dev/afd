---
'@lushly-dev/afd-core': minor
'@lushly-dev/afd-server': minor
'@lushly-dev/afd-client': minor
'@lushly-dev/afd-auth': minor
'@lushly-dev/afd-testing': minor
---

Add standard `actor`, `clock` and `random` fields to `CommandContext` (#271, #274).

- **Core:** `Actor` (`kind`: `human`, `agent`, `service`, `script` or `test`, with optional `id`, `label` and `onBehalfOf`), `Clock`, `RandomSource`, `systemClock`, `systemRandom`, `fixedClock()` (a manual clock with `set` and `advance`), `seededRandom()` (reproducible, not cryptographic) and `withContextDefaults()`. `ResultMetadata` and `TelemetryEvent` gain `actorKind`. The core registry gives handlers a clock and a random source.
- **Server:** new `clock`, `random` and `actor` options. MCP calls run as `{ kind: 'agent' }` unless the option or `createContext` says otherwise; every context gets a clock and a random source; results carry `metadata.actorKind` (the kind only, never the id). `executionTimeMs`, the telemetry middleware and HTTP session expiry use the clock. `createDirectRegistry()` accepts the same three defaults.
- **Client:** `DirectClient` accepts `actor` (default `{ kind: 'human' }`), `clock` and `random`; a call's own context wins.
- **Auth:** `createAuthMiddleware` fills `context.actor` from the verified session: a human actor gets the user's `id` and `label`, other actors get `onBehalfOf`.
- **Testing:** `createTestContext()` sets `actor: { kind: 'test' }`, a clock and a random source (`now` stops the clock); `InProcessExecutor` takes a `context` for every step and runs steps as a test actor. `fixedClock` and `seededRandom` are re-exported.

The golden wire fixtures now include `"actorKind": "agent"` in result metadata.
