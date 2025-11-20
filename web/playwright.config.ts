import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

export default defineConfig({
  testDir: path.join(__dirname, 'e2e'),
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox',  use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit',   use: { ...devices['Desktop Safari'] } }
  ],

  // Starts the Next.js dev server for tests.
  webServer: {
    command: process.env.PLAYWRIGHT_WEB_CMD ?? 'npm run dev',
    cwd: __dirname,
    port: Number(process.env.PLAYWRIGHT_WEB_PORT ?? 3000),
    reuseExistingServer: !process.env.CI
  }
});
