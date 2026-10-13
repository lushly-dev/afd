---
name: afd-auth
description: >
  Provider-agnostic authentication adapter for AFD applications.
  Covers AuthAdapter interface, discriminated union session states,
  middleware for auth-gated commands, AFD command wrappers, multi-tab
  session sync, React hooks, and built-in adapters (Mock, Convex, BetterAuth).
  Triggers: auth, authentication, sign-in, sign-out, session, auth adapter,
  auth middleware, auth commands, convex auth, better-auth.
---

# AFD Auth Patterns

`@lushly-dev/afd-auth` provides provider-agnostic authentication for AFD applications.

## Core Design

Three session states as a discriminated union — TypeScript enforces `status` check before accessing `user`:

```typescript
type AuthSessionState =
  | { status: 'unauthenticated'; session: null; user: null }
  | { status: 'loading'; session: null; user: null }
  | { status: 'authenticated'; session: Session; user: User };

// Type-safe access
const state = adapter.getSession();
if (state.status === 'authenticated') {
  console.log(state.user.email); // TS knows user exists
}
```

No `token` on `Session` — tokens are internal to adapter implementations.
No `refreshing` state — deferred to future versions.

`Session` is `{ id: string; expiresAt?: Date }`. `expiresAt` is omitted when the
provider manages the token lifetime and does not report an expiry (Convex);
never invent one. `AuthenticatedSessionState` is the `authenticated` member of
the union.

## AuthAdapter Interface

```typescript
interface AuthAdapter {
  signIn(options: SignInOptions): Promise<SignInOutcome | void>;
  signOut(): Promise<void>;
  getSession(): AuthSessionState;
  onAuthStateChange(callback: (state: AuthSessionState) => void): { unsubscribe: () => void };
}

type SignInOutcome =
  | { kind: 'signed-in' }                  // accepted; the session may arrive later via onAuthStateChange
  | { kind: 'redirect'; url?: string }     // OAuth continues at the provider
  | { kind: 'pending' };                   // another step first, e.g. email verification
```

Resolving `signIn()` with nothing is still allowed and counts as `signed-in`.
Adapters must call each `onAuthStateChange` subscriber in isolation: use the
shared `ListenerSet` (`src/listeners.ts`), which reports a throwing subscriber
to the adapter's `onListenerError` option (or rethrows it in a microtask) and
keeps notifying the rest.

`SignInOptions` is a discriminated union on `method`:

```typescript
type SignInOptions =
  | { method: 'credentials'; email: string; password?: string }
  | { method: 'oauth'; provider: Provider; scopes?: string[]; redirectTo?: string };
```

## Auth Middleware

Gates commands behind authentication using `CommandMiddleware` from `@lushly-dev/afd-core`:

```typescript
import { createAuthMiddleware } from '@lushly-dev/afd-auth';

const middleware = createAuthMiddleware(adapter, {
  exclude: ['public-cmd'], // extra public commands
});

// Unauthenticated → failure(UNAUTHORIZED, retryable: false)
// Loading → failure(UNAUTHORIZED, retryable: true)
// Authenticated, expiresAt <= now (or invalid) → failure(TOKEN_EXPIRED, retryable: true)
// Authenticated → sets context.auth, calls next()
```

- `auth-sign-in`, `auth-sign-out` and `auth-session-get` (`AUTH_COMMAND_NAMES`)
  always pass; `exclude` only adds commands.
- `context.auth` is set or deleted on every call, excluded commands included,
  so a caller-supplied value never reaches a handler.
- A module augmentation types `context.auth` as
  `AuthenticatedSessionState | undefined` — no cast needed in handlers.

## AFD Commands

`createAuthCommands(adapter, { signInTimeoutMs? })` returns three `CommandDefinition[]`:

| Command | mutation | destructive | expose |
|---------|----------|-------------|--------|
| `auth-sign-in` | true | false | palette/agent/cli (NOT mcp) |
| `auth-sign-out` | true | true | palette/agent/cli (NOT mcp) |
| `auth-session-get` | false | false | palette/agent/cli/mcp |

Requires `@lushly-dev/afd-server` + `zod` as peer dependencies.

`auth-sign-in` never reports a stale state as "Signed in":

