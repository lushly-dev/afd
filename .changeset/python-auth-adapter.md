---
"afd-python": minor
---

### Added

- Add `afd.auth` with the provider-agnostic `AuthAdapter` protocol, discriminated `AuthSessionState` models (`UNAUTHENTICATED`, `LOADING`, `AuthenticatedSessionState`), `AuthAdapterError`, `ListenerSet`, `create_auth_middleware` (including `is_verified_credentials` awareness and server startup backstop), `create_auth_commands` (`auth-sign-in`, `auth-sign-out`, `auth-session-get`), and `MockAuthAdapter`. Allow `MCPServer.register()` to accept `CommandDefinition` objects directly.
