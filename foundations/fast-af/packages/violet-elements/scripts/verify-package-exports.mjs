#!/usr/bin/env node
/**
 * Verifies the packed @lushly-dev/violet-elements tarball the way a consumer sees it.
 *
 * Packs the package, extracts it into a throwaway consumer's node_modules and checks that:
 *  - the contents are intended (built dist and metadata only; no src, specs or stories, because
 *    the shipped source maps embed their sources instead of pointing at an unpacked ../../src);
 *  - every tag in `custom-elements.json` has a class entry (`./button`) and a define entry
 *    (`./button/define`), and the `exports` map has no other element entries; each resolves at
 *    runtime to a packed file and to its `.d.ts` for TypeScript;
 *  - the other entries (`.`, `icon-registry`, `icons/*`, `theme`, `theme-css`, `theme-runtime`,
 *    `theme-builtin`, `custom-elements.json`, `tokens/*`, `package.json`) resolve;
 *  - non-published paths (`dist/*`, `src/*`, `scripts/*`) stay blocked;
 *  - `sideEffects` lists only the define modules, `all.js` and the root `index.js`;
 *  - every shipped source map carries `sourcesContent`;
 *  - `dist/pack/` is the component pack in Specimen's exported form: valid, stamped with this
 *    package's name and version, holding exactly the committed records and rules (#1157), and
 *    reachable as `./pack/*`.
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
import { checkPack, packCatalog, readPackFiles } from "@lushly-dev/specimen/pack";

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
    "dist/button/violet-button.define.js",
    "dist/button/violet-button.define.d.ts",
    "dist/all.js",
    "tokens/interface.json",
    "dist/pack/data/violet-elements/library.json",
    "dist/pack/rules/violet-elements.json",
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
  // tar runs in `scratch` with relative paths: under Git Bash on Windows, tar is GNU tar, which reads
  // an absolute `C:\...` archive as host:path (a remote archive), where bsdtar reads a drive (#1388).
  const destination = path.relative(scratch, installed).split(path.sep).join("/");
  run("tar", ["-xzf", packed.filename, "-C", destination, "--strip-components=1"], scratch);
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

  const pkg = JSON.parse(readFileSync(path.join(installed, "package.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(path.join(installed, "custom-elements.json"), "utf8"));
  const elements = manifest.modules.flatMap((module) =>
    (module.declarations ?? [])
      .filter((declaration) => declaration.customElement && declaration.tagName)
      .map((declaration) => ({
        subpath: declaration.tagName.replace(/^violet-/, ""),
        module: module.path.replace(/^src\//, "dist/").replace(/\.ts$/, ""),
      })),
  );
  // `./theme` is the theme barrel, which exports `VioletTheme` with the theme functions.
  const classModule = (element) => (element.subpath === "theme" ? "dist/theme/index" : element.module);
  check(elements.length > 0, "custom-elements.json declares no elements");

  // Every element's class and define entries, and no others.
  const nonElementKeys = [
    ".",
    "./icon-registry",
    "./icons/*",
    "./theme-css",
    "./theme-runtime",
    "./theme-builtin",
    "./custom-elements.json",
    "./tokens/*",
    "./pack/*",
    "./package.json",
  ];
  const expectedKeys = new Set([
    ...nonElementKeys,
    ...elements.flatMap((element) => [`./${element.subpath}`, `./${element.subpath}/define`]),
  ]);
  const actualKeys = Object.keys(pkg.exports);
  const missingKeys = [...expectedKeys].filter((key) => !actualKeys.includes(key));
  const extraKeys = actualKeys.filter((key) => !expectedKeys.has(key));
  check(missingKeys.length === 0, `exports is missing ${missingKeys.join(", ")}`);
  check(extraKeys.length === 0, `exports has entries no element or shared module needs: ${extraKeys.join(", ")}`);

  const mustResolve = {
    [packageName]: "dist/index.js",
    [`${packageName}/icon-registry`]: "dist/icon/icon-registry.js",
    [`${packageName}/icons/system-close`]: "dist/icon/generated/icons/system-close.js",
    [`${packageName}/custom-elements.json`]: "custom-elements.json",
    [`${packageName}/package.json`]: "package.json",
    [`${packageName}/tokens/violet-theme.export.json`]: "tokens/violet-theme.export.json",
    [`${packageName}/tokens/interface.json`]: "tokens/interface.json",
    [`${packageName}/theme-css`]: "dist/theme/violet-theme-css.js",
    [`${packageName}/theme-runtime`]: "dist/theme/violet-theme-runtime.js",
    [`${packageName}/theme-builtin`]: "dist/theme/violet-theme-builtin.js",
    [`${packageName}/pack/data/violet-elements/library.json`]: "dist/pack/data/violet-elements/library.json",
  };
  for (const element of elements) {
    mustResolve[`${packageName}/${element.subpath}`] = `${classModule(element)}.js`;
    mustResolve[`${packageName}/${element.subpath}/define`] = `${element.module}.define.js`;
  }
  for (const [specifier, expected] of Object.entries(mustResolve)) {
    const actual = resolveRuntime(specifier);
    check(actual === expected, `${specifier} should resolve to ${expected}, got ${actual}`);
    check(actual === null || files.includes(actual), `${specifier} resolves to ${actual}, which is not packed`);
  }
  for (const blocked of [
    "dist/index.js",
    "dist/button/violet-button.js",
    "src/index.ts",
    "scripts/verify-package-exports.mjs",
  ]) {
    check(resolveRuntime(`${packageName}/${blocked}`) === null, `${packageName}/${blocked} must not be exported`);
  }

  // TypeScript 7 exports no compiler API; its TypeScript 6 API package resolves the same way.
  const { default: ts } = await import("@typescript/typescript6");
  const options = { moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext };
  const typesFor = {
    "theme-css": "dist/theme/violet-theme-css.d.ts",
    "theme-runtime": "dist/theme/violet-theme-runtime.d.ts",
    "theme-builtin": "dist/theme/violet-theme-builtin.d.ts",
    "icon-registry": "dist/icon/icon-registry.d.ts",
    "icons/system-close": "dist/icon/generated/icons/system-close.d.ts",
  };
  for (const element of elements) {
    typesFor[element.subpath] = `${classModule(element)}.d.ts`;
    typesFor[`${element.subpath}/define`] = `${element.module}.define.d.ts`;
  }
  for (const [entry, expected] of Object.entries(typesFor)) {
    const { resolvedModule } = ts.resolveModuleName(`${packageName}/${entry}`, path.join(consumer, "index.ts"), options, ts.sys);
    const resolved =
      resolvedModule && path.relative(installed, resolvedModule.resolvedFileName).split(path.sep).join("/");
    check(resolved === expected, `TypeScript should resolve ${entry} to ${expected}, got ${resolved}`);
  }

  // A product's build checks its theme set in plain Node: theme-css and the interface must import
  // there, with no bundler, no DOM and no element registered.
  const nodeCheck = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      [
        `import { findVioletThemeSetGaps, createVioletThemeCss } from "${packageName}/theme-css";`,
        `import tokenInterface from "${packageName}/tokens/interface.json" with { type: "json" };`,
        "const light = Object.keys(tokenInterface.tokens).map(id => ({ id, value: \"0\" }));",
        "const full = findVioletThemeSetGaps({ defaultPreset: \"light\", presets: { light, sepia: [] } }, tokenInterface);",
        "const short = findVioletThemeSetGaps({ defaultPreset: \"light\", presets: { light: light.slice(1) } }, tokenInterface);",
        "const css = createVioletThemeCss({ defaultPreset: \"light\", presets: { light } });",
        "console.log(JSON.stringify({ full: full.complete, short: short.missing.length, css: css.startsWith(\":root,\"), registry: typeof customElements }));",
      ].join("\n"),
    ],
    { cwd: consumer, encoding: "utf8" },
  );
  check(nodeCheck.status === 0, `theme-css must import in plain Node: ${nodeCheck.stderr}`);
  if (nodeCheck.status === 0) {
    const result = JSON.parse(nodeCheck.stdout.trim());
    check(
      result.full === true && result.short === 1 && result.css === true && result.registry === "undefined",
      `theme-css in plain Node gave ${nodeCheck.stdout.trim()}`,
    );
  }

  // Only the define modules, `all.js` and the root register elements; class modules are pure.
  check(
    JSON.stringify(pkg.sideEffects) === JSON.stringify(["./dist/**/*.define.js", "./dist/all.js", "./dist/index.js"]),
    `sideEffects must list only the define modules, all.js and index.js, got ${JSON.stringify(pkg.sideEffects)}`,
  );

  // The component pack, as a deployment copies it: valid in the exported form, stamped with this
  // package, and the committed records and rules byte for byte, with nothing else beside them.
  const packRoot = path.join(installed, "dist", "pack");
  const shipped = existsSync(packRoot) ? await readPackFiles(packRoot) : new Map();
  const packProblems = checkPack(shipped, { form: "exported" }).problems;
  check(
    packProblems.length === 0,
    `dist/pack is not a valid exported pack: ${packProblems.map((problem) => `${problem.code} at ${problem.path}`).join("; ")}`,
  );
  const catalogBytes = shipped.get("data/violet-elements/library.json");
  const stamp = catalogBytes && JSON.parse(new TextDecoder().decode(catalogBytes)).package;
  check(
    stamp?.name === pkg.name && stamp?.version === pkg.version,
    `dist/pack's catalog is stamped ${JSON.stringify(stamp)}, not ${pkg.name}@${pkg.version}`,
  );
  // The files a library owns in a pack, as Specimen's committedFiles (src/pack-files.ts) and
  // export-pack.mjs filter them.
  const ownPackFile = (file) =>
    file === "rules/violet-elements.json" || file.startsWith("data/violet-elements/components/") || file.startsWith("data/violet-elements/patterns/");
  const committedPack = new Map([...(await readPackFiles(path.join(packageRoot, "pack")))].filter(([file]) => ownPackFile(file)));
  const expectedPack = [...committedPack.keys(), "data/violet-elements/library.json"].sort();
  check(
    JSON.stringify([...shipped.keys()].sort()) === JSON.stringify(expectedPack),
    "dist/pack's files are not the committed records, the rules and library.json; run the build again",
  );
  const { pack: packSettings } = JSON.parse(readFileSync(path.join(packageRoot, "specimen.config.json"), "utf8"));
  const expectedCatalog = packCatalog(committedPack, "violet-elements", {
    title: packSettings.title,
    package: { name: pkg.name, version: pkg.version },
    prefix: packSettings.prefix,
  });
  check(
    catalogBytes !== undefined && new TextDecoder().decode(catalogBytes) === expectedCatalog,
    "dist/pack's library.json is not the catalog of the committed records with this package's stamp; run the build again",
  );
  const changed = [...committedPack].filter(([file, bytes]) => !(shipped.has(file) && Buffer.compare(shipped.get(file), bytes) === 0)).map(([file]) => file);
  check(changed.length === 0, `dist/pack differs from the committed pack in ${changed.join(", ")}; run the build again`);

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
