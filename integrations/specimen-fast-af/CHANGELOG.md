# @lushly-dev/specimen-fast-af

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
