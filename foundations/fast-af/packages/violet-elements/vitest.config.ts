import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

type BrowserName = "chromium" | "firefox" | "webkit";

const ALLOWED_BROWSERS = new Set<BrowserName>(["chromium", "firefox", "webkit"]);

function selectedBrowsers(): BrowserName[] {
  const raw = process.env.VIOLET_BROWSERS ?? "chromium";
  const parsed = raw
    .split(",")
    .map(name => name.trim().toLowerCase())
    .filter((name): name is BrowserName => ALLOWED_BROWSERS.has(name as BrowserName));
  return parsed.length > 0 ? parsed : ["chromium"];
}

const browsers = selectedBrowsers();

export default defineConfig({
  test: {
    // Playwright Firefox and WebKit tabs in one browser instance share OS focus/pointer state, so
    // concurrent userEvent.click / keyboard / dragAndDrop across parallel spec files can collide;
    // serialize non-Chromium browser runs.
    fileParallelism: browsers.every(name => name === "chromium"),
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.stories.ts", "src/**/*.spec.ts", "src/**/index.ts"],
      thresholds: {
        statements: 80,
        branches: 72,
        functions: 85,
        lines: 80,
      },
    },
    include: ["src/**/*.spec.ts"],
    browser: {
      enabled: true,
      // Never open a window on a developer desktop; the run reports results either way.
      headless: true,
      provider: playwright(),
      instances: browsers.map(browser => ({ browser })),
    },
  },
});
