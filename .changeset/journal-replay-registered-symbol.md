---
'@lushly-dev/afd-server': patch
---

`JOURNAL_REPLAY` is now a registered symbol, `Symbol.for('@lushly-dev/afd-server/journal-replay')` (#441), so separately loaded copies of afd-server agree on the replay marker. A globally installed `afd replay` no longer makes a project's own journal middleware re-record the replayed calls. `afd replay` still prefers the module's own afd-server copy, as a fallback for older versions.
