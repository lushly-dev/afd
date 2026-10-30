---
'@lushly-dev/violet-core': minor
'@lushly-dev/violet-cli': minor
'@lushly-dev/violet-afd': minor
---

Engine and store follow-ups ([#111](https://github.com/lushly-dev/violet/issues/111), [#114](https://github.com/lushly-dev/violet/issues/114), [#115](https://github.com/lushly-dev/violet/issues/115), [#116](https://github.com/lushly-dev/violet/issues/116)):

- `tokens.matrix` builds cells only for the rows it returns, takes `around` (with `limit`: the page holding a token) and returns `page.offset` and `page.prevCursor`. `violet matrix --around <token>`.
- `nodes.graph` lists each node's `subtractedTokens` and traces a token without describing every other token; its reads share the resolution cache.
- `node.get` takes `includeOperations` (`violet node get <id> --ops`).
- Cached include, copy and reset results keep `MAX_RESOLUTION_DEPTH`, so a deep include chain fails the same way whichever node was resolved first.
- `Database.getAuditEvents` returns events newest first and matches the same fields on memory, SQLite and Postgres.
