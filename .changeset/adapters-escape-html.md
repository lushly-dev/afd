---
'@lushly-dev/afd-adapters': patch
---

Close two HTML-injection gaps in `escapeHtml()` and stop confidence bars from throwing.

- **`escapeHtml()` escapes every value**: it converts the value with `String(value)` and then escapes it. A non-string (an object with a `toString()`, an `Error`, an array) used to be returned unescaped.
- **`escapeHtml()` escapes `'` as `&#39;`**, so its output is safe in single-quoted attribute values too.
- `WebAdapter.renderConfidence()` (and `renderCommandResult()`) clamp a confidence outside `[0, 1]` and render a non-finite one as 0% instead of throwing `RangeError`.
- The package `lint` script now also checks `tests/` and `vitest.config.ts`.
