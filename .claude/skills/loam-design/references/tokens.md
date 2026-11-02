# Token reference

Source of truth: `endpoints/loam/packages/theme/src/tree/` and
`endpoints/loam/packages/theme/contract/tokens.json`. The design record is
`endpoints/loam/docs/design.md`. Build the resolved values with
`pnpm -F @lushly-dev/loam-theme theme:build` and read `dist/loam-theme.css`
or `dist/loam-theme.json`.

## Layers

1. **Primitives (`ref.*`)**: `ref.color.<family>.<step>` and
   `ref.space.<px>` (2, 4, 6, 8, 12, 16, 24). Only the tree's semantic tokens
   reference them; no export contains them; the lint fails any read or set of
   `--ref-*`.
2. **Component ids**: 108, read by `violet-elements` and every Loam
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

| Id | Light | Dark | High contrast |
|----|-------|------|---------------|
| `color.surface.page` | `#FFFEFA` | `#161713` | `#FFFFFF` |
| `color.surface.card` | `#FAF9F5` | `#1D1F1B` | `#FFFFFF` |
| `color.surface.subtle` | `#F0EFE6` | `#272A24` | `#F2F2F2` |
| `color.surface.floating` | `#F0EFE6` | `#20231D` | `#FFFFFF` |
| `color.surface.selected` | `#DDEADF` | `#22352C` | `#E0E0E0` |
| `color.text.primary` | `#18181b` | `#F5EFE3` | `#000000` |
| `color.text.secondary` | `#414651` | `#D3CCBF` | `#1F1F1F` |
| `color.text.muted` | `#616775` | `#A39B8D` | `#3D3D3D` |
| `color.border.subtle` | `rgba(28, 26, 13, 0.10)` | `rgba(255, 248, 235, 0.12)` | `#595959` |
| `color.border.strong` | `rgba(28, 26, 13, 0.48)` | `rgba(255, 248, 235, 0.37)` | `#000000` |
| `color.focus.ring` | `rgba(24, 24, 27, 0.5)` | `rgba(245, 239, 227, 0.5)` | `#000000` |
| `color.control.selected.background` | `#DDEADF` | `#22352C` | `#E0E0E0` |
| `color.control.selected.foreground` | `#244635` | `#D9EFE0` | `#000000` |
| `color.control.selected.border` | `rgba(36, 70, 53, 0.22)` | `rgba(172, 214, 188, 0.32)` | `#000000` |
| `color.action.primary.background` / `.hover` / `.pressed` | `#C84F3B` / `#BD4A37` / `#B54633` | as light | `#000000` / `#333333` / `#4D4D4D` |
| `color.action.primary.text` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` |
| `color.action.secondary.background` / `.hover` / `.pressed` | `#F0EFE6` / `#E7E4D8` / `#DDD9CB` | `#2B2D27` / `#34372F` / `#3D4038` | `#FFFFFF` / `#E6E6E6` / `#CCCCCC` |
| `color.action.secondary.text` | `#18181b` | `#F5EFE3` | `#000000` |
| `color.action.secondary.border` | `rgba(28, 26, 13, 0.18)` | `rgba(255, 248, 235, 0.14)` | `#000000` |
| `color.action.danger.background` / `.hover` / `.pressed` | `#B42318` / `#A32015` / `#911D12` | `#B42318` / `#C4301F` / `#CF4030` | `#A30000` / `#8A0000` / `#700000` |
| `color.action.danger.text` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` |
| `color.state.success.background` / `.text` / `.border` | `#E3F1E7` / `#166534` / `rgba(22, 101, 52, 0.28)` | `rgba(22, 101, 52, 0.36)` / `#B7E4C2` / `rgba(134, 239, 172, 0.24)` | `#FFFFFF` / `#0B5A1E` / `#0B5A1E` |
| `color.state.warning.background` / `.text` / `.border` | `#FDEBCC` / `#92400E` / `rgba(245, 158, 11, 0.34)` | `rgba(146, 64, 14, 0.38)` / `#F3D6A3` / `rgba(251, 191, 36, 0.28)` | `#FFFFFF` / `#6B3200` / `#6B3200` |
| `color.state.danger.background` / `.text` / `.border` | `#FBE2E2` / `#B42318` / `rgba(220, 38, 38, 0.34)` | `rgba(180, 35, 24, 0.38)` / `#F5C7C2` / `rgba(252, 165, 165, 0.24)` | `#FFFFFF` / `#A30000` / `#A30000` |

