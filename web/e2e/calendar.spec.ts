import { test, expect } from '@playwright/test';

test('Calendar dashboard renders', async ({ page }) => {
  await page.goto('/calendar');
  await expect(page.getByText(/availability/i)).toBeVisible();
});
