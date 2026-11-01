# Loam design

| Field | Value |
| --- | --- |
| Status | Living document; the design record for Loam's chrome and kit. Written 2026-11-01 as step 4 of the [phase 0 specification](phases/0-kernel-chrome/spec.md) (section 2.5, D26) |
| Owner | Repository owner; any agent changing Loam's chrome, kit or theme proposes amendments by pull request |
| Source of values | `@lushly-dev/loam-theme`: the tree in [`packages/theme/src/tree/`](../packages/theme/src/tree/), the contract in [`packages/theme/contract/tokens.json`](../packages/theme/contract/tokens.json), the contrast pairs in [`packages/theme/src/pairs.ts`](../packages/theme/src/pairs.ts) |
| Skill | [`loam-design`](../../../.claude/skills/loam-design/SKILL.md) carries the same rules for agents; where the two differ, this document is right and the skill is corrected |
| Read first | [STATUS.md](STATUS.md), then the [phase 0 specification](phases/0-kernel-chrome/spec.md), sections 2 and 5 to 7 |

Every rule here names the tokens it uses, by contract id (`color.surface.page`).
The custom property is `--` and the id with `.` replaced by `-`
(`--color-surface-page`). Values are the light theme in comfortable density
unless a rule says otherwise; the [token reference](#the-token-layer-and-the-contract)
gives every theme.

## Principles

1. **The shell recedes.** Loam is the soil, not the plant. The chrome sits on
   quiet surfaces and leaves contrast, color and motion to the apps' content.
   Nothing in the chrome is loud by default.
2. **Tokens only.** A Loam component writes no raw color and no raw length
   but `0` and `1px`; it reads semantic tokens from the contract.
   `lint:tokens` enforces it (spec 2.7).
3. **Every theme is a first-class theme.** Light, dark and high contrast are
   designed and checked together, in both densities and under forced colors.
   No theme is a filter over another.
4. **Contrast is measured, not judged.** Each color pair a component relies
   on is listed in `pairs.ts` with its floor, and `theme`'s `test` fails
   when a value misses it.
5. **State never rests on color alone.** Selected, invalid and disabled
   states change shape, text or an attribute as well as color.
6. **Motion confirms, never decorates.** Movement shows where something came
   from or went. Under `prefers-reduced-motion` only opacity and color change.
7. **One source.** The kernel's layout state and the theme's shell tokens
   agree (`theme:check`); CSS and tests read the layout class from one
   attribute, `data-layout-class`.

## The token layer and the contract

Three layers, read in one direction:

| Layer | Ids | Who reads it |
| --- | --- | --- |
| Primitives | `ref.color.<family>.<step>`, `ref.space.<px>` | Only the tree's semantic tokens. No export contains them, and the lint fails any component that reads or sets a `--ref-*` property |
| Component ids | 108 ids under `color.*`, `size.*`, `space.*`, `radius.*`, `shadow.*`, `duration.*`, `easing.*`, `type.*`, `weight.*`, `z-index.*` | The shared `violet-elements` components and every Loam component |
| Shell ids | 19 ids under `shell.size.*` and `shell.color.*` | `@lushly-dev/loam-chrome` only; the lint fails a shell id read or set anywhere else |

- **The contract** is version 1: 127 ids, each with its custom property, type
  and kind (`component` or `shell`), in `contract/tokens.json`. Version 1 is
  `violet-elements`' registry with no rename, so no component's CSS changes.
- **Themes and density** are attributes on `document.documentElement`, set by
  the chrome from `appearance-get`'s `resolved` and `density`:
  `data-loam-theme` is `light`, `dark` or `high-contrast`, and
  `data-loam-density` is `compact` or absent (comfortable). The chrome applies
  `loam-theme.css` through `adoptedStyleSheets`; no `<style>` element and no
  style attribute is used.
- **Private aliases** (`--_name`) are allowed when declared in the same
  stylesheet from a contract id, from another sound alias, or from a state
  property. The chrome's state properties are `--_sidebar-width`,
  `--_inspector-width` and `--_panel-height`, set through CSSOM from layout
  state; they are the only place pixel values from state enter CSS.
- **Changing a value** is an edit to the tree (`src/tree/`), then
  `theme:check` and `theme`'s `test`. A value never changes in component CSS.
- **Adding, removing or retyping an id** changes the contract: regenerate it
  with `theme:check --write`, review the diff, and record it here. A new
  component id also needs its literal fallback in `violet-elements` (D38).
  Add a semantic id for a new role rather than reusing one whose role differs.

## The type ramp

Five steps. Each is a size, a line height and a weight read together, with
the ids `<step>.size`, `<step>.line` and `<step>.weight` (for example
`type.body.md.size`); never mix the parts of two steps.

| Step | Size | Line | Weight | Use |
| --- | --- | --- | --- | --- |
| `type.caption.xs` | 11px (`size.font.xs`) | 14px (`size.line.xs`) | 500 (`weight.medium`) | Status bar items, counts, keyboard hints in the palette |
| `type.label.sm` | 12px (`size.font.sm`) | 16px (`size.line.sm`) | 500 (`weight.medium`) | Bar labels, tab bar labels, part headers' secondary text, field labels |
| `type.body.md` | 14px (`size.font.md`) | 20px (`size.line.md`) | 400 (`weight.regular`) | Running text, list rows, palette results, empty-state sentences |
| `type.title.sm` | 18px (`size.font.lg`) | 24px (`size.line.lg`) | 600 (`weight.semibold`) | A part's header, the palette's search text |
| `type.title.md` | 24px (`size.font.xl`) | 32px (`size.line.xl`) | 600 (`weight.semibold`) | The one heading of main's empty landing ("No apps yet") |

- Use the `type.*` ids, not the `size.font.*`, `size.line.*` and `weight.*`
  ids they alias, so a ramp change reaches every use.
- `weight.light` (100) is in the contract because it was in the
  components' registry; no component reads it, and the chrome does not use
  it.
- Density does not change type.
- **Family.** Contract version 1 has no font-family id. Until it has one,
  `loam-shell` declares the shared components' stack once,
  `"Montserrat", "Segoe UI", sans-serif`, and no other Loam element sets a
  family.
- **Color.** `color.text.primary` for content, `color.text.secondary` for
  supporting text, `color.text.muted` for metadata and placeholders.

## Color roles and the contrast floors

### Roles

| Role | Ids | Job |
| --- | --- | --- |
| Surfaces | `color.surface.page`, `.card`, `.subtle`, `.floating`, `.selected` | Backgrounds, from the quietest plane (`page`) to the selected row |
| Text | `color.text.primary`, `.secondary`, `.muted` | Content, support, metadata |
| Borders | `color.border.subtle`, `color.border.strong` | `subtle` separates regions and is decorative; `strong` is the boundary of a control that must be seen (checkbox, radio, switch, slider) |
| Focus | `color.focus.ring` | The focus indicator, on every surface |
| Actions | `color.action.{primary,secondary,danger}.{background,text,hover,pressed}`, `color.action.secondary.border` | Buttons, by weight: one primary per view, secondary for the rest, danger for destructive commands |
| Selected controls | `color.control.selected.{background,foreground,border}` | A selected item in a list, segmented control or rail |
| States | `color.state.{success,warning,danger}.{background,text,border}` | Messages and badges |
| Fields | `color.field.{background,background.readonly,text,placeholder}`, `color.field.border` and its `.hover`, `.focus`, `.invalid` | Text inputs and the controls built on them |
| Handles | `shell.color.handle.{rest,hover,active}` | The resize handles between parts; aliases of `color.border.subtle`, `color.border.strong` and `color.focus.ring` |
| Elevation | `shadow.control`, `shadow.card`, `shadow.floating` | Raised controls, cards, floating layers |

Values, light / dark / high contrast:

| Id | Light | Dark | High contrast |
| --- | --- | --- | --- |
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
| `color.action.primary.background` | `#C84F3B` | `#C84F3B` | `#000000` |
| `color.action.danger.background` | `#B42318` | `#B42318` | `#A30000` |
| `color.control.selected.foreground` | `#244635` | `#D9EFE0` | `#000000` |

The full set per theme is `dist/loam-theme.json` after `theme:build`.

### Floors

| Pair kind | Light and dark | High contrast |
| --- | --- | --- |
| Text: primary, secondary and muted on the five surfaces; each action's text on its background, hover and pressed colors; state text on its background, on page and on card; `color.control.selected.foreground` on its background; `color.field.text` and `color.field.placeholder` on both field backgrounds | 4.5:1 | 7:1 |
| Non-text: `color.border.strong` on page, card, subtle and floating; `color.field.border.hover` on both field backgrounds; `shell.color.handle.hover` and `.active` on page, card and subtle; `color.focus.ring` on the five surfaces; `color.field.border.focus` on both field backgrounds | 3:1 | 3:1 |
| Non-text, high contrast only: `color.border.subtle` and `shell.color.handle.rest` on the five surfaces; `color.field.border` and `color.field.border.invalid` on both field backgrounds; the primary and danger action backgrounds on page; `color.action.secondary.border`, `color.control.selected.border` and each state border on their backgrounds | Not held (decorative, or identified by a label) | 3:1 |

`pairs.ts` is the list; a component that relies on a pair it does not hold
adds the pair there in the same pull request. A translucent color is measured
drawn over its background, which is drawn over `color.surface.page`.

- **Decorative borders** (`color.border.subtle`, the secondary-action,
  selected-control and state borders) sit beside text or a fill that already
  identifies the thing, so light and dark do not hold them to 3:1. Never make
  one the only indicator of a control.
- **Button fills** are identified by their labels, so light and dark do not
  hold them to 3:1 against the page.
- **The resting field border** is the exception decided in this document's
  [history](#history) on 2026-11-01: it identifies the field, so it must
  meet 3:1. The theme and component change is a follow-up; until it lands,
  light and dark fields miss 1.4.11 at rest.
- **High contrast** is a light scheme on neutral colors: white surfaces with
  `#F2F2F2` subtle and `#E0E0E0` selected, black text and strong borders,
  `#595959` subtle borders, a black focus ring, a black primary action, and
  danger, success and warning at 7:1 on white. Shadows become spread shadows
  (`0 0 0 1px #000000`, 2px for `shadow.floating`) that draw a border
  without changing layout.

### Forced colors

`data-loam-theme="high-contrast"` is a theme. Forced colors is the system
overriding every color; the chrome sets the high-contrast theme under it and
lets the system colors win. Inside `@media (forced-colors: active)`, and only
there, a component uses system colors:

| What | System color |
| --- | --- |
| Text and boundaries | `CanvasText` on `Canvas` |
| Buttons and field frames | `ButtonText` on `ButtonFace` |
| The focus indicator, the selected item | `Highlight`, with `HighlightText` on it |
| Disabled | `GrayText` |
| Links | `LinkText` |

Forced colors removes `box-shadow`, so anything identified only by a shadow
(the high-contrast spread shadows, a field's focus ring drawn as a shadow)
needs an `outline` or `border` in the forced-colors block.

## Density rules

Two densities, `comfortable` (the default) and `compact`, set by
`data-loam-density`. Density is not the compact layout class: one is a
person's choice of spacing, the other the viewport's width, and either can
apply without the other.

Compact changes the ids below and no others. The rows whose two values are
equal are at their floors, and are shown so the scale reads whole:

| Id | Comfortable | Compact |
| --- | --- | --- |
| `size.space.xs` | 2px | 2px |
| `size.space.sm` | 4px | 2px |
| `size.space.md` | 8px | 6px |
| `size.space.lg` | 12px | 8px |
| `size.space.xl` | 24px | 16px |
| `space.inline.sm`, `.md`, `.lg` | 4, 8, 12px | 2, 6, 8px |
| `space.stack.xs`, `.sm`, `.md` | 4, 8, 12px | 2, 4, 8px |
| `size.target.compact` | 24px | 24px |
| `size.target.natural` | 32px | 28px |
| `size.target.comfortable` | 44px | 32px |
| `shell.size.titlebar` | 40px | 32px |
| `shell.size.statusbar` | 24px | 24px |
| `shell.size.rail` | 48px | 40px |
| `shell.size.tabbar` | 56px | 48px |

- **No target below 24px** in either density (WCAG 2.2, 2.5.8 target size,
  minimum). `size.target.compact` is the floor; `theme`'s `test` checks every
  target id and bar.
- **Layout spacing does not change.** `space.layout.sm` (12px) and
  `space.layout.md` (24px) read the primitives directly, so a part's inset is
  the same in both densities.
- **Type, radii, colors, motion and the part widths** do not change with
  density.
- **Inside a control** use `size.space.*` for padding and gaps; **between
  controls in a row** use `space.inline.*`; **between stacked rows** use
  `space.stack.*`; **around and between regions** use `space.layout.*`.

## The rhythm of the parts

### Sizes

| Part | Size | Bounds | Holds |
| --- | --- | --- | --- |
| title bar (`loam-titlebar`) | block `shell.size.titlebar` (40px, 32px compact) | fixed | Title, search button; targets `size.target.natural` (32px, 28px) |
| rail (`loam-rail`) | inline `shell.size.rail` (48px, 40px) | fixed | Entries; targets `size.target.comfortable` (44px, 32px), square |
| sidebar (`loam-sidebar`) | inline `--_sidebar-width`, default `shell.size.sidebar.default` (260px) | `shell.size.sidebar.min` to `.max` (200 to 480px) | The active app's navigation |
| main (`loam-main`) | the remaining track | at least `shell.size.main.min` (360px) | Content |
| inspector (`loam-inspector`) | inline `--_inspector-width`, default `shell.size.inspector.default` (300px) | `shell.size.inspector.min` to `.max` (240 to 520px) | Properties of the selection |
| panel (`loam-panel`) | block `--_panel-height`, default `shell.size.panel.default` (240px) | at least `shell.size.panel.min` (120px); rendered at most main's height less that minimum | Output, logs, terminals |
| status bar (`loam-statusbar`) | block `shell.size.statusbar` (24px in both) | fixed | Status items; targets `size.target.compact` (24px) |
| tab bar (`loam-tabbar`) | block `shell.size.tabbar` (56px, 48px) | fixed | Entries; targets `size.target.comfortable` (44px, 32px) |
| drawer (compact class) | inline `min(85vw, var(--shell-size-drawer-max))` (at most 320px) | | The sidebar or inspector |
| sheet (compact class) | block between `40dvh` and `80dvh` | | The panel |

- A bar is never smaller than the targets it holds: 40 ≥ 32 and 32 ≥ 28 in
  the title bar, 48 ≥ 44 and 40 ≥ 32 in the rail, 56 ≥ 44 and 48 ≥ 32 in the
  tab bar, 24 ≥ 24 in the status bar.
- The size defaults are also the kernel's `LAYOUT_DEFAULTS_V0`; `theme:check`
  fails when the two disagree. Width and height values from state enter CSS
  only through the three state properties on `loam-shell`.

### Surfaces and boundaries

| Part | Background | Text |
| --- | --- | --- |
| title bar, rail, tab bar, status bar | `color.surface.subtle` | `color.text.secondary`; `color.text.muted` only for status text that is not interactive |
| sidebar, inspector, panel | `color.surface.card` | `color.text.primary` |
| main | `color.surface.page` | `color.text.primary` |
| drawer, sheet, overlay drawer | `color.surface.floating`, with `shadow.floating` | `color.text.primary` |
| palette | `color.surface.floating`, `shadow.floating`, `radius.lg` | `color.text.primary` |

- **Parts abut.** There is no gap between parts; each boundary between two
  inline parts is a `1px` line of `color.border.subtle`. The line is
  decorative: parts are told apart by position and by their landmark roles,
  and a region's edge is neither a user-interface component nor a graphical
  object under WCAG 1.4.11.
- **Parts are flat.** Inline parts take no shadow and no radius. Only what
  floats over them (drawers, the sheet, the palette, popovers) takes
  `shadow.floating`.
- **Shape.** `radius.md` (4px) for controls and items (buttons, rail and
  list items, field frames); `radius.lg` (6px) for floating layers (the
  palette, popovers); `radius.sm` (2px) for small marks; `radius.round` for
  pills and avatars. Parts are square.

### Gutters

| Where | Token |
| --- | --- |
| A part's content inset (sidebar, inspector, panel, drawer, sheet) | `space.layout.sm` (12px) |
| Main's content inset, and the gap between groups in main | `space.layout.md` (24px) |
| A bar's inline padding | `space.inline.md` (8px, 6px compact) |
| The gap between items in a bar | `space.inline.sm` (4px, 2px compact) |
| A part header's block padding | `space.stack.sm` (8px, 4px compact) |
| Rows in a list | `space.stack.xs` (4px, 2px compact) between rows |

### Handles

`loam-resize-handle` sits on the boundary between a resizable part and main.

- **The bar** is `shell.size.handle` (4px) across and takes the place of
  the `1px` boundary line, centered on the boundary. It is colored
  `shell.color.handle.rest`, `shell.color.handle.hover` under the pointer,
  and `shell.color.handle.active` while dragged or focused.
- **The hit area** is `size.target.compact` (24px) across, centered on the
  bar, drawn by a transparent pseudo-element over the edges of both parts.
  A part's content inset (`space.layout.sm`, 12px) keeps its own targets out
  of that area, so the handle meets 2.5.8.
- **Focus** shows the focus indicator below around the bar, and the bar
  takes `shell.color.handle.active`.
- **At rest** the handle stays below 3:1 in light and dark, a judgement
  recorded in the [history](#history).
- **Cursor** is `col-resize` or `row-resize`.
- Keyboard: arrows step 16px and commit each step; Home and End go to the
  minimum and maximum (spec section 7).
- **Open:** WCAG 2.2's 2.5.7 asks for a single-pointer alternative to
  dragging. The keyboard steps do not count; step 7 decides the pointer
  alternative (a follow-up in the specification).

## Motion

| Token | Value | Use |
| --- | --- | --- |
| `duration.fast` | 120ms | Hover and press color changes; an overlay's exit; the reduced-motion fade |
| `duration.base` | 180ms | State changes; a drawer, sheet or the palette entering |
| `duration.slow` | 280ms | Not used by the chrome in phase 0 |
| `easing.standard` | `cubic-bezier(0.2, 0, 0, 1)` | Color changes and exits |
| `easing.emphasized` | `cubic-bezier(0.16, 1, 0.3, 1)` | Entrances |

- **Animate only `opacity` and color properties.** Never a grid track,
  width, height or position: a part opening or closing, and the panel
  maximizing or restoring, change their tracks at once, with no transition.
- **No `transform` on overlays.** A transform makes an element the
  containing block of its `position: fixed` descendants, so popups inside a
  drawer, the sheet or the palette would be placed against it while it
  animated. `violet-dialog` is opacity-only for this reason, and Loam's
  overlays follow it. The shared components' own small movements (a
  button's 1px lift on hover) are theirs.
- **Resizing follows the pointer** with no transition; a keyboard step
  applies at once.
- **Drawers, the sheet and the palette** fade in on `duration.base` and
  `easing.emphasized`, and out on `duration.fast` and `easing.standard`.
- **Nothing loops** behind reading. A loading indicator is the only repeating
  motion, and only while loading.
- **`prefers-reduced-motion: reduce`.** Nothing moves. Overlays fade on
  `duration.fast`, or appear at once; color changes stay. The shared
  components' token defaults shorten `duration.fast` and `duration.base` to
  0.01ms under this query. `violet-spinner` slows to 1.6s a turn and the
  indeterminate `violet-progress` slides more slowly (3.2s) rather than
  stopping, so under reduced motion a Loam component shows loading as text,
  or as a determinate `violet-progress`, never with either moving indicator
  alone.

## Focus and state

### Focus

- **Indicator:** `outline: var(--shell-size-focus) solid var(--color-focus-ring)`
  with `outline-offset: var(--size-space-xs)`. `shell.size.focus` is 2px, and
  3px in high contrast. `color.focus.ring` meets 3:1 on every surface in
  every theme.
- **Only on `:focus-visible`.** A pointer press does not show the ring.
- **Never removed** without a replacement of at least the same contrast and
  width; a field may draw its ring as a `box-shadow` only if its
  forced-colors block adds an `outline` of `Highlight`.
- **Not clipped.** A part with `overflow` hidden or auto keeps the ring
  inside by insetting its focusable children by at least `size.space.xs`
  plus the focus width.
- **The shared components** draw their own ring with `color.focus.ring` at
  2px (`violet-button`'s outline, `violet-checkbox`'s ring); they cannot read
  `shell.size.focus`, so their ring stays 2px in high contrast.
- **Moving focus:** F6 and Shift+F6 move between the present parts, in the
  order title bar, rail or tab bar, sidebar, main, inspector, panel, status
  bar (spec section 7). A modal (the palette, a compact drawer) traps focus
  and returns it to its opener when it closes.

### States

Every interactive Loam component covers the states it can take (checklist
item 2):

| State | Treatment | Tokens |
| --- | --- | --- |
| Rest | Its role's background and text | the role's ids |
| Hover | Background or border one step stronger; no layout change. Text on a hovered or pressed neutral item is `color.text.secondary` or stronger, never `color.text.muted` | `color.action.*.hover`; for neutral items the background becomes `color.surface.subtle` on a part, or `color.action.secondary.hover` on a bar (bars are already `color.surface.subtle`); `color.field.border.hover`; `shell.color.handle.hover` |
| Focus-visible | The indicator above | `shell.size.focus`, `color.focus.ring`, `size.space.xs` |
| Active (pressed) | The pressed color while the pointer or key is down | `color.action.*.pressed`; `color.action.secondary.pressed` for neutral items |
| Selected | Background and foreground, plus a mark that is not color: a start-edge bar `size.space.xs` (2px) wide in `color.control.selected.foreground`, and `aria-selected`, `aria-current` or `aria-pressed` | `color.control.selected.background`, `.foreground`, `.border` |
| Disabled | `opacity: 0.55`, `cursor: not-allowed`, no hover or press change; the native `disabled`, or `aria-disabled="true"` when it must stay focusable to show a tooltip (the phase 0 settings entry); exempt from the contrast floors (1.4.3, 1.4.11); `GrayText` under forced colors | the rest tokens |
| Invalid | The invalid border, `aria-invalid="true"`, and supporting text that names the problem and how to fix it, in `color.state.danger.text` | `color.field.border.invalid`, `color.state.danger.text` |
| Loading | `aria-busy="true"` on the region, a progress indicator, the control disabled while it waits; see reduced motion above | as Disabled, plus `violet-progress` |

Contract version 1 has no disabled-opacity id; 0.55 is the shared button's
value, and a number passes the lint.

## Iconography

Icons are `violet-icon` from `@lushly-dev/violet-elements`, imported by deep
import (`@lushly-dev/violet-elements/dist/<component>/…`, spec section 7).

- **Names** come from the registry, source-prefixed. Version 1 generates 16
  system icons: `system/arrow-up`, `attach`, `calendar`, `checkmark`,
  `chevron-right`, `clock`, `close`, `dismiss`, `document`, `folder`,
  `search`, `settings`, `sort-ascending`, `sort-descending`, `stop` and
  `warning`. Always set `icon`: the default is `system/search`, and an
  unregistered name renders a fallback glyph.
- **Registration.** Importing `violet-icon` registers no icon. A component
  imports each icon it uses from
  `@lushly-dev/violet-elements/dist/icon/generated/icons/system-<name>…` and
  calls its register function (`registerSystemSearchIcon()`), as
  `violet-alert` does.
- **New icons** are added to `violet-elements`' registry with their source
  and license, under the FAST-AF provenance rules. Loam never inlines SVG.
- **Size.** An icon is 1em by default, so beside text it follows the type
  step. Standing alone, set `--violet-icon-size` from a line height:
  `size.line.sm` (16px) in the title bar and status bar, `size.line.md`
  (20px) in the rail, the tab bar and part headers. `--violet-icon-size` is
  the component's own property; setting it from a token passes the lint.
- **Color** is `currentColor`, so an icon takes its text token. An icon never
  carries meaning by color alone.
- **Names for assistive technology.** An icon inside a control that has its
  own accessible name is `decorative`. An icon that stands alone as content
  takes a `label`. An icon-only button names itself with `aria-label`, and
  shows the same text as a tooltip.

## The layout classes

Chosen with `matchMedia` and written to `data-layout-class` on the chrome's
root (spec 5.3, D33):

| Class | Viewport width | Parts |
| --- | --- | --- |
| `expanded` | ≥ 1024px | Every open part inline. If they would leave main narrower than `shell.size.main.min`, the inspector becomes a non-modal overlay drawer from inline-end, then the sidebar from inline-start, without changing state |
| `medium` | 640 to 1023px | Sidebar and panel inline; an open inspector is a non-modal overlay drawer from inline-end |
| `compact` | < 640px | The rail becomes the tab bar at the bottom (`shell.size.tabbar`) and the status bar hides. The sidebar or inspector is a modal drawer (`<dialog>`, `showModal()`), `min(85vw, var(--shell-size-drawer-max))` wide; the panel is a bottom sheet above the tab bar, `40dvh` to `80dvh` high |

- **Breakpoints** are written as lengths in `@media` conditions (640px,
  1024px), which cannot read custom properties. The lint does not check
  at-rule conditions; write raw lengths there only for breakpoints.
- **Overlay drawers** take `color.surface.floating` and `shadow.floating`;
  non-modal ones sit at `z-index.overlay` and close with Escape. Modal
  drawers and the palette are in the top layer, so no z-index applies, and
  their backdrop is the dialog's `::backdrop`, `color.surface.page` at
  opacity 0.6.
- **Layers** for anything else: `z-index.raised` for a card lifted on hover,
  `z-index.sticky` for sticky headers inside a part, `z-index.popover` for
  tooltips and popovers, `z-index.toast` for toasts.
- **At most one modal.** Opening the palette closes a compact drawer first.
- **Logical properties.** Use `inline-start`, `inline-end`, `block-start`
  and `block-end`, never `left` and `right`, so a right-to-left document
  mirrors the shell.

## The component checklist

A kit or chrome component merges only when its pull request shows each item
(spec 2.6):

1. It references semantic tokens only; `lint:tokens` passes.
2. It covers every state it can take: hover, focus-visible, active,
   disabled, invalid, loading.
3. Keyboard operation and ARIA role, name and state are correct.
4. It is correct in light, dark and high contrast, in both densities, and
   under forced colors.
5. It has a Specimen fixture in `endpoints/loam/packages/chrome/specimens/`.
6. It passes axe in the Chromium suite, in all three themes.
7. It has a line in this document's [component list](#component-list).
8. It follows `prefers-reduced-motion`: no motion beyond opacity.

How a pull request shows each item:

| Item | Evidence |
| --- | --- |
| 1 | `pnpm -F @lushly-dev/loam-chrome lint:tokens` output |
| 2 | The states table above, filled for the component, in the pull request body |
| 3 | The keys it handles and its role, name and state, with the Chromium test that checks them |
| 4 | Specimen captures in the three themes and two densities; the Chromium suite's forced-colors run |
| 5 | The fixture's path |
| 6 | The axe run per theme in the Chromium suite |
| 7 | This document's diff |
| 8 | The reduced-motion run, or the line "it does not animate" |

## Component list

One line per component of Loam's kit and chrome: its element, what it is,
and the pull request that merged it under the checklist. Phase 0's kit is
only what the empty shell uses (spec section 7); none is built yet, and step
7 builds them.

| Element | What | Merged |
| --- | --- | --- |
| `loam-shell` | The grid that hosts the parts and reads the three state properties | Not yet (step 7) |
| `loam-titlebar` | `banner`, "Loam": the title and the palette's search button | Not yet (step 7) |
| `loam-rail` | `navigation`, "Apps", except in the compact class; in phase 0 only a disabled settings entry | Not yet (step 7) |
| `loam-tabbar` | `navigation`, "Apps", in the compact class in place of the rail | Not yet (step 7) |
| `loam-sidebar` | `complementary`, "Sidebar" | Not yet (step 7) |
| `loam-main` | `main`, with the empty landing "No apps yet" and the palette shortcut | Not yet (step 7) |
| `loam-inspector` | `complementary`, "Inspector" | Not yet (step 7) |
| `loam-panel` | `region`, "Panel" | Not yet (step 7) |
| `loam-statusbar` | `contentinfo`, "Status", except in the compact class | Not yet (step 7) |
| `loam-resize-handle` | `separator` between a resizable part and main | Not yet (step 7) |
| `loam-palette` | A `violet-dialog` with a search field and a `violet-listbox` of results | Not yet (step 7) |
| `loam-empty-state` | `violet-empty-state` as parts use it: one sentence saying what will appear there | Not yet (step 7) |
| `loam-status-item` | One item of the status bar | Not yet (step 7) |

## Open questions

| Question | Where it is settled |
| --- | --- |
| The resting field border's theme and component change | A follow-up in the specification, with the values in the history below |
| The single-pointer alternative to dragging a handle (WCAG 2.5.7) | Step 7; a follow-up in the specification |
| A font-family id, and a focus-width id components outside the chrome can read | Contract version 2; a follow-up in the specification. Phase 0 has no Loam package outside the chrome that draws focus |

## History

- **2026-10-31. Design foundation before UI (D26).** Violet is the token
  engine; Loam's semantic layer is a Violet theme in light, dark and high
  contrast; the design document, its skill, the component checklist and a
  token-only lint come before the chrome grows past a skeleton.
- **2026-10-31. One component set (D28, D38).** The FAST-AF components are
  the shared set; they take Violet themes as custom properties with defaults
  baked in from Loam's light theme.
- **2026-11-01. Data, not a dependency (D50, revising D28).** The components
  take Loam's resolved themes from a committed export, because a foundation
  may not require another family. Specified in the phase 0 specification,
  section 2.4.
- **2026-11-01. The theme (step 2,
  [#635](https://github.com/lushly-dev/afd/pull/635)).** The tree, contract
  version 1 (127 ids), three themes with compact density, and the contrast
  floors. Light and dark start from `violet-elements`' values, with two
  raised to meet the floors: `color.text.muted` in light `#6b7280` to
  `#616775`, and `color.border.strong` from 0.35 to 0.48 alpha in light and
  0.26 to 0.37 in dark. Compact keeps every target at 24px or more. High
  contrast is new.
- **2026-11-01. This document (step 4).** Written from the theme as built.
  Decided here:
  - **The resting field border must meet 3:1.** Step 2 left
    `color.field.border` an alias of `color.border.subtle`: 1.22:1 on both
    field backgrounds in light and 1.40:1 and 1.45:1 in dark. WCAG 1.4.11
    holds the visual information needed to identify a component to 3:1
    against adjacent colors, so a faint border may stay only when something
    else identifies the field, and nothing else does here: `color.field.background` is
    `color.surface.page`, between 1.04:1 and 1.38:1 against the other
    surfaces, and `shadow.control` is a soft drop shadow (at most 0.09
    alpha in light), not an edge. So the border is
    the field's only boundary. The change, for the theme and the
    components together:
    - `color.field.border` becomes an alias of `color.border.strong` on
      `loam`: `rgba(28, 26, 13, 0.48)` in light, 3.15:1 on
      `color.field.background` and 3.06:1 on
      `color.field.background.readonly`; `rgba(255, 248, 235, 0.37)` in
      dark, 3.34:1 and 3.19:1. `loam/high-contrast` overrides it with
      `color.border.subtle` (`#595959`, 7.00:1 and 6.26:1), as today.
    - `color.field.border.hover` stays one step stronger than rest:
      `rgba(28, 26, 13, 0.64)` on `loam` (5.22:1 and 4.96:1),
      `rgba(255, 248, 235, 0.52)` on `loam/dark` (5.36:1 and 4.85:1), and
      `color.border.strong` on `loam/high-contrast` (`#000000`, as today).
      `shell.color.handle.hover` keeps aliasing `color.border.strong`.
    - `color.field.border.invalid` becomes an alias of
      `color.state.danger.text`, so an invalid field is not fainter than a
      resting one: `#B42318` in light (6.51:1 and 5.70:1), `#F5C7C2` in dark
      (11.86:1 and 9.59:1), `#A30000` in high contrast, as today. Today it
      is 1.73:1 and 1.68:1 in light, 1.68:1 and 1.69:1 in dark.
    - `pairs.ts` holds `color.field.border` and `color.field.border.invalid`
      on both field backgrounds to 3:1 in every theme.
    - The field components read the field tokens. Today the eight that read
      `color.field.border.hover` (`text-field`, `text-area`, `select`,
      `combobox`, `date-picker`, `date-range-picker`, `time-picker`,
      `color-picker`) draw their resting border from
      `color.border.subtle` through `--_border-subtle`, so a theme change
      alone renders nothing new. Each must draw it from
      `color.field.border`, with the literal fallback at the new light
      value, recorded in FAST-AF's provenance.
    Ratios are measured with `theme`'s `contrastRatio` against the built
    theme, translucent colors drawn over the field background over
    `color.surface.page`.
  - **The parts' surfaces, gutters and boundaries:** bars on
    `color.surface.subtle`, side parts on `color.surface.card`, main on
    `color.surface.page`, parts abutting with a `1px` `color.border.subtle`
    line, insets from `space.layout.*`.
  - **The handle:** its 4px bar takes the place of the boundary line, with
    a 24px (`size.target.compact`) hit area.
  - **The modal backdrop:** `color.surface.page` at opacity 0.6.
  - **Motion:** tracks change at once, including the panel maximizing;
    overlays fade and never take a `transform`, as `violet-dialog` does;
    under reduced motion nothing moves.
  - **Text on hovered and pressed items:** at least `color.text.secondary`,
    because `color.text.muted` measures 4.45:1 or less on
    `color.action.secondary.hover` and 4.01:1 or less on `.pressed` in light
    (4.40:1 and 3.84:1 in dark). Step 7 adds the pairs it uses to
    `pairs.ts`.
  - **The resting handle stays below 3:1.** At rest a handle is drawn as the
    parts' boundary line, in `shell.color.handle.rest` (`color.border.subtle`,
    about 1.2:1 in light and 1.4:1 in dark), held to 3:1 only in high
    contrast. Unlike a field, which must be found before it can be used, a
    handle sits where every part boundary is, and the pointer finds it by
    the resize cursor and `shell.color.handle.hover` (3:1, held), the
    keyboard by F6 and the focus indicator with `shell.color.handle.active`
    (3:1, held). This is a judgement against WCAG 1.4.11; if an audit reads
    the boundary as the only visual information identifying the handle, the
    rest color becomes `color.border.strong`.
  - **The font family** stays the shared components' stack until the
    contract has an id for it.
