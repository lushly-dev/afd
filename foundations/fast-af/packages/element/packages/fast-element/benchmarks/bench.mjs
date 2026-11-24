#!/usr/bin/env node
/**
 * Repeatable Playwright Chromium benchmark harness for @lushly-dev/fast-element (#1384).
 *
 * Usage:
 *   node benchmarks/bench.mjs [--runs=15] [--warmup=3] [--scenarios=create-1k,...] [--json]
 *   node benchmarks/bench.mjs --ab <dirA> <dirB> [--label-a=baseline] [--label-b=candidate] [--runs=15] [--warmup=3]
 *
 * Each variant directory is expected to contain `index.js` (e.g. `dist/esm`).
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { chromium } from "@playwright/test";

const DEFAULT_SCENARIOS = [
    "create-1k",
    "create-10k",
    "append-1k",
    "replace-1k",
    "update-10th",
    "swap-rows",
    "select-row",
    "clear-1k",
    "scoped-create-1k",
];

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".json": "application/json; charset=utf-8",
};

function parseArgs(argv) {
    const opts = {
        runs: 15,
        warmup: 3,
        scenarios: DEFAULT_SCENARIOS,
        ab: null,
        labelA: "A",
        labelB: "B",
        json: false,
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith("--runs=")) {
            opts.runs = Number.parseInt(arg.slice(7), 10);
        } else if (arg.startsWith("--warmup=")) {
            opts.warmup = Number.parseInt(arg.slice(9), 10);
        } else if (arg.startsWith("--scenarios=")) {
            opts.scenarios = arg.slice(12).split(",").filter(Boolean);
        } else if (arg === "--ab") {
            const dirA = argv[++i];
            const dirB = argv[++i];
            if (!dirA || !dirB) {
                throw new Error("--ab requires two variant directory paths.");
            }
            opts.ab = [resolve(dirA), resolve(dirB)];
        } else if (arg.startsWith("--label-a=")) {
            opts.labelA = arg.slice(10);
        } else if (arg.startsWith("--label-b=")) {
            opts.labelB = arg.slice(10);
        } else if (arg === "--json") {
            opts.json = true;
        }
    }

    return opts;
}

function quantile(sorted, q) {
    if (sorted.length === 0) return 0;
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sorted[base + 1] !== undefined) {
        return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    }
    return sorted[base];
}

function summarize(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mean = sorted.reduce((acc, v) => acc + v, 0) / sorted.length;
    const median = quantile(sorted, 0.5);
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    const p95 = quantile(sorted, 0.95);
    return { median, mean, iqr: q3 - q1, p95, min: sorted[0], max: sorted[sorted.length - 1] };
}

/**
 * Two-sided paired Wilcoxon signed-rank test (exact for n <= 20, normal approx otherwise).
 */
function wilcoxonPValue(a, b) {
    const diffs = [];
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
        const d = b[i] - a[i];
        if (d !== 0) diffs.push(d);
    }
    const n = diffs.length;
    if (n === 0) return 1;

    const absRanked = diffs
        .map((d, idx) => ({ d, abs: Math.abs(d), idx }))
        .sort((x, y) => x.abs - y.abs);

    const ranks = new Array(n);
    for (let i = 0; i < n; ) {
        let j = i;
        while (j + 1 < n && absRanked[j + 1].abs === absRanked[i].abs) j++;
        const avgRank = (i + j + 2) / 2;
        for (let k = i; k <= j; k++) ranks[k] = avgRank;
        i = j + 1;
    }

    let wPlus = 0;
    let wMinus = 0;
    for (let i = 0; i < n; i++) {
        if (absRanked[i].d > 0) wPlus += ranks[i];
        else wMinus += ranks[i];
    }
    const w = Math.min(wPlus, wMinus);

    if (n <= 20) {
        // Exact distribution over 2^n sign assignments using the observed (possibly tied) ranks.
        // Scale by 2 so half-integer tied ranks become exact integers.
        const scaledRanks = ranks.map(r => Math.round(r * 2));
        const maxSum = scaledRanks.reduce((acc, r) => acc + r, 0);
        const dp = new Float64Array(maxSum + 1);
        dp[0] = 1;
        for (const r of scaledRanks) {
            for (let s = maxSum; s >= r; s--) {
                dp[s] += dp[s - r];
            }
        }
        const total = 2 ** n;
        let tail = 0;
        const limit = Math.round(w * 2);
        for (let s = 0; s <= limit; s++) tail += dp[s];
        return Math.min(1, (2 * tail) / total);
    }

    const mean = (n * (n + 1)) / 4;
    const sd = Math.sqrt(ranks.reduce((acc, r) => acc + r * r, 0) / 4);
    if (sd === 0) return 1;
    const z = Math.max(0, Math.abs(w - mean) - 0.5) / sd;
    // Two-sided normal p-value via Abramowitz & Stegun erfc approximation.
    const t = 1 / (1 + 0.3275911 * (z / Math.SQRT2));
    const poly =
        t *
        (0.254829592 +
            t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
    return Math.min(1, poly * Math.exp(-(z * z) / 2));
}

