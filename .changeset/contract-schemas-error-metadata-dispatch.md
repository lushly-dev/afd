---
'@lushly-dev/afd-core': minor
---

Contract schemas, error-code metadata, and typed `outputSchema.properties.error` (#1733, #1740, #1736).

- `ERROR_CODE_CATALOG`, `ErrorCodeInfo`, and `HOST_ERROR_CODE_PREFIX` (`"HOST_"`) expose retryability (`true`, `false`, or `"varies"`) and contract profile (`"core"` or profile name) for every shared error code in `spec/vectors/error-codes.json`, plus the reserved host prefix (`spec/error-codes.md`).
- `commandResultOutputSchema` now types `properties.error` with `code`, `message`, `suggestion`, and `retryable` (`required: ["code", "message"]`), matching `spec/schema/output-envelope.json`.
