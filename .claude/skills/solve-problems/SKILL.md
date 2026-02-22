---
name: solve-problems
source: botcore
description: >
  Diagnoses and fixes bugs using systematic investigation and the scientific method. Covers build failures, test failures, runtime errors, unexpected behavior, error pattern recognition, and isolation techniques. Use when debugging crashes, diagnosing test failures, fixing build errors, or investigating unexpected runtime behavior. Triggers: bug, error, debug, fix, diagnose, broken, failing, crash, build failure, test failure, runtime error.

version: 1.0.0
triggers:
  - bug
  - error
  - debug
  - fix
  - diagnose
  - broken
  - failing
  - crash
  - build failure
  - test failure
  - runtime error
portable: true
---

# Solving Problems

Systematic approach to diagnosing and fixing bugs through structured investigation, hypothesis testing, and minimal targeted fixes.

## Capabilities

1. **Systematic Bug Diagnosis** -- Investigate issues using a structured observe-hypothesize-test-fix workflow
2. **Error Pattern Recognition** -- Match error messages to known root causes and proven fix patterns
3. **Isolation Techniques** -- Narrow down bug locations using binary search, minimal reproduction, and incremental disabling
4. **Build Failure Resolution** -- Diagnose and fix missing dependencies, import errors, circular dependencies, and configuration issues
5. **Test Failure Analysis** -- Identify why tests fail, distinguish test bugs from code bugs, and verify fixes with regression tests
6. **Runtime Error Debugging** -- Trace null references, type mismatches, async issues, and state management problems to root causes
7. **Structured Diagnosis Output** -- Produce clear diagnosis reports with symptoms, root cause, evidence, fix, and verification steps

## Routing Logic

| Request Type | Reference |
|---|---|
| Identifying a specific error message or pattern | [error-patterns.md](references/error-patterns.md) |
| Choosing a debugging strategy or technique | [debugging-strategies.md](references/debugging-strategies.md) |

## Core Principles

### 1. Read the Error First

<rules>
ALWAYS read the full error message, stack trace, and surrounding context before forming any hypothesis.
The error message is evidence. Skipping it leads to guessing.
</rules>

Note the exact error text, the file and line number, and the full stack trace. These narrow the search space before any investigation begins.

### 2. The Scientific Method

Every debugging session follows this loop:

1. **Observe** -- What exactly is happening? Collect symptoms without jumping to conclusions.
2. **Hypothesize** -- Form a testable theory: "If X is the cause, then Y should be true."
3. **Test** -- Verify the hypothesis. Reproduce the issue. Check if the theory holds.
4. **Conclude** -- Confirm or reject. If rejected, form a new hypothesis.
5. **Fix** -- Apply the minimal change that addresses the root cause.
6. **Verify** -- Confirm the fix works and introduces no regressions.

### 3. Minimal Fix Principle

<rules>
Apply the smallest change that fixes the root cause.
Do not refactor, reorganize, or "improve" unrelated code during a bug fix.
A bug fix should be easy to review and easy to revert.
</rules>

### 4. Root Cause Over Symptoms

Fix the underlying cause, not the surface symptom. A symptom fix masks the real problem and often introduces new issues. If the root cause is unclear after investigation, escalate rather than apply a speculative fix.

### 5. Verify With Tests

Every fix should be accompanied by a verification step. Prefer adding a regression test that would have caught the bug. At minimum, confirm the original error no longer occurs and existing tests still pass.

## Workflow

### Step 1: Gather Information

- Read the full error message and stack trace
- Note the file, line number, and error type
- Check recent changes: `git diff`, `git log --oneline -10`
- Identify the category: build failure, test failure, runtime error, or unexpected behavior

### Step 2: Reproduce

- Confirm the issue occurs consistently
- Document the exact reproduction steps
- If intermittent, note frequency and conditions

### Step 3: Hypothesize and Isolate

- Form a specific hypothesis: "The error occurs because X"
- Use isolation techniques to narrow scope (see references/debugging-strategies.md)
- Check if the issue is in your code, a dependency, or configuration

### Step 4: Fix

- Apply the minimal targeted change
- Follow existing code patterns and conventions
- Do not introduce unrelated changes

### Step 5: Verify

- Confirm the original error is resolved
- Run the full test suite to check for regressions
- Add a regression test if one does not already exist

### Step 6: Document

Produce a structured diagnosis:

```markdown
## Diagnosis: [Issue Summary]

**Symptoms**: What was happening
**Root Cause**: Why it was happening
**Evidence**: What confirmed the cause
**Fix**: What was changed
**Test**: How it was verified
```

## Quick Reference: Common Fix Patterns

| Issue | Fix Pattern |
|---|---|
| Missing dependency | Install the package, verify in lock file |
| Type error | Check types, add assertions or guards |
| Import error | Fix path, verify exports, check case sensitivity |
| Null reference | Add null check or optional chaining |
| Async issue | Add await, check promise chain |
| Circular dependency | Extract shared code to a third module |
| State not updating | Verify reactivity (e.g., `@observable`) |
| Event not firing | Check event binding syntax and naming |

## Checklist

- [ ] Full error message and stack trace read before investigating
- [ ] Issue reproduced consistently (or intermittency documented)
- [ ] Recent changes reviewed (`git diff`, `git log`)
- [ ] Root cause identified with supporting evidence
- [ ] Fix is minimal and targeted (no unrelated changes)
- [ ] Original error no longer occurs after fix
- [ ] Existing tests still pass
- [ ] Regression test added (or justification for skipping)
- [ ] Diagnosis documented with symptoms, cause, evidence, fix, and verification

## When to Escalate

| Condition | Action |
|---|---|
| Error message is unclear or undocumented | Search the web and project issues before escalating |
| Bug is in a third-party dependency | File an upstream issue or find a workaround |
| Root cause spans multiple systems | Involve the relevant team leads |
| Fix requires breaking API changes | Escalate to tech lead for approval |
| Cannot reproduce the issue | Document conditions and ask for more information |
| Security vulnerability discovered | Escalate to security team immediately |
| Intermittent failure with no pattern | Add instrumentation/logging before guessing |
