import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/sim/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/sim/**/types.ts'],
      reporter: ['text-summary', 'text'],
      thresholds: {
        'src/sim/**': { statements: 90, branches: 90, functions: 90, lines: 90 },
      },
    },
  },
});
