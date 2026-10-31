# Browser-safe direct registry

> **Goal**: Run AFD's validating in-process registry in a browser or a
> webview, with its journal, approvals and AFD contexts, from one entry point
> that loads no Node.js built-in.

| Field | Value |
|---|---|
| Status | Proposed 2026-10-31; its open questions decided by the owner the same day (see [Decisions](#decisions)). Tracked in [#527](https://github.com/lushly-dev/afd/issues/527). Progress is in [STATUS.md](./STATUS.md) |
| Author | jasfalk (drafted with Claude) |
| Packages | `packages/server`, `packages/core` (a stale comment only), `packages/client` (docs), the `afd-typescript` and `afd-directclient` skills, `docs/language-parity.md` |
| Related | [Loam architecture, AFD prerequisites](../../../../endpoints/loam/docs/architecture.md#afd-prerequisites), [View State](../../complete/view-state/view-state.proposal.md), #466 (meta-tool `context` argument), #474 (`afd-detail` fields), #458 (shared approval-token vectors), #460 (private approval exchange) |

## Why

A browser app can already define commands: `@lushly-dev/afd-server/define`
loads no Node.js built-in, and `@lushly-dev/afd-view-state/commands` uses it.
What a browser app cannot do is run those commands through AFD's validating
registry. It gets no input validation, no middleware, no exposure check, no
journal, no approvals and no AFD contexts, so an in-page agent and the UI
call commands with fewer guarantees than an MCP agent gets from a server.

Loam's kernel runs this registry in the browser and in Tauri's webview
(Loam decision D25), and its copilot calls commands through it. Any AFD app
with an in-page agent or a command palette needs the same.

## Today

Measured on 2026-10-31 by bundling each entry with esbuild for
`platform: 'browser'`, as `define.test.ts` does for `/define`:

| Entry | Browser bundle | Why |
|---|---|---|
| `@lushly-dev/afd-core` root | Builds | |
| `@lushly-dev/afd-server` root | Fails, 13 errors | The MCP SDK's Node HTTP server (`node:http`, `node:http2`, `node:stream`), and `http-handler`, `http-security`, `http-sessions`, `mcp-modern`, `confirmations` and `approval` (`node:crypto`, `node:events`, `node:tls`, `node:async_hooks`) |
| `direct-registry.js`, imported by path | Builds: 25.5 KB minified and 9.0 KB gzipped with Zod external; 469 KB and 100 KB with Zod | The module is free of Node built-ins, but the package exports it only from the root entry |
| `journal.js`, the recording middleware, by path | Builds | |
| `approval.js`, by path | Fails | `node:crypto`: `createHmac`, `timingSafeEqual` and `randomBytes`, and `Buffer` |

Zod is most of the full bundle, and any app that defines commands loads it
anyway, so the registry's own cost is the 9 KB.

AFD contexts do not reach in-process calls. The direct registry never binds
a context state, and `afd-context-list`, `afd-context-enter`,
`afd-context-exit` and the meta-tools (`afd-discover`, `afd-detail`,
`afd-call`, `afd-batch`, `afd-pipe`) are registered only by
`createMcpServer`. The modules that implement them (`tool-router`,
`command-routing`, `lazy-tools`, `context-scope` and `bootstrap/`) import no
Node built-in, so the gap is wiring, not portability.

`define.ts` says the core root entry "still re-exports the process-spawning
connectors". The probe shows the core root bundles for the browser, so that
comment is stale.

## Proposal

Three parts, each its own pull request.

### 1. A `/direct` entry point

`@lushly-dev/afd-server/direct` exports what in-process hosts need, and
nothing that needs Node.js:

- `createDirectRegistry` and its types;
- `createJournalMiddleware` and `replayJournal`;
- `createApprovalMiddleware`, once part 2 lands;
- the other middleware whose module graph is free of Node built-ins, listed
  in the server README;
- everything `/define` exports, so one import serves a browser host.

The root entry keeps exporting all of it, so nothing breaks. A test bundles
`/direct` with esbuild for the browser, as `define.test.ts` does for
`/define`. It fails on any `node:` import, and on a size budget for AFD's own
code with Zod external, starting at 40 KB minified. The name describes what
the entry is for, not where it runs: a Node host that does not want the MCP
SDK can use it too.

### 2. Approvals on WebCrypto

`approval-crypto.ts` and `approval.ts` move from `node:crypto` to
`globalThis.crypto`, which Node 22, AFD's floor, and every current browser
provide:

| Today | WebCrypto |
|---|---|
| `createHmac('sha256', key)` | `crypto.subtle.importKey` once per secret, cached, then `crypto.subtle.sign('HMAC', ...)` |
| `timingSafeEqual` | A constant-time comparison over `Uint8Array` |
| `randomBytes(16)` | `crypto.getRandomValues(new Uint8Array(16))` |
| `Buffer` and its base64url | `Uint8Array` and a base64url helper |

HMAC becomes asynchronous. The middleware is already asynchronous, and the
crypto helpers are not exported, so the public API does not change:
`ApprovalSecret` stays `string | Uint8Array`. One implementation serves
Node and browsers.

Tokens must stay byte for byte what they are today, because Python, Rust and
C++ verify them. The existing cross-language token tests must pass
unchanged, and the shared vectors proposed in #458 become the long-term
check.

**Threat model in a page.** A signing secret held in a page is visible to
every script on that page. That is acceptable for what approvals guard
in-process: a model must not be able to approve its own call through tool
input. The private approval exchange (#460) never puts the secret or a token
in a result the model reads, and that holds in a browser too. The secret is
not a boundary against code running in the page. A deployment that needs
one keeps approvals on a server. The README and the `afd-directclient` skill
say this in so many words.

`confirmations.ts` also uses `node:crypto`, through `createHash`. Only the
MCP server's confirmation gate uses it, so it is out of scope here.

### 3. AFD contexts and the tool surface in process

- `createDirectRegistry(commands, { contexts })` takes the same context
  definitions as `createMcpServer`.
- The active context is per-call input, as on the MCP 2026-07-28 lane
  (`_meta["dev.afd/context"]`), never registry state. A call names its
  context in a typed call option on `registry.execute` and on
  `DirectClient.call`, such as `{ context: 'billing' }`, passed beside the
  command context rather than inside it, so a handler or a pipeline step
  cannot set it by accident. An unknown context, or a command outside the
  active one, fails with the same result the MCP lane returns.
- `registry.listTools({ strategy, context })` returns the tool list an MCP
  server with the same commands would advertise for that strategy and
  context: individual, grouped or lazy. `DirectClient.listTools` forwards
  it with the client's allowlist applied, as `listCommands` and
  `hasCommand` already filter, so a client never lists a tool it would
  refuse to call.
- `execute` routes the meta-tools and `afd-context-list` through the same
  tool router the server uses, so an in-process agent sees exactly the
  surface an MCP agent sees. A fix to the router, such as #474's
  `afd-detail` fields, reaches both.
- `afd-context-enter` and `afd-context-exit` are refused, as on the
  stateless HTTP lane. A host that wants a context stack keeps it itself and
  passes the top of it on each call.

C++ already takes the active context from the caller, which is the shape
this part adopts.

## Parity

| Language | Runs in a browser | AFD contexts in process |
|---|---|---|
| TypeScript | This proposal | This proposal |
| Python | Not applicable | Local calls use a deliberate default scope |
| Rust | Yes: the `wasm` feature builds the registry and approvals for `wasm32-unknown-unknown` | No: `contexts` is metadata only; open PR #526 adds contexts to the `server` feature |
| C++ | Emscripten builds run under Node in CI | Partial: `active_context` supplied by the caller |

No wire format changes. `docs/language-parity.md` gains a row for in-process
context scoping that cites this proposal.

## Done when

- `/direct` bundles for the browser in CI with no `node:` import and within
  its size budget.
- Approval tokens minted by the WebCrypto middleware verify in Python, Rust
  and C++, theirs verify in TypeScript, and the approval suite passes
  unchanged.
- A shared test runs one set of commands with contexts through
  `createMcpServer` and through `createDirectRegistry`. The tool lists and
  the refusals are equal for every strategy and context.
- A Chromium test runs a command through the registry with the journal and
  approval middleware, and replays the journal.
- The server README, the `afd-typescript` and `afd-directclient` skills and
  the parity table describe the entry point and the threat model.

## Effort and order

| Part | Effort | Note |
|---|---|---|
| 1. `/direct` and its bundle test | S | No behavior change |
| 2. WebCrypto approvals | M | Security-sensitive: the pull request stops at green for the owner's review |
| 3. Contexts and the tool surface | M | Shares the router with the MCP server |

Loam's phase 0 needs part 1 and part 2. Its phase 5 needs part 3.

## Decisions

Decided by the owner on 2026-10-31.

1. **The entry is `/direct`, not `/browser`.** Nothing in it is
   browser-only: it runs the same way in Node, a web worker and a Tauri
   webview, and the name matches `createDirectRegistry` and
   `DirectClient`.
2. **A call names its context in a typed call option** on `execute` and on
   `DirectClient` calls, not in a reserved command-context key. Handlers
   read the command context, so a key there could be set by accident, and
   the option matches MCP, where the context travels in `_meta` beside the
   arguments.
3. **The registry implements `listTools`, and `DirectClient` forwards it
   with its allowlist applied.** The tool router lives in the registry,
   and `DirectClient` already filters `listCommands` and `hasCommand`, so an
   unfiltered list would expose commands the client hides.
