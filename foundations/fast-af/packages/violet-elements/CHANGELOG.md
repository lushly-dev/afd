# @lushly-dev/violet-elements

## Unreleased

- Protect closed dialog Tab order and pointer exclusion with browser regressions, including modal and non-modal transitions and focus restoration (#511).

- Give the data-grid fill handle a 24 × 24 CSS px pointer target while retaining its visual size. Cell focus mode includes keyboard-accessible Fill down and Fill right buttons that emit the same `cell-fill` detail as dragging one row or column, with touch support and live feedback (#506).

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
