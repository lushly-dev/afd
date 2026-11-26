---
"@lushly-dev/afd-server": patch
---

**An app with the approval middleware starts without WebCrypto** ([#1699](https://github.com/lushly-dev/afd/issues/1699)). `createApprovalMiddleware` used to import its HMAC key when it was created, so on a browser page served over plain HTTP from a network address (where `crypto.subtle` is missing) it threw while the app started and the page stayed blank. The key is now imported on first use: the app starts, commands that need no approval run, and a call the middleware must sign or check a token for returns `APPROVAL_UNAVAILABLE` (`retryable: false`, `details.reason: "no-webcrypto"`) with a suggestion to serve the app over HTTPS or from `localhost`.
