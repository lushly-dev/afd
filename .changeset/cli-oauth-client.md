---
"@lushly-dev/afd-cli": minor
---

Add an OAuth 2.1 client (`afd auth login`, `status`, `refresh`, `logout`) implementing `spec/authorization.md` M9: RFC 9728 protected-resource and RFC 8414 / OIDC Discovery authorization-server metadata discovery, Client ID Metadata Document (CIMD) and pre-registered client flows, authorization code flow with PKCE (`S256`) and loopback redirect, separate owner-only token storage (`tokens.json`) outside `config.json` with automatic expiry refresh, and URL/header/token redaction (#912).
