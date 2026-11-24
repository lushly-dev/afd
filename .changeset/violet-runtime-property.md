---
"@lushly-dev/violet-runtime": minor
"@lushly-dev/violet-core": patch
---

One rule names a Violet token's custom property everywhere ([#1786](https://github.com/lushly-dev/afd/issues/1786)): `tokenCustomProperty(id, prefix?)` and `VIOLET_CSS_PREFIX` (`'violet'`), exported from `@lushly-dev/violet-runtime` and from a new import-free subpath, `@lushly-dev/violet-runtime/property`. The runtime's inline writes and `adopt()` sheet name properties with it, as before (`cssPrefix` still defaults to empty); pass `cssPrefix: VIOLET_CSS_PREFIX` to theme `@lushly-dev/violet-elements`, whose token interface version 4 reads `--violet-<id>`. `@lushly-dev/violet-core`'s CSS exporter now names its properties with the same function and so depends on `@lushly-dev/violet-runtime`; its output is unchanged, and `prefix: 'violet'` writes the names violet-elements reads.
