---
"afd-spec": patch
---

The retry middleware does not repeat a command that declares `mutation: true` unless the host passes the explicit option (`retryMutations: true` or the language's spelling), since a `TIMEOUT` or `TRANSIENT_ERROR` a handler returned does not prove the change was not applied. It reads the declaration from the command the engine runs, never from its name, and counts a call whose declaration it cannot read as a mutation (`spec/execution-controls.md`, "The retry middleware and mutations"). `vectors/execution-controls.json` gains three `retryMutation` cases: a read, a mutation, and a mutation with the option.
