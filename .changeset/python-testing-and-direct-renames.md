---
"afd-python": minor
---

### Changed

- **Direct-client dataclasses renamed to stop colliding with `afd.core`** (`DirectContext`, `DirectCommandDefinition`, `DirectCommandParameter`, `DirectPipelineStep`, `DirectPipelineStepResult`, `DirectPipelineResult`), with module `__getattr__` deprecation warnings on the old names in `afd`, `afd.direct`, and `afd.direct_pipeline` for one minor release (#1758).
- **`afd.transports`** loads transport implementations lazily so `afd.testing` installs and imports cleanly with only `afd[testing]` (without `httpx` or `mcp`), and `from afd import *` succeeds on a base install. The lazy `client`-extra names (`McpClient`, `McpClientConfig`, `ClientStatus`, `TaskInfo`, `DetailedTask`, `TaskProgressCallback`, `create_client`, `ElicitationHandler`, `ElicitationRequest`, `ElicitationResponse`) are no longer in `afd.__all__` and stay reachable via explicit/attribute import (#1758).

### Fixed

- **Python scenario runner (`afd.testing.scenarios`)** now matches TypeScript's `data` assertions: lists containing objects are matched item by item on named fields, mixed or mistyped matchers are rejected at parse and evaluation time with `InvalidExpectationError`, and deep equality no longer treats `bool` values as `int` (#2428).