- `redirect` / `pending` outcome → current state, "Not signed in yet"
  reasoning, `SIGN_IN_REDIRECT` (URL in `details.url`) or `SIGN_IN_PENDING`
  warning.
- Otherwise it waits for the next non-loading `onAuthStateChange`, up to
  `signInTimeoutMs` (default 10 s), and returns the new session. Timeout →
  current state + `SIGN_IN_PENDING` warning. Settles on no session →
  `PROVIDER_ERROR` failure.

The command factory is an optional integration and lives at the explicit
`@lushly-dev/afd-auth/commands` subpath. Existing consumers should migrate
from the root import:

```typescript
// Before
import { createAuthCommands } from '@lushly-dev/afd-auth';

// After
import { createAuthCommands } from '@lushly-dev/afd-auth/commands';
```

## Error Handling

```typescript
import { AuthAdapterError } from '@lushly-dev/afd-auth';

// Static factories
AuthAdapterError.invalidCredentials()  // retryable: false
AuthAdapterError.tokenExpired()        // retryable: false
AuthAdapterError.providerError(name)   // retryable: false
AuthAdapterError.networkError()        // retryable: true
AuthAdapterError.refreshFailed()       // retryable: true
```

The middleware's own `TOKEN_EXPIRED` failure is retryable: the provider may
refresh the session before the retry.

## Built-in Adapters

### MockAuthAdapter (Testing)

```typescript
import { MockAuthAdapter } from '@lushly-dev/afd-auth';

const adapter = new MockAuthAdapter({ delay: 50, onListenerError });

// Test helpers
adapter._setUser({ id: 'u1', email: 'test@example.com' });
adapter._setUser(user, { expiresAt: new Date(0) });      // expired session
adapter._setUser(user, { expiresAt: undefined });        // no expiry
adapter._setLoading();
adapter._reset();
adapter._triggerError('INVALID_CREDENTIALS');
adapter._getListenerCount();
```

### useConvexAuthAdapter (React Hook)

```typescript
import { useConvexAuthAdapter } from '@lushly-dev/afd-auth/react';

const adapter = useConvexAuthAdapter({
  useAuthActions: () => useAuthActions(),
  useConvexAuth: () => useConvexAuth(),
  meQuery: () => useQuery(api.users.me),
  passwordProviderId: 'password', // default; set if Password({ id }) is customised
});
```

- Credentials → `signIn(passwordProviderId, { email, password, flow: 'signIn' })`;
  a missing password is rejected with `INVALID_CREDENTIALS`.
- OAuth → forwards `redirectTo`; rejects `scopes` (configure them on the
  provider in `convex/auth.ts`).
- Errors map to the Better Auth codes: `InvalidAccountId` / `InvalidSecret` /
  `Invalid credentials` → `INVALID_CREDENTIALS`, fetch failures →
  `NETWORK_ERROR`, rest → `PROVIDER_ERROR` (production deployments hide
  server text unless thrown as `ConvexError`).
- `loading` while `meQuery` returns `undefined`; `unauthenticated` on `null`.
- No `expiresAt` — Convex refreshes its JWT internally.
- Returns the same adapter object on every render.

### BetterAuthAdapter

```typescript
import { BetterAuthAdapter } from '@lushly-dev/afd-auth';

const adapter = new BetterAuthAdapter({ client: authClient, onListenerError });
// Bridges nanostore .subscribe() to onAuthStateChange callback pattern
adapter.dispose(); // cleanup
```

Forwards OAuth `scopes` and `redirectTo` (as `callbackURL`); reports the
social sign-in URL as a `redirect` outcome.

