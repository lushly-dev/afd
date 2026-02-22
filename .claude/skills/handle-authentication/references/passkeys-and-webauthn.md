# Passkeys and WebAuthn

Implementation guide for passwordless authentication using passkeys (WebAuthn/FIDO2), covering progressive rollout, platform support, and phishing resistance.

## Overview

Passkeys are FIDO2/WebAuthn credentials that replace passwords with cryptographic key pairs. The private key never leaves the user's device or password manager; only a signed challenge is sent to the server.

### Key Properties

| Property | Detail |
|---|---|
| Phishing-resistant | Credentials are domain-bound; cannot be used on lookalike sites |
| No shared secrets | Server stores public key only; database breach exposes nothing usable |
| Cross-device | Synced via platform (iCloud Keychain, Google Password Manager) or password managers |
| Biometric-backed | Unlocked via fingerprint, face, or device PIN -- not transmitted |
| Multi-device | Credential Exchange Protocol (CXP) enables portability between providers |

## Platform Support (2025)

| Platform | Synced Passkeys | Cross-Device Auth |
|---|---|---|
| iOS 16+ / macOS Ventura+ | iCloud Keychain | Yes (QR/Bluetooth) |
| Android 9+ | Google Password Manager | Yes (QR/Bluetooth) |
| Windows 11 23H2+ | Windows Hello / 3rd party | Yes (QR/Bluetooth) |
| Chrome 118+ | Cross-platform support | Yes |
| 1Password, Bitwarden, Dashlane | Vault-synced passkeys | Yes |

## Registration Flow

```typescript
// 1. Server generates registration options
const options = await generateRegistrationOptions({
  rpName: 'My Application',
  rpID: 'example.com',
  userID: user.id,
  userName: user.email,
  attestationType: 'none', // 'direct' only if you need device attestation
  authenticatorSelection: {
    residentKey: 'preferred',       // Discoverable credential
    userVerification: 'preferred',  // Biometric/PIN when available
  },
  excludeCredentials: existingCredentials.map(cred => ({
    id: cred.credentialID,
    type: 'public-key',
  })),
});

// 2. Client calls WebAuthn API
const credential = await navigator.credentials.create({
  publicKey: options,
});

// 3. Server verifies and stores
const verification = await verifyRegistrationResponse({
  response: credential,
  expectedChallenge: storedChallenge,
  expectedOrigin: 'https://example.com',
  expectedRPID: 'example.com',
});

// Store: credentialID, publicKey, counter, transports
```

## Authentication Flow

```typescript
// 1. Server generates authentication options
const options = await generateAuthenticationOptions({
  rpID: 'example.com',
  allowCredentials: [], // Empty for discoverable credentials
  userVerification: 'preferred',
});

// 2. Client calls WebAuthn API
const assertion = await navigator.credentials.get({
  publicKey: options,
});

// 3. Server verifies
const verification = await verifyAuthenticationResponse({
  response: assertion,
  expectedChallenge: storedChallenge,
  expectedOrigin: 'https://example.com',
  expectedRPID: 'example.com',
  authenticator: {
    credentialPublicKey: stored.publicKey,
    counter: stored.counter,
  },
});

// Update counter for clone detection
await updateCounter(stored.id, verification.newCounter);
```

## Progressive Rollout Strategy

### Phase 1: Silent Availability

- Add passkey registration option in account settings
- Target users with compatible OS/browser versions
- No prompts; let early adopters discover it

### Phase 2: Post-Login Prompt

- After successful password login, offer passkey creation
- Show once per session; respect dismissals
- Automatic passkey upgrade: create in background after password auth

### Phase 3: Passkey-First Login

- Default login UI shows passkey option prominently
- Password field available but secondary
- Conditional UI: `navigator.credentials.get({ mediation: 'conditional' })`

### Phase 4: Passkey-Only (High Security)

- Remove all phishable auth methods from account
- No SMS recovery, no password fallback
- Hardware security key required for recovery
- Only appropriate for high-security environments

## Conditional UI (Autofill Integration)

```typescript
// Check if conditional mediation is available
const available = await PublicKeyCredential.isConditionalMediationAvailable();

if (available) {
  // Start conditional request (shows in autofill dropdown)
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: serverChallenge,
      rpId: 'example.com',
      allowCredentials: [],
      userVerification: 'preferred',
    },
    mediation: 'conditional', // Key: integrates with autofill
  });
}
```

```html
<!-- Input field that triggers passkey autofill -->
<input type="text" name="username" autocomplete="username webauthn" />
```

## Account Recovery

Passkey-only accounts need robust recovery. Options ranked by security:

1. **Multiple passkeys** -- Register across devices/providers (best)
2. **Hardware security key** -- Physical backup authenticator
3. **Recovery codes** -- One-time codes stored offline
4. **Trusted contact recovery** -- Social recovery via verified contacts
5. **Identity verification** -- Document-based recovery (slowest, most friction)

Avoid: SMS-based recovery undermines passkey phishing resistance.

## Server-Side Considerations

### Credential Storage Schema

```sql
CREATE TABLE passkey_credentials (
  id              TEXT PRIMARY KEY,      -- base64url credential ID
  user_id         UUID NOT NULL REFERENCES users(id),
  public_key      BYTEA NOT NULL,        -- COSE public key
  counter         BIGINT NOT NULL DEFAULT 0,
  transports      TEXT[],                -- ['internal', 'hybrid', 'usb']
  backed_up       BOOLEAN DEFAULT false, -- Multi-device credential
  device_type     TEXT,                  -- 'singleDevice' or 'multiDevice'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at    TIMESTAMPTZ,
  friendly_name   TEXT                   -- User-assigned label
);
```

### Counter Validation

```typescript
function validateCounter(stored: number, received: number): boolean {
  if (received > stored) return true;  // Normal increment
  if (received === 0 && stored === 0) return true; // Some authenticators don't increment
  // Counter went backwards or didn't increment -- possible clone
  logger.warn('Possible authenticator clone detected');
  return false; // Consider blocking and alerting user
}
```

## Common Pitfalls

- **Not setting `rpID` correctly** -- Must match the effective domain; subdomains can use parent domain
- **Requiring attestation unnecessarily** -- Use `attestationType: 'none'` unless you have a specific compliance requirement
- **Ignoring transports** -- Store and send back `transports` for better UX on re-authentication
- **Single passkey per account** -- Always encourage registering multiple passkeys across devices
- **SMS fallback undermining security** -- A single phishable recovery path negates passkey benefits
