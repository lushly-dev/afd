import { attributeTaxonomy } from "@lushly-dev/specimen-fast-af/guides";

// The attribute taxonomy as shared rules: what each attribute means, stated once for every
// component that has it. Specimen runs this in Node, from the `guideSources` key.
export default attributeTaxonomy({ file: "attribute-taxonomy.jsonc" });
