# @lushly-dev/specimen-fast-af

## 0.1.0-preview.1

### Patch Changes

- [#803](https://github.com/lushly-dev/afd/pull/803) [`feb7052`](https://github.com/lushly-dev/afd/commit/feb70527a3c28534d9baf8404f80047e175baf5c) Thanks [@Falkicon](https://github.com/Falkicon)! - Publishes the preview with its built code. The first preview, `2.2.0-preview.0` (`0.1.0-preview.0` for the FAST-AF plugin, `3.0.1-preview.0` for `fast-element`), went to npm without it: the release's build step did not run, so each package held only its manifest, readme and license, and installing it failed with `ERR_MODULE_NOT_FOUND`. The prebuilt hosts were complete. Install `@lushly-dev/<name>@preview`.

## 0.1.0-preview.0

### Patch Changes

- [#789](https://github.com/lushly-dev/afd/pull/789) [`4f2bed7`](https://github.com/lushly-dev/afd/commit/4f2bed76178dd5826e583d5725448dbd01f0307b) Thanks [@Falkicon](https://github.com/Falkicon)! - First preview on npm, under the `preview` tag: Specimen, the native component observation bench, with prebuilt hosts for Linux (x64 and arm64, glibc) and macOS (arm64 and x64); the `specimen` JSON CLI; its AFD command bindings; the FAST-AF plugin; and the FAST-AF runtime the plugin renders with. Install a package as `@lushly-dev/<name>@preview`. Its API can still change before the stable release.
