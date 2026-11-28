---
"afd-python": minor
---

### Added

- **A task store's optional `get_for(task_id, owner, caller)`** (#3011): for a `tasks/get`, `tasks/update` or `tasks/cancel` request the server calls it, when a store defines it, with the caller's `CommandContext`: a copy of the actor the owner binding was made from, the `afd.server.Credentials` the server verified (`None` on a transport without them, or when only the MCP SDK verified the token) and what the context hook set, so a host's store can apply a check of its own to that caller, such as whether it may still read the task's space, and return `None` to refuse, which the server answers as an unknown task. Without it the server calls `get` as before.
