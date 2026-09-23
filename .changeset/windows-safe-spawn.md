---
'@lushly-dev/afd-core': patch
'@lushly-dev/afd-testing': patch
---

Fix Windows command injection in `exec()` and the testing `CliWrapper`. Neither spawns with `shell: true` any more. On Windows, `.exe` commands run directly, and `.cmd`/`.bat` shims such as `npm` run through `cmd.exe` with every argument escaped (a cross-spawn-style `prepareSpawn()` helper, exported from `@lushly-dev/afd-core/platform`). `GitHubConnector` now passes `--flag=value` arguments. `PackageManagerConnector` rejects invalid package and script names with a `SPAWN_FAILED` result. `exec()` now decodes output as a UTF-8 stream, so multibyte characters split across chunks stay intact.
