# Auth Adapter Pattern

> Proposal: Provider-agnostic authentication layer enabling zero-friction migration

---
status: active
created: 2026-01-11
updated: 2026-01-31
origin: Discussion on stack choices (Convex + BetterAuth vs Stytch/Supabase)
effort: M (3-5 days)
spec: [spec.md](./spec.md)
---

## Problem

Auth provider lock-in creates migration nightmares. Choosing BetterAuth today shouldn't prevent moving to Stytch/Supabase later.

## Relationship to Existing Convex Auth

The Lushly ecosystem currently uses `@convex-dev/auth` in production (e.g., `AFD/demos/todo/`). This proposal does **NOT replace** Convex Auth — it **wraps** it for client-side consumption.

**Architecture:**

```
┌─────────────────────────────────────────────────────────────┐
│                      CLIENT (React/FAST)                     │
│                                                             │
│   AuthAdapter Interface  ◄────  App code imports only this  │
│         │                                                   │
│         ▼                                                   │
│   ConvexAuthAdapter  ◄────  Wraps @convex-dev/auth client   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      SERVER (Convex)                         │
│                                                             │
│   @convex-dev/auth  ◄────  Server-side auth (unchanged)     │
│   convexAuth({ providers: [...] })                          │
└─────────────────────────────────────────────────────────────┘
```

**Boundary:**
- **Server-side**: `@convex-dev/auth` remains the source of truth for session validation, token issuance, and provider configuration
- **Client-side**: `AuthAdapter` provides a swappable abstraction layer

**Migration path**: None needed. `ConvexAuthAdapter` will be the default implementation, wrapping the existing `@convex-dev/auth` client hooks.

## Proposed Solution

**Auth Adapter Interface** — same pattern as AFD commands, using discriminated unions for type-safe session state:

```typescript
/**
 * Discriminated union prevents accessing user data while loading/null.
 * Forces consumers to check status before accessing properties.
 */
export type AuthSessionState =
  | { status: 'unauthenticated'; session: null; user: null }
  | { status: 'loading'; session: null; user: null }
  | { status: 'authenticated'; session: Session; user: User };

/** Built-in providers with known behavior */
type BuiltInProvider = 'github' | 'google' | 'email';

/** Extensible provider type — allows any string for custom providers */
type Provider = BuiltInProvider | (string & {});

/** OAuth options for social providers */
interface OAuthOptions {
  scopes?: string[];
  redirectTo?: string;
}

export interface AuthAdapter {
  /** Sign in via OAuth provider or email/password */
  signIn(provider: Provider, options?: EmailCredentials | OAuthOptions): Promise<void>;
  
  /** Sign out and clear session */
  signOut(): Promise<void>;
  
  /** Get current session (async for Edge Runtime compatibility) */
  getSession(): Promise<AuthSessionState>;
  
  /** Subscribe to auth state changes (returns unsubscribe function) */
  onAuthStateChange(callback: (state: AuthSessionState) => void): { unsubscribe: () => void };
}

interface Session {
  id: string;
  expiresAt: Date;
  token: string;
}

interface User {
  id: string;
  email: string;
  name?: string;
  image?: string;
}

interface EmailCredentials {
  email: string;
  password?: string;  // Optional for magic link
}
```

### Provider Extensibility

The `Provider` type uses TypeScript's branded string pattern to allow any OAuth provider while preserving autocomplete for common ones:

```typescript
// Built-in providers get autocomplete
await adapter.signIn('github');
await adapter.signIn('google');

// Custom providers work without interface changes
await adapter.signIn('microsoft', { scopes: ['openid', 'profile'] });
await adapter.signIn('apple');
await adapter.signIn('okta-enterprise');
```

### Implementations

| Adapter | Use Case |
|---------|----------|
| `ConvexAuthAdapter` | Default — wraps `@convex-dev/auth` client |
| `BetterAuthAdapter` | Self-hosted, OSS, TypeScript-native |
| `StytchAdapter` | Enterprise, passwordless-first |
| `SupabaseAuthAdapter` | PostgreSQL ecosystem |
| `MockAuthAdapter` | Testing (Vitest, Playwright) |

## ConvexAuthAdapter Implementation

> **Note:** The code below is illustrative. The actual implementation in [auth-adapter.spec.md](./auth-adapter.spec.md) uses the verified Convex Auth API (`useAuthToken()`, `useAuthActions()`) which differs from the conceptual `useConvexAuth()` shown here.

