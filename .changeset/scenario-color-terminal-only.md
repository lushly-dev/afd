---
'@lushly-dev/afd-testing': patch
'@lushly-dev/afd-cli': patch
---

`afd scenario run` and afd-testing's `TerminalReporter` color human output only when it goes to a terminal, so piped or redirected output carries no ANSI codes (#909). `NO_COLOR` or `TERM=dumb` turns color off, and `FORCE_COLOR` turns it on, or off with `0` or `false`, as chalk reads it; set `FORCE_COLOR=1` to color a pipe. `--no-color` and an explicit `colors` option still win.
