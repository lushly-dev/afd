---
'@lushly-dev/afd-testing': patch
'@lushly-dev/afd-cli': patch
---

`afd scenario run` and afd-testing's `TerminalReporter` color human output only when it goes to a terminal, so piped or redirected output carries no ANSI codes (#909). `NO_COLOR` turns color off; `FORCE_COLOR` turns it on, or off with `0` or `false`. `--no-color` and an explicit `colors` option still win.
