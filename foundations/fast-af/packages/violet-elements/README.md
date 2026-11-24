# Violet Elements

> Reusable Violet web components for FAST-AF.

This package is the home for reusable platform components built on FAST-AF and Violet semantics.

## Scope

`@lushly-dev/violet-elements` is for:

1. Reusable primitives
2. Reference-grade composite components
3. Components intended to be shared across multiple projects

Examples:

- buttons
- fields and form primitives
- overlays and menus
- tables and data grids
- reusable layout/surface primitives

## Non-Goals

This package is **not** for:

- Lushly-specific product components
- domain composites tied to one application
- page/shell components for a single product

Those belong in the product repo.

## Boundary Rules

- `violet-*` tags are reusable platform components.
- Product tags such as `lushly-*` should not be added here.
- This package may depend on FAST-AF runtime packages.
- This package must not depend on product repositories.

## Direction

This package is the preferred destination for new reusable components.

The older `packages/components` package remains available as a Fluent-era legacy/reference layer, but it is not the golden path for new platform work.

## Package Entry Points

```ts
// Registers every Violet element and exports their classes and types.
import "@lushly-dev/violet-elements";
```

- `@lushly-dev/violet-elements/custom-elements.json` is the Custom Elements Manifest (also referenced by the `customElements` field).
- `@lushly-dev/violet-elements/tokens/*` exposes the token sources: `tokens/interface.json`, the custom properties the components read, and `tokens/violet-theme.export.json`, the built-in default theme.
- `@lushly-dev/violet-elements/theme-css` is the Node-safe theme-set helpers (`findVioletThemeSetGaps` and the types), side-effect free; see [Runtime Theme](#runtime-theme).
- `@lushly-dev/violet-elements/theme-runtime` is the runtime theme alone (`installVioletTheme`, `installVioletThemeSet`, `loadVioletBuiltInTheme`, the preset functions), without the built-in set's values or any element; see [Runtime Theme](#runtime-theme).
- Element modules register themselves when imported, so the package declares `sideEffects: true`.

## Story Review

Reusable components in this package should be reviewed through their stories
before they are treated as reference-grade. The stories run on Specimen
(`@lushly-dev/specimen`), which replaced Storybook here.

- Run `pnpm test:stories` from the repo root: it typechecks the stories, runs
  each one with its accessibility check and builds the review page.
- New components should include co-located `*.stories.ts` files.
- Stories are required as part of component creation, not a follow-up task.

## The Token Interface

The components read semantic tokens as CSS custom properties (`color.surface.page` is
`--color-surface-page`), each with a literal fallback. This package owns the list:
[tokens/interface.json](./tokens/interface.json), published as
`@lushly-dev/violet-elements/tokens/interface.json`, names every custom property a component
reads, by token id, with its type:

```json
{
  "contractVersion": 3,
  "package": "@lushly-dev/violet-elements",
  "tokens": {
    "color.accent.background": { "property": "--color-accent-background", "type": "color" },
    "color.surface.page": { "property": "--color-surface-page", "type": "color" },
    "font.family.body": { "property": "--font-family-body", "type": "fontFamily" },
    "shadow.well": { "property": "--shadow-well", "type": "shadow" }
  }
}
```

- A theme set supplies every id in its default preset. `"reserved": true` on an entry marks an
  id of the interface that no component reads yet; supply it anyway. No id is reserved in
  version 3.
- `contractVersion` changes whenever an id is added, removed, renamed or retyped. Version 2
  (the Refined design) added `font.family.heading`, `shadow.well`, `color.field.background`,
  `color.field.background.readonly`, `color.field.text`, `color.field.placeholder` and
  `color.field.border.focus`; `font.family.mono`, reserved in version 1, is now read. Version 3
  added `color.accent.background` and `color.accent.text` for accent badges.
- Types: `color`, `dimension`, `duration`, `cubicBezier`, `fontWeight`, `fontFamily`, `number`
  and `shadow`.
- `src/theme/violet-token-interface.spec.ts` fails when a component reads a property the file
  does not list (private `--_*` aliases and the components' own `--violet-*` knobs aside), or
  when the file lists one nothing reads that is not `reserved`.
- Typefaces come from `font.family.body`, from `font.family.heading` for a dialog's title and
  the text component's headings (its fallback is the body family) and from `font.family.mono`
  for a tool call's command name. When no theme or `--violet-font-family` override is installed,
  body and heading text inherit the host page's `font-family` instead of hard-coding a literal
  fallback stack.
- `src/theme/violet-private-properties.spec.ts` fails when a component reads a private `--_*`
  alias with no fallback that neither it nor a token-default block it includes defines (the
  declaration would be dropped), and when one read with a fallback is not listed there with
  its reason. The one dropped read it knows of and allows, in `violet-gantt`, is listed there
  too.

## The Built-In Default Theme

Without a product theme, the components use AFD's default theme set, shared with Loam: Refined,
from the AFD site's design system (ink on paper, cerulean for selection, focus and accent, mint for
success, rounded buttons and fields; Inter, Space Grotesk for headings and IBM Plex Mono, decisions
D159 and D172). The
package does not ship the typefaces; a page that wants them loads them, and without them each
stack falls back to the system's faces. A product with its own look installs its own theme set.
The values are Loam's Violet themes, taken as data, never as a package dependency (decision D50 of
AFD's Loam documents; `endpoints/loam/docs/phases/0-kernel-chrome/spec.md`, section 2.4):

- [tokens/violet-theme.export.json](./tokens/violet-theme.export.json) holds the component ids
  of Loam's resolved `light`, `dark` and `high-contrast` themes:
  `{ "contractVersion": 1, "source": "loam", "presets": { "<preset>": [{ "id", "value" }] } }`.
  Loam's theme package writes it (`pnpm -F @lushly-dev/loam-theme theme:export-components`);
  do not edit it by hand. `theme:check` there fails when Loam's tree does not supply an
  interface id with its property and type.
- `theme:build` generates `src/theme/generated/violet-theme.generated.ts`, the built-in set, from
  it, and fails when a preset lacks an interface id.
- Every literal fallback, `var(--<id>, <literal>)` in `src/`, equals the light value, so a
  component renders the light theme with no theme installed.
  `pnpm -F @lushly-dev/loam-theme theme:check` fails when one differs, and
  `theme:export-components --fallbacks` rewrites them. `src/theme/violet-token-defaults.ts` is
  hand-written and checked the same way.
- `src/foundations/token-registry.ts` and the foundations story read the export.

The former registries, `tokens/master-semantic.tokens.jsonc` and `tokens/theme-presets.jsonc`,
were retired by D50 and removed under the `removed-after-import` provenance classification.

## Token pipeline

The components' token interface, [tokens/interface.json](./tokens/interface.json), is the
contract between Violet's token engine and these components. Today a theme reaches them this way:

1. Violet's token engine (`@lushly-dev/violet-core`) holds a theme tree. Loam's is in
   `endpoints/loam/packages/theme/tree`, and Loam's theme package loads it with the `import.tree`
   command of `@lushly-dev/violet-afd`.
2. Loam's theme package resolves each theme and writes its component ids (every id outside
   `shell.*` and `ref.*`) to `tokens/violet-theme.export.json` (`theme:export-components`), without
   reading `interface.json`. `theme:check` holds Loam's tree to `interface.json`: it fails when a
   theme does not supply an interface id with its property and type, when the committed export
   differs from the tree, or when a literal fallback in `src/` differs from the light value.
