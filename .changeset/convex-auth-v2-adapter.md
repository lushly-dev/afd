---
"@lushly-dev/afd-auth": minor
---

`useConvexAuthAdapter` supports `@convex-dev/auth` 2.x, and the optional peer is now `>=0.0.95 <3`. Version 2 has a hook per sign-in method instead of `useAuthActions().signIn`. Pass the functions those hooks return (`ConvexAuthV2AdapterOptions`): `signOut`, `signInWithPassword` (from `useSignInWithEmailPassword(api.auth)`) and `oauth` by provider (for example `useSignInWithGithub(api.auth).signIn`). The methods return errors as values, and they map to the adapter's codes: a wrong password, an unknown account or a password that breaks the rules is `INVALID_CREDENTIALS`; a rate limit is `PROVIDER_ERROR`, with the wait in its suggestion; any other failure is mapped from its cause, so a failed fetch is `NETWORK_ERROR`. The 0.0.x options (`useAuthActions`) are unchanged, and support for them is planned to end in the next major.
