---
'@lushly-dev/afd-server': minor
---

Every tool strategy now lists the five meta-tools first, in one order: `afd-discover`, `afd-detail`, `afd-call`, `afd-batch`, `afd-pipe` (#533, `spec/tool-strategies.md`). `individual` and `grouped` add `afd-discover` (and `individual` `afd-detail`), so an agent can find the commands the unknown-command suggestion points it to; `lazy` also lists the context tools when `contexts` are set, making it the hybrid list with no first-class tools. `createDirectToolSurface` lists the same. Clients that index tools by position should read them by name.
