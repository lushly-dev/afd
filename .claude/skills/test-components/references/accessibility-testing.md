# Accessibility Testing

Automated WCAG compliance testing with @axe-core/playwright.

## Setup

Install `@axe-core/playwright` as a dev dependency:

```bash
npm install -D @axe-core/playwright
```

Import in test files:

```typescript
import AxeBuilder from "@axe-core/playwright";
```

## Basic usage

```typescript
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("page has no critical a11y violations", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("my-app-shell");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();

  // Filter for critical and serious only
  const critical = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  expect(critical).toHaveLength(0);
});
```

## WCAG tag reference

| Tag | Standard |
| --- | --- |
| `wcag2a` | WCAG 2.0 Level A |
| `wcag2aa` | WCAG 2.0 Level AA |
| `wcag21a` | WCAG 2.1 Level A |
| `wcag21aa` | WCAG 2.1 Level AA |
| `wcag22aa` | WCAG 2.2 Level AA |
| `best-practice` | Best practices (not required by WCAG) |

## Scoped analysis

Test a specific component instead of the full page:

```typescript
// Analyze only the navigation component
const results = await new AxeBuilder({ page })
  .include("my-nav")
  .withTags(["wcag2aa"])
  .analyze();
```

## Excluding known issues

If a third-party component has a known a11y issue:

```typescript
const results = await new AxeBuilder({ page })
  .withTags(["wcag2aa"])
  .exclude(".known-upstream-issue") // Exclude by selector
  .disableRules(["color-contrast"]) // Disable specific rule
  .analyze();
```

Always document exclusions with comments explaining why.

## Reporting violations

Format violations for clear debugging output:

```typescript
if (results.violations.length > 0) {
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    description: v.description,
    nodes: v.nodes.length,
    helpUrl: v.helpUrl,
  }));
  console.log("Violations:", JSON.stringify(summary, null, 2));
}
```

## Common WCAG checks

| Check | axe rule | What it validates |
| --- | --- | --- |
| Color contrast | `color-contrast` | Text meets 4.5:1 (AA) or 3:1 (large text) |
| Button labels | `button-name` | All buttons have accessible names |
| Image alt text | `image-alt` | Images have alt attributes |
| Form labels | `label` | Form inputs have associated labels |
| Heading order | `heading-order` | Headings follow logical hierarchy |
| ARIA roles | `aria-allowed-role` | ARIA roles are valid for the element |
| Focus visible | `focus-visible` | Focus indicators are present |
| Keyboard access | `keyboard` | Interactive elements are keyboard accessible |

## Keyboard testing

Playwright can simulate keyboard navigation:

```typescript
test("keyboard navigation works", async ({ page }) => {
  await page.goto("/");

  // Tab through interactive elements
  await page.keyboard.press("Tab");
  const first = await page.evaluate(() => document.activeElement?.tagName);
  expect(first).not.toBe("BODY");

  // Tab to next element
  await page.keyboard.press("Tab");
  const second = await page.evaluate(() => document.activeElement?.tagName);

  // Verify focus moved
  expect(second).toBeTruthy();

  // Press Enter to activate
  await page.keyboard.press("Enter");
});
```

## Tips

- Run accessibility checks after the page is fully rendered (wait for custom elements)
- Test both light and dark themes for color contrast
- Combine axe-core with manual keyboard testing for full coverage
- Treat critical and serious violations as test failures; moderate and minor as warnings
- Keep axe-core updated to get the latest WCAG 2.2 rule coverage
