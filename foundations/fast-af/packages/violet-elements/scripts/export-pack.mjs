#!/usr/bin/env node
/**
 * Writes the component pack in Specimen's exported form to `dist/pack/`, so the npm package
 * carries it (#1157): `data/violet-elements/` (the committed records plus `library.json`, the
 * catalog stamped with this package's name and version) and `rules/violet-elements.json`. A
 * deployment copies `dist/pack/data` and `dist/pack/rules` beside its own `pack.toml`, as
 * `specimen pack-export` would write them, without a checkout or a browser.
 *
 * It does what `pack-export` does with the committed records but not its staleness check, which
 * needs story discovery and Specimen's native host: `pnpm test:stories` runs `pack-check`, which
 * fails on records that no longer match the stories, the manifest or the guides.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { checkPack, packCatalog, readPackFiles } from "@lushly-dev/specimen/pack";

const root = resolve(import.meta.dirname, "..");
const config = JSON.parse(await readFile(join(root, "specimen.config.json"), "utf8"));
const pack = config.pack;
if (config.patternBindings) {
  // `pack-export` filters pattern bindings by approval before stamping them; this script does not.
  throw new Error("specimen.config.json has patternBindings: export with `specimen pack-export` instead.");
}
const identity = JSON.parse(await readFile(join(root, pack.package), "utf8"));
if (typeof identity.name !== "string" || typeof identity.version !== "string") {
  throw new Error(`${pack.package} has no package name and version to stamp.`);
}
const library = pack.library;
// The files a library owns in a pack, as Specimen's committedFiles (src/pack-files.ts) filters them.
const own = (path) =>
  path === `rules/${library}.json` ||
  path.startsWith(`data/${library}/components/`) ||
  path.startsWith(`data/${library}/patterns/`);

const committed = new Map([...(await readPackFiles(join(root, pack.directory)))].filter(([path]) => own(path)));
const problems = (files, form) =>
  checkPack(files, { form }).problems.map((problem) => `${problem.code} at ${problem.path}${problem.at ?? ""}`);
if (!committed.size) throw new Error(`No committed records for ${library} in ${pack.directory}.`);
const committedProblems = problems(committed, "committed");
if (committedProblems.length) throw new Error(`The committed records are not a valid pack: ${committedProblems.join("; ")}.`);

const catalog = packCatalog(committed, library, {
  title: pack.title,
  package: { name: identity.name, version: identity.version },
  prefix: pack.prefix,
});
const exported = new Map([...committed, [`data/${library}/library.json`, new TextEncoder().encode(catalog)]]);
const exportedProblems = problems(exported, "exported");
if (exportedProblems.length) throw new Error(`The exported pack is not valid: ${exportedProblems.join("; ")}.`);

const target = join(root, "dist", "pack");
await rm(target, { recursive: true, force: true });
for (const [path, bytes] of exported) {
  await mkdir(dirname(join(target, path)), { recursive: true });
  await writeFile(join(target, path), bytes);
}
console.log(`export-pack: ${exported.size} files for ${identity.name}@${identity.version} in dist/pack`);
