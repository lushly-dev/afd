---
name: loam-design
description: >
  Design system and decision record for AFD Loam's chrome and kit
  (endpoints/loam/), on the Violet theme in @lushly-dev/loam-theme. Covers
  the token contract and its three layers, the five-step type ramp, color
  roles and contrast floors, high contrast and forced colors, comfortable
  and compact density, the parts' sizes, surfaces, gutters and resize
  handles, motion and reduced motion, focus and state, violet-icon, the
  layout classes, the component checklist and the component list.
  Use when: building or styling a Loam chrome or kit component, changing a
  value in Loam's theme, adding a token, reviewing a Loam component against
  the checklist, or deciding a Loam layout or state treatment.
  Triggers: loam design, loam theme, loam-theme, loam chrome, loam kit,
  token contract, lint:tokens, loam-lint-tokens, shell tokens, high
  contrast, compact density, layout class, resize handle, component
  checklist, design.md.
---

# Loam Design

The source is [`endpoints/loam/docs/design.md`](../../../endpoints/loam/docs/design.md).
This skill carries the same rules; where the two differ, `design.md` is right
and this skill is corrected in the same pull request. The values live in
`@lushly-dev/loam-theme` (`endpoints/loam/packages/theme/`), and the shapes in
the [phase 0 specification](../../../endpoints/loam/docs/phases/0-kernel-chrome/spec.md),
sections 2 and 5 to 7.

Rules name tokens by contract id (`color.surface.page`); the custom property
is `--` and the id with `.` replaced by `-` (`--color-surface-page`).

## Files

| File | What it is |
|------|------------|
| `endpoints/loam/docs/design.md` | **The design record.** Edit it with any rule change |
| `endpoints/loam/packages/theme/src/tree/` | **The values.** `primitives.ts`, `components.ts`, `shell.ts`, `themes.ts` (dark, high contrast), `density.ts` (compact) |
| `endpoints/loam/packages/theme/contract/tokens.json` | The contract, version 1: 127 ids (108 component, 19 shell). Regenerate with `theme:check --write` |
| `endpoints/loam/packages/theme/src/pairs.ts` | The color pairs and their floors, checked by `theme`'s `test` |
| `endpoints/loam/packages/theme/scripts/lint-tokens.mjs` | The token-only lint, `loam-lint-tokens` |
| [references/tokens.md](references/tokens.md) | Every token family with its values per theme and density |
| [references/patterns.md](references/patterns.md) | CSS for parts, focus, states, reduced motion, forced colors and icons |
| [references/checklist.md](references/checklist.md) | The component checklist, its evidence, and the verification commands |
| [references/history.md](references/history.md) | The dated decisions, including the resting field border |

## Principles

1. **The shell recedes.** Quiet surfaces; contrast, color and motion belong
   to the apps' content.
2. **Tokens only.** No raw color, no raw length but `0` and `1px`;
   `lint:tokens` enforces it.
3. **Every theme is first-class.** Light, dark and high contrast, both
   densities and forced colors are designed and checked together.
4. **Contrast is measured.** Each pair a component relies on is in
   `pairs.ts` with its floor.
5. **State never rests on color alone.** Shape, text or an attribute changes
   too.
6. **Motion confirms, never decorates.** Under reduced motion only opacity
   and color change.
7. **One source.** The kernel's layout state and the shell tokens agree
   (`theme:check`); CSS reads the layout class from `data-layout-class`.

## The token layer

| Layer | Ids | Rule |
|-------|-----|------|
| Primitives | `ref.color.*`, `ref.space.*` | Never read or set outside the tree; no export has them |
| Component ids | `color.*`, `size.*`, `space.*`, `radius.*`, `shadow.*`, `duration.*`, `easing.*`, `type.*`, `weight.*`, `z-index.*` | Every Loam and shared component reads these |
| Shell ids | `shell.size.*`, `shell.color.*` | `@lushly-dev/loam-chrome` only |

- Theme and density are `data-loam-theme` (`light`, `dark`, `high-contrast`)
  and `data-loam-density` (`compact` or absent) on `document.documentElement`.
