# App-to-app calls

Profile: `app-calls`. This page belongs to the `app-calls` profile of the
[contract registry](./registry.md): an implementation that does not claim the profile need not
implement it. A registry claims it when a host can give it a `callGrant` for the `apps` interface.

A host that runs several apps, such as Loam, lets one app call another's command only when both
sides agree: the callee's command sets `expose.apps`, and the host has given the caller a grant
naming it ([proposal](../docs/features/active/apps-exposure/apps-exposure.proposal.md)).

- **The flag.** `expose.apps` is the callee's declaration that another app may call the command.
  It defaults to `false`, no other flag implies it, and a host or manifest profile MUST NOT default
  it to `true`.
- **The interface.** `apps` is an interface a call can name, beside `palette`, `agent`, `mcp` and
  `cli`. Only a host's trusted code names it, for a call it received from an app it has identified.
  Who called is the host's to record, in a [declared context field](./context-fields.md) such as
  Loam's `caller`; AFD reserves no context name for it.
- **The grant.** The registry takes a host predicate, `callGrant(command, context)`, that answers
  whether the caller in `context` holds a grant naming `command`. AFD does not define a grant's
  shape. The predicate is synchronous and reads only what trusted code put on the context. It runs
  before the declared context fields are validated, so it checks the type of what it reads. A
  registry without one refuses every app call. A request's own values never reach it: an app's
  batch carries no context the predicate reads (Rust drops a batch request's `context` for an
  `apps` call).

A call whose interface is `apps` runs only when the command exists for the caller, sets
`expose.apps`, and `callGrant` returns `true`; a value other than `true`, a throw or a panic is a
refusal. Otherwise the call returns this failure, the same bytes in every case:

```json
{
  "code": "CALL_NOT_GRANTED",
  "message": "This app may not call that command",
  "suggestion": "Ask the deployer for a calls grant that names the command; the command must also set expose.apps",
  "retryable": false
}
```

The check comes first: before lookup and its suggestions, the active context, input validation,
declared context fields, middleware and the handler. So a command that does not exist, one not
exposed to apps, one the caller is not granted, and any of these called with invalid input all
answer alike, so the caller learns nothing about commands it may not call. This
is the `apps` interface's form of [D4](./error-codes.md#unknown-and-unexposed-commands-d4): an app
is an untrusted caller. A granted call then runs as any other, with `apps` as its interface. A batch
or pipeline checks each command it runs; a refused one fails as that item or step.

Listings by exposure (TypeScript `listByExposure('apps')`, `createAppCallRegistry`'s
`listCommands`) hold the commands exposed to apps, whatever any caller is granted. A host never
shows an app another app's commands from them; it builds a list from its grants.

TypeScript's in-process registry for app calls is `createAppCallRegistry(commands, { callGrant,
...options })`, `createDirectRegistry`'s options less `interface` and `tools`. It throws without
`callGrant`, serves no tool surface (an app calls commands one by one), and answers `hasCommand`
with `true` for every name. Whatever cannot run the check refuses the `apps` interface rather
than answer an app: `createDirectRegistry` throws for it; `DirectClient` and `DirectTransport`
refuse to wrap an app-call registry, since their `allow` option, middleware and `tools/list` would
answer first; and `createMcpServer`'s in-process `execute` and `executePipeline` give the one
refusal.

A journaled app call replays with the `apps` interface, so the replaying registry runs the check
again and needs the same `callGrant` ([journal replay](./journal.md#replay)); a target that cannot
check it refuses the entry before any handler runs, whatever context the replay adds (TypeScript:
any target but `createAppCallRegistry`, the core registry included; Python: any target but
`CommandRegistry` or `MCPServer`; C++: any bare `CommandExecutor`). In Rust, `ExposeOptions`
serializes `apps` only when it is `true`, so a serialized default stays valid where core manifest
version 1 refuses the key. A refusal is returned before
middleware, so AFD's journal middleware never records one; a host that journals refusals, as Loam
does, records it where it receives the app's call.

The shared plugin manifest carries the flag from [core version 2](./plugin-manifest.md#k5-exposure).

<!-- generated:capabilities:spec.app-calls.status:start -->
|  | TypeScript | Python | Rust | C++ |
| --- | --- | --- | --- | --- |
| App-to-app calls (`expose.apps`, `apps` interface, `CALL_NOT_GRANTED`) | Yes (`ExposeOptions.apps`, `createCommandRegistry({ callGrant })` and `createAppCallRegistry` in `@lushly-dev/afd-server` and `/direct`) | Yes (`ExposeOptions.apps`, `create_command_registry(call_grant=...)` and `create_server(..., call_grant=...)`) | Yes (`ExposeOptions::apps`, `CommandInterface::Apps` and `CommandRegistry::set_call_grant`) | Yes (`ExposeOptions::apps`, `Interface::apps`, `CommandRegistryOptions::call_grant` and `CommandRegistry::set_call_grant`) |
<!-- generated:capabilities:spec.app-calls.status:end -->

The cases are in [`vectors/app-calls.json`](./vectors/app-calls.json).
