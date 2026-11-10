---
'@lushly-dev/fast-element': patch
---

fast-element is now built with TypeScript 7. The ESM modules and declarations describe the same API: the JavaScript differs only in formatting (line wraps, separate `var` declarations for helper temporaries, their numbering), and five declaration files spell types differently (numeric keys in brackets, member and union order, `typeof noop` for `() => undefined`). The `dist/fast-element*.js` bundles are now built from that ESM output: they inline TypeScript's `__rest` helper in the two modules that use it instead of importing one copy from tslib, which adds 290 bytes to the minified bundles (gzipped, they stay within 4 bytes of before).
