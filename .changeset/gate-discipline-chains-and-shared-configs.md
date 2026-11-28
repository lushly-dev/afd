---
"lushly-botcore": patch
---

### Fixed

- **The gate-discipline quarantine check reads a test chain on past `runIf(...)` or `skipIf(...)` (#2927).** `it.runIf(key).only(...)` and `test.runIf(key).only.each(...)` now fail as a focus, and `it.skipIf(cond).concurrent.skip(...)` as an unconditional skip, through `?.` too; `test.skipIf(cond).each(...)` is still allowed.
- **The gate-discipline config check reads `passWithNoTests` in a shared Vitest module (#2942):** every root `vitest*` or `vite*` module, every module a config imports by a relative path (followed to the end), and every path given on the command line, which was read only for the CLI flag. It also refuses a computed key (`['passWithNoTests']: true`), an assignment (`config.test.passWithNoTests = true`) and a value that only starts with `false` (`false || x`); only a bare `false` passes. A module reached by a package name or path alias is not followed.
