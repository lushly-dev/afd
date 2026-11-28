---
"afd-spec": patch
---

TypeScript (#2722) and Python (#2723) now implement `HumanRelay`'s pending-list fallback, enforce the stricter ASCII DNS / bracketed IPv6 host, 1–65535 port, and `[A-Za-z0-9_-]{1,128}` decision-id guarantees in URL mode too, and execute `spec/vectors/human-relay.json` directly (`typescript` and `python` removed from `gaps`).
