---
"lushly-botcore": minor
---

### Added

- **`CommandPolicy(secret=True)` declares a command that takes or returns a secret.** With afd 0.14.0 or later, `CommandHost.execute` binds the declaration to its middleware chain with `afd.core.open_dispatch`, so AFD's journal behind the host records other calls without `redact`, never records a secret one without it, and tells a two-argument `redact` which calls are secret. A secret call runs off every recording tape around it (`afd.server.run_off_tape`), even when the host's own chain has no journal and an outer one records the call that runs it. Before afd 0.14.0 the declaration has no effect: a journal behind the host records the call unless `redact` removes the secret, and registering a secret command raises a `RuntimeWarning`. `create_host_mcp_server` declares it on the AFD command it registers (on afd 0.14.0 or later; an older `define_command` takes no `secret`) and, when AFD's journal is in the server's middleware, runs `host.execute` inside the new `botcore.host.isolated_call()`, since that journal already keeps a secret call off its parents' tapes and a redacted recording keeps its reads on its own entry; without one the host isolates the call itself. The isolation assumes one call at a time on a context: calls running concurrently on one context object can still see each other's sources (#2703); the catalog shows it. A host policy may add the declaration to a plugin's but not remove it. A non-boolean `secret` raises `TypeError`.

### Changed

- **Behaviour change: with afd 0.14.0 or later, a journal behind a `CommandHost` stops recording calls to commands that declare `secret`, unless it has `redact`.** Calls to other commands are recorded as before. Declare `secret=True` on the policy of every command that takes or returns a secret; the factory gateway's journal keeps its `redact`.
