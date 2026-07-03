import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Node by default; DOM-touching test files opt into jsdom via
    // a `// @vitest-environment jsdom` docblock.
    environment: 'node',
  },
});
