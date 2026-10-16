import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  timeout: 60000,
  outputDir: 'test-results',
  reporter: 'list',
});
