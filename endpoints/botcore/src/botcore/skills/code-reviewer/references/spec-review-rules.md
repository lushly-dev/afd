# Spec Review Rules

Detailed rules for reviewing specifications and proposals.

## Spec Content Blocker: Too Much Implementation

> Code in markdown has no type checking, no tests, no IDE support.
> Specs that contain full implementations create unbounded review loops.

### FLAG AS BLOCKER if spec contains:

- Full function/method implementations (bodies > 10 lines)
- Complete React components with hooks, effects, handlers
- Test implementations (actual test code)
- Edge case handlers (try/catch with recovery logic)
- Internal helper functions that are not part of the public API

### ACCEPTABLE in specs:

- Interface definitions (no bodies)
- Type/schema definitions
- API signatures (function name, params, return type)
- Short examples (< 10 lines) showing usage pattern
- Architecture diagrams (Mermaid)

### Example blocker comment:

```
BLOCKER: Spec contains ~200 lines of AuthProvider implementation.
  - Evidence: Lines 180-380 contain full React component with hooks, error boundaries
  - Fix: Reduce to interface + narrative. Move implementation details to implementation phase.
```

## API Verification (Critical for Specs)

When a spec includes code that uses external libraries:

- **Check the actual API surface** -- Does `useConvexAuth()` really return `session` and `user`?
- **Verify hook/class patterns** -- React hooks cannot be called in classes
- **Test mental compilation** -- Would this code actually compile?

Most spec blockers come from code samples that do not match real library APIs.

## Mermaid Diagrams: Encourage Usage

Mermaid diagrams are high-density spec artifacts. Flag as IMPROVEMENT if spec lacks diagrams for:

- Component relationships (use `graph TD`)
- Multi-step flows like auth/API calls (use `sequenceDiagram`)
- State machines with transitions (use `stateDiagram-v2`)
- Type hierarchies (use `classDiagram`)

Example improvement comment:

```
IMPROVEMENT: Add architecture diagram
  - Evidence: Package structure described in prose only
  - Suggestion: Add `graph TD` showing component relationships.
    A diagram often replaces 30+ lines of prose.
```

## Prose Anti-Patterns: Flag for Density

Specs consumed by agents should optimize for low tokens and explicit relationships.

| Anti-Pattern | Evidence | Suggested Fix |
|---|---|---|
| **Hedging prose** | "typically", "might", "could", "generally" | Replace with MUST/SHOULD/MAY |
| **Narrative paragraphs** | 5+ sentence paragraphs explaining relationships | Extract to table or Mermaid diagram |
| **Implicit references** | "as mentioned above", "see previous section" | Repeat key info or add explicit link |
| **Repeated information** | Same constraint stated 3+ times in prose | Consolidate into single table row |
| **Examples without contracts** | Code example with no preceding interface | Add interface definition first |

Example improvement comment:

```
IMPROVEMENT: Convert browser support prose to table
  - Evidence: Lines 45-52 describe BroadcastChannel support in 8 sentences
  - Suggestion: Replace with table: | Browser | Support | Fallback |
  - Rationale: 5x fewer tokens, zero ambiguity
```
