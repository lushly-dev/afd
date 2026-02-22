---
name: explore-css
source: botcore
description: >
  Tracks cutting-edge CSS features, CSSWG specifications, and browser support status. Covers emerging layout primitives (Grid Lanes, Gap Decorations, Anchor Positioning), new selectors and scoping mechanisms, adoption tiers, and progressive enhancement strategies. Use when evaluating new CSS capabilities for production readiness, planning layout strategies with emerging specs, checking browser support for modern CSS, or reviewing CSSWG decisions that affect component architecture. Triggers: modern css, new css, css features, csswg, grid lanes, masonry, gap decorations, anchor positioning, css nesting, container queries, scope, css frontier, emerging css, flex-wrap balance, view transitions, starting-style.

version: 1.0.0
triggers:
  - modern css
  - new css
  - css features
  - csswg
  - grid lanes
  - masonry
  - gap decorations
  - anchor positioning
  - css modules
  - flex-wrap balance
  - cutting edge css
  - css frontier
  - emerging css
  - container queries
  - css nesting
  - view transitions
  - starting-style
  - scope
  - css layers
portable: true
---

# Exploring CSS

Living reference for CSS features on the near-term horizon -- what is shipping, what is specced, and what is still in flight.

## Capabilities

1. Assess spec maturity and browser support for any modern CSS feature
2. Classify features into adoption tiers (Use Now, Use with Fallback, Watch and Experiment)
3. Provide fallback and progressive enhancement strategies for emerging CSS
4. Track CSSWG resolutions and their impact on component architecture
5. Guide decisions on polyfill vs. native vs. wait-for-support trade-offs
6. Supply code examples for emerging layout and styling primitives

## Routing Logic

- For in-depth spec analysis, CSSWG decisions, and code examples for pre-baseline features, see [references/css-frontier.md](references/css-frontier.md)
- For features already at Baseline 2024+, consult standard MDN documentation

## Core Principles

- **Progressive enhancement first** -- New CSS features degrade cleanly. Unknown values like `display: grid-lanes` are ignored by non-supporting browsers, so fallbacks work without parsing side effects.
- **No polyfill preference** -- Prefer CSS-native solutions over JS polyfills. Wait for native support if the polyfill is heavy or brittle.
- **Shadow DOM awareness** -- Features like `@scope` and CSS Module Scripts interact with Shadow DOM boundaries. Test in both light and shadow contexts.
- **Design token impact** -- Features like `@property` directly affect token architecture. Coordinate with the design system when adopting typed custom properties.
- **Spec status matters** -- Distinguish between resolved, working draft, and editor's draft. Do not ship features that lack stable spec text.

## Quick Reference: Feature Status

| Feature | Spec Status | Browser Support | Adoption Tier |
|---------|-------------|-----------------|---------------|
| CSS Nesting | Baseline 2024 | All major browsers | Use Now |
| `:has()` selector | Baseline 2024 | All major browsers | Use Now |
| Container Queries | Baseline 2024 | All major browsers | Use Now |
| `@layer` | Baseline 2024 | All major browsers | Use Now |
| `@property` | Baseline 2024 | All major browsers | Use Now |
| Anchor Positioning | Baseline 2025 | Chrome 125+, Firefox 131+, Safari 18.4+ | Use with Fallback |
| `@starting-style` | Baseline 2025 | Chrome 117+, Firefox 129+, Safari 17.5+ | Use with Fallback |
| View Transitions (same-doc) | Baseline 2025 | Chrome 111+, Firefox 133+, Safari 18+ | Use with Fallback |
| `@scope` | Baseline 2025 | Chrome 118+, Firefox 128+, Safari 17.4+ | Use with Fallback |
| `content-visibility` | Partial | Chrome 85+, Firefox 125+ (no Safari) | Use with Fallback |
| Scroll-driven Animations | Partial | Chrome 115+ (no Firefox/Safari stable) | Use with Fallback |
| Grid Lanes / Masonry | Editor's Draft | None | Watch and Experiment |
| Gap Decorations | Working Draft | None | Watch and Experiment |
| CSS Module Scripts | API stable | Partial (Chrome flag) | Watch and Experiment |
| Multiple borders/outlines | Resolved to proceed | None | Watch and Experiment |
| `flex-wrap: balance` | Resolved to pursue | None | Watch and Experiment |

## Workflow

1. **Identify the feature** -- Name the CSS capability under evaluation
2. **Check adoption tier** -- Consult the table above or the detailed reference
3. **Assess browser support** -- Verify against current Baseline status and caniuse data
4. **Plan implementation** -- Follow the tier strategy:
   - *Use Now*: Ship directly, no fallback required
   - *Use with Fallback*: Implement with graceful degradation for older browsers
   - *Watch and Experiment*: Prototype only; do not ship to production
5. **Review spec stability** -- For pre-baseline features, check for unresolved CSSWG issues in `references/css-frontier.md`
6. **Document decisions** -- Record which tier a feature falls into and when to re-evaluate

## Checklist

- [ ] Feature identified and located in the status table
- [ ] Adoption tier confirmed (Use Now / Use with Fallback / Watch and Experiment)
- [ ] Browser support verified against current data
- [ ] Fallback strategy documented if tier requires it
- [ ] No JS polyfills added unless CSS-native solution is unavailable
- [ ] Shadow DOM compatibility tested if feature involves scoping or module scripts
- [ ] Design token impact assessed for `@property` or custom property changes
- [ ] Review date noted for pre-baseline features (quarterly cadence)

## When to Escalate

- A pre-baseline feature is requested for production use without a fallback plan
- A CSSWG resolution changes the syntax or behavior of a feature already in use
- Browser support regresses or a feature is removed from a browser engine
- A polyfill is proposed that adds significant bundle weight or runtime cost
- Shadow DOM interaction creates unexpected style leakage or isolation failures
- The feature status table is more than one quarter out of date
