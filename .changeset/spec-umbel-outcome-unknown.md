---
"afd-spec": patch
---

`spec/error-codes.md`'s `OUTCOME_UNKNOWN` row notes that a server may send the code for a command it stopped waiting for that may still run, as Umbel does for a compiled-plugin call past its deadline, and lists Umbel among its sources.
