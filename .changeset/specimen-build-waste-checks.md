---
"@lushly-dev/specimen": minor
"@lushly-dev/specimen-afd": patch
---

The static build no longer fails on the accessibility engine's size or the bench's total (#1072). axe-core 4.14.0 alone was over the proposal's 650,000-byte accessibility ceiling, so legitimate dependency growth could fail every build. The build now fails on waste, by a named cause, listed in `specimen-build.json`'s new `waste`: `duplicated-module` (one module in two chunks), `duplicated-package` (one version of a package from two installs), `multiple-versions` (a package at two versions outside interaction support), `eager-accessibility` (axe-core in a chunk every case loads, such as one a plugin or retained preview imports) and `total-tripwire` (the total past 2,700,000 bytes, about twice what the bench measures). Accessibility checks still fail a story as before.

- `specimen-build.json`: `categories.accessibility` has no `budget`; `total` has `tripwire` in place of `budget`; new `waste`, `advisories` (`multiple-versions` the helpers' own ranges force, as Testing Library's split two packages, reported only) and `modules` (each module's chunk, category, `renderedBytes` and package, with machine-independent ids). A wrapper that printed `total.budget` or each category's `budget` reads `total.tripwire`, and finds no `budget` on accessibility.
- `buildSizeDeltas(before, after)` and `TOTAL_TRIPWIRE` are exported: the first lists how each module moved between two builds' reports, largest first and matched across a package's versions, as advice that never fails. `specimen-build`'s description and suggestion in `@lushly-dev/specimen-afd` point at `waste`.
- The shell (70,000), interaction support (615,000) and stylesheet (8,000) ceilings are unchanged.
