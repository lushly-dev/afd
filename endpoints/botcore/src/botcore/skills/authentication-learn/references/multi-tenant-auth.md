# Multi-Tenant Authentication

Patterns for authentication and authorization in multi-tenant SaaS applications, covering tenant discovery, isolation, SSO, and per-tenant policies.

## Core Concept

Multi-tenant authentication is a two-phase process:

1. **Identity authentication** -- Who is this user? (email/password, SSO, passkey)
2. **Tenant contextualization** -- Which organization do they belong to, and what can they do there?

A user can be a member of multiple tenants with different roles in each.

## Tenant Discovery Patterns

### Tenant-First (Subdomain/Domain)

```
acme.yourapp.com -> Tenant known before login
```

```typescript
function getTenantFromHost(req: Request): string | null {
  const host = req.hostname;
  // Subdomain: acme.yourapp.com
  const subdomain = host.split('.')[0];
  if (subdomain !== 'yourapp' && subdomain !== 'www') {
    return subdomain;
  }
  // Custom domain: app.acmecorp.com
  return customDomainMap.get(host) ?? null;
}

// Middleware: Set tenant context before auth
app.use(async (req, res, next) => {
  const tenantSlug = getTenantFromHost(req);
  if (!tenantSlug) return res.redirect('/select-organization');

  req.tenant = await tenantStore.findBySlug(tenantSlug);
  if (!req.tenant) return res.status(404).json({ error: 'Organization not found' });

  // Load tenant-specific auth config (SSO provider, MFA policy, etc.)
  req.tenantAuthConfig = await loadAuthConfig(req.tenant.id);
  next();
});
```

### Identity-First (Email Discovery)

```
yourapp.com/login -> User authenticates, then selects/discovers tenant
```

```typescript
async function discoverTenants(email: string): Promise<TenantInfo[]> {
  // Check email domain for SSO
  const domain = email.split('@')[1];
  const ssoTenant = await tenantStore.findByEmailDomain(domain);
  if (ssoTenant?.ssoRequired) {
    return [{ tenant: ssoTenant, authMethod: 'sso', redirectUrl: ssoTenant.ssoUrl }];
  }

  // Find all tenant memberships
  const memberships = await membershipStore.findByEmail(email);
  return memberships.map(m => ({
    tenant: m.tenant,
    authMethod: m.tenant.ssoRequired ? 'sso' : 'password',
    role: m.role,
  }));
}
```

### Invite-Based

```
yourapp.com/invite/abc123 -> Tenant determined by invite token
```

## Per-Tenant Authentication Policies

Each tenant can have distinct authentication requirements:

```typescript
interface TenantAuthConfig {
  tenantId: string;

  // Authentication methods
  passwordEnabled: boolean;         // Allow email/password
  ssoRequired: boolean;             // Force SSO for all users
  ssoProvider?: {
    type: 'saml' | 'oidc';
    issuer: string;
    clientId: string;
    // Secrets stored in vault, not in config
  };

  // MFA policy
  mfaRequired: boolean;
  mfaAllowedMethods: ('totp' | 'webauthn' | 'sms')[];
  mfaGracePeriod?: number;         // Days before MFA enforcement

  // Passkey policy
  passkeysEnabled: boolean;
  passkeysRequired: boolean;        // Passkey-only (no password)

  // Session policy
  sessionMaxAge: number;            // Max session lifetime (seconds)
  idleTimeout: number;              // Inactivity timeout (seconds)
  maxConcurrentSessions: number;    // Per-user session limit

  // Security controls
  ipAllowlist?: string[];           // Restrict login by IP
  domainRestriction?: string[];     // Only allow emails from these domains
  adminApprovalRequired: boolean;   // New members need admin approval
}
```

### Enforcement Example

