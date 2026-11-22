---
"afd-spec": patch
---

[`spec/schema/`](./schema/README.md) adds JSON Schema 2020-12 definitions for `CommandError`
(`error.json`), `CommandResult` (`result.json`), the standalone MCP `outputSchema` envelope
(`output-envelope.json`), `BatchResult` (`batch.json`), `PipelineResult` (`pipeline.json`), and
`StreamChunk` (`stream.json`), with every `spec/wire/*.json` fixture and the todo conformance runner
validated against them (#1733). [`command-metadata.md`](./command-metadata.md) and every language's
`commandResultOutputSchema` now type `error` (`code`, `message`, `suggestion`, `retryable`).

[`vectors/error-codes.json`](./vectors/error-codes.json) now carries `{ code, retryable, profile }`
for every code and the reserved `hostPrefix` (`"HOST_"`), and [`error-codes.md`](./error-codes.md)
separates the 33-code core catalog from the 17-code profile catalogs and reserves `HOST_` for
host-defined codes (#1740).

[`dispatch.md`](./dispatch.md) and [`vectors/dispatch.json`](./vectors/dispatch.json) specify
single-command dispatch order and pin it with 19 shared registry and MCP vectors run across
TypeScript, Python, Rust, and C++ (#1736). Additive, so `spec/VERSION` stays.
