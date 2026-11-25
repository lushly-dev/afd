---
"@lushly-dev/afd-server": patch
---

The journal reads a command's `secret` declaration only in a middleware the engine invoked (directly or through `composeMiddleware`): a recorder a handler runs itself on its own context, during the call or after it, reads it as unknown and records nothing without `redact`, where it read the outer command's declaration before. A call whose declaration is unknown also reads off its parent's tape. The journal's tape markers are registered symbols, so the recording layers of two installed copies of afd-server recognise each other. A secret nested call now marks the tape of every recording layer around it `truncated`, not only the nearest.
