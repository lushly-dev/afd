---
name: write-tests
source: botcore
description: >
  Guides unit, integration, and E2E test authoring using TDD workflows, AAA pattern, and coverage-driven development. Covers Vitest unit testing, Playwright E2E testing, mocking strategies, regression test discipline, and coverage targets. Use when writing new tests, adding regression tests for bugs, improving coverage, or setting up test infrastructure. Triggers: test, unit test, E2E, TDD, coverage, regression, mock, vitest, playwright.

version: 1.0.0
triggers:
  - test
  - unit test
  - E2E
  - TDD
  - coverage
  - regression
  - mock
  - vitest
  - playwright
  - snapshot
portable: true
---

# Writing Tests

Best practices and patterns for unit, integration, and E2E testing with coverage-driven development.

## Capabilities

1. Write unit tests using Vitest with the AAA (Arrange-Act-Assert) pattern
2. Write E2E tests using Playwright with Page Object Model
3. Apply TDD workflow: write failing test first, then implement, then refactor
4. Create regression tests that reproduce bugs before fixing them
5. Mock dependencies using Vitest mocks, spies, and MSW for API mocking
6. Configure and enforce coverage thresholds
7. Test web components including shadow DOM and custom events
8. Run visual regression and accessibility checks in E2E tests

## Routing Logic

| Request Type | Reference |
|---|---|
| Vitest unit tests, component tests, async tests, snapshots | `references/vitest-patterns.md` |
| Playwright E2E tests, navigation, forms, visual regression, a11y | `references/playwright-e2e.md` |
| Mocking functions, modules, APIs, timers, storage, custom elements | `references/mocking.md` |

## Core Principles

### 1. Test-Driven Development (TDD)

Follow the red-green-refactor cycle:

1. **Red** -- Write a failing test that describes the desired behavior
2. **Green** -- Write the minimum code to make the test pass
3. **Refactor** -- Clean up while keeping tests green

For bug fixes, always write a regression test that reproduces the failure before applying the fix.

### 2. AAA Pattern (Arrange-Act-Assert)

Structure every test with three distinct phases:

```typescript
it('should update count when button is clicked', () => {
  // Arrange - set up test data and preconditions
  const element = document.createElement('app-counter');
  document.body.appendChild(element);

  // Act - perform the action under test
  element.shadowRoot!.querySelector('button')!.click();

  // Assert - verify the expected outcome
  expect(element.count).toBe(1);
});
```

### 3. One Assertion per Behavior

Each test should verify a single behavior. Use descriptive names following the pattern: `it('should X when Y')`. Multiple related assertions about the same outcome are acceptable, but do not test multiple behaviors in one test.

### 4. Isolation and Determinism

- Reset state in `beforeEach`; clean up in `afterEach`
- Mock external dependencies (APIs, timers, storage)
- Never rely on test execution order
- Keep unit tests fast (< 100ms each)

### 5. Coverage Targets

| Metric | Target | Minimum |
|---|---|---|
| Statements | 85%+ | 80% |
| Branches | 80%+ | 75% |
| Functions | 90%+ | 85% |
| Lines | 85%+ | 80% |

Coverage is a guide, not a goal. Prioritize meaningful tests over hitting numbers.

## Workflow

### Adding Tests for New Features

1. Run existing tests to establish a green baseline
2. Write tests for the new feature's expected behavior
3. Implement the feature until tests pass
4. Check coverage report for uncovered paths
5. Add edge-case tests as needed

### Adding Regression Tests for Bugs

1. Reproduce the bug manually and identify the root cause
2. Write a test that fails due to the bug (include issue reference in name)
3. Fix the bug
4. Verify the test now passes
5. Run the full suite to check for regressions

### Improving Coverage

1. Run `vitest --coverage` and review the report
2. Identify uncovered branches, statements, and functions
3. Prioritize business-critical and error-handling paths
4. Write tests targeting the gaps
5. Verify thresholds are met

## Quick Reference

### Unit Test Skeleton (Vitest)

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('FeatureName', () => {
  let subject: FeatureType;

  beforeEach(() => {
    subject = createFeature();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should behave correctly in default state', () => {
    expect(subject.value).toBe('default');
  });

  it('should handle edge case', () => {
    subject.update('edge');
    expect(subject.isValid).toBe(false);
  });
});
```

### E2E Test Skeleton (Playwright)

```typescript
import { test, expect } from '@playwright/test';

test('user can complete checkout flow', async ({ page }) => {
  await page.goto('/shop');
  await page.click('[data-testid="add-to-cart"]');
  await page.click('[data-testid="checkout"]');
  await page.fill('input[name="email"]', 'test@example.com');
  await page.click('button[type="submit"]');
  await expect(page.locator('.confirmation')).toBeVisible();
});
```

## Anti-Patterns

| Avoid | Do Instead |
|---|---|
| Testing implementation details | Test behavior and outcomes |
| Flaky async tests with arbitrary delays | Use proper waits (`waitFor`, `expect` with polling) |
| Shared mutable state between tests | Reset in `beforeEach`, clean in `afterEach` |
| Testing framework or library code | Test only your application code |
| Giant test files with mixed concerns | Organize by feature or component |
| Hard-coded selectors in E2E | Use `data-testid` attributes |
| Ignoring or skipping failing tests | Fix or delete them |

## Checklist

- [ ] Tests follow the AAA pattern with clear Arrange/Act/Assert phases
- [ ] Each test has a descriptive name: `should X when Y`
- [ ] External dependencies are mocked (APIs, timers, storage)
- [ ] State is reset in `beforeEach` and cleaned in `afterEach`
- [ ] Coverage meets minimum thresholds (80% statements, 75% branches, 85% functions)
- [ ] Regression tests include issue/bug reference in the test name
- [ ] E2E tests use stable selectors (`data-testid`)
- [ ] No flaky tests -- async operations use proper waits
- [ ] Tests run in isolation and pass regardless of execution order
- [ ] Test suite completes in a reasonable time

## When to Escalate

- **Flaky tests in CI that pass locally** -- may indicate environment-specific issues, race conditions, or resource constraints; investigate CI logs and consider retry strategies or environment parity
- **Coverage below minimum thresholds with no clear path forward** -- may indicate tightly coupled code that needs refactoring before it can be tested
- **E2E tests requiring external service dependencies** -- consider contract testing or mock service workers rather than hitting real services
- **Performance testing requirements** -- unit and E2E tests are not substitutes for load/stress testing; use dedicated tools (k6, Artillery)
- **Security testing requirements** -- use dedicated SAST/DAST tools rather than trying to cover security concerns purely through functional tests
