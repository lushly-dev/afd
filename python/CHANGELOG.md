# Changelog

All notable changes to the Python `afd` package are documented here. The package is versioned independently of the npm packages and the other implementations, is published to [PyPI](https://pypi.org/project/afd/), and is released with tags of the form `python-vX.Y.Z`.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0, a minor release may break the API.

## [0.9.0] - Unreleased

> **Draft: not released.** `pyproject.toml` and `afd.__version__` still read 0.8.0, and 0.8.0 on PyPI still writes snake_case results. 0.9.0 waits for the in-flight Python fixes, starting with [#304](https://github.com/lushly-dev/afd/pull/304) (single-command dispatch and exception redaction). Add their entries to this section as they merge.
>
> **Release checklist**
>
> 1. The Python fixes planned for 0.9.0, including #304, are merged and listed here.
> 2. Set the version to `0.9.0` in `python/pyproject.toml` and `__version__` in `python/src/afd/__init__.py`.
> 3. Run `uv lock` in `python/`, `alfred/` and `packages/examples/todo/backends/python/`. All three lockfiles record the `afd` version, and `python.yml` runs `uv lock --check`.
> 4. Replace "Unreleased" above with the release date, delete this note, add an empty `## [Unreleased]` section above it, and point the `[0.9.0]` link at `python-v0.9.0`.
> 5. Update the Python column of the version row in `docs/language-parity.md`.
> 6. Merge, then the maintainer tags `python-v0.9.0`. The `do-release` skill has the steps.

### Breaking changes

- **Wire format:** results use the cross-language format checked by `spec/wire/*.json`: camelCase keys, unset fields omitted rather than `null`, and MCP `isError: true` on failures. Parsing still accepts snake_case. Error `details` keys are camelCase (`expectedFields`, `missingFields`, …). The built-in command payloads (`afd-schema`, `afd-help`, `afd-docs`, `afd-context-list`, `afd-detail`) use the wire format too (#250, #251).
- **Pipeline variables** follow `spec/pipeline-variables.md`, as in every language. `$input` is the request's own `input` field and never the host or caller context; `$`-prefixed literals such as `$9.99` pass through; `$$` escapes; paths follow only own JSON keys and in-bounds indices; unresolved references are omitted; `$eq`/`$ne` compare structurally; nesting deeper than 64 is rejected with `VALIDATION_ERROR`. DirectClient `$alias` references become `$steps.alias` (#250).
- **Security:** pipeline and DirectClient `$ref` paths follow only dict keys and list indices, never attributes or `_`-prefixed names. Previously any MCP client could read server process globals and environment through `afd-pipe` (#232).
- **Security:** `afd-help`, `afd-docs`, `afd-schema`, `afd-detail` and `afd-call` only see MCP-exposed commands. `afd-call` on a command that is not exposed returns `COMMAND_NOT_FOUND` (#232).
- **Security:** handler exceptions are logged to the `afd.server` logger and returned as "An internal error occurred" unless the new `create_server(dev_mode=True)` is set. Invalid input returns `VALIDATION_ERROR` with structured details (#232).
- **Dependencies:** the extras depend on `mcp>=1.19,<2` directly instead of the unused `fastmcp`, drop the unused `httpx-sse`, and require `websockets>=14`. `afd[cli]` includes the client transports (#232).
- **Unsupported options fail instead of being ignored:** a pipeline with `parallel: true`, or a step with `stream: true`, fails that step with `UNSUPPORTED_OPTION` and skips every other step before any command runs. `stream: false` is still accepted. `BatchOptions` and `PipelineOptions` reject unknown fields (#225, #253).
- **Batches and pipelines** coerce every item to a `CommandResult` (`INVALID_COMMAND_RESULT` for a plain dict), reject built-in tools as steps, and cap size and parallelism (`max_batch_size=500`, `max_batch_parallelism=16`) (#251).
- **Handoff:** the client sends the token as an `Authorization: Bearer` header instead of a query parameter. `ReconnectingHandoffConnection` passes the session to its reconnect command as `sessionId`, the wire name TypeScript uses, instead of `session_id`; the `ReconnectionOptions.session_id` attribute is unchanged, but a reconnect command that read `session_id` must read `sessionId` (#251, #253).
- **Retry middleware:** `create_retry_middleware()` backs off exponentially with a cap and jitter, like TypeScript, instead of linearly: retry `n` waits `min(max_delay, retry_delay * 2 ** (n - 1))` ms, randomized to between half and all of that. Invalid options (a negative or non-integer `max_retries`, a negative `retry_delay` or `max_delay`, an infinite `max_delay`) raise `ValueError`, as in TypeScript (#253).

### Added

- `max_delay` (default 5000) and `jitter` (default `True`) keyword arguments for `create_retry_middleware()` (#253).
- `DirectClient`'s `PipelineStep` has a `stream` field, so dict and typed steps are checked the same way (#253).
- `AFD_META_TOOL_NAMES`, `AFD_BOOTSTRAP_COMMAND_NAMES`, `AFD_CONTEXT_COMMAND_NAMES`, `AFD_BUILTIN_TOOL_NAMES` and `is_afd_builtin_name`, exported from `afd` (`afd.core.builtin_names`), with the same names as the other languages (#292).
- The similarity helpers in `afd.core.similarity` (#279).
- CI: `python.yml` runs pytest on Python 3.10–3.12, bug-class ruff rules, `uv lock --check`, and a clean-venv install smoke test for each extra (#234).

### Changed

- The MCP server's `afd-batch` honors `parallelism`, `timeout` and `stopOnError`, and preserves result order. Pipelines enforce `timeout_ms` with `PIPELINE_TIMEOUT`, and an exception in a step becomes `COMMAND_EXECUTION_ERROR` (#225).
- A missing or mistyped MCP argument returns a structured `VALIDATION_ERROR`. `McpClient` keeps TypeScript failure details and all result fields, and posts to `/message`. Server telemetry goes to stderr (#250).
- Fuzzy "did you mean" matching and echoed unknown names follow TypeScript's `similarity.ts`, counting UTF-16 code units (an emoji is two). A name over 128 units gets no suggestions instead of being matched on a truncated prefix. Echoed names are cut at 128 units plus `…` and never split a surrogate pair. `afd-detail` uses the same matcher and suggestion text as TypeScript (up to three close matches) instead of `difflib` (#232, #279).
- `exec_command()` defaults to a 5-minute timeout. `afd connect` accepts only http(s) URLs or `mock` (#251).

### Fixed

- A base `pip install afd` imports again: MCP client exports load lazily, and `afd --help` no longer needs pytest (#232).
- There is a single `CommandError` class, so `failure(not_found_error(...))`, DirectClient error paths, and `afd-batch` timeout/`stopOnError` return results instead of raising `ValidationError`. Serialized output is unchanged (#232).
- The `scenario-evaluate` command honors its documented `concurrency` and `timeout` options and reports each scenario's file path (#234).
- **Security:** `scenario-create` and `scenario-evaluate` stay inside the project root (symlinks included), sanitize scenario names, and only read `*.scenario.yaml`/`*.scenario.yml` files (#251).
- Batches cancel in-flight siblings when they stop, and malformed pipeline conditions are rejected up front (#251).
- The handoff client reads WebSocket and SSE connections in the background, and `ReconnectingHandoffConnection` cleans up its tasks on `close()` (#251).
- `exec_command()` and the testing `CliWrapper` kill and reap child processes when the caller is cancelled. The rate limiter evicts expired windows and tracks at most `max_keys` keys. Blind excepts now log, and a crashing `SimpleRegistry` handler is `COMMAND_EXECUTION_ERROR` (#251).
- `afd validate --surface` validates a server's commands, not its tools, when the server does not list `afd-help`/`afd-schema` (for example a TypeScript server). Grouped tools are expanded from `_meta.actions`, lazy servers are enumerated with `afd-discover` and `afd-detail`, and AFD's built-in tools are skipped. The HTTP transport keeps `_meta` in `tools/list` (#292).

## [0.8.0] - 2026-07-07

### Added
- `AFDLinter` calibration options: `exclude_story_test_files` (default on) skips story/test files for the UI-directory rules, and `rule_path_excludes` provides per-rule, separator-normalized path excludes (#193)
- `afd-no-direct-fetch` accuracy: comment-line matches and `fetch('data:...')` string-literal loads no longer flag; new line-scoped `afd-lint-disable: <reason>` inline suppression directive (reason required) (#193)
- `LintResult` suppression reporting: `suppressed_total`, `suppressed_by_rule`, `suppressed_by_reason`, and `suppressed_summary()` (#193)
- Dedicated linter test suite (`python/tests/test_linters.py`) (#193)

## [0.7.0] - 2026-04-03

### Added
- Python AFD functional parity for framework-agnostic, agent-visible features:
  - first-class command metadata for output schemas, prerequisites, contexts, validated examples, and explicit grouping categories
  - server tool strategies for `individual`, `grouped`, and `lazy` discovery, including `afd-call`, `afd-batch`, `afd-pipe`, `afd-discover`, and `afd-detail`
  - context bootstrap commands (`afd-context-list`, `afd-context-enter`, `afd-context-exit`) plus context-aware discovery and actionable stale-call errors
  - richer bootstrap surfaces in `afd-help`, `afd-docs`, and `afd-schema`, plus Python surface-validation support for missing output schemas and missing configured contexts

### Changed
- Documented the Python parity target as functional AFD parity across framework-agnostic capabilities and agent-visible behavior, with language-specific APIs allowed to differ when that better fits the host language
- Updated AFD skill guidance to keep parity decisions aligned across TypeScript, Python, and Rust implementations
- Clarified that Changesets cover released `@lushly-dev/*` npm packages, while Python-only work follows the separate PyPI release flow

## [0.6.0], [0.3.0] and [0.2.0]

These were released together with the repository-wide releases of the same period, and their notes are in the [changelog archive](../docs/changelog-archive.md): 0.6.0 under 0.6.0 (2026-03-13), 0.3.0 under 0.3.0 (2026-02-27, the Python–TypeScript parity work), and 0.2.0 under 0.2.0-beta (2026-02-20, the Python DirectClient and `pipe()`). There were no Python 0.4.0 or 0.5.0 releases.

## [0.1.2] - 2026-01-13

### Added

- **Automated PyPI Publishing** - GitHub Actions workflow with OIDC Trusted Publishing
  - No API tokens needed — uses GitHub OIDC for authentication
  - Triggers on `python-v*` tag push or GitHub Release
  - Version validation ensures tag matches `pyproject.toml`
  - Full test suite runs before publish

### Changed

- Workflow file: `.github/workflows/publish-python.yml`
- Requires GitHub Environment `pypi` for deployment protection

## [0.1.1] - 2026-01-13

### Added

- **`suggestions` field** - Added `suggestions: Optional[List[str]]` to `CommandResult` and `success()` helper
  - Enables helpful next-step hints for users (e.g., "Use lora.activate to enable this LoRA")
  - Discovered via Noisett dogfooding - their commands relied on this UX pattern

### Changed

- Published to PyPI: `pip install afd>=0.1.1`

[0.9.0]: https://github.com/lushly-dev/afd/compare/python-v0.8.0...main
[0.8.0]: https://github.com/lushly-dev/afd/compare/python-v0.7.0...python-v0.8.0
[0.7.0]: https://github.com/lushly-dev/afd/compare/python-v0.6.0...python-v0.7.0
[0.6.0]: https://github.com/lushly-dev/afd/compare/python-v0.3.0...python-v0.6.0
[0.3.0]: https://github.com/lushly-dev/afd/compare/python-v0.2.0...python-v0.3.0
[0.2.0]: https://github.com/lushly-dev/afd/compare/python-v0.1.2...python-v0.2.0
[0.1.2]: https://github.com/lushly-dev/afd/tree/python-v0.1.2
