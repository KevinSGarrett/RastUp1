import { test, expect } from '@playwright/test';

test('auth → booking → payment (stub skeleton)', async ({ page }) => {
  await page.goto('/');
  await page.click('[data-testid="link-signup"]');
  await page.fill('[data-testid="input-email"]', `e2e+${Date.now()}@example.com`);
  await page.fill('[data-testid="input-password"]', 'Passw0rd!Passw0rd!');
  await page.click('[data-testid="btn-submit-signup"]');

  await page.waitForURL('**/dashboard');

  await page.click('[data-testid="listing-card-0"]');
  await page.click('[data-testid="btn-book-now"]');

  // Stripe test mode: use 4242 4242 4242 4242 etc.
  await page.fill('[data-testid="card-number"]', '4242 4242 4242 4242');
  await page.fill('[data-testid="card-exp"]', '12 / 34');
  await page.fill('[data-testid="card-cvc"]', '123');
  await page.click('[data-testid="btn-pay"]');

  await expect(page.locator('[data-testid="payment-status"]')).toHaveText(/succeeded|confirmed/i);
});
