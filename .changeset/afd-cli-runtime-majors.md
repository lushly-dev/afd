---
'@lushly-dev/afd-cli': patch
---

`@lushly-dev/afd-cli` moves its runtime dependencies to their current majors: `commander` 15, `chalk` 6, `conf` 16, `glob` 14 and `ora` 10. Each requires Node 22 or later (`commander` 22.12.0), which the CLI already requires, and none changes a command, flag or output. The saved configuration stays at the same path, so existing connections carry over. `setConfig()` no longer accepts `undefined` as a value in its types; Conf already threw on it at runtime, and `deleteConfig()` clears a value.
