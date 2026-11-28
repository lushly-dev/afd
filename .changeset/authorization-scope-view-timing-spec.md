---
"afd-spec": patch
---

MCP authorization (`spec/authorization.md`, M6, "Hidden commands"): a server may decide `visible` and `known` for every command when a request first needs them instead of as it arrives, still once per request and at the latest before the request is answered or a task it creates starts; a request that needs neither, such as `/health`, may never ask the resolver. Eager servers still conform, so the version stays.
