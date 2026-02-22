# Spec Template

Reference template for structuring a SPEC.md file.

## Template Structure

```markdown
# [Feature Name] Specification

## Overview
One-paragraph summary of what this spec covers and why.

## Status
| Field | Value |
|---|---|
| Status | Draft / In Review / Approved |
| Author | [name] |
| Date | [date] |
| Proposal | [link to PROPOSAL.md] |

## Architecture

\`\`\`mermaid
graph TD
    A[Component A] --> B[Component B]
    B --> C[Component C]
\`\`\`

## Contracts

### [Interface Name]

\`\`\`typescript
interface ExampleAdapter {
  method(param: Type): Promise<ReturnType>;
}
\`\`\`

## Requirements

### Functional
- MUST [requirement 1]
- MUST [requirement 2]
- SHOULD [requirement 3]
- MAY [requirement 4]

### Non-Functional
- MUST respond within [N]ms for [operation]
- MUST support [N] concurrent [units]

## Error Handling

| Error Code | Condition | Recovery |
|---|---|---|
| ERR_001 | [condition] | [recovery action] |
| ERR_002 | [condition] | [recovery action] |

## Configuration

| Key | Type | Default | Description |
|---|---|---|---|
| config_key | string | "default" | What it controls |

## Task Breakdown

### Wave 1: Foundation
- [ ] Task 1.1: [description] -- acceptance: [criteria]
- [ ] Task 1.2: [description] -- acceptance: [criteria]

### Wave 2: Core Logic
- [ ] Task 2.1: [description] -- acceptance: [criteria]
- [ ] Task 2.2: [description] -- acceptance: [criteria]

### Wave 3: Integration
- [ ] Task 3.1: [description] -- acceptance: [criteria]

## Acceptance Criteria
- [ ] [Testable criterion 1]
- [ ] [Testable criterion 2]
- [ ] [Testable criterion 3]

## Rollback Plan
Steps to revert if deployment fails.
```

## Section Guidelines

### Overview
- One paragraph maximum
- State the problem and the solution approach
- Link to the originating proposal

### Architecture
- MUST include at least one Mermaid diagram
- Show component relationships and data flow
- Use `sequenceDiagram` for multi-step processes

### Contracts
- Interface definitions only -- no implementation bodies
- Include all public API surfaces
- Use TypeScript-style type annotations

### Requirements
- Every requirement MUST use RFC 2119 keywords (MUST/SHOULD/MAY)
- All metrics MUST be quantifiable
- No hedging language

### Task Breakdown
- Organize into waves with clear dependencies
- Each task MUST be independently verifiable
- Include acceptance criteria per task
- Tasks in later waves MAY depend on earlier waves

### Rollback Plan
- Every spec MUST include a rollback strategy
- Define what "failure" means
- List concrete steps to revert
