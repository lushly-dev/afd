---
"@lushly-dev/violet-elements": patch
---

`violet-switch`'s native `role="switch"` input now covers the control above the decorative track and is no longer clipped, so it receives pointer events: `getByRole('switch', { name }).click()` toggles it in Playwright without `force`, and a click on the track toggles it exactly once ([#501](https://github.com/lushly-dev/afd/issues/501)). The track and thumb pass pointer events through. Keyboard, label, disabled, form and focus-ring behaviour are unchanged.
