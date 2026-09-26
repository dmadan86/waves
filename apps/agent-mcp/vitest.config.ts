import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Only the sources. `dist/` holds stale compiled copies of old tests, and
    // running them again counts every one twice while testing nothing new.
    include: ['src/**/*.test.ts'],
  },
});