- Private aliases (`--_name`) must be declared in the same stylesheet from a
  contract id, a sound alias, or a state property (`--_sidebar-width`,
  `--_inspector-width`, `--_panel-height`).
- A value changes in the tree, never in component CSS. A new role gets a new
  semantic id (a contract change, `theme:check --write`), not a reused one.

## Type

| Step | Size / line / weight | Use |
|------|----------------------|-----|
| `type.caption.xs` | 11 / 14 / 500 | Status items, counts, palette key hints |
| `type.label.sm` | 12 / 16 / 500 | Bar and tab labels, field labels |
| `type.body.md` | 14 / 20 / 400 | Running text, rows, palette results, empty states |
| `type.title.sm` | 18 / 24 / 600 | Part headers, the palette's search text |
| `type.title.md` | 24 / 32 / 600 | Main's empty landing heading only |

Read a step's three ids together (`type.body.md.size`, `.line`, `.weight`),
never mix two steps, never `weight.light` in the chrome. Density does not change type. Family: `loam-shell` declares
`"Montserrat", "Segoe UI", sans-serif` once (no contract id yet).

## Color and contrast

- Floors: text 4.5:1 in light and dark, 7:1 in high contrast; non-text 3:1
  everywhere (`color.border.strong`, the hover field border, the hover and
  active handles, `color.focus.ring` and the field's focus border).
- Decorative in light and dark: `color.border.subtle` and the
  secondary-action, selected-control and state borders. Never the only
  indicator of a control. Button fills are identified by their labels.
- **The resting field border must meet 3:1** (decided 2026-11-01): the theme
  and component change is a follow-up with exact values in
  [references/history.md](references/history.md). Until it lands, light and
  dark fields miss WCAG 1.4.11 at rest.
- Forced colors: system colors only inside `@media (forced-colors: active)`;
  `CanvasText`/`Canvas`, `ButtonText`/`ButtonFace`, `Highlight`/`HighlightText`
  for focus and selection, `GrayText` for disabled. Forced colors removes
  `box-shadow`, so a shadow-only boundary needs an `outline` or `border`
  there.

## Density

`compact` changes only `size.space.{sm,md,lg,xl}`, `space.inline.*`,
`space.stack.*`, `size.target.{natural,comfortable}` and
`shell.size.{titlebar,rail,tabbar}`. No target goes below 24px
(`size.target.compact`). `space.layout.*`, type, radii, colors, motion and
part widths never change. Density is not the compact layout class.

Inside a control: `size.space.*`. Between controls in a row:
`space.inline.*`. Between stacked rows: `space.stack.*`. Around and between
regions: `space.layout.*`.

## The parts

| Part | Size | Background |
|------|------|------------|
| title bar | `shell.size.titlebar` (40, 32 compact); targets `size.target.natural` | `color.surface.subtle` |
| rail | `shell.size.rail` (48, 40); square targets `size.target.comfortable` | `color.surface.subtle` |
| sidebar | `--_sidebar-width`; `shell.size.sidebar.{default,min,max}` 260, 200 to 480 | `color.surface.card` |
| main | the rest; at least `shell.size.main.min` (360) | `color.surface.page` |
| inspector | `--_inspector-width`; `shell.size.inspector.{default,min,max}` 300, 240 to 520 | `color.surface.card` |
| panel | `--_panel-height`; `shell.size.panel.{default,min}` 240, 120 | `color.surface.card` |
| status bar | `shell.size.statusbar` (24 in both); targets `size.target.compact` | `color.surface.subtle` |
| tab bar | `shell.size.tabbar` (56, 48); targets `size.target.comfortable` | `color.surface.subtle` |
| drawer, sheet, palette | drawer `min(85vw, var(--shell-size-drawer-max))`; sheet `40dvh` to `80dvh` | `color.surface.floating`, `shadow.floating` (palette also `radius.lg`) |

- Parts abut, flat and square, with a `1px` `color.border.subtle` line
  between inline parts. Only floating layers take a shadow.
- Shape: `radius.md` for controls and items, `radius.lg` for floating
  layers, `radius.sm` for small marks, `radius.round` for pills.
- Gutters: part inset `space.layout.sm`; main inset and group gap
  `space.layout.md`; bar padding `space.inline.md`; gap between bar items
  `space.inline.sm`; part header block padding `space.stack.sm`; between list
  rows `space.stack.xs`.
- Handle: a `shell.size.handle` (4px) bar centered on the boundary in
  `shell.color.handle.rest`, `.hover` under the pointer, `.active` while
  dragged or focused; a 24px (`size.target.compact`) transparent hit area;
  arrows step 16px, Home and End go to the bounds. At rest it stays below
  3:1 in light and dark (a recorded judgement: hover and focus are held to
  3:1). The single-pointer alternative to dragging (WCAG 2.5.7) is open for
  step 7.

## Motion

`duration.fast` (120ms) hover, press, exits and the reduced-motion fade;
`duration.base` (180ms) state changes and entrances; `duration.slow` unused
by the chrome in phase 0. `easing.standard` for color and exits;
`easing.emphasized` for entrances. Animate only `opacity` and color; never a
track, width, height or position (the panel maximizes at once), and never a
`transform` on an overlay, because it would become the containing block of
its fixed-position popups (why `violet-dialog` is opacity-only). Drawers,
the sheet and the palette fade. Resizing follows the pointer with no
transition. Under `prefers-reduced-motion: reduce`, nothing moves: overlays
fade on `duration.fast` or appear at once, and loading shows as text or a
determinate `violet-progress`, never `violet-spinner` or an indeterminate
`violet-progress` alone (both keep moving, slower).

## Focus and state

- Focus: `outline: var(--shell-size-focus) solid var(--color-focus-ring)`,
  `outline-offset: var(--size-space-xs)`, on `:focus-visible` only. 2px, 3px
  in high contrast. Never clipped; never removed without an equal
  replacement. F6 and Shift+F6 move between parts; modals trap focus and
  return it.
- States: hover one step stronger (`color.action.*.hover`; for neutral
  items `color.surface.subtle` on a part, `color.action.secondary.hover` on a
  bar, which is already subtle); pressed `color.action.*.pressed`; text on a
  hovered or pressed item `color.text.secondary` or stronger, never
  `color.text.muted` (it drops under 4.5:1); selected
  `color.control.selected.{background,foreground}` plus a 2px
  (`size.space.xs`) start-edge bar and `aria-selected`/`aria-current`/
  `aria-pressed`; disabled `opacity: 0.55`, `cursor: not-allowed`, no hover,
  native `disabled` or `aria-disabled="true"` when it must keep focus for a
  tooltip; invalid `color.field.border.invalid`, `aria-invalid="true"` and
  supporting text in `color.state.danger.text`; loading `aria-busy="true"`.

## Icons

`violet-icon` by deep import. Always set `icon` (`system/<name>`; 16 system
icons in version 1), and register each icon used: import
`…/dist/icon/generated/icons/system-<name>…` and call its register function
(`registerSystemSearchIcon()`); importing `violet-icon` registers none. Beside text it is 1em; alone, set `--violet-icon-size`
from `size.line.sm` (title bar, status bar) or `size.line.md` (rail, tab bar,
part headers). Color is `currentColor`. Inside a named control it is
`decorative`; standing alone it takes a `label`. New icons go into
`violet-elements`' registry; never inline SVG.

## Layout classes

`expanded` ≥ 1024px: open parts inline, the inspector then the sidebar
overlaying when main would drop below `shell.size.main.min`. `medium` 640 to
1023px: the inspector overlays. `compact` < 640px: the tab bar replaces the
rail, the status bar hides, drawers are modal `<dialog>`s and the panel a
bottom sheet. Breakpoints are lengths only in `@media` conditions. Use
logical properties (`inline-start`, `inline-end`). At most one modal.

## Changing the design

1. A systemic change (a role, a step, a size) changes a token in the tree,
   then `theme:check` and `theme`'s `test`.
2. A component change uses tokens only and follows the patterns in
   [references/patterns.md](references/patterns.md).
3. A new rule or decision goes into `design.md` and its history, then into
   this skill.
4. A component merges only under [references/checklist.md](references/checklist.md),
   with its line in `design.md`'s component list.
