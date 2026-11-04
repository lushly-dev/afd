---
name: afd-auth
description: >
  Adds sign-in to AFD apps with @lushly-dev/afd-auth: the AuthAdapter contract, auth
  middleware, auth-* commands, SessionSync across tabs, React hooks and the Mock, Convex
  and Better Auth adapters. Use when gating commands behind sign-in or writing an adapter;
  for approval gates, see afd-typescript.
---

# AFD auth

`packages/auth/README.md` is the package reference. The package is in the fixed `afd-npm` release group: read its version in `packages/auth/package.json`, and the published one with `npm view @lushly-dev/afd-auth version`.

| Import | Exports | Needs |
|---|---|---|
| `@lushly-dev/afd-auth` | the types, `createAuthMiddleware`, `AuthAdapterError`, `SessionSync`, `AUTH_COMMAND_NAMES`, `MockAuthAdapter`, `BetterAuthAdapter`, `LOADING`, `UNAUTHENTICATED` | afd-core only: no React, server or Zod |
| `/commands` | `createAuthCommands`, `createAuthSessionGetCommand`, `createAuthMutationCommands` | peers `@lushly-dev/afd-server`, `zod` |
| `/react` | `createAuthHooks`, `useConvexAuthAdapter` | peer `react` |

## Session state and the adapter contract

```typescript
type AuthSessionState =
  | { status: 'unauthenticated'; session: null; user: null }
  | { status: 'loading'; session: null; user: null }
  | { status: 'authenticated'; session: Session; user: User };

interface AuthAdapter {
  signIn(options: SignInOptions): Promise<SignInOutcome | void>;
  signOut(): Promise<void>;
  getSession(): AuthSessionState;
  onAuthStateChange(callback: (state: AuthSessionState) => void): { unsubscribe: () => void };
}

type SignInOutcome =
  | { kind: 'signed-in' }               // accepted; the session may arrive later via onAuthStateChange
  | { kind: 'redirect'; url?: string }  // OAuth continues at the provider
  | { kind: 'pending' };                // another step first, such as email verification
```

- Check `status` before reading `user`. There is no `refreshing` state.
- `Session` is `{ id, expiresAt? }`, with no token: tokens stay inside the adapter. Omit `expiresAt` when the provider reports none (Convex); never invent one.
- `SignInOptions` is `{ method: 'credentials', email, password? }` or `{ method: 'oauth', provider, scopes?, redirectTo? }`. Resolving `signIn()` with nothing counts as `signed-in`.
- Call each subscriber in isolation, so one that throws neither stops the others nor makes `signIn()` reject. The built-in adapters do it with `ListenerSet` (`src/listeners.ts`, not exported) and report the error to their `onListenerError` option.
- Throw `AuthAdapterError` so commands map it: `invalidCredentials()`, `tokenExpired()` and `providerError(name, details?)` are not retryable; `networkError()` and `refreshFailed()` are.

## Middleware

`createAuthMiddleware(adapter, { exclude? })`:

| Adapter state | Result |
|---|---|
| `unauthenticated` | `UNAUTHORIZED`, not retryable |
| `loading` | `UNAUTHORIZED`, retryable |
| `authenticated`, `expiresAt` at or before now, or invalid | `TOKEN_EXPIRED`, retryable (the provider may refresh first) |
| `authenticated` | sets `context.auth`, fills `context.actor`, runs the command |

- `auth-sign-in`, `auth-sign-out` and `auth-session-get` (`AUTH_COMMAND_NAMES`) always pass; `exclude` only adds names.
- `context.auth` is set or deleted on every call, excluded commands included, so a caller-supplied value never reaches a handler. A module augmentation types it as `AuthenticatedSessionState | undefined`.
- A `human` or missing actor becomes `{ kind: 'human', id: user.id, label: user.name }`. An `agent`, `service` or `script` actor keeps its identity and gets `onBehalfOf: user.id`, replacing any the caller set. Install `createApprovalMiddleware` after this, so tokens bind to that actor.

## Commands

`createAuthCommands(adapter, { signInTimeoutMs? })` returns three commands on Zod Mini (`defineCommandWithSchema`), so a browser bundles no classic Zod for them. A staged host can take `createAuthSessionGetCommand(adapter)` first and `createAuthMutationCommands(adapter, options)` later.

| Command | `mutation` | `destructive` | `expose` |
|---|---|---|---|
| `auth-sign-in` | true | false | palette, agent, cli; not mcp |
| `auth-sign-out` | true | true, with `confirmPrompt` | palette, agent, cli; not mcp |
| `auth-session-get` | false | false | palette, agent, cli, mcp |

`auth-sign-in` never reports a stale state as signed in:

