import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // `@/` is how the app imports its own modules, and tsconfig already maps it.
  // Vitest resolves imports itself, so without this a module under test that
  // imports a sibling through the alias fails to load — and the failure reads
  // as a broken test rather than a missing config line.
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // The web's tests are plain Node, but one of them renders a component to a
  // string to prove what that component can and cannot emit. Without this the
  // transform emits classic `React.createElement` calls into a file that never
  // imports React.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/**/*.test.{ts,tsx}', 'test/**'],
    },
  },
});
