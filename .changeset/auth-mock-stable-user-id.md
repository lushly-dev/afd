---
"@lushly-dev/afd-auth": patch
---

`MockAuthAdapter.signIn` derives the user id from the email, `mock-user-<email>`, in place of `mock-user-<Date.now()>`, so the same person keeps one id across sign-ins, adapters and replays. Session ids stay time-based, and `_setUser` is unchanged. A test that needs two different users must sign in with two different emails.
