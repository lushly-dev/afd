---
'@lushly-dev/afd-core': minor
'@lushly-dev/afd-server': patch
---

`ErrorCodes` in `@lushly-dev/afd-core` now holds the 42-code shared catalog of `spec/error-codes.md`. It adds 20 codes that the engines already emitted without a constant: `COMMAND_NOT_EXPOSED`, `COMMAND_NOT_IN_CONTEXT`, `COMMAND_NOT_ALLOWED`, `UNKNOWN_TOOL`, `AMBIGUOUS_ACTION`, `INVALID_GROUPED_CALL`, `SESSION_REQUIRED`, `CONTEXT_NOT_FOUND`, `CONTEXT_DEPTH_EXCEEDED`, `INVALID_BATCH_REQUEST`, `BATCH_TIMEOUT`, `COMMAND_SKIPPED`, `INVALID_PIPELINE_REQUEST`, `PIPELINE_TIMEOUT`, `UNSUPPORTED_OPTION`, `STREAM_ABORTED`, `STREAM_TIMEOUT`, `STREAM_ERROR`, `STREAM_ENDED_UNEXPECTEDLY` and `COMMAND_FAILED`. Python, Rust and C++ define the same catalog. The spec also lists each code's meaning, whether it is retryable and which layer emits it, plus the transport-specific codes of the HTTP layer and the client.

`@lushly-dev/afd-server`: the tool router no longer has an `afd-call` branch that answered `COMMAND_NOT_EXPOSED`. `createMcpServer` never reached it, and a remote caller always gets `COMMAND_NOT_FOUND` for a command it cannot see, as `spec/error-codes.md` requires.
