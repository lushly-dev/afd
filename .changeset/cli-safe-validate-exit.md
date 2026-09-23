---
'@lushly-dev/afd-cli': patch
---

Make `afd validate` safe by default and stop CLI commands hanging over SSE.

- **Behaviour change:** `afd validate` no longer executes tools. By default it checks only the `tools/list` entries: names, descriptions, input schemas, and `_meta.examples`. Pass `--execute` to call tools as before. Even then, tools marked `_meta.mutation: true` or `_meta.destructive: true` are skipped and reported per tool. Each call uses `_meta.examples[0].input` when the server provides one, otherwise `{}`.
- `connect`, `call`, `status`, `tools`, `batch`, `stream` and `validate` now exit after printing their result over SSE. The CLI disconnects its client when a command finishes, and one-shot commands no longer auto-reconnect. `shell` finishes queued input before it disconnects.
- `--category` on `validate` and `tools` (and `tools <category>` in `shell`) now matches `_meta.category`. Tools without a category match on the kebab-case `<category>-` name prefix instead of `<category>.`.
- Confidence and progress bars no longer throw `RangeError` for values outside 0–1.
