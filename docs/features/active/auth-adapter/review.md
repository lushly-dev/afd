# Auth Adapter Spec Review

> Review of auth-adapter.spec.md (v2.0 lean format)

---
reviewed: 2026-01-31
reviewer: Claude
verdict: **Approve with minor revisions**
---

## Summary

The spec is well-structured and follows the v2.0 lean format (interfaces + narrative) effectively. The discriminated union pattern for `AuthSessionState` is the right design choice for type-safe session access. The phased implementation approach with verification gates is practical.

## Strengths

| Aspect | Assessment |
|--------|------------|
| Architecture | Clear Mermaid diagram showing adapter pattern layers |
| Type Safety | Discriminated union enforces compile-time status checks |
| Adapter Contracts | MUST/SHOULD requirements are specific and testable |
| Package Structure | Logical separation of concerns |
| Implementation Phases | Each phase has concrete verification criteria |
| Test Requirements | Coverage targets and test categories defined |

## Issues

### 1. Missing Type Definitions (Medium)

**Location:** Core Interface section, lines 93-99

The `AuthAdapter` interface references `SignInOptions` but this type is not defined:

```typescript
signIn(provider: Provider, options?: SignInOptions): Promise<void>;
```

The proposal defines `EmailCredentials | OAuthOptions` — this should be carried forward to the spec.

**Recommendation:** Add to Supporting Types:

```typescript
export interface OAuthOptions {
  scopes?: string[];
  redirectTo?: string;
}

export interface EmailCredentials {
  email: string;
  password?: string;  // Optional for magic link
}

export type SignInOptions = EmailCredentials | OAuthOptions;
```

### 2. Refreshing State Usage Unclear (Low)

**Location:** AuthSessionState definition, lines 74-79

The spec defines a `refreshing` status but all adapter contracts set `supportsRefreshingState: false`. This creates ambiguity:

- When is `refreshing` status ever emitted?
- Should it be optional in the union or removed?

**Recommendation:** Either:
- Document which adapter(s) will emit `refreshing` in future
- Or remove from the union and note as "reserved for future use"

### 3. Session Sync Implementation Light (Low)

**Location:** Session Sync section, lines 173-178

The section provides strategy bullets but lacks:
- Refresh lock timeout duration
- Tab visibility debounce timing
- Error handling for BroadcastChannel failures

**Recommendation:** Add a code block showing the lock pattern:

```typescript
const REFRESH_LOCK_TTL = 5000; // ms
const lockKey = 'auth-refresh-lock';
```

### 4. Phase 4 Verification Vague (Low)

**Location:** Implementation Phases table, line 187

"Multi-tab test scenario passes" is not specific enough.

**Recommendation:** Replace with: "Playwright test opens 2 tabs, signs out in one, verifies session cleared in other within 500ms"

### 5. Retry Logic Missing (Low)

**Location:** Not present

The proposal specifies "Retry refresh up to 3 times with exponential backoff" but the spec omits this.

**Recommendation:** Add under Error Types or as a new Retry Strategy section:

```typescript
const REFRESH_RETRY = { maxAttempts: 3, baseDelay: 1000, maxDelay: 8000 };
```

## Verification Checklist

- [x] Spec links to proposal correctly
- [x] Discriminated union pattern correctly specified
- [x] Adapter contracts use MUST/SHOULD appropriately
- [x] Dependencies section includes peer dependency metadata
- [x] Acceptance criteria are testable
- [ ] All types referenced in interfaces are defined
- [ ] Session sync has sufficient implementation detail

## Acceptance Criteria Review

| Criterion | Verifiable? | Notes |
|-----------|-------------|-------|
| TypeScript enforces status check | Yes | Type tests with `expectTypeOf` |
| Zero migration for @convex-dev/auth | Yes | ConvexAuthAdapter wraps existing hooks |
| Provider swap via adapter change | Yes | Swap test in Phase 6 |
| Works in Cloudflare Workers | Yes | CI verification in Phase 7 |
| Multi-tab sync across browsers | Partially | Needs specific timing/behavior requirements |

## Recommendation

**Approve with minor revisions.** Address issues #1 and #3 before implementation begins. Issues #2, #4, #5 can be addressed during implementation.

### Priority Order

1. Add missing type definitions (blocks Phase 1)
2. Clarify session sync implementation details (blocks Phase 4)
3. Document retry logic (informs error handling)

---

*Review generated: 2026-01-31 | Spec version: 2.0*
