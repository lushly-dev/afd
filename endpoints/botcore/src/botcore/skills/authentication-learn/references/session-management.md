# Session Management

Strategies for JWTs, server sessions, hybrid approaches, token rotation, and secure cookie configuration.

## JWT vs Server Sessions

| Aspect | JWT | Server Session |
|---|---|---|
| State | Stateless (self-contained) | Stateful (server-side store) |
| Scalability | No shared state needed | Requires session store (Redis, DB) |
| Revocation | Difficult (need blocklist) | Immediate (delete from store) |
| Size | Larger (payload in token) | Small (session ID only) |
| Validation | Local (verify signature) | Remote (lookup in store) |
| Best for | Microservices, APIs, M2M | Web apps, admin panels, high-security |

## Hybrid Approach (Recommended)

Combine JWTs for fast validation with server sessions for control:

```typescript
// Login: Issue both session token and short-lived JWT
async function login(user: User): Promise<AuthTokens> {
  // Server session for revocation control
  const sessionId = crypto.randomUUID();
  await sessionStore.create(sessionId, {
    userId: user.id,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    metadata: { ip: req.ip, userAgent: req.headers['user-agent'] },
  });

  // Short-lived JWT for fast API validation
  const accessToken = jwt.sign(
    { sub: user.id, sid: sessionId, roles: user.roles },
    JWT_SECRET,
    { expiresIn: '15m', algorithm: 'RS256' }
  );

  // Long-lived refresh token bound to session
  const refreshToken = crypto.randomBytes(32).toString('base64url');
  await sessionStore.setRefreshToken(sessionId, {
    token: hashToken(refreshToken),
    expiresAt: Date.now() + 14 * 24 * 60 * 60 * 1000, // 14 days
  });

  return { accessToken, refreshToken, sessionId };
}
```

### Validation Flow

```typescript
async function validateRequest(req: Request): Promise<User> {
  const token = extractBearerToken(req);

  // 1. Fast path: Verify JWT signature and expiry
  const payload = jwt.verify(token, JWT_PUBLIC_KEY, { algorithms: ['RS256'] });

  // 2. Check session is still active (periodic, not every request)
  if (shouldCheckSession(payload)) {
    const session = await sessionStore.get(payload.sid);
    if (!session || session.revokedAt) {
      throw new UnauthorizedError('Session revoked');
    }
    await sessionStore.updateLastActivity(payload.sid);
  }

  return { id: payload.sub, roles: payload.roles };
}

// Check session every 5 minutes, not every request
function shouldCheckSession(payload: JwtPayload): boolean {
  const SESSION_CHECK_INTERVAL = 5 * 60; // 5 minutes
  return (Date.now() / 1000 - payload.iat) % SESSION_CHECK_INTERVAL < 1;
}
```

## Token Rotation

### Refresh Token Rotation

Every refresh creates a new refresh token and invalidates the old one. Detects token theft via reuse.

```typescript
async function refreshTokens(oldRefreshToken: string): Promise<AuthTokens> {
  const hashedToken = hashToken(oldRefreshToken);
  const session = await sessionStore.findByRefreshToken(hashedToken);

  if (!session) {
    // Token not found -- possible theft. Revoke entire session family.
    const familySession = await sessionStore.findByUsedRefreshToken(hashedToken);
    if (familySession) {
      await sessionStore.revokeFamily(familySession.familyId);
      logger.security('Refresh token reuse detected', { familyId: familySession.familyId });
    }
    throw new UnauthorizedError('Invalid refresh token');
  }

  // Rotate: Issue new tokens, invalidate old refresh token
  const newRefreshToken = crypto.randomBytes(32).toString('base64url');

  await sessionStore.rotateRefreshToken(session.id, {
    oldToken: hashedToken,
    newToken: hashToken(newRefreshToken),
    expiresAt: Date.now() + 14 * 24 * 60 * 60 * 1000,
  });

  const newAccessToken = jwt.sign(
    { sub: session.userId, sid: session.id, roles: session.roles },
    JWT_SECRET,
    { expiresIn: '15m', algorithm: 'RS256' }
  );

  return { accessToken: newAccessToken, refreshToken: newRefreshToken };
}
```

