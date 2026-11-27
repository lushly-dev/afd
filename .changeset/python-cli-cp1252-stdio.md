---
"afd-python": patch
---

### Fixed

- **`afd batch` and `afd stream`** (`afd.cli`): reconfigure `sys.stdout` and `sys.stderr` to UTF-8 with replacement on CLI entry (`afd.cli.terminal.configure_stdio`) so Unicode status symbols, progress bars, and non-ASCII output do not raise `UnicodeEncodeError` on a `cp1252` Windows console ([#2816](https://github.com/lushly-dev/afd/issues/2816)).
