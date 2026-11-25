---
"afd-spec": patch
---

Command metadata gains `secret` (boolean, default `false`): the command takes or returns a secret, such as a password argument or an issued token. A journal recorder never records a call to such a command unless the host also gives the recorder `redact`, which must remove the secret; a `filter` alone never admits it. The recorder reads the declaration from the command the engine runs, not from its name, and tells `redact` the answer; a recorder that cannot read it records no call without `redact`. A secret call left unrecorded inside a recorded call stays off the parent's tape, which is marked `truncated`. The default filter still skips `auth-*` names as well.
