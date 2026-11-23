# @lushly-dev/specimen

## Unreleased

- Add `pattern.json` Zod and draft 2020-12 JSON Schema (`@lushly-dev/specimen/pattern.schema.json`), the 9 ASCII format-2 identifier forms, `PatternTarget` role sets and mutually exclusive name matchers (`name`, `nameStartsWith`, `nameContains`), `BenchConfig` `patterns`/`patternSources` (including offline resolution of local pack directories and packages exporting `./pack`) and manifest-less app `pack` configuration (`dependencies`, `localElements`, `themeStylesheet`), `guideComponentSchema` `implements`/`contexts`, static `parameters.specimen.{patternSetup,contexts}` extraction in `specimen-host`, and zero-browser `specimen-validate` portability and cross-reference checks (#2144).

- Add the shared two-step meaningful-element climb (`climbSelection`, `climbElement`, `climbObservation`), the `specimen:` pointer URI parser/formatter (`parsePointer`, `formatPointer`, rejecting malformed pointers with `POINTER_INVALID`), and the static review page's **Pick** mode with outline, breadcrumb path, click-deeper, modifier-click deepest, Escape-to-parent, and **Copy pointer** (#2042). Raise the static build shell ceiling from 52,000 to 68,000 bytes (65,222 on fixtures) and total ceiling from 1,300,000 to 1,330,000 bytes (1,313,919 on fixtures).

- Split Specimen host target resolution failures (`host/src/page.rs`) into typed `TARGET_NOT_FOUND` and `TARGET_AMBIGUOUS` errors carrying actionable suggestions and match counts (`details.count`), and preserve structured `code`, `suggestion`, and `details` across the host JSON-lines client and worker IPC (#2046).

- Retry component-pack example remount captures once on transient failure or settle race, use the story timeout budget for remount captures, and wait one extra animation frame after `settle()` when remounting example markup so `pack-check` does not drop examples intermittently on Windows (#1404).

- Annotate synthetic macOS `ps` fixture paths in `experiments/resources/quiet.test.mjs` with `portability-ok` so the repository portability gate scans `foundations/` by default (#1221). No published file changes.

- A private, quarantined `endpoints/specimen-server` now hosts the existing AFD
  commands over MCP stdio with the CLI's schemas and result envelopes. It has no
  release route and changes no foundation or command API.

## 2.2.0-preview.9

### Minor Changes

- [#2132](https://github.com/lushly-dev/afd/pull/2132) [`dae40a9`](https://github.com/lushly-dev/afd/commit/dae40a946d681e00fa3cec077f1e3e05dae1b45d) Thanks [@Falkicon](https://github.com/Falkicon)! - Split Specimen host target resolution failures into typed `TARGET_NOT_FOUND` and `TARGET_AMBIGUOUS` errors carrying actionable suggestions and match counts (`details.count`), and plumb structured `code`, `suggestion`, and `details` through the TypeScript host client, process worker IPC, and `specimen-afd` commands ([#2046](https://github.com/lushly-dev/afd/issues/2046)).

## 2.2.0-preview.8

### Patch Changes

- [#1951](https://github.com/lushly-dev/afd/pull/1951) [`2c541a8`](https://github.com/lushly-dev/afd/commit/2c541a80bfd44eae791d8139b0b9d58f4cca2f44) Thanks [@Falkicon](https://github.com/Falkicon)! - Retry component-pack example remount captures once on transient capture failure or settle race (matching the two-pass case retry), use the configured story timeout budget for remount captures, and wait one extra animation frame after `settle()` when remounting example markup so deferred component writes settle consistently on Windows ([#1404](https://github.com/lushly-dev/afd/issues/1404)).

## 2.2.0-preview.7

### Patch Changes

- [#1897](https://github.com/lushly-dev/afd/pull/1897) [`5d5febd`](https://github.com/lushly-dev/afd/commit/5d5febdf2330ec95f9b3b270d577ea0f71776963) Thanks [@Falkicon](https://github.com/Falkicon)! - ### Security
  - Confine Specimen host static file serving (`serve.rs`) by percent-decoding strictly before validating path segments and verifying `canonicalize()` containment inside the configured `staticDirs` root; symlinks pointing outside `staticDirs` are now refused while in-root aliases keep their requested MIME type ([#1876](https://github.com/lushly-dev/afd/issues/1876)).
  - Reject traversal, backslash, control-character, and drive-prefixed `staticDirs[].to` mount paths in Specimen config validation and confine static directory copies and build-report writes inside `outDir`, rejecting escaping symlinks and materializing in-root links ([#1877](https://github.com/lushly-dev/afd/issues/1877)).
  - Escape keys, string literals (using `\x00` for NUL), non-hex color values, comments (including nested Kotlin `/*`), reserved/colliding identifiers, and case-insensitive/Windows-reserved filenames in Violet's Tailwind, TypeScript, Kotlin, and Dart token exporters ([#1878](https://github.com/lushly-dev/afd/issues/1878)).

  ### Fixed
  - Implement `SQLiteDatabase.transaction()` using explicit async `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` with serialized top-level execution, `AsyncLocalStorage`-backed `SAVEPOINT` serialization for nested transactions, and connection-ownership gating for ordinary database methods so outside writes and expired async contexts cannot be folded into or rolled back with another transaction ([#1879](https://github.com/lushly-dev/afd/issues/1879)).

## 2.2.0-preview.6

### Minor Changes

- [#1293](https://github.com/lushly-dev/afd/pull/1293) [`c3884d8`](https://github.com/lushly-dev/afd/commit/c3884d85bf902179ecdf6deb2672691fa008e122) Thanks [@Falkicon](https://github.com/Falkicon)! - Specimen's native host runs on Windows x64. It passes Chromium its CDP pipe as the C runtime's descriptors 3 and 4, as Node does for Playwright, and holds Chromium in a job object, so Chromium and every process it starts stop when the host closes or dies. The prebuilt host is the new optional dependency `@lushly-dev/specimen-host-win32-x64`, whose binary is `bin/specimen-host.exe`; the bench finds Playwright's headless shell under `%LOCALAPPDATA%\ms-playwright`, and pages get Playwright's Windows default font families.

  Fixed on Windows along the way: `specimen-contract` reports a story file as `./`-relative with `/` separators, a `stories` entry written with `\` separators is read as a path, a static build counts Specimen's own runtime and helpers in their categories, and the host no longer rebuilds the bench before every render or treats dependencies' modules as the project's own.

### Patch Changes

- [#1340](https://github.com/lushly-dev/afd/pull/1340) [`44ae808`](https://github.com/lushly-dev/afd/commit/44ae808a9796a724c0c91d7fb1e081a635ed30ab) Thanks [@Falkicon](https://github.com/Falkicon)! - A guide with an error (one that fails validation, such as a statement over its length limit) is now a problem of the pack run, so `specimen pack` refuses to write and `pack-check` fails, naming the guide file and the error. Before, the guide was left out of every record with nothing said and the build passed ([#1243](https://github.com/lushly-dev/afd/issues/1243)).

## 2.2.0-preview.5

### Minor Changes

- [#1049](https://github.com/lushly-dev/afd/pull/1049) [`1c2cfa9`](https://github.com/lushly-dev/afd/commit/1c2cfa98e9deb50589181d5a50a4a33843f6aeb1) Thanks [@Falkicon](https://github.com/Falkicon)! - The component pack format is version 1 and fixed: `PACK_FORMAT_VERSION` is 1, every file's `format` is 1, and the JSON Schema files say so. Version 1 is version 0's shape, fixed once a real library's pack was built and served (the Component Briefs plan's step C4). A file still in format 0 is `FORMAT_UNSUPPORTED`; rebuild the records with `specimen pack` and export again. From now on any change to what a pack file may hold is a new version.

  Exporting FAST-AF's pack found three faults, now fixed. `packCatalog`, and so `specimen-pack-export`, listed a catalog's components in file-path order, which puts `x-grid-cell` before `x-grid` and made the export `NOT_CANONICAL`; it lists them by tag. A guide that gives two roles for one state is `GUIDE_SCHEMA_INVALID` at `roles`: a record keeps one role a state, and the build kept the first while export compared both. And the FAST-AF plugin's schema source, which keeps an attribute the manifest lists apart from its property on that property, now takes what the manifest says of the attribute (its type, values, default and description) over what it says of the property, so a pack's record and export's recheck against the manifest agree.

- [#1235](https://github.com/lushly-dev/afd/pull/1235) [`f130bc2`](https://github.com/lushly-dev/afd/commit/f130bc26eab18962b6d98f6d9f6dde0ca8e33830) Thanks [@Falkicon](https://github.com/Falkicon)! - A component pack record now takes a component's default-state role from its open shadow tree when the component has none of its own: the role of the one accessible element there, as a component that keeps its control inside (a button's inner `button`) exposes it. Instances that were not rendered (no box) are not counted, and a laid-out instance with no role, or with two or more accessible elements in its shadow tree, still leaves the role out. A role taken from the shadow tree has no `name`. The pack format's version is unchanged.

## 2.2.0-preview.4

### Minor Changes

- [#1008](https://github.com/lushly-dev/afd/pull/1008) [`2aef1ae`](https://github.com/lushly-dev/afd/commit/2aef1aeefaf291b1edebfbc9e8e35384ced1188a) Thanks [@Falkicon](https://github.com/Falkicon)! - Capture 0.9: each accessible element in `channels.elements` carries its computed role and accessible name in `accessibility`, from Chromium's accessibility tree, including roles set through `ElementInternals`. Comparison reports a change in them under `a11y`. Captures from earlier versions must be recaptured.

- [#1041](https://github.com/lushly-dev/afd/pull/1041) [`8ea9c7c`](https://github.com/lushly-dev/afd/commit/8ea9c7c887b8a29c5e23e2f689f8eee604696711) Thanks [@Falkicon](https://github.com/Falkicon)! - Guide sources, Specimen's fifth plugin point and the first that runs in Node: `"guideSources": ["./specimen.guides.mjs"]` names modules whose default export is a guide source (declared with `defineGuideSource`), or an array of them, whose `rules(context)` returns shared rules from data a library already keeps. Their rules join the guide files' before any check: `specimen-validate` reports their problems against the module (`GUIDE_SOURCE_FAILED` when one does not load, throws or returns no array), `guides@1` counts them, a pack's rules file holds them, and `specimen-pack-export` rebuilds them with no browser. `context.read(path)` reads a file relative to the configuration and refuses one outside the root.

  `@lushly-dev/specimen-fast-af/guides` is FAST-AF's guide source: `attributeTaxonomy({ file })` states each entry of an attribute taxonomy (`attribute-taxonomy.jsonc`) once, its definition and what it is not for, as a rule for every component with that attribute. It imports no Node module.

  The FAST-AF plugin's schema source now keeps an attribute once when the manifest lists it apart from its property and the element's definition links the two: it stays on the property, which takes the attribute's type, values, default and description where it has none. Before, such an attribute was listed twice.

  A pack's examples write each element's attributes in name order. A page writes them in the order they were set, which differed from run to run where a component reflects an attribute after a story set another, so the same build kept different examples. The example pack's records changed to match: in `example-field`'s and `example-select`'s examples, `invalid` and `selected` now come first.

- [#1028](https://github.com/lushly-dev/afd/pull/1028) [`6ca6fa7`](https://github.com/lushly-dev/afd/commit/6ca6fa7bb8d6c4c6efe5b13ccc576aa76fbb0947) Thanks [@Falkicon](https://github.com/Falkicon)! - Build component packs: a `pack` configuration key names the library, and `bench.pack()`, `bench.packCheck()` and `bench.packExport()` build its committed form from two passes over every case, compare a build with the committed records, and write the exported form with no browser. A case that fails, after one retry, or shows something different in each pass contributes nothing; an example is kept only when its markup, mounted on its own, shows the same. Export refuses, naming the record, when the manifest or a guide file says something the committed records do not, and keeps other libraries and a deployment's `pack.toml`. Guide files take `roles` for states a capture does not show. The example pack's records changed: a boolean attribute no longer lists `true` and `false`, and `example-option`'s `value` is observed.

  The commands are `specimen-pack`, `specimen-pack-check` and `specimen-pack-export` in `@lushly-dev/specimen-afd`, and `specimen pack [TAG]`, `pack-check [TAG]` and `pack-export DIR` in the CLI. With a component, a build rebuilds that one record from the cases the last full build indexed (a cache under `node_modules/.cache/specimen/`), when the bench bundle is unchanged since; otherwise every case runs and the report says why. `pack-check` exits 1 when a committed record differs or a case failed.

- [#1037](https://github.com/lushly-dev/afd/pull/1037) [`fec06cf`](https://github.com/lushly-dev/afd/commit/fec06cf06494e48d2bddb9d6e7b0994c42b3066f) Thanks [@Falkicon](https://github.com/Falkicon)! - Declared and observed theme support. A story declares the themes it supports with a `light-only`, `dark-only` or `high-contrast-only` tag on itself or its meta, and a native specimen with `themes: { supported, reason? }` in the configuration; the entry carries it as `themes`. The review page tags a declared entry on the index and the preview, and when the selected theme is one it does not support, says so above the frame instead of looking like a broken switch. `bench.themes()`, `specimen-themes` and `specimen themes [ID]` render entries in each theme and compare the screenshots, reporting each as `follows`, `declared`, `pinned`, `undeclared`, `contradicted` or `unavailable`; `valid` is false, and the CLI exits 1, when one is `undeclared`. A component pack record can carry an optional `themes` fact, `declared` or `observed`, and a pack build writes a declared one when every case about a component declares the same themes; a reader from before this change refuses a record that carries it. The review page's shell ceiling moves from 50,000 to 52,000 bytes, since the shell's own code is 49,793.

### Patch Changes

- [#1022](https://github.com/lushly-dev/afd/pull/1022) [`dcd66b8`](https://github.com/lushly-dev/afd/commit/dcd66b88ba946b5c7a9ea958131046e8c85ef41a) Thanks [@Falkicon](https://github.com/Falkicon)! - The accessibility check runs axe-core 4.14.0, which turns on `label-content-name-mismatch` (WCAG 2.5.3, Label in Name): a labelled control whose accessible name does not contain the text it shows now fails a story under the `error` policy. The rule counts every text visible on screen, `aria-hidden` or not. The bench's accessibility ceiling moves from 650,000 to 680,000 bytes, since axe-core 4.14.0 is 659,293; the 1,300,000 total is unchanged.

## 2.2.0-preview.3

### Minor Changes

- [#997](https://github.com/lushly-dev/afd/pull/997) [`1c4eab8`](https://github.com/lushly-dev/afd/commit/1c4eab8f37ec33a10c5c04589bd184caecd9e46a) Thanks [@Falkicon](https://github.com/Falkicon)! - Guide statements are their own obligation set, `guides@1`: `specimen-coverage` reports each statement's level (`verified` or `authored`) under `guides`, with its own counts, invalid claims and `complete`, and leaves `schema-partitions@1`'s results unchanged. A claim may name `guide:<id>`, and `claim()` takes a fourth argument, the check it runs: a story's guide claim is recorded only when its check holds, fails the story when it does not, and is invalid without one.

- [#968](https://github.com/lushly-dev/afd/pull/968) [`4eaa6be`](https://github.com/lushly-dev/afd/commit/4eaa6be3f4e47117f6ad1227c6c63cb2196971e2) Thanks [@Falkicon](https://github.com/Falkicon)! - Add guide files: the `guides` configuration key, a JSON Schema for each kind of guide file, and static checks for them in `specimen-validate`.

- [#949](https://github.com/lushly-dev/afd/pull/949) [`6b7cc1a`](https://github.com/lushly-dev/afd/commit/6b7cc1aeafd089b055e0dd76913c05c5e41b88a7) Thanks [@Falkicon](https://github.com/Falkicon)! - Add the component pack format, version 0, at `@lushly-dev/specimen/pack`: Zod schemas for a component record, a library's shared rules and its catalog, `checkPack` with a code for each problem, canonical serialization, digests and the catalog writer, and a JSON Schema for each file kind at `@lushly-dev/specimen/pack/<kind>.schema.json`. The package now ships the format's description, `docs/pack-format.md`. Version 0 can change in any release; Specimen does not build packs yet.

- [#977](https://github.com/lushly-dev/afd/pull/977) [`770930e`](https://github.com/lushly-dev/afd/commit/770930ecbe1eed0cbf018a089a12082e2949560d) Thanks [@Falkicon](https://github.com/Falkicon)! - Fail a retained story on an uncaught error or unhandled rejection, from when its module loads until its last check, with a new `error` failure category naming the message. Storybook's Vitest addon fails the run on the same errors, so a suite moved to Specimen keeps the check. As under Vitest, an event with no error value and any event of a kind the page listens for itself do not count. A story that passed while raising such an error now fails.

### Patch Changes

- [#993](https://github.com/lushly-dev/afd/pull/993) [`0fb1eb4`](https://github.com/lushly-dev/afd/commit/0fb1eb4649881f6734f143735be83acbaca0ce31) Thanks [@Falkicon](https://github.com/Falkicon)! - The review page applies a theme or a preset viewport as soon as you pick it. Before, picking one changed nothing until you pressed Apply, so a choice could look selected but not be in effect. Apply now appears only with Custom, where you type the width and height first.

- [#992](https://github.com/lushly-dev/afd/pull/992) [`d2c30f7`](https://github.com/lushly-dev/afd/commit/d2c30f722f5d7aef19fe7a206608e163177d122e) Thanks [@Falkicon](https://github.com/Falkicon)! - The review page's breadcrumb now links every group segment. Each segment opens the index filtered to the specimens under it: "Backstage" in `Lushly / Backstage / Catalog Queues` shows every Backstage specimen. Before, only "All specimens" was a link.

- [#976](https://github.com/lushly-dev/afd/pull/976) [`27cc1e4`](https://github.com/lushly-dev/afd/commit/27cc1e461e4060950896c54771f7cabb5ce40ffa) Thanks [@Falkicon](https://github.com/Falkicon)! - Add the `text-lone-surrogate` invalid fixture to the component pack format, so both pack readers are held to `TEXT_INVALID` on an unpaired surrogate escape.

- [#1002](https://github.com/lushly-dev/afd/pull/1002) [`069af7b`](https://github.com/lushly-dev/afd/commit/069af7b6aa7f430032cf6bba207e8c1a553e76e5) Thanks [@Falkicon](https://github.com/Falkicon)! - The review page's theme and viewport selects draw their own arrow, inset from the right edge in the text's color. The native arrow sat flush against the edge.

## 2.2.0-preview.2

### Patch Changes

- [#915](https://github.com/lushly-dev/afd/pull/915) [`86ae222`](https://github.com/lushly-dev/afd/commit/86ae22229c67c7b97d6a6f3b3dfac60998e4945f) Thanks [@Falkicon](https://github.com/Falkicon)! - Specimen waits on each custom element's own registry, so a story with an element defined only in a scoped registry no longer hangs to its deadline ([#707](https://github.com/lushly-dev/afd/issues/707)). While a modal dialog is open, the ARIA snapshot is the dialog's, which is what stays exposed, instead of empty ([#662](https://github.com/lushly-dev/afd/issues/662)). A missing Chromium headless shell names the Playwright version it belongs to and the command that installs it, and each package's README now has its npm install section.

## 2.2.0-preview.1

### Patch Changes

- [#803](https://github.com/lushly-dev/afd/pull/803) [`feb7052`](https://github.com/lushly-dev/afd/commit/feb70527a3c28534d9baf8404f80047e175baf5c) Thanks [@Falkicon](https://github.com/Falkicon)! - Publishes the preview with its built code. The first preview, `2.2.0-preview.0` (`0.1.0-preview.0` for the FAST-AF plugin, `3.0.1-preview.0` for `fast-element`), went to npm without it: the release's build step did not run, so each package held only its manifest, readme and license, and installing it failed with `ERR_MODULE_NOT_FOUND`. The prebuilt hosts were complete. Install `@lushly-dev/<name>@preview`.

## 2.2.0-preview.0

### Patch Changes

- [#789](https://github.com/lushly-dev/afd/pull/789) [`4f2bed7`](https://github.com/lushly-dev/afd/commit/4f2bed76178dd5826e583d5725448dbd01f0307b) Thanks [@Falkicon](https://github.com/Falkicon)! - First preview on npm, under the `preview` tag: Specimen, the native component observation bench, with prebuilt hosts for Linux (x64 and arm64, glibc) and macOS (arm64 and x64); the `specimen` JSON CLI; its AFD command bindings; the FAST-AF plugin; and the FAST-AF runtime the plugin renders with. Install a package as `@lushly-dev/<name>@preview`. Its API can still change before the stable release.
