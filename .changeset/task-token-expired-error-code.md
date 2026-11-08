---
"@lushly-dev/afd-core": minor
---

Add `ErrorCodes.TASK_TOKEN_EXPIRED` (`spec/command-metadata.md`, "Tasks"), the shared catalog's 48th code: a task still working when the access token that started it expired is stopped and completes with this failure; start it again with a new token (retryable unless the command is a mutation whose handler started, which may have made its change). MCP Tasks are specified for every language and implemented in Rust first; TypeScript does not implement them yet, so nothing in TypeScript emits the code today.
