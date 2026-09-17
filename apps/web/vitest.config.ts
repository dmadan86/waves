import { defineConfig } from 'vitest/config';

export default defineConfig({
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
