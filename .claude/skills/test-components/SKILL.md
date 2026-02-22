---
name: test-components
source: botcore
description: >
  Guides Playwright E2E testing, visual regression screenshots, Shadow DOM querying, and axe-core accessibility checks for web components. Covers test file structure, baseline management, WCAG 2.2 AA assertions, keyboard navigation, design token verification, and the build-test-verify loop. Use when writing component tests, debugging visual regressions, setting up accessibility checks, or querying Shadow DOM elements. Triggers: playwright, e2e, visual test, component test, screenshot, axe, accessibility test, shadow dom, wcag, visual regression.

version: 1.0.0
triggers:
  - playwright
  - e2e
  - visual test
  - component test
  - screenshot
  - axe
  - accessibility test
  - shadow dom
  - wcag
  - visual regression
portable: true
---

# Testing Components

Playwright-based E2E testing, visual regression, Shadow DOM querying, and axe-core accessibility for web components.

## Capabilities

1. **E2E testing** -- Full-page Playwright tests against a live dev server
2. **Visual regression** -- Screenshot comparison to catch unintended visual changes
3. **Accessibility testing** -- Automated WCAG 2.2 AA checks with axe-core
4. **Shadow DOM queries** -- Patterns for inspecting web components with encapsulated DOM
5. **Design token verification** -- Confirm CSS custom properties resolve correctly
6. **Keyboard navigation testing** -- Validate tab order, focus indicators, and activation
7. **Test patterns** -- Reusable patterns for rendering, interaction, theming, and lifecycle

## Routing Logic

| Request type | Load reference |
| --- | --- |
| Shadow DOM selectors, web component queries | [references/shadow-dom.md](references/shadow-dom.md) |
| Screenshot baselines, visual diff workflow | [references/visual-regression.md](references/visual-regression.md) |
| axe-core setup, WCAG assertions | [references/accessibility-testing.md](references/accessibility-testing.md) |
| Test patterns, full examples | [references/patterns.md](references/patterns.md) |

## Core Principles

### 1. Every component gets a test

Each component directory should have a corresponding test file. Valid locations include dedicated E2E spec files (`tests/e2e/{name}.spec.ts`), co-located test files (`*.test.ts`), or a project-specific convention. Enforce this via commit hooks or CI checks.

### 2. Two test layers

| Layer | Runner | Purpose | Speed |
| --- | --- | --- | --- |
| **Unit** | Vitest / Jest (jsdom) | Command logic, data flow, error handling | Fast (~1s) |
| **E2E** | Playwright (Chromium) | Visual rendering, interactions, a11y, tokens | Slower (~10s) |

Use unit tests for business logic and command handlers. Use Playwright for anything requiring a real browser -- visual rendering, CSS custom properties, Shadow DOM, and interactions.

### 3. Real browser, real rendering

Playwright runs in actual Chromium with no mocking of web components:

- CSS custom properties (design tokens) resolve to real values
- Shadow DOM is fully rendered and queryable
- ESM imports work natively (no `vi.mock` needed)
- Interactions trigger real DOM events

### 4. Build, test, verify loop

When building a new component, follow this cycle:

1. Create component files
2. Register the component (e.g., in a main entry point)
3. Write a Playwright E2E test (`tests/e2e/{name}.spec.ts`)
4. Run tests: `npx playwright test`
5. If failing, fix the component and re-run
6. Update screenshot baselines: `npx playwright test --update-snapshots`
7. Run accessibility check to verify WCAG compliance

## Quick Reference

```bash
# Run all E2E tests
npx playwright test

# Interactive UI mode (debug visually)
npx playwright test --ui

# Run a specific test file
npx playwright test tests/e2e/shell.spec.ts

# Update screenshot baselines after intentional visual changes
npx playwright test --update-snapshots

# Run unit tests
npx vitest
```

## Test File Structure

