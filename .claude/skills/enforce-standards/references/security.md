# Security Best Practices

Security guidelines for code standards enforcement.

## Core Principles

1. **Defense in depth** -- Multiple layers of protection
2. **Least privilege** -- Minimum necessary permissions
3. **Secure defaults** -- Safe out of the box
4. **Validate all input** -- Never trust external data

## Secrets Management

### Never Commit Secrets

```bash
# .gitignore must include:
.env
.env.local
*.key
*_secret*
```

### Environment Variables

```python
# Python
API_KEY = os.environ.get("API_KEY")
```

```typescript
// TypeScript
const apiKey = process.env.API_KEY;
if (!apiKey) {
  throw new Error("API_KEY environment variable required");
}

// Never log secrets
// console.log(`Using key: ${apiKey}`);  // NEVER DO THIS
```

## Input Validation

### Sanitize All Input

```typescript
function processUserInput(input: unknown): string {
  if (typeof input !== "string") {
    throw new ValidationError("Input must be a string");
  }

  const sanitized = input.trim().slice(0, 1000); // Limit length

  if (!isValidFormat(sanitized)) {
    throw new ValidationError("Invalid input format");
  }

  return sanitized;
}
```

### SQL Injection Prevention

```python
# Use parameterized queries
cursor.execute(
    "SELECT * FROM users WHERE id = ?",
    (user_id,)
)

# Never use string interpolation in queries
# cursor.execute(f"SELECT * FROM users WHERE id = {user_id}")  # VULNERABLE
```

### XSS Prevention

```typescript
// Use textContent for text
element.textContent = userInput;

// Use sanitization libraries for HTML
import DOMPurify from "dompurify";
element.innerHTML = DOMPurify.sanitize(userInput);

// Never insert untrusted HTML directly
// element.innerHTML = userInput;  // VULNERABLE
```

## Authentication and Authorization

### Token Handling

- Use httpOnly cookies for session tokens
- Use secure, short-lived tokens with refresh
- Never store sensitive tokens in localStorage (accessible to XSS)
- Verify permissions on every request

```typescript
async function handleRequest(req: Request): Promise<Response> {
  const user = await authenticateRequest(req);

  if (!user.hasPermission("resource:read")) {
    return new Response("Forbidden", { status: 403 });
  }

  // Proceed with authorized request
}
```

## Dependency Security

```bash
# Regular security audits
npm audit
pip-audit

# Update vulnerable packages
npm audit fix
```

- Only add packages you truly need
- Prefer well-maintained, popular packages
- Review package security before adding

## Transport Security

- Always use HTTPS for external requests
- Never use HTTP for sensitive data

## Checklist

- [ ] No secrets in code or version control
- [ ] All user input validated and sanitized
- [ ] Parameterized queries for database access
- [ ] Output encoding to prevent XSS
- [ ] HTTPS for all external communications
- [ ] Dependencies audited and updated
- [ ] Authentication checked on protected routes
- [ ] Errors do not leak sensitive information
