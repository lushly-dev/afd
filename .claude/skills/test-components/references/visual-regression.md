# Visual Regression Testing

Screenshot comparison workflow with Playwright.

## How it works

Playwright captures screenshots and compares them against stored baselines. Any pixel difference beyond the threshold fails the test.

```typescript
// Capture full page
await expect(page).toHaveScreenshot("shell-full-page.png", {
  fullPage: true,
});

// Capture a specific element
const nav = page.locator("my-nav");
await expect(nav).toHaveScreenshot("nav.png");
```

## Baseline management

### First run -- create baselines

On first run, Playwright creates baseline images in `tests/e2e/*.spec.ts-snapshots/`:

```bash
npx playwright test --update-snapshots
```

These files are committed to git so the team shares the same baselines.

### Intentional changes -- update baselines

After making intentional visual changes to a component:

```bash
# Update all baselines
npx playwright test --update-snapshots

# Update specific test
npx playwright test tests/e2e/theme.spec.ts --update-snapshots
```

Review the updated screenshots before committing.

### Unintentional changes -- investigate

If a test fails unexpectedly, Playwright generates a diff report in `tests/e2e/results/`:

```
tests/e2e/results/
  component-chromium/
    component-actual.png      <-- What it looks like now
    component-expected.png    <-- The baseline
    component-diff.png        <-- Highlighted differences
```

## Configuration

In `playwright.config.ts`:

```typescript
expect: {
  toHaveScreenshot: {
    maxDiffPixelRatio: 0.01,  // Allow 1% pixel difference
  },
},
```

For per-test override:

```typescript
await expect(page).toHaveScreenshot("name.png", {
  maxDiffPixelRatio: 0.02, // More lenient for this test
  threshold: 0.3,          // Per-pixel color threshold
});
```

## Best practices

### Wait before capturing

Components render asynchronously. Always wait for stability:

```typescript
// Wait for animations/transitions to complete
await page.waitForTimeout(500);

// Or wait for a specific condition
await page.waitForFunction(() => {
  return document.querySelector("my-app-shell")?.shadowRoot !== null;
});

await expect(page).toHaveScreenshot("name.png");
```

### Test light and dark themes separately

```typescript
test("light theme", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveScreenshot("component-light.png");
});

test("dark theme", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "dark");
  });
  await page.waitForTimeout(300);
  await expect(page).toHaveScreenshot("component-dark.png");
});
```

### Name screenshots descriptively

Use consistent naming: `{component}-{state}.png`

```
shell-full-page.png
side-nav-home-selected.png
theme-dark.png
ribbon-insert-tab.png
```

### Commit baselines to git

Add test results to `.gitignore` but NOT the snapshot baselines:

```
# Playwright test results (not baselines)
tests/e2e/results/
```

Do NOT ignore the `*-snapshots/` folders -- those are the baselines.

## Cross-environment considerations

- Screenshots may differ across operating systems (font rendering, anti-aliasing)
- Use Docker or CI-specific baselines if local and CI screenshots diverge
- Consider using `maxDiffPixelRatio` to tolerate minor rendering differences
- Pin the Playwright browser version to avoid baseline churn on upgrades