```
tests/
  *.test.ts          <-- Unit tests (jsdom)
  e2e/
    *.spec.ts        <-- Playwright E2E tests (Chromium)
    results/         <-- Test artifacts (screenshots on failure)
    *.spec.ts-snapshots/  <-- Screenshot baselines (committed to git)
```

## Workflow

### Writing a new E2E test

```typescript
import { test, expect } from "@playwright/test";

test.describe("My Component", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("my-component");
  });

  test("renders and is visible", async ({ page }) => {
    const component = page.locator("my-component");
    await expect(component).toBeVisible();
  });

  test("visual appearance matches baseline", async ({ page }) => {
    const component = page.locator("my-component");
    await expect(component).toHaveScreenshot("my-component.png");
  });

  test("passes accessibility checks", async ({ page }) => {
    const AxeBuilder = (await import("@axe-core/playwright")).default;
    const results = await new AxeBuilder({ page })
      .include("my-component")
      .withTags(["wcag2aa", "wcag22aa"])
      .analyze();

    const critical = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    expect(critical).toHaveLength(0);
  });
});
```

### Shadow DOM querying (quick summary)

Playwright automatically pierces shadow roots when chaining locators:

```typescript
// Chain locators to pierce shadow boundaries
const button = page.locator("my-button").locator("button");

// Nested shadow DOM (component within component)
const inner = page
  .locator("my-shell")
  .locator("my-header")
  .locator("button");

// CSS >> deep combinator
const item = page.locator("my-nav >> .nav-item");
```

For computed styles inside Shadow DOM, use `page.evaluate()`:

```typescript
const bgColor = await page.evaluate(() => {
  const el = document.querySelector("my-component");
  const inner = el?.shadowRoot?.querySelector(".container");
  return inner ? getComputedStyle(inner).backgroundColor : null;
});
```

See [references/shadow-dom.md](references/shadow-dom.md) for full patterns.

### Visual regression (quick summary)

```typescript
// Full page screenshot
await expect(page).toHaveScreenshot("page-full.png", { fullPage: true });

// Element screenshot
const nav = page.locator("my-nav");
await expect(nav).toHaveScreenshot("nav.png");
```

- First run creates baselines in `*.spec.ts-snapshots/`
- Update baselines: `npx playwright test --update-snapshots`
- Failed diffs appear in `tests/e2e/results/` with actual, expected, and diff images
- Always wait for animations/rendering to stabilize before capturing

See [references/visual-regression.md](references/visual-regression.md) for configuration and best practices.

### Accessibility testing (quick summary)

```typescript
import AxeBuilder from "@axe-core/playwright";

const results = await new AxeBuilder({ page })
  .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
  .analyze();

const critical = results.violations.filter(
  (v) => v.impact === "critical" || v.impact === "serious",
);
expect(critical).toHaveLength(0);
```

- Scope to a specific component with `.include("my-component")`
- Exclude known upstream issues with `.exclude()` or `.disableRules()`
- Document all exclusions with comments

See [references/accessibility-testing.md](references/accessibility-testing.md) for WCAG tags, keyboard testing, and reporting patterns.

## Checklist

- [ ] Every component has a corresponding test file
- [ ] E2E test covers rendering, visibility, and basic interaction
- [ ] Screenshot baselines are created and committed to git
- [ ] Accessibility check passes with no critical or serious violations
- [ ] Light and dark themes are tested separately (if applicable)
- [ ] Shadow DOM elements are queried using locator chaining (not raw selectors)
- [ ] Tests wait for component rendering before assertions
- [ ] Design tokens are verified to resolve to real values (not empty strings)
- [ ] Keyboard navigation is validated (Tab, Enter, Space)
- [ ] Test artifacts directory (`results/`) is in `.gitignore`; snapshot baselines are NOT

## When to Escalate

- Visual regression failures on components you did not modify (upstream dependency change)
- axe-core violations originating in third-party web components (report upstream)
- Flaky E2E tests that pass locally but fail in CI (check timing, animation waits, viewport size)
- Shadow DOM structure changes after a web component library upgrade
- Screenshot baselines that differ across operating systems or CI environments
