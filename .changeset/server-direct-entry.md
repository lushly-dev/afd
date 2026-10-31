---
"@lushly-dev/afd-server": minor
---

Add the `@lushly-dev/afd-server/direct` entry point, for hosts that run commands in their own process: a browser app, a web worker, a webview, or a Node.js host that does not want the MCP SDK. It exports everything `/define` does, plus `createDirectRegistry`, `createJournalMiddleware`, `replayJournal`, `MemoryJournalSink` and the middleware with no Node.js builtin in its module graph (`composeMiddleware`, `defaultMiddleware`, and the logging, timing, retry, tracing, trace ID, rate limit and telemetry middleware). It loads neither the MCP SDK nor any Node.js builtin; a test bundles it for the browser and holds AFD's own code to a size budget. The root entry still exports all of it.
