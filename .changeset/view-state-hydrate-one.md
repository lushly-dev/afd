---
"@lushly-dev/afd-view-state": minor
---

Add `ViewStateRegistry.hydrateOne(id)`: the same read as `hydrate()` for one registered ID, through `adapter.get(table, id)`, so a handler registered after boot gets its persisted state without `hydrate()` writing over what the other handlers hold in memory. An unregistered ID reads nothing. A missing record, or one in another category, leaves the handler as it is, and an adapter error is logged as `hydrate()` logs it. Await it before any `set` or `replace` on that ID: a change made first is lost in memory while its scheduled write still reaches the adapter.
