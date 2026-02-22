# CSS Frontier: Emerging Layout Features

> Last updated: 2026-02-18 | Source: CSSWG January 2026 F2F (Apple, Cupertino)
> Authors/Contributors: Alison Maher, Celeste Pan, Yanling Wang, Patrick Brosset, Sam Davis Omekara, Javier Contreras Tenorio, Kevin Babbitt, Kurt Catti-Schmidt

This reference tracks CSS features on the near-term horizon -- covering specification status, browser support, and key design decisions still in flight. Features here are either unshipped or in early availability as of early 2026.

---

## CSS Grid Lanes (Masonry)

CSS Grid Lanes is a new layout mode with a stacking axis and an auto-placement axis, being specified as part of CSS Grid Level 3.

### How It Works

The layout mode is invoked with `display: grid-lanes` (block) or `display: inline-grid-lanes` (inline). This is distinct from the older `grid-template-rows: masonry` syntax that Safari Technology Preview still implements -- that syntax predates the current specification direction.

```css
/* Grid Lanes -- the current spec direction */
.gallery {
  display: grid-lanes;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 16px;
}

/* Legacy masonry syntax (Safari TP only -- do not use) */
.gallery-legacy {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  grid-template-rows: masonry; /* outdated */
}
```

**Browser support (Feb 2026):** No production browser supports `display: grid-lanes`. Safari TP has legacy syntax only. Firefox flag-only. Chrome/Edge: no implementation. 58 developer upvotes on web-platform-dx signals.

**Fallback:** `display: grid-lanes` is ignored by non-supporting browsers, so `display: grid` works as a clean fallback without parsing side effects.

### Spec Decisions (January 2026 F2F)

#### Container direction syntax -- UNRESOLVED

The syntax for switching between container directions is still open. The spec contains **ISSUE 3: "TBD property"** for the orientation property, with Issue #12803 open to decide between reusing `grid-auto-flow` versus introducing a new `grid-lanes-direction` property. An outreach plan to gather developer data was resolved; the Microsoft Layout team, Apple, and Patrick Brosset will lead it.

#### Item alignment in stacking axis -- RESOLVED

Remaining details were resolved to **unblock Chromium implementation** of stacking-axis alignment.

#### Negative margin handling -- RESOLVED

1. **Running position floor:** An item's impact on the running position is floored -- the running position cannot move backwards even with a negative `margin-bottom`.
2. **Baselines and dense packing:** Negative margins do not affect baseline order, but dense packing does.

#### `flow-tolerance` property

Controls placement precision -- the "tie threshold" for deciding whether two tracks are close enough in height to be treated as equal for item placement.

```css
.gallery {
  display: grid-lanes;
  flow-tolerance: normal;   /* resolves to 1em -- reading order when close */
  flow-tolerance: 0;        /* tightest possible packing */
  flow-tolerance: infinite; /* strict reading-order placement */
}
```

### References

