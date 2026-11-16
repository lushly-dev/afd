---
'@lushly-dev/specimen': minor
---

Specimen's native host runs on Windows x64. It passes Chromium its CDP pipe as the C runtime's descriptors 3 and 4, as Node does for Playwright, and holds Chromium in a job object, so Chromium and every process it starts stop when the host closes or dies. The prebuilt host is the new optional dependency `@lushly-dev/specimen-host-win32-x64`, whose binary is `bin/specimen-host.exe`; the bench finds Playwright's headless shell under `%LOCALAPPDATA%\ms-playwright`, and pages get Playwright's Windows default font families.

Fixed on Windows along the way: `specimen-contract` reports a story file as `./`-relative with `/` separators, a `stories` entry written with `\` separators is read as a path, a static build counts Specimen's own runtime and helpers in their categories, and the host no longer rebuilds the bench before every render or treats dependencies' modules as the project's own.
