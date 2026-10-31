---
"@lushly-dev/afd-server": minor
"@lushly-dev/afd-core": minor
---

Add declared context fields (`spec/context-fields.md`). `createMcpServer`, `createMcpHandler` and `createDirectRegistry` take `contextFields`: each field's context name, `_meta` key, Zod schema, and optional `journal` and `required` flags. Declarations are checked when the server or registry is created (reserved names, reverse-DNS `meta` keys, duplicates). A call's value is validated before middleware runs, replaced by the schema's output, and an invalid or missing required value fails the call with `VALIDATION_ERROR` naming the field; `afd-*` commands do not enforce `required`.

The journal keeps fields declared `journal: true` in a new optional `context` entry field, or names them in `contextOmitted` when a value exceeds 4096 bytes of canonical JSON, and `replayJournal` restores them, noting fields the target no longer declares. `createContextDigest` takes those values as an optional second argument; an entry without them hashes as before. `JournalEntry` gains the two optional fields, and the server and registry expose `contextFields`.
