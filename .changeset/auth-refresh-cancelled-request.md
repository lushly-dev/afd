---
"@lushly-dev/afd-auth": patch
---

`BetterAuthAdapter.refresh()` no longer resolves before the provider has answered. Better Auth cancels a session request when a newer one starts (after a sign-in or sign-out, on window focus, from another tab or on its poll), and the cancelled `refetch` resolved with no error stored, so `refresh()` could report the session kept while the provider was unreachable. It now waits for the session store to settle, and rejects with `NETWORK_ERROR` or `REFRESH_FAILED` as documented.
