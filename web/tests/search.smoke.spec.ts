// web/tests/search.smoke.spec.ts
import { test, expect } from '@playwright/test';

test('search page loads stub results', async ({ page }) => {
  await page.goto('http://localhost:3000/search');
  await expect(page.getByText('Filters')).toBeVisible();
  await expect(page.getByText('Results')).toBeVisible();
});
