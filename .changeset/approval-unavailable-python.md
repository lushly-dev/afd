---
"afd-python": minor
---

### Added

- **A declared approval policy holds without the approval middleware** ([#1886](https://github.com/lushly-dev/afd/issues/1886); `spec/command-metadata.md`, "Approvals"). `create_server` and `create_direct_registry` run a command whose `approval` policy is neither unset nor `"not-required"` only when an approval step admitted that call, for that command and that validated input. Without one the call fails with `ErrorCodes.APPROVAL_UNAVAILABLE` (not retryable, `details.reason: "no-approval-step"`) before the handler runs. Each batch item, pipeline step and command run from inside another command's handler is checked on its own. A policy function is not evaluated for this check, so a command that declares one needs an approval step. Core's `create_command_registry` runs no middleware and has no check.

### Changed

- **`create_approval_middleware`'s `commands` is optional.** Under `create_server` and `create_direct_registry` the middleware decides from the policy and `confirm_prompt` of the command each call runs, so a command registered after the middleware was built is held too. A policy given in `commands` still holds: a call is held when either policy holds it. One approval runs one handler on the approved input: a retry middleware placed after the approval middleware, or one that changes the input there, gets `APPROVAL_UNAVAILABLE` with `details.reason: "admission-mismatch"`, so place such middleware before it. A server that serves gated commands with no approval step (a replay target, for example) serves them without their policy.
