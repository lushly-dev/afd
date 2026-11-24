---
"afd-python": patch
---

### Fixed

- **Scenario suggestion assertions** (`afd.testing.scenarios`): `expect.error.suggestion` is now read and checked, as the TypeScript runner does: a string the suggestion must contain, or an assertion matcher. The parser used to drop it, so a scenario that asserted a suggestion passed without the suggestion being checked. A suggestion matcher is as strict as TypeScript's: every key must be a matcher key (a typo beside a real matcher is refused, not ignored) and each value must suit its matcher. `{equals: ...}` is now a matcher in Python too, as it is in TypeScript.
