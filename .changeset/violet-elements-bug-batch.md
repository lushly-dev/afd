---
"@lushly-dev/violet-elements": minor
---

Fix four `violet-elements` bugs:

- **Remaining field borders >= 3:1 (#657):** draw resting, hover and focus borders from `color.field.border`, `color.field.border.hover` and `color.field.border.focus` over `color.field.background` in the color-picker hex input, the four data-grid picker search inputs (`pill-select`, `reference-picker`, `persona-picker`, `multi-picker`) and the `violet-file-upload` surface/dropzone (and reflect `dragActive` to `data-drag-active` via `dragActiveChanged()`).
- **Active option row styling and contrast (#1582):** reflect `active` as a boolean host attribute on `violet-option`, expose `--violet-option-active-background` (taking precedence over selected and hover fills when set) and `--violet-option-active-ring` (inheritable from host/ancestors via an internal `--_option-active-ring` default hook), raise the active row ring in `violet-select`, `violet-combobox` and `violet-listbox` to full `color.focus.ring` at `--size-focus-ring-width` (inherited through `violet-option-group` too), and sync the active option on `VioletSelect.show()` so active rows meet WCAG 1.4.11 (>= 3:1) in every preset.
- **Narrow column shrink (#1587):** set `grid-template-columns: minmax(0, 1fr)` and `min-inline-size: 0` on `:host`, `.field`, `.control-shell` and `.trigger`/`.control-frame` in `violet-select` and `violet-combobox` (matching `violet-text-field` and `violet-text-area`) so all four fields shrink inside narrow CSS grid columns without overflowing.
- **Single-file bundle TDZ (#2072):** defer `import("./violet-theme-builtin")` by a microtask inside `loadVioletBuiltInTheme()`, with a one-shot macrotask retry when an inlined single-file bundle's built-in module is still uninitialized across multiple top-level `await FASTElement.define(...)` calls (`inlineDynamicImports: true` / `codeSplitting: false`).
