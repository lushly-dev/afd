# @lushly-dev/specimen-fast-af

## 0.1.0-preview.4

### Patch Changes

- [#1079](https://github.com/lushly-dev/afd/pull/1079) [`f485589`](https://github.com/lushly-dev/afd/commit/f485589495d4a08b371609c0066e43c81cd6f677) Thanks [@Falkicon](https://github.com/Falkicon)! - Each integration's peer on `@lushly-dev/specimen` (and, for `specimen-fast-af`, on `@lushly-dev/fast-element`) now requires at least the version it was built against, instead of any preview of that line. A consumer who updated only an integration used to install an older Specimen cleanly and then hit missing commands at runtime: `specimen-themes` and `specimen-pack*` in `specimen-afd`, and guide sources in `specimen-fast-af`. The install now asks for the Specimen it needs. Update Specimen with the integration.

- [#1049](https://github.com/lushly-dev/afd/pull/1049) [`1c2cfa9`](https://github.com/lushly-dev/afd/commit/1c2cfa98e9deb50589181d5a50a4a33843f6aeb1) Thanks [@Falkicon](https://github.com/Falkicon)! - The component pack format is version 1 and fixed: `PACK_FORMAT_VERSION` is 1, every file's `format` is 1, and the JSON Schema files say so. Version 1 is version 0's shape, fixed once a real library's pack was built and served (the Component Briefs plan's step C4). A file still in format 0 is `FORMAT_UNSUPPORTED`; rebuild the records with `specimen pack` and export again. From now on any change to what a pack file may hold is a new version.

  Exporting FAST-AF's pack found three faults, now fixed. `packCatalog`, and so `specimen-pack-export`, listed a catalog's components in file-path order, which puts `x-grid-cell` before `x-grid` and made the export `NOT_CANONICAL`; it lists them by tag. A guide that gives two roles for one state is `GUIDE_SCHEMA_INVALID` at `roles`: a record keeps one role a state, and the build kept the first while export compared both. And the FAST-AF plugin's schema source, which keeps an attribute the manifest lists apart from its property on that property, now takes what the manifest says of the attribute (its type, values, default and description) over what it says of the property, so a pack's record and export's recheck against the manifest agree.

## 0.1.0-preview.3

### Minor Changes

- [#1041](https://github.com/lushly-dev/afd/pull/1041) [`8ea9c7c`](https://github.com/lushly-dev/afd/commit/8ea9c7c887b8a29c5e23e2f689f8eee604696711) Thanks [@Falkicon](https://github.com/Falkicon)! - Guide sources, Specimen's fifth plugin point and the first that runs in Node: `"guideSources": ["./specimen.guides.mjs"]` names modules whose default export is a guide source (declared with `defineGuideSource`), or an array of them, whose `rules(context)` returns shared rules from data a library already keeps. Their rules join the guide files' before any check: `specimen-validate` reports their problems against the module (`GUIDE_SOURCE_FAILED` when one does not load, throws or returns no array), `guides@1` counts them, a pack's rules file holds them, and `specimen-pack-export` rebuilds them with no browser. `context.read(path)` reads a file relative to the configuration and refuses one outside the root.

  `@lushly-dev/specimen-fast-af/guides` is FAST-AF's guide source: `attributeTaxonomy({ file })` states each entry of an attribute taxonomy (`attribute-taxonomy.jsonc`) once, its definition and what it is not for, as a rule for every component with that attribute. It imports no Node module.

  The FAST-AF plugin's schema source now keeps an attribute once when the manifest lists it apart from its property and the element's definition links the two: it stays on the property, which takes the attribute's type, values, default and description where it has none. Before, such an attribute was listed twice.

  A pack's examples write each element's attributes in name order. A page writes them in the order they were set, which differed from run to run where a component reflects an attribute after a story set another, so the same build kept different examples. The example pack's records changed to match: in `example-field`'s and `example-select`'s examples, `invalid` and `selected` now come first.

## 0.1.0-preview.2

### Patch Changes

- [#915](https://github.com/lushly-dev/afd/pull/915) [`86ae222`](https://github.com/lushly-dev/afd/commit/86ae22229c67c7b97d6a6f3b3dfac60998e4945f) Thanks [@Falkicon](https://github.com/Falkicon)! - Specimen waits on each custom element's own registry, so a story with an element defined only in a scoped registry no longer hangs to its deadline ([#707](https://github.com/lushly-dev/afd/issues/707)). While a modal dialog is open, the ARIA snapshot is the dialog's, which is what stays exposed, instead of empty ([#662](https://github.com/lushly-dev/afd/issues/662)). A missing Chromium headless shell names the Playwright version it belongs to and the command that installs it, and each package's README now has its npm install section.

## 0.1.0-preview.1

### Patch Changes

- [#803](https://github.com/lushly-dev/afd/pull/803) [`feb7052`](https://github.com/lushly-dev/afd/commit/feb70527a3c28534d9baf8404f80047e175baf5c) Thanks [@Falkicon](https://github.com/Falkicon)! - Publishes the preview with its built code. The first preview, `2.2.0-preview.0` (`0.1.0-preview.0` for the FAST-AF plugin, `3.0.1-preview.0` for `fast-element`), went to npm without it: the release's build step did not run, so each package held only its manifest, readme and license, and installing it failed with `ERR_MODULE_NOT_FOUND`. The prebuilt hosts were complete. Install `@lushly-dev/<name>@preview`.

## 0.1.0-preview.0

### Patch Changes

- [#789](https://github.com/lushly-dev/afd/pull/789) [`4f2bed7`](https://github.com/lushly-dev/afd/commit/4f2bed76178dd5826e583d5725448dbd01f0307b) Thanks [@Falkicon](https://github.com/Falkicon)! - First preview on npm, under the `preview` tag: Specimen, the native component observation bench, with prebuilt hosts for Linux (x64 and arm64, glibc) and macOS (arm64 and x64); the `specimen` JSON CLI; its AFD command bindings; the FAST-AF plugin; and the FAST-AF runtime the plugin renders with. Install a package as `@lushly-dev/<name>@preview`. Its API can still change before the stable release.
