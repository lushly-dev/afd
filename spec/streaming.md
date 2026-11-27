# Streaming

Profile: `streaming`. This page belongs to the `streaming` profile of the
[contract registry](./registry.md): an implementation that does not claim the profile need not
implement it. An implementation claims it when it can run a command as a stream of chunks.

A streamed command returns its result as a sequence of `StreamChunk`s instead of one
`CommandResult`: progress while it works, data items as they are ready, and one chunk that ends
the stream. Batch and pipeline, the other two lanes, are the core's; streaming is the one
execution lane an implementation may leave out.

Every rule here is normative. **MUST**, **MUST NOT**, **SHOULD** and **MAY** are used as in
RFC 2119. The page gathers what the contract specified about streaming before it was split into a
core and profiles. The executor's own behaviour beyond the chunks (when chunks are produced, how
a deadline or a caller's cancellation ends a stream) is each language's today, as
[Implementation status](#implementation-status) records.

## Chunks

[`schema/stream.json`](./schema/stream.json) defines `StreamChunk`, and
[`wire/stream-chunks.json`](./wire/stream-chunks.json) holds one of each kind:

- A chunk is discriminated by `type`: `progress`, `data`, `complete` or `error`.
- The `index` of a `data` chunk starts at `0` and increases monotonically.
- A well-formed stream ends with exactly one `complete` chunk or one `error` chunk, and nothing
  follows it.

## Consuming a stream

`consumeStream` (and each language's counterpart) MUST treat a stream that ends without a
`complete` or `error` chunk as a failure, `STREAM_ENDED_UNEXPECTEDLY`. `collectStreamData` is
not bound by this: it returns the `data` items it saw, an empty list for an empty stream.

## Surfaces

- **The HTTP `/stream` route.** A server with AFD's HTTP routes serves
  `POST /stream/<command>` as Server-Sent Events, one `StreamChunk` per event. TypeScript refuses
  `GET` for a mutation with 405 (`METHOD_NOT_ALLOWED`, [error codes](./error-codes.md#http-layer)). The
  route runs the same confirmation, approval, scope and validation checks as a command's own
  tool ([confirmations](./confirmations.md), [authorization, M6](./authorization.md#m6-scopes)).
- **A pipeline step.** A step that asks for `stream` is refused with `UNSUPPORTED_OPTION` by an
  engine that does not stream it ([error codes](./error-codes.md#batch-and-pipeline)).

## Error codes

`STREAM_ABORTED`, `STREAM_TIMEOUT`, `STREAM_ERROR`, `STREAM_ENDED_UNEXPECTEDLY` and
`COMMAND_FAILED` ([error codes, streaming](./error-codes.md#streaming-profile-streaming)).

## Conformance

The chunk fixtures validate against `schema/stream.json` in every language that claims the
profile. The `streamCases` of [`protocol-conformance.json`](./protocol-conformance.json), which the
registry assigns to this profile, run the HTTP `/stream` route on the backends that serve it.

## Implementation status

| | TypeScript | Python | Rust | C++ |
| --- | --- | --- | --- | --- |
| Executor | Runs the command to completion, then emits chunks | Buffered `execute_stream` ([#1535](https://github.com/lushly-dev/afd/issues/1535)) | Lazy `Stream` from `execute_stream` ([#1601](https://github.com/lushly-dev/afd/issues/1601)) | Returns a vector of chunks |
| `streamCases` run on the todo backend | Yes (HTTP SSE `/stream/todo-list`) | Not exposed on the stdio todo backend | Not exposed on the stdio todo backend | Not exposed on the stdio todo backend |

The [language parity matrix](../docs/language-parity.md#batch-pipeline-and-stream) holds the
evidence for each row.
