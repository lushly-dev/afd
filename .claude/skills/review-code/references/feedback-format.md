# Feedback Format

Structured format for review output.

## Template

```markdown
## BLOCKERS (Must Fix)

1. [Issue that prevents approval]
   - Evidence: [What you found in codebase/research]
   - Fix: [Suggested resolution]

## IMPROVEMENTS

1. [Enhancement that would improve quality]
   - Evidence: [Why this matters]
   - Suggestion: [How to implement]

## PRAISE

1. [Good pattern worth reinforcing]
   - Detail: [What makes this exemplary]

## Verdict

- APPROVE / REVISE REQUIRED / REJECT
- If REVISE REQUIRED: List which blockers must be resolved
```

## Classification Guide

| Finding Type | Category | Example |
|---|---|---|
| Breaks existing functionality | BLOCKER | "This removes required field X" |
| Invalid syntax / will not compile | BLOCKER | "TypeScript error on line 42" |
| Missing required component | BLOCKER | "No error handling for API failure" |
| Hardcoded secrets or injection risk | BLOCKER | "API key committed to source" |
| Breaking change without migration | BLOCKER | "Public API removed with no upgrade path" |
| Better pattern exists | IMPROVEMENT | "Could reuse existing utility" |
| Missing but not blocking | IMPROVEMENT | "Add undo support for UX" |
| Performance enhancement | IMPROVEMENT | "Cache this API response" |
| Code style / consistency | IMPROVEMENT | "Rename for clarity" |
| Incomplete types or annotations | IMPROVEMENT | "Using `any` without justification" |
| Comprehensive tests | PRAISE | "Good coverage including edge cases and error paths" |
| Clear naming | PRAISE | "Self-documenting variable and function names" |
| Well-structured error handling | PRAISE | "Typed errors with recovery suggestions" |
| Thoughtful API design | PRAISE | "Clean schemas with sensible defaults" |

## What NOT to Include

- **Out of scope items** -- If it is not actionable for this review, do not mention it
- **Future feature ideas** -- Create a GitHub issue instead
- **Alternative approaches** -- Unless current approach is fundamentally broken
- **Training data opinions** -- Research first, then comment

## Output Location

Save review output co-located with the artifact being reviewed:

| Artifact | Review Output |
|---|---|
| `docs/features/proposed/<name>/proposal.md` | `docs/features/proposed/<name>/review.md` |
| `docs/features/active/<name>/spec.md` | `docs/features/active/<name>/review.md` |
| `src/components/Button.tsx` | `src/components/Button.review.md` (or PR comment) |

Why co-located:
- Everything about a feature lives in one folder
- No sprawling `docs/audits/` folder to maintain
- Easy to delete when feature ships
- Git history shows review alongside changes

## Review Modes

| Mode | Model | Time | When |
|---|---|---|---|
| Fast | Haiku | ~2 min | Low-risk, formatting, simple changes |
| Standard | Sonnet | ~5 min | Normal features (default) |
| Deep | Opus | ~10 min | Architecture, breaking changes, planning docs |

Recommendation: Use Opus for proposal/spec reviews where deeper contextual thinking catches architectural issues.
