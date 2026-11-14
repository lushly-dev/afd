---
"@lushly-dev/violet-elements": minor
---

Products can bring their own Violet theme. `tokens/interface.json` (`@lushly-dev/violet-elements/tokens/interface.json`) lists every custom property the components read, by token id, with its type and a `contractVersion`. `installVioletThemeSet({ defaultPreset, presets })` installs a product's complete theme set as data, with its own preset names, on the document and any `[data-violet-theme-root]`, in place of the built-in default, which is then never written; `findVioletThemeSetGaps(set, tokenInterface)` lists what a set lacks against the interface, for a product's build. The components read their typeface from the new `font.family.body` token (`--font-family-body`), and the data grid, its pickers and its autosize use it instead of IBM Plex Sans. `font.family.mono` is reserved.

Breaking: `normalizeVioletThemePreset`, `applyVioletThemePreset` and `applyVioletThemeRoot` throw a `RangeError` for a preset name the installed set lacks instead of mapping it to `light`, `getVioletThemePreset` returns the attribute as written, and `VioletThemePreset` is now `string` (the built-in names are `VioletBuiltInThemePreset`).
