---
"@lushly-dev/afd-core": minor
"@lushly-dev/afd-server": minor
---

Add host-verified confirmation mode (`confirmationMode: 'host-verified'`), `HumanRelay` on `createMcpServer` / `createMcpHandler`, server-private relay evidence spent once as `relay:<decisionId>` in `createApprovalMiddleware`, and `inputDigest` (with full `spec/authorization.json` `inputDigests` conformance) (#2263).