async function startStaticServer(variantDirs) {
    const benchDir = import.meta.dirname;
    const server = createServer(async (req, res) => {
        try {
            const url = new URL(req.url ?? "/", "http://127.0.0.1");
            if (url.pathname === "/" || url.pathname === "/bench.html") {
                const body = await readFile(join(benchDir, "bench.html"));
                res.writeHead(200, { "content-type": MIME[".html"] });
                res.end(body);
                return;
            }

            const match = /^\/variant\/([^/]+)\/(.+)$/.exec(url.pathname);
            if (match) {
                const [, name, relPath] = match;
                const root = variantDirs[name];
                if (!root) {
                    res.writeHead(404);
                    res.end("Unknown variant");
                    return;
                }
                const fullPath = resolve(root, relPath);
                if (fullPath !== root && !fullPath.startsWith(root + sep)) {
                    res.writeHead(403);
                    res.end("Forbidden");
                    return;
                }
                const body = await readFile(fullPath);
                res.writeHead(200, {
                    "content-type": MIME[extname(fullPath)] ?? "application/octet-stream",
                });
                res.end(body);
                return;
            }

            res.writeHead(404);
            res.end("Not found");
        } catch (err) {
            res.writeHead(500);
            res.end(String(err));
        }
    });

    await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
    const addr = server.address();
    return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
}

async function measureOnce(context, baseUrl, variant, scenario) {
    const page = await context.newPage();
    let rejectPageError;
    const pageErrorPromise = new Promise((_, reject) => {
        rejectPageError = reject;
    });
    const onPageError = err => rejectPageError(err);
    page.on("pageerror", onPageError);
    try {
        await Promise.race([
            (async () => {
                await page.goto(`${baseUrl}/bench.html?variant=${encodeURIComponent(variant)}`, {
                    waitUntil: "load",
                });
                await page.waitForFunction(() => Boolean(window.__bench));
            })(),
            pageErrorPromise,
        ]);
        return await Promise.race([
            page.evaluate(name => window.__bench.runScenario(name), scenario),
            pageErrorPromise,
        ]);
    } finally {
        page.off("pageerror", onPageError);
        await page.close();
    }
}

