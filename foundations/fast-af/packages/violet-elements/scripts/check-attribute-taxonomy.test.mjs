import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parseJsonc } from "@lushly-dev/specimen-fast-af/guides";
import { taxonomyDisagreements } from "./check-attribute-taxonomy.mjs";

// Each disagreement the check names, planted in a taxonomy and manifest that otherwise agree.
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const manifest = (tags) => ({
  modules: [
    {
      declarations: Object.entries(tags).map(([tagName, attributes]) => ({
        tagName,
        attributes: Object.entries(attributes).map(([name, type]) => ({
          name,
          fieldName: name.replace(/-(\w)/g, (_, letter) => letter.toUpperCase()),
          type: { text: type },
        })),
      })),
    },
  ],
});
const components = () => ({
  "x-button": { disabled: "boolean", appearance: '"primary" | "quiet"' },
  "x-badge": { appearance: '"filled" | "outline"' },
});
const entries = () => [
  { name: "disabled", property: "disabled", valueType: "boolean", usedBy: ["x-button"] },
  {
    name: "appearance",
    property: "appearance",
    valueType: "enum",
    allowedValues: ["primary", "quiet"],
    allowedValuesByComponent: { "x-badge": ["filled", "outline"] },
    usedBy: ["x-button", "x-badge"],
  },
];
const check = (edit = () => {}, tags = components()) => {
  const taxonomy = { attributes: entries() };
  edit(taxonomy.attributes, tags);
  return taxonomyDisagreements(taxonomy, manifest(tags));
};

describe("the attribute taxonomy check", () => {
  it("passes a taxonomy that agrees with the manifest", () => {
    assert.deepEqual(check(), []);
  });

  it("passes this package's taxonomy and manifest", () => {
    const taxonomy = parseJsonc(
      readFileSync(path.join(packageRoot, "attribute-taxonomy.jsonc"), "utf8"),
    );
    const elements = JSON.parse(
      readFileSync(path.join(packageRoot, "custom-elements.json"), "utf8"),
    );
    assert.deepEqual(taxonomyDisagreements(taxonomy, elements), []);
  });

  it("fails a tag no component has", () => {
    assert.deepEqual(
      check((list) => list[0].usedBy.push("x-gone")),
      ["unknown-tag: disabled.usedBy names x-gone"],
    );
    assert.deepEqual(
      check((list) => {
        list[1].allowedValuesByComponent["x-gone"] = ["a"];
      }),
      ["unknown-tag: appearance.allowedValuesByComponent names x-gone"],
    );
  });

  it("fails a component listed for an attribute it does not have", () => {
    assert.deepEqual(
      check((list) => list[0].usedBy.push("x-badge")),
      ["missing-attribute: disabled.usedBy lists x-badge, which has no disabled"],
    );
  });

  it("fails a component with a defined attribute that no entry lists", () => {
    assert.deepEqual(
      check((_, tags) => {
        tags["x-badge"].disabled = "boolean";
      }),
      ["unlisted-component: x-badge has disabled, and no disabled entry lists it in usedBy"],
    );
  });

  it("fails an attribute the taxonomy does not define", () => {
    assert.deepEqual(
      check((_, tags) => {
        tags["x-button"]["open-on-focus"] = "boolean";
      }),
      ["undefined-attribute: x-button has open-on-focus, which the taxonomy does not define"],
    );
  });

  it("fails one component listed by two entries of one name, and passes a meaning per component", () => {
    const second = { name: "disabled", property: "disabled", valueType: "boolean" };
    assert.deepEqual(
      check((list) => list.push({ ...second, usedBy: ["x-button"] })),
      ["listed-twice: two disabled entries list x-button, giving it two meanings"],
    );
    assert.deepEqual(
      check((list, tags) => {
        tags["x-badge"].disabled = "boolean";
        list.push({ ...second, usedBy: ["x-badge"] });
      }),
      [],
    );
  });

  it("fails an entry that lists no component, or one component twice", () => {
    assert.deepEqual(
      check((list) => {
        list[0].usedBy = [];
      }),
      [
        "unlisted-component: x-button has disabled, and no disabled entry lists it in usedBy",
        "unused-entry: a disabled entry lists no component in usedBy",
      ],
    );
    assert.deepEqual(
      check((list) => list[0].usedBy.push("x-button")),
      ["repeated-tag: a disabled entry lists x-button more than once"],
    );
  });

  it("fails a property that is not the field the attribute reflects", () => {
    assert.deepEqual(
      check((list) => {
        list[0].property = "isDisabled";
      }),
      ["property-mismatch: disabled on x-button reflects disabled, not isDisabled"],
    );
  });

  it("fails a boolean on either side alone", () => {
    assert.deepEqual(
      check((list) => {
        list[0].valueType = "string";
      }),
      [
        "value-type-mismatch: disabled on x-button is string in the taxonomy and boolean in the manifest",
      ],
    );
    assert.deepEqual(
      check((_, tags) => {
        tags["x-button"].disabled = "string";
      }),
      [
        "value-type-mismatch: disabled on x-button is boolean in the taxonomy and string in the manifest",
      ],
    );
  });

  it("fails enum values that differ from a literal-union type, per component or overall", () => {
    assert.deepEqual(
      check((list) => {
        list[1].allowedValuesByComponent["x-badge"] = ["filled"];
      }),
      [
        "allowed-values-mismatch: appearance on x-badge takes filled, outline; the taxonomy allows filled",
      ],
    );
    assert.deepEqual(
      check((_, tags) => {
        tags["x-button"].appearance = '"primary" | "quiet" | "danger"';
      }),
      [
        "allowed-values-mismatch: appearance on x-button takes danger, primary, quiet; the taxonomy allows primary, quiet",
      ],
    );
    // A plain `string` type says nothing about the values, so they are not compared.
    assert.deepEqual(
      check((_, tags) => {
        tags["x-button"].appearance = "string";
      }),
      [],
    );
  });

  it("fails values for a component the entry does not list", () => {
    assert.deepEqual(
      check((list, tags) => {
        tags["x-chip"] = {};
        list[1].allowedValuesByComponent["x-chip"] = ["a"];
      }),
      [
        "values-for-unlisted-component: appearance.allowedValuesByComponent has x-chip, which appearance.usedBy does not list",
      ],
    );
  });
});
