---
"@lushly-dev/violet-elements": minor
---

**Breaking (preview minor): every token property takes the `violet-` prefix ([#1786](https://github.com/lushly-dev/afd/issues/1786)).** `tokens/interface.json` moves to `contractVersion` 4 and gains `"cssPrefix": "violet"`: a token's property is now `--violet-` and its id with `.` replaced by `-`, the name `@lushly-dev/violet-runtime`'s `tokenCustomProperty(id, 'violet')` gives and `@lushly-dev/violet-core`'s CSS exporter writes with `prefix: 'violet'`, so Violet's own output themes the components with no remapping. The ids, types and values are unchanged. The components, their literal fallbacks, the generated theme sheet and `violetTokenProperty()` all use the new names; `VIOLET_CSS_PREFIX` is exported from the root and `./theme-css`. The package still takes no Violet dependency: `theme:build` copies violet-runtime's naming rule into its generated sources.

| Before (version 3) | From version 4 |
|---|---|
| `--color-surface-page` | `--violet-color-surface-page` |
| `--color-action-primary-background` | `--violet-color-action-primary-background` |
| `--font-family-body` | `--violet-font-family-body` |
| `--size-target-natural` | `--violet-size-target-natural` |
| `--space-layout-sm` | `--violet-space-layout-sm` |
| `--z-index-modal` | `--violet-z-index-modal` |
| `--<id with . as ->`, any token | `--violet-<id with . as ->`, `violetTokenProperty(id)` |

The components' own knobs (`--violet-target-size`, `--violet-icon-size`, `--violet-font-family`, `--violet-card-background` and the rest) keep their names.

- **Deprecated, removed in the next preview release:** for this release the generated stylesheet ends with an alias block that declares each old name as a `var()` of the new one (`--color-surface-page: var(--violet-color-surface-page)`) on `:root` and every `[data-violet-theme-root]`, so a hand-written `var(--color-x)` keeps following the active preset, scoped roots included. Move those reads to `--violet-*` now.
- **Not aliased:** setting an old name (`--color-surface-page: …` on a host or root) no longer reaches the components; set the `--violet-` property instead. A product that writes its own theme properties regenerates them with the prefix (violet-core `prefix: 'violet'`, violet-runtime `cssPrefix: VIOLET_CSS_PREFIX`) or names them with `violetTokenProperty`.
- A product's build that checks a set with `findVioletThemeSetGaps` gets the new names in each gap's `property`.
