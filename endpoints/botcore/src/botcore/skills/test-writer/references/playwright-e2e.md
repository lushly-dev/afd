# Playwright E2E Patterns

End-to-end testing patterns with Playwright.

## Configuration

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  webServer: {
    command: 'pnpm dev',
    port: 5173,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
});
```

## Basic Test

```typescript
import { test, expect } from '@playwright/test';

test('home page loads', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/My App/);
  await expect(page.locator('h1')).toContainText('Welcome');
});
```

## Navigation

```typescript
test('navigation works', async ({ page }) => {
  await page.goto('/');

  await page.click('nav a[href="/about"]');

  await expect(page).toHaveURL('/about');
  await expect(page.locator('h1')).toContainText('About');
});
```

## Forms

```typescript
test('form submission', async ({ page }) => {
  await page.goto('/contact');

  await page.fill('input[name="email"]', 'test@example.com');
  await page.fill('textarea[name="message"]', 'Hello!');

  await page.click('button[type="submit"]');

  await expect(page.locator('.success-message')).toBeVisible();
});
```

## Testing Web Components

```typescript
test('custom element works', async ({ page }) => {
  await page.goto('/');

  const button = page.locator('app-button');
  await expect(button).toBeVisible();

  // Shadow DOM content
  const shadowButton = button.locator('button');
  await shadowButton.click();

  await expect(button).toHaveAttribute('pressed', 'true');
});
```

## Visual Regression

```typescript
test('homepage visual', async ({ page }) => {
  await page.goto('/');

  await page.waitForLoadState('networkidle');

  // Full page screenshot
  await expect(page).toHaveScreenshot('homepage.png');

  // Element screenshot
  const hero = page.locator('.hero');
  await expect(hero).toHaveScreenshot('hero-section.png');
});
```

## Page Object Model

```typescript
// tests/pages/home.page.ts
import { Page, Locator } from '@playwright/test';

export class HomePage {
  readonly page: Page;
  readonly heading: Locator;
  readonly loginButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.locator('h1');
    this.loginButton = page.locator('button:has-text("Login")');
  }

  async goto() {
    await this.page.goto('/');
  }

  async login() {
    await this.loginButton.click();
  }
}

// In test
test('using page object', async ({ page }) => {
  const home = new HomePage(page);
  await home.goto();
  await home.login();
});
```

## Accessibility Testing

```typescript
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('no a11y violations', async ({ page }) => {
  await page.goto('/');

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
```
