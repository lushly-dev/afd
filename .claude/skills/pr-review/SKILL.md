---
name: pr-review
description: >
  Review pull requests using AFD (Agent-First Development) standards. Evaluates
  code quality, command design, CLI validation, performance, security, test
  coverage, and adherence to AFD conventions. Use when: reviewing PRs, code
  changes, suggesting improvements, or checking AFD compliance.
  Triggers: review PR, code review, review changes, check code quality,
  AFD compliance check, review pull request.
---

# PR Review Skill

Review pull requests against AFD standards and best practices.

## Review Checklist

### 1. AFD Compliance

**Command-First Architecture**

- [ ] New functionality exposed as commands before UI
- [ ] Commands follow `domain.action` naming (e.g., `todo.create`)
- [ ] All business logic lives in command handlers, not UI
- [ ] No UI-only code paths exist
- [ ] Command is testable via `afd call`

**CommandResult Structure**

- [ ] Returns `{ success, data?, error? }` structure
- [ ] Success results include `reasoning` explaining what happened
- [ ] Error results include `suggestion` for recovery
- [ ] Uses standard error codes (NOT_FOUND, VALIDATION_ERROR, etc.)
- [ ] Mutations include appropriate `warnings` for side effects

**Schema Design**

- [ ] Input validated with Zod (TS), Pydantic (Python), or JSON Schema (Rust)
- [ ] Required vs optional fields correctly marked
- [ ] Sensible defaults provided where appropriate
- [ ] Field descriptions help agents understand usage

### 2. Code Quality

**Clarity and Maintainability**

- [ ] Functions/methods have single responsibility
- [ ] Variables and functions are descriptively named
- [ ] No unnecessary complexity or over-engineering
- [ ] Code is self-documenting (minimal comments needed)

**TypeScript Specific**

- [ ] Strict mode enabled, no `any` types without justification
- [ ] Proper use of generics where type safety matters
- [ ] Import types with `import type { ... }`
- [ ] No unused imports or variables

**Python Specific**

- [ ] Type hints on function signatures
- [ ] Pydantic models for structured data
- [ ] Async/await used correctly for I/O operations
- [ ] PEP 8 style compliance

**Rust Specific**

- [ ] Proper error handling with Result types
- [ ] No unwrap() in library code without justification
- [ ] Ownership and borrowing used correctly
- [ ] Documentation comments on public APIs

### 3. Testing

**Test Coverage**

- [ ] New commands have corresponding tests
- [ ] Happy path and error cases covered
- [ ] Edge cases identified and tested
- [ ] No decrease in overall test coverage

**Test Quality**

- [ ] Tests follow Arrange-Act-Assert pattern
- [ ] Test names describe expected behavior
- [ ] Tests are isolated (no shared mutable state)
- [ ] Mocks/stubs used appropriately

**AFD-Specific Tests**

- [ ] Unit tests for command handler logic
- [ ] Schema validation tests (accept/reject)
- [ ] AFD compliance tests (CommandResult structure)
- [ ] Performance tests for critical paths

### 4. Security

**Input Validation**

- [ ] All user input validated at system boundaries
- [ ] No SQL injection vulnerabilities
- [ ] No command injection in shell operations
- [ ] XSS prevention for web surfaces

**Secrets and Credentials**

- [ ] No hardcoded secrets or API keys
- [ ] Environment variables used for configuration
- [ ] `.env` files in `.gitignore`
- [ ] Sensitive data not logged

### 5. Performance

**Efficiency**

- [ ] No N+1 query patterns
- [ ] Appropriate use of caching
- [ ] Async operations for I/O-bound work
- [ ] No blocking operations in hot paths

**AFD Performance**

- [ ] Command execution within expected thresholds
- [ ] Batch operations available for bulk work
- [ ] Streaming used for large result sets

### 6. Documentation

**Code Documentation**

- [ ] Public APIs have documentation
- [ ] Complex logic has explanatory comments
- [ ] Command descriptions are clear and actionable

**README/CHANGELOG**

- [ ] Breaking changes documented
- [ ] New features described in CHANGELOG
- [ ] Migration guide if needed

## Review Output Format

```markdown
## Summary
[Approve / Request Changes / Comment]

## AFD Compliance
- [Status and specific findings]

## Code Quality
- [Specific issues with file:line references]

## Testing
- [Coverage assessment and gaps]

## Security
- [Any concerns]

## Suggestions
- [Constructive improvements]

## Positive Highlights
- [Good patterns worth noting]
```

## Common Issues to Flag

### Red Flags (Request Changes)

1. **UI-only code paths** - Business logic in components, not commands
2. **Missing schemas** - Commands without input validation
3. **Hardcoded secrets** - API keys, passwords in code
4. **No tests** - New functionality without test coverage
5. **Breaking changes** - Without migration path

### Yellow Flags (Comment)

1. **Missing reasoning** - Success results without explanation
2. **Generic errors** - Errors without recovery suggestions
3. **No confidence** - AI-driven results without confidence scores
4. **Incomplete types** - Using `any` or missing type annotations

### Green Flags (Praise)

1. **Command-first** - New features properly abstracted
2. **Comprehensive tests** - Good coverage including edge cases
3. **Clear schemas** - Well-documented input/output types
4. **UX metadata** - Proper use of reasoning, confidence, warnings

## Review Process

1. **Understand Context** - Read PR description and linked issues
2. **Check Scope** - Verify changes match stated intent
3. **Review Files** - Go through changes systematically
4. **Run Tests** - Verify tests pass locally if needed
5. **Test via CLI** - For command changes, validate with `afd call`
6. **Provide Feedback** - Constructive, actionable, kind

## Related Skills

- `afd-developer` - Core AFD methodology
- `commit-messages` - Commit format standards
