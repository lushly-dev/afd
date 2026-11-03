# @lushly-dev/specimen-host-linux-arm64-gnu

Specimen's native host, `specimen-host`, prebuilt for linux on arm64 with glibc. [`@lushly-dev/specimen`](../../README.md#native-host) installs it as an optional dependency and finds it itself; it has no API of its own.

The binary is built from [`host/`](../../host) at this package's version and is not in the repository: `node ../../host/stage.mjs linux-arm64-gnu` copies a release build into `bin/` before packing.
