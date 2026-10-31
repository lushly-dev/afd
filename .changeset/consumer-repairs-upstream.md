---
"@lushly-dev/violet-elements": minor
---

Upstream the repairs Lushly and Violet carried on top of `violet-elements` (#221).

- Add `"./dist/*"` to `exports` so per-element imports such as `@lushly-dev/violet-elements/dist/button/violet-button.js` resolve, and check it against the packed tarball with `pnpm --dir packages/violet-elements verify:exports`.
- Embed sources in the shipped JavaScript source maps (`inlineSources`) and stop emitting declaration maps, so Vite and Vitest no longer warn about maps that point at an unpacked `src`.
- Pad `violet-segment` and size it to match a button's height at every target size.
- `violet-button`: add a `danger` appearance backed by new `--color-action-danger-{background,text,hover,pressed}` tokens, and forward `aria-pressed` to the native button.
- `violet-data-grid`: add an optional `selection-label` that names what a single-selection radio does (for example "Open First bed"), and a `selection-header-cell` part.
- `violet-dialog`: keep every animation state transform-free so `position: fixed` descendants keep viewport coordinates.
- `violet-text-field`: forward an `inputmode` attribute to the native input.
- `violet-gantt`: guard the repeat bindings against a queued update that arrives after teardown.
