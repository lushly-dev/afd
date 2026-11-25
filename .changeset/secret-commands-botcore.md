---
"lushly-botcore": patch
---

### Changed

- **A journal behind a `CommandHost` records only when it is given `redact`.** The host runs its own middleware chain, outside AFD's engine, where afd's journal cannot read a command's `secret` declaration, so from the afd release that adds `secret` it records nothing there without `redact`.

### Fixed

- **The factory gateway's journal keeps only what the audit reads.** It records failures too, so an `issue-create` refused with `SECRET_IN_BODY` would have stored the body. Its new redactor, `audit_record`, keeps the actor, timestamp and trace ID, the input's `repo`, `number`, `numbers`, `head` and `ref` when each has the right type, and of the result only `success`, an error's `code` and a pull request's `number`.
