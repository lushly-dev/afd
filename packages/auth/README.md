# @lushly-dev/afd-auth

Provider-agnostic authentication adapters for AFD applications. The main
entrypoint exposes the `AuthAdapter` contract, structured auth errors, the auth
middleware, multi-tab session synchronization, and the Mock and Better Auth
adapters.

Auth command definitions are available from the optional commands subpath:

```ts
import { createAuthCommands } from '@lushly-dev/afd-auth/commands';

const authCommands = createAuthCommands(adapter, { signInTimeoutMs: 10_000 });
```

React hooks are available from the optional `@lushly-dev/afd-auth/react`
subpath:

```ts
import { createAuthHooks, useConvexAuthAdapter } from '@lushly-dev/afd-auth/react';

const { useSession, useUser } = createAuthHooks(adapter);
```

The root import stays usable for server and non-React consumers without
installing React, `@lushly-dev/afd-server`, or `zod`. Import
`useConvexAuthAdapter` from `/react` and `createAuthCommands` from `/commands`
when those integrations are needed.

## Middleware

```ts
import { createAuthMiddleware } from '@lushly-dev/afd-auth';

const middleware = createAuthMiddleware(adapter, { exclude: ['public-cmd'] });
```

| Adapter state | Result |
| --- | --- |
| `unauthenticated` | `UNAUTHORIZED`, not retryable |
| `loading` | `UNAUTHORIZED`, retryable |
| `authenticated`, `session.expiresAt` at or before now (or not a valid date) | `TOKEN_EXPIRED`, retryable |
| `authenticated` | sets `context.auth` and runs the command |

- The built-in commands `auth-sign-in`, `auth-sign-out` and `auth-session-get`
  (`AUTH_COMMAND_NAMES`) always run, so a signed-out caller can sign in.
  `exclude` adds more commands.
- The middleware sets or deletes `context.auth` on every call, excluded
  commands included. A handler never sees a `context.auth` that the caller
  supplied.
- Importing the package types `context.auth` as
  `AuthenticatedSessionState | undefined` through a `CommandContext` module
  augmentation.
- `Session.expiresAt` is optional. A session without it (Convex) is never
  rejected as expired; the provider manages the token lifetime.

## Sign-in results

`AuthAdapter.signIn()` may resolve with a `SignInOutcome`:
`{ kind: 'signed-in' }`, `{ kind: 'redirect', url? }` (OAuth continues at the
provider) or `{ kind: 'pending' }` (another step, such as email verification).
Resolving with nothing is still allowed and counts as `signed-in`.

`auth-sign-in` uses it to report what happened:

- `redirect` / `pending`: returns the current (not yet signed-in) state with
  "Not signed in yet" reasoning and a `SIGN_IN_REDIRECT` or `SIGN_IN_PENDING`
  warning. The redirect URL is in the warning's `details.url`.
- otherwise: waits for the next non-loading `onAuthStateChange`, up to
  `signInTimeoutMs` (default 10 s), and returns the new session. If the wait
  runs out it returns the current state with a `SIGN_IN_PENDING` warning; if
  the adapter settles on no session it fails with `PROVIDER_ERROR`.

## Adapters

All adapters accept `onListenerError`. Each `onAuthStateChange` subscriber
runs in its own `try/catch`: one that throws does not stop the others from
seeing the change, and does not make `signIn()`/`signOut()` reject. The error
goes to `onListenerError`, or is rethrown in a microtask when none is set.

### Convex

```ts
const adapter = useConvexAuthAdapter({
  useAuthActions,
  useConvexAuth,
  meQuery: () => useQuery(api.users.me),
  passwordProviderId: 'password', // default: the stock Password() provider
});
```

- Credentials sign-in calls `signIn(passwordProviderId, { email, password, flow: 'signIn' })`.
  A missing password is rejected with `INVALID_CREDENTIALS`.
- OAuth sign-in forwards `redirectTo`. `scopes` are rejected with
  `PROVIDER_ERROR`: Convex configures scopes on the provider in
  `convex/auth.ts`.
- Errors use the same codes as Better Auth: `InvalidAccountId`,
  `InvalidSecret` and `Invalid credentials` become `INVALID_CREDENTIALS`, fetch
  failures `NETWORK_ERROR`, everything else `PROVIDER_ERROR`. Production
  Convex deployments hide server error text unless it is thrown as a
  `ConvexError`, so there bad credentials surface as `PROVIDER_ERROR`.
- The state is `loading` while `meQuery` returns `undefined`, and
  `unauthenticated` when it returns `null`.
- The session has no `expiresAt`, because Convex refreshes its token
  internally.
- The hook returns the same adapter object on every render.

### Better Auth

`BetterAuthAdapter` forwards OAuth `scopes` and `redirectTo` (as
`callbackURL`) to `signIn.social`, and reports its redirect URL as a
`redirect` outcome.

## Session sync

`SessionSync` exchanges typed `SessionSyncMessage` values: `signed-in`,
`signed-out`, `session-refreshed`, `profile-updated` (both with an optional
`userId`) and `visibility-refresh`. Received payloads are validated and reduced
to those fields; `notifySessionChanged()` throws a `TypeError` for an invalid
message.

Received messages are debounced per type by `debounceMs`. `signed-out` is
delivered at once and cancels older messages still waiting, so it is never
coalesced away.

`SessionSync.acquireRefreshLock()` and `releaseRefreshLock()` provide a
synchronous best-effort fallback for coordinating refreshes between tabs. The
fallback records an instance owner and only that owner can release its current
lock. `acquireRefreshLockAsync()` waits `lockCheckDelayMs` after writing the
lock and reads it back before claiming it, which catches most write races. A
lock timestamp more than one second in the future counts as stale.
`localStorage` does not provide compare-and-swap, so acquisition remains
non-atomic under a simultaneous cross-tab race; applications that require
stronger serialization should use a provider-level refresh mechanism.