3. `theme:build` here checks the export against `interface.json` and compiles it into the
   built-in set (`src/theme/generated/`). `installVioletTheme()` installs that set as one
   stylesheet keyed on `data-violet-theme`; `installVioletThemeSet()` installs a product's own set
   in its place.

[#1786](https://github.com/lushly-dev/afd/issues/1786) narrows this to one source and one runtime
path:

- Violet's engine, exporting against `interface.json`, becomes the only producer. Violet's
  specimens take their component model from `interface.json` instead of a second hard-coded one.
- The stylesheet becomes the only runtime path, installed through `adoptedStyleSheets` so that a
  page's Content Security Policy can forbid inline styles. `violet-runtime`'s inline
  `applyToDocument` is deprecated in favour of the same stylesheet.
- Semantic properties take the `--violet-` prefix, which is what violet-core's CSS exporter
  emits with `prefix: 'violet'` and violet-runtime with `cssPrefix: 'violet'`, with aliases for the unprefixed names for one preview release and a migration
  note for Loam.

## Runtime Theme

The theme is one constructed stylesheet that the runtime adopts through `adoptedStyleSheets`, so
components work without a provider wrapper around every usage site. Presets apply to the document
root or to any element marked `data-violet-theme-root` (the `violet-theme` host marks itself).

`installVioletTheme(target?)` adopts the sheet into the document, or into a shadow root, and
returns the `CSSStyleSheet`. It appends to the sheets already adopted there, once: a repeated call
adds nothing. A document and its shadow roots share one sheet, and another document (an iframe's)
gets its own, because a constructed sheet can be adopted only within the document it was made
for. No `<style>` element is written, so a page whose Content Security Policy forbids inline
styles needs no exception for the theme. `installVioletTheme()` throws a `TypeError` for a target
that is neither a document nor a shadow root, and for a document with no window (one made by
`createHTMLDocument` or `DOMParser`, or an iframe's once the iframe is removed), since only a
window can construct the sheet.

Where a token override lands in the cascade:

- Adopted sheets come after the document's own `<style>` and `<link>` sheets, so a page rule
  overriding a token on `:root` needs a more specific selector (or set the property on an
  element, which inherits).
- The sheet sets the tokens on every `[data-violet-theme-root]` and `<violet-theme>` too, so a
  token set on `body`, or any ancestor, is overridden again inside such a descendant. Set the
  override on that element, or with a selector that matches it.
- The runtime appends its sheet after those already adopted there. A page's own adopted sheet
  that overrides tokens must be adopted after `installVioletTheme()`, or use more specific
  selectors.
- In a shadow root the same order holds: its `<style>` elements come before its adopted sheets.
  The theme used to be a `<style>` element there too, so a host's own `<style>` written after it
  won a tie; now the runtime's sheet comes after every `<style>` in the root, and a host's
  override of a token on a `[data-violet-theme-root]` child with equal specificity loses. Raise
  its specificity, or put it in a sheet adopted after the runtime's.
- The returned sheet belongs to the runtime. It is rewritten whenever the active set changes, so
  an edit made to it lasts until then, and a repeated `installVioletTheme()` does not undo it.
  Put overrides in a sheet of your own.

The zero-config route installs the built-in default:

```ts
import { applyVioletThemePreset, installVioletTheme } from "@lushly-dev/violet-elements";

installVioletTheme();
applyVioletThemePreset(document, "dark");
```

The runtime (`@lushly-dev/violet-elements/theme-runtime`) never imports the built-in set's
values: `installVioletTheme()` loads them on first use with a dynamic import and writes them into
the adopted sheets when they arrive; `await loadVioletBuiltInTheme()` to know it is applied. Until
then the components render their literal fallbacks, which are the built-in light values. A load
that fails is reported with `console.error`, not cached, and retried by the next install or call;
`loadVioletBuiltInTheme()` rejects, so a page that awaits it at startup catches that rejection and
carries on with the fallbacks.

The laziness helps only a consumer that deep-imports the runtime and the element modules. The
package root and `theme/index.ts` statically re-export the built-in module (`violetThemeCssText`,
`violetThemeBuiltInSet` and the rest), so importing either loads it eagerly, and Vite may warn that
the module is imported both statically and dynamically (it then stays in the same chunk). A product
that installs its own set and wants the built-in values out of its bundle imports the element
modules (`@lushly-dev/violet-elements/dist/<element>/<element>.js`) and
`@lushly-dev/violet-elements/theme-runtime`, never the root.

A product that brings its own Violet tree installs its complete theme set as data instead. The
set replaces the built-in default, which is then never written, wherever this package installed a
theme, scoped `violet-theme` hosts in shadow roots included. Preset names are the product's:

```ts
import { applyVioletThemePreset, applyVioletThemeRoot, installVioletThemeSet } from "@lushly-dev/violet-elements";

installVioletThemeSet({
  defaultPreset: "light",
  presets: {
    light: lightTokens, // [{ id: "color.surface.page", value: "#fbfaf4" }, ...]
    dark: darkTokens,
    "high-contrast": highContrastTokens,
    sepia: sepiaTokens, // a preset lists what it sets and inherits the rest from the default
  },
});
applyVioletThemePreset(document, "sepia");
applyVioletThemeRoot(panel, "dark");
```

- `installVioletThemeSet(set, target?)` throws a `TypeError` for an unsound set (an unknown
  default preset, a preset name other than letters, digits, `-` and `_`, a malformed or repeated
  id, or a value holding `;`, `{`, `}`, `<`, `>`, a backslash, a comment, a line break, an
  unclosed quote or an unbalanced `(` or `[`).
- **Completeness is the product's check.** At runtime an id a set omits is not an error: the
  component silently uses its literal `var()` fallback, the built-in light value. Run
  `findVioletThemeSetGaps(set, tokenInterface)` in the product's build, with the
  `tokens/interface.json` of the installed version. It returns `{ problems, missing, complete }`:
  `problems` from `validateVioletThemeSet`, `missing` as `{ preset, id, property }` for every
  interface id a preset does not supply (counting what it inherits from the default). Ids the
  interface lacks are allowed.
- `@lushly-dev/violet-elements/theme-css` is the Node-safe entry for that check: side-effect
  free, with no DOM and no element registration (the package root registers every element and
  does not load in plain Node). It exports `findVioletThemeSetGaps`, `validateVioletThemeSet`,
  `createVioletThemeCss`, `violetTokenProperty`, `VIOLET_TOKEN_TYPES` and the types
  (`VioletThemeSet`, `VioletTokenInterface`, `VioletTokenType`, `VioletThemeSetGaps`):

  ```ts
  import { findVioletThemeSetGaps } from "@lushly-dev/violet-elements/theme-css";
  import tokenInterface from "@lushly-dev/violet-elements/tokens/interface.json" with { type: "json" };

  const { problems, missing, complete } = findVioletThemeSetGaps(themeSet, tokenInterface);
  if (!complete) throw new Error([...problems, ...missing.map(gap => `${gap.preset}: ${gap.id}`)].join("
"));
  ```
- `applyVioletThemePreset`, `applyVioletThemeRoot` and `normalizeVioletThemePreset` throw a
  `RangeError` for a name the installed set lacks; it is never mapped to the default. A
  `violet-theme` host keeps such a name as written and warns.
- `getVioletThemePresets()` and `getVioletThemeDefaultPreset()` describe the installed set;
  `resetVioletThemeSet()` goes back to the built-in one. `violetThemeBuiltInSet` (typed narrowly,
  `as const`), `violetThemePresets`, `VIOLET_THEME_DEFAULT_PRESET` and `violetThemeCssText` are the
  built-in set.
- Changing the active set (`installVioletThemeSet`, `resetVioletThemeSet`, or the built-in set
  arriving) rewrites each document's sheet with `replaceSync`, so every root that adopted it
  switches at once, a shadow root detached at the time included. Sheets are held weakly per
  document.

```html
<violet-theme preset="dark">
  <violet-button>Scoped button</violet-button>
</violet-theme>
```

Inside this repository (for example Specimen's preview, `specimen/preview.ts`),
the same functions are imported from `packages/violet-elements/src/theme`.

## Gantt foundation

`violet-gantt` is a reusable, read-only calendar-day timeline. Consumers provide
controlled rows, items, expansion, selection, viewport, status, and an optional
explicit `today` value. The component does not infer a calendar day from the
browser clock or from midnight instants.

Ranges use strict `YYYY-MM-DD` values with exclusive ends. Supported item dates
are `0000-01-01` through `9999-12-30`; `9999-12-31` is the final representable
exclusive boundary. One viewport may span at most 36,600 days. Import
`VIOLET_GANTT_DATE_LIMITS` when projecting source records so out-of-range values
can remain explicit in the consumer instead of being mistaken for scheduled geometry.
Invalid dates, identities, hierarchy links, item references, and presentation/time
combinations are omitted with a visible status. A `milestone` requires a
`day-point`; `work` and `window` require a `day-range`; `time: null` renders an
explicit unscheduled entry.

The host fills a definite-height parent. Each density sets a minimum row
height: 36px `compact`, 64px `natural`, and 76px `comfortable`. Rows grow in 24px
item lanes, capped at six visible lanes. The single scroll viewport
owns both the sticky name column and timeline geometry. It mounts only the visible
logical rows and day headers plus bounded overscan; it never creates a cell for
every row/day pair. Item lanes retain a 24px pointer target and readable one-line
labels. When a row has more items than its stable height can show, its `+N` count
is paired with pointer- and keyboard-operable previous/next controls that reveal
each logical item without mounting a hidden copy of the whole collection.

The axis keeps the visible month and year on screen while scrolling. Week and
month tick labels use readable widths independent of the underlying day geometry.
Chronology always runs left to right; row names retain the document's text
direction. The sticky name column responds to the component's actual container
width, and item reveal calculations use its measured width.

Keyboard focus moves through logical rows with Up, Down, Home, End, Page Up, and
Page Down. Right and Left follow tree expansion behavior. Alt+Right and Alt+Left
cycle through every logical item in the active row and reveal horizontally culled
items as needed. Enter activates the current item, Shift+Enter inspects the active
row, and Escape returns to row focus without changing selection. Data replacements
reconcile stale row and item identities; focus follows a remaining row only when
the timeline owned focus before the replacement. `focusItem()` returns `false`
without changing active state when the row is collapsed or the item's date is
outside the controlled viewport. Consumers loop
`item-selection-change`, `expanded-change`,
and `viewport-change` details into the corresponding controlled properties.
When the accepted range is too short to fill the measured timeline width, the
component emits an additive `viewport-change` request with reason `resize`.
The consumer remains responsible for loading and accepting that later exclusive
end; the component keeps the current fixed scale and never paints unloaded days
or shortens an accepted range when its container narrows.

## Data grid fill

In `focus-mode="cell"`, select a cell or rectangular range, then choose the built-in
**Fill down** or **Fill right** button to extend it by one row or column. The actions
work with a click, touch tap, Enter or Space. They use `fillSelection` and emit the
same `cell-fill` detail as dragging to that range; consumers apply the emitted
changes to their rows. Read-only targets and active edits disable the actions.

The drag handle keeps its small visual square with a transparent 24 × 24 CSS px
pointer target inside the selected corner cell. Grid navigation and editing keys
remain available; the labelled fill buttons are separate Tab stops before the grid.
For custom fill controls or larger ranges, call `fillSelection(direction, count)`.
