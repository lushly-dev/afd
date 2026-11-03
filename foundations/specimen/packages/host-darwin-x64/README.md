# @lushly-dev/specimen-host-darwin-x64

Specimen's native host, `specimen-host`, prebuilt for darwin on x64. [`@lushly-dev/specimen`](../../README.md#native-host) installs it as an optional dependency and finds it itself; it has no API of its own.

The binary is built from [`host/`](../../host) at this package's version and is not in the repository: `node ../../host/stage.mjs darwin-x64` copies a release build into `bin/` before packing.
