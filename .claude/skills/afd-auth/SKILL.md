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

## AuthAdapter Interface

```typescript
interface AuthAdapter {
  signIn(options: SignInOptions): Promise<void>;
  signOut(): Promise<void>;
  getSession(): AuthSessionState;
  onAuthStateChange(callback: (state: AuthSessionState) => void): { unsubscribe: () => void };
}
```

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
  exclude: ['auth-sign-in', 'auth-session-get'], // public commands
});

// Unauthenticated → failure(UNAUTHORIZED, retryable: false)
// Loading → failure(UNAUTHORIZED, retryable: true)
// Authenticated → injects context.auth, calls next()
```

## AFD Commands

`createAuthCommands(adapter)` returns three `CommandDefinition[]`:

| Command | mutation | destructive | expose |
|---------|----------|-------------|--------|
| `auth-sign-in` | true | false | palette/agent/cli (NOT mcp) |
| `auth-sign-out` | true | true | palette/agent/cli (NOT mcp) |
| `auth-session-get` | false | false | palette/agent/cli/mcp |

Requires `@lushly-dev/afd-server` + `zod` as peer dependencies.

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

## Built-in Adapters

### MockAuthAdapter (Testing)

```typescript
import { MockAuthAdapter } from '@lushly-dev/afd-auth';

const adapter = new MockAuthAdapter({ delay: 50 });

// Test helpers
adapter._setUser({ id: 'u1', email: 'test@example.com' });
adapter._setLoading();
adapter._reset();
adapter._triggerError('INVALID_CREDENTIALS');
adapter._getListenerCount();
```

### useConvexAuthAdapter (React Hook)

```typescript
import { useConvexAuthAdapter } from '@lushly-dev/afd-auth';

const adapter = useConvexAuthAdapter({
  useAuthActions: () => useAuthActions(),
  useConvexAuth: () => useConvexAuth(),
  meQuery: () => useQuery(api.users.me),
});
```

Synthetic `expiresAt` (24h) — Convex manages tokens internally.

### BetterAuthAdapter

```typescript
import { BetterAuthAdapter } from '@lushly-dev/afd-auth';

const adapter = new BetterAuthAdapter({ client: authClient });
// Bridges nanostore .subscribe() to onAuthStateChange callback pattern
adapter.dispose(); // cleanup
```

## React Hooks

Sub-path import — no React dependency on main entrypoint:

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
  debounceMs: 100,                  // Rapid-fire protection
  visibilityRefreshMs: 300_000,     // Re-check after 5min hidden
});

sync.notifySessionChanged(data);     // Broadcast to other tabs
sync.onSessionChanged(callback);     // Subscribe to changes
sync.acquireRefreshLock();           // Coordinate token refresh
sync.releaseRefreshLock();
sync.dispose();                      // Cleanup
```

BroadcastChannel primary, localStorage `storage` event fallback. SSR-safe.

## Package Structure

```
packages/auth/src/
├── index.ts              # Main export (zero React dependency)
├── types.ts              # AuthAdapter, AuthSessionState, Session, User
├── errors.ts             # AuthAdapterError, AuthErrorCode
├── middleware.ts          # createAuthMiddleware()
├── commands.ts            # createAuthCommands()
├── session-sync.ts        # SessionSync class
├── react.ts              # Sub-path: createAuthHooks()
└── adapters/
    ├── mock.ts            # MockAuthAdapter
    ├── convex.ts          # useConvexAuthAdapter()
    └── better-auth.ts     # BetterAuthAdapter
```
