# @lushly-dev/specimen

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
