# Auth Adapter Pattern

> Proposal: Provider-agnostic authentication layer enabling zero-friction migration

---
status: captured
created: 2026-01-11
origin: Discussion on stack choices (Convex + BetterAuth vs Stytch/Supabase)
effort: M (3-5 days)
---

## Problem

Auth provider lock-in creates migration nightmares. Choosing BetterAuth today shouldn't prevent moving to Stytch/Supabase later.

## Proposed Solution

**Auth Adapter Interface** — same pattern as AFD commands:

```typescript
interface AuthAdapter {
  signIn(credentials: Credentials): Promise<AuthResult>;
  signOut(): Promise<void>;
  getSession(): Promise<Session | null>;
  onAuthStateChange(callback: (session: Session | null) => void): () => void;
}
```

### Implementations

| Adapter | Use Case |
|---------|----------|
| `BetterAuthAdapter` | Self-hosted, OSS, TypeScript-native |
| `StytchAdapter` | Enterprise, passwordless-first |
| `SupabaseAuthAdapter` | PostgreSQL ecosystem |

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

## Implementation Plan

- [ ] Define `AuthAdapter` interface in `packages/auth/`
- [ ] Implement `BetterAuthAdapter` first
- [ ] App code imports only from adapter, never `better-auth` directly
- [ ] Add `StytchAdapter` when needed (same interface)

## Benefits

- Start lean with BetterAuth ($0)
- Scale to enterprise auth without code changes
- Test against multiple providers in CI

---

*Status: Captured — awaiting prioritization*