Field ids are aliases, so they follow the theme; the hover border is a
literal one step stronger than the resting border:

| Id | Alias of |
|----|------------------|
| `color.field.background` | `color.surface.page` |
| `color.field.background.readonly` | `color.surface.subtle` |
| `color.field.text` | `color.text.primary` |
| `color.field.placeholder` | `color.text.muted` |
| `color.field.border` | `color.border.strong`; `color.border.subtle` in high contrast (see [history.md](history.md)) |
| `color.field.border.hover` | `rgba(28, 26, 13, 0.64)`, `rgba(255, 248, 235, 0.52)` in dark, `color.border.strong` in high contrast |
| `color.field.border.focus` | `color.focus.ring` |
| `color.field.border.invalid` | `color.state.danger.text` |
| `shell.color.handle.rest` / `.hover` / `.active` | `color.border.subtle` / `color.border.strong` / `color.focus.ring` |

## Contrast floors

| Kind | Light, dark | High contrast |
|------|-------------|---------------|
| Text pairs | 4.5:1 | 7:1 |
| Non-text pairs | 3:1 | 3:1 |
| Decorative borders, button fills | not held | 3:1 |

The pairs are listed in `src/pairs.ts`. Translucent colors are measured drawn
over their background, drawn over `color.surface.page`.

## Type

| Id | Value |
|----|-------|
| `size.font.xs`, `.sm`, `.md`, `.lg`, `.xl` | 11, 12, 14, 18, 24px |
| `size.line.xs`, `.sm`, `.md`, `.lg`, `.xl` | 14, 16, 20, 24, 32px |
| `weight.light`, `.regular`, `.medium`, `.semibold` | 100, 400, 500, 600 |
| `type.caption.xs.{size,line,weight}` | `size.font.xs`, `size.line.xs`, `weight.medium` |
| `type.label.sm.{size,line,weight}` | `size.font.sm`, `size.line.sm`, `weight.medium` |
| `type.body.md.{size,line,weight}` | `size.font.md`, `size.line.md`, `weight.regular` |
| `type.title.sm.{size,line,weight}` | `size.font.lg`, `size.line.lg`, `weight.semibold` |
| `type.title.md.{size,line,weight}` | `size.font.xl`, `size.line.xl`, `weight.semibold` |

## Space and targets, comfortable / compact

| Id | Comfortable | Compact |
|----|-------------|---------|
| `size.space.xs`, `.sm`, `.md`, `.lg`, `.xl` | 2, 4, 8, 12, 24px | 2, 2, 6, 8, 16px |
| `space.inline.sm`, `.md`, `.lg` | 4, 8, 12px | 2, 6, 8px |
| `space.stack.xs`, `.sm`, `.md` | 4, 8, 12px | 2, 4, 8px |
| `space.layout.sm`, `.md` | 12, 24px | 12, 24px |
| `size.target.compact`, `.natural`, `.comfortable` | 24, 32, 44px | 24, 28, 32px |

## Shape, elevation, layers, motion

| Id | Value |
|----|-------|
| `radius.sm`, `.md`, `.lg`, `.round` | 2, 4, 6, 9999px |
| `shadow.control` | light `0 1px 1px rgba(28, 26, 13, 0.09), 0 2px 5px rgba(28, 26, 13, 0.04)`; high contrast `0 0 0 1px #000000` |
| `shadow.card` | light `0 1px 2px rgba(28, 26, 13, 0.15), 0 5px 10px rgba(28, 26, 13, 0.06)`; high contrast `0 0 0 1px #000000` |
| `shadow.floating` | light `0 2px 5px rgba(28, 26, 13, 0.22), 0 18px 34px rgba(28, 26, 13, 0.08)`; high contrast `0 0 0 2px #000000` |
| `z-index.base`, `.raised`, `.sticky`, `.overlay`, `.popover`, `.modal`, `.toast` | 0, 1, 10, 100, 200, 300, 400 |
| `duration.fast`, `.base`, `.slow` | 120, 180, 280ms |
| `easing.standard` | `cubic-bezier(0.2, 0, 0, 1)` |
| `easing.emphasized` | `cubic-bezier(0.16, 1, 0.3, 1)` |

Dark shadows are darker and larger; see `src/tree/themes.ts`.

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
