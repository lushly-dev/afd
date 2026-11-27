# Contexts

Profile: `contexts`. This page belongs to the `contexts` profile of the
[contract registry](./registry.md): an implementation that does not claim the profile need not
implement it. A server claims it when it can be configured with contexts.

A context scopes which commands an agent sees and can call: a command that declares `contexts`
([command metadata](./command-metadata.md#fields)) is available only while one of them is active.
With no active context, every command is available. A server without configured contexts ignores
the field.

Every rule here is normative. **MUST**, **MUST NOT**, **SHOULD** and **MAY** are used as in
RFC 2119. The rules were written on the pages listed under [Where the rules sit](#where-the-rules-sit)
and are gathered here, so the profile has one page.

## The active context

- **MCP 2026-07-28.** The active context is request input, `_meta["dev.afd/context"]`, and is never
  stored. A client that cannot set `_meta` sends it in the meta-tools' `meta` argument
  ([context fields](./context-fields.md#clients-that-cannot-set-_meta)).
- **MCP 2025 sessions.** A session keeps a context stack, 16 levels deep by default, changed by the context
  tools. Each session's stack is its own
  ([protocol conformance](./protocol-conformance.md#acceptance-index)).
- **In process.** A TypeScript direct registry with a tool surface takes an `activeContext` call
  option in place of `_meta`.

## The context tools

`afd-context-list`, `afd-context-enter` and `afd-context-exit` are registered as MCP-exposed
commands (category `bootstrap`) when the server configures contexts
([tool strategies, Terms](./tool-strategies.md#terms)). They appear among the commands wherever
the server registers them. `afd-context-enter` and `afd-context-exit` change a 2025 session's
stack; over HTTP without an MCP session to hold it, they fail with `SESSION_REQUIRED`.

## Dispatch

An active context that names a context the server does not configure fails before command lookup
with `CONTEXT_NOT_FOUND` (dispatch stage 1), and a command outside the active context fails with
`COMMAND_NOT_IN_CONTEXT` before confirmation and validation (stage 4;
[dispatch](./dispatch.md#precedence-of-pre-execution-checks)).

## The tool strategies

- **`individual` and `grouped`** list only the commands available in the active context.
- **`lazy`** lists the same tools in every context, as `hybrid` does.
- **`afd-discover` and `afd-detail`** report only the commands available in the active context.
- **Every strategy** answers a call to an exposed command outside the active context, by its own
  name or through a meta-tool, with `COMMAND_NOT_IN_CONTEXT` and the suggestion "Use
  afd-context-list to see available contexts, or afd-context-enter to switch."

## The hybrid strategy

This is rule H4 of the [hybrid strategy](./tool-strategies.md#hybrid).

A hybrid `tools/list` MUST NOT vary by the active context. A first-class command outside the active
context stays listed, and a call to it MUST answer `COMMAND_NOT_IN_CONTEXT` with the suggestion
"Use afd-context-list to see available contexts, or afd-context-enter to switch.", as a call
through `afd-call` does. `afd-discover` and `afd-detail` keep filtering by context.

This differs from the individual and grouped strategies on purpose: a list that depends only on the
server's configuration can be cached ([H6](./tool-strategies.md#h6-cache-hints-and-listchanged)).

`afd validate` SHOULD warn when a first-class command declares `contexts`: it is listed everywhere
but callable only in its contexts.

## Error codes

`COMMAND_NOT_IN_CONTEXT`, `SESSION_REQUIRED`, `CONTEXT_NOT_FOUND` and `CONTEXT_DEPTH_EXCEEDED`
([error codes, contexts](./error-codes.md#contexts-profile-contexts)), with the structured recovery
[recovery](./recovery.md#engine-errors) gives each.

## Conformance

The registry assigns these cases to this profile: the `context_*` tests of
[`protocol-conformance.json`](./protocol-conformance.json), in both MCP eras; the `out-of-context`
cases of [`vectors/dispatch.json`](./vectors/dispatch.json); and in
[`vectors/tool-strategies.json`](./vectors/tool-strategies.json), the `contexts` and
`contextTools` sections, the `contexts` server and the `context-tool` construction failure. The
core's cases in those files still configure contexts in their setup
([#2904](https://github.com/lushly-dev/afd/issues/2904)).

## Where the rules sit

The dispatch stages are in [dispatch](./dispatch.md), the active context's `_meta` key beside the
declared context fields in [context fields](./context-fields.md), and the context tools' place in
each tool list in [tool strategies](./tool-strategies.md#tool-lists). Those pages are the core's;
each names this profile where a rule applies only to a server with contexts.
