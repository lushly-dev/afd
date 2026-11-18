---
'@lushly-dev/afd-server': minor
---

Every tool strategy now lists the five meta-tools first, in one order: `afd-discover`, `afd-detail`, `afd-call`, `afd-batch`, `afd-pipe` (#533, `spec/tool-strategies.md`). `individual` now also lists `afd-discover` and `afd-detail`, and `grouped` adds `afd-discover`, so an agent can find the commands the unknown-command suggestion points it to. `lazy` also lists the context tools when `contexts` are set, making it the hybrid list with no first-class tools, and with contexts it keeps the default `ttlMs` (300,000) since it no longer varies by context. `createDirectToolSurface` lists the same (its default strategy stays `individual`). Clients that index tools by position should read them by name.
