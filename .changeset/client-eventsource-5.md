---
'@lushly-dev/afd-client': patch
---

Update the `eventsource` dependency of the SSE transport from 4.x to 5.x. The client calls the same API (the named `EventSource` export and the `fetch` option that adds headers), so its behavior is unchanged. eventsource 5 is ESM only, declares support for Node.js 22.12 or later, and fails the connection if a single SSE line exceeds 100 MB.
