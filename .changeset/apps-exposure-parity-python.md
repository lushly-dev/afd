---
"afd-python": minor
---

### Added

- **App-to-app calls and `ExposeOptions.apps` parity** (`spec/command-metadata.md`, "App-to-app calls"; Loam phase 5 step 0b; #1513): `ExposeOptions.apps` (default `False`), `CallGrant`, `call_not_granted()`, `create_command_registry(call_grant=...)`, `create_server(..., call_grant=...)`, `list_by_exposure("apps")` on core `CommandRegistry`, `DirectCommandRegistry` refusing `interface="apps"`, and grant-checked `replay_journal` on `CommandRegistry` and `MCPServer`. `tests/test_app_calls_vectors.py` now runs and passes every case of `spec/vectors/app-calls.json`.
