---
"@lushly-dev/violet-elements": minor
---

The Refined design: 54 components take their new look in their own styles. A theme's colours, radii and shadows apply as before; what changed is how each component uses them.

- **Edges are surfaces and shadows, not outlines.** Fields are wells with a hairline edge, a rule along the top and a soft inner shadow; primary and danger buttons sit one step up and go flat when pressed; cards, menus, lists, popovers and dialogs float on their surface and shadow. Borders stay in place, clear, and show again in forced colours.
- **Controls are one size on every pointer.** A fine pointer no longer drops controls to the compact target and one pixel of type; they take the natural target (32px) unless `--violet-target-size` or a coarse pointer says otherwise. The disabled controls the design touched are at half opacity.
- `violet-switch` is a slide key with a tick when on, `violet-slider` and `violet-range-slider` fill their rail to the value with the thumb in the fill colour, the open `violet-tab` and the current page of `violet-pagination` are filled keys, the chosen `violet-segment` is raised out of a well, and `violet-spinner` is a run round a rounded square (one lap a second, three under reduced motion) at 16px, 24px and 32px.
- `violet-text-field` and `violet-text-area` turn their supporting text the danger colour while `invalid`, as well as their border.
- The conversation components drop their boxes: an agent's message is the page, `violet-reasoning-block` is a line of muted text that opens, a tool call is a band with its command in the mono face, and only `violet-approval-card` is raised.

**Breaking: token interface version 2.** `tokens/interface.json` has `contractVersion` 2. It adds `font.family.heading` (`fontFamily`; a dialog's title and `violet-text` headings), `shadow.well` (`shadow`; the inner shadow of a field) and five colour ids fields now read, `color.field.background`, `color.field.background.readonly`, `color.field.text`, `color.field.placeholder` and `color.field.border.focus`. `font.family.mono` is no longer `reserved`: the tool-call card reads it. A product theme set has to supply the seven new ids; `findVioletThemeSetGaps` names the ones it lacks, and until then a component uses its fallback (the body family, the built-in light values). The built-in default theme supplies them with the values the components already rendered, so it looks the same, except that its dark preset deepens the field's inner shadow and its high-contrast preset drops it.

Three things the design left without a difference:

- `violet-slider`'s `show-fill` attribute is kept and has no effect, since the rail is always filled.
- The `quiet` and `transparent` appearances of `violet-button` and `violet-icon-button` render the same; `transparent` is kept for existing markup.
- `--violet-reasoning-border` draws a ring round the reasoning block when set, in place of the border it used to colour. It is clear by default.

Fixes for private aliases that were read and never defined, so the declaration was dropped ([#1436](https://github.com/lushly-dev/afd/issues/1436)): `violet-menu`'s panel has its floating shadow, `violet-listbox` its panel padding, `violet-snackbar` its minimum height, `violet-carousel`'s dots their 24px targets and the data grid's pill select its empty-list type size. A spec now fails when a component reads such an alias.

The built styles in `dist` no longer carry their CSS comments: `build` removes them after `tsc`, about 11.5 KB across the components. The comments stay in `src`.
