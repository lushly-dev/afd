---
name: write-specifications
source: botcore
description: >
  Writes high-quality technical specifications for AI agent implementation using Spec-Driven Development (SDD) methodology. Covers clarification, structured spec authoring, architecture planning, task breakdown, and quality gates. Use when creating specs, writing technical plans, authoring SPEC.md files, or following SDD workflows. Triggers: write spec, create specification, technical plan, SDD, spec-driven development, SPEC.md, feature specification, spec template.

version: 1.0.0
triggers:
  - write spec
  - create specification
  - technical plan
  - spec-driven development
  - SDD
  - SPEC.md
  - feature specification
  - spec template
  - architecture plan
  - task breakdown
portable: true
---

# Writing Specifications

Expert guidance for writing specifications that AI agents can reliably implement, following Spec-Driven Development methodology.

## Capabilities

1. **Clarify** -- Resolve ambiguity and conflicting requirements before writing
2. **Specify** -- Transform proposals into structured, agent-consumable specs
3. **Plan** -- Map requirements to architecture using diagrams and contracts
4. **Task** -- Break specs into atomic, executable work items in waves
5. **Validate** -- Apply quality gates to ensure spec density and correctness

## Routing Logic

| Request Type | Reference |
|---|---|
| Spec content rules (WHAT vs HOW, include/exclude, 50-line rule) | [content-boundaries.md](references/content-boundaries.md) |
| Agent-efficient formats, token optimization, anti-patterns | [agent-formats.md](references/agent-formats.md) |
| Spec template structure | [spec-template.md](references/spec-template.md) |

## Core Principles

### 1. Code in English Before Code

Write precise specifications before any implementation. A spec is a contract written in structured English that an agent can follow without guessing.

### 2. No Fuzzy Words

| Avoid | Use Instead |
|---|---|
| "fast" | "< 200ms response time" |
| "secure" | "OAuth2 + JWT with PKCE" |
| "scalable" | "100K concurrent users" |
| "handle gracefully" | "return error code AUTH_EXPIRED with retry prompt" |

### 3. RFC 2119 Keywords

| Keyword | Meaning |
|---|---|
| MUST | Absolute requirement -- non-negotiable |
| SHOULD | Recommended, exceptions need justification |
| MAY | Optional, implementer's choice |

Every requirement in a spec MUST use one of these keywords. No hedging ("typically", "might", "could").

### 4. WHAT and WHY, Not HOW

Specs define the contract. Implementation details belong in code.

- **Include:** Interfaces, API signatures, architecture diagrams, acceptance criteria, error states, configuration schemas
- **Exclude:** Full implementations, test code, edge case handlers, internal helpers, boilerplate

See [content-boundaries.md](references/content-boundaries.md) for detailed rules and the 50-Line Rule.

### 5. Constitutional Compliance

Always check `AGENTS.md` and project rules before specifying. Specs MUST NOT contradict project conventions.

## Workflow

```
Intent --> Clarify --> Specify --> Plan --> Tasks --> Implement
```

**Inputs:** `PROPOSAL.md`, `REVIEW.md`, `SPEC_CONTEXT.md`
**Output:** `SPEC.md`

### Step 1: Clarify

- Identify ambiguities, conflicting requirements, unstated assumptions
- Ask targeted questions -- do not guess
- Resolve every open question before proceeding to specification

### Step 2: Specify

- Transform the proposal into structured spec sections
- Use interfaces and type signatures for contracts (no implementation bodies)
- Apply RFC 2119 keywords to every requirement
- Add Mermaid diagrams for architecture and data flow

### Step 3: Plan

- Map requirements to components and modules
- Define integration points and dependencies
- Specify error codes, states, and recovery strategies
- Document configuration schemas

### Step 4: Task Breakdown

- Break the spec into atomic, checkable work items
- Organize tasks into waves with clear dependencies
- Each task MUST be independently verifiable
- Include acceptance criteria per task

## Quick Reference: Agent-Efficient Formats

Specs are consumed by AI agents. Optimize for low tokens and explicit relationships.

| Format | Why Agent-Friendly |
|---|---|
| Mermaid diagrams | Explicit relationships, parseable structure |
| TypeScript interfaces | Literal contracts, no inference needed |
| Tables | Explicit column-to-row mapping |
| Checklists | Binary pass/fail, scannable |
| Error code tables | Code-to-message-to-fix mapping |

See [agent-formats.md](references/agent-formats.md) for detailed comparisons and anti-patterns.

### Prefer Mermaid Diagrams

| Diagram Type | Best For |
|---|---|
| `graph TD` | Data flow, component relationships |
| `sequenceDiagram` | API calls, auth flows, multi-step processes |
| `classDiagram` | Type hierarchies, interface relationships |
| `stateDiagram-v2` | State machines, status transitions |

A single diagram often replaces 50+ lines of prose.

## Checklist

- [ ] Every requirement uses MUST/SHOULD/MAY
- [ ] No code blocks exceed 50 lines
- [ ] Interfaces only -- no implementation bodies
- [ ] Architecture shown via Mermaid diagram(s)
- [ ] Tables used for mappings (not prose paragraphs)
- [ ] No hedging words ("typically", "might", "could")
- [ ] All metrics are quantifiable
- [ ] Edge cases and error states documented
- [ ] Success criteria are testable
- [ ] Rollback plan exists
- [ ] Constitutional compliance verified (AGENTS.md checked)

## When to Escalate

- **Conflicting requirements** -- Stakeholders disagree on behavior or scope
- **Missing domain knowledge** -- Spec requires expertise not available in context
- **Scope creep** -- Requirements expanding beyond original proposal
- **Unresolvable ambiguity** -- Clarification questions cannot be answered with available information
