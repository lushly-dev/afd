---
"@lushly-dev/afd-server": minor
---

`createApprovalMiddleware` now runs on WebCrypto (`globalThis.crypto`) instead of `node:crypto`, so it works in browsers and webviews as well as Node.js 22, and `@lushly-dev/afd-server/direct` exports it. Its options, results and tokens are unchanged: tokens are byte for byte what they were, and still verify in Python, Rust and C++ (`spec/vectors/approval-tokens.json`). In a page the approval secret is visible to every script on that page, so the gate guards against the model approving its own call, not against code running in the page; the README says when to keep approvals on a server.
