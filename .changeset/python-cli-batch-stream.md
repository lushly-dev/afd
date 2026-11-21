---
"afd-python": minor
---

### Added

- **`afd batch` and `afd stream`** in the Python CLI, with TypeScript's arguments, output and exit codes (#548). `afd batch COMMANDS` sends one `afd-batch` call from a JSON array or a `.json` file (`name` and `args` are accepted for `command` and `input`) with `-s/--stop-on-error`, `-t/--timeout` (ms, default 30000), `-p/--parallel`, `-f/--format` and `-v/--verbose`, and exits 1 when the batch fails and 2 when some commands fail. A definite refusal (a JSON-RPC error other than `-32603`, an HTTP 4xx) counts every command as failed; only a lost answer reports `OUTCOME_UNKNOWN`. `afd stream NAME [ARGS]` takes a JSON object or `key=value` pairs, with `-t/--timeout` (ms, default 60000, 0 for none), `-f/--format` (json prints one chunk per line) and `--no-progress`, and exits 1 on an error chunk and 130 on Ctrl+C or SIGTERM, after a `STREAM_CANCELLED` chunk. Both take `--server`, and `-H "Name: value"` headers with those in `AFD_HEADERS`. Text output strips terminal escape sequences from what the server sends, and error lines print server text without Rich markup.
- **`HttpStatusError` and `JsonRpcError`** (`afd.transports`), which the HTTP transport now raises, as subclasses of `TransportError` with the same messages, so a caller can tell a refusal from a lost answer. `StreamableHttpTransport.session_id` is the `Mcp-Session-Id` of a 2025 connection.

### Fixed

- **`McpClient.stream` reads streams as TypeScript's client does** (#548): lines end only at CR, LF or CRLF, so a U+2028 inside a chunk's JSON no longer splits it; events that are not stream chunks are skipped; the last chunk is always `complete` or `error`, made by the client as `STREAM_TRUNCATED`, `STREAM_TIMEOUT` (new `timeout` argument), `STREAM_CANCELLED` (new `cancel` event), `STREAM_EVENT_TOO_LARGE` (`McpClientConfig.max_stream_event_bytes`, 1 MiB) or `CONNECTION_ERROR`, each with the count of chunks before it; an HTTP refusal keeps the server's own `error` (such as `INSUFFICIENT_SCOPE` and its suggestion); and the request carries the connection's `Mcp-Session-Id`, so the stream sees the session's active context. A malformed event no longer arrives as `{"raw": ...}`.