function fmt(n) {
    return `${n.toFixed(2)}ms`;
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    const pkgRoot = resolve(import.meta.dirname, "..");
    const defaultVariantDir = join(pkgRoot, "dist", "esm");

    const variantDirs = opts.ab
        ? { a: opts.ab[0], b: opts.ab[1] }
        : { current: defaultVariantDir };

    const { server, baseUrl } = await startStaticServer(variantDirs);
    const browser = await chromium.launch({ headless: true });

    try {
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

        if (!opts.ab) {
            const report = {
                mode: "baseline",
                runs: opts.runs,
                warmup: opts.warmup,
                browser: browser.version(),
                scenarios: {},
            };

            for (const scenario of opts.scenarios) {
                for (let w = 0; w < opts.warmup; w++) {
                    await measureOnce(context, baseUrl, "current", scenario);
                }
                const jsSamples = [];
                const paintSamples = [];
                let upgradedChips;
                let skipped = false;
                for (let r = 0; r < opts.runs; r++) {
                    const res = await measureOnce(context, baseUrl, "current", scenario);
                    if (res.skipped) {
                        skipped = true;
                        break;
                    }
                    if (scenario === "scoped-create-1k" && res.upgradedChips !== 1000) {
                        throw new Error(
                            `scoped-create-1k: local build expected 1000 upgraded scoped-chip elements, got ${res.upgradedChips}`,
                        );
                    }
                    if (res.upgradedChips !== undefined) {
                        upgradedChips = res.upgradedChips;
                    }
                    jsSamples.push(res.jsMs);
                    paintSamples.push(res.paintMs);
                }
                report.scenarios[scenario] = skipped
                    ? { skipped: true }
                    : {
                          js: summarize(jsSamples),
                          paint: summarize(paintSamples),
                          ...(upgradedChips !== undefined ? { upgradedChips } : {}),
                      };
            }

            if (opts.json) {
                console.log(JSON.stringify(report, null, 2));
            } else {
                console.log(
                    `fast-element baseline (Chromium ${report.browser}, ${opts.runs} runs, ${opts.warmup} warmup)`,
                );
                console.log(
                    "| Scenario | JS median | JS IQR | JS p95 | Paint median | Paint IQR | Paint p95 |",
                );
                console.log("|---|---:|---:|---:|---:|---:|---:|");
                for (const [name, data] of Object.entries(report.scenarios)) {
                    if (data.skipped) {
                        console.log(`| ${name} | skipped | - | - | - | - | - |`);
                        continue;
                    }
                    console.log(
                        `| ${name} | ${fmt(data.js.median)} | ${fmt(data.js.iqr)} | ${fmt(data.js.p95)} | ${fmt(data.paint.median)} | ${fmt(data.paint.iqr)} | ${fmt(data.paint.p95)} |`,
                    );
                }
            }
        } else {
            const report = {
                mode: "ab",
                labelA: opts.labelA,
                labelB: opts.labelB,
                runs: opts.runs,
                warmup: opts.warmup,
                browser: browser.version(),
                scenarios: {},
            };

            for (const scenario of opts.scenarios) {
                for (let w = 0; w < opts.warmup; w++) {
                    await measureOnce(context, baseUrl, "a", scenario);
                    await measureOnce(context, baseUrl, "b", scenario);
                }

                const aJs = [];
                const bJs = [];
                const aPaint = [];
                const bPaint = [];
                let upgradedChipsA;
                let upgradedChipsB;
                let skipped = false;

                // Interleaved balanced pairs (A,B then B,A) to cancel drift.
                for (let r = 0; r < opts.runs; r++) {
                    const order = r % 2 === 0 ? ["a", "b"] : ["b", "a"];
                    const pair = {};
                    for (const v of order) {
                        const res = await measureOnce(context, baseUrl, v, scenario);
                        if (res.skipped) {
                            skipped = true;
                            break;
                        }
                        pair[v] = res;
                    }
                    if (skipped) break;
                    aJs.push(pair.a.jsMs);
                    bJs.push(pair.b.jsMs);
                    aPaint.push(pair.a.paintMs);
                    bPaint.push(pair.b.paintMs);
                    if (pair.a.upgradedChips !== undefined) upgradedChipsA = pair.a.upgradedChips;
                    if (pair.b.upgradedChips !== undefined) upgradedChipsB = pair.b.upgradedChips;
                }

                if (skipped) {
                    report.scenarios[scenario] = { skipped: true };
                    continue;
                }

                const sAJs = summarize(aJs);
                const sBJs = summarize(bJs);
                const sAPaint = summarize(aPaint);
                const sBPaint = summarize(bPaint);
                report.scenarios[scenario] = {
                    js: {
                        a: sAJs,
                        b: sBJs,
                        deltaPct: ((sBJs.median - sAJs.median) / sAJs.median) * 100,
                        pValue: wilcoxonPValue(aJs, bJs),
                    },
                    paint: {
                        a: sAPaint,
                        b: sBPaint,
                        deltaPct: ((sBPaint.median - sAPaint.median) / sAPaint.median) * 100,
                        pValue: wilcoxonPValue(aPaint, bPaint),
                    },
                    ...(upgradedChipsA !== undefined || upgradedChipsB !== undefined
                        ? { upgradedChips: { a: upgradedChipsA, b: upgradedChipsB } }
                        : {}),
                };
            }

            if (opts.json) {
                console.log(JSON.stringify(report, null, 2));
            } else {
                console.log(
                    `fast-element A/B: ${opts.labelA} vs ${opts.labelB} (Chromium ${report.browser}, ${opts.runs} interleaved pairs, ${opts.warmup} warmup)`,
                );
                console.log(
                    `| Scenario | ${opts.labelA} JS | ${opts.labelB} JS | JS delta | JS p | ${opts.labelA} Paint | ${opts.labelB} Paint | Paint delta | Paint p |`,
                );
                console.log("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
                for (const [name, data] of Object.entries(report.scenarios)) {
                    if (data.skipped) {
                        console.log(`| ${name} | skipped | - | - | - | - | - | - | - |`);
                        continue;
                    }
                    const jsDelta = `${data.js.deltaPct >= 0 ? "+" : ""}${data.js.deltaPct.toFixed(1)}%`;
                    const paintDelta = `${data.paint.deltaPct >= 0 ? "+" : ""}${data.paint.deltaPct.toFixed(1)}%`;
                    console.log(
                        `| ${name} | ${fmt(data.js.a.median)} | ${fmt(data.js.b.median)} | ${jsDelta} | ${data.js.pValue.toFixed(4)} | ${fmt(data.paint.a.median)} | ${fmt(data.paint.b.median)} | ${paintDelta} | ${data.paint.pValue.toFixed(4)} |`,
                    );
                }
            }
        }
    } finally {
        await browser.close();
        server.close();
    }
}

await main();
