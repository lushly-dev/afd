---
"afd-python": minor
---

### Added

- **The relay's pending list for clients without URL-mode elicitation (`spec/command-metadata.md`, "The pending list"; [#2723](https://github.com/lushly-dev/afd/issues/2723)).** `HumanRelay` supports an optional `pending_list(call)` method (sync or async, defaulting to `None`, which keeps today's refusal), alongside `RelayPendingDecision`, `PendingListOutcome`, and `is_decision_id`. Asked only when the client did not declare URL-mode elicitation, after validation and stop answers (`decline`/`cancel`) and before `begin`/`resume`. `RelayPendingDecision` fails with `CONFIRMATION_REQUIRED`, `retryable: true`, `recovery: external`, and `details: { commands, reason: "pending-list", decision, url, list }`; `RelayApproved` runs the command through the same relay evidence and `approved_context` path as `resume`; `RelayDeclined` returns `CONFIRMATION_DECLINED`. URL mode now enforces the same ASCII DNS / bracketed IPv6 host, 1–65535 port, and `[A-Za-z0-9_-]{1,128}` `decision_id` guarantees.
