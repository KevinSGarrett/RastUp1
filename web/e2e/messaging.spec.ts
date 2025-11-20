import { test, expect } from '@playwright/test';

test('Messaging workspace renders', async ({ page }) => {
  await page.goto('/messaging');
  await expect(page.getByRole('heading', { name: /inbox/i })).toBeVisible();
});
