---
"@lushly-dev/afd-core": patch
"@lushly-dev/afd-server": patch
---

Advertise canonical command metadata from core MCP tool conversion, share malformed batch result shapes across HTTP and MCP, omit invented output schemas when converting commands with no declared output, and stop scheduling queued batch commands and pipeline steps after caller cancellation while preserving started work outcomes.

Redact exceptions thrown by core pipeline executors using the shared command error policy.
