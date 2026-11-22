import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    testTimeout: 60_000,
    hookTimeout: 120_000,
    env: { LOG_LEVEL: 'silent' },
  },
});
