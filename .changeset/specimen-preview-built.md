---
"@lushly-dev/specimen": patch
"@lushly-dev/specimen-afd": patch
"@lushly-dev/specimen-cli": patch
"@lushly-dev/specimen-fast-af": patch
"@lushly-dev/fast-element": patch
---

Publishes the preview with its built code. The first preview, `2.2.0-preview.0` (`0.1.0-preview.0` for the FAST-AF plugin, `3.0.1-preview.0` for `fast-element`), went to npm without it: the release's build step did not run, so each package held only its manifest, readme and license, and installing it failed with `ERR_MODULE_NOT_FOUND`. The prebuilt hosts were complete. Install `@lushly-dev/<name>@preview`.
