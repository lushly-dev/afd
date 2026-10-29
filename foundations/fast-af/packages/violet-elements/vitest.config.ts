import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.stories.ts", "src/**/*.spec.ts", "src/**/index.ts"],
      thresholds: {
        statements: 62,
        branches: 48,
        functions: 64,
        lines: 62,
      },
    },
    include: ["src/**/*.spec.ts"],
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [
        {
          browser: "chromium",
        },
      ],
    },
  },
});
