---
"afd-python": minor
---

### Breaking changes

- **A declared approval policy holds without the approval middleware** ([#1886](https://github.com/lushly-dev/afd/issues/1886); `spec/command-metadata.md`, "Approvals"). `create_server` and `create_direct_registry` run a command whose `approval` is `"required"` or a function only when an approval step admitted that call, for that command and that validated input. Without one the call fails with `ErrorCodes.APPROVAL_UNAVAILABLE` before the handler runs (not retryable, `details.reason: "no-approval-step"`; a policy function is not evaluated). Each batch item, pipeline step and command run from inside another command's handler is checked on its own. A server or direct registry that declares `approval` on a command and installs no `create_approval_middleware` now refuses that command: add the middleware, or set `approval="not-required"` where no approval is wanted. Core's `create_command_registry` runs no middleware and has no check.
- **A command missing from `create_approval_middleware`'s `commands` is now held** as its own policy says, under `create_server` and `create_direct_registry`: the middleware decides from the policy and `confirm_prompt` of the command each call runs, so a command registered after the middleware was built is held too. A policy given only in `commands` still holds: a call is held when either policy holds it.
- **One approval runs one handler, on the input approved.** The engine takes the admission as it dispatches, so a retry middleware placed after the approval middleware, another command name, or an input changed after the approval answers `APPROVAL_UNAVAILABLE` with `details.reason: "admission-mismatch"`. This holds for a policy given only in `commands` too. Put `create_retry_middleware`, and any middleware that changes the input, before the approval middleware. A middleware that moves `next_fn` to a thread should use `asyncio.to_thread` or `contextvars.copy_context().run`; without them, a call whose context object overlapping calls share is refused. An approval middleware admits only a call a policy of its own may gate, and every one that ever admitted a call must admit it again, matching, before each dispatch, so a second middleware that does not gate a command leaves the first one's admission to decide. Install one approval middleware per engine: two that both gate a command's own policy each ask for it.
- **An input that changes while the approval middleware decides** (in a policy function, including one an up-front `afd-batch` or `afd-pipe` step runs) answers `APPROVAL_UNAVAILABLE` with `details.reason: "admission-mismatch"`, and nobody is asked or notified. One that changes later, while a token is spent or a relayed answer awaited, is refused at dispatch the same way, so nothing runs on it.
- **An input that needs approval and has no canonical form is answered by the approval middleware** with `APPROVAL_UNAVAILABLE`, `details.reason: "input-not-canonical"`, before anyone is asked or the handler runs, where it raised `TypeError` (a `COMMAND_EXECUTION_ERROR` result) before. That covers a token check, a relayed approval and an up-front `afd-batch` or `afd-pipe` step. Send such a value in a form canonical JSON accepts (an integer above 2^53, for example, as a string). A call whose policy lets it through on such an input still runs.
- **Replaying gated journal entries needs the approval middleware.** A `replay_journal` target without it now refuses a gated command. A journal entry does not prove an approval, so replay gated commands against a target with the approval middleware, or pass only the entries recorded as successful to a target that serves those commands with `approval="not-required"`.

### Added

- **`ErrorCodes.APPROVAL_UNAVAILABLE`**, new in the shared catalog.

### Changed

- **Every up-front `afd-batch` or `afd-pipe` step runs on the input validated up front** (#1414), not only one whose command declares a policy, so a step gated only by the approval middleware's list, whose schema has a random or clock-based default, runs on the input the person approved.
- **`create_approval_middleware`'s `commands` is optional.**
