---
'@lushly-dev/specimen': patch
'@lushly-dev/specimen-afd': patch
'@lushly-dev/specimen-cli': patch
'@lushly-dev/specimen-fast-af': patch
---

Specimen waits on each custom element's own registry, so a story with an element defined only in a scoped registry no longer hangs to its deadline (#707). While a modal dialog is open, the ARIA snapshot is the dialog's, which is what stays exposed, instead of empty (#662). A missing Chromium headless shell names the Playwright version it belongs to and the command that installs it, and each package's README now has its npm install section.
