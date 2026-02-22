# OWASP Top 10 (2025) Reference

| ID | Risk | Mitigation |
|----|------|------------|
| A01 | **Broken Access Control** | Enforce permissions on every request. Deny by default. Use random IDs. |
| A02 | **Cryptographic Failures** | Encrypt data at rest/transit. Don't check in keys. Use strong algos. |
| A03 | **Injection** | Parameterize SQL. Sanitize HTML. Validate inputs (Zod). |
| A04 | **Insecure Design** | Threat model early. Rate limit. Secure defaults. |
| A05 | **Security Misconfiguration** | Harden headers. Disable default accounts. Automate config checks. |
| A06 | **Vulnerable Components** | `pnpm audit`. Weekly updates. Remove unused deps. |
| A07 | **Auth Failures** | Multi-factor auth. Strong password policy. Secure sessions. |
| A08 | **Integrity Failures** | Sign commits. Verify CI artifacts. Use SRI. |
| A09 | **Logging Failures** | Log auth events. Centralize logs. Monitor for anomalies. |
| A10 | **SSRF** | Validate URLs. Don't make arbitrary requests from user input. |

## CWE Family Mapping

| OWASP Category | CWE Families | High-Risk Code Locations |
|---|---|---|
| Injection | CWE-89, CWE-78, CWE-94, CWE-917 | Query builders, search filters, command helpers, template engines |
| Broken Access Control / IDOR | CWE-284, CWE-285, CWE-639 | Object fetch by ID, multi-tenant filters, admin routes |
| Authn/Session Weaknesses | CWE-287, CWE-384, CWE-613 | Login flows, token minting, session cookies, password reset |
| Cryptographic Failures | CWE-327, CWE-326, CWE-321 | Token signing, encryption at rest, password hashing |
| SSRF / Unsafe URL Fetch | CWE-918 | Webhook fetchers, URL preview, doc importers, MCP URL-fetch tools |
| XSS / Output Encoding | CWE-79 | Templates, markdown renderers, admin consoles |
| Deserialization / Parsing | CWE-502 | Message consumers, import endpoints, cache deserialization |
| Security Misconfiguration | CWE-16, CWE-611 (XXE) | Default configs, debug endpoints, CORS/CSP/TLS settings |
| Sensitive Data Exposure | CWE-200, CWE-532 | Error handlers, logs, analytics, debug dumps |
