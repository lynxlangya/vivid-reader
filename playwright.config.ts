import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  timeout: 60000,
  outputDir: mkdtempSync(join(tmpdir(), 'vivid-e2e-artifacts-')),
  reporter: 'list',
});
