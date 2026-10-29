import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const manifestPath = resolve(process.cwd(), "custom-elements.json");

function sortByName(items = []) {
  return [...items].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
}

function normalizeClassDeclaration(declaration, tagName) {
  return {
    ...declaration,
    ...(declaration.customElement && tagName ? { tagName } : {}),
    cssParts: sortByName(declaration.cssParts),
    slots: sortByName(declaration.slots),
    members: sortByName(declaration.members),
  };
}

async function normalizeModule(moduleEntry) {
  let tagName;

  try {
    const source = await readFile(resolve(process.cwd(), moduleEntry.path), "utf8");
    tagName = source.match(/name:\s*["']([^"']+)["']/)?.[1];
  } catch {
    // Generated or declaration-only modules do not necessarily have source files.
  }

  const declarations = (moduleEntry.declarations ?? []).map((declaration) => {
    if (declaration.kind === "class") {
      return normalizeClassDeclaration(declaration, tagName);
    }

    return declaration;
  });

  return {
    ...moduleEntry,
    declarations: sortByName(declarations),
    exports: sortByName(moduleEntry.exports),
  };
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

const normalized = {
  ...manifest,
  modules: (await Promise.all([...(manifest.modules ?? [])].map(normalizeModule)))
    .sort((a, b) => (a.path ?? "").localeCompare(b.path ?? "")),
};

await writeFile(manifestPath, `${JSON.stringify(normalized, null, 2)}\n`);