```typescript
async function authenticateWithTenantPolicy(
  req: Request,
  credentials: Credentials
): Promise<AuthResult> {
  const config = req.tenantAuthConfig;

  // Enforce SSO
  if (config.ssoRequired && credentials.type !== 'sso') {
    return { error: 'SSO_REQUIRED', ssoUrl: config.ssoProvider.issuer };
  }

  // Enforce IP allowlist
  if (config.ipAllowlist?.length && !config.ipAllowlist.includes(req.ip)) {
    return { error: 'IP_NOT_ALLOWED' };
  }

  // Authenticate user
  const user = await authenticate(credentials);

  // Enforce MFA
  if (config.mfaRequired && !user.mfaVerified) {
    return { error: 'MFA_REQUIRED', allowedMethods: config.mfaAllowedMethods };
  }

  // Enforce domain restriction
  if (config.domainRestriction?.length) {
    const domain = user.email.split('@')[1];
    if (!config.domainRestriction.includes(domain)) {
      return { error: 'DOMAIN_NOT_ALLOWED' };
    }
  }

  // Issue tenant-scoped session
  return createTenantSession(user, req.tenant, config);
}
```

## Tenant-Scoped Tokens

Tokens must always include tenant context:

```typescript
// JWT with tenant context
{
  "sub": "user_abc123",
  "tid": "tenant_acme",          // Tenant ID
  "org_role": "admin",            // Role within this tenant
  "permissions": ["read", "write", "manage_members"],
  "sid": "session_xyz",
  "iss": "https://auth.yourapp.com",
  "aud": "https://api.yourapp.com",
  "exp": 1700003600
}
```

### Authorization Middleware

```typescript
function requireTenantPermission(permission: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { tid, permissions } = req.auth; // From JWT

    // Verify tenant matches request context
    const requestTenantId = req.params.tenantId || req.headers['x-tenant-id'];
    if (tid !== requestTenantId) {
      return res.status(403).json({ error: 'Tenant mismatch' });
    }

    // Check permission
    if (!permissions.includes(permission)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
}
```

## Data Isolation Patterns

| Pattern | Isolation | Cost | Complexity |
|---|---|---|---|
| Shared table + tenant_id column | Low | Lowest | RLS required |
| Shared DB, separate schemas | Medium | Low | Schema migration per tenant |
| Separate databases per tenant | High | High | Connection management |

### Row-Level Security (PostgreSQL)

```sql
-- Enable RLS
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- Tenant isolation policy
CREATE POLICY tenant_isolation ON documents
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Set tenant context on each request
SET app.current_tenant_id = 'tenant_acme_uuid';
```

### Middleware for Tenant Context

```typescript
app.use(async (req, res, next) => {
  const tenantId = req.auth.tid;

  // Set RLS context for all queries in this request
  await db.query("SET app.current_tenant_id = $1", [tenantId]);

  // Additional safety: Query wrapper that always includes tenant_id
  req.db = createTenantScopedClient(db, tenantId);

  next();
});
```

## Enterprise SSO Integration

### SAML 2.0

```typescript
// Configure per-tenant SAML
const samlStrategy = new SamlStrategy({
  entryPoint: tenant.ssoConfig.entryPoint,
  issuer: `https://yourapp.com/saml/${tenant.slug}`,
  callbackUrl: `https://yourapp.com/auth/saml/${tenant.slug}/callback`,
  cert: tenant.ssoConfig.idpCert,
  wantAuthnResponseSigned: true,
  wantAssertionsSigned: true,
});
```

### OIDC Federation

```typescript
// Configure per-tenant OIDC
const oidcConfig = {
  issuer: tenant.ssoConfig.issuer,   // e.g., https://login.microsoftonline.com/{tenantId}/v2.0
  clientId: tenant.ssoConfig.clientId,
  clientSecret: await vault.getSecret(`tenant/${tenant.id}/oidc_secret`),
  redirectUri: `https://yourapp.com/auth/oidc/${tenant.slug}/callback`,
  scope: 'openid profile email',
};
```

## Common Pitfalls

- **Missing tenant context in tokens** -- Every token must include `tenant_id`; never rely on URL alone
- **Cross-tenant data leakage** -- Always enforce RLS or tenant scoping at the data layer, not just middleware
- **Global auth config** -- Auth policies must be per-tenant; enterprise customers expect SSO enforcement
- **Shared session stores without namespacing** -- Namespace session keys by tenant to prevent collisions
- **Token reuse across tenants** -- Validate that JWT `tid` matches the tenant in the request context
