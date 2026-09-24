# @lushly-dev/afd-auth

## 2.0.0

### Minor Changes

- [#251](https://github.com/lushly-dev/afd/pull/251) [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a) Thanks [@Falkicon](https://github.com/Falkicon)! - Fix session expiry, sign-in results, listener isolation, the Convex adapter and session sync in `@lushly-dev/afd-auth`.

  - **Behaviour change: expired sessions are rejected.** `createAuthMiddleware` returns a retryable `TOKEN_EXPIRED` failure, with a suggestion, when `session.expiresAt` is at or before now or is not a valid date. `Session.expiresAt` is now optional (a type change for code that reads it): the Convex adapter no longer invents a 24 h expiry, and a session without `expiresAt` is never treated as expired.
  - **Behaviour change: middleware defaults.** `auth-sign-in`, `auth-sign-out` and `auth-session-get` always bypass the middleware (new `AUTH_COMMAND_NAMES`), so signing in no longer needs an `exclude` entry. `context.auth` is set or deleted on every call, excluded commands included, so a caller-supplied value never reaches a handler; a `CommandContext` module augmentation types it as `AuthenticatedSessionState | undefined`. `AuthMiddlewareOptions` is exported from the package root.
  - **Behaviour change: `auth-sign-in` reports the real outcome.** It used to read the session right after `signIn()` and return a stale `unauthenticated` state with the reasoning "Signed in". `AuthAdapter.signIn()` may now resolve with a `SignInOutcome` (`signed-in`, `redirect` with the provider URL, or `pending`); resolving with nothing still works. A redirect or pending sign-in returns the current state with "Not signed in yet" reasoning and a `SIGN_IN_REDIRECT` or `SIGN_IN_PENDING` warning. Otherwise the command waits for the next non-loading state change, up to the new `createAuthCommands(adapter, { signInTimeoutMs })` (default 10 s), returns `SIGN_IN_PENDING` when the wait runs out, and fails with `PROVIDER_ERROR` when the adapter settles on no session.
  - **Listener isolation.** Every adapter calls each `onAuthStateChange` subscriber in its own `try/catch`: a throwing subscriber no longer stops later ones from seeing a sign-out, and `MockAuthAdapter.signOut()` no longer rejects after signing out. Errors go to the new `onListenerError` option, or are rethrown in a microtask.
  - **Convex adapter.** Credentials sign-in now calls `signIn(passwordProviderId, { email, password, flow: 'signIn' })` (new option, default `'password'`, the stock Password provider), so it works against a default setup. A missing password is rejected, OAuth `redirectTo` is forwarded, and OAuth `scopes` are rejected because Convex configures them on the server. Convex errors map to `INVALID_CREDENTIALS`, `NETWORK_ERROR` and `PROVIDER_ERROR` instead of surfacing as `COMMAND_EXECUTION_ERROR`. The adapter reports `loading`, not `unauthenticated`, while `meQuery` is loading; returns the same adapter object on every render; no longer logs `console.debug` on every render in development; and its options type now accepts the real `useAuthActions()` result.
  - **Better Auth adapter.** Forwards OAuth `scopes` and reports its social sign-in redirect URL.
  - **Session sync.** Received messages are debounced per type, and `signed-out` is delivered at once, so a sign-out followed by another message is no longer dropped. Messages are a typed `SessionSyncMessage` union; received payloads are validated and stripped to known fields, and `notifySessionChanged()` throws a `TypeError` for an invalid message. `lockCheckDelayMs` now drives the new `acquireRefreshLockAsync()`, which reads the lock back after that delay before claiming it. A lock timestamp more than 1 s in the future is treated as stale instead of blocking refresh.

  Minor: new options and exports (`signInTimeoutMs`, `passwordProviderId`, `onListenerError`, `acquireRefreshLockAsync`, `SignInOutcome`, `AuthenticatedSessionState`, `SessionSyncMessage`, `AUTH_COMMAND_NAMES`).

### Patch Changes

- [#250](https://github.com/lushly-dev/afd/pull/250) [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470) Thanks [@Falkicon](https://github.com/Falkicon)! - Add a transport-free `@lushly-dev/afd-server/define` entry point. It exports `defineCommand`, `ZodCommandDefinition`, `ZodCommandOptions`, the schema helpers (`zodToJsonSchema`, `getRequiredFields`, `isObjectSchema`), the result helpers (`success`, `failure`, `error`, `isSuccess`, `isFailure`) and `defaultExpose`, and nothing in its module graph imports the MCP SDK or a Node.js builtin, so browser code can define commands (esbuild `--platform=browser` bundles it). The root entry is unchanged.

  To support it, `@lushly-dev/afd-core` adds two browser-safe subpaths, `@lushly-dev/afd-core/commands` and `@lushly-dev/afd-core/result`. `@lushly-dev/afd-auth/commands` now imports from `/define`, so it no longer loads the MCP transport either.

  Minor for server and core: new subpath exports, no changes to existing ones.

- Updated dependencies [[`389b351`](https://github.com/lushly-dev/afd/commit/389b35181238d23dc6857f7ca3d2398340e009b1), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`77a829c`](https://github.com/lushly-dev/afd/commit/77a829c531edf4ba352bd570da8ea12bed0cb92b), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`f943a5c`](https://github.com/lushly-dev/afd/commit/f943a5c55edfe16cc5b5e66ef1ec4948cd8cbdcc), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`389b351`](https://github.com/lushly-dev/afd/commit/389b35181238d23dc6857f7ca3d2398340e009b1), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`389b351`](https://github.com/lushly-dev/afd/commit/389b35181238d23dc6857f7ca3d2398340e009b1)]:
  - @lushly-dev/afd-core@2.0.0
  - @lushly-dev/afd-server@2.0.0

## 1.0.0

### Patch Changes

- Updated dependencies [[`b9eeeff`](https://github.com/lushly-dev/afd/commit/b9eeeff6502c922ea88ef7bc8a596025c13f7c95)]:
  - @lushly-dev/afd-server@1.0.0
  - @lushly-dev/afd-core@1.0.0

## 1.0.0

### Minor Changes

- ### Breaking Changes

  - **Node.js 22+ required** — dropped Node 20 support, CI tests on 22.x and 24.x
  - **Zod 4** — upgraded from Zod 3. `zod-to-json-schema` replaced with built-in `z.toJSONSchema()`. `ZodEffects` replaced by `ZodPipe` for transforms. Schema introspection uses `.unwrap()`/`.removeDefault()` instead of `._def.innerType`.
  - **eventsource 4** — named import (`{ EventSource }` instead of default), custom `fetch` option for headers instead of `EventSourceInitDict`. `@types/eventsource` removed (types now bundled).

  ### Other Updates

  - TypeScript target bumped to ES2024
  - All dependencies updated to latest: commander 14, conf 15, glob 13, ora 9, jsdom 28, dotenv 17, vite 8, commitlint 20
  - Replaced custom `scripts/release.mjs` with `@changesets/cli` for versioning and changelogs
  - Removed redundant eslint from React example (biome covers React hooks rules)
  - Refactored `direct.ts` — extracted `unknown-tool.ts` and `direct-validation.ts`
  - Refactored `executor.ts` — extracted `validator.ts`
  - CI now runs `pnpm check` (lefthook quality gate) to prevent local/CI desync

### Patch Changes

- Updated dependencies []:
  - @lushly-dev/afd-core@1.0.0
  - @lushly-dev/afd-server@1.0.0
