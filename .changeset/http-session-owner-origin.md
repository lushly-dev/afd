---
"@lushly-dev/afd-server": patch
---

HTTP sessions and browser origins:

- **Sessions at the cap.** When `maxSessions` is reached, `initialize` evicts only the least recently used session of its own owner (with `auth`, the verified issuer, subject and client). An owner with no session to give up now gets HTTP 503 with `Retry-After` and a JSON-RPC `-32000` error whose suggestion is to reuse a session or retry later, instead of another caller's session being evicted. Without `auth` every caller is one owner, so behaviour there is unchanged. The README's "Sessions" section states the rule.
- **`devMode` only adds error details.** It no longer turns off the Origin and `Sec-Fetch-Site` checks, and `cors` no longer defaults to it. A cross-origin browser request is refused in `devMode` as outside it, and CORS headers echo the accepted origin, never `*`. To call a server from a browser app on another origin, such as a dev server on another port, list it in `allowedOrigins` and set `cors: true`.
