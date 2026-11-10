---
name: afd-typescript
description: >
  Writes AFD commands and MCP servers in TypeScript with @lushly-dev/afd-server:
  defineCommand, createMcpServer, createMcpHandler and the browser-safe /define and
  /direct entries. Use when adding a TypeScript command or server; for an in-process
  agent calling commands, use afd-directclient.
---

# AFD in TypeScript

`packages/server/README.md` is the full reference and `spec/` is the cross-language contract. This page holds what goes wrong without them. Cross-language parity rules are in `docs/language-parity.md`.

## Entry points

| Import | For | Notes |
|---|---|---|
| `@lushly-dev/afd-server` | Node servers: `createMcpServer`, `createMcpHandler`, and everything below | Loads the MCP SDK, `node:http` and `node:tls`, so it cannot go in a browser bundle |
| `@lushly-dev/afd-server/define` | Code that only defines commands: `defineCommand`, `defineCommandWithSchema`, `success`/`failure`/`error`, `zodToJsonSchema`, `defaultExpose` | No MCP SDK, no Node built-in |
| `@lushly-dev/afd-server/direct` | In-process hosts (browser, worker, webview, or Node without the SDK): `/define` plus `createDirectRegistry`, `createDirectToolSurface`, `createApprovalMiddleware`, `createJournalMiddleware`, `replayJournal`, `MemoryJournalSink` and the Node-free middleware | Same guarantee; an esbuild test enforces it |
| `@lushly-dev/afd-server/credentials` | `isVerifiedCredentials`: whether `credentials` are the object afd-server branded after verifying a token; pass it to afd-auth's `createAuthMiddleware` on a token-authorized MCP server | Browser-safe; the server brands the credentials of a request its `auth` option verified, until the request ends |
| `@lushly-dev/afd-core` | Types, result helpers, `ErrorCodes`, `systemClock`/`fixedClock`, `systemRandom`/`seededRandom`, `MemoryJournalSink` | Platform helpers are not in the barrel: import `/platform` or `/connectors` (Node only) |
| `@lushly-dev/afd-core/journal-file`, `/journal-indexeddb` | `FileJournalSink` (Node), `IndexedDbJournalSink` (browser) | |
| `@lushly-dev/afd-client/streamable-http` | A browser calling a remote MCP server: the transport alone | The root entry also loads `McpClient` and `eventsource` |
| `@lushly-dev/afd-view-state`, `/commands` | `ViewStateRegistry`; `createViewStateCommands` (`view-state-get`, `-set`, `-list`) | |

## Defining a command

```typescript
import { z } from 'zod';
import { defineCommand, failure, success } from '@lushly-dev/afd-server';

export const todoUpdate = defineCommand({
  name: 'todo-update',
  description: 'Update a todo item',
  category: 'todo',
  mutation: true,
  expose: { mcp: true },            // MCP is opt-in; see below
  requires: ['todo-list'],          // planning metadata only, never enforced
  contexts: ['task-management'],    // visible only in this context
  input: z.object({ id: z.string(), title: z.string().min(1).max(200).optional() }),
  output: Todo,                     // advertised; results are not validated against it
  errors: ['NOT_FOUND', 'INVALID_INPUT'],
  approval: 'not-required',         // considered and needs none; see Approvals
  async handler(input, context) {   // input is already parsed: defaults applied, transforms run
    const todo = await store.get(input.id);
    if (!todo) {
      return failure({
        code: 'NOT_FOUND',
        message: `Todo ${input.id} not found`,
        suggestion: 'Use todo-list to see available todos',
      });
    }
    return success(await store.update(todo, input), {
      reasoning: `Updated todo "${todo.title}"`,
      confidence: 1,
    });
  },
});
```

- **Exposure.** Remote MCP clients list and call only commands with `expose: { mcp: true }`, on every path: `tools/list`, discovery, `afd-call`, batches, pipelines, `/rpc` and streams. Leaving it out keeps a command private to in-process callers (`server.execute()`, `createDirectRegistry`). Flags left out fall back to `defaultExpose`: `palette` and `agent` on, `mcp` and `cli` off.
- **Error codes.** Prefer the shared catalog (`ErrorCodes` in afd-core, `spec/error-codes.md`) and add an application code in `SCREAMING_SNAKE_CASE` only when none fits. `NO_CHANGES` is not in the catalog. `error(code, message, { suggestion, retryable, details })` is shorthand for `failure({...})`.
- **Suggestions name real commands** in `domain-action` form (`todo-list`, `auth-sign-in`), never dotted names.
- **Handler context.** `context.traceId`; `context.actor` (`{ kind, id?, label?, onBehalfOf? }`); read time from `(context.clock ?? systemClock).now()` and randomness from `(context.random ?? systemRandom).next()`, never `Date.now()` or `Math.random()`, or journal replay cannot match. Anything else on the context comes from your middleware, `createContext` or declared `contextFields`.
- **Log to stderr** (`console.error`): on stdio, stdout carries the JSON-RPC stream.

