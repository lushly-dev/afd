# History

How Loam's design got here. The record is the history section of
`endpoints/loam/docs/design.md`; this file carries the same entries.

## 2026-10-31. Design foundation before UI (D26)

Violet is the token engine. Loam's semantic layer is a Violet theme in light,
dark and high contrast. The design document, its skill, the component
checklist and a token-only lint come before the chrome grows past a
skeleton. Components are built as they are needed, under the checklist.

## 2026-10-31. One component set (D28, D38)

The FAST-AF components in `foundations/fast-af` are the shared set for Loam
and every other consumer. They take Violet themes as custom properties, with
defaults baked in from Loam's light theme, so a component renders with no
theme and no runtime present.

## 2026-11-01. Data, not a dependency (D50, revising D28)

A foundation may not require another family, so the components take Loam's
resolved themes from a committed export
(`tokens/violet-theme.export.json`), not through the Violet runtime. Their
literal fallbacks are checked against the light theme. Phase 0
specification, section 2.4.

## 2026-11-01. The theme (step 2, #635)

The tree, contract version 1 (127 ids: 108 component, 19 shell), three themes
with compact density, the exports and the contrast floors. Light and dark
start from `violet-elements`' values, with two raised to meet the floors:

- `color.text.muted` in light, `#6b7280` to `#616775`;
- `color.border.strong`, alpha 0.35 to 0.48 in light and 0.26 to 0.37 in
  dark.

Compact keeps every target at 24px or more. High contrast is new: neutral
surfaces, 7:1 text, 3:1 non-text, a 3px focus width and spread shadows.

## 2026-11-01. The design document (step 4)

`design.md` and this skill, written from the theme as built. Decided:

### The resting field border must meet 3:1

Step 2 left `color.field.border` an alias of `color.border.subtle`: 1.22:1
on both field backgrounds in light, 1.40:1 and 1.45:1 in dark. WCAG 1.4.11
holds the visual information needed to identify a component to 3:1 against
adjacent colors; a faint border may stay only when something else
identifies the field. Nothing else does: `color.field.background` is
`color.surface.page`, between 1.04:1 and 1.38:1 against the other surfaces,
and `shadow.control` is a soft drop shadow (at most 0.09 alpha in light), not
an edge.

The change, for the theme and the components together (landed in #645;
see below):

| Id | Light (`loam`) | Dark (`loam/dark`) | High contrast (`loam/high-contrast`) |
|----|----------------|--------------------|--------------------------------------|
| `color.field.border` | alias of `color.border.strong`, `rgba(28, 26, 13, 0.48)`: 3.15:1 on the field background, 3.06:1 on the read-only one | the same alias, `rgba(255, 248, 235, 0.37)`: 3.34:1, 3.19:1 | override to `color.border.subtle`, `#595959`: 7.00:1, 6.26:1, as today |
| `color.field.border.hover` | `rgba(28, 26, 13, 0.64)`: 5.22:1, 4.96:1 | `rgba(255, 248, 235, 0.52)`: 5.36:1, 4.85:1 | override to `color.border.strong`, `#000000`, as today |
| `color.field.border.invalid` | alias of `color.state.danger.text`, `#B42318`: 6.51:1, 5.70:1 (today 1.73:1, 1.68:1; dark 1.68:1, 1.69:1) | the same alias, `#F5C7C2`: 11.86:1, 9.59:1 | the same alias, `#A30000`, as today |

- `shell.color.handle.hover` keeps aliasing `color.border.strong`.
- `pairs.ts` holds `color.field.border` and `color.field.border.invalid` on
  both field backgrounds to 3:1 in every theme.
- The field components must read the field tokens. Today the eight that
  read `color.field.border.hover` (`text-field`, `text-area`, `select`,
  `combobox`, `date-picker`, `date-range-picker`, `time-picker`,
  `color-picker`) draw their resting border from `color.border.subtle`
  through `--_border-subtle`, so a theme change alone renders nothing new.
  Each must draw it from `color.field.border`, with its literal fallback at
  the new light value, recorded in FAST-AF's provenance.

Ratios were measured with `theme`'s `contrastRatio` against the built theme,
translucent colors drawn over the field background over
`color.surface.page`.

### The parts

Bars (title bar, rail, tab bar, status bar) on `color.surface.subtle`; the
sidebar, inspector and panel on `color.surface.card`; main on
`color.surface.page`; floating layers on `color.surface.floating` with
`shadow.floating`. Parts abut, flat, with a `1px` `color.border.subtle` line
between inline parts. Insets from `space.layout.sm` and `space.layout.md`.

### Handles, motion, backdrop, family

- The handle's 4px bar takes the place of the boundary line and has a 24px
  (`size.target.compact`) hit area.
- Grid tracks change at once, including the panel maximizing. Overlays fade
  and never take a `transform`, as `violet-dialog` does, because a transform
  makes an overlay the containing block of its fixed-position popups. Under
  reduced motion nothing moves, and loading shows as text or a determinate
  `violet-progress`.
- Text on a hovered or pressed item is `color.text.secondary` or stronger:
  `color.text.muted` measures 4.45:1 or less on
  `color.action.secondary.hover` and 4.01:1 or less on `.pressed` in light
  (4.40:1 and 3.84:1 in dark). Step 7 adds the pairs it uses to `pairs.ts`.
- **The resting handle stays below 3:1** in light and dark
  (`shell.color.handle.rest`, about 1.2:1 and 1.4:1). Unlike a field, which
  must be found before it can be used, a handle sits where every part
  boundary is; the pointer finds it by the resize cursor and
  `shell.color.handle.hover` (3:1, held), the keyboard by F6 and the focus
  indicator with `shell.color.handle.active` (3:1, held). A judgement
  against WCAG 1.4.11: if an audit reads the boundary as the only visual
  information identifying the handle, the rest color becomes
  `color.border.strong`.
- The modal backdrop is `color.surface.page` at opacity 0.6.
- The font family stays the shared components' stack until the contract has
  an id for it.

### Open

- The single-pointer alternative to dragging a handle (WCAG 2.5.7), for
  step 7.
- A font-family id, and a focus-width id components outside the chrome can
  read, for contract version 2.

## 2026-11-01. The resting field border (#645)

The values above landed, for the theme and the components together:

- `color.field.border` aliases `color.border.strong` on `loam`;
  `color.field.border.hover` is `rgba(28, 26, 13, 0.64)` on `loam` and
  `rgba(255, 248, 235, 0.52)` on `loam/dark`; `color.field.border.invalid`
  aliases `color.state.danger.text`. `loam/high-contrast` keeps its values by
  overriding the resting border with `color.border.subtle` and the hover
  border with `color.border.strong`.
- `pairs.ts` holds the resting, hover and invalid borders on both field
  backgrounds to 3:1 in every theme.
- The eight field components draw the resting border from
  `color.field.border` and the hover border from `color.field.border.hover`,
  through `--_field-border` and `--_field-border-hover` in
  `violetFieldTokenDefaults`, whose invalid fallback moved to the new light
  value; the color picker's hex input reads `color.field.border` too, and
  components that take `--_danger-border` from the field defaults follow the
  new invalid border (the file upload's invalid drop zone among them). The
  focus border is unchanged. Recorded in FAST-AF's provenance (D50).
