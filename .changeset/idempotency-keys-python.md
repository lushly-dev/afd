---
"afd-python": minor
---

### Added

- **`ErrorCodes.IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_IN_PROGRESS` and `OUTCOME_UNKNOWN`**, in the shared catalog's new `idempotency` profile (`spec/error-codes.md`). No Python engine sends them yet: the idempotency step is tracked in [#2676](https://github.com/lushly-dev/afd/issues/2676).
- **The shared idempotency key definitions** (`spec/idempotency.md`), as TypeScript's: `AFD_IDEMPOTENCY_KEY_META_KEY`, the `IdempotencySupport` literal (`"natural"` or `"keyed"`) and `is_idempotency_support`, `is_idempotency_key` (K2's form), `derive_idempotency_key` (K4's batch and pipeline keys) and `invalid_idempotency_key_error`. The engine does not use them yet (#2676).
