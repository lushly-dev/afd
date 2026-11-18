---
"@lushly-dev/violet-elements": minor
---

The built-in default theme is AFD's own, Refined, from the AFD site's design system. It was the palette the components were first drawn in, which is Lushly's; Lushly now carries that look as its own theme set. A page with no theme installed, and every literal fallback in the components, takes the new values in light, dark and high contrast.

- **Colour.** Ink on paper: the main action is ink (paper in dark), the second action a wash of ink with no outline, danger the site's red. What is chosen is mint, softer behind a tick, a switch key or a radio in light; focus is the site's blue in light and mint in dark. Messages sit on greyed tints with no outline in light and on deep opaque tints in dark. Fields go toward the base, white in light and near-black in dark.
- **Type.** `font.family.body` is `"Inter", system-ui, sans-serif`, `font.family.heading` is Space Grotesk and `font.family.mono` is IBM Plex Mono. The package does not ship the typefaces: a page that wants them loads them, and without them each stack falls back to the system's faces. Captions are 12px at the regular weight and labels 13px.
- **Shape.** `radius.sm`, `radius.md` and `radius.lg` are 4px, 8px and 12px, and the shadows are a hairline ring with a soft drop, deeper for what floats.

High contrast keeps its neutral colours, 7:1 text and spread shadows. `shadow.well` keeps its values. The token interface and every id are unchanged; only values move.
