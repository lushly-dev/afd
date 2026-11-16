import { defineConfig } from 'vitest/config';

/** The unit and backend tests; `test/page-suite.ts` runs from each frontend's browser config. */
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } });
