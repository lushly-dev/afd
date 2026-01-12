import { test, expect } from '@playwright/test';

test('homepage loads successfully', async ({ page }) => {
  await page.goto('/');

  // Check that the page loads and has a title
  await expect(page).toHaveTitle(/AFD Todo/i);

  // Check for main content area
  await expect(page.locator('body')).toBeVisible();
});