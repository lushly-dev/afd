# Phase 5 step 10, P5-B2's Chromium half (#2720)

- Date: 2026-11-27
- Area: phase 5, bus, copilot and mounted servers
- Pull request: [#3015](https://github.com/lushly-dev/afd/pull/3015), on `lush/loam-events-changed-chromium`, for [#2720](https://github.com/lushly-dev/afd/issues/2720)

Added `packages/web/test/browser/apps/bus.test.ts`, P5-B2's Chromium half: the bus reaching an
app's surfaces in the built shell. Mail's native app does not hold `events` yet, so the suite
writes two fixture apps of its own that do, and serves them only to itself: `busfix`, native,
whose main element reads the head when it connects and, on each `eventsChanged(hint)`, catches up
with `context.events.list({ since })`; and `busview`, a view, whose frame hears
`ui/notifications/host-context-changed` with `dev.loam/eventsChanged` and catches up with
`event-list` through its own `tools/call` (its handlers are `test/browser/pages/bus-handlers.ts`).
Each fixture hears exactly one hint after its own mutation, naming `app-mutated` and its instance,
with the cursor the catch-up then reaches. The catch-up returns that one event. After hello's
mutation, which the person's workspace stream shows projected, neither fixture hears anything,
and a catch-up from its cursor returns nothing. No shipped bundle changes, so D115's budgets are
untouched.

Verified 2026-11-27 on Node 26 (Windows) with
`pnpm exec vitest run --config vitest.browser.config.ts test/browser/apps/bus.test.ts` against
the built shell: both tests pass. Following `maintain-gates`, both were also seen to fail against
two changes planted in the built `dist` and then reverted. With the chrome's `deliverEvents` not
calling `eventsChanged`, no hint arrives. With `canSeeEvent` letting an app see every
`app-mutated` event, a second hint arrives for hello's mutation. After the two reviews, each
negative check is followed by a second mutation of the fixture's own, which must be the second
hint it hears and name only itself. A full local `pnpm verify` did not complete
(its run ended without a report); Linux CI is the authoritative run.

Left open: mail's native app adopting `events` (9.4, 9.2's consumer) would let this suite
use the real consumer instead of a fixture; no issue is filed for that, since mail's step owns it.
