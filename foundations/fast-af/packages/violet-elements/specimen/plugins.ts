import { fastAf } from "@lushly-dev/specimen-fast-af";

// FAST-AF's plugin: each element's Definition Schema joins what the manifest says (finite values,
// slots, events). The bench installs it before any story module loads, so every element defined
// afterwards records its schema.
export default fastAf();