```typescript
import { useConvexAuth } from "@convex-dev/auth/react";

export class ConvexAuthAdapter implements AuthAdapter {
  private convex = useConvexAuth();
  
  async signIn(provider: Provider, options?: EmailCredentials | OAuthOptions) {
    await this.convex.signIn(provider, options);
  }

  async signOut() {
    await this.convex.signOut();
  }

  async getSession(): Promise<AuthSessionState> {
    if (this.convex.isLoading) {
      return { status: 'loading', session: null, user: null };
    }
    if (!this.convex.isAuthenticated) {
      return { status: 'unauthenticated', session: null, user: null };
    }
    return { 
      status: 'authenticated', 
      session: this.convex.session, 
      user: this.convex.user 
    };
  }

  onAuthStateChange(callback: (state: AuthSessionState) => void) {
    // Subscribe to Convex auth state changes
    return this.convex.subscribe(callback);
  }
}
```

## BetterAuth Implementation

```typescript
import { createAuthClient } from "better-auth/client";

const betterAuthClient = createAuthClient({
  baseURL: process.env.BETTER_AUTH_URL
});

export class BetterAuthAdapter implements AuthAdapter {
  async signIn(provider: Provider, options?: EmailCredentials | OAuthOptions) {
    if (provider === 'email' && options && 'email' in options) {
      await betterAuthClient.signIn.email(options);
    } else {
      await betterAuthClient.signIn.social({ provider, ...options });
    }
  }

  async signOut() {
    await betterAuthClient.signOut();
  }

  async getSession(): Promise<AuthSessionState> {
    const { data, isPending } = await betterAuthClient.getSession();
    if (isPending) return { status: 'loading', session: null, user: null };
    if (!data) return { status: 'unauthenticated', session: null, user: null };
    return { status: 'authenticated', session: data.session, user: data.user };
  }

  onAuthStateChange(callback: (state: AuthSessionState) => void) {
    // BetterAuth uses nanostores — bridge to standard subscription
    const unsubscribe = betterAuthClient.useSession.subscribe((sessionData) => {
      if (sessionData.isPending) {
        callback({ status: 'loading', session: null, user: null });
      } else if (sessionData.data) {
        callback({ status: 'authenticated', session: sessionData.data.session, user: sessionData.data.user });
      } else {
        callback({ status: 'unauthenticated', session: null, user: null });
      }
    });
    return { unsubscribe };
  }
}
```

## Token Refresh Strategy

Token refresh is handled transparently by the underlying provider. The adapter surfaces refresh state via `AuthSessionState`:

```typescript
/** Extended state for refresh awareness */
export type AuthSessionState =
  | { status: 'unauthenticated'; session: null; user: null }
  | { status: 'loading'; session: null; user: null }
  | { status: 'refreshing'; session: Session; user: User }  // Token refresh in progress
  | { status: 'authenticated'; session: Session; user: User };
```

**Refresh triggers:**
- **Proactive**: Refresh when token has <5 min remaining (background)
- **Reactive**: Refresh on 401 response (retry original request)
- **Tab focus**: Check session validity when tab becomes visible

**Failure handling:**
1. Retry refresh up to 3 times with exponential backoff
2. On persistent failure, emit `status: 'unauthenticated'`
3. Show non-blocking toast: "Session expired. Please sign in again."

## Multi-Tab Session Synchronization

Session state must stay consistent across browser tabs:

```typescript
class SessionSync {
  private channel = new BroadcastChannel('auth-session');
  
  constructor(private adapter: AuthAdapter) {
    // Primary: BroadcastChannel (instant, no storage events)
    this.channel.onmessage = (e) => {
      if (e.data.type === 'session-changed') {
        this.adapter.getSession().then(/*...*/);
      }
    };
    
    // Fallback: Storage event for older browsers
    window.addEventListener('storage', (e) => {
      if (e.key === 'auth-session-version') {
        this.adapter.getSession().then(/*...*/);
      }
    });
    
    // Refresh check on tab visibility
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.adapter.getSession().then(/*...*/);
      }
    });
  }
  
  notifySessionChanged() {
    this.channel.postMessage({ type: 'session-changed' });
    localStorage.setItem('auth-session-version', Date.now().toString());
  }
}
```

**Race condition handling:** When multiple tabs attempt refresh simultaneously, only the first succeeds. Other tabs receive the updated session via BroadcastChannel before their refresh completes.

## Error Handling

```typescript
export type AuthError = {
  code: 'INVALID_CREDENTIALS' | 'EXPIRED_SESSION' | 'PROVIDER_ERROR' | 'NETWORK_ERROR' | 'REFRESH_FAILED';
  message: string;
  suggestion: string;
};

// Thrown by adapter methods on failure
export class AuthAdapterError extends Error {
  constructor(public error: AuthError) {
    super(error.message);
  }
}

// Example usage
try {
  await adapter.signIn('email', { email, password });
} catch (e) {
  if (e instanceof AuthAdapterError) {
    showToast(e.error.suggestion);  // "Check your password and try again"
  }
}
```

