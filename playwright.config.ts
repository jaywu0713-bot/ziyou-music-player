import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  timeout: 90000,
  workers: 1,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    headless: true,
    launchOptions: {
      executablePath:
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      args: ['--autoplay-policy=no-user-gesture-required'],
    },
  },
});
