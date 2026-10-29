# Architecture Decision Records (ADR) Guide

How to write, review, and maintain ADRs as living documentation of architectural decisions.

## Why ADRs

- **Prevent knowledge loss** -- Decisions outlive the people who made them
- **Enable informed reversals** -- Context tells future teams whether constraints still hold
- **Reduce re-litigation** -- Settled decisions are not repeatedly debated
- **Support agent workflows** -- AI agents can read ADRs to understand why the architecture is shaped the way it is

## ADR Lifecycle

```
Proposed --> Accepted --> [Active]
                |
                +--> Deprecated (superseded by ADR-XXX)
                |
                +--> Rejected (with documented reasoning)
```

Statuses:
- **Proposed** -- Under discussion, not yet decided
- **Accepted** -- Decision made, actively in effect
- **Deprecated** -- No longer relevant, superseded by another ADR
- **Superseded** -- Replaced by a specific newer ADR (link to it)
- **Rejected** -- Considered and explicitly declined (still valuable to record)

## Full Template

```markdown
# ADR-NNN: [Short Decision Title]

**Status**: Proposed | Accepted | Deprecated | Superseded by ADR-XXX
**Date**: YYYY-MM-DD
**Deciders**: [List of people involved in the decision]

## Context

[Describe the forces at play. What is the problem, opportunity, or constraint
that requires a decision? Include technical context, business drivers,
team constraints, and any deadlines.]

## Decision Drivers

- [Driver 1: e.g., "Need to scale order processing independently"]
- [Driver 2: e.g., "Team cannot coordinate releases across 3 time zones"]
- [Driver 3: e.g., "Regulatory requirement for data isolation"]

## Options Considered

### Option A: [Name]
- **Pros**: [List advantages]
- **Cons**: [List disadvantages]
- **Effort**: [Rough estimate]

### Option B: [Name]
- **Pros**: [List advantages]
- **Cons**: [List disadvantages]
- **Effort**: [Rough estimate]

### Option C: [Name]
- **Pros**: [List advantages]
- **Cons**: [List disadvantages]
- **Effort**: [Rough estimate]

## Decision

[State the decision clearly. Use active voice: "We will use X because Y."]

## Consequences

### Positive
- [What becomes easier or better]

### Negative
- [What becomes harder or more expensive]

### Risks
- [What could go wrong and how we mitigate it]

## Related Decisions

- [Link to related ADRs if any]
```

## Lightweight Template (for smaller decisions)

```markdown
# ADR-NNN: [Short Decision Title]

**Status**: Accepted
**Date**: YYYY-MM-DD

## Context
[2-3 sentences on what is driving this decision]

## Decision
[1-2 sentences stating the decision]

## Consequences
[Bullet list of what changes -- both positive and negative]
```

## Storage and Organization

### Directory Structure

```
docs/
  architecture/
    decisions/
      README.md          # Index of all ADRs
      001-use-postgresql.md
      002-modular-monolith.md
      003-event-driven-ordering.md
      004-cqrs-for-reporting.md
```

### README Index Format

```markdown
# Architecture Decision Records

| ADR | Title | Status | Date |
|---|---|---|---|
| [001](001-use-postgresql.md) | Use PostgreSQL as primary data store | Accepted | 2025-01-15 |
| [002](002-modular-monolith.md) | Adopt modular monolith architecture | Accepted | 2025-02-01 |
| [003](003-event-driven-ordering.md) | Event-driven communication for ordering | Accepted | 2025-03-10 |
| [004](004-cqrs-for-reporting.md) | CQRS for reporting queries | Proposed | 2025-04-01 |
```

### Naming Conventions

- Sequential numbering: `001`, `002`, `003`
- Lowercase, hyphen-separated: `001-use-postgresql.md`
- Short descriptive title in filename
- Always markdown format for version control compatibility

## Writing Guidelines

### Context Section

Good context answers:
- What problem are we solving?
- What constraints exist (technical, organizational, regulatory)?
- What has changed since the last relevant decision?
- What is the cost of not deciding?

Bad context:
- "We need to choose a database" (too vague, no forces described)
- Three paragraphs of background that could be one sentence

### Decision Section

Good decisions:
- "We will use PostgreSQL 16 for the order management bounded context because it provides ACID transactions needed for financial data and our team has deep expertise."
- Clear, specific, actionable

Bad decisions:
- "We might consider using a relational database" (hedging, not decisive)
- "PostgreSQL" (no rationale)

### Consequences Section

Always include both positives and negatives. A decision with only positive consequences is suspect -- every choice has trade-offs.

## Review Checklist

- [ ] Title clearly describes the decision (not the problem)
- [ ] Status is set and current
- [ ] Context explains forces, not just background
- [ ] At least two options were considered (including "do nothing")
- [ ] Decision is stated unambiguously in active voice
- [ ] Consequences include both positive and negative impacts
- [ ] Related ADRs are linked
- [ ] ADR is indexed in the README
- [ ] ADR is stored in version control alongside the code

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| Ghost ADR | Decision made but never recorded | Write ADR within 1 week of decision |
| Zombie ADR | Status "Proposed" for 3+ months | Force a decision or reject |
| Orphan ADR | No link to related ADRs | Add "Related Decisions" section |
| Novel ADR | 3+ pages of prose | Keep to 1 page; move analysis to appendix |
| Dictator ADR | Single person decides with no input | List deciders; require at least 2 reviewers |
| Retroactive ADR | Written months after the decision | Still valuable -- mark as "Accepted (retroactive)" |

## Agent Integration

When an AI agent encounters an architectural question:

1. **Search existing ADRs** first -- the decision may already be recorded
2. **Check ADR status** -- a "Proposed" ADR means the decision is still open
3. **Reference ADRs in code changes** -- link to the relevant ADR in PR descriptions
4. **Draft new ADRs** when making architectural changes -- propose them for human review
5. **Flag stale ADRs** -- if context has changed, suggest a review
