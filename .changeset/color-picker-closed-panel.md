---
"@lushly-dev/violet-elements": patch
---

`violet-color-picker`: a closed panel is no longer laid out. The base `display: grid` overrode the UA's `[popover]:not(:popover-open) { display: none }`, so the transparent panel stayed on the page and intercepted clicks meant for the trigger. `display: grid` now applies only to the open state, and the `display ... allow-discrete` transition keeps the fade.
