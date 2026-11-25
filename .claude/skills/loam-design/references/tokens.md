# Token reference

Source of truth: `endpoints/loam/packages/theme/tree/` (DTCG token files) and
`endpoints/loam/packages/theme/contract/tokens.json`. The design record is
`endpoints/loam/docs/design.md`. Build the resolved values with
`pnpm -F @lushly-dev/loam-theme theme:build` and read `dist/loam-theme.css`
or `dist/loam-theme.json`.

## Layers

1. **Primitives (`ref.*`)**: `ref.color.<family>.<step>`, `ref.space.<px>`
   (2, 4, 6, 8, 12, 16, 24), `ref.type.<step>.{size,line}` (100, 200, 250, 300,
   400, 500), `ref.radius.<px>` (4, 8, 12, 9999) and `ref.target.<px>` (24, 28,
   32, 40, 44, 48, 56). Only the tree's semantic tokens reference them; no
   export contains them; the lint fails any read or set of `--violet-ref-*` or
   `--ref-*`.
2. **Component ids**: 104, read by `violet-elements` and every Loam
   component.
3. **Shell ids**: 19, read only by `@lushly-dev/loam-chrome`.

## Nodes

| Node | Type | Holds |
|------|------|-------|
| `loam` | product | Every contract id with its light value, and the primitives |
| `loam/light` | theme | Nothing more |
| `loam/dark` | theme | Color and shadow overrides |
| `loam/high-contrast` | theme | Neutral colors at 7:1 text and 3:1 non-text, `shell.size.focus` 3px, spread shadows |
| `loam/<theme>/compact` | custom | The compact overrides |

## Color, light / dark / high contrast

AFD's theme, Refined (D159): the AFD site's design system. The primitives are
the site's colors under its names (`--afd-ink-soft` is `ref.color.ink.soft`),
with the tints and shades Refined added under `global.ref.color` in `tree/loam.tokens.json`.

| Id | Light | Dark | High contrast |
|----|-------|------|---------------|
| `color.surface.page` | `#f4f0ea` | `#141515` | `#ffffff` |
| `color.surface.card` | `#f8f9f3` | `#1b1c1c` | `#ffffff` |
| `color.surface.subtle` | `#e9e5de` | `#202222` | `#F2F2F2` |
| `color.surface.floating` | `#ffffff` | `#252727` | `#ffffff` |
| `color.surface.selected` | `#dfecf4` | `#162832` | `#E0E0E0` |
| `color.surface.highlight` | `#ffffff` | `#333333` | `#ffffff` |
| `color.surface.pressed` | `#d8dcd6` | `rgba(244, 240, 234, 0.14)` | `#E6E6E6` |
| `color.text.primary` | `#181b1a` | `#f4f0ea` | `#000000` |
| `color.text.secondary` | `#48534b` | `#CCCCCC` | `#1F1F1F` |
| `color.text.muted` | `#5e6460` | `#999e9b` | `#3D3D3D` |
| `color.border.subtle` | `rgba(24, 27, 26, 0.10)` | `rgba(244, 240, 234, 0.10)` | `#595959` |
| `color.border.strong` | `#6b7d6e` | `#999e9b` | `#000000` |
| `color.focus.ring` | `#28769e` | `#3d92bf` | `#000000` |
| `color.control.selected.background` | `#c0daeb` | `#162832` | `#E0E0E0` |
| `color.control.selected.foreground` | `#1b5f80` | `#a1d4f3` | `#000000` |
| `color.control.selected.border` | `rgba(27, 95, 128, 0.5)` | `rgba(61, 146, 191, 0.5)` | `#000000` |
| `color.action.primary.background` / `.hover` / `.pressed` | `#181b1a` / `#2f383e` / `#262e33` | `#f4f0ea` / `#d8dcd6` / `#bec6bd` | `#000000` / `#333333` / `#4D4D4D` |
| `color.action.primary.text` | `#f4f0ea` | `#141515` | `#ffffff` |
| `color.action.secondary.background` / `.hover` / `.pressed` | `rgba(24, 27, 26, 0.07)` / `rgba(24, 27, 26, 0.11)` / `rgba(24, 27, 26, 0.15)` | `rgba(244, 240, 234, 0.09)` / `rgba(244, 240, 234, 0.13)` / `rgba(244, 240, 234, 0.17)` | `#ffffff` / `#E6E6E6` / `#CCCCCC` |
| `color.action.secondary.text` | `#181b1a` | `#f4f0ea` | `#000000` |
| `color.action.secondary.border` | `transparent` | `transparent` | `#000000` |
| `color.action.danger.background` / `.hover` / `.pressed` | `#c42a1a` / `#ad2416` / `#96200f` | as light | `#A30000` / `#8A0000` / `#700000` |
| `color.action.danger.text` | `#ffffff` | `#ffffff` | `#ffffff` |
| `color.accent.background` / `.text` | `#dfecf4` / `#1b5f80` | `#162832` / `#a1d4f3` | `#ffffff` / `#004A80` |
| `color.state.success.background` / `.text` / `.border` | `#dfeae3` / `#2c5e4b` / `transparent` | `#1b2823` / `#a3ebcd` / `transparent` | `#ffffff` / `#0B5A1E` / `#0B5A1E` |
| `color.state.warning.background` / `.text` / `.border` | `#f3e8d2` / `#92400e` / `transparent` | `#3a2b18` / `#f3d6a3` / `transparent` | `#ffffff` / `#6B3200` / `#6B3200` |
| `color.state.danger.background` / `.text` / `.border` | `#f7e4df` / `#c42a1a` / `transparent` | `#3d211d` / `#ffab99` / `transparent` | `#ffffff` / `#A30000` / `#A30000` |
| `color.state.success.foreground`, `color.state.danger.foreground` | `#2c5e4b` / `#c42a1a` | `#a3ebcd` / `#ff897a` | `#0B5A1E` / `#A30000` |
| `color.field.background` / `.readonly` | `#ffffff` / `rgba(24, 27, 26, 0.05)` | `rgba(0, 0, 0, 0.26)` / `rgba(244, 240, 234, 0.06)` | `#ffffff` / `#F2F2F2` |
| `color.field.border` / `.hover` / `.focus` / `.invalid` | `#869089` / `#48534b` / `#28769e` / `#c42a1a` | `#767b78` / `#999e9b` / `#3d92bf` / `#ff897a` | `#595959` / `#000000` / `#000000` / `#A30000` |

