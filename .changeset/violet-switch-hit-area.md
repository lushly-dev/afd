---
"@lushly-dev/violet-elements": patch
---

`violet-switch`'s native `role="switch"` input now fills the whole control shell instead of being clipped to nothing, so it receives pointer events: `getByRole('switch', { name }).click()` toggles it in Playwright without `force`, and a click on the track toggles it exactly once ([#501](https://github.com/lushly-dev/afd/issues/501)). The track and thumb pass pointer events through, so a `violet-switch::part(control):hover` rule no longer matches (use `violet-switch:hover::part(control)`), and the hit area now spans the control's full target height, not only the track. Keyboard, label, disabled, form and focus-ring behaviour are unchanged.
