---
"afd-spec": patch
---

Idempotency keys: Python implements `spec/idempotency.md` ([#2955](https://github.com/lushly-dev/afd/issues/2955)), the last of the four languages, so `vectors/idempotency.json` lists no `gaps`. The pages that named a language's gap (`idempotency.md`, `dispatch.md`, `error-codes.md`, `recovery.md`, `journal.md`, `command-metadata.md`, `context-fields.md` and `vectors/README.md`) now state the behaviour for every language, and the `meta` argument's description in `meta-tools.json` names `dev.afd/idempotencyKey`.
