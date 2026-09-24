---
'@lushly-dev/afd-client': minor
---

Make `McpClient.stream()` end honestly and parse server-sent events per the spec.

Behavior changes:

- **A stream always ends with a `complete` or `error` chunk.** A stream that closes without one now yields a `STREAM_TRUNCATED` error chunk (`retryable: false`) instead of ending silently like a success. `[DONE]` without a `complete` chunk counts as truncated.
- **A stream's own `timeout` is reported as `STREAM_TIMEOUT`** (`retryable: true`), no longer as `STREAM_CANCELLED`. Aborting `options.signal` is still `STREAM_CANCELLED`.
- **`stream()` refuses to run before `connect()`**: it yields one `NOT_CONNECTED` error chunk and sends nothing.
- **`disconnect()` aborts active streams**, which end with `STREAM_CANCELLED`.
- **The stream URL keeps the base path**: `<base>/stream/<command>`, where `<base>` is the client URL without a trailing `/sse`, `/message` or `/messages` (the Python client's rule). `https://host/api/mcp/sse` used to stream from `https://host/stream/<command>`.
- **One event is bounded** by the new `maxStreamEventSize` option (default 1 MiB); a larger event ends the stream with `STREAM_EVENT_TOO_LARGE` instead of buffering without limit. Parsing is linear in the stream size (the line buffer is no longer re-scanned on every read).
- **SSE parsing follows the spec**: `data:` without a space, multi-line `data` fields (joined with `\n`), comments, and CR/CRLF line endings. Events that are not stream chunks are skipped.
- An HTTP error whose body is an AFD failure (such as the server's `METHOD_NOT_ALLOWED`) is passed through as the error chunk.

The built-in SSE handoff handler (`sseHandler` with credentials) uses the same parser, so its messages now follow the same rules, and an oversized event reports `SseEventTooLargeError` through `onError` and disconnects.
