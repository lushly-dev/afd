---
"afd-python": minor
---

### Breaking changes

- **A declared approval policy holds without the approval middleware** ([#1886](https://github.com/lushly-dev/afd/issues/1886); `spec/command-metadata.md`, "Approvals"). `create_server` and `create_direct_registry` run a command whose `approval` is `"required"` or a function only when an approval step admitted that call, for that command and that validated input. Without one the call fails with `ErrorCodes.APPROVAL_UNAVAILABLE` before the handler runs (not retryable, `details.reason: "no-approval-step"`; a policy function is not evaluated). Each batch item, pipeline step and command run from inside another command's handler is checked on its own. A server or direct registry that declares `approval` on a command and installs no `create_approval_middleware` now refuses that command: add the middleware, or set `approval="not-required"` where no approval is wanted. Core's `create_command_registry` runs no middleware and has no check.
- **A command missing from `create_approval_middleware`'s `commands` is now held** as its own policy says, under `create_server` and `create_direct_registry`: the middleware decides from the policy and `confirm_prompt` of the command each call runs, so a command registered after the middleware was built is held too. A policy given only in `commands` still holds: a call is held when either policy holds it.
- **One approval runs one handler, on the input approved.** The engine takes the admission as it dispatches, so a retry middleware placed after the approval middleware, another command name, or an input changed after the approval answers `APPROVAL_UNAVAILABLE` with `details.reason: "admission-mismatch"`, and a gated input with no exact JSON form (an integer a JavaScript number cannot hold exactly, for example) answers it with `details.reason: "input-not-canonical"`: send such a value as JSON can represent it, an id above 2^53 as a string. This holds for a policy given only in `commands` too. Put `create_retry_middleware`, and any middleware that changes the input, before the approval middleware.
- **Replaying gated journal entries needs the approval middleware.** A `replay_journal` target without it now refuses a gated command. A journal entry does not prove an approval, so replay gated commands against a target with the approval middleware, or pass only the entries recorded as successful to a target that serves those commands with `approval="not-required"`.

### Added

- **`ErrorCodes.APPROVAL_UNAVAILABLE`**, new in the shared catalog.

### Changed

- **`create_approval_middleware`'s `commands` is optional.**
