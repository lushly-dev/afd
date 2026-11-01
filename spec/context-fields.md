# Declared context fields

Some values belong to a request rather than to any one command's input: the workspace and project
a shell is scoped to, the space a query targets, the app that made a call, the agent session and
turn behind it, a locale. A host declares each such value as a **context field**: a name, the
`_meta` key a caller sends it in, a schema, and whether the journal keeps it. AFD validates the
value and puts it in the command context, so a handler reads it the same way on every surface, and
the journal records the ones declared safe to keep, so a call that depends on them replays.

Proposal and status: [`docs/features/complete/declared-context-fields/`](../docs/features/complete/declared-context-fields/proposal.md).

## Declaration

A server or registry option declares the fields, for example in TypeScript:

```ts
contextFields: [
  { name: 'scope', meta: 'dev.loam/scope', schema: ScopeSchema, journal: true },
  { name: 'locale', meta: 'dev.example/locale', schema: z.string().max(35) },
]
```

| Property | Rule |
|---|---|
| `name` | The command-context key the value lands under: a context property in TypeScript, `extra[name]` in Python, Rust and C++. A non-empty string. Declaring a reserved name (below), or one name twice, fails at registration |
| `meta` | The `_meta` key a caller sends the value in over MCP. It needs a reverse-DNS prefix, `<label>(.<label>)+/<name>`, so hosts cannot collide; MCP itself makes the prefix optional. The `dev.afd/` prefix, and every prefix with a label of `modelcontextprotocol` or `mcp`, are refused, as is one `meta` key twice |
| `schema` | Validates the value: JSON Schema in the spec; Zod, Pydantic, serde or the C++ validator per language. The value must be JSON |
| `journal` | `true` records the value in the journal ([`journal.md`](./journal.md#declared-context-fields)). Default `false`. Only a field that never carries a secret may set it |
| `required` | Default `false`. A call without a value for a required field fails, except a call to one of AFD's own commands (named `afd-*`), so a client can discover the fields before it sends them |

Reserved names are those the command context already uses: `actor`, `approval`, `auth`, `clock`,
`credentials`, `interface`, `outputBudget` ([output budgets](./output-budgets.md#b4-the-handler-fits-its-output)), `random`, `session`, `signal`, `source`, `timeout`, `traceId`, and any
other key the implementation sets itself (in Python, Rust and C++, their snake_case forms, the
context's own fields and the keys their routers set).

A field whose value is absent or `null` has no value: it is not validated or journaled, and it
fails a required field.

## Values

A call's value for a field is validated against the field's schema before middleware and the
handler run, on every surface:

- **In process.** A direct registry or server `execute` call carries the value on the call
  context, under `name`. The same declaration validates it, so a call made in process and the same
  call made over MCP see the same values.
- **MCP `tools/call`, both eras, stdio and HTTP.** The server reads `params._meta[meta]`. Undeclared
  `_meta` keys are still dropped.
- **AFD's HTTP lanes.** `/message` reads `tools/call`'s `params._meta`, as MCP does. `/rpc` reads
  `params._meta`, and `/stream` the `_meta` member of its JSON input, and both leave `_meta` out of the
  command input. `/batch` reads the `_meta` member of the request body.
- **Batches and pipelines.** The request's values apply to every item and step.

An invalid value, or a missing required one, fails the call with `VALIDATION_ERROR` before the
handler runs. The error's details name the field and its `_meta` key, and its suggestion gives the
expected shape. No new error code is added.

**Trusted code wins.** A value the host's own code sets for the same name (TypeScript
`createContext`, Rust's context hook, or the in-process caller) is never overwritten by a value from
`_meta`. Declared fields are read from `_meta` only, never from HTTP headers.

**Tool lists do not vary.** Unlike `_meta["dev.afd/context"]`, a declared field never changes
`tools/list`, so its cache hint is unaffected. An AFD context is not a declared field: the server
reads `dev.afd/context`, `dev.afd/confirm` and the declared keys in one `_meta` step, but contexts
change the tool list and have enter and exit commands, and fields do neither.

## Trust

A declared field is a claim made by the caller. A handler may use it to narrow what it does, such as
choosing a project or a space, and never to grant anything. Authorization still comes from the actor
and verified credentials, as for actors (#431): neither server takes a caller-declared actor from
`_meta`. A handler that acts on a claimed scope checks the caller's access to it first.

## Discovery

`server/discover` lists the declared fields under `_meta["dev.afd/context-fields"]`, and `afd-help`
returns the same list as `contextFields` in its data: an array of
`{ "name", "meta", "schema", "required", "journal" }`, with `schema` as JSON Schema, so clients and
agents know what to send. Both are omitted when no field is declared.

## Clients that cannot set `_meta`

The meta-tools (`afd-call`, `afd-batch`, `afd-pipe`, `afd-discover`, `afd-detail`) take an
optional `meta` argument, advertised in [`meta-tools.json`](./meta-tools.json), for clients that
cannot set `_meta` (#466, recorded in [`command-metadata.md`](./command-metadata.md#decisions-on-the-tool-surface-466)):

- Its keys are `dev.afd/context`, `dev.afd/outputBudget` (an output-budget ask,
  [B2](./output-budgets.md#b2-the-ask)) and the declared fields' `_meta` keys. Other keys are
  dropped, as undeclared `_meta` keys are. [`meta-tools.json`](./meta-tools.json)'s description of
  `meta` names `dev.afd/outputBudget` once every language accepts it. `null`, for `meta` or for a value in either
  place, is no value.
- The server removes `meta` from the arguments and applies its keys as if the request had sent
  them in `_meta`, before it reads `_meta`: the context and each field then behave exactly as they
  would from `_meta`, in each era. A value trusted code sets still wins.
- A key sent both in `_meta` and in `meta` must have the same JSON value, or the call fails with
  `VALIDATION_ERROR` whose details name the key (`{ "meta": "<key>" }`). A `meta` that is not an
  object fails with `VALIDATION_ERROR` too (`{ "argument": "meta" }`).
- On `afd-discover` and `afd-detail` only `dev.afd/context` has an effect, because declared fields
  never change the tool surface.
- In process (a TypeScript direct registry with a tool surface), the `activeContext` call option
  and the declared fields' values on the call context stand for `_meta`.

Other tools take no `meta` argument: a command's own input keeps a `meta` property it declares.

## Status

| Language | Declaration and in-process values | Journal | `_meta` delivery and discovery |
|---|---|---|---|
| TypeScript | `createMcpServer`, `createMcpHandler` and `createDirectRegistry` take `contextFields` | Recording middleware and `replayJournal` | Yes: both eras over Streamable HTTP and stdio, `/message`, `/rpc`, `/batch` and `/stream`; `server/discover` and `afd-help` |
| Python | `create_server` takes `context_fields` (`afd.server.ContextField`) | `create_journal_middleware` and `replay_journal` | Yes: both eras over Streamable HTTP, SSE and stdio (no AFD-native HTTP lanes, no host-context hook); `server/discover` and `afd-help` |
| Rust | `CommandRegistry::set_context_fields` (`afd::context_fields::ContextField`, JSON Schema) | The registry's journal recorder and `replay_journal` | Yes: both eras over Streamable HTTP and stdio; the context hook wins; `server/discover` and `afd-help` |
| C++ | `CommandRegistryOptions::context_fields` and `CommandRegistry::create`, which reports a bad declaration | `create_journal_middleware` and `replay_journal` | N/A: no MCP server |
