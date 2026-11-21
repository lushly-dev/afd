---
"afd-python": patch
---

### Fixed

- **A header's name and value are trimmed of spaces and tabs only** (#1836), as in TypeScript: `str.strip()` used to drop a trailing vertical tab or U+2028 before the character check, so it was silently removed instead of refused, and it dropped a trailing no-break space or U+0085, which HTTP allows and which belonged to the value.
