---
"@lushly-dev/violet-elements": patch
---

Form controls behave as an application expects from the host element, so the shadow-root workarounds applications carried can go (#1385).

- **One `input` event per edit.** `violet-text-field`, `violet-text-area`, `violet-date-picker`, `violet-time-picker`, `violet-slider`, `violet-range-slider`, `violet-color-picker` and `violet-combobox` no longer let the inner control's native `input` event escape the shadow root. A host listener now receives one event per edit, the element's own `CustomEvent` with the value in `detail`. Before, it also received the native event, without `detail`. `violet-color-picker` fires `input` only when its colour changes.
- **`focus()` on the host reaches the control** for `violet-date-picker`, `violet-time-picker`, `violet-date-range-picker`, `violet-slider`, `violet-range-slider`, `violet-color-picker`, `violet-file-upload` (its browse button) and `violet-segmented-control` (its checked segment, or the first enabled one). Before, it did nothing.
- **`violet-checkbox` is described by its supporting text** and by the ids in the host's `aria-describedby`, which are resolved across the shadow boundary, as `violet-text-field` already does.
- **`violet-data-grid` with `selection-mode="none"` gives each column its own width.** Its hidden selection column and its spacer rows still made a column slot that no visible cell filled, so each cell sat one slot to the left and took the wider of its own width and its left neighbour's. With the slot gone, narrow columns stretch to fill the grid, as they already did with selection on. The keyboard column resize now steps from the column's own pixel width, not its stretched width, so each arrow press moves it by exactly one step.
