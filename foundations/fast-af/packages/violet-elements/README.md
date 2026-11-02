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
- `@lushly-dev/violet-elements/tokens/*` exposes the token sources, among them `tokens/violet-theme.export.json`.
- Element modules register themselves when imported, so the package declares `sideEffects: true`.

## Storybook Review

Reusable components in this package should be reviewed in the root Storybook 10
workspace before they are treated as reference-grade.

- Run `pnpm storybook` from the repo root.
- New components should include co-located `*.stories.ts` files.
- Stories are required as part of component creation, not a follow-up task.

## Where the Token Values Come From

The components read semantic tokens as CSS custom properties (`color.surface.page` is
`--color-surface-page`), each with a literal fallback. Their values come from Violet themes, as
data and custom properties, never as a package dependency (decision D50 of AFD's Loam
documents; `endpoints/loam/docs/phases/0-kernel-chrome/spec.md`, section 2.4):

- [tokens/violet-theme.export.json](./tokens/violet-theme.export.json) holds the component ids
  of Loam's resolved `light`, `dark` and `high-contrast` themes:
  `{ "contractVersion": 1, "source": "loam", "presets": { "<preset>": [{ "id", "value" }] } }`.
  Loam's theme package writes it (`pnpm -F @lushly-dev/loam-theme theme:export-components`);
  do not edit it by hand.
- `theme:build` generates the runtime theme from it, below.
- Every literal fallback, `var(--<id>, <literal>)` in `src/`, equals the light value, so a
  component renders the light theme with no theme installed.
  `pnpm -F @lushly-dev/loam-theme theme:check` fails when one differs, and
  `theme:export-components --fallbacks` rewrites them. `src/theme/violet-token-defaults.ts` is
  hand-written and checked the same way.
- `src/foundations/token-registry.ts` and the foundations story read the export.

The former registries, `tokens/master-semantic.tokens.jsonc` and `tokens/theme-presets.jsonc`,
are retired: empty, kept only for the FAST-AF provenance records, and read by nothing.

Another design system writes its own Violet tree and applies its CSS, or `VioletRuntime` with a
preloaded source, at its root; nothing in this package changes for it.

## Runtime Theme

Violet tokens are generated into a runtime theme module so components can work
without requiring a provider wrapper around every usage site.

- Generate the runtime theme with `pnpm -F @lushly-dev/violet-elements theme:build`, which
  writes `src/theme/generated/violet-theme.generated.ts` with the `light` (default), `dark` and
  `high-contrast` presets from the export.
- Install it once at the application or docs shell level.
- Use `data-violet-theme-root` or `violet-theme` only when a subtree needs its own scoped token overrides.

Example:

```ts
import {
  applyVioletThemePreset,
  installVioletTheme,
} from "@lushly-dev/violet-elements";

installVioletTheme();
applyVioletThemePreset(document, "light");
```

Inside this repository (for example the root Storybook), the same functions are
imported from `packages/violet-elements/src/theme`.

This is the preferred default for app-shell, Storybook, and CDN-style usage:
load the theme once, then use Violet components directly.

If a subtree needs explicit scoping, wrap it in `violet-theme`. The host can
also select a preset directly:

```html
<violet-theme preset="dark">
  <violet-button>Scoped button</violet-button>
</violet-theme>
```

The generated runtime theme currently ships with `light` and `dark` presets.

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
