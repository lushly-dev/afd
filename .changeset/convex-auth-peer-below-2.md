---
"@lushly-dev/afd-auth": patch
---

The optional `@convex-dev/auth` peer is now `>=0.0.95 <2`. Version 2 is a rewrite: `useAuthActions()` returns only `setSession` and `signOut`, and each sign-in method has its own hook, so `useConvexAuthAdapter` cannot sign in with it. The old range accepted 2.x without an install warning. Support for 2.x is tracked in #3006.
