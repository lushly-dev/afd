---
"afd-spec": patch
---

`spec/pipeline-variables.md` and `spec/error-codes.md` bound referenced-value nesting depth (64 levels, at most 128 levels combined) and repeated reference expansion (100,000 values and 16 MiB of string/key characters) during pipeline variable resolution, failing the step with `VALIDATION_ERROR` without invoking the command (#1704).
