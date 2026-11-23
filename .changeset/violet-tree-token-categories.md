---
"@lushly-dev/violet-afd": patch
---

Preserve non-derivable Violet token categories (`spacing`, `radius`, `z-index`, `typography` on `dimension` tokens, etc.) in token-level `$extensions["dev.lushly.violet"].category` during `export.tree` and restore them in `import.tree` / `import.json`, so `export.tree` no longer drops them and `tokens.catalog --category` keeps working after a DTCG round-trip (#1974).