Some ids are aliases, so they follow the theme:

| Id | Alias of |
|----|------------------|
| `color.field.text` | `color.text.primary` |
| `color.field.placeholder` | `color.text.muted` |
| `color.field.border.focus` | `color.focus.ring` |
| `color.field.border.invalid` | `color.state.danger.text`; `ref.color.red.300` in dark |
| `color.field.background.readonly`, `color.field.border`, `color.field.border.hover` in high contrast | `color.surface.subtle`, `color.border.subtle`, `color.border.strong` (see [history.md](history.md)) |
| `shell.color.handle.rest` / `.hover` / `.active` | `color.border.subtle` / `color.border.strong` / `color.focus.ring` |

## Contrast floors

| Kind | Light, dark | High contrast |
|------|-------------|---------------|
| Text pairs | 4.5:1 | 7:1 |
| Non-text pairs | 3:1 | 3:1 |
| Decorative borders, button fills | not held | 3:1 |

The pairs are listed in `src/pairs.ts`. Translucent colors are measured drawn
over their background, drawn over `color.surface.page`; a field's pairs over
each of page, card, subtle and floating. A read-only field's line is
`color.border.strong` and its placeholder `color.text.secondary` (D159).

## Type

| Id | Value |
|----|-------|
| `weight.light`, `.regular`, `.medium`, `.semibold` | 100, 400, 500, 600 |
| `type.caption.{size,line,weight}` | `ref.type.200.{size,line}`, `weight.regular` (12 / 16 / 400) |
| `type.label.{size,line,weight}` | `ref.type.250.{size,line}`, `weight.medium` (13 / 16 / 500) |
| `type.body.{size,line,weight}` | `ref.type.300.{size,line}`, `weight.regular` (14 / 20 / 400) |
| `type.heading.section.{size,line,weight}` | `ref.type.400.{size,line}`, `weight.semibold` (18 / 24 / 600) |
| `type.heading.page.{size,line,weight}` | `ref.type.500.{size,line}`, `weight.semibold` (24 / 32 / 600) |
| `font.family.body` | `"Inter", system-ui, sans-serif`, the interface's typeface |
| `font.family.heading` | `"Space Grotesk", "Segoe UI", system-ui, sans-serif`: the dialog's title and the text component's title variants |
| `font.family.mono` | `"IBM Plex Mono", ui-monospace, Consolas, monospace`: the tool-call card's command name and the console's output |

