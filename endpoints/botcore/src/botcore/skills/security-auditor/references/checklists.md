# Manual Review Checklists

Structured checklists for manual security review of web applications and MCP servers.

## Web Application Review Checklist

### System Context (Fill In First)

- **Service/module:**
- **Entry points (routes/handlers/jobs):**
- **Data stores touched:**
- **AuthN method(s):**
- **AuthZ model (roles/scopes/tenancy):**
- **Sensitive data classes:**
- **External dependencies/integrations:**

### Authentication and Session Management

- [ ] MFA supported where required
- [ ] Session cookies: Secure, HttpOnly, SameSite flags set and scoped correctly
- [ ] Token validation checks issuer, audience, and expiry
- [ ] Password reset and recovery flows are abuse-resistant (rate-limited, tokens expire)
- [ ] No session fixation vulnerabilities
- [ ] Token rotation on privilege changes

### Authorization

- [ ] Object-level checks enforced everywhere (list, export, download, background jobs)
- [ ] Tenant scoping enforced at query level (not post-filtered)
- [ ] Admin actions protected server-side (not UI-only)
- [ ] Role/scope checks in middleware, not just route decorators
- [ ] No IDOR vulnerabilities on direct object references

### Input Handling

- [ ] Validation at trust boundaries (API layer) with strict schemas
- [ ] Allowlists for high-risk parameters (sort fields, filters, URLs, file paths)
- [ ] File uploads validated by content (not only extension/MIME)
- [ ] No string concatenation in SQL, command, or template construction
- [ ] JSON/XML parsing hardened (no XXE, no unsafe deserialization)

### Output Handling

- [ ] Output encoding is contextual (HTML/JS/URL/CSS)
- [ ] Error messages sanitized (no stack traces, no secrets, no internal paths)
- [ ] Logs are structured and redacted (no PII, no tokens)
- [ ] Content Security Policy headers set
- [ ] X-Content-Type-Options: nosniff

### SSRF and Network Safety

- [ ] URL fetches constrained by allowlists
- [ ] Private IP ranges blocked (10.x, 172.16-31.x, 169.254.x, 127.x)
- [ ] Cloud metadata endpoints blocked
- [ ] Redirect following validated
- [ ] Timeouts and response size limits enforced

### Cryptography and Secrets

- [ ] Secrets stored outside code and rotated on schedule
- [ ] Crypto libraries are standard and used correctly
- [ ] Tokens signed with protected keys and rotated
- [ ] Password hashing uses Argon2, bcrypt, or scrypt
- [ ] TLS configured correctly; no certificate validation bypasses

### Business Logic and Abuse Controls

- [ ] Rate limits on login, password reset, OTP, search, export
- [ ] Anti-automation controls where needed (CAPTCHA, progressive delays)
- [ ] Idempotency and replay protections for critical actions
- [ ] Workflow state transitions validated server-side

### Observability

- [ ] Authorization failures logged with context
- [ ] Audit trail for sensitive reads/writes
- [ ] Alerts defined for anomalous access patterns
- [ ] Incident response runbook references available

## MCP Server Review Checklist

### Tool Inventory

For each tool, document:

| Tool name | Read/Write | Data sensitivity | Blast radius | Required scopes |
|---|---|---|---|---|

### Authorization Model

- [ ] Per-tool authorization enforced server-side on every call
- [ ] User identity propagated to tool execution (not shared service account)
- [ ] Tenant isolation mechanism verified for each tool
- [ ] Write tools require elevated authorization

### Argument Schema Validation

- [ ] JSON schema enforced for all tool arguments
- [ ] Allowlists for file paths, URLs, repository names
- [ ] No "free-form command" fields (or flagged as high-risk)
- [ ] Path traversal prevention (canonicalization, base directory checks)

### Egress and SSRF Protections

- [ ] URL-fetching tools constrained by allowlist
- [ ] Private IP ranges and metadata endpoints blocked
- [ ] DNS pinning applied where feasible
- [ ] Timeouts and response size limits enforced
- [ ] Internal network access boundaries documented and enforced

### Logging

- [ ] Correlation IDs from MCP session to tool execution
- [ ] Every tool call logged with: identity, tool, argument hash, status, time
- [ ] PII/secrets redacted in logs
- [ ] Retention and tamper-evidence policies defined

### Human-in-the-Loop Controls

- [ ] Approval required for destructive/high-impact actions
- [ ] Confirmation prompts enforced outside the model (server-side)
- [ ] Rate limiting on tool calls per session and per user
- [ ] Circuit breakers for runaway agent loops

## Review Worksheet Template

Use this for each code module reviewed:

```markdown
## Module: [Name]

**Reviewer:** [Name]
**Date:** [Date]
**Commit:** [Hash]

### Findings

| ID | Severity | Category | Description | File:Line | Fix |
|---|---|---|---|---|---|

### Controls Verified

- [ ] [Control 1] -- Status
- [ ] [Control 2] -- Status

### Notes / Open Questions

-
```
