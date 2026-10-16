import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/perf/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120000,
    silent: false,
  },
});
