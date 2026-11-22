---
"@lushly-dev/violet-afd": minor
"@lushly-dev/violet-core": minor
---

Violet's commands gain what Violet in Loam's first slice needs (#1322 to #1328):

- `export.tree` writes a tree as DTCG files, one per node with only its own tokens, the inverse of `import.tree`: reading the files back resolves the same, and exporting again gives the same files. A token whose id runs on from another's is written as a dotted key. It refuses subtract, reset and copy operations, which a file cannot hold, and lists in `dropped` the settings the files leave out. `import.tree` reads a node's `includePolicy` (#1322).
- `interface.check` checks every id of a component interface, such as `violet-elements`' `tokens/interface.json`, resolves in each theme node to a value its type can hold (#1323).
- Writes take their clock and ids from the command context's optional `now()` and `random()`, so a replayed run writes the same records; `import.json` operation ids are now random ids rather than built from the node, token and time (#1324).
- `token.add`, `token.override`, `import.json` and `import.tree` refuse, with `INVALID_TOKEN_VALUE`, a value its type cannot hold safely in CSS; an override is held to the type of the token it overrides. A typed value must be of its kind (a real colour keyword, not any word; a number only for a number, or 0 for a length), and may use `calc()`, `clamp()`, `var()`, `oklch()`, `color-mix()` and the like. Braces inside a longer string are refused, since only a whole-value alias is followed. The CSS and SCSS exports check every token again and refuse an id that cannot be a CSS name; a composite value is still written as JSON once its keys and leaves are safe. `import.tree` checks every file, and that no node it would create exists, before it creates any. `checkCssTokenValue` and `checkCssToken` are exported from `@lushly-dev/violet-core/css` (#1325).
- Contrast rules composite a translucent colour before measuring. A translucent background needs a `backdrop` token, the opaque surface under it; without one the rule warns instead of measuring (#1326).
- A constraint takes `disabledReason` beside `enabled`, stored by every store (SQLite and Postgres add the column on open), and `constraints.validate` lists disabled rules with their reasons (#1327).
- `token.remove` removes a node's own operation by id, or all of them on a token, the undo of `token.add`, refusing while another node still changes, copies, includes or references the token. New operations take one past the highest sequence, so none repeats after a removal (#1328).
