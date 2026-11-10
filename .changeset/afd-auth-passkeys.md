---
'@lushly-dev/afd-auth': minor
'@lushly-dev/afd-server': minor
---

`@lushly-dev/afd-auth` signs in with passkeys and gains three optional adapter capabilities. `SignInOptions` adds `{ method: 'passkey', autoFill? }`, and `auth-sign-in` accepts it. `AuthAdapter` adds `refresh()`, `sessions` (list the signed-in person's sessions, by a handle that is the first 16 hex characters of SHA-256 over the token, never the token, with a device label and no IP address; revoke one, the others, or all), `passkeys` (list, add, rename, remove) and `organization` (membership, members, invitations and roles, each call naming the organization by id; an empty id is a `TypeError`, so no call falls back to the provider's active organization). `AuthAdapterError` adds `PASSKEY_CANCELLED` and `PASSKEY_UNSUPPORTED`, neither retryable. `BetterAuthAdapter` implements all three on Better Auth's session routes and its organization and passkey client plugins, takes an `initial` state, and is tested on Better Auth 1.7.18 with `@better-auth/passkey` 1.7.18, now an optional peer. `MockAuthAdapter` implements them in memory, with `clock` and `roles` options and `_setPasskeyCeremony()`. The Convex adapter refuses a passkey sign-in with `PASSKEY_UNSUPPORTED`.

`createAuthMiddleware` takes `isVerifiedCredentials`. With it, a call whose `credentials` afd-server set itself after verifying a token keeps its actor and runs without reading the adapter's session, and `context.auth` is deleted; `credentials` a caller supplies, or a copy, are not recognised. Without it, every call is gated on the session as before. A host that serves MCP with token authorization through this middleware must pass it.

`@lushly-dev/afd-server` exports `isVerifiedCredentials`, from the root and from the new browser-safe `@lushly-dev/afd-server/credentials` entry. It recognises only the object afd-server branded after verifying a token; nothing brands one yet, until the server verifies tokens itself.
