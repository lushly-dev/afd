# OAuth 2.1 and OpenID Connect

Modern authentication foundation covering OAuth 2.1, OIDC, grant types, token protection, and migration from OAuth 2.0.

## OAuth 2.1 Overview

OAuth 2.1 consolidates OAuth 2.0 (RFC 6749) with security best practices accumulated since 2012. It is not a new protocol but a streamlined specification that removes insecure patterns and mandates proven security mechanisms.

### Key Changes from OAuth 2.0

| Change | Detail |
|---|---|
| PKCE required for all clients | All authorization code flows must use PKCE, not just public clients |
| Implicit grant removed | No more `response_type=token` -- use authorization code + PKCE instead |
| Password grant removed | `grant_type=password` eliminated entirely |
| Exact redirect URI matching | No wildcard or partial matching allowed |
| Refresh token rotation | Refresh tokens must be sender-constrained or rotated on each use |
| Bearer token restrictions | Tokens must not appear in query strings |

### Retained Grant Types

1. **Authorization Code + PKCE** -- Interactive user authentication (web, mobile, SPA)
2. **Client Credentials** -- Machine-to-machine, service accounts, AI agents
3. **Device Authorization** -- Input-constrained devices (TVs, IoT, CLI tools)
4. **Refresh Token** -- Token renewal without re-authentication

## PKCE (Proof Key for Code Exchange)

PKCE prevents authorization code interception attacks, even for confidential clients.

### Flow

```
1. Client generates random `code_verifier` (43-128 chars)
2. Client computes `code_challenge = BASE64URL(SHA256(code_verifier))`
3. Authorization request includes `code_challenge` + `code_challenge_method=S256`
4. Token request includes original `code_verifier`
5. Server verifies: SHA256(code_verifier) == stored code_challenge
```

### Implementation

```typescript
import crypto from 'crypto';

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64url');
}

// Authorization request
const verifier = generateCodeVerifier();
const challenge = generateCodeChallenge(verifier);

const authUrl = new URL('https://auth.example.com/authorize');
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('client_id', CLIENT_ID);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('code_challenge', challenge);
authUrl.searchParams.set('code_challenge_method', 'S256');
authUrl.searchParams.set('scope', 'openid profile');
```

## DPoP (Demonstrating Proof of Possession)

DPoP binds tokens to a client's cryptographic key pair, preventing stolen tokens from being used by other parties.

### How It Works

```
1. Client generates ephemeral public/private key pair
2. Each request includes a DPoP proof JWT signed with the private key
3. Authorization server binds access token to the public key
4. Resource server verifies DPoP proof matches token binding
```

### DPoP Proof JWT Structure

```json
{
  "typ": "dpop+jwt",
  "alg": "ES256",
  "jwk": { "kty": "EC", "crv": "P-256", "x": "...", "y": "..." }
}
{
  "jti": "unique-id",
  "htm": "POST",
  "htu": "https://api.example.com/resource",
  "iat": 1700000000,
  "ath": "base64url(sha256(access_token))"
}
```

### When to Use DPoP

- High-security APIs (financial, health)
- Public clients where client secrets cannot be stored
- Preventing token replay and theft from XSS or log leaks
- Machine-to-machine flows where sender-constraint adds defense-in-depth

## OpenID Connect (OIDC)

OIDC is an identity layer on top of OAuth 2.0 that provides:

- **ID Token** -- JWT containing user identity claims
- **UserInfo Endpoint** -- API for fetching additional user claims
- **Discovery** -- `.well-known/openid-configuration` for auto-configuration
- **Dynamic Registration** -- Programmatic client registration

### ID Token Claims

```json
{
  "iss": "https://auth.example.com",
  "sub": "user_abc123",
  "aud": "client_id",
  "exp": 1700003600,
  "iat": 1700000000,
  "nonce": "random-nonce",
  "auth_time": 1700000000,
  "amr": ["pwd", "mfa"],
  "email": "user@example.com",
  "email_verified": true
}
```

### Critical Validation Steps

1. Verify `iss` matches expected issuer
2. Verify `aud` contains your client ID
3. Verify `exp` has not passed
4. Verify `nonce` matches what was sent in the request
5. Verify signature using issuer's public keys (from JWKS endpoint)
6. Verify `iat` is within acceptable clock skew (typically 5 minutes)

## Scope Management

Follow the principle of least privilege:

```
# Bad: Over-broad scope
scope=openid profile email admin:full

# Good: Minimal scope for the task
scope=openid email
```

- Request scopes incrementally as features require them
- Never request admin scopes unless the current operation needs them
- Use resource indicators (RFC 8707) to scope tokens to specific APIs
- Document required scopes per feature/endpoint

## Token Endpoint Security

### Confidential Clients

```http
POST /token HTTP/1.1
Content-Type: application/x-www-form-urlencoded
Authorization: Basic base64(client_id:client_secret)

grant_type=authorization_code&
code=AUTH_CODE&
redirect_uri=https://app.example.com/callback&
code_verifier=ORIGINAL_VERIFIER
```

### Public Clients (SPA, Mobile)

No client secret. Rely on PKCE + DPoP for security.

```http
POST /token HTTP/1.1
Content-Type: application/x-www-form-urlencoded
DPoP: eyJ0eXAiOiJkcG9wK2p3dCIs...

grant_type=authorization_code&
client_id=CLIENT_ID&
code=AUTH_CODE&
redirect_uri=https://app.example.com/callback&
code_verifier=ORIGINAL_VERIFIER
```

## Migration from OAuth 2.0 to 2.1

### Checklist

- [ ] Remove implicit grant flows (`response_type=token`)
- [ ] Remove password grant flows (`grant_type=password`)
- [ ] Add PKCE to all authorization code flows
- [ ] Enforce exact redirect URI matching (no wildcards)
- [ ] Implement refresh token rotation or sender-constraining
- [ ] Remove tokens from URL query strings
- [ ] Evaluate DPoP for high-security endpoints
- [ ] Update client libraries to support PKCE natively
