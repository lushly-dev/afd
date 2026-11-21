---
"afd-python": patch
---

### Fixed

- **A header name or value ending in a newline is refused** (#1836): the checks used `re.match`, whose `$` also matches just before a final newline, so `-H "X: secret\n"` passed and reached the HTTP library, whose error repeats the value. They now use `fullmatch`.
- **A header's name and value are trimmed of spaces and tabs only**, as in TypeScript: `str.strip()` used to drop a trailing vertical tab or U+2028 before the character check, so it was silently removed instead of refused, and it dropped a trailing no-break space or U+0085, which HTTP allows and which belonged to the value. A line of `AFD_HEADERS` holding only a control character is now refused with its number instead of skipped.
