---
"@lushly-dev/afd-client": minor
---

`StreamableHttpTransportOptions` gains `fetch`, the function every request goes through, for a host that does not trust the server and must limit what it reads: the SDK reads a response whole, and holds an event stream open with no deadline. Unset, requests use the global `fetch` as before.
