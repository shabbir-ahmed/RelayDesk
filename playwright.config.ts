import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  retries: 0,
  timeout: 65_000,
  reporter: 'list',
  expect: { timeout: 8_000 },
  use: {
    baseURL: process.env.APP_ORIGIN,
    browserName: 'chromium',
    trace: 'retain-on-failure',
  },
})
