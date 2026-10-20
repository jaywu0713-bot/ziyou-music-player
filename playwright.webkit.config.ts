import base from './playwright.config';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  ...base,
  use: {
    ...base.use,
    browserName: 'webkit',
    launchOptions: {},
    baseURL: 'http://127.0.0.1:1420',
  },
});
