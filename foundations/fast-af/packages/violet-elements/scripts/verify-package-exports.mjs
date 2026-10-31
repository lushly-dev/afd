#!/usr/bin/env node
/**
 * Verifies the packed @lushly-dev/violet-elements tarball the way a consumer sees it.
 *
 * Packs the package, extracts it into a throwaway consumer's node_modules and checks that:
 *  - the contents are intended (built dist and metadata only; no src, specs or stories, because
 *    the shipped source maps embed their sources instead of pointing at an unpacked ../../src);
 *  - per-element imports such as `@lushly-dev/violet-elements/dist/button/violet-button.js`
 *    resolve at runtime through the `exports` map and resolve to their `.d.ts` for TypeScript;
 *  - the existing entries (`.`, `custom-elements.json`, `tokens/*`, `package.json`) still resolve;
 *  - non-published paths (`src/*`, `scripts/*`) stay blocked;
 *  - every shipped source map carries `sourcesContent`.
 *
 * Run `pnpm --dir packages/violet-elements build` first.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageName = "@lushly-dev/violet-elements";
const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

function run(executable, args, cwd) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32" && executable.endsWith(".cmd"),
  });
  if (result.error || result.status !== 0) {
    throw new Error(`\`${executable} ${args.join(" ")}\` failed: ${result.error?.message ?? result.stderr}`);
  }
  return result.stdout;
}

if (!existsSync(path.join(packageRoot, "dist", "index.js"))) {
  console.error("dist/ is missing. Run `pnpm --dir packages/violet-elements build` first.");
  process.exit(1);
}

const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), "violet-exports-")));
try {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const packed = JSON.parse(run(npm, ["pack", "--json", "--pack-destination", scratch], packageRoot))[0];
  const files = packed.files.map((file) => file.path);

  for (const required of [
    "package.json",
    "custom-elements.json",
    "dist/index.js",
    "dist/button/violet-button.js",
    "dist/button/violet-button.d.ts",
  ]) {
    check(files.includes(required), `tarball is missing ${required}`);
  }
  check(
    files.some((file) => file.startsWith("tokens/")),
    "tarball is missing tokens/",
  );
  const allowedTopLevel = ["package.json", "custom-elements.json", "README.md", "LICENSE"];
  const unexpected = files.filter(
    (file) =>
      !(file.startsWith("dist/") || file.startsWith("tokens/") || allowedTopLevel.includes(file)) ||
      /\.(spec|stories)\./.test(file),
  );
  check(unexpected.length === 0, `tarball contains unintended files: ${unexpected.join(", ")}`);

  const consumer = path.join(scratch, "consumer");
  const installed = path.join(consumer, "node_modules", ...packageName.split("/"));
  mkdirSync(installed, { recursive: true });
  run("tar", ["-xzf", path.join(scratch, packed.filename), "-C", installed, "--strip-components=1"], scratch);
  writeFileSync(path.join(consumer, "package.json"), JSON.stringify({ name: "consumer", type: "module" }));
  writeFileSync(path.join(consumer, "index.ts"), "");

  const require = createRequire(path.join(consumer, "package.json"));
  const resolveRuntime = (specifier) => {
    try {
      return path.relative(installed, require.resolve(specifier)).split(path.sep).join("/");
    } catch {
      return null;
    }
  };

  const mustResolve = {
    [packageName]: "dist/index.js",
    [`${packageName}/dist/button/violet-button.js`]: "dist/button/violet-button.js",
    [`${packageName}/dist/segment/violet-segment.js`]: "dist/segment/violet-segment.js",
    [`${packageName}/dist/data-grid/violet-data-grid.js`]: "dist/data-grid/violet-data-grid.js",
    [`${packageName}/custom-elements.json`]: "custom-elements.json",
    [`${packageName}/package.json`]: "package.json",
    [`${packageName}/tokens/theme-presets.jsonc`]: "tokens/theme-presets.jsonc",
  };
  for (const [specifier, expected] of Object.entries(mustResolve)) {
    const actual = resolveRuntime(specifier);
    check(actual === expected, `${specifier} should resolve to ${expected}, got ${actual}`);
  }
  for (const blocked of ["src/index.ts", "scripts/verify-package-exports.mjs"]) {
    check(resolveRuntime(`${packageName}/${blocked}`) === null, `${packageName}/${blocked} must not be exported`);
  }

  const { default: ts } = await import("typescript");
  const options = { moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext };
  for (const element of ["button/violet-button", "segment/violet-segment", "data-grid/violet-data-grid"]) {
    const { resolvedModule } = ts.resolveModuleName(
      `${packageName}/dist/${element}.js`,
      path.join(consumer, "index.ts"),
      options,
      ts.sys,
    );
    const resolved =
      resolvedModule && path.relative(installed, resolvedModule.resolvedFileName).split(path.sep).join("/");
    check(resolved === `dist/${element}.d.ts`, `TypeScript should resolve ${element}.js to its .d.ts, got ${resolved}`);
  }

  const pkg = JSON.parse(readFileSync(path.join(installed, "package.json"), "utf8"));
  check(pkg.sideEffects === true, "sideEffects must stay true: every element file registers itself on import");

  let maps = 0;
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".map")) {
        maps += 1;
        const map = JSON.parse(readFileSync(full, "utf8"));
        const complete =
          Array.isArray(map.sourcesContent) &&
          map.sourcesContent.length === map.sources.length &&
          map.sourcesContent.every((text) => typeof text === "string");
        check(complete, `${path.relative(installed, full)} has no sourcesContent`);
      }
    }
  };
  walk(path.join(installed, "dist"));
  console.log(`Checked ${files.length} packed files, ${maps} source maps.`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`Package export verification failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("Package exports verified.");