- [CSS Grid Level 3 -- Editor's Draft](https://drafts.csswg.org/css-grid-3/)

---

## CSS Gap Decorations

CSS Gap Decorations enables drawing decorative rules between layout items in multi-column, flexbox, and grid containers -- extending column rules to all layout modes.

### How It Works

The spec is published as **CSS Gap Decorations Module Level 1** (`css-gaps-1`) with a Working Draft dated April 17, 2025.

Core properties: `column-rule` and `row-rule` (shorthands) plus longhands for break behavior (`rule-break`), segment offsets (`rule-inset`), visibility (`rule-visibility-items`), and overlap order (`rule-overlap`). Decorations apply to grid, flex, multicol, and grid-lanes containers.

```css
/* Gap decorations between grid items */
.dashboard {
  display: grid;
  gap: 24px;
  column-rule: 1px solid var(--border-subtle);
  row-rule: 1px solid var(--border-subtle);
  rule-break: intersection; /* rules break at item intersections */
}

/* Separator lines in a flex toolbar */
.toolbar {
  display: flex;
  gap: 8px;
  column-rule: 1px solid currentColor;
  column-rule-inset: 4px; /* offset from edges */
}
```

### Spec Decisions (January 2026 F2F)

#### `rule-break` in multi-column -- RESOLVED

`rule-break: intersection` is now **allowed** in multi-column (previously open). Default remains `none` to preserve reading order. The `none` value now draws rules **through spanners**, consistent with other layout modes.

The `column-rule-break` property accepts `none | normal | intersection`. For multi-column, `normal` means `column-rule-break` behaves as `intersection` and `row-rule-break` behaves as `none`.

#### `rule-break` in flexbox -- RESOLVED

- Alignment space **contributes to gutters** between items, but **not at edges**.
- A specific algorithm was adopted for `rule-break: intersection` along a flex line.

#### Property value updates -- RESOLVED

- `rule-break: spanning-item` **renamed to** `rule-break: normal` (three values: `none`, `normal`, `intersection`).
- `rule-inset` **initial value changed to `0`**. The `50%` inset that previously created a "meet in the middle" effect at intersections is now opt-in.

### References

- [CSS Gap Decorations Module Level 1](https://drafts.csswg.org/css-gaps-1/)

---

## CSS Module Scripts

CSS Module Scripts allow CSS to be imported as a JavaScript ES module, enabling component-scoped styles without a build step. This is a native web platform primitive, not CSS-in-JS.

### How It Works

```js
// Import CSS as a module
import styles from './component.css' with { type: 'css' };

// Use in Shadow DOM
class MyComponent extends HTMLElement {
  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.adoptedStyleSheets = [styles];
  }
}

// Declarative version (HTML)
// <script type="css-module" specifier="./component.css"></script>
```

### Status (January 2026 F2F)

Kurt Catti-Schmidt presented Declarative CSS Module Scripts to the CSSWG. Key outcomes:
- All questions raised had **already been incorporated** into the design.
- **No API changes required** from the meeting.
- Group members expressed **strong enthusiasm**.

**Status:** API stable; no blocking issues from CSSWG. Implementation can proceed against the current spec.

### Stack Relevance

Directly relevant to FAST Element components -- enables native style imports without build tooling for adoptable stylesheets.

---

## Multiple Borders and Outlines (Listified)

The group resolved to **listify both `border` and `outline` properties**, enabling multiple borders/outlines on a single element.

### Use Cases

```css
/* Contrast-safe focus ring */
.button:focus-visible {
  outline: 2px solid white, 3px solid black;
  /* Inner white + outer black = visible on any background */
}

/* Decorative double border */
.card {
  border: 1px solid var(--border-default), 4px solid var(--border-accent);
}
```

**Status:** Resolved to proceed. No spec draft yet. High developer excitement.

---

## `flex-wrap: balance`

The group resolved to pursue a mechanism for **balancing content in flexbox**, analogous to multi-column balancing.

### Use Cases

```css
/* Balanced tag cloud -- items wrap evenly across lines */
.tags {
  display: flex;
  flex-wrap: balance; /* proposed syntax */
  gap: 8px;
}

/* Instead of:
   [tag1] [tag2] [tag3] [tag4] [tag5]
   [tag6]

   You get:
   [tag1] [tag2] [tag3]
   [tag4] [tag5] [tag6]
*/
```

**Status:** Resolved to pursue. The Chromium team is investigating a performant algorithm. No spec draft yet. High developer excitement.

---

## `item-flow` Proposal -- Abandoned

Following a TAG suggestion to unify layout properties across grid/flex/etc into a single `item-flow` property set, the group explored the concept extensively. **Resolved to abandon for now** -- no naming scheme felt intuitive across all layout modes. Smaller-scale unification will be pursued instead.

---

## What to Watch

| Feature | Spec | Status | Next Milestone |
|---------|------|--------|----------------|
| Grid Lanes | [css-grid-3](https://drafts.csswg.org/css-grid-3/) | Direction syntax unresolved; alignment/margins unblocked | Outreach results then syntax decision |
| Gap Decorations | [css-gaps-1](https://drafts.csswg.org/css-gaps-1/) | WD published; flexbox + multi-column resolved | Browser intent-to-ship signals |
| CSS Module Scripts | WICG | API stable, no changes needed | Implementation in Chrome |
| Multiple borders | -- | Resolved to proceed | Initial spec draft |
| `flex-wrap: balance` | -- | Resolved to pursue | Algorithm + spec draft |

## Review Cadence

This reference should be reviewed quarterly as specs evolve and browser support changes. Next review: **2026-08-18**.
