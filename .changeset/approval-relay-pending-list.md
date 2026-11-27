---
"@lushly-dev/afd-core": patch
---

The error catalog (`ERROR_CODE_CATALOG`) now lists `CONFIRMATION_REQUIRED` with `retryable: 'varies'` instead of `false`, matching `spec/error-codes.md` (#2010). A host-verified command's pending-list refusal (`details.reason: "pending-list"`) is retryable: the same call runs once the person decides. Every other `CONFIRMATION_REQUIRED` is still not retryable.
