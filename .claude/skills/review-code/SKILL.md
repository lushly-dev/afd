---
name: review-code
source: botcore
description: >
  Performs research-grounded code, spec, and proposal reviews using the Fresh Agent pattern and Generator-Critic loop. Covers codebase verification, API validation, spec density analysis, structured checklists across code quality, security, testing, performance, and documentation, and structured feedback output with BLOCKER/IMPROVEMENT/PRAISE classification. Use when reviewing PRs, proposals, specs, or any code artifact.

version: 1.1.0
triggers:
  - review code
  - review PR
  - code review
  - review spec
  - review proposal
  - fresh review
  - research-grounded review
  - PR review
  - pull request review
  - check code quality
  - review changes
  - security review
  - test coverage review
portable: true
---

# Reviewing Code

Research-grounded review of code, PRs, specs, and proposals. Two modes: deep analysis (Fresh Agent + Generator-Critic) and systematic checklist-based review — use both together for thorough coverage.

## Capabilities

1. **Fresh Agent Review** — Review artifacts without prior generation context, eliminating self-consistency bias
2. **Research-First Analysis** — Ground every opinion in codebase search, web research, and API verification
3. **Spec & Proposal Review** — Validate against density rules, interface-only requirements, and content blockers
4. **Generator-Critic Loop** — Serve as the Critic in multi-agent workflows, producing structured Pass/Fail feedback
5. **Structured Feedback** — Produce BLOCKER / IMPROVEMENT / PRAISE findings with evidence and suggestions
6. **Multi-Dimension Checklists** — Systematic coverage across code quality, security, testing, performance, and docs
7. **Multi-Language** — TypeScript, Python, Rust, Go language-specific checks

## Routing Logic

| Request Type | Reference |
|---|---|
| Detailed per-dimension checklists (code, security, testing, perf, docs) | [review-checklists.md](references/review-checklists.md) |
| Reviewing a spec or proposal | [spec-review-rules.md](references/spec-review-rules.md) |
| Formatting review output | [feedback-format.md](references/feedback-format.md) |
| Running the post-review orchestrator workflow | [orchestrator-workflow.md](references/orchestrator-workflow.md) |

## Core Principles

### 1. Fresh Agent Pattern

<rules>
You are a FRESH AGENT. You have NO context from the code generation.

This is intentional. The "self-consistency bias" that comes from remembering
the reasoning behind code leads to blind spots. Judge artifacts strictly on
their merits and compliance with requirements.
</rules>

You receive ONLY: the **Specification** (source of truth), the **Code/Proposal** (what to review), and read-only **Codebase Access** (for context). You do NOT receive conversation history, struggles, or intermediate drafts.

### 2. Research-First Mandate

<rules>
NEVER rely on training data for technical reviews. Training data is 6-12 months stale.
</rules>

Before forming any opinion:
1. **Search the codebase** — Verify current patterns, existing implementations
2. **Verify 3rd-party APIs** — Check that code samples use real APIs (not hallucinated)
3. **Use research tools** — Check latest docs, APIs, best practices
4. **Read project files** — AGENTS.md, CLAUDE.md, existing specs

### 3. Understand Before Judging

Read the PR description, linked issues, and overall intent before examining individual lines. Verify that the scope of changes matches the stated goal. Context prevents false positives and misguided feedback.

### 4. List Everything, Filter Nothing

- List ALL issues found — do not self-censor "minor" improvements
- The orchestrator (not you) decides what fits project direction
- If something is worth mentioning, it is worth listing
- Acknowledge good patterns alongside issues (use PRAISE)

### 5. Generator-Critic Loop

When acting as the Critic in a multi-agent workflow:

1. Analyze the candidate against spec and quality rules
2. Output structured feedback (Pass/Fail with reasoning)
3. If Fail: Generator attempts fix (loop continues)
4. If Pass: Human sees Critic-approved PR

### 6. Complete Feature Principle

<rules>
Agent work is cheap. Context reload is expensive.
Flag "Let's do Phase 1 first and come back for Phase 2" as an anti-pattern.
</rules>