### Zod input and output

- The advertised JSON Schema (MCP `inputSchema`, `afd-detail`) is generated in input mode: a `.default()` field is optional, and a `.transform()` field shows its input type. The handler receives `z.output`.
- `examples` are typed as `z.input` and checked at define time; a failing example throws.
- `output` schemas are generated in output mode, so defaulted fields are required.
- `z.number().int()` is advertised as `type: 'integer'`.
- `defineCommand({ advertisedInputSchema })` shows a JSON object schema on every surface while `input` still validates; keeping the two consistent is your job.
- Classic Zod commands go into a `ZodCommandDefinition[]` with no cast. A Zod Mini command does not type-check there and needs `as unknown as ZodCommandDefinition`.

## The lean path in a browser bundle

`defineCommand` runs `toJSONSchema` as each module loads and takes classic Zod. Where first paint counts, use `defineCommandWithSchema`: a classic or Zod Mini schema to validate, and the JSON Schema as a literal. A host that defines every command this way and imports only the registry, the journal and the middleware bundles `zod/v4/core` alone.

```typescript
import * as z from 'zod/mini';
import { defineCommandWithSchema, success } from '@lushly-dev/afd-server/define';

export const panelOpen = defineCommandWithSchema({
  name: 'panel-open',
  description: 'Open a panel',
  input: z.object({ id: z.string() }),
  jsonSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  async handler(input) {
    return success({ id: input.id });
  },
});
```

- Import Mini as `import * as z from 'zod/mini'`. esbuild cannot tree-shake `import { z }` and keeps all of Zod, locales and `toJSONSchema` included.
- Nothing compares `input` with `jsonSchema` at run time. Hold each literal equal to `zodToJsonSchema(schema)` in a test.
- `output` is not converted either: pass `outputJsonSchema` to advertise one.
- Importing `defineCommand` or `createDirectToolSurface` brings `toJSONSchema` back, and the tool surface brings classic Zod.
- Mini loads no locale, so `VALIDATION_ERROR` rebuilds the common messages itself; a format keeps its own name (`Invalid email`) and a rarer code says `Invalid input` with the path. Don't assert on that wording where classic Zod may also load.

## Servers

`createMcpServer()` is the standalone server (`start()`, `stop()`, `getUrl()`, `execute()`). `createMcpHandler()` returns a Node request handler for a host that owns the HTTP server; call `handler.dispose()` on shutdown.

- **Transport.** The default `transport: 'auto'` picks stdio whenever stdin is not a TTY. Under Docker without `-t`, systemd, pm2 or CI the HTTP port never opens: set `transport: 'http'` for anything that must listen.
- **Middleware.** Start from `...defaultMiddleware()` (trace IDs, logging, slow-command warnings). Order matters: auth middleware first, then `createApprovalMiddleware`, and `createJournalMiddleware` last.
- **Names.** Creation throws on duplicate names and on names the server owns: `afd-call`, `afd-batch`, `afd-pipe`, `afd-discover`, `afd-detail` always; `afd-help`, `afd-docs`, `afd-schema` with `bootstrap: true`; `afd-context-list`, `-enter`, `-exit` with `contexts`. So don't add `getBootstrapCommands()` to `commands` as well as setting `bootstrap: true`.

### MCP authorization

`auth` on `createMcpHandler` or `createMcpServer` makes the server an OAuth protected resource (`spec/authorization.md`, M1 to M5 and M7): `{ resource, authorizationServers, verifier, scopesSupported?, resourceName? }`, with `verifier: new JwtVerifier({ rules: { resource }, issuers: [{ issuer, algorithms, keys: jwksKeySource(load) }] })`.

- Every HTTP route then needs exactly one `Authorization: Bearer` token, `/health` included; only the RFC 9728 metadata and CORS preflights are public. stdio and `server.execute()` are unaffected.
- AFD opens no socket: `jwksKeySource(load)` calls your `load()` for the issuer's JWKS, and `createIntrospectionVerifier({ introspect })` your RFC 7662 call for opaque tokens.
- Commands get frozen `context.credentials`, never the token. `createContext(req, { credentials })` maps them to an `actor` (default `{ kind: 'agent', id: clientId, onBehalfOf: subject }`) and cannot replace them.
- With afd-auth's middleware on the same server, pass `isVerifiedCredentials` to `createAuthMiddleware`, or every token's call is gated on the adapter's session.
- A host verifier may wrap `JwtVerifier` to refuse more with its own rule code (logged, the same 401), never to accept more.
- Scopes (`requiredScopes`, `resolver`, `filterToolsByScope`) are not enforced yet, and passing one throws.