## Migration Strategy

**Passwordless = Maximum Portability**

| Auth Method | Migration Impact |
|-------------|------------------|
| OAuth (Google, GitHub) | ✅ Zero — just re-link |
| Magic link | ✅ Zero — new provider sends link |
| Password hash | ⚠️ Requires hash migration or reset |

### Key Principle

User table lives in **your database** (Convex), not auth provider:

```
email → userId → app data
```

Auth providers become interchangeable identity verification services.

## Testing Strategy

```typescript
// MockAuthAdapter for tests — uses class syntax for private state
export class MockAuthAdapter implements AuthAdapter {
  private state: AuthSessionState = { status: 'unauthenticated', session: null, user: null };
  private listeners = new Set<(state: AuthSessionState) => void>();

  async signIn(provider: Provider, options?: EmailCredentials | OAuthOptions) {
    const email = options && 'email' in options ? options.email : 'test@example.com';
    this.state = {
      status: 'authenticated',
      session: { id: 'test-session', expiresAt: new Date(Date.now() + 3600000), token: 'test-token' },
      user: { id: 'test-user', email }
    };
    this.notifyListeners();
  }

  async signOut() {
    this.state = { status: 'unauthenticated', session: null, user: null };
    this.notifyListeners();
  }

  async getSession() { 
    return this.state; 
  }

  onAuthStateChange(callback: (state: AuthSessionState) => void) {
    this.listeners.add(callback);
    return { unsubscribe: () => this.listeners.delete(callback) };
  }

  private notifyListeners() {
    this.listeners.forEach(cb => cb(this.state));
  }

  // Test helpers
  _reset() { 
    this.state = { status: 'unauthenticated', session: null, user: null }; 
    this.notifyListeners();
  }
  
  _setUser(user: User) { 
    this.state = { 
      status: 'authenticated', 
      session: { id: 'test-session', expiresAt: new Date(Date.now() + 3600000), token: 'test-token' },
      user 
    };
    this.notifyListeners();
  }
  
  _setLoading() {
    this.state = { status: 'loading', session: null, user: null };
    this.notifyListeners();
  }
}
```

## Implementation Plan

- [ ] Define `AuthAdapter` interface in `packages/auth/`
- [ ] Define error types and `AuthAdapterError` class
- [ ] Implement `ConvexAuthAdapter` (wraps existing `@convex-dev/auth`)
- [ ] **Checkpoint:** Deploy to staging, verify OAuth flow end-to-end with Convex
- [ ] Implement `MockAuthAdapter` for testing
- [ ] **Checkpoint:** Run full test suite, verify mock matches real behavior
- [ ] Implement `BetterAuthAdapter` as alternative
- [ ] **Checkpoint:** Verify provider swap works without app code changes
- [ ] App code imports only from adapter, never provider directly
- [ ] Add integration tests with mock adapter
- [ ] Add `StytchAdapter` when needed (same interface)

## Edge Runtime Verification

The adapter interface must work in Edge Runtime (Cloudflare Workers, Vercel Edge):

**Verification strategy:**
```bash
# Run adapter in Cloudflare Workers environment
wrangler dev --test-scheduled

# Verify no node:* imports in production bundle
npx esbuild packages/auth/src/index.ts --bundle --analyze | grep "node:"

# Test with edge-runtime package in CI
pnpm add -D edge-runtime
pnpm vitest run --environment edge-runtime
```

**Acceptance:** Zero `node:*` imports in core interface. Provider-specific adapters may use Node.js APIs if they're server-only.

## Acceptance Criteria

- [ ] TypeScript compiler enforces status check before accessing `user`
- [ ] Session state syncs correctly across tabs via BroadcastChannel
- [ ] Token refresh handled transparently with retry logic
- [ ] Works in Edge Runtime (verified via CI)
- [ ] Mock adapter enables full auth flow testing without network
- [ ] Provider type is extensible (can add Microsoft/Apple without interface changes)
- [ ] ConvexAuthAdapter wraps existing `@convex-dev/auth` without migration

## Benefits

- Start lean with Convex Auth ($0)
- Scale to enterprise auth without code changes
- Test against multiple providers in CI
- Type-safe session access prevents null pointer errors
- Multi-tab sync prevents stale session issues

---

*Status: Ready — revised after review*