Loam ships the three faces (`packages/theme/fonts/`, latin woff2, SIL OFL 1.1):
Inter 400, 500 and 600, Space Grotesk 600 and IBM Plex Mono 400 and 500. Bold
uses each family's heaviest file (600, or 500 for Plex Mono); italics are
synthesized.
`packages/web` links `loam-fonts.css`; nothing loads from another origin. An
app's frame does not get them and falls back to the system face.

The components also read four colors and a width the interface added late
([#659](https://github.com/lushly-dev/afd/issues/659)): `color.state.danger.foreground`,
`color.state.success.foreground`, `color.surface.highlight`, `color.surface.pressed`
(values above) and `size.focus-ring.width` 2px.

## Space and targets, comfortable / compact

| Id | Comfortable | Compact |
|----|-------------|---------|
| `space.inline.hairline`, `.tight`, `.group` | 2, 4, 8px | 2, 2, 6px |
| `space.stack.tight`, `.group`, `.section` | 4, 8, 12px | 2, 4, 8px |
| `space.layout.panel`, `.page` | 12, 24px | 12, 24px |
| `size.target.compact`, `.natural`, `.comfortable` | 24, 32, 44px | 24, 28, 32px |

## Shape, elevation, layers, motion

| Id | Value |
|----|-------|
| `radius.inset`, `.control`, `.floating`, `.round` | 4, 8, 12, 9999px |
| `shadow.control` | light `0 0 0 1px rgba(24, 27, 26, 0.05), 0 1px 2px rgba(24, 27, 26, 0.10)`; high contrast `0 0 0 1px #000000` |
| `shadow.card` | light `0 0 0 1px rgba(24, 27, 26, 0.06), 0 1px 2px rgba(24, 27, 26, 0.06), 0 4px 10px -2px rgba(24, 27, 26, 0.06)`; high contrast `0 0 0 1px #000000` |
| `shadow.floating` | light `0 0 0 1px rgba(24, 27, 26, 0.08), 0 4px 12px -2px rgba(24, 27, 26, 0.12), 0 18px 40px -8px rgba(24, 27, 26, 0.20)`; high contrast `0 0 0 2px #000000` |
| `shadow.well` | light `inset 0 2px 3px -1px rgba(0, 0, 0, 0.1)`; dark at 0.28; high contrast `inset 0 0 0 0 #000000` (none) |
| `z-index.base`, `.raised`, `.sticky`, `.overlay`, `.popover`, `.modal`, `.toast` | 0, 1, 10, 100, 200, 300, 400 |
| `duration.fast`, `.base`, `.slow` | 120, 180, 280ms |
| `easing.standard` | `cubic-bezier(0.2, 0, 0, 1)` |
| `easing.emphasized` | `cubic-bezier(0.16, 1, 0.3, 1)` |

Dark shadows are darker and larger; see `tree/loam_dark.tokens.json`.

## Shell ids

| Id | Comfortable | Compact |
|----|-------------|---------|
| `shell.size.titlebar` | 40px | 32px |
| `shell.size.statusbar` | 24px | 24px |
| `shell.size.rail` | 48px | 40px |
| `shell.size.tabbar` | 56px | 48px |
| `shell.size.sidebar.default`, `.min`, `.max` | 260, 200, 480px | same |
| `shell.size.inspector.default`, `.min`, `.max` | 300, 240, 520px | same |
| `shell.size.panel.default`, `.min` | 240, 120px | same |
| `shell.size.main.min` | 360px | same |
| `shell.size.drawer.max` | 320px | same |
| `shell.size.handle` | 4px | same |
| `shell.size.focus` | 2px; 3px in high contrast | same |
| `shell.color.handle.{rest,hover,active}` | aliases above | same |

The size defaults equal the kernel's `LAYOUT_DEFAULTS_V0`; `theme:check`
fails when they disagree.