### Tool strategies

`toolStrategy` defaults to `'grouped'` on the server: one tool per group (`category`, else the first name segment) taking `{ action, params }`. `'individual'` is one tool per command, `'lazy'` lists the five meta-tools only (agents run `afd-discover` → `afd-detail` → `afd-call`), and `'hybrid'` lists the meta-tools, the context tools, then 1 to 8 `firstClassTools`. Every meta-tool is routable in every strategy, and so is any exposed command by its own name. Exact lists and order: `spec/tool-strategies.md`.

- `createDirectToolSurface` defaults to `'individual'`, not `'grouped'`. Pass `strategy` when the in-process list must match a server's.
- `firstClassTools` is required with `'hybrid'` and refused with any other strategy. Creation throws, naming the entry, for one that is unregistered, not `expose.mcp`, reserved, repeated or beyond 8.
- Don't give a first-class command `contexts`: it is listed in every context but callable only in its own. `afd validate --surface` warns.
- Bad meta-tool arguments return `VALIDATION_ERROR`; bad batch and pipeline envelopes return `INVALID_BATCH_REQUEST` and `INVALID_PIPELINE_REQUEST`.

### Contexts

`contexts: [{ name, description }]` scopes which commands are visible and registers the `afd-context-*` tools. Context state belongs to the client: stdio keeps one stack, HTTP `/message` one per `Mcp-Session-Id`, and the stateless 2026-07-28 lane reads `_meta["dev.afd/context"]` per request (its `afd-context-enter` stores nothing and returns `persisted: false`). `server.execute()` ignores contexts. Contexts are not a security boundary; restrict callers with `createContext` and middleware.

In process, `createDirectRegistry(commands, { contexts })` takes the same definitions, and each call names its context in the `activeContext` call option, never registry state. See the afd-directclient skill.

### Confirmations and approvals

- **Confirmations** (`confirmPrompt` plus server `confirmations: 'enforce' | 'require-human'`) gate MCP and HTTP calls only; in-process calls are never gated. Several instances behind one URL share a `confirmationKey`. Contract: `spec/command-metadata.md`, "Confirmations".
- **Approvals.** `approval: 'required'`, `'not-required'` or a function of input and context, enforced by `createApprovalMiddleware({ secret, commands })`. A gated call returns `APPROVAL_REQUIRED` before the handler runs. Pass the same `commands` as the server, or the missing ones are never held. Over MCP the token is withheld from the agent by default; deliver it to the human through `onApprovalRequired`, or use `relay: 'mcp-elicitation'`. A policy function must return `'required'` when the actor is missing. `afd validate` warns (`MISSING_APPROVAL_POLICY`) on a `mutation` or `destructive` command with no policy. The middleware runs on WebCrypto, so `/direct` exports it for browsers, where the secret is visible to page scripts: it stops the model, not page code. See the afd skill's [command trust config](../afd/references/command-trust-config.md) and `spec/command-metadata.md`, "Approvals".

### Context fields, journal and resources

- **`contextFields`** on `createMcpServer` or `createDirectRegistry` declare request-scoped values (`{ name, meta, schema, journal?, required? }`), validated before middleware runs. MCP callers send them in `tools/call` `_meta[meta]`. A field is the caller's claim: use it to narrow, never to grant access. Contract: `spec/context-fields.md`.
- **Journal.** `createJournalMiddleware(sink)` records accepted calls with a tape of the clock and random values each handler read; `replayJournal(target, entries)` reports each entry `same`, `different` or `error`. Context values other than actor, interface, trace ID and fields marked `journal: true` are never stored. `auth-*` commands are skipped by default; use `redact` for other secrets. `IndexedDbJournalSink` holds the Web Lock `<name>:writer`, so a second tab's `append` or `lock()` rejects with `JOURNAL_LOCKED`. Format: `spec/journal.md`.
- **Resources, skills and tool `_meta`** are opt-in: `resources` (a provider or static entries), `skills: new SkillCatalog([...])`, and `defineCommand({ toolMeta })`. A `toolMeta` key needs a prefix of two or more labels (`dev.example/origin`) outside `dev.afd/` and MCP's reserved prefixes, or is exactly `ui`. `createMcpServer` refuses any other key, naming the command; `defineCommand` does not check. Rules: `spec/mcp-resources.md`.

## Before you commit

- `pnpm -F @lushly-dev/afd-server test` runs `entry-points.test.ts`, which fails if `/define` or `/direct` gains an MCP SDK or Node import, or grows past its size budget.
- A change to the executors or the pipeline resolver changes `spec/vectors`. Regenerate them (`spec/vectors/README.md`) and change every language in the same pull request.