### Token Reuse Detection

```
Normal flow:
  RT-1 -> RT-2 -> RT-3 (each used once, previous invalidated)

Attack detected:
  RT-1 -> RT-2 (legitimate user)
  RT-1 -> BLOCKED (attacker tries to reuse RT-1)
  -> Revoke entire token family, force re-authentication
```

## Token Lifetimes

| Token Type | Lifetime | Rationale |
|---|---|---|
| Access token (JWT) | 15 minutes | Short-lived; limits exposure window |
| Refresh token | 7-14 days | Balances security with UX |
| Session (server-side) | 30 days (sliding) | Extended with activity |
| ID token | 1 hour | Identity assertion, not for API auth |
| MFA remember | 30 days | Device trust persistence |

## Secure Cookie Configuration

```typescript
// Access token cookie (short-lived)
res.cookie('access_token', accessToken, {
  httpOnly: true,     // Prevent XSS access
  secure: true,       // HTTPS only
  sameSite: 'lax',    // CSRF protection (use 'strict' for admin panels)
  path: '/api',       // Limit scope
  maxAge: 15 * 60 * 1000, // 15 minutes
});

// Refresh token cookie (long-lived, restricted path)
res.cookie('refresh_token', refreshToken, {
  httpOnly: true,
  secure: true,
  sameSite: 'strict', // Stricter for refresh operations
  path: '/api/auth/refresh', // Only sent to refresh endpoint
  maxAge: 14 * 24 * 60 * 60 * 1000, // 14 days
});

// Session ID cookie (if using server sessions)
res.cookie('session_id', sessionId, {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  // Add __Host- prefix for additional security
  // __Host-session_id requires secure + no domain + path=/
});
```

## Cookie Prefixes

```
__Host-session=abc123    # Requires: Secure, no Domain, Path=/
__Secure-token=xyz789    # Requires: Secure flag set
```

Use `__Host-` prefix when possible for strongest cookie security guarantees.

## JWT Best Practices

### Signing

- Use asymmetric algorithms (RS256, ES256) for distributed verification
- Use symmetric algorithms (HS256) only for single-service scenarios
- Rotate signing keys periodically; publish via JWKS endpoint

### Claims

```typescript
// Minimal JWT payload
{
  "iss": "https://auth.example.com",   // Issuer
  "sub": "user_abc123",                // Subject (user ID)
  "aud": "https://api.example.com",    // Audience (intended recipient)
  "exp": 1700003600,                   // Expiration
  "iat": 1700000000,                   // Issued at
  "jti": "unique-token-id",            // Token ID (for revocation)
  "sid": "session_xyz",                // Session binding
  "roles": ["editor"],                 // Authorization claims
  "tid": "tenant_acme"                 // Tenant context
}
```

### Validation Checklist

- [ ] Verify signature with correct algorithm (reject `alg: none`)
- [ ] Check `exp` (with clock skew tolerance of ~30 seconds)
- [ ] Check `iss` matches expected issuer
- [ ] Check `aud` matches your service
- [ ] Check `nbf` (not before) if present
- [ ] Reject tokens without required claims

## Session Termination

```typescript
// Logout: Revoke everything
async function logout(sessionId: string): Promise<void> {
  await sessionStore.revoke(sessionId);

  // Clear cookies
  res.clearCookie('access_token', { path: '/api' });
  res.clearCookie('refresh_token', { path: '/api/auth/refresh' });
  res.clearCookie('session_id', { path: '/' });
}

// Force logout all sessions (password change, compromise)
async function logoutAllSessions(userId: string): Promise<void> {
  await sessionStore.revokeAllForUser(userId);
  // Optionally: Add user to JWT blocklist until all JWTs expire
  await jwtBlocklist.add(userId, { until: Date.now() + 15 * 60 * 1000 });
}
```

## Session Fixation Prevention

Always regenerate session ID after authentication state changes:

```typescript
async function onLogin(req: Request, user: User): Promise<void> {
  // Destroy old session
  await req.session.destroy();
  // Create new session with new ID
  req.session = await createSession(user);
}
```
