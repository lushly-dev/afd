---
"afd-spec": patch
---

Tasks (`spec/tasks.md`, the `tasks` profile): a `TaskStore` may define `get_for(id, owner, caller)`, which the server calls for `tasks/get`, `tasks/update` and `tasks/cancel` with the context of the caller's request, so a host's store can refuse a caller by a check of its own (such as whether it may still read the task's space), answered as an unknown task (#3011). Optional, with `get` as its default, and every check the server already ran still runs, so the `tasks` profile stays at 1.0 and the core `VERSION` stays.
