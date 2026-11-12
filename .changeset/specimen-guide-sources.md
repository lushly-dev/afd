---
'@lushly-dev/specimen': minor
'@lushly-dev/specimen-fast-af': minor
---

Guide sources, Specimen's fifth plugin point and the first that runs in Node: `"guideSources": ["./specimen.guides.mjs"]` names modules whose default export is a guide source (declared with `defineGuideSource`), or an array of them, whose `rules(context)` returns shared rules from data a library already keeps. Their rules join the guide files' before any check: `specimen-validate` reports their problems against the module (`GUIDE_SOURCE_FAILED` when one does not load, throws or returns no array), `guides@1` counts them, a pack's rules file holds them, and `specimen-pack-export` rebuilds them with no browser. `context.read(path)` reads a file relative to the configuration and refuses one outside the root.

`@lushly-dev/specimen-fast-af/guides` is FAST-AF's guide source: `attributeTaxonomy({ file })` states each entry of an attribute taxonomy (`attribute-taxonomy.jsonc`) once, its definition and what it is not for, as a rule for every component with that attribute. It imports no Node module.

The FAST-AF plugin's schema source now keeps an attribute once when the manifest lists it apart from its property and the element's definition links the two: it stays on the property, which takes the attribute's type, values, default and description where it has none. Before, such an attribute was listed twice.

A pack's examples write each element's attributes in name order. A page writes them in the order they were set, which differed from run to run where a component reflects an attribute after a story set another, so the same build kept different examples. The example pack's records changed to match: `example-field`'s and `example-option`'s attributes are reordered in their examples.