The implementation merged in #367 accepts the vanilla client's `useSession` nanostore
object and legacy function accessors, preserving the accessor's receiver. It
normalizes nullable provider `user.image` to the adapter's optional image field.
A local integration test uses an actual Better Auth 1.7.2 server, memory database,
vanilla client and loopback sockets for credentials, cookies, session read-back,
expiry mapping, sign-out/revocation and subscription notifications. The opt-in
`pnpm -F @lushly-dev/afd-auth test:browser` harness adds actual Chromium tabs,
React hooks, HttpOnly/SameSite cookie metadata, sign-in/out synchronization through
BroadcastChannel and the localStorage fallback, refresh-lock ownership, provider
session renewal/expiry and independent revoked/expired-cookie replay. It uses
loopback HTTP and a disposable memory provider. These checks do not prove HTTPS
Secure-cookie or cross-site SameSite enforcement, OAuth callbacks/upstream token
refresh, simultaneous lock atomicity, other browser engines or Convex deployment.
The additional `packages/auth/hosted/better-auth/` fixture runs actual HTTPS,
local OAuth callbacks and SQLite-backed provider restart. Run the repository-root
`pnpm test:hosted:local` on Node 24 with Chromium for this lifecycle, Convex SDK
fixture checks and durable REST/view-state restart checks. The Convex fixture in
`packages/auth/hosted/convex/` uses real SDKs and deployable functions; local build
success does not establish live provider behavior. External opt-in runs require
explicit disposable-service configuration and assertion/cleanup receipts; missing
configuration fails preflight. Keep #362 open pending hosted execution. See
`docs/operations/hosted-verification.md` and the fixture READMEs for setup.
Registry publication is separate from merged source behavior. The hosted fixtures
import reviewed workspace source; a receipt version is not registry installation
evidence. The published npm baseline is 2.1.0; use the current release record and
[package-update process](../do-release/references/next-round.md) before the next
version change. See [the next hosted round](../../../docs/operations/hosted-verification-round.md)
for proposed resources and the local preparation gate before provisioning.
The [Render operator recipe](../../../docs/operations/hosted-render.md) covers
the two disposable services, exact source/resource ledger and local control
helper. Its injected-response tests run in `pnpm test:hosted:local`; provider
deployment, restart and deletion readbacks still require an authorized hosted run.

## React Hooks

Sub-path import — no React dependency on the main entrypoint:

```typescript
import { createAuthHooks } from '@lushly-dev/afd-auth/react';

const { useAuth, useSession, useUser } = createAuthHooks(adapter);

// useSession uses useSyncExternalStore for tear-free reads
// useUser returns User | null (extracted from session)
```

## Session Sync (Multi-Tab)

```typescript
import { SessionSync } from '@lushly-dev/afd-auth';

const sync = new SessionSync({
  channelName: 'afd-auth-session',  // BroadcastChannel name
  lockTimeoutMs: 10_000,            // Stale lock threshold
  lockCheckDelayMs: 50,             // acquireRefreshLockAsync() read-back delay
  debounceMs: 100,                  // Per-type debounce (not signed-out)
  visibilityRefreshMs: 300_000,     // Re-check after 5min hidden
});

sync.notifySessionChanged({ type: 'signed-out' }); // Broadcast to other tabs
sync.onSessionChanged((message) => {});            // Subscribe to changes
sync.acquireRefreshLock();                         // Coordinate token refresh (sync, best effort)
await sync.acquireRefreshLockAsync();              // Write, wait, read back
sync.releaseRefreshLock();
sync.dispose();                                    // Cleanup
```

`SessionSyncMessage` = `signed-in` / `profile-updated` (optional `userId`),
`signed-out`, `session-refreshed`, `visibility-refresh`. Incoming payloads are
validated and stripped to those fields; invalid outgoing messages throw
`TypeError`. `signed-out` is delivered at once and cancels older pending
messages; other types are debounced per type. Lock timestamps more than 1 s
in the future count as stale.

BroadcastChannel primary, localStorage `storage` event fallback. SSR-safe.

## Package Structure

```
packages/auth/src/
├── index.ts              # Main export (core only; zero React/server/zod imports)
├── types.ts              # AuthAdapter, AuthSessionState, Session, User, SignInOutcome
├── errors.ts             # AuthAdapterError, AuthErrorCode
├── listeners.ts          # ListenerSet — isolated subscriber fan-out
├── session-state.ts      # areSessionStatesEqual, isSessionExpired
├── command-names.ts      # AUTH_COMMAND_NAMES
├── middleware.ts          # createAuthMiddleware(), CommandContext.auth augmentation
├── commands.ts            # Sub-path: createAuthCommands()
├── session-sync.ts        # SessionSync class
├── session-sync-message.ts # SessionSyncMessage union + validation
├── react.ts              # Sub-path: createAuthHooks()
└── adapters/
    ├── mock.ts            # MockAuthAdapter
    ├── convex.ts          # useConvexAuthAdapter()
    ├── better-auth.ts     # BetterAuthAdapter
    └── provider-errors.ts # Shared network / error-text helpers
```
