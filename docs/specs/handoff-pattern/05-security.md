# Security

> Part 5 of [Handoff Pattern Spec](./00-overview.md)

## Security Model

Handoff credentials grant access to real-time channels. They require careful security handling.

## Authentication Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Authentication Flow                                │
│                                                                              │
│   1. Client authenticated with AFD (API key, OAuth, session)                │
│                                                                              │
│   2. Client calls handoff command                                           │
│      → Command validates user permissions                                    │
│      → Command creates session with scoped token                            │
│      → Token is short-lived, single-use or session-bound                   │
│                                                                              │
│   3. Client connects to handoff endpoint                                    │
│      → Presents handoff token                                               │
│      → Server validates token, associates with session                      │
│      → Connection established                                               │
│                                                                              │
│   4. Ongoing: Token may be refreshed via separate mechanism                 │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Token Design

### Session Token Properties

| Property | Value | Rationale |
|----------|-------|-----------|
| **Type** | JWT or opaque | JWT for stateless validation |
| **Lifetime** | 5-15 minutes | Short window for handoff |
| **Single-use** | Optional | Prevents replay attacks |
| **Scoped** | Yes | Limited to specific session/room |
| **Revocable** | Yes | Server can invalidate |

### JWT Claims (if using JWT)

```typescript
interface HandoffTokenClaims {
  // Standard
  sub: string;      // User ID
  iat: number;      // Issued at
  exp: number;      // Expiration
  jti: string;      // Unique token ID (for single-use tracking)
  
  // Handoff-specific
  sid: string;      // Session ID
  rid: string;      // Resource ID (room, canvas, etc.)
  proto: string;    // Expected protocol
  caps: string[];   // Allowed capabilities
}
```

### Token Generation

```typescript
import { SignJWT } from 'jose';

async function createHandoffToken(params: {
  userId: string;
  sessionId: string;
  resourceId: string;
  protocol: string;
  capabilities: string[];
  expiresIn: number;
}): Promise<string> {
  const token = await new SignJWT({
    sid: params.sessionId,
    rid: params.resourceId,
    proto: params.protocol,
    caps: params.capabilities,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(params.userId)
    .setIssuedAt()
    .setExpirationTime(`${params.expiresIn}s`)
    .setJti(crypto.randomUUID())
    .sign(secret);
  
  return token;
}
```

## Token Validation

At WebSocket/stream connection:

```typescript
async function validateHandoffToken(
  token: string,
  expectedResource: string
): Promise<HandoffTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    
    // Check resource matches
    if (payload.rid !== expectedResource) {
      return null;
    }
    
    // Check not already used (for single-use tokens)
    if (await isTokenUsed(payload.jti)) {
      return null;
    }
    
    // Mark as used
    await markTokenUsed(payload.jti, payload.exp);
    
    return payload as HandoffTokenClaims;
  } catch {
    return null;
  }
}
```

## CORS and Origin Validation

### WebSocket Origins

```typescript
// WebSocket server configuration
const wss = new WebSocketServer({
  verifyClient: (info, callback) => {
    const origin = info.origin;
    
    // Allow known origins
    const allowedOrigins = [
      'https://app.example.com',
      'https://staging.example.com',
    ];
    
    if (!allowedOrigins.includes(origin)) {
      callback(false, 403, 'Origin not allowed');
      return;
    }
    
    callback(true);
  },
});
```

### For SSE/HTTP Streams

```typescript
app.get('/events/:roomId', (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', getAllowedOrigin(req));
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Validate token
  const token = req.query.token as string;
  const claims = await validateHandoffToken(token, req.params.roomId);
  
  if (!claims) {
    res.status(401).end();
    return;
  }
  
  // Start streaming...
});
```

## Token Rotation

For long-lived sessions, tokens should be rotated:

### Via Command

```typescript
defineCommand({
  name: 'chat-refresh-token',
  tags: ['chat', 'write', 'safe'],
  inputSchema: z.object({
    sessionId: z.string(),
    currentToken: z.string(),
  }),
  async handler(input, ctx) {
    // Validate current token still valid
    const claims = await validateHandoffToken(input.currentToken, '*');
    if (!claims || claims.sid !== input.sessionId) {
      return failure('INVALID_TOKEN', 'Current token is invalid');
    }
    
    // Issue new token
    const newToken = await createHandoffToken({
      userId: claims.sub,
      sessionId: input.sessionId,
      resourceId: claims.rid,
      protocol: claims.proto,
      capabilities: claims.caps,
      expiresIn: 900, // 15 minutes
    });
    
    return success({
      token: newToken,
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
    });
  },
});
```

### Via In-Band Message

Server can push new tokens via the stream:

```typescript
// Server-side: periodic token refresh
setInterval(() => {
  for (const session of activeSessions) {
    if (session.tokenExpiresIn() < 60_000) { // < 1 min left
      const newToken = await refreshToken(session);
      session.send({
        type: 'token_refresh',
        token: newToken,
        expiresAt: session.tokenExpiresAt,
      });
    }
  }
}, 30_000);
```

## Rate Limiting

Protect handoff endpoints:

```typescript
const rateLimiter = rateLimit({
  windowMs: 60_000,      // 1 minute
  max: 10,               // 10 handoff requests per minute
  keyGenerator: (req) => req.userId,
  handler: (req, res) => {
    res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many handoff requests',
        retryAfter: 60,
      },
    });
  },
});

app.use('/api/handoff/*', rateLimiter);
```

## Session Hijacking Prevention

1. **Bind to IP** (optional, may break mobile):
   ```typescript
   const session = {
     ...params,
     boundIp: req.ip,
   };
   
   // On connect, verify IP matches
   if (session.boundIp && ws.ip !== session.boundIp) {
     ws.close(4003, 'IP mismatch');
   }
   ```

2. **Bind to User-Agent**:
   ```typescript
   const session = {
     ...params,
     userAgent: req.headers['user-agent'],
   };
   ```

3. **Unique connection ID**:
   ```typescript
   // Only one connection per session at a time
   if (session.activeConnection) {
     session.activeConnection.close(4004, 'Session taken over');
   }
   session.activeConnection = ws;
   ```

## Audit Logging

Log security-relevant events:

```typescript
const auditLog = {
  event: 'handoff_connect',
  timestamp: new Date().toISOString(),
  sessionId: session.id,
  userId: claims.sub,
  resource: claims.rid,
  ip: ws.ip,
  userAgent: ws.headers['user-agent'],
  tokenId: claims.jti,
};

await logAuditEvent(auditLog);
```

## Security Checklist

- [ ] Handoff tokens are short-lived (< 15 min)
- [ ] Tokens are scoped to specific resources
- [ ] Single-use tokens for sensitive operations
- [ ] CORS properly configured
- [ ] Origin validation on WebSocket upgrade
- [ ] Token validation before stream starts
- [ ] Rate limiting on handoff commands
- [ ] Audit logging for connections
- [ ] Session takeover protection
- [ ] Token rotation for long sessions
