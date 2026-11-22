---
"@lushly-dev/violet-elements": patch
---

Neutralize dark theme chrome surfaces and secondary text (keeping mint for active selection and status accents), and constrain `violet-text-field` / `violet-text-area` internal grid tracks (`minmax(0, 1fr)` and `min-inline-size: 0`) so fields shrink cleanly inside narrow multi-column CSS grids without overflowing.
