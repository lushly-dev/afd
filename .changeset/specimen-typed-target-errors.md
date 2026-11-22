---
"@lushly-dev/specimen": minor
"@lushly-dev/specimen-afd": minor
---

Split Specimen host target resolution failures into typed `TARGET_NOT_FOUND` and `TARGET_AMBIGUOUS` errors carrying actionable suggestions and match counts (`details.count`), and plumb structured `code`, `suggestion`, and `details` through the TypeScript host client, process worker IPC, and `specimen-afd` commands (#2046).
