# @lushly-dev/violet-elements

## Unreleased

- Let content slotted into `violet-alert`, `violet-card` and `violet-dialog` take the system colours under forced colours (#1575). Each surface opted out with `forced-color-adjust: none`, which slotted content inherited, so with a dark contrast theme its text kept the theme's dark colours on the black surface. Only what each component paints itself now opts out. `violet-toast`, `violet-snackbar` and the three conversation cards, which are drawn in a `violet-card`, keep what they paint opted out and let what is slotted into them take the system colours too.

- Make form control hosts dependable without shadow-root workarounds (#1385): one `input` event per edit, the element's own; host `focus()` reaching the control in eight controls that ignored it; `violet-checkbox` described by its supporting text and the host's `aria-describedby`; and `violet-data-grid` columns keeping their own widths with `selection-mode="none"`, with keyboard resize stepping from the column's own width.

- Fix active option rows to read the contract color.surface.subtle token in every theme (#659).

- Protect closed dialog Tab order and pointer exclusion with browser regressions, including modal and non-modal transitions and focus restoration (#511).

- Give the data-grid fill handle a 24 × 24 CSS px pointer target while retaining its visual size. Cell focus mode includes keyboard-accessible Fill down and Fill right buttons that emit the same `cell-fill` detail as dragging one row or column, with touch support and live feedback (#506).
- Type-check component specs in CI and local verify; type segment queries correctly. Stories are excluded from this check and type-checked separately by Specimen.

## 0.2.0-preview.2

### Minor Changes

- [#1529](https://github.com/lushly-dev/afd/pull/1529) [`0078d53`](https://github.com/lushly-dev/afd/commit/0078d531d545722cc89793eaf06f3d47c9d631b3) Thanks [@Falkicon](https://github.com/Falkicon)! - The built-in default theme is AFD's own, Refined, from the AFD site's design system. It was the palette the components were first drawn in, which is Lushly's; Lushly now carries that look as its own theme set. A page with no theme installed, and every literal fallback in the components, takes the new values in light, dark and high contrast.

  - **Colour.** Ink on paper: the main action is ink (paper in dark), the second action a wash of ink with no outline, danger the site's red. What is chosen is mint, softer behind a tick, a switch key or a radio in light; focus is the site's blue in light and mint in dark. Messages sit on greyed tints with no outline in light and on deep opaque tints in dark. Fields go toward the base, white in light and near-black in dark.
  - **Type.** `font.family.body` is `"Inter", system-ui, sans-serif`, `font.family.heading` is Space Grotesk and `font.family.mono` is IBM Plex Mono. The package does not ship the typefaces: a page that wants them loads them, and without them each stack falls back to the system's faces. Captions are 12px at the regular weight and labels 13px.
  - **Shape.** `radius.sm`, `radius.md` and `radius.lg` are 4px, 8px and 12px, and the shadows are a hairline ring with a soft drop, deeper for what floats.

  High contrast keeps its neutral colours, 7:1 text and spread shadows. `shadow.well` keeps its values. The token interface and every id are unchanged; only values move.

- [#1525](https://github.com/lushly-dev/afd/pull/1525) [`746d651`](https://github.com/lushly-dev/afd/commit/746d651be1361635f31cfbe098e4eca73e14ae2d) Thanks [@Falkicon](https://github.com/Falkicon)! - The Refined design: 54 components take their new look in their own styles. A theme's colours, radii and shadows apply as before; what changed is how each component uses them.

  - **Edges are surfaces and shadows, not outlines.** Fields are wells with a hairline edge, a rule along the top and a soft inner shadow; primary and danger buttons sit one step up and go flat when pressed; cards, menus, lists, popovers and dialogs float on their surface and shadow. Borders stay in place, clear, and show again in forced colours.
  - **Controls are one size on every pointer.** A fine pointer no longer drops controls to the compact target and one pixel of type; they take the natural target (32px) unless `--violet-target-size` or a coarse pointer says otherwise. The disabled controls the design touched are at half opacity.
  - `violet-switch` is a slide key with a tick when on, `violet-slider` and `violet-range-slider` fill their rail to the value with the thumb in the fill colour, the open `violet-tab` (which keeps its selection line, inside the key) and the current page of `violet-pagination` are filled keys, the chosen `violet-segment` is raised out of a well, and `violet-spinner` is a run round a rounded square (one lap a second, three under reduced motion) at 16px, 24px and 32px.
  - `violet-text-field` and `violet-text-area` turn their supporting text the danger colour while `invalid`, as well as their border.
  - The conversation components drop their boxes: an agent's message is the page, `violet-reasoning-block` is a line of muted text that opens, a tool call is a band with its command in the mono face, and only `violet-approval-card` is raised.

  **Breaking: token interface version 2.** `tokens/interface.json` has `contractVersion` 2. It adds `font.family.heading` (`fontFamily`; a dialog's title and `violet-text` headings), `shadow.well` (`shadow`; the inner shadow of a field) and five colour ids fields now read, `color.field.background`, `color.field.background.readonly`, `color.field.text`, `color.field.placeholder` and `color.field.border.focus`. `font.family.mono` is no longer `reserved`: the tool-call card reads it. A product theme set has to supply the seven new ids (on the preview line this ships as a minor, so a caret range takes it: theme-set owners should add the ids before upgrading); `findVioletThemeSetGaps` names the ones it lacks, and until then a component uses its fallback (the body family, the built-in light values). The built-in default theme supplies them with the values the components already rendered, so it looks the same, except that its dark preset deepens the field's inner shadow and its high-contrast preset drops it.

  Three things the design left without a difference:

  - `violet-slider`'s `show-fill` attribute is kept and has no effect, since the rail is always filled.
  - The `quiet` and `transparent` appearances of `violet-button` and `violet-icon-button` render the same; `transparent` is kept for existing markup.
  - `--violet-reasoning-border` draws a ring round the reasoning block when set, in place of the border it used to colour. It is clear by default.

  Fixes for private aliases that were read and never defined, so the declaration was dropped ([#1436](https://github.com/lushly-dev/afd/issues/1436)): `violet-menu`'s panel has its floating shadow, `violet-listbox` its panel padding, `violet-snackbar` its minimum height, `violet-carousel`'s dots their 24px targets and the data grid's pill select its empty-list type size. A spec now fails when a component reads such an alias.

  The built styles in `dist` no longer carry their CSS comments: `build` removes them after `tsc`, about 11.5 KB across the components. The comments stay in `src`.

### Patch Changes

- [#1441](https://github.com/lushly-dev/afd/pull/1441) [`bbc4e42`](https://github.com/lushly-dev/afd/commit/bbc4e4287e9e0c701e74d87789bfc13d4e39085f) Thanks [@Falkicon](https://github.com/Falkicon)! - Give the data-grid fill handle a 24px pointer target without enlarging its visual, and include accessible Fill down and Fill right actions for mouse, touch and keyboard users.

- [#1460](https://github.com/lushly-dev/afd/pull/1460) [`247111a`](https://github.com/lushly-dev/afd/commit/247111aa5d6b507be322ea202c32b4e5168125ab) Thanks [@Falkicon](https://github.com/Falkicon)! - Use the contract surface token for active options so dark-theme text stays readable.

- [#1528](https://github.com/lushly-dev/afd/pull/1528) [`312b0e0`](https://github.com/lushly-dev/afd/commit/312b0e0f83618403d01cb3e1cbc6b7de84149bef) Thanks [@Falkicon](https://github.com/Falkicon)! - Form controls behave as an application expects from the host element, so the shadow-root workarounds applications carried can go ([#1385](https://github.com/lushly-dev/afd/issues/1385)).

  - **One `input` event per edit.** `violet-text-field`, `violet-text-area`, `violet-date-picker`, `violet-time-picker`, `violet-slider`, `violet-range-slider`, `violet-color-picker` and `violet-combobox` no longer let the inner control's native `input` event escape the shadow root. A host listener now receives one event per edit, the element's own `CustomEvent` with the value in `detail`. Before, it also received the native `InputEvent`, without `detail`; a listener that read `inputType`, `data` or `isComposing` from it no longer gets them, and one that skipped events without `detail` is unaffected. `violet-color-picker` fires `input` only when its colour changes.
  - **`focus()` on the host reaches the control** for `violet-date-picker`, `violet-time-picker`, `violet-date-range-picker`, `violet-slider`, `violet-range-slider`, `violet-color-picker`, `violet-file-upload` (its browse button) and `violet-segmented-control` (its checked segment, or the first enabled one). Before, it did nothing. A failed form submission now also focuses the file upload's browse button, not its hidden file input, and the segmented control's Tab stop.
  - **`violet-checkbox` is described by its supporting text** and by the ids in the host's `aria-describedby`, which are resolved across the shadow boundary, as `violet-text-field` already does, including a target that appears later once the checkbox takes focus.
  - **`violet-data-grid` with `selection-mode="none"` gives each column its own width.** Its hidden selection column and its spacer rows still made a column slot that no visible cell filled, so each cell sat one slot to the left and took the wider of its own width and its left neighbour's. With the slot gone, narrow columns stretch to fill the grid, as they already did with selection on. The keyboard column resize now steps from the column's own width when it is in `px` or `rem`, not its stretched width, so each arrow press moves it by exactly one step.

- [#1413](https://github.com/lushly-dev/afd/pull/1413) [`fdcd24b`](https://github.com/lushly-dev/afd/commit/fdcd24b8554361b7cfe08272ecd92d00ae2abc93) Thanks [@Falkicon](https://github.com/Falkicon)! - `violet-select` shows the chosen option's label, and names its trigger with it, when the options arrive after `value` is set, when they are added inside a `violet-option-group`, and when the chosen option's label changes. Before, the trigger kept showing the raw value ([#499](https://github.com/lushly-dev/afd/issues/499)).

- [#1427](https://github.com/lushly-dev/afd/pull/1427) [`4e34fab`](https://github.com/lushly-dev/afd/commit/4e34fabaaadf6399267c69c027793b2310b4c974) Thanks [@Falkicon](https://github.com/Falkicon)! - `violet-switch`'s native `role="switch"` input now fills the whole control shell instead of being clipped to nothing, so it receives pointer events: `getByRole('switch', { name }).click()` toggles it in Playwright without `force`, and a click on the track toggles it exactly once ([#501](https://github.com/lushly-dev/afd/issues/501)). The track and thumb pass pointer events through, so a `violet-switch::part(control):hover` rule no longer matches (use `violet-switch:hover::part(control)`), and the hit area now spans the control's full target height, not only the track. Keyboard, label, disabled, form and focus-ring behaviour are unchanged.

## 0.2.0-preview.1

### Patch Changes

- [#1340](https://github.com/lushly-dev/afd/pull/1340) [`44ae808`](https://github.com/lushly-dev/afd/commit/44ae808a9796a724c0c91d7fb1e081a635ed30ab) Thanks [@Falkicon](https://github.com/Falkicon)! - `violet-data-grid`'s `selection-label` description fits the pack's 240-character limit, so briefs now carry it ([#1149](https://github.com/lushly-dev/afd/issues/1149)). The radio group's overview story puts the group back after its form check, so the pack observes the group's `required` attribute ([#1150](https://github.com/lushly-dev/afd/issues/1150)).

## 0.2.0-preview.0

### Minor Changes

- [#515](https://github.com/lushly-dev/afd/pull/515) [`72c833c`](https://github.com/lushly-dev/afd/commit/72c833c1dd300ee63f7a4c0710071b782786aaf5) Thanks [@Falkicon](https://github.com/Falkicon)! - Upstream the repairs Lushly and Violet carried on top of `violet-elements` ([#221](https://github.com/lushly-dev/afd/issues/221)).

  - Add `"./dist/*"` to `exports` so per-element imports such as `@lushly-dev/violet-elements/dist/button/violet-button.js` resolve, and check it against the packed tarball with `pnpm --dir packages/violet-elements verify:exports`.
  - Embed sources in the shipped JavaScript source maps (`inlineSources`) and stop emitting declaration maps, so Vite and Vitest no longer warn about maps that point at an unpacked `src`.
  - Pad `violet-segment` and size it to match a button's height at every target size.
  - `violet-button`: add a `danger` appearance backed by new `--color-action-danger-{background,text,hover,pressed}` tokens, and forward `aria-pressed` to the native button.
  - `violet-data-grid`: add an optional `selection-label` that names what a single-selection radio does (for example "Open First bed"), and a `selection-header-cell` part.
  - `violet-dialog`: keep every animation state transform-free so `position: fixed` descendants keep viewport coordinates.
  - `violet-text-field`: forward an `inputmode` attribute to the native input.
  - `violet-gantt`: guard the repeat bindings against a queued update that arrives after teardown.

- [#515](https://github.com/lushly-dev/afd/pull/515) [`72c833c`](https://github.com/lushly-dev/afd/commit/72c833c1dd300ee63f7a4c0710071b782786aaf5) Thanks [@Falkicon](https://github.com/Falkicon)! - `violet-message-media` now shows its generic file row (filename and type) when a remote image fails to load, and gains an opt-in `allowed-origins` attribute: when set, sources that are not relative, same-origin, `data:` or `blob:` and whose origin is not listed are never requested and render the file row instead. Without the attribute, behaviour is unchanged.

- [#1266](https://github.com/lushly-dev/afd/pull/1266) [`c39db09`](https://github.com/lushly-dev/afd/commit/c39db09ac4defe75264cb47e11ae485e16bc6491) Thanks [@Falkicon](https://github.com/Falkicon)! - Make ARIA references reach their targets across shadow roots.

  - `violet-button`: `aria-labelledby`, `aria-describedby`, `aria-errormessage` and `aria-controls` are now host attributes as well as properties. Their ids are found in the host's tree and set on the inner button as element references, so they resolve; `aria-description` is forwarded.
  - `violet-tooltip`: describes its trigger with `aria-description` (from `content`) or by adding the slotted content's ids to the trigger's `aria-describedby`, keeping the trigger's own ids, instead of overwriting it with an id inside the tooltip's shadow root.
  - `violet-menu` and `violet-teaching-tip`: where shadow roots support Reference Target, the trigger's `aria-controls` names the host (given an id if it has none) and reaches the panel; elsewhere `aria-controls` is left off instead of naming an unreachable id.

- [#1195](https://github.com/lushly-dev/afd/pull/1195) [`fd0781e`](https://github.com/lushly-dev/afd/commit/fd0781e468a9f69851bb54e227aa85efa4b008a2) Thanks [@Falkicon](https://github.com/Falkicon)! - Products can bring their own Violet theme. `tokens/interface.json` (`@lushly-dev/violet-elements/tokens/interface.json`) lists every custom property the components read, by token id, with its type and a `contractVersion`. `installVioletThemeSet({ defaultPreset, presets })` installs a product's complete theme set as data, with its own preset names, on the document and any `[data-violet-theme-root]`, in place of the built-in default, which is then never written; `findVioletThemeSetGaps(set, tokenInterface)` returns `{ problems, missing, complete }` for a product's build, from the new Node-safe, side-effect-free `@lushly-dev/violet-elements/theme-css` entry. The runtime loads the built-in set's values only when it installs them, with a dynamic import. The components read their typeface from the new `font.family.body` token (`--font-family-body`); the data grid and its pickers use it instead of IBM Plex Sans, and autosize measures with the grid host's font when no cell is rendered. `font.family.mono` is reserved.

  Breaking: `normalizeVioletThemePreset`, `applyVioletThemePreset` and `applyVioletThemeRoot` throw a `RangeError` for a preset name the installed set lacks instead of mapping it to `light`, `getVioletThemePreset` returns the attribute as written, `VioletThemePreset` is now `string` (the built-in names are `VioletBuiltInThemePreset`), and `installVioletTheme()` writes the built-in stylesheet once its module has loaded (`await loadVioletBuiltInTheme()`) rather than synchronously.

### Patch Changes

- [#515](https://github.com/lushly-dev/afd/pull/515) [`72c833c`](https://github.com/lushly-dev/afd/commit/72c833c1dd300ee63f7a4c0710071b782786aaf5) Thanks [@Falkicon](https://github.com/Falkicon)! - `violet-color-picker`: a closed panel is no longer laid out. The base `display: grid` overrode the UA's `[popover]:not(:popover-open) { display: none }`, so the transparent panel stayed on the page and intercepted clicks meant for the trigger. `display: grid` now applies only to the open state, and the `display ... allow-discrete` transition keeps the fade.

- [#1246](https://github.com/lushly-dev/afd/pull/1246) [`eaa3901`](https://github.com/lushly-dev/afd/commit/eaa3901205230c996c4e1ae089c0d98b63df5014) Thanks [@Falkicon](https://github.com/Falkicon)! - Fix nine component bugs. Some change behaviour:

  - `violet-toast` closes itself after `timeout` whether or not it is `dismissible`; set `timeout="0"` to keep it open.
  - `violet-color-picker` restores its starting value on form reset instead of emptying it.
  - `violet-date-picker` and `violet-date-range-picker` no longer fire `open-change` when they connect.
  - `violet-range-slider` thumbs are named by `label` followed by `label-start` or `label-end`.
  - `violet-segmented-control` is invalid when `invalid` is set, even with a value.
  - `violet-option` honours `hidden`, and disabling a `violet-option-group` after it renders now disables its options.
  - `violet-tooltip` shows again on hover after Escape closes it.
  - Progress, badge, alert, toast and snackbar tones have light-theme colours without `installVioletTheme()`.

- [#1041](https://github.com/lushly-dev/afd/pull/1041) [`481ce43`](https://github.com/lushly-dev/afd/commit/481ce43a20534e77cb60b3506aa92ebf5ab93e31) Thanks [@Falkicon](https://github.com/Falkicon)! - `custom-elements.json` now describes `violet-combobox`, `violet-listbox`, `violet-option`, `violet-option-group`, `violet-persona` and `violet-select`, which it gave no text, with their slots, events and parts. The attribute taxonomy's `allowed-origins` definition is shorter, so it fits a 240-character guide rule. The package's repository also carries guides for 46 components and a component pack built from them with Specimen; neither is in the published files.

- [#1277](https://github.com/lushly-dev/afd/pull/1277) [`d9ec83d`](https://github.com/lushly-dev/afd/commit/d9ec83df3b1f926499389351d7ad4c4be0d68407) Thanks [@Falkicon](https://github.com/Falkicon)! - The custom elements manifest writes out literal-union type aliases, so an attribute typed `VioletButtonAppearance` reads `"primary" | "secondary" | "quiet" | "transparent" | "danger"`. Tools that read the manifest, and the component pack, now see each such attribute's allowed values (about 40 attributes, including `violet-button`'s `appearance` and `violet-tabs`' `appearance` and `orientation`).