- A `redirect` or `pending` outcome returns the current state, "Not signed in yet" reasoning, and a `SIGN_IN_REDIRECT` (URL in `details.url`) or `SIGN_IN_PENDING` warning.
- Otherwise it waits for the next non-loading `onAuthStateChange`, up to `signInTimeoutMs` (default 10 s), and returns the new session. On timeout it returns the current state with `SIGN_IN_PENDING`; if the adapter settles on no session it fails with `PROVIDER_ERROR`.
- An `AuthAdapterError` becomes a failure with its code, suggestion and retryable flag.
- The journal middleware skips `auth-*` commands by default, since sign-in takes a password.

## Built-in adapters

**`MockAuthAdapter`** (tests): `new MockAuthAdapter({ delay?, onListenerError? })`, with `_setUser(user, sessionOverrides?)` (`{ expiresAt: new Date(0) }` for expired), `_setLoading()`, `_reset()` and `_getListenerCount()`. `_triggerError(code)` only returns an `AuthAdapterError`; it does not make `signIn` fail. The user id is `mock-user-<email>`, stable across reloads and replays.

**`useConvexAuthAdapter`** (`/react`): takes `useAuthActions`, `useConvexAuth`, `meQuery` (`() => useQuery(api.users.me)`) and `passwordProviderId` (default `'password'`, the stock `Password()` id).

- Credentials call `signIn(passwordProviderId, { email, password, flow: 'signIn' })`; a missing password is `INVALID_CREDENTIALS`. OAuth forwards `redirectTo` and rejects `scopes` with `PROVIDER_ERROR`: set them on the provider in `convex/auth.ts`.
- `InvalidAccountId`, `InvalidSecret` and `Invalid credentials` map to `INVALID_CREDENTIALS`, fetch failures to `NETWORK_ERROR`, the rest to `PROVIDER_ERROR`; production Convex hides error text unless it is a `ConvexError`, so bad credentials there are `PROVIDER_ERROR`.
- `loading` while `meQuery` returns `undefined`, `unauthenticated` on `null`. No `expiresAt`: Convex refreshes its JWT itself. The hook returns the same adapter on every render.
- Convex module filenames allow only letters, digits, underscores and periods; a hyphenated one fails deployment (`packages/auth/hosted/convex/module-paths.mjs` checks this).

**`BetterAuthAdapter`**: `new BetterAuthAdapter({ client, onListenerError? })` bridges the client's `useSession` nanostore to `onAuthStateChange`; `dispose()` unsubscribes. It forwards OAuth `scopes` and `redirectTo` (as `callbackURL`) to `signIn.social` and reports the redirect as a `redirect` outcome. A credentials 401 is `INVALID_CREDENTIALS`.

## React hooks

`createAuthHooks(adapter)` returns `{ useAuth, useSession, useUser }`. `useSession` caches the `useSyncExternalStore` snapshot by value, so an adapter returning a new object from every `getSession()` does not loop; the server snapshot is `LOADING`.

## Session sync across tabs

- `new SessionSync(options?)` never touches the adapter: the app calls `notifySessionChanged(message)` on its own changes and refetches provider state in `onSessionChanged(callback)`. BroadcastChannel first, localStorage `storage` events as fallback; SSR-safe. Call `dispose()` when done.
- Messages: `signed-in` and `profile-updated` (optional `userId`), `signed-out`, `session-refreshed`, and `visibility-refresh` (also raised locally after `visibilityRefreshMs` hidden, default 5 min). Received payloads are validated and stripped; an invalid outgoing one throws `TypeError`. `signed-out` is delivered at once and cancels older pending messages; other types are debounced per type.
- The refresh lock is best effort: `acquireRefreshLockAsync()` writes, waits `lockCheckDelayMs` and reads back (`acquireRefreshLock()` is the synchronous form), and only the owner can `releaseRefreshLock()`. localStorage has no compare-and-swap, so a simultaneous race can still let two tabs in.

## Layout and verification

In `packages/auth/src/`, `index.ts`, `commands.ts` and `react.ts` are the entries; the commands live in `session-get-command.ts` and `mutation-commands.ts`, the adapters in `adapters/`, and each other module is named for what it exports. `browser/` holds the Chromium suite (`pnpm -F @lushly-dev/afd-auth test:browser`), `hosted/` the Better Auth and Convex fixtures.

- Local, credential-free hosted checks and fixture setup: `docs/operations/hosted-verification.md` and the `packages/auth/hosted/*/README.md` files; run `pnpm test:hosted:local`.
- What the last hosted round proved and left open: `docs/operations/hosted-verification-round.md`. A new round needs fresh, scoped authorization before anything is provisioned.
