import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import type { BrowserCommand } from "vitest/node";

type BrowserName = "chromium" | "firefox" | "webkit";

const ALLOWED_BROWSERS = new Set<BrowserName>(["chromium", "firefox", "webkit"]);

function selectedBrowsers(): BrowserName[] {
  const raw = process.env.VIOLET_BROWSERS ?? "chromium";
  const parsed = raw
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter((name): name is BrowserName => ALLOWED_BROWSERS.has(name as BrowserName));
  return parsed.length > 0 ? parsed : ["chromium"];
}

type TabCommand = BrowserCommand<[options?: { shift?: boolean }]>;
type KeyboardCommand = BrowserCommand<[text: string, state: { unreleased?: string[] }]>;

const ALT_KEYS = new Set(["Alt", "AltLeft", "AltRight"]);

function rewriteTabForMacOsWebKit(text: string, unreleased?: string[]): string {
  let altHeld = Boolean(unreleased?.some((key) => ALT_KEYS.has(key)));
  return text.replace(/\{(\/?)(Alt(?:Left|Right)?|Tab)(>?)\}/gu, (token, slash, key, hold) => {
    if (key !== "Tab") {
      if (slash === "/") {
        altHeld = false;
      } else if (hold === ">") {
        altHeld = true;
      }
      return token;
    }
    return altHeld ? token : "{Alt>}{Tab}{/Alt}";
  });
}

/**
 * On macOS without Full Keyboard Access, WebKit skips buttons, checkboxes, radios and links on
 * plain Tab, whereas Linux WebKit (CI), Chromium and Firefox visit all focusable controls.
 * Option+Tab (Alt+Tab) is WebKit's built-in macOS shortcut that visits every control. Wrap the
 * Playwright provider for darwin WebKit only so `userEvent.tab()` and `userEvent.keyboard("{Tab}")`
 * exercise the full tab order locally on macOS as well (#2712).
 */
function violetPlaywrightProvider() {
  const base = playwright();
  if (process.platform !== "darwin") {
    return base;
  }

  return {
    ...base,
    providerFactory(project: Parameters<typeof base.providerFactory>[0]) {
      const provider = base.providerFactory(project);
      if (project.config.browser.name !== "webkit") {
        return provider;
      }

      const browser = project.browser as unknown as {
        commands?: {
          __vitest_tab?: TabCommand;
          __vitest_keyboard?: KeyboardCommand;
        };
        registerCommand<Args extends unknown[]>(name: string, command: BrowserCommand<Args>): void;
      };
      const originalKeyboard = browser.commands?.__vitest_keyboard;
      if (!originalKeyboard) {
        throw new Error(
          "Expected @vitest/browser-playwright to register __vitest_keyboard before applying the macOS WebKit Alt+Tab wrapper.",
        );
      }

      const tabCommand: TabCommand = async (context, options) => {
        await context.page.keyboard.press(options?.shift === true ? "Alt+Shift+Tab" : "Alt+Tab");
      };
      const keyboardCommand: KeyboardCommand = async (context, text, state) => {
        const rewritten = rewriteTabForMacOsWebKit(text, state?.unreleased);
        return originalKeyboard(context, rewritten, state);
      };

      browser.registerCommand("__vitest_tab", tabCommand);
      browser.registerCommand("__vitest_keyboard", keyboardCommand);

      return provider;
    },
  };
}

const browsers = selectedBrowsers();

export default defineConfig({
  test: {
    // Playwright Firefox and WebKit tabs in one browser instance share OS focus/pointer state, so
    // concurrent userEvent.click / keyboard / dragAndDrop across parallel spec files can collide;
    // serialize non-Chromium browser runs.
    fileParallelism: browsers.every((name) => name === "chromium"),
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
      provider: violetPlaywrightProvider(),
      instances: browsers.map((browser) => ({ browser })),
    },
  },
});
