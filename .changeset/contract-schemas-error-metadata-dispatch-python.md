---
"afd-python": minor
---

### Added

- **`ERROR_CODE_CATALOG`**, **`ErrorCodeInfo`**, and **`HOST_ERROR_CODE_PREFIX`** (`"HOST_"`) exposing retryability and contract profile metadata for every shared error code in `spec/vectors/error-codes.json` (#1740).

### Changed

- **`command_result_output_schema`** now types `properties.error` with `code`, `message`, `suggestion`, and `retryable` (`required: ["code", "message"]`), matching `spec/schema/output-envelope.json` (#1733).
