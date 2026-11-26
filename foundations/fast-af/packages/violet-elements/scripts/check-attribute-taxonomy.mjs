#!/usr/bin/env node
/**
 * Checks `attribute-taxonomy.jsonc` against `custom-elements.json` (#508). The taxonomy is kept by
 * hand and turned into the component pack's shared rules, so a drift between it and the components
 * gives an agent a rule for an attribute that is not there, or none for one that is.
 *
 * Each disagreement fails with a named cause:
 *  - `unknown-tag`: an entry's `usedBy` or `allowedValuesByComponent` names a tag no component has;
 *  - `missing-attribute`: an entry lists a component that has no attribute of that name;
 *  - `unlisted-component`: a component has an attribute the taxonomy defines, and no entry for that
 *    name lists it;
 *  - `undefined-attribute`: a component has an attribute the taxonomy does not define at all;
 *  - `listed-twice`: two entries of one name list the same component, so it has two meanings;
 *  - `repeated-tag`: one entry lists the same component twice;
 *  - `unused-entry`: an entry lists no component, so `usedBy` says nothing of where it applies (and
 *    a second entry of a name with no `usedBy` stops the pack's guide source);
 *  - `property-mismatch`: an entry's `property` is not the field the attribute reflects;
 *  - `value-type-mismatch`: `valueType` is `boolean` and the attribute is not, or the other way;
 *  - `allowed-values-mismatch`: an `enum` entry's values for a component (its
 *    `allowedValuesByComponent` row, else `allowedValues`) differ from the attribute's type when
 *    that type is a union of string literals;
 *  - `values-for-unlisted-component`: `allowedValuesByComponent` has a row for a component the
 *    entry's `usedBy` does not list.
 *
 * Usage: node scripts/check-attribute-taxonomy.mjs [--taxonomy <file>] [--manifest <file>]
 * Exit code 1 = disagreements found.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseJsonc } from "@lushly-dev/specimen-fast-af/guides";

const LITERAL_UNION = /^\s*"[^"]*"(?:\s*\|\s*"[^"]*")*\s*$/;

/** Each component's attributes by name, from a custom elements manifest. */
export function manifestAttributes(manifest) {
  const tags = new Map();
  for (const module of manifest?.modules ?? [])
    for (const declaration of module.declarations ?? [])
      if (declaration.tagName)
        tags.set(
          declaration.tagName,
          new Map((declaration.attributes ?? []).map((attribute) => [attribute.name, attribute])),
        );
  return tags;
}

/** Every disagreement between a taxonomy and a manifest, sorted; empty when they agree. */
export function taxonomyDisagreements(taxonomy, manifest) {
  const tags = manifestAttributes(manifest);
  const entries = Array.isArray(taxonomy?.attributes) ? taxonomy.attributes : [];
  const failures = [];
  const listed = new Map();
  for (const entry of entries) {
    const name = entry.name;
    const usedBy = entry.usedBy ?? [];
    if (usedBy.length === 0)
      failures.push(`unused-entry: a ${name} entry lists no component in usedBy`);
    for (const tag of new Set(usedBy))
      if (usedBy.filter((each) => each === tag).length > 1)
        failures.push(`repeated-tag: a ${name} entry lists ${tag} more than once`);
    for (const tag of Object.keys(entry.allowedValuesByComponent ?? {})) {
      if (!tags.has(tag))
        failures.push(`unknown-tag: ${name}.allowedValuesByComponent names ${tag}`);
      else if (!usedBy.includes(tag))
        failures.push(
          `values-for-unlisted-component: ${name}.allowedValuesByComponent has ${tag}, which ${name}.usedBy does not list`,
        );
    }
    for (const tag of new Set(usedBy)) {
      const owners = listed.get(`${name} ${tag}`) ?? 0;
      listed.set(`${name} ${tag}`, owners + 1);
      if (owners === 1)
        failures.push(`listed-twice: two ${name} entries list ${tag}, giving it two meanings`);
      const attributes = tags.get(tag);
      if (!attributes) {
        failures.push(`unknown-tag: ${name}.usedBy names ${tag}`);
        continue;
      }
      const attribute = attributes.get(name);
      if (!attribute) {
        failures.push(`missing-attribute: ${name}.usedBy lists ${tag}, which has no ${name}`);
        continue;
      }
      failures.push(...attributeFailures(entry, tag, attribute));
    }
  }
  const defined = new Set(entries.map((entry) => entry.name));
  for (const [tag, attributes] of tags)
    for (const name of attributes.keys()) {
      if (!defined.has(name))
        failures.push(
          `undefined-attribute: ${tag} has ${name}, which the taxonomy does not define`,
        );
      else if (!listed.has(`${name} ${tag}`))
        failures.push(
          `unlisted-component: ${tag} has ${name}, and no ${name} entry lists it in usedBy`,
        );
    }
  return [...new Set(failures)].sort();
}

function attributeFailures(entry, tag, attribute) {
  const failures = [];
  const { name } = entry;
  if (entry.property && attribute.fieldName && entry.property !== attribute.fieldName)
    failures.push(
      `property-mismatch: ${name} on ${tag} reflects ${attribute.fieldName}, not ${entry.property}`,
    );
  const type = attribute.type?.text ?? "";
  if ((entry.valueType === "boolean") !== (type === "boolean"))
    failures.push(
      `value-type-mismatch: ${name} on ${tag} is ${entry.valueType} in the taxonomy and ${type || "untyped"} in the manifest`,
    );
  if (entry.valueType === "enum" && LITERAL_UNION.test(type)) {
    const actual = [...type.matchAll(/"([^"]*)"/g)].map((match) => match[1]).sort();
    const allowed = [
      ...(entry.allowedValuesByComponent?.[tag] ?? entry.allowedValues ?? []),
    ].sort();
    if (JSON.stringify(actual) !== JSON.stringify(allowed))
      failures.push(
        `allowed-values-mismatch: ${name} on ${tag} takes ${actual.join(", ")}; the taxonomy allows ${allowed.join(", ") || "nothing"}`,
      );
  }
  return failures;
}

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  return at >= 0 && process.argv[at + 1] ? path.resolve(process.argv[at + 1]) : fallback;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const taxonomyFile = option("--taxonomy", path.join(packageRoot, "attribute-taxonomy.jsonc"));
  const manifestFile = option("--manifest", path.join(packageRoot, "custom-elements.json"));
  const failures = taxonomyDisagreements(
    parseJsonc(readFileSync(taxonomyFile, "utf8")),
    JSON.parse(readFileSync(manifestFile, "utf8")),
  );
  if (failures.length) {
    console.error(
      `attribute-taxonomy: ${failures.length} disagreement(s) between ${path.basename(taxonomyFile)} and ${path.basename(manifestFile)}:\n- ${failures.join("\n- ")}`,
    );
    process.exitCode = 1;
  } else console.log("attribute-taxonomy: the taxonomy and the manifest agree.");
}
