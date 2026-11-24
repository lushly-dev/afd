---
"@lushly-dev/violet-elements": patch
---

Fix three `violet-elements` bugs:
- `violet-data-grid`: preserve cell focus in Firefox when a queued `renderedRows.splice` flushes after a same-frame focus transition back into the grid (#2383).
- `violet-color-picker`: sync the hex `<input>` imperatively via `syncHexInputValue()` instead of a deferred `:value` binding so same-frame edits after a 6-digit preview are not overwritten on the next animation frame, and programmatic `value` updates display the normalized hex value (or empty for invalid values) (#2382).
- `violet-data-grid`: guard custom `cellTemplate` interactive widgets in `handleGridCopy` and `handleGridPaste` so native clipboard events pass through (#2368).
