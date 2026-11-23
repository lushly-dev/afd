---
"@lushly-dev/violet-elements": patch
---

Fix five `violet-elements` bugs:

- **Inherit host font family, unthemed field-surface fallback, and date-picker popup semantics (#512):** drop hard-coded `"Inter", system-ui, sans-serif` fallbacks in `violet-token-defaults`, `violet-data-grid` (and its six cell editors), `violet-dialog` and `violet-text`, adding `--violet-font-family` ahead of `--font-family-body` so un-themed hosts inherit their own typeface; align `--_field-background`'s unthemed fallback with the light theme's `#ffffff` so unthemed resting field borders meet 3:1 contrast (3.30:1); add `role="dialog"` and an accessible name to `violet-date-picker`'s popup panel; and open the date picker from the input on `Alt+ArrowDown` instead of plain `ArrowDown`, leaving `ArrowUp`/`ArrowDown` for native date-segment editing.
- **Open `violet-dialog` contrast at mount (#1171):** skip the initial opacity fade-in (`data-initial-open`) when `<violet-dialog open>` connects already open so the dialog starts settled at full opacity and passes axe `color-contrast` checks in light and dark themes, with an `Open` story and browser spec covering it.
- **Coarse-pointer sizing for accordion and carousel controls (#1569):** add `--_auto-target-size` and `@media (any-pointer: coarse)` comfortable-size growth (`44px`) to `violet-accordion-item` and `violet-carousel` (including growing carousel pager dots from `24px` to full `44px` touch targets on coarse pointers) without inflating `violetSurfaceTokenDefaults`.
- **Forced-colours contrast on quiet/transparent `violet-icon-button` (#1602):** paint `appearance="quiet"` and `appearance="transparent"` buttons with `ButtonText` (and `GrayText` when disabled, `Highlight` on focus-visible) under `@media (forced-colors: active)` so close and dismiss buttons inside opted-out `violet-dialog`, `violet-alert` and `violet-toast` surfaces keep high contrast.
- **Theme readiness in `violet-option` active-text contrast spec (#1963):** load the built-in theme and wait for `--color-surface-subtle` to apply on `<violet-theme>` before measuring contrast in `violet-option.spec.ts`.
