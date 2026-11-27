---
"afd-python": minor
---

### Added

- **`afd.core.open_dispatch(context, secret=...)` lets an engine of its own give AFD middleware a command's `secret` declaration.** An engine that runs AFD middleware outside AFD's executor, such as Botcore's `CommandHost`, opens a `CommandDispatch` on the context it passes down its chain, hands the chain the continuation `dispatch.bind(next_fn)` returns (a new one each call) and closes the dispatch when the call ends (as a context manager it closes itself); `compose_middleware` passes the binding on. `create_journal_middleware` then reads the declaration as it does behind AFD's own executor: it records a non-secret call without `redact`, never records a secret one without it, passes `JournalRedactInfo(secret=True|False)` to `redact`, and keeps a secret call off a recording parent's tape. An optional `mutation` gives the retry middleware the command's `mutation` declaration; left out, it reads unknown there, so nothing is retried on a guess. A non-boolean `secret`, or a `mutation` that is neither a boolean nor `None`, raises `TypeError`; binding to a closed dispatch raises `RuntimeError`.
- **`afd.server.run_off_tape(context, next_fn)`** runs a secret call off every recording tape around it, for an engine whose own chain may hold no recorder. `create_journal_middleware`'s recorder, and a `compose_middleware` composition holding one, carry `__afd_journal__ = True`, so such an engine can tell when AFD's journal already handles a call.

### Fixed

- **A secret call left unrecorded inside nested recordings marks every enclosing tape `truncated`**, as `spec/journal.md` says, not only the innermost recorder's.
