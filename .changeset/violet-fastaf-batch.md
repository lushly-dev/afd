---
"@lushly-dev/violet-elements": minor
---

- Add unique per-instance CSS anchor names and a JavaScript positioning fallback for `violet-popover`, `violet-teaching-tip`, `violet-tooltip`, and `violet-menu` so overlays position reliably in Firefox, WebKit, and across Shadow DOM boundaries (#1784).
- Align all 13 `error-text` field components (`violet-color-picker`, `violet-combobox`, `violet-data-grid-pill-select`, `violet-date-picker`, `violet-date-range-picker`, `violet-file-upload`, `violet-radio-group`, `violet-range-slider`, `violet-segmented-control`, `violet-select`, `violet-slider`, `violet-time-picker`, `violet-tree`) to the invalid-only field-error contract: errors show only while `invalid` is set and not `disabled`, replace supporting text, use `part="error-message"` and `role="alert"`, and use `--color-state-danger-text` (#1678).
- Name `violet-progress`'s native `<progress>` element via `aria-labelledby` pointing at its rendered `.label` rather than duplicating the label into `aria-label` (#1366).
- Fix cross-browser `violet-data-grid` editor click-blur handling on WebKit, fill-drag pointerup handling on Firefox, and virtualized `violet-gantt` `End`-key focus timing on WebKit (#1784).
