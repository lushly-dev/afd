# Declared context fields

> **Goal**: Let a host declare named, schema-validated values that a caller
> sends with each request, `_meta` over MCP and the call context in process,
> so they reach the command context on every surface; and let the journal
> record the ones declared safe to keep, so a call that depends on them
> replays.

| Field | Value |
|---|---|
| Status | Approved by the owner 2026-10-31, with its open questions decided (see [Decisions](#decisions)) and the order in [Effort and order](#effort-and-order). Tracked in [#528](https://github.com/lushly-dev/afd/issues/528). Progress is in [STATUS.md](./STATUS.md) |
| Author | jasfalk (drafted with Claude) |
| Spec | [`spec/journal.md`](../../../../spec/journal.md), [`spec/protocol-conformance.md`](../../../../spec/protocol-conformance.md), [MCP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28) per-request `_meta` |
| Packages | `spec/`, `packages/core`, `packages/server`, `python/`, `packages/rust`, `packages/cpp` (journal only) |
| Related | [Loam architecture, AFD prerequisites](../../../../endpoints/loam/docs/architecture.md#afd-prerequisites), [Umbel spaces (D26)](../../../../endpoints/umbel/docs/decisions.md), [Browser-safe direct registry](../browser-direct-registry/proposal.md) (#527), #466 (meta-tool `context` argument), #523 (Rust per-request context hook, merged 2026-10-31), [Hybrid tool strategy](../hybrid-tool-strategy/hybrid-tool-strategy.proposal.md) (also changes `spec/`), #431 (no caller-declared actor) |

## Why

Some values belong to a request rather than to any one command's input: the
workspace and project a shell is scoped to, the space a knowledge base
query targets, the app that made a call, the agent session and turn behind
it, a locale. Putting them in every command's input schema is repetitive,
and the MCP 2026-07-28 revision removed the sessions they could have lived in.
The revision's answer is per-request `_meta`, and AFD already uses it for
its own two keys. Hosts have no way to declare keys of their own.

Two consumers need it now. Loam carries its scope this way (Loam decision
D31), and its journal must keep the scope, the calling app and the
copilot's session and turn (Loam's architecture, AFD prerequisites). Umbel's spaces have the same shape: every
read and write names a space, or the default space a session or AFD context
binds (Umbel decision D26).

## Today

- **TypeScript.** The MCP server reads two `_meta` keys,
  `dev.afd/context` and `dev.afd/confirm`, and drops the rest
  (`packages/server/src/mcp-modern.ts`, the `tools/call` handler). A host's
  `createContext(req)` sees the HTTP request and its headers, not the
  JSON-RPC `_meta`, and stdio has no request object at all.
- **Python.** The server reads the same two keys and drops the rest.
- **Rust.** `McpServer::with_context_hook`, merged in #523 on 2026-10-31,
  lets a host's hook read `_meta` and set fields imperatively, but nothing
  declares or validates them, and the journal does not keep them.
- **C++.** No MCP server. `CommandContext::extra` holds host values.
- **The journal.** `spec/journal.md` keeps three context values: the actor,
  the interface and the trace ID. For every other context key it hashes the
  name and never the value. The rule is right for secrets, but a scope or a
  space is lost, and replay, which builds its own context, cannot reproduce
  a call that depended on it.
- **Precedent.** Neither server takes a caller-declared actor from `_meta`,
  because any MCP client could claim to be `human` (#431). Declared fields
  keep that rule.

## Proposal

### 1. Declaration

A server or registry option declares each field:

```ts
contextFields: [
  { name: 'scope', meta: 'dev.loam/scope', schema: ScopeSchema, journal: true },
  { name: 'locale', meta: 'dev.example/locale', schema: z.string().max(35), journal: true },
]
```

| Property | Rule |
|---|---|
| `name` | The command-context key the value lands under: a context property in TypeScript, `extra[name]` in Python, Rust and C++. Reserved names are refused at registration: `actor`, `credentials`, `approval`, `interface`, `traceId`, `signal`, `timeout`, `clock`, `random`, `auth` and any key AFD sets itself |
| `meta` | The `_meta` key on MCP requests. AFD requires a reverse-DNS prefix so hosts cannot collide; MCP makes the prefix optional. The `dev.afd/` prefix and every prefix MCP reserves, those whose labels include `modelcontextprotocol` or `mcp`, are refused |
| `schema` | Validates the value: JSON Schema in the spec, and Zod, Pydantic, serde or the C++ validator per language |
| `journal` | `true` records the value in the journal. Default `false`. Only a field that never carries a secret may set it |
| `required` | Default `false`. A required field missing from a request fails the call |

### 2. Delivery

- **MCP `tools/call`, both eras, stdio and HTTP.** The server reads
  `params._meta[meta]`, validates it and sets the field. An invalid value
  fails the call with `VALIDATION_ERROR`: its details name the `_meta` key,
  and its suggestion gives the expected shape. No new error code is added.
  Undeclared `_meta` keys are still dropped.
- **`_meta` only.** Declared fields are not read from HTTP headers, so
  stdio and HTTP share one channel and no rule decides between two
  sources. A gateway that needs a value reads headers in
  `createContext(req)`, where trusted code wins. Whether gateways see
  request values as headers is decided once, for MCP's own mechanism
  (`x-mcp-header` mirrored into `Mcp-Param-*` headers), under #466 item 3.
- **Trusted code wins.** A value that the host's own code sets for the same
  name, through `createContext` in TypeScript or the hook in Rust, is never
  overwritten by a caller's claim.
- **Tool lists do not vary.** Unlike `dev.afd/context`, declared fields
  never change `tools/list`, so its cache hint stays `public`.
- **One reader, two concepts.** The server reads `dev.afd/context`,
  `dev.afd/confirm` and the declared keys in one `_meta` step, but an AFD
  context is not a declared field. Contexts change the tool list and have
  enter and exit commands; declared fields never change `tools/list` and
  never grant anything, and that rule is what makes them safe to accept.
- **Discovery.** `server/discover` and `afd-help` list the declared fields,
  with their `_meta` key, JSON Schema and `required` flag, under
  `_meta["dev.afd/context-fields"]`, so clients and agents know what to
  send.
- **Batches and pipelines.** The request's values apply to every item and
  step.
- **In process.** A direct registry caller sets the field on the call
  context, and the registry validates it against the same declaration. A
  call made in process and the same call made over MCP see the same values.
- **AFD's HTTP lanes.** `/rpc`, `/batch` and `/stream` accept the same
  `_meta` object in their request body.

### 3. Trust model

A declared field is a claim made by the caller. A handler may use it to
narrow what it does, such as choosing a project or a space, and never to
grant anything. Authorization still comes from the actor and the verified
credentials MCP Authorization proposes. The spec states the rule. The
`afd-typescript` and `afd-python` skills show a handler that checks the
caller's access to the claimed scope before using it.

### 4. The journal

- **Entry.** An entry gains an optional `context` object holding each field
  declared `journal: true` that had a value: `{"scope": {...}}`. It is
  omitted when empty, so existing entries are unchanged.
- **Size.** Each journaled value is capped at 4 KiB of canonical JSON. A
  larger value is left out of `context`, and its name is listed in the
  entry's optional `contextOmitted` array, so the entry stays bounded, the
  omission is visible and every value in `context` is real.
- **Hash.** When `context` or `contextOmitted` is present, the hashed object
  gains the same members, and the journaled names leave `keys`. When both
  are absent, the hashed object is exactly today's, so the hashes in the
  existing entries and in `spec/wire/journal.jsonl` still hold.
- **Replay.** The replaying surface restores `context` into the replay
  context, validated against the current declarations, and warns for each
  name in `contextOmitted`. A field that is no longer declared is dropped
  with a replay warning.
- **Redaction.** `redact` sees `record.context` and may drop it, as it may
  drop inputs today.

### 5. Clients that cannot set `_meta`

Issue #466 notes that many MCP clients cannot set `_meta`, which already
limits `dev.afd/context`. The owner decided on 2026-10-31 that #466 item 2
takes one `meta` object rather than a `context` argument, so a single
argument carries the AFD context and every declared field:

- `afd-call`, `afd-batch` and `afd-pipe` accept an optional `meta`
  argument. Its keys are `dev.afd/context` and the declared fields' `_meta`
  keys, and it applies as if sent in `_meta`, with the same validation.
- `afd-discover` and `afd-detail`, the other two meta-tools #466 lists,
  accept it too. Only `dev.afd/context` has an effect there, because
  declared fields never change the tool surface.
- A key sent both in `_meta` and in `meta` must agree, or the call fails
  with `VALIDATION_ERROR`.

`spec/command-metadata.md` records the decision when #466 is implemented.
The argument ships with #466, not as part of this proposal's "Done when",
so the rest of this proposal does not wait on #466's other two items.

## Parity

| Language | Delivery | Journal |
|---|---|---|
| TypeScript | Reference: `createMcpServer`, `createMcpHandler` and `createDirectRegistry` take `contextFields` | Recording middleware and `replayJournal` |
| Python | The server factory already parses `_meta` for `dev.afd/confirm` and reads declared keys the same way | `afd.core.journal` and `replay_journal` |
| Rust | `McpServer::with_context_fields`, built on #523's context hook | The registry's journal recorder and `replay_journal` |
| C++ | No MCP server; hosts set `extra[name]` | `create_journal_middleware` and `replay_journal` read and write `context` |

The spec, the fixtures and the TypeScript reference land first. The other
languages follow in the order the parity plan sets.

## Spec changes

- `spec/journal.md`: the entry's `context` and `contextOmitted` fields, the
  hashing rule, the cap and replay.
- A new `spec/context-fields.md`: declaration, reserved names, `_meta`
  delivery, precedence, discovery, the trust rule and the meta-tool
  argument.
- `spec/wire/journal.jsonl`: new lines with a `context`. The existing lines
  are unchanged.
- `spec/protocol-conformance.md`: rows for delivery on both eras and over
  stdio and HTTP, for refusing undeclared and reserved keys, and for
  precedence.
- `spec/VERSION`: a minor bump, and an entry in `spec/CHANGELOG.md`.

## Done when

- A TypeScript server with a declared field delivers the value from `_meta`
  to the handler on both eras over stdio and HTTP. It refuses an invalid
  value with a suggestion, still drops undeclared keys, never overrides a
  value from `createContext`, and keeps `tools/list` unchanged.
- `server/discover` lists the declared fields.
- The journal records a declared field, replay restores it, and the
  existing fixture hashes still match in all four languages.
- Python and Rust pass the same conformance rows; C++ reads, writes and
  replays the new fixture lines.
- `docs/language-parity.md` and the language skills describe the feature.

## Effort and order

L: a contract change across four languages. The TypeScript reference and
the spec are M.

Approved order, 2026-10-31: the spec and the TypeScript reference start
after the [browser-safe direct registry](../browser-direct-registry/proposal.md)'s
parts 1 and 2, because the in-process delivery lands in the registry that
part 1 exports. The other languages follow. The spec change lands in its own
pull request, never alongside the hybrid strategy's, because both edit
`spec/` and bump `spec/VERSION`; whichever merges second rebases and takes
the next minor version.

## Decisions

Decided by the owner on 2026-10-31.

1. **An invalid value returns `VALIDATION_ERROR`**, with the `_meta` key in
   its details and a suggestion that gives the expected shape. Agents
   already recover from it, and a new code would grow the error registry in
   four languages for no difference in behavior.
2. **An oversize value is listed by name in `contextOmitted`**, not marked
   in place. An in-place `{"$omitted": "size"}` would fail schema
   validation on replay and could match a real value of that shape; the
   list keeps every value in `context` real and tells replay which fields
   to warn about.
3. **No HTTP header delivery.** `_meta` is the one channel on stdio and
   HTTP. Gateways read headers in `createContext(req)`, and header
   mirroring for gateways is decided once, under #466 item 3.
4. **AFD contexts stay separate from declared fields.** The server shares
   one `_meta` reader for both, but contexts change the tool list and
   fields never do.
5. **Clients that cannot set `_meta` use one `meta` argument on the
   meta-tools**, recorded under #466 item 2 (section 5).
