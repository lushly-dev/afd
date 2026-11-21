---
"afd-python": patch
---

### Security

- **`afd.testing` scenario commands and `McpTestingServer`** now enforce project-root confinement across all five scenario tools (`scenario-list`, `scenario-evaluate`, `scenario-coverage`, `scenario-create`, `scenario-suggest`) and use the resolved paths returned by `resolve_inside`, preventing path traversal and `cwd != os.getcwd()` sandbox escapes. Direct Python callers of `scenario_list`, `scenario_coverage_cmd`, and `scenario_suggest` can pass the new `root=` keyword argument when targeting directories outside the current working directory (#1709).

### Fixed

- **`CliWrapper._build_args`** emits valid `afd --json call <tool> [args] [--server <url>]` flags accepted by the Python `afd` CLI (#1710).
- **`McpTestingServer.handle_request`** validates JSON-RPC request shape and returns `-32600` (`INVALID_REQUEST`) on non-object messages or missing/non-string `method` instead of crashing (#1711).
- **`_HttpBasedTransport`** ignores `"error": null`, formats non-object `error` values, wraps non-JSON or non-object HTTP 200 bodies in `TransportError`, and raises `TransportError` on malformed `initialize` or `tools/list` results (#1712).
- **`assert_has_sources`** validates dict-based source entries with `Source.model_validate` (defaulting `type` to `"unknown"` when absent) and preserves all `Source` fields including camelCase wire aliases (#1713).
- **`execute_discover` (`afd-discover`)** validates input object and field types, rejects malformed `limit`/`offset` values with `VALIDATION_ERROR`, and clamps `limit: 0` to `1` instead of falling back to `50` (#1714).
- **`PackageManagerConnector.list_deps`** supports `pnpm list --json --depth=0` JSON array output across single- and multi-project workspaces (#1715).
