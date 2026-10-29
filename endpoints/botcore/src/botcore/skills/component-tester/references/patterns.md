# Test Patterns

Reusable Playwright test patterns for common component testing scenarios.

## Pattern 1: Component renders correctly

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
});
```

## Pattern 2: Attribute reflection

```typescript
test("reflects title attribute", async ({ page }) => {
  const card = page.locator("my-card");
  await expect(card).toHaveAttribute("title", "Expected Title");

  // Verify rendered text inside shadow DOM
  const heading = card.locator("h3, .title");
  await expect(heading).toHaveText("Expected Title");
});
```

## Pattern 3: User interaction

```typescript
test("clicking button triggers action", async ({ page }) => {
  const button = page.locator("my-button");
  await button.click();

  // Verify result of click
  const result = page.locator(".result-message");
  await expect(result).toBeVisible();
  await expect(result).toHaveText(/success/i);
});
```

## Pattern 4: Design token verification

```typescript
test("uses correct design tokens", async ({ page }) => {
  const tokens = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      bg: style.getPropertyValue("--colorNeutralBackground1").trim(),
      fg: style.getPropertyValue("--colorNeutralForeground1").trim(),
      brand: style.getPropertyValue("--colorBrandBackground").trim(),
    };
  });

  // Tokens should resolve to actual color values
  expect(tokens.bg).toMatch(/^#|^rgb/);
  expect(tokens.fg).toMatch(/^#|^rgb/);
  expect(tokens.brand).toMatch(/^#|^rgb/);
});
```

## Pattern 5: Theme switching

```typescript
test("theme switch updates visual appearance", async ({ page }) => {
  // Capture light theme
  await expect(page).toHaveScreenshot("component-light.png");

  // Switch to dark theme
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "dark");
  });
  await page.waitForTimeout(300);

  // Capture dark theme
  await expect(page).toHaveScreenshot("component-dark.png");
});
```

## Pattern 6: Accessibility check

```typescript
import AxeBuilder from "@axe-core/playwright";

test("meets WCAG 2.2 AA", async ({ page }) => {
  const results = await new AxeBuilder({ page })
    .include("my-component")
    .withTags(["wcag2aa", "wcag22aa"])
    .analyze();

  const issues = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  expect(issues).toHaveLength(0);
});
```

## Pattern 7: Navigation flow

```typescript
test("navigating between items updates the view", async ({ page }) => {
  const nav = page.locator("my-nav");
  const buttons = nav.locator("button");

  // Click second item
  await buttons.nth(1).click();
  await page.waitForTimeout(300);

  // Verify aria-current updated
  const selected = page.locator('[aria-current="page"]');
  await expect(selected).toHaveCount(1);

  // Verify content changed
  await expect(page).toHaveScreenshot("item-selected.png");
});
```

## Pattern 8: Full component lifecycle

Complete test suite for a new component from creation to verification:

```typescript
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("New Widget Component", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("my-app-shell");
  });

  test("renders in the page", async ({ page }) => {
    const widget = page.locator("new-widget");
    await expect(widget).toBeVisible();
  });

  test("visual appearance matches baseline", async ({ page }) => {
    const widget = page.locator("new-widget");
    await expect(widget).toHaveScreenshot("new-widget.png");
  });

  test("responds to user interaction", async ({ page }) => {
    const widget = page.locator("new-widget");
    const button = widget.locator("button");
    await button.click();
    // Assert expected behavior
  });

  test("passes accessibility checks", async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .include("new-widget")
      .withTags(["wcag2aa"])
      .analyze();
    const critical = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    expect(critical).toHaveLength(0);
  });

  test("works with dark theme", async ({ page }) => {
    await page.evaluate(() => {
      document.documentElement.setAttribute("data-theme", "dark");
    });
    await page.waitForTimeout(300);
    const widget = page.locator("new-widget");
    await expect(widget).toHaveScreenshot("new-widget-dark.png");
  });
});
```

## Pattern 9: Unit test (for business logic)

For testing command handlers and logic -- use Vitest or Jest, not Playwright:

```typescript
import { describe, it, expect } from "vitest";
import { myCommand } from "../src/commands/my-command.js";

describe("my-command", () => {
  it("returns success with valid input", async () => {
    const result = await myCommand.handler({ name: "test" }, {});
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });

  it("returns failure with suggestion on invalid input", async () => {
    const result = await myCommand.handler({}, {});
    expect(result.success).toBe(false);
    expect(result.error?.suggestion).toBeDefined();
  });
});
```
