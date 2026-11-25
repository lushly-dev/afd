---
"afd-spec": patch
---

Specified M9 (the OAuth 2.1 CLI client) in `spec/authorization.md` and added language-neutral client conformance cases in `spec/authorization-client.json`, covering RFC 9728 and RFC 8414/OIDC discovery, Client ID Metadata Documents and pre-registration, PKCE S256 with a loopback redirect and RFC 9207 issuer checks, separate owner-only token storage with expiry refresh, and URL/header credential redaction (#912).
