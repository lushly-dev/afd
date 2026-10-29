#!/usr/bin/env node
/**
 * Measures line / branch / function coverage of `src/command/**` using the
 * existing Playwright setup (Chromium only) and Chromium's built-in V8
 * coverage. No extra dependencies.
 *
 *   pnpm --dir packages/element/packages/fast-element test:coverage:command
 *
 * How it works: `src/command/coverage-fixture.spec.ts` records V8 coverage for the
 * Vite-served (esbuild-transformed) modules when COMMAND_COVERAGE_DIR is set.
 * This script runs the command spec, then maps V8 ranges back to the original
 * TypeScript through each module's inline source map.
 *
 *  - lines:     original lines that produced emitted code; covered if any
 *               emitted code on the line ran.
 *  - functions: V8 function entries (count > 0).
 *  - branches:  V8 block ranges nested inside functions. V8 only reports
 *               blocks whose count differs from their parent, so this is a
 *               conservative approximation of branch coverage.
 *
 * Raw output is written under the OS temp dir (never committed). Pass
 * `--json` for machine-readable output and `--details` to list uncovered lines.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "command-coverage-"));
const args = process.argv.slice(2);

const run = spawnSync(
    "npx",
    [
        "playwright",
        "test",
        "src/command/command.pw.spec.ts",
        "--project=chromium",
        "--workers=1",
        "--retries=0",
        "--reporter=dot",
    ],
    { cwd: root, stdio: "inherit", env: { ...process.env, COMMAND_COVERAGE_DIR: dir } },
);
if (run.status !== 0) {
    console.error("Playwright run failed; coverage is not meaningful.");
    process.exit(run.status ?? 1);
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Decodes a source map into per-generated-line segments [genCol, srcIdx, srcLine]. */
function decodeMappings(mappings) {
    const lines = [];
    let srcIdx = 0;
    let srcLine = 0;
    for (const lineStr of mappings.split(";")) {
        const segs = [];
        let genCol = 0;
        for (const segStr of lineStr.split(",")) {
            if (!segStr) continue;
            const f = [];
            let shift = 0;
            let val = 0;
            for (const ch of segStr) {
                const d = B64.indexOf(ch);
                val += (d & 31) << shift;
                if (d & 32) {
                    shift += 5;
                } else {
                    f.push(val & 1 ? -(val >> 1) : val >> 1);
                    val = 0;
                    shift = 0;
                }
            }
            genCol += f[0];
            if (f.length > 1) {
                srcIdx += f[1];
                srcLine += f[2];
                segs.push([genCol, srcIdx, srcLine]);
            }
        }
        lines.push(segs);
    }
    return lines;
}

const files = new Map();
const fileFor = path => {
    if (!files.has(path)) {
        files.set(path, { lines: new Map(), functions: new Map(), branches: new Map() });
    }
    return files.get(path);
};

for (const name of readdirSync(dir)) {
    for (const entry of JSON.parse(readFileSync(join(dir, name), "utf8"))) {
        const source = entry.source ?? "";
        const m =
            /\/\/# sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)/.exec(
                source,
            );
        if (!m) continue;
        const map = JSON.parse(Buffer.from(m[1], "base64").toString("utf8"));
        const segLines = decodeMappings(map.mappings);
        const srcPath = decodeURIComponent(new URL(entry.url).pathname).replace(
            /^\/@fs/,
            "",
        );
        if (
            !srcPath.includes("/src/command/") ||
            /\.pw\.spec\.|coverage-fixture/.test(srcPath)
        ) {
            continue;
        }
        const file = fileFor(srcPath);

        // Original line (or -1) for every emitted non-whitespace character.
        const n = source.length;
        const origLine = new Int32Array(n).fill(-1);
        let genLine = 0;
        let lineStart = 0;
        for (let i = 0; i <= n; i++) {
            if (i === n || source[i] === "\n") {
                const segs = segLines[genLine] ?? [];
                let si = 0;
                for (let c = lineStart; c < i; c++) {
                    const col = c - lineStart;
                    while (si + 1 < segs.length && segs[si + 1][0] <= col) si++;
                    if (segs.length && segs[si][0] <= col && !/\s/.test(source[c])) {
                        origLine[c] = segs[si][2] + 1;
                    }
                }
                genLine++;
                lineStart = i + 1;
            }
        }
        const counts = new Int32Array(n);
        for (const fn of entry.functions) {
            for (const r of fn.ranges) {
                counts.fill(r.count, r.startOffset, Math.min(r.endOffset, n));
            }
        }
        for (let i = 0; i < n; i++) {
            const ln = origLine[i];
            if (ln < 0) continue;
            file.lines.set(ln, (file.lines.get(ln) ?? false) || counts[i] > 0);
        }
        const keyOf = off => {
            let o = off;
            while (o < n && origLine[o] < 0) o++;
            return origLine[o] ?? off;
        };
        for (const fn of entry.functions) {
            if (
                !fn.functionName &&
                fn.ranges.length === 1 &&
                fn.ranges[0].startOffset === 0
            ) {
                continue; // module wrapper
            }
            const fk = `${keyOf(fn.ranges[0].startOffset)}:${fn.functionName}`;
            file.functions.set(
                fk,
                (file.functions.get(fk) ?? false) || fn.ranges[0].count > 0,
            );
            for (const r of fn.ranges.slice(1)) {
                const bk = `${keyOf(r.startOffset)}-${keyOf(r.endOffset - 1)}`;
                file.branches.set(bk, (file.branches.get(bk) ?? false) || r.count > 0);
            }
        }
    }
}

const pct = (hit, total) => (total === 0 ? 100 : (hit / total) * 100);
const tally = map => [[...map.values()].filter(Boolean).length, map.size];
const rows = [];
const totals = { l: [0, 0], f: [0, 0], b: [0, 0] };
for (const [path, f] of [...files].sort()) {
    const l = tally(f.lines);
    const fn = tally(f.functions);
    const b = tally(f.branches);
    rows.push({ file: relative(join(root, "src"), path), l, fn, b, f });
    for (const [k, v] of [
        ["l", l],
        ["f", fn],
        ["b", b],
    ]) {
        totals[k][0] += v[0];
        totals[k][1] += v[1];
    }
}

if (args.includes("--json")) {
    console.log(JSON.stringify({ totals, files: rows.map(({ f, ...r }) => r) }, null, 2));
} else {
    const fmt = ([h, t]) => `${pct(h, t).toFixed(1).padStart(6)}% (${h}/${t})`;
    const row = (a, b, c, d) =>
        `${a.padEnd(36)}${b.padStart(18)}${c.padStart(18)}${d.padStart(18)}`;
    console.log(`\n${row("file", "lines", "branches", "functions")}`);
    for (const r of rows) {
        console.log(row(r.file, fmt(r.l), fmt(r.b), fmt(r.fn)));
        if (args.includes("--details")) {
            const miss = [...r.f.lines]
                .filter(([, v]) => !v)
                .map(([k]) => k)
                .sort((a, b) => a - b);
            if (miss.length) console.log(`    uncovered lines: ${miss.join(",")}`);
        }
    }
    console.log(row("TOTAL", fmt(totals.l), fmt(totals.b), fmt(totals.f)));
}
