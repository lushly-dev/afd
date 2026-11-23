---
"@lushly-dev/violet-elements": patch
---

Fix two `violet-elements` bugs:

- **Forward `aria-keyshortcuts` on `violet-button` (#2252):** declare `@attr({ attribute: "aria-keyshortcuts" })` (`ariaKeyShortcuts`) on `violet-button`, bind `aria-keyshortcuts` on the inner `<button>` and sync it via `#forwardAriaAttribute` so assistive technology announces keyboard shortcuts and drops them when removed.
- **Top-layer popup panels on `violet-date-picker` and `violet-date-range-picker` (#2236):** promote both pickers' `.panel` popups to the top layer with `popover="manual"`, `showPopover()`/`hidePopover()`, `margin: 0`, `overflow: visible` and `color: inherit` so ancestors with `contain`, `transform`, `filter` or `overflow: hidden` no longer offset or clip the calendar popup while keeping existing dialog focus, Escape and outside-press handling intact.
