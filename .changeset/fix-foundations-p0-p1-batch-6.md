---
"@lushly-dev/specimen": patch
"@lushly-dev/violet-core": patch
---

### Security
- Confine Specimen host static file serving (`serve.rs`) by percent-decoding strictly before validating path segments and verifying `canonicalize()` containment inside the configured `staticDirs` root; symlinks pointing outside `staticDirs` are now refused while in-root aliases keep their requested MIME type (#1876).
- Reject traversal, backslash, control-character, and drive-prefixed `staticDirs[].to` mount paths in Specimen config validation and confine static directory copies and build-report writes inside `outDir`, rejecting escaping symlinks and materializing in-root links (#1877).
- Escape keys, string literals (using `\x00` for NUL), non-hex color values, comments (including nested Kotlin `/*`), reserved/colliding identifiers, and case-insensitive/Windows-reserved filenames in Violet's Tailwind, TypeScript, Kotlin, and Dart token exporters (#1878).

### Fixed
- Implement `SQLiteDatabase.transaction()` using explicit async `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` with serialized top-level execution, `AsyncLocalStorage`-backed `SAVEPOINT` serialization for nested transactions, and connection-ownership gating for ordinary database methods so outside writes and expired async contexts cannot be folded into or rolled back with another transaction (#1879).
