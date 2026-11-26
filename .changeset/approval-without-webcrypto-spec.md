---
"afd-spec": patch
---

`APPROVAL_UNAVAILABLE` gains the TypeScript-only reason `no-webcrypto`: the approval step needs WebCrypto to sign or check a token and the platform has none, as on a browser page on an insecure origin. The operator serves the app over HTTPS or from `localhost`.
