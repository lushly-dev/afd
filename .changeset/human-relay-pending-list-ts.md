---
"@lushly-dev/afd-server": minor
---

Add `HumanRelay.pendingList(call)` pending-list fallback (`PendingListOutcome`, `RelayPending`, `isDecisionId`) for clients without URL-mode elicitation (`spec/command-metadata.md`, "The pending list"; #2722), and enforce the stricter ASCII DNS / bracketed IPv6 host, 1–65535 port, and `[A-Za-z0-9_-]{1,128}` decision-id guarantees in both pending-list and URL-mode flows.
