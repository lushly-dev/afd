# The project switcher closes at once, so a late close event moves no focus (#2872)

- Date: 2026-11-27
- Area: every other area
- Pull request: [#2889](https://github.com/lushly-dev/afd/pull/2889), on `lush/loam-p4e9-focus-2872`, for [#2872](https://github.com/lushly-dev/afd/issues/2872)

P4-E9's override test failed 4 runs in 20 in the Loam OS session image on `random`. The cause is
in the chrome. `loam-project-list` marked itself closed, and returned focus to the switcher, only
when its popover's `toggle` event (or its compact dialog's `close` event) arrived, a task after
`hide()`. On a loaded machine that event comes late. Until it does, the list still says it is
open: a press of the switcher right after Escape only "closes" it again, and `aria-expanded`
still reads `true`. When the event lands, it moves focus back to the switcher's button, after any
focus move made in between, such as F6's. P4-E9 opens the switcher, presses Escape, calls
`shell-project-switcher`, reads a stale `aria-expanded="true"`, presses Escape again and calls
`shell-focus-next`. The late event then takes focus out of the part.

`hide()` now closes the list and returns focus at once, and the late event finds it closed.
A close by light dismiss, which only the event reports, returns focus only from where the close
left it: in the list or on no element. The dialog's `close` event reads the dialog's own state,
so a reopen before it arrives is not undone. P4-E9 also waits for `aria-expanded="false"` after
its first Escape: FAST renders the attribute a frame later, so without the wait its next `true`
could still be the first opening's (GPT-6.2 Astra's review).

Two new tests in `scope/rail.test.ts`, the rail's popover and the compact class's dialog, hold
the close event, as a loaded machine delays it, across a reopen and across F6's move. The dialog's
test models an order the HTML specification allows (`close` is queued as a task, and a reopen
does not cancel it); whether Chromium delivers it that late was not measured. Against the old
chrome, each failed 3 of 3 in a `linux/amd64` session image container, and the first, rail-only
version failed 3 of 3 on Hero (Windows); with that version's first check removed, the old chrome
left focus on no part after the late event, 3 of 3 on Hero, the issue's failure. With the dialog
guard reverted, the compact test fails 2 of 2. With the fix both pass 3 of 3 on Hero.

P4-E9 run alone 30 times (`vitest run --config vitest.browser.config.ts
test/browser/keybindings.test.ts`), 2026-11-27, with the chrome fix and P4-E9 unchanged: on Hero,
1 of 30 failed before (the issue's assertion) and 0 of 30 after; in a container from the session
image built from `b317beeb7` (`linux/amd64`, Docker Desktop on Hero, a clean clone), 0 of 30
before and 0 of 30 after. The image's `linux/arm64` build on `random`, where the issue was
measured, was not run. A second click on the open switcher reopens it, before and after: #2883.
