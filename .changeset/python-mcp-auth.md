---
"afd-python": minor
---

### Added

- **MCP HTTP authorization (`create_server(..., auth=McpAuthOptions(...))`)** verifies OAuth 2.1 bearer tokens on `streamable_http_app`, `sse_app`, and HTTP/SSE `run`/`run_async` per `spec/authorization.md` (M1–M5, M7, M8): RFC 9728 protected-resource metadata (`create_protected_resource`, `ProtectedResource`), strict M2 bearer extraction (`extract_bearer`), `JwtVerifier` (with `cryptography` for signatures only), `jwks_key_source`, `create_introspection_verifier`, frozen redacted `CommandContext.credentials` with identity-keyed `is_verified_credentials`, fail-closed transport enforcement with `server.trusted_transport()`, and principal binding on confirmations and MCP Tasks (#2154).
