---
"afd-spec": patch
---

A journal recorder that a handler runs itself, on its own context, cannot read the running command's `secret` declaration and records no call without `redact`. A secret call left unrecorded inside a recorded call marks the tape of every recording layer around it `truncated`.
