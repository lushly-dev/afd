---
'@lushly-dev/afd-core': minor
'@lushly-dev/afd-server': minor
---

App-to-app calls and the `apps` exposure flag (`spec/command-metadata.md`, "App-to-app calls"; Loam phase 5 step 0b, D30).

- `ExposeOptions.apps` (default `false`) is a command's declaration that another app may call it, and `apps` is a new `context.interface` a host names for an app's call.
- `createCommandRegistry({ callGrant })` and the new `createAppCallRegistry(commands, { callGrant, ...options })` (in `@lushly-dev/afd-server` and `/direct`, with the `CallGrant` type) take the host's check of the caller's grants. A call with the `apps` interface runs only when the command sets `expose.apps` and `callGrant(command, context)` returns `true`; anything else, including a missing or unexposed command and invalid input, gets one fixed `CALL_NOT_GRANTED` refusal (`ErrorCodes.CALL_NOT_GRANTED`, new in the shared catalog) before lookup, validation and middleware. `createAppCallRegistry` serves no tool surface and answers `hasCommand` for every name, so a `DirectClient` over it never lists names.
- Everything without the grant check refuses the `apps` interface: `createDirectRegistry` throws for it (its `interface` option's type leaves it out), `DirectClient` and `DirectTransport` refuse to wrap an app-call registry, `createMcpServer`'s in-process `execute` and `executePipeline` answer `CALL_NOT_GRANTED`, and `replayJournal` replays an app call only on a registry whose interface is `apps`.
