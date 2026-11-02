# Component checklist

From the phase 0 specification, section 2.6, and
`endpoints/loam/docs/design.md`. A kit or chrome component merges only when
its pull request shows each item.

## The checklist

- [ ] **1. Tokens only.** It references semantic tokens only;
      `lint:tokens` passes.
- [ ] **2. Every state.** It covers every state it can take: hover,
      focus-visible, active, disabled, invalid, loading.
- [ ] **3. Keyboard and ARIA.** Keyboard operation and ARIA role, name and
      state are correct.
- [ ] **4. Every theme.** It is correct in light, dark and high contrast, in
      both densities, and under forced colors.
- [ ] **5. Specimen.** It has a Specimen fixture in
      `endpoints/loam/packages/chrome/specimens/`.
- [ ] **6. Axe.** It passes axe in the Chromium suite, in all three themes.
- [ ] **7. Listed.** It has a line in `design.md`'s component list.
- [ ] **8. Reduced motion.** It follows `prefers-reduced-motion`: no motion
      beyond opacity.

## Evidence in the pull request

| Item | Evidence |
|------|----------|
| 1 | `pnpm -F @lushly-dev/loam-chrome lint:tokens` output |
| 2 | The states table of `design.md`, filled for the component, in the pull request body |
| 3 | The keys it handles and its role, name and state, with the Chromium test that checks them |
| 4 | Specimen captures in the three themes and two densities; the Chromium suite's forced-colors run |
| 5 | The fixture's path |
| 6 | The axe run per theme in the Chromium suite |
| 7 | `design.md`'s diff |
| 8 | The reduced-motion run, or the line "it does not animate" |

## Design checks before the pull request

- [ ] Every color pair it relies on is in `endpoints/loam/packages/theme/src/pairs.ts`;
      a new pair is added there in the same pull request.
- [ ] No state rests on color alone: selected has a mark and an ARIA state;
      invalid has text and `aria-invalid`.
- [ ] Focus uses `shell.size.focus` and `color.focus.ring` on
      `:focus-visible`, is not clipped, and is `Highlight` under forced
      colors.
- [ ] Anything drawn only by `box-shadow` has an `outline` or `border` under
      forced colors.
- [ ] No target is below `size.target.compact` (24px), in either density.
- [ ] Only `opacity` and color animate; no track, width, height or
      position, and no `transform` on an overlay.
- [ ] Logical properties only (`inline-start`, `inline-end`, `block-start`,
      `block-end`).
- [ ] `violet-elements` is imported by deep import, never from its root.
- [ ] Icons set `icon`, register each icon they use, are `decorative` inside
      a named control, and take a `label` when they stand alone.

## Commands

```sh
pnpm -F @lushly-dev/loam-theme theme:build     # writes dist/, which the lint reads
pnpm -F @lushly-dev/loam-theme theme:check     # contract and layout defaults against the tree
pnpm -F @lushly-dev/loam-theme test            # contrast floors, references, contract, compact targets, lint corpus
pnpm -F @lushly-dev/loam-theme -F @lushly-dev/loam-chrome lint:tokens
pnpm -F "@lushly-dev/loam-web..." build && pnpm -F @lushly-dev/loam-web test:browser   # Chromium, axe, forced colors
```

## When the theme changes

- [ ] The value changed in `src/tree/`, not in component CSS.
- [ ] `theme:check` passes; a new, removed or retyped id was regenerated
      with `theme:check --write` and the contract diff reviewed.
- [ ] `theme`'s `test` passes in all three themes.
- [ ] A changed component id's light value is matched by its literal fallback
      in `violet-elements` (the fallback scan, once step 3 lands), with
      FAST-AF provenance recorded.
- [ ] `design.md` and this skill are updated, with a dated history entry.
