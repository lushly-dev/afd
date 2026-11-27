---
"afd-spec": patch
---

Host-verified confirmation (`spec/command-metadata.md`, "The pending list"): a `HumanRelay` may answer an optional `pendingList(call)` for a client that does not declare URL-mode elicitation. The relay names a pending decision and the person's list of pending decisions, and the call fails with `CONFIRMATION_REQUIRED`, `retryable: true` and `details.reason: "pending-list"`. Once the person approves, the same call sent again runs once, with the same relay evidence as a resumed approval. A relay that does not answer keeps today's refusal. The catalog (`spec/error-codes.md` and `vectors/error-codes.json`) now lists `CONFIRMATION_REQUIRED` as retryable "varies", and `vectors/human-relay.json` pins the refusal and the addresses that are an internal error instead. Additive, so the version stays.
