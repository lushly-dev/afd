---
"afd-spec": patch
---

Idempotency keys: TypeScript implements `spec/idempotency.md` and leaves the `gaps` of `vectors/idempotency.json`. `IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_IN_PROGRESS` and `OUTCOME_UNKNOWN` join the shared catalog in a new `idempotency` profile (53 codes), the engine table of `recovery.md` gains their rows and `TIMEOUT`'s `retry`, and `dispatch.md` places the key between stages 4 and 5, so a malformed key comes ahead of `CONFIRMATION_REQUIRED`. S8 now says a reservation still live is also new after `ttlMs`. The `meta` argument's description in `meta-tools.json` gains `dev.afd/idempotencyKey` once every language accepts it.
