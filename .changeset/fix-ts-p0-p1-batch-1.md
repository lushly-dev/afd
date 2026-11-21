---
"@lushly-dev/afd-core": patch
"@lushly-dev/afd-server": patch
"@lushly-dev/afd-auth": patch
"@lushly-dev/afd-client": patch
"@lushly-dev/afd-cli": patch
---

Fix P0/P1 security, reliability, and Windows compatibility bugs across TypeScript AFD packages:

- Fail closed with `TOKEN_EXPIRED` in `createAuthMiddleware` when `afd-server`-branded credentials expire instead of falling through to the local `AuthAdapter` session, and propagate admission clock skew on the brand (#1701).
- Enforce `requiredScopes` on `GET /sse` and post-routing on `resources/*` and `skills/*` handlers (#1702).
- Guard `handler.admit()` and `handler.preDispatchCheck().decide()` against protocol-relative and malformed `req.url` values (#1703).
- Bound `$input`/variable expansion nodes, characters, and combined nesting depth in `resolveVariables()` and map limit violations to `VALIDATION_ERROR` in `executePipeline()` (#1704).
- Defer `FileJournalSink.lastSeq` assignment until `appendFile()` succeeds so failed first appends preserve unterminated/torn tail recovery (#1705).
- Translate MCP SDK `SdkHttpError` into `HttpStatusError` in `McpClient.request()` so `call()`, `batch()`, and `pipe()` classify HTTP 4xx/5xx responses accurately (#1706).
- Frame `PipelineResult` `isError` from step failures in `DirectTransport` on tool-surface registries (#1707).
- Use `cwd` and normalized separators in `findScenarioFiles()` so `afd scenario run`/`validate` work on Windows and directories with glob metacharacters (#1708).
