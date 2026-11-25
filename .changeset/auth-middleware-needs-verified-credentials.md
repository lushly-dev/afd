---
"@lushly-dev/afd-server": minor
"@lushly-dev/afd-auth": minor
---

`createMcpServer` and `createMcpHandler` with `auth` now throw when they are built with afd-auth's `createAuthMiddleware` lacking `isVerifiedCredentials`, in `middleware` directly or inside `composeMiddleware`. Without it, every token's call was gated on the local adapter's session and ran as the session's user. Pass `createAuthMiddleware(adapter, { isVerifiedCredentials })`, importing `isVerifiedCredentials` from `@lushly-dev/afd-server/credentials`. A server without `auth`, and a direct registry, are unaffected. The check sees afd-auth's middleware only directly or inside `composeMiddleware`: one wrapped in a host's own function is not seen, so pass the option there too, taking `isVerifiedCredentials` from the copy of afd-server that serves the request. afd-auth's middleware marks itself under a registered symbol so the check works across installed copies, and `composeMiddleware` carries the mark.
