# @lushly-dev/specimen-cli

## 2.2.0-preview.3

### Minor Changes

- [#1028](https://github.com/lushly-dev/afd/pull/1028) [`6ca6fa7`](https://github.com/lushly-dev/afd/commit/6ca6fa7bb8d6c4c6efe5b13ccc576aa76fbb0947) Thanks [@Falkicon](https://github.com/Falkicon)! - Build component packs: a `pack` configuration key names the library, and `bench.pack()`, `bench.packCheck()` and `bench.packExport()` build its committed form from two passes over every case, compare a build with the committed records, and write the exported form with no browser. A case that fails, after one retry, or shows something different in each pass contributes nothing; an example is kept only when its markup, mounted on its own, shows the same. Export refuses, naming the record, when the manifest or a guide file says something the committed records do not, and keeps other libraries and a deployment's `pack.toml`. Guide files take `roles` for states a capture does not show. The example pack's records changed: a boolean attribute no longer lists `true` and `false`, and `example-option`'s `value` is observed.

  The commands are `specimen-pack`, `specimen-pack-check` and `specimen-pack-export` in `@lushly-dev/specimen-afd`, and `specimen pack [TAG]`, `pack-check [TAG]` and `pack-export DIR` in the CLI. With a component, a build rebuilds that one record from the cases the last full build indexed (a cache under `node_modules/.cache/specimen/`), when the bench bundle is unchanged since; otherwise every case runs and the report says why. `pack-check` exits 1 when a committed record differs or a case failed.

- [#1037](https://github.com/lushly-dev/afd/pull/1037) [`fec06cf`](https://github.com/lushly-dev/afd/commit/fec06cf06494e48d2bddb9d6e7b0994c42b3066f) Thanks [@Falkicon](https://github.com/Falkicon)! - Declared and observed theme support. A story declares the themes it supports with a `light-only`, `dark-only` or `high-contrast-only` tag on itself or its meta, and a native specimen with `themes: { supported, reason? }` in the configuration; the entry carries it as `themes`. The review page tags a declared entry on the index and the preview, and when the selected theme is one it does not support, says so above the frame instead of looking like a broken switch. `bench.themes()`, `specimen-themes` and `specimen themes [ID]` render entries in each theme and compare the screenshots, reporting each as `follows`, `declared`, `pinned`, `undeclared`, `contradicted` or `unavailable`; `valid` is false, and the CLI exits 1, when one is `undeclared`. A component pack record can carry an optional `themes` fact, `declared` or `observed`, and a pack build writes a declared one when every case about a component declares the same themes; a reader from before this change refuses a record that carries it. The review page's shell ceiling moves from 50,000 to 52,000 bytes, since the shell's own code is 49,793.

### Patch Changes

- Updated dependencies [[`dcd66b8`](https://github.com/lushly-dev/afd/commit/dcd66b88ba946b5c7a9ea958131046e8c85ef41a), [`2aef1ae`](https://github.com/lushly-dev/afd/commit/2aef1aeefaf291b1edebfbc9e8e35384ced1188a), [`8ea9c7c`](https://github.com/lushly-dev/afd/commit/8ea9c7c887b8a29c5e23e2f689f8eee604696711), [`6ca6fa7`](https://github.com/lushly-dev/afd/commit/6ca6fa7bb8d6c4c6efe5b13ccc576aa76fbb0947), [`fec06cf`](https://github.com/lushly-dev/afd/commit/fec06cf06494e48d2bddb9d6e7b0994c42b3066f)]:
  - @lushly-dev/specimen@2.2.0-preview.4
  - @lushly-dev/specimen-afd@2.2.0-preview.3

## 2.2.0-preview.2

### Patch Changes

- [#915](https://github.com/lushly-dev/afd/pull/915) [`86ae222`](https://github.com/lushly-dev/afd/commit/86ae22229c67c7b97d6a6f3b3dfac60998e4945f) Thanks [@Falkicon](https://github.com/Falkicon)! - Specimen waits on each custom element's own registry, so a story with an element defined only in a scoped registry no longer hangs to its deadline ([#707](https://github.com/lushly-dev/afd/issues/707)). While a modal dialog is open, the ARIA snapshot is the dialog's, which is what stays exposed, instead of empty ([#662](https://github.com/lushly-dev/afd/issues/662)). A missing Chromium headless shell names the Playwright version it belongs to and the command that installs it, and each package's README now has its npm install section.
- Updated dependencies [[`86ae222`](https://github.com/lushly-dev/afd/commit/86ae22229c67c7b97d6a6f3b3dfac60998e4945f)]:
  - @lushly-dev/specimen@2.2.0-preview.2
  - @lushly-dev/specimen-afd@2.2.0-preview.2

## 2.2.0-preview.1

### Patch Changes

- [#803](https://github.com/lushly-dev/afd/pull/803) [`feb7052`](https://github.com/lushly-dev/afd/commit/feb70527a3c28534d9baf8404f80047e175baf5c) Thanks [@Falkicon](https://github.com/Falkicon)! - Publishes the preview with its built code. The first preview, `2.2.0-preview.0` (`0.1.0-preview.0` for the FAST-AF plugin, `3.0.1-preview.0` for `fast-element`), went to npm without it: the release's build step did not run, so each package held only its manifest, readme and license, and installing it failed with `ERR_MODULE_NOT_FOUND`. The prebuilt hosts were complete. Install `@lushly-dev/<name>@preview`.

- Updated dependencies [[`feb7052`](https://github.com/lushly-dev/afd/commit/feb70527a3c28534d9baf8404f80047e175baf5c)]:
  - @lushly-dev/specimen@2.2.0-preview.1
  - @lushly-dev/specimen-afd@2.2.0-preview.1

## 2.2.0-preview.0

### Patch Changes

- [#789](https://github.com/lushly-dev/afd/pull/789) [`4f2bed7`](https://github.com/lushly-dev/afd/commit/4f2bed76178dd5826e583d5725448dbd01f0307b) Thanks [@Falkicon](https://github.com/Falkicon)! - First preview on npm, under the `preview` tag: Specimen, the native component observation bench, with prebuilt hosts for Linux (x64 and arm64, glibc) and macOS (arm64 and x64); the `specimen` JSON CLI; its AFD command bindings; the FAST-AF plugin; and the FAST-AF runtime the plugin renders with. Install a package as `@lushly-dev/<name>@preview`. Its API can still change before the stable release.

- Updated dependencies [[`4f2bed7`](https://github.com/lushly-dev/afd/commit/4f2bed76178dd5826e583d5725448dbd01f0307b)]:
  - @lushly-dev/specimen@2.2.0-preview.0
  - @lushly-dev/specimen-afd@2.2.0-preview.0
