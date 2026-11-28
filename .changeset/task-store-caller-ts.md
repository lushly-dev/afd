---
"@lushly-dev/afd-server": minor
---

`TaskStore` gains an optional `getFor(id, owner, caller)` (#3011): for a `tasks/get`, `tasks/update` or `tasks/cancel` request the server calls it, when a store defines it, with the caller's `CommandContext`: a request-local copy of the actor the owner binding was made from, the verified credentials and the context hook's values, so a host's store can apply a check of its own to that caller, such as whether it may still read the task's space, and resolve `undefined` to refuse, which the server answers as an unknown task. Without it the server calls `get` as before.
