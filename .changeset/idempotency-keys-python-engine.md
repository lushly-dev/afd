---
"afd-python": minor
---

### Added

- **Idempotency keys in the engine (`spec/idempotency.md`, [#2955](https://github.com/lushly-dev/afd/issues/2955)).** A command declares `idempotency="natural"` or `"keyed"` on `CommandDefinition`, `define_command`, `@server.command` and `SimpleRegistry`; it is reported in the tool's `_meta.idempotency`, by `afd-detail` and by `afd-help` (`full`), and `natural` sets the MCP annotation `idempotentHint`. A call's key travels in `_meta["dev.afd/idempotencyKey"]`, in a meta-tool's `meta` argument or on `CommandContext.idempotency_key`; its form is checked before any confirmation, middleware or handler (`VALIDATION_ERROR`), each batch item and pipeline step runs under a derived key (`<key>:<i>`, `<key>:step:<i>`), and a command a handler runs through the registry starts without it.
- **The idempotency step.** `create_server(idempotency=IdempotencyOptions(store=..., ttl_ms=..., lease_ms=...))`, and `create_idempotency_step(...)` for `create_command_registry` and `SimpleRegistry`, answer a repeat of a `keyed` call that carries the same key and input from a store, between the approval admission check and the handler: the stored result with `metadata.idempotentReplay`, `IDEMPOTENCY_IN_PROGRESS` while the first runs, `IDEMPOTENCY_KEY_REUSED` for another input, or `OUTCOME_UNKNOWN` when nobody can say whether the first was applied. The engine cancels a handler at the call's deadline, and that leaves the outcome unknown at once. `InMemoryIdempotencyStore` is the default; a host may supply an `IdempotencyStore`, plain or `async`. Over HTTP the step acts only where the server can tell its callers apart (`auth`, or a `context_hook` with `callers_identified_by_hook`); a stdio caller that, as middleware leaves it, has no credentials and no actor but a bare agent or the server's default keeps its keys in its connection's own store.
- **The client side.** `afd call --idempotency-key <key>`, `McpClient.call(..., idempotency_key=...)` (also `call_tool`, `batch` and `pipe`) and `DirectCallContext(idempotency_key=...)`. The built-in transports' `call_tool` take `meta`, sent as the request's `_meta`.
- **The journal records the key** as `idempotencyKey` (a derived key as derived), hashes it as a member of the context digest, and `replay_journal` restores it.
- **`afd validate --surface` notes an undeclared mutation** (`missing-idempotency`, info).
- **The meta-tools' `meta` argument description names `dev.afd/idempotencyKey`**, as `spec/meta-tools.json` now does.

### Changed

- **The retry middleware follows R1's whole order:** a `natural` command is repeated, a `keyed` one only when the call carries a key (and is not an MCP task run), and any other command unless it declares `mutation=True`. `retry_mutations=True` still restores retrying every command.
- **A `TIMEOUT` the engine gives a call whose key the step reserved** carries `recovery: {"kind": "retry"}` and says to repeat the call with the same key.
- **`idempotency_key` and `idempotencyKey` are reserved context field names.**
