---
"@lushly-dev/violet-elements": patch
---

Fix four `violet-elements` right-to-left, WebKit and Firefox bugs (#2693, #2694, #2712, #2446):

- `violet-switch`: move the checked thumb with a logical `inset-inline-start` offset instead of a physical `translate(...)`, so it stays inside the track and moves toward the inline-end edge in right-to-left layouts (#2693).
- `violet-combobox`, `violet-accordion-item`, `violet-data-grid` cell pickers (`attachment-cell`, `multi-picker`, `persona-picker`, `pill-select`, `reference-picker`) and `violet-data-grid` stories: draw rotated chevrons from physical `border-right` and `border-bottom` edges so they keep pointing vertically in right-to-left layouts (#2694).
- `violet-data-grid`: allow `Alt+Tab` (macOS Safari Option+Tab) in header and custom cell widget `Tab` handlers, and map `userEvent.tab()` / `userEvent.keyboard("{Tab}")` to `Alt+Tab` on macOS WebKit in `vitest.config.ts` so Tab-to-button specs pass locally on macOS (#2712).
- `violet-tooltip`: focus the test window and poll popover state in the Escape dismissal spec to remove a Firefox timing flake (#2446).
