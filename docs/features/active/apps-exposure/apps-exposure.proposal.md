# The `apps` exposure flag

> **Goal:** let one app call another app's command only when both sides agree: the callee's
> command says other apps may call it, and the host has given the caller a grant naming it. Every
> other app-to-app call is refused the same way, so a caller learns nothing about commands it may
> not call.

| Field | Value |
| --- | --- |
| Status | Active. Proposed and implemented together on 2026-11-18 for Loam's phase 5, step 0b: the spec, TypeScript and Rust. Python and C++ parity is [#1513](https://github.com/lushly-dev/afd/issues/1513). Progress in [STATUS.md](./STATUS.md) |
| Author | jasfalk (drafted with Claude) |
| Origin | [#884](https://github.com/lushly-dev/afd/issues/884); Loam's decision D30 (2026-10-31), annotated by D65 and D152; Loam's [phase 5 specification](../../../../endpoints/loam/docs/phases/5-copilot/spec.md), sections 7.5, 9 and 13 |
| Spec | [`spec/command-metadata.md`](../../../../spec/command-metadata.md): the `expose` row and [App-to-app calls](../../../../spec/app-calls.md); [`spec/error-codes.md`](../../../../spec/error-codes.md) (`CALL_NOT_GRANTED`); [`spec/plugin-manifest.md`](../../../../spec/plugin-manifest.md) and [`spec/plugin-manifest.core.v2.json`](../../../../spec/plugin-manifest.core.v2.json) |
| Packages | `spec/`, `@lushly-dev/afd-core` (the flag, the interface, the registry check), `@lushly-dev/afd-server` (`createAppCallRegistry`), the `afd` crate |
| Vectors | [`spec/vectors/app-calls.json`](../../../../spec/vectors/app-calls.json) |
| Related | [Unknown and unexposed commands (D4)](../../../../spec/error-codes.md#unknown-and-unexposed-commands-d4), [declared context fields](../../../../spec/context-fields.md), the [shared plugin manifest](../../../../spec/plugin-manifest.md) and its [plan's step 4](../../complete/plugin-manifest/STATUS.md) |

## The problem

AFD's `expose` says which surfaces list and run a command: the palette, the in-app agent, MCP and
the CLI. None of them is another app. Loam runs several apps in one shell, and phase 5 needs one
app to call another's command: mail's native app calls its own engine, and milestone B lets a
checklist read tally's count. Today Loam refuses every such call at its port with
`CALL_NOT_GRANTED` (phase 1, 4.3), because nothing on the callee's side says it agrees.

D30 settled the rule: an app-to-app call needs both the callee's declaration and the caller's
grant, and the kernel checks both. The grant is the host's: a Loam manifest's `calls` grant, which
the deployer accepts when installing the app. The declaration belongs to the command, beside its
other exposure flags, so it is AFD's, and it must mean the same in every language and in the shared
plugin manifest. A mounted instance's declaration is its instance entry (D65), so milestone A needs
no AFD change; a native callee needs this one.

## Jobs

| # | Job | Done when |
| --- | --- | --- |
| J1 | **An app offers a command to other apps.** Tally lets other apps read its count, and nothing else | `tally-get` sets `expose.apps`; no other tally command is callable from an app, however it is granted |
| J2 | **A granted app calls it.** Checklist holds a `calls` grant naming `tally-get` | The call runs, through the same validation and middleware as any other |
| J3 | **An ungranted app cannot.** Hello holds no grant, or a grant for another command | `CALL_NOT_GRANTED`, and the command does not run |
| J4 | **A refusal tells the caller nothing.** Hello calls a command that does not exist, one not exposed to apps, one it is not granted, with valid or invalid input | The same `CALL_NOT_GRANTED`, byte for byte, before lookup, validation or middleware |
| J5 | **Nothing changes for anyone else.** An existing command, an existing manifest, a palette, agent, MCP or CLI call | Unchanged: the flag is off by default and only the `apps` interface reads it |

Each job is a case in the vectors (below), so a language proves it by running them.

## Design

### The flag

`expose` gains `apps`, a boolean, default `false`. It is the callee's declaration that another app
may call the command. No other flag implies it, and no profile or host default turns it on: a
command reaches other apps only when its own definition says so.

### The interface

`apps` joins `palette`, `agent`, `mcp` and `cli` as an interface a call can name (TypeScript
`context.interface`, Rust `context.interface`, Python `context.extra["interface"]`, C++
`context.surface`). Only a host's trusted code names it, for a call it received from an app it has
identified. The caller's identity is the host's: a declared context field such as Loam's `caller`,
which the journal keeps. AFD adds no field for it, so no host's existing field name is taken.

### The grant

The registry takes a host predicate, `callGrant(command, context)`, that answers whether the caller
in `context` holds a grant naming `command`. AFD does not define a grant's shape: Loam's is a
manifest's `[[calls]] app = "<app>"` with `commands = [...]`, another host's may differ. The
predicate is synchronous and reads only what the host's trusted code put on the context. Without
one, every app call is refused.

### The check

A call whose interface is `apps` runs only when all three hold:

1. the command exists for the caller;
2. it sets `expose.apps`;
3. `callGrant` returns exactly `true`.

Otherwise it returns `CALL_NOT_GRANTED`, `retryable: false`, with one fixed message and suggestion
that name neither the command nor the reason. The check comes first, before lookup suggestions, the
active context, input validation, declared context fields, middleware and the handler, so a missing
command, an unexposed one, an ungranted one and invalid input all give the same bytes (J4). It is
the `apps` interface's form of [D4](../../../../spec/error-codes.md#unknown-and-unexposed-commands-d4):
an app is an untrusted caller, like a remote one, so it cannot tell "does not exist" from "may not".
A predicate that throws or panics is refused the same way. It runs before the declared context
fields are validated, so it checks the type of what it reads, and a request's own values never
reach it: Rust drops a batch request's `context` for an `apps` call.

A granted call then runs like any other, with `apps` as its interface, so middleware and the
journal see who called through the host's field. Batches and pipelines check each command they run.
A replay of a journaled app call runs the check again.

### TypeScript's registry for app calls

Loam's kernel runs commands through `createDirectRegistry`, whose bundle is on every host's first
paint with 29 bytes to spare, so the check is not in it. `createAppCallRegistry(commands, {
callGrant, ...options })` wraps one, runs the check before anything else, serves no tool surface,
and answers `hasCommand` with `true` for every name. A host that never imports it bundles none of
it. Everything else that could answer an app first refuses the `apps` interface, fail closed:
`createDirectRegistry` throws for it unless `createAppCallRegistry` built it, through an options
key that is a module-private symbol; `DirectClient` and `DirectTransport` refuse to wrap an app-call
registry, since their `allow` option, middleware and `tools/list` answer before the registry;
`createMcpServer`'s in-process `execute` and `executePipeline` refuse an `apps` context with the one
refusal; and `replayJournal` replays an app call only on a target whose interface is `apps`, where
the grant is checked again. The cost on `/direct`'s smallest host is 104 bytes, and its budget
rises from 39,400 to 39,500 under D115; Loam's first paint grows about 110 bytes and its kernel
about 110, within their limits.

### The manifest

The shared plugin manifest's core reserved `expose.apps` in version 1 "until core version 2". Core
version 2 ([`plugin-manifest.core.v2.json`](../../../../spec/plugin-manifest.core.v2.json)) defines
it as a boolean with AFD's meaning. Version 2 only adds that key: every other definition is
version 1's, which a test holds. Profiles stay on version 1 until their host adopts version 2 with
a new manifest version; Loam's does so in phase 5's milestone B (step 10). A profile that adopts it
MUST NOT default `apps` to `true`.

## Decisions made here

D30 fixed the rule. These details were left to this proposal:

| # | Decision | Why |
| --- | --- | --- |
| X1 | The grant is a host predicate, not a shape in AFD | Grants are each host's (`calls` is not in the shared grant names); a predicate fits Loam's manifest and any other host's |
| X2 | The caller is the host's declared context field, not a new reserved context name | Loam already declares `caller`; reserving a name would break it, and the predicate sees the whole context |
| X3 | One refusal, before lookup and validation, with no name in it | Phase 1's port already answers this way (E2), and D4 does for remote callers; J4 |
| X4 | `CALL_NOT_GRANTED` joins AFD's catalog | Loam's code becomes AFD's when AFD emits it; one meaning across hosts |
| X5 | The flag defaults to `false` in every profile, unlike C5's other flags | Exposure to other apps widens what an install can reach; the callee must opt in |
| X6 | No predicate means no app call | Fail closed |
| X7 | Core version 2 is version 1 plus `expose.apps` | The versioning rule: a new core version only adds |
| X8 | TypeScript's app calls get their own registry, `createAppCallRegistry` | The check in `createDirectRegistry` cost 772 bytes on every host's first paint, past `/direct`'s budget and Loam's; this way it costs 104 on `/direct` and 109 on Loam's kernel |

## Conformance

`spec/vectors/app-calls.json` holds two sections:

- `exposure`: an `expose` object and whether it exposes the command to `apps`;
- `calls`: one registry per case, with its commands, their `expose`, the names `callGrant` grants
  and whether a predicate is installed, then a call with its interface and input and what it must
  return: the command's data, or the exact `CALL_NOT_GRANTED` error.

TypeScript runs the cases on the core registry and on `createAppCallRegistry`, Rust on
`CommandRegistry`, Python on `CommandRegistry` and `MCPServer`, and C++ on `CommandRegistry`. All
four languages pass every case with `gaps: {}`.

## Parity

All four implementations provide the same flag, `apps` interface, `callGrant` / `call_grant`
predicate, `CALL_NOT_GRANTED` refusal before lookup and validation, and grant-checked journal
replay (TypeScript and Rust initially; Python and C++ completed in
[#1513](https://github.com/lushly-dev/afd/issues/1513)). Direct clients (`DirectClient`,
`DirectCommandRegistry`, `SimpleRegistry`) refuse `apps` calls, and journal replay on targets that
cannot check grants refuses recorded `apps` entries before any handler runs.

## Out of scope

- **Loam's part:** the `calls` grant in Loam's manifest, its port, the journal's `call-refused`
  event and the profile's move to core version 2. Phase 5's milestone B, step 10.
- **Listing what an app may call.** An app is never shown another app's commands by AFD; a host
  that offers a list builds it from its grants.
- **App calls over MCP.** `apps` is an in-process interface. The MCP server keeps `mcp`.
- **Nested calls.** Whether an app's handler may call a third app while running for another is the
  host's (Loam's taint rules, its 5.3).
