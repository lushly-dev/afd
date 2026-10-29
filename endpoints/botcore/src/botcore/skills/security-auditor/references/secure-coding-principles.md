# Secure Coding Principles

Language-agnostic principles for evaluating code during security reviews.

## Core Principles

### 1. Least Privilege

Every component should have minimal permissions.

- Service accounts: only required scopes
- MCP tools: minimal per-tool scopes, operate under user identity
- Background jobs: restricted credentials, not admin
- File system: read-only where writes aren't needed

### 2. Explicit Trust Boundaries

Treat all input as untrusted -- including "internal" payloads.

- Service-to-service calls: validate, don't trust implicitly
- Model/tool arguments: always untrusted
- Environment variables: validate format and range
- Deserialized data: schema-validate before use

### 3. Complete Mediation

Enforce authorization at every access, not just at UI or routing boundaries.

- Check authorization on every object access (not just list endpoints)
- Re-verify on state-changing operations
- Don't rely on client-side authorization checks
- Apply at data layer, not just API layer

### 4. Secure Defaults

Deny by default; require explicit allowlists.

- CORS origins: explicit allowlist, not wildcard
- Redirect URLs: registered allowlist
- URL fetch destinations: allowlist, not blocklist alone
- Tool names/scopes: explicit grants, not implicit

### 5. Defense in Depth

Layer multiple controls -- no single control should be the only defense.

- Input validation + output encoding + WAF
- Authentication + authorization + rate limiting
- Network segmentation + egress controls + logging
- Parameterized queries + schema validation + least-privilege DB accounts

### 6. Fail Securely

Errors must not leak secrets or bypass controls.

- Catch exceptions without exposing stack traces
- Return generic error messages to clients
- Ensure partial failures don't leave resources in insecure states
- Transaction rollback on auth/validation failures

### 7. Correct Cryptography Usage

- Use well-reviewed libraries (never custom crypto)
- Ensure correct nonce/IV usage (no reuse)
- Rotate keys on schedule and on suspected compromise
- Store secrets in a secrets manager (not in code or config files)
- Use strong hashing for passwords (Argon2, bcrypt, scrypt)
- Validate TLS certificates; don't disable verification

### 8. Observability and Forensics

Log security-relevant events with enough context to investigate.

- Log: auth failures, authz denials, input validation failures, sensitive data access
- Don't log: passwords, tokens, PII, full request bodies with secrets
- Include: timestamp, user identity, action, resource, outcome, correlation ID
- Set up alerts for anomalous patterns

## Principle Application Checklist

Use during code review to verify each principle:

| Principle | Check | Pass/Fail |
|---|---|---|
| Least privilege | Are service accounts scoped to minimum required? | |
| Trust boundaries | Is all external input validated at the boundary? | |
| Complete mediation | Is authorization checked on every data access? | |
| Secure defaults | Are allowlists used instead of blocklists? | |
| Defense in depth | Are there multiple layers of controls? | |
| Fail securely | Do error paths avoid leaking sensitive data? | |
| Crypto correctness | Are standard libraries used with correct parameters? | |
| Observability | Are security events logged with context? | |

## Secure Code Patterns

### Input Validation (TypeScript -- Zod)

```typescript
import { z } from 'zod';

const UserSchema = z.object({
  email: z.string().email(),
  age: z.number().int().positive().max(120)
});

const safeData = UserSchema.parse(req.body);
```

### Output Sanitization (DOMPurify)

```typescript
import DOMPurify from 'dompurify';
element.innerHTML = DOMPurify.sanitize(userInput);
```

### Parameterized Queries

```typescript
db.query('SELECT * FROM users WHERE id = ?', [userId]);
```

### Input Validation (Python -- Pydantic)

```python
from pydantic import BaseModel, FilePath, constr

class FileReadRequest(BaseModel):
    path: FilePath
    encoding: constr(pattern=r'^(utf-8|ascii|latin-1)$') = "utf-8"
```

### Path Traversal Prevention

```python
import os
ALLOWED_DIR = "/project/src"

def safe_read(path: str) -> str:
    resolved = os.path.abspath(path)
    if not resolved.startswith(ALLOWED_DIR):
        raise ValueError("Path traversal blocked")
    return open(resolved).read()
```
