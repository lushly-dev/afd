import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test as base } from "@playwright/test";

/**
 * Playwright `test` that optionally records Chromium V8 coverage per test.
 *
 * Coverage is only collected when `COMMAND_COVERAGE_DIR` is set (see
 * `scripts/command-coverage.mjs`); otherwise this behaves exactly like the
 * stock `@playwright/test` `test`.
 */
export const test = base.extend({
    page: async ({ page, browserName }, use, testInfo) => {
        const dir = process.env.COMMAND_COVERAGE_DIR;
        const enabled = !!dir && browserName === "chromium";

        if (enabled) {
            await page.coverage.startJSCoverage({ resetOnNavigation: false });
        }

        await use(page);

        if (enabled) {
            const entries = await page.coverage.stopJSCoverage();
            const relevant = entries.filter(entry => entry.url.includes("/src/command/"));
            mkdirSync(dir!, { recursive: true });
            writeFileSync(
                join(
                    dir!,
                    `${testInfo.workerIndex}-${testInfo.testId}-${testInfo.retry}.json`,
                ),
                JSON.stringify(relevant),
            );
        }
    },
});

export { expect } from "@playwright/test";
