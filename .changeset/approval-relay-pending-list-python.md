---
"afd-python": patch
---

### Changed

- **`CONFIRMATION_REQUIRED` is listed with retryability `"varies"`** in `ERROR_CODE_CATALOG`, instead of `False`, matching `spec/error-codes.md` (#2010). A host-verified command's pending-list refusal (`details.reason: "pending-list"`) is retryable: the same call runs once the person decides. Every other `CONFIRMATION_REQUIRED` is still not retryable.
