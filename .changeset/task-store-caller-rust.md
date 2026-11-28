---
"afd-rust": minor
---

### Added

- **`TaskStore::get_for(id, owner, caller)`** (#3011): for a `tasks/get`, `tasks/update` or `tasks/cancel` request the server now asks the store with the caller's `CommandContext`: the actor the owner binding was made from, the verified credentials (put back after the context hook, as on `tools/call`, so a hook cannot change what the store sees) and whatever else the hook set, so a host's store can apply a check of its own to that caller, such as whether it may still read the task's space, and return `None` to refuse, which the server answers as an unknown task. The default calls `get`, so existing stores are unchanged; `Arc<T>` forwards it.
