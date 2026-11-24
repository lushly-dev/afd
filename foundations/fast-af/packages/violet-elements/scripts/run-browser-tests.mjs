import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const vitestEntry = join(dirname(require.resolve("vitest/package.json")), "vitest.mjs");
const target = process.argv[2] ?? "chromium";
const extraArgs = process.argv.slice(3);

const VALID = new Set(["chromium", "firefox", "webkit", "all"]);
if (!VALID.has(target)) {
    console.error("Usage: node scripts/run-browser-tests.mjs [chromium|firefox|webkit|all] [vitest args...]");
    process.exit(1);
}

function runBrowser(browser, args = []) {
    const result = spawnSync(process.execPath, [vitestEntry, "--run", ...args], {
        cwd: pkgRoot,
        stdio: "inherit",
        env: {
            ...process.env,
            VIOLET_BROWSERS: browser,
        },
    });
    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

if (target === "all") {
    // v8 coverage is supported on Chromium only; Firefox and WebKit run full functional verification.
    runBrowser("chromium", ["--coverage", ...extraArgs]);
    runBrowser("firefox", extraArgs);
    runBrowser("webkit", extraArgs);
} else {
    runBrowser(target, extraArgs);
}
