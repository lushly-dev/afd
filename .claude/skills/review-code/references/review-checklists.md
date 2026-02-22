# PR Review Checklists

Detailed checklists for each review dimension. Use these during the systematic review workflow.

## 1. Code Quality

### Clarity and Maintainability

- [ ] Functions and methods have single responsibility
- [ ] Variables and functions are descriptively named
- [ ] No unnecessary complexity or over-engineering
- [ ] Code is self-documenting (minimal comments needed)
- [ ] No dead code or commented-out blocks left behind

### TypeScript

- [ ] Strict mode enabled, no `any` types without justification
- [ ] Proper use of generics where type safety matters
- [ ] Import types with `import type { ... }` where applicable
- [ ] No unused imports or variables
- [ ] Consistent use of `const`/`let` (no `var`)

### Python

- [ ] Type hints on all function signatures
- [ ] Pydantic or dataclass models for structured data
- [ ] Async/await used correctly for I/O operations
- [ ] PEP 8 style compliance
- [ ] Context managers used for resource handling

### Rust

- [ ] Proper error handling with `Result` types
- [ ] No `unwrap()` in library code without justification
- [ ] Ownership and borrowing used correctly
- [ ] Documentation comments on public APIs
- [ ] Clippy warnings addressed

### Go

- [ ] Errors checked and handled, not discarded
- [ ] Goroutines have proper lifecycle management
- [ ] Interfaces are small and consumer-defined
- [ ] `defer` used correctly for cleanup
- [ ] No shadowed variables in nested scopes

## 2. Security

### Input Validation

- [ ] All user input validated at system boundaries
- [ ] No SQL injection vulnerabilities (parameterized queries used)
- [ ] No command injection in shell operations (no string interpolation in exec)
- [ ] XSS prevention for web surfaces (output encoding applied)
- [ ] Path traversal prevented (user input not used in file paths without sanitization)

### Secrets and Credentials

- [ ] No hardcoded secrets, API keys, or passwords
- [ ] Environment variables or secret managers used for configuration
- [ ] `.env` files listed in `.gitignore`
- [ ] Sensitive data not logged or exposed in error messages
- [ ] Tokens have appropriate expiry and scope

### Authentication and Authorization

- [ ] Auth checks present on all protected endpoints
- [ ] Authorization verified for the specific resource, not just authentication
- [ ] Session handling follows secure defaults (HttpOnly, Secure, SameSite)
- [ ] Rate limiting applied to auth-related endpoints

## 3. Testing

### Test Coverage

- [ ] New functionality has corresponding tests
- [ ] Happy path and error cases both covered
- [ ] Edge cases identified and tested (empty input, boundary values, nulls)
- [ ] No decrease in overall test coverage percentage

### Test Quality

- [ ] Tests follow Arrange-Act-Assert pattern
- [ ] Test names describe expected behavior (not implementation)
- [ ] Tests are isolated (no shared mutable state between tests)
- [ ] Mocks and stubs used appropriately (not over-mocked)
- [ ] Tests are deterministic (no flaky reliance on timing or order)

### Integration and E2E

- [ ] Integration tests cover critical paths across service boundaries
- [ ] API contract tests present for public endpoints
- [ ] Database migration tests verify up and down paths
- [ ] External service interactions are stubbed in CI, tested in staging

## 4. Performance

### Efficiency

- [ ] No N+1 query patterns (batch or join instead)
- [ ] Appropriate use of caching (with invalidation strategy)
- [ ] Async operations for I/O-bound work
- [ ] No blocking operations in hot paths or event loops
- [ ] Pagination applied for list endpoints returning unbounded results

### Resource Management

- [ ] Database connections pooled and released properly
- [ ] File handles and streams closed after use
- [ ] Memory allocation reasonable for expected data sizes
- [ ] No unbounded growth in collections or queues

### Observability

- [ ] Critical operations have logging at appropriate levels
- [ ] Metrics emitted for latency-sensitive operations
- [ ] Error rates trackable through structured logging
- [ ] Trace context propagated across service boundaries

## 5. Documentation

### Code Documentation

- [ ] Public APIs have documentation (JSDoc, docstrings, doc comments)
- [ ] Complex or non-obvious logic has explanatory comments
- [ ] Function signatures communicate intent through naming and types

### Changelog and Migration

- [ ] Breaking changes documented in CHANGELOG or release notes
- [ ] New features described with usage examples
- [ ] Migration guide provided if upgrading requires manual steps
- [ ] Deprecated features marked with timeline for removal
