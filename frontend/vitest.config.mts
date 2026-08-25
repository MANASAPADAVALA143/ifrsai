import { defineConfig } from 'vitest/config';
import path from 'path';

// Scoped to unit tests only (lib/**/__tests__) — Playwright owns tests/*.spec.ts
// and must not be picked up by Vitest's collector.
export default defineConfig({
  test: {
    include: ['lib/**/__tests__/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
