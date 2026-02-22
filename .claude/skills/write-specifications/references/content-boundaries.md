# Spec Content Boundaries

Rules for what belongs in a specification and what belongs in implementation.

## Core Rule: WHAT and WHY, Not HOW

Code written in markdown has no type checking, no tests, no IDE support. Specs that contain full implementations create unbounded review loops.

## INCLUDE in Specs

| Content | Example |
|---|---|
| **Interfaces/Contracts** | `interface AuthAdapter { getSession(): Promise<Session \| null> }` |
| **API Signatures** | Function names, params, return types (no bodies) |
| **Architecture Diagrams** | Mermaid diagrams showing data flow |
| **Narrative Strategy** | "Use provider factory pattern to support multiple auth backends" |
| **Acceptance Criteria** | "User can sign in with Google in < 3 clicks" |
| **Error Codes/States** | `AUTH_EXPIRED`, `INVALID_TOKEN`, `NETWORK_ERROR` |
| **Configuration Schema** | What config options exist, not how they are parsed |

## EXCLUDE from Specs

| Content | Why |
|---|---|
| **Full Implementations** | No type checking, creates unbounded review loops |
| **Test Code** | Tests belong in test files with actual assertions |
| **Edge Case Handlers** | Let implementation discover these |
| **Internal Helper Functions** | Implementation detail |
| **Boilerplate** | Imports, React state, cleanup logic |
| **Copy-Paste Code Blocks** | If it looks ready to run, it should not be in a spec |

## The 50-Line Rule

If any code block exceeds ~50 lines, it is probably implementation disguised as specification. Extract to interface + narrative.

### Anti-pattern:

```markdown
## AuthProvider Implementation
\`\`\`typescript
// 200 lines of React component with hooks, effects, error boundaries...
\`\`\`
```

### Better:

```markdown
## AuthProvider Contract
- MUST wrap app and provide `useSession()` hook
- MUST handle loading/error/authenticated states
- SHOULD memoize context value to prevent re-renders

\`\`\`typescript
interface AuthProviderProps { children: ReactNode; adapter: AuthAdapter; }
type AuthState = { status: 'loading' } | { status: 'error'; error: Error } | { status: 'authenticated'; session: Session };
\`\`\`
```

## Blocker Criteria

Flag as BLOCKER if a spec contains:

- Full function/method implementations (bodies > 10 lines)
- Complete React components with hooks, effects, handlers
- Test implementations (actual test code)
- Edge case handlers (try/catch with recovery logic)
- Internal helper functions not part of the public API
- Any code block exceeding 50 lines

## Acceptable Spec Content

- Interface definitions (no bodies)
- Type/schema definitions
- API signatures (function name, params, return type)
- Short examples (< 10 lines) showing usage pattern
- Architecture diagrams (Mermaid)
