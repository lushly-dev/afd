---
"@lushly-dev/afd-core": minor
"@lushly-dev/afd-server": minor
"@lushly-dev/afd-auth": minor
---

Commands can declare `secret: true` when they take or return a secret, such as a password or an issued token. `createJournalMiddleware` never records a call to such a command unless it was given `redact`, whatever its `filter` returns, in a server and in a direct registry; `redact` gets a second argument, `{ secret }`, saying which calls those are. A journal in a DirectClient's own middleware, which cannot read the declaration, records nothing without `redact`. A non-boolean `secret` is refused when the command is defined. afd-auth's `auth-sign-in`, which takes a password, now declares it.
