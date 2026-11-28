---
"@lushly-dev/afd-server": patch
---

Pin `@modelcontextprotocol/server` (`~2.4.0`) and `@modelcontextprotocol/node` (`~2.1.2`) to tilde ranges and fail loudly when patched SDK internals (`Server.connect` / `transport.onmessage`, `Server._ondiscover`, `Server._wrapHandler`) are missing (#1744).
