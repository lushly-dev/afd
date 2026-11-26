---
"afd-spec": patch
---

Declared context fields (`spec/context-fields.md`): a schema callback that throws, or a validator that raises an exception other than a validation error, fails the call with `VALIDATION_ERROR` like any invalid value. The exception's text reaches the caller only in dev mode, and the exception goes to the server's error hook either way.