**Valid phasing** (has a technical gate): deploy-then-verify, wait for API approval, ship read-only to validate data model.

**Invalid phasing** (flag as BLOCKER): "It's a lot of work", "Easier to scope", "We can add that later", "MVP first" — unless there is a concrete validation checkpoint.

## Severity Classification

Classify every finding into one of three categories:

| Category | Label | Meaning |
|---|---|---|
| **BLOCKER** | 🔴 | Must fix before approval. Security holes, broken logic, missing tests for new features, breaking changes without migration. |
| **IMPROVEMENT** | 🟡 | Should address but does not block. Better patterns, missing docs, incomplete types, code duplication. |
| **PRAISE** | 🟢 | Good patterns worth reinforcing. Comprehensive tests, clear naming, thoughtful error handling, clean API design. |

See [feedback-format.md](references/feedback-format.md) for the full output template.

## Workflow

### Step 1: Context

- Read PR description, linked issues, commit messages
- Check scope — do the changed files match the stated intent?
- Read project configuration (AGENTS.md, CLAUDE.md)

### Step 2: Research

- Search the codebase for existing patterns related to the artifact
- Verify any 3rd-party API usage against actual docs
- Use web research for anything uncertain

### Step 3: Review

- Apply the appropriate checklist (see below and [review-checklists.md](references/review-checklists.md))
- Flag all issues with evidence from research
- Classify each finding as BLOCKER, IMPROVEMENT, or PRAISE

### Step 4: Output

- Use the structured feedback format: BLOCKERS → IMPROVEMENTS → PRAISE → Verdict
- Ensure feedback is constructive, specific, and actionable
- Save review output co-located with the artifact (see [feedback-format.md](references/feedback-format.md))

## Quick Reference: Review Boundaries

| Artifact | Focus On | Do NOT Critique |
|---|---|---|
| Proposal | Problem clarity, solution validity, duplication, phasing rationale | Implementation specifics, file names, function signatures |
| Spec | Implements approved approach, actionable tasks, testing plan, edge cases | Whether the feature should exist, high-level approach alternatives (unless broken) |
| Code/PR | Logic correctness, security, testing, performance, quality, conventions | Out-of-scope items, future features, alternative approaches, training-data opinions |

## Checklists

### Code / PR Review (quick gate)

- [ ] PR description and linked issues read before reviewing code
- [ ] Code implements what the spec/ticket describes
- [ ] Edge cases handled (null, empty, error states)
- [ ] No hardcoded secrets; inputs validated, outputs sanitized
- [ ] Dependencies verified (slopsquatting check)
- [ ] Tests exist and are meaningful (not just happy path)
- [ ] No duplication with existing utilities
- [ ] Follows project conventions (naming, patterns)
- [ ] Findings classified by severity (BLOCKER/IMPROVEMENT/PRAISE)

For detailed per-dimension checklists (code quality, security, testing, performance, documentation), see [review-checklists.md](references/review-checklists.md).

### Proposal Review

- [ ] Problem statement is clear and scoped
- [ ] Proposed solution addresses the problem
- [ ] No duplication with existing infrastructure
- [ ] Phasing has validation checkpoints

### Spec Review

- [ ] Implements the approved proposal approach
- [ ] Task breakdown is actionable (checkable items)
- [ ] Testing plan is concrete
- [ ] Edge cases and error handling addressed
- [ ] No code blocks exceed 50 lines (BLOCKER if exceeded)
- [ ] Interfaces only — no implementation bodies (BLOCKER if violated)

## When to Escalate

| Condition | Escalate To |
|---|---|
| Security vulnerability | Security team |
| Breaking API change | Tech lead |
| Architectural changes or large refactors | Broader team input |
| Unclear requirements | Original author |
| Unfamiliar domain (cryptography, compliance) | Specialist co-reviewer |
| License or dependency risk | Legal/compliance review |
| Conflicting requirements | Flag for author resolution |
| Training data uncertainty | Use research tools first, then escalate |
