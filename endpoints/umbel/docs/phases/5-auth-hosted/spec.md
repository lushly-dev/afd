# Phase 5 specification: auth and hosted

| Field | Value |
| --- | --- |
| Phase | 5, auth and hosted ([architecture section 9](../../architecture.md#9-phases)) |
| Owner | Repository owner approves; the phase 5 owning agent writes and implements |
| Read first | [STATUS.md](../../STATUS.md), then the [architecture](../../architecture.md), the [decision log](../../decisions.md), the [phase 2 specification](../2-knowledge/spec.md) (access, section 6), the [phase 3 specification](../3-memory-context/spec.md) (authority, section 3.3; who may change a record, section 6.3) and the [phase 4 specification](../4-curator/spec.md) (approval, section 8) |
| Elevation | Exact shapes, names, files, tests and pull requests. An implementing agent needs no further design decision; where it finds one, it stops and amends this document by pull request, as the earlier phases' steps did |

## Status

- **State:** **written 2026-11-03, in review, not approved.** It proposes decisions [D106 to D128](../../decisions.md).
  Fifteen of them are trust-model or scope choices. They are **pending** the owner's answers to the fifteen
  questions of section [17](#17-for-the-owner), and no text here treats them as decided. Where a section depends
  on a pending answer, it describes the recommended option and names the question. Nothing is implemented.
- **Last verified:** 2026-11-03 against `main` at `e5b4e43c` (phase 4 done). Read in `endpoints/umbel`:
  - `src/principal.rs`. The projection is version 0 (line 18), under the host-owned key `dev.umbel/principal`
    (line 21). `Authentication` is `none`, `process` or `embedder` (lines 40-47). The MCP hook maps any
    request with HTTP parts to `agent:loopback` with `none`, and every other request to `agent:<local_id>`
    acting for `on_behalf_of` with `process` (lines 107-139). Nothing of the request is read.
  - `schemas/principal.v0.json` (line 5) reserves `credentials`, `delegationChain`, `tokenBinding`,
    `humanPresent`, `policyDecision`, `policyVersion`, `scopes`, `spaces` and `tenant`.
  - `src/authority.rs`. `person` "rests on a terminal check until phase 5" and is not an attestation
    (lines 5-7). `cli_mark` needs the CLI interface, a human actor, transport `cli` and authentication
    `process` (lines 63-75). An embedder's human is a person (lines 78-84, 97-109). `write_authority` fills
    `person`, `tool`, `agent`, `transcript` or `import` (lines 133-157). The agent variables are on line 38.
  - `src/middleware.rs`. The plugin gate builds the reader filter from the effective principal and refuses
    an unreadable space before the handler (lines 254-261). A `require-human` command needs the CLI's
    human-confirmed mark (lines 262-264, 278-285).
  - `src/surfaces/http.rs`. One bearer layer compares SHA-256 digests of `state/keys/http.token`
    (lines 101-152). It guards `/health` and the MCP path alike (lines 80-83) and answers
    `WWW-Authenticate: Bearer realm="umbel"` (lines 144-151). Host and origin allow-lists come from
    configuration (lines 30-44).
  - `src/surfaces/mcp.rs`. The server is hybrid, with the context hook and the shared confirmation key
    (lines 36-56).
  - `src/host/mod.rs`. The approval middleware is installed `with_include_token(false)` (lines 410-428). A
    library context is `library` and `embedder` (lines 580-585). The CLI context is `human:<local_id>`,
    `cli` and `process` (lines 602-609).
  - `src/workspace/config.rs`. Configuration version 4 (line 23). `profile` must be `team` (lines 691-697).
    `http.bind` must be loopback, and the refusal says "non-loopback HTTP arrives with phase 5"
    (lines 1240-1258). `[principal]` has `local_id`, `on_behalf_of` and `agent_env` (lines 93-95).
  - `src/workspace/keys.rs`. The approval and confirmation keys are 32 bytes, created race-safe and shared by
    every process of a workspace (lines 15-27).
  - `src/access.rs` (lines 26-29, 77-110) and `src/provenance.rs` (lines 236-249). The effective principal is
    `human:<onBehalfOf>` whenever an actor acts for someone, so an agent reads everything its person reads.
  - `src/plugins/memory_services.rs`. A sharing writer is a `person`, or a person or agent holding a
    `writers` token (lines 150-162). Invalidate and supersede are open to a sharing writer who can read the
    record (lines 215-253).
  - `plugins/knowledge/src/proposal/redact.rs:216-240` and `src/plugins/store_services.rs:368-385`. A
    redaction sweep lists proposals with `record_list`, under the caller's filter.
  - `src/plugins/mounted/mod.rs:134-149` and `src/plugins/mounted/client.rs:490-503`. An HTTP mount sends
    the deployer's token from `bearer_env`, refuses redirects, and never forwards the caller's token.
  - `src/events/cursor.rs:1-4`. The cursor is `v0:<space>:<seq>`, so a caller reads the stream's sequence
    numbers.
  - `src/commands/workspace_show.rs:85-86`. It reports `"principals": "unverified", "exact": ["library"]`.
  - `src/commands/event_list.rs`. Version 1 and later events are filtered by `access` (lines 74-79, 110-121).
- **Read in `packages/rust`:**
  - `src/commands.rs:414-482`. `CommandContext` has `actor` and `approval`, but no `credentials`.
  - `src/server/confirmations.rs:91-103`. The confirmation binding is the command and its input only, as issue
    [#532](https://github.com/lushly-dev/afd/issues/532) (open, read 2026-11-03) says.
  - `src/server/context_hook.rs`. The hook is "trust-bearing", reads HTTP parts and extensions, and runs
    once per `tools/call`, but not on `tools/list` (lines 1-60, 128-130).
  - `src/approval/middleware.rs`. `ApprovalNonceStore` must be atomic and is in memory by default
    (lines 55-64). `with_nonce_store` is on line 163. The token binds the actor (lines 344, 373).
  - `Cargo.toml:20-36`. The features are `native`, `approval`, `server` and `journal-file-shared`, with no
    auth feature.
- **Read in the repository:**
  - The [MCP Authorization proposal](../../../../../docs/features/proposed/mcp-authorization/mcp-authorization.proposal.md):
    `credentials`, `scopes`, `INSUFFICIENT_SCOPE`, a Rust tower layer, decisions A1 to A7, and enterprise-managed
    authorization out of scope.
  - The [MCP Tasks proposal](../../../../../docs/features/proposed/mcp-tasks/mcp-tasks.proposal.md): `task`,
    `TaskStore` and T1 to T5.
  - [`spec/command-metadata.md`](../../../../../spec/command-metadata.md), "Asking the human over MCP"
    (lines 234-294). The Rust relay is "Planned".
  - [`docs/language-parity.md`](../../../../../docs/language-parity.md) line 136. The relay is TypeScript only.
- **Read in `rmcp` 3.8.0, the version in Umbel's lock:**
  - `src/task_manager.rs:300-315`. A `TaskManager` over `Arc<Mutex<…>>`, in memory only.
  - `src/transport/auth.rs` and `auth/enterprise.rs`. These are client-side only: the OAuth client, and the
    enterprise-managed (ID-JAG) token exchange.
- **Read in `tantivy` 0.27.0:** `src/query/bm25.rs:15`. The public `Bm25StatisticsProvider`, which
  `EnableScoring::enabled_from_statistics_provider` takes.
- **External sources:** checked on 2026-11-03 (see [Trajectory refresh](#trajectory-refresh)).
- **No Rust was built** for this document. No cargo command was run except `cargo info`.
- **Done:** this specification, in review.
- **Not done:** everything in section [16](#16-implementation-plan); the owner's answers (section 17); an
  independent review and revision (D24).
- **Follow-ups:** section [Follow-ups](#follow-ups).

## What this phase serves

The phase 5 row of the architecture:

> the MCP Authorization layer, the principal projected onto actor and credentials, enterprise-managed authorization,
> protected-resource metadata, gateway-trusted mode, the shared confirmation key and approval nonce store, Tasks for
> long jobs, usage events, the MCP approval relay on approve and reject (moved from phase 4, D99).

Its exit criterion: *a hosted deployment behind an external identity provider returns results filtered for its users.*

The row asks this specification to settle five things:

| Item | Where |
| --- | --- |
| Trait shapes | Section 3.3 (AFD), 10 (host) |
| The principal's extension fields | 2.1, 4 |
| Scope mapping, including per-space scopes | 5 |
| Audience rules | 3.2 |
| The hosted profile | 6 |

It also takes up what earlier phases deferred to it:

| Deferred item | From | Where here |
| --- | --- | --- |
| `memory-erase` | D85, phase 3 section 13 | 8.4 |
| #532, confirmations bound to the actor | Phase 0 review | 3.1, step 0c |
| Partitioned BM25 statistics; no hidden counts in scores, revisions, `seq`, totals, memory order | D53, phase 2 section 6, phase 3 5.3 | 9 |
| Token verification, `scopes`, `credentials` | Architecture prerequisites | 3 |
| The dynamic confirmation prompt | Phase 2 G2; done at the CLI by D97 | 7.4 (over MCP) |
| Real proof of a person | D71, D86, phase 3 3.3, W5 | 7 |
| The Rust MCP approval relay | D99, parity line 136 | 3.1, 7.3 |
| Per-agent read rate limits, limits on verified agents | D74, phase 2 section 13 | 11 |
| Delegation narrowing, `delegationChain` | Phase 2 section 6, phase 3 3.1 | 4.3 |
| `space-list` and `workspace-show` listing every space | STATUS follow-up, phase 2 step 4 | 9.4 |
| `memory-confirm` on another person's record | D88 | 8.2 |
| A sharing writer closing another person's record | Phase 3 step 10, item 1 | 8.3 |
| A draft whose proposer lost read access, not redacted | Phase 4 step 3b, amendment 12; step 7, amendment 11 | 8.5 |
| `secrets`, and `bearer_env` under it | Phase 1 follow-up, D43 | 10.4 |
| Tenancy beyond spaces (O5, "blocks phase 5") | Decision log | 6.4 |
| The Rust telemetry middleware | Prerequisites table | 12.4 |

| Principle | How phase 5 serves it |
| --- | --- |
| 1. Empty host | Auth, scopes, the person page, tasks, usage and limits are host services with no domain logic. Umbel is a resource server and owns no identity provider (A7) |
| 3. Everything is a command | `usage-list` and `auth-show` are commands. The person page is the one HTTP route that is not a command: it is the out-of-band half of a command's elicitation (7.2) |
| 4. No model in the request path | Nothing here calls a model. The curator stays CLI only, and no task can run it (12.2) |
| 9. Stored content is untrusted input | Token claims and gateway assertions are verified before any field reaches the context. Elicitation answers are never approval evidence on their own (7.3) |
| 10. Permission-aware | Filtering becomes a boundary, and it is exact: statistics are per reader filter (9) |
| 11. Stateless and horizontal | Instances behind one URL share the confirmation key, the approval nonce store, the task store and the limit counters (10.2) |
| 14. Every mutation is an event | Unchanged. Usage events are metering, kept apart from the event streams (12.1) |
| 15. AFD first | Token verification, `scopes`, `credentials`, #532, the relay and Tasks land in AFD first, as step 0 (D25, D106) |
| 16. Spaces do not mix | Per-space scopes narrow a token to spaces (5.2); a task belongs to one space |

Decisions served: D14, D19, D24, D25, D26, D29, D32, D36, D42, D43, D53, D62, D68, D71, D73, D74, D82, D84, D85,
D86, D88, D91, D97, D99, D101, D102 and D103, and the new D106 to D128. O5 is put to the owner (question 14). O1 and
O4 are untouched.

## Trajectory refresh

Refreshed 2026-11-03 against primary sources. **One finding changes the design:** URL-mode elicitation in MCP
2026-07-28 makes an out-of-band, server-verified person possible, which form mode cannot be. This is question 6.
A second finding narrows scope: enterprise-managed authorization asks nothing new of a resource server (3.4).

| Row | Checked against | Finding on 2026-11-03 | Effect on phase 5 |
| --- | --- | --- | --- |
| W1 release cycle | [MCP roadmap](https://modelcontextprotocol.io/development/roadmap), last updated 2026-08-22 | 2026-07-28 is current. Priority 3 is "Agent Identity and Enterprise-Ready Security": DPoP, workload identity federation (SEP-1933), ID-JAG and RFC 8693. Human-presence attestation is still "under discussion" | Pins MCP 2026-07-28 and keeps 2025-11-25 |
| MCP Authorization | [Authorization, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization), [authorization server discovery](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery), [security considerations](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations) | OAuth 2.1 (it cites draft 13). Servers "MUST implement" RFC 9728, with `authorization_servers` holding at least one entry, discovery by `resource_metadata` in `WWW-Authenticate` or a well-known URI, and "MUST validate that access tokens were issued specifically for them as the intended audience". They "MUST NOT accept or transit any other tokens". Runtime insufficient scope is 403 with `error="insufficient_scope"`, all scopes in one challenge, and scope hierarchies respected. stdio "SHOULD NOT" follow it. Dynamic client registration is deprecated in favour of Client ID Metadata Documents | Section 3 |
| Enterprise-managed authorization | [`ext-auth`](https://github.com/modelcontextprotocol/ext-auth), stable, revision 2026-07-28; last commit 2026-10-23 | The client exchanges an enterprise ID token for an ID-JAG at the IdP (RFC 8693), then for an access token at the resource authorization server (RFC 7523 JWT bearer). "The issued access token **MUST** be audience-restricted to the MCP Server". The extension describes no step for the resource server. OAuth Client Credentials is the other stable extension | 3.4: inbound needs no Umbel-specific path; outbound is question 12 |
| W5 agent identity | [SEP-1932](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/1932) (DPoP), [SEP-1933](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/1933) (workload identity); GitHub API | Both open, not drafts, updated 2026-11-02 | DPoP and workload identity stay reserved (D19). `tokenBinding` reserves `dpop` (2.1) |
| Elicitation | [Elicitation, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation) | Form mode exposes the data to the client. URL mode is "out-of-band… not exposed to the client". The server "**MUST** verify the identity of the user who opens the URL", and "**MUST** ensure that the user who started the elicitation request… is the same user who completes" it. It "**MUST NOT** provide a URL which is pre-authenticated". It "**MUST NOT** rely on client-provided user identification without server verification". URL mode is marked a new feature that "may change" | Section 7, question 6 |
| W7 Tasks | [Tasks overview](https://modelcontextprotocol.io/extensions/tasks/overview); [`ext-tasks`](https://github.com/modelcontextprotocol/ext-tasks) revision 2026-07-28, last commit 2026-10-20 | `io.modelcontextprotocol/tasks`; only `tools/call` becomes a task. Servers "MUST perform authentication and authorization checks on each task-related request" and must use unguessable ids. A task is durable before `CreateTaskResult`. `Mcp-Name` carries `taskId`. No progress notifications on tasks. The roadmap still has it "toward eventual inclusion… in the core" | Section 12.2 |
| W2 MCP Events | [SEP-3415](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/3415) | Open, updated 2026-11-03 | Usage and events stay in Umbel's log (12.1) |
| W12 OpenTelemetry GenAI | Not re-checked; phase 0's refresh (no tagged release) stands | | Question 15 |
| IETF drafts | Datatracker API | `draft-ietf-oauth-v2-1` is at 17 (2026-10-31); MCP cites 13. `draft-ietf-oauth-identity-assertion-authz-grant` is at 06 (2026-10-31); EMA cites 04. `draft-ietf-oauth-client-id-metadata-document` is at 03 (2026-11-02); MCP cites 00 | The verifier follows the RFCs it uses (RFC 6750, 7519, 8707, 9068, 9728, 7662, 8705, 9470), not a draft's numbering |
| Libraries | `cargo info`; the registry sources | `rmcp` 3.8.0 has no server-side auth, and its `TaskManager` is in memory. `jsonwebtoken` 11.1.0 (MSRV 1.88) has an `aws_lc_rs` backend; `aws-lc-rs` 1.19.0, `rustls` 0.23.46 and `tokio-rustls` 0.26.6 are already in Umbel's lock. `tantivy` 0.27.0 exposes `Bm25StatisticsProvider` | Sections 1, 3, 9 |

Rows W3, W4, W6, W8 to W11 and W13 to W18 were not re-checked.

## Terms

These enter the [glossary](../../architecture.md#12-glossary), marked proposed.

| Term | Meaning |
| --- | --- |
| Auth mode | `auth.mode`: `none` (today's loopback token), `oauth` (an OAuth 2.1 resource server) or `gateway` (a verified gateway assertion) |
| Canonical resource URI | `http.public_url`: the MCP endpoint's absolute HTTPS URL. It is the token audience (RFC 8707) and the `resource` of the protected-resource metadata (RFC 9728) |
| Issuer alias | The deployer's short name for one trusted authorization server, `[auth.issuers.<alias>]`, which prefixes every principal id from that issuer |
| Verified principal | A principal whose actor comes from a verified token or a verified gateway assertion (`authentication: "verified"` or `"gateway"`) |
| Space scope | An OAuth scope narrowed to one space, `umbel:<verb>:<space>` |
| Gateway assertion | A short-lived JWS a configured gateway signs for one request, naming the caller it authenticated |
| Person assurance | How a person is proven for one decision: `terminal` (the CLI's check) or `verified` (a fresh login at the deployer's identity provider on the person page) |
| Person page | The host's HTTPS page that a URL-mode elicitation, or the CLI, sends a person to, where they log in at the identity provider and decide one gated call |
| Operator | A caller at the host's own CLI or the library: transport `cli` or `library`. Nothing over MCP is an operator |
| Task | An MCP task (`io.modelcontextprotocol/tasks`) running one command, bound to the principal that started it |
| Usage event | One request's metering record: who, which command, bytes in and out, outcome. It holds no content |
| Hosted profile | The requirements the doctor enforces when `auth.mode` is not `none` (section 6) |

## 1. Crate layout

```text
packages/rust/                    # step 0 (AFD first, D106)
├── src/server/auth/              # TokenVerifier, JwtVerifier, ProtectedResource, challenges, BearerLayer
├── src/server/confirmations.rs   # #532: the actor and credentials in the binding
├── src/server/approval_relay.rs  # the MCP approval relay: form mode per spec, and a host-verified mode
├── src/server/tasks/             # TaskStore, the tasks/* handlers over rmcp's model types
└── src/commands.rs               # CommandContext.credentials, CommandDefinition.scopes and .task
endpoints/umbel/
├── src/auth/                     # modes, issuers, principal mapping, scope gate, gateway verifier
├── src/person/                   # the person page: OIDC relying party, decision state
├── src/shared/                   # the shared state stores: nonces, tasks, limits
├── src/usage/                    # usage events and usage-list
├── src/surfaces/http.rs          # TLS listener, metadata routes, the layers in order
├── store-embedded/src/           # per-filter BM25 statistics; memory order without global statistics
├── plugins/knowledge/            # approve and reject over MCP; proposal version 3; host-run redaction
├── plugins/memory/               # memory-erase; editors; memory-confirm preview
├── testkit-idp/                  # umbel-testkit-idp: a credential-free identity provider and AS for tests
└── schemas/                      # + the shapes of section 2
```

| Crate | Depends on | New third-party dependencies | Notes |
| --- | --- | --- | --- |
| `afd` (`packages/rust`) | as before | `jsonwebtoken` 11.1 (feature `aws_lc_rs`), behind a new `server-auth` feature | Step 0. `reqwest` is not added: the JWKS fetcher is a trait, which hosts implement |
| `umbel` (host) | + `afd/server-auth` | `jsonwebtoken` (through `afd`), `tokio-rustls` and `rustls-pemfile` for the listener; `reqwest` (in the lock for mounts) becomes a dependency of the `auth` feature too | Sections 3 to 12; a new default feature `auth` |
| `umbel-store`, `umbel-store-embedded` | as before | none | Section 9 |
| `umbel-plugin-knowledge`, `umbel-plugin-memory` | as before | none | Sections 7, 8 |
| `umbel-testkit-idp` | `jsonwebtoken`, `axum`, `tokio-rustls`, `rcgen` (dev) | `rcgen` for test certificates | Test-only, `publish = false`, quarantined with no route. It is never linked into a shipped binary |

`tests/no_auth_server.rs` (host) fails if the `umbel` crate depends on `umbel-testkit-idp` outside
`[dev-dependencies]`, or exposes a token endpoint. Umbel is never an authorization server (A7, D107).

## 2. Versioned shapes

Every new shape is a closed JSON Schema 2020-12 file with examples (D36). Nested shapes take a new version with
their parent.

| Shape | File | Was | Section |
| --- | --- | --- | --- |
| Principal projection version 1 | `principal.v1.json` | 0 (D36) | 2.1 |
| Workspace configuration version 5 | `workspace-config.v5.json` | 4 (D72) | 2.2 |
| Plugin manifest version 5 | `plugin-manifest.v5.json` | 4 (D97, D105) | 2.3 |
| Provenance envelope version 3 | `provenance-envelope.v3.json` | 2 (D71) | 2.4 |
| Event version 3, memory record version 2, proposal record version 3 | `event.v3.json`, `memory-record.v2.json`, `proposal.v3.json` | 2, 1, 2 | 2.4, 7.3 |
| Cursor version 1, locator version 2 | `cursor.v1.json`, `locator.v2.json` | 0, 1 | 9.3 |
| Task record version 1 | `task-record.v1.json` | new | 12.2 |
| Usage event version 1 | `usage-event.v1.json` | new | 12.1 |
| Protected-resource metadata | `protected-resource.v1.json` | new; RFC 9728's fields | 3.3 |

`workspace-show`'s `versions` gains `principal: [0, 1]`, `config: [1, 2, 3, 4, 5]`, `manifest: [1, 2, 3, 4, 5]`,
`envelope: [0, 1, 2, 3]`, `event: [0, 1, 2, 3]`, `proposal: [1, 2, 3]`, `cursor: [0, 1]`, `locator: [1, 2]`,
`task: 1` and `usage: 1`. The plugin protocol stays **1** (D40 as annotated by D54). WIT world 1.0.0 is unchanged.

### 2.1 Principal projection, version 1 (D110, D111)

Version 0's four fields keep their meaning. `authentication` gains `verified` (an OAuth access token Umbel
verified) and `gateway` (a gateway assertion Umbel verified), as phase 0 reserved. The reserved fields take their
meanings; `tenant` stays reserved (question 14). **Umbel never copies the token or AFD's `credentials` here**
(phase 0 section 7). `credentials` lives on AFD's `CommandContext.credentials` (3.1) and enters the journal only
inside the context digest.

```json
{
  "version": 1,
  "actor": { "kind": "agent", "id": "corp/f53f191f9311af35", "onBehalfOf": "corp/U019488227" },
  "transport": "http",
  "authentication": "verified",
  "issuer": "corp",
  "delegationChain": [ { "kind": "agent", "id": "corp/f53f191f9311af35" } ],
  "tokenBinding": { "kind": "bearer" },
  "humanPresent": null,
  "scopes": ["umbel:read:main", "umbel:write:main"],
  "spaces": { "main": ["read", "write"] },
  "policyDecision": { "decision": "allow", "policy": "auth", "policyVersion": "sha256:9f…", "reason": null }
}
```

| Field | Rule |
| --- | --- |
| `issuer` | The issuer alias (or the gateway's alias for `gateway`); `null` for `none`, `process` and `embedder` |
| `actor` | Mapped from the verified token (4.1). For `process` and `embedder`, as version 0 |
| `delegationChain` | Outermost first. For a verified token, `[client]`, or the RFC 8693 `act` chain when the issuer is configured `delegation = "act"` (4.3). `[]` otherwise. At most 8 entries |
| `tokenBinding` | `{ "kind": "bearer" }` or `{ "kind": "mtls", "thumbprint": "<x5t#S256>" }` (RFC 8705). `"dpop"` is reserved (W5, D19) and refused by version 1. `null` without a token |
| `humanPresent` | `null`, or `{ "level": "terminal" \| "verified", "method": "cli-terminal" \| "person-page", "at", "authTime"?, "acr"? }`. Only the host sets it: the CLI's terminal check, or a completed person-page decision (7.2). **No token claim and no gateway sets it** |
| `scopes` | The granted Umbel scopes, after the prefix filter (5.1) |
| `spaces` | Per space, the verbs the scopes grant there, intersected with the space's `readers` (5.3); the reader filter reads this |
| `policyDecision` | The auth layer's decision, with `policyVersion` the SHA-256 of the `[auth]` table and `[access]` as read. `reason` is a code, never a claim value |

The hook sets version 1 in every mode. A version 0 principal is read only from journal entries already written.

### 2.2 Workspace configuration, version 5 (D107)

Version 4 with these tables. Version 1 to 4 files read as version 5 with `auth.mode = "none"`; `umbel init`
writes 5.

```toml
config_version = 5

[http]
bind = "0.0.0.0:8443"                          # non-loopback only with auth.mode != "none" and [http.tls]
public_url = "https://umbel.example.com/mcp"    # required when auth.mode != "none"; path equals http.path
path = "/mcp"
allowed_hosts = ["umbel.example.com"]

[http.tls]
cert = "secrets/tls/cert.pem"                  # workspace-relative, mode 0600 checked by the doctor
key = "secrets/tls/key.pem"
client_ca = "secrets/tls/gateway-ca.pem"       # optional; requests client certificates (mTLS)

[auth]
mode = "oauth"                                 # "none" | "oauth" | "gateway"
scope_prefix = "umbel"                         # ^[a-z][a-z0-9.-]{0,31}$
filter_tools_by_scope = true
clock_skew_s = 60                              # 0 to 300
max_token_lifetime_s = 3600                    # exp - iat above this is refused
require_bound_tokens = false                   # true: refuse a token without cnf x5t#S256 matching the client cert

[auth.issuers.corp]                            # alias ^[a-z][a-z0-9-]{0,31}$
issuer = "https://idp.example.com"             # exact issuer identifier
verify = "jwt"                                 # "jwt" (RFC 9068) | "introspection" (RFC 7662)
algorithms = ["RS256", "PS256", "ES256", "EdDSA"]
delegation = "none"                            # "none" | "act"
introspection_client_id = "umbel"              # for verify = "introspection"
introspection_secret_env = "UMBEL_INTROSPECTION_SECRET"

[auth.gateway]                                 # mode = "gateway" only (section 4.4, question 5)
alias = "edge"
issuer = "https://gateway.example.com"
keys = "secrets/gateway/jwks.json"             # pinned keys, never fetched
client_cert_sha256 = ["ab12…"]                 # pinned gateway certificates; required unless bind is loopback
max_assertion_age_s = 60
max_scopes = ["umbel:read", "umbel:write"]       # the ceiling an assertion's scope is cut to

[auth.person]                                  # the person page (section 7, question 6)
issuer = "corp"                                # an [auth.issuers] alias with OIDC discovery
client_id = "umbel-person-page"
client_secret_env = "UMBEL_PERSON_SECRET"
max_age_s = 300
acr_values = []                                # e.g. a phishing-resistant MFA class the IdP names
path = "/person"

[access.groups.eng]
members = ["human:corp/U019488227"]
claim = { issuer = "corp", name = "groups", value = "engineering" }   # question 4

[limits]                                       # section 11
calls_per_minute = 600
read_bytes_per_minute = 67108864
person_pages_per_hour = 30

[usage]                                        # section 12.1, question 13
enabled = true
readers = []
retention_days = 400
```

Rules checked at open, each failing with `WORKSPACE_CONFIG_INVALID` naming the key:
- A non-loopback `http.bind` needs `auth.mode` other than `none` **and** `[http.tls]`. `parse_bind`'s refusal
  (`config.rs:1240-1258`) keeps its wording for mode `none`.
- `http.public_url` must be `https`, have no query or fragment, have the host in `allowed_hosts`, and have the path
  equal to `http.path`, with no trailing slash unless `http.path` has one.
- `oauth` needs at least one issuer. `gateway` needs `[auth.gateway]`, and its `client_cert_sha256` unless the bind
  is loopback.
- `[auth.person]` must name an issuer. `client_secret_env` and `introspection_secret_env` must name environment
  variables, never a value (as `bearer_env`).
- `profile` stays `team` (6.1).

### 2.3 Plugin manifest, version 5 (D115, D127)

Version 4 with two command keys, both also admitted on a pipeline (where every step must admit the value):
- **`task = "never" | "optional" | "required"`**, default `never` (12.2). It is refused (`PLUGIN_MANIFEST_INVALID`)
  on any of these: a command with `journal.mode = "digest"`, `confirm`, `approval`, an `authority_prompt`, or no
  MCP exposure; a mounted tool; a component command.
- **`person = "terminal" | "verified"`**, default `terminal`, on a `confirm = "require-human"` command. It is the
  least person assurance (7.1) the command accepts.

`scopes` stays reserved (D37): scopes are derived, never declared (5.2). A host reads manifest versions 1 to 5.

### 2.4 Envelope version 3, and the shapes that nest it (D111, D115)

Version 2 with two changes:
- **`delegationChain`** takes its meaning: the principal's `delegationChain` at the write.
- **`confirmation`** gains `assurance`: `{ "level", "method", "issuer"?, "authTime"?, "acr"? }`.

`tenant` stays reserved. The new nesting versions are:
- event version 3, which carries envelope version 3;
- memory record version 2, which carries envelope version 3 on new versions (old versions stay as written);
- proposal record version 3 (7.3).

Documents keep their envelope version: an applied document's decision trace is its proposal.

## 3. The MCP Authorization layer

### 3.1 AFD first: step 0 (D106)

These land in AFD before Umbel uses them (D25), spec first where cross-language. They follow the MCP Authorization
and Tasks proposals, which this phase moves from proposed to active.

| Item | AFD change | Languages |
| --- | --- | --- |
| `scopes` on a command, and `INSUFFICIENT_SCOPE` | `spec/command-metadata.md` and `spec/error-codes.md`, as proposal A4 and A5 | Spec; Rust in step 0b |
| `CommandContext.credentials` | `{ issuer, subject?, clientId, scopes, resource, expiresAt, authTime?, acr?, cnf? }`, never the raw token (A2, A3) | Spec; Rust in step 0b |
| The Rust bearer layer | `afd::server::auth` behind `server-auth` (3.3) | Rust |
| #532 | The confirmation `requestState` binds the actor and, when present, `credentials.issuer`, `.subject` and `.clientId`. A state bound to other values is refused like a tampered one | Spec, then TypeScript, Python and Rust (step 0c) |
| The approval relay | Rust's form-mode relay per `spec/command-metadata.md`, plus a **host-verified mode**: a host trait decides an approval out of band, and the server carries only a URL elicitation (3.3) | Spec (the host-verified mode); Rust (step 0d) |
| Tasks | `task` on a command; a `TaskStore` trait; the `tasks/get`, `tasks/update` and `tasks/cancel` handlers, with a principal check on every call (T2, T3, T5) | Spec; Rust (step 0e) |

### 3.2 Token verification and audience rules (D108)

On every HTTP request in mode `oauth`, before AFD's host and origin checks and before any MCP handling, the bearer
layer applies these rules in order. A failure is HTTP 401 with
`WWW-Authenticate: Bearer resource_metadata="<url>", scope="<prefix>:read"`, and `error="invalid_token"` when a
token was sent. The body is `{"error":"UNAUTHORIZED","suggestion":"Obtain a token for <public_url> from an
authorization server named in <metadata url>."}`. The reason is logged at `warn` with the issuer alias and a rule
code, never the token or a claim value. The rules:

1. **One header.** Exactly one `Authorization: Bearer <token>` header. A token in the query string, in a form body,
   or in a second header is refused (RFC 6750 2.3; MCP "MUST NOT be included in the URI query string").
2. **Shape.** For `verify = "jwt"`: a compact JWS whose header `typ` is `at+jwt` or `application/at+jwt`
   (RFC 9068 2.1), and whose `alg` is in the issuer's `algorithms`. `none` and every HMAC algorithm are always
   refused, whatever the configuration, so a public key cannot be used as an HMAC secret. `kid` is required.
3. **Issuer.** `iss` equals exactly one configured `issuer` (RFC 3986 simple string comparison, no
   normalisation). The key is the one with that `kid` in that issuer's JWKS (3.3), never a key named in the token
   (`jku`, `x5u` and an embedded `jwk` are refused).
4. **Signature** under that key.
5. **Audience** (RFC 8707 2, RFC 9068 4). `aud` is a string, or an array of exactly one string, equal to
   `http.public_url`. The comparison is a simple string comparison, except that the scheme and host compare
   case-insensitively, as the MCP specification allows. **A token with several audiences is refused**: any other
   audience could replay it here. A `resource` claim, when present, must equal it too.
6. **Time.** `exp` is required and must be in the future; `nbf` and `iat`, when present, must be in the past, all
   within `clock_skew_s`. `exp - iat` must be at most `max_token_lifetime_s`, which bounds how long a revoked
   group membership or scope survives.
7. **Subject and client.** `sub` and `client_id` (RFC 9068) are required, as non-empty strings of at most 255
   characters with no control character.
8. **Binding.** With `cnf.x5t#S256` (RFC 8705), the TLS client certificate's SHA-256 must match. Without it,
   `require_bound_tokens = true` refuses the token. A `cnf.jkt` (DPoP) is refused while DPoP is reserved (D19),
   rather than silently treated as a bearer token.
9. **Introspection.** For `verify = "introspection"`, rules 3 and 5 to 8 apply to the RFC 7662 response from the
   issuer's `introspection_endpoint`, which must say `active: true`. The response is cached by the SHA-256 of the
   token until the earlier of `exp` and 60 seconds. Umbel authenticates to the endpoint with its own client
   credentials, never the caller's token.

**Never passed on.** The verified claims become `CommandContext.credentials`, and the raw token is dropped at the
layer. No command, plugin, mount, journal entry, log line, task record, usage event or error message receives it
(MCP: "MUST NOT accept or transit any other tokens"). `Debug` on every type holding it prints `[redacted]`.

**Scope at the edge.** A verified token with no scope under `scope_prefix` is 403 `insufficient_scope` with
`scope="<prefix>:read"`. Finer checks are in 5.2.

**stdio and the CLI** are unaffected, as the MCP specification says stdio "SHOULD NOT" follow it. They keep the
process principal, with authentication `process`.

### 3.3 Trait shapes (D106, D109)

Interfaces in `afd::server::auth` (step 0b). These are the shapes the step implements, not code.

```text
trait TokenVerifier: Send + Sync
    async fn verify(&self, token: &str, request: &http::request::Parts) -> Result<Credentials, AuthRefusal>

struct Credentials { issuer, subject, client_id, scopes: Vec<String>, resource, expires_at, auth_time?, acr?,
                     cnf_x5t?, act: Option<Value> }     // no token field
enum AuthRefusal { Missing, Malformed, Invalid(RuleCode), Expired, InsufficientScope(Vec<String>) }

trait KeySource: Send + Sync                            // the host fetches; AFD never opens a socket
    async fn keys(&self, issuer: &str, kid: &str) -> Result<Jwk, KeyError>

struct JwtVerifier { issuers: Vec<IssuerPolicy>, resource: String, skew, max_lifetime, keys: Arc<dyn KeySource> }
    impl TokenVerifier                                  // the rules of 3.2, one reference implementation

struct ProtectedResource { resource, authorization_servers, scopes_supported, resource_name?,
                           resource_documentation?, tls_client_certificate_bound_access_tokens: bool }
    fn metadata_routes(&self, path: &str) -> [(String, Json)]   // both RFC 9728 URIs

struct BearerLayer { verifier: Arc<dyn TokenVerifier>, metadata: ProtectedResource,
                     required_scopes, filter_tools_by_scope }   // tower::Layer
    // inserts Credentials into the request extensions; the context hook copies them to the context

trait ApprovalRelay: Send + Sync                        // step 0d's host-verified mode
    async fn begin(&self, call: &RelayCall) -> Result<RelayPrompt, CommandError>   // URL and state
    async fn decided(&self, state: &str, call: &RelayCall) -> RelayOutcome         // Approved | Declined | Pending

trait TaskStore: Send + Sync                            // step 0e
    async fn create(&self, record: TaskRecord) -> Result<(), TaskStoreError>    // durable before returning
    async fn get(&self, id: &str, owner: &TaskOwner) -> Result<Option<TaskRecord>, TaskStoreError>
    async fn update(&self, id: &str, owner: &TaskOwner, change: TaskChange) -> Result<(), TaskStoreError>
    async fn expire(&self, now: i64) -> Result<u64, TaskStoreError>
```

Umbel implements `KeySource` with `reqwest` (`src/auth/keys.rs`). It fetches only the configured issuer's metadata,
taking `jwks_uri` from it, and the metadata's `issuer` must equal the configured one. It follows no redirects and
requires HTTPS. It caps the body at 1 MiB and the timeout at 10 seconds, caches for the response's `max-age`
between 5 minutes and 24 hours, and on an unknown `kid` refetches at most once per minute per issuer. A fetch
failure keeps the last good keys until their cache ends, then fails closed.

Umbel also implements `ApprovalRelay` (7.3), `TaskStore` (12.2) and `ApprovalNonceStore` (10.2).

**Protected-resource metadata (D109).** The metadata is served without authentication at
`/.well-known/oauth-protected-resource<http.path>` and at `/.well-known/oauth-protected-resource`:

```json
{
  "resource": "https://umbel.example.com/mcp",
  "authorization_servers": ["https://idp.example.com"],
  "scopes_supported": ["umbel:read"],
  "bearer_methods_supported": ["header"],
  "resource_name": "Umbel (example)",
  "tls_client_certificate_bound_access_tokens": false
}
```

- `resource` is `http.public_url`, the identifier the well-known URI is built from (RFC 9728 3.3).
- `authorization_servers` lists every configured issuer, in configuration order.
- `scopes_supported` is the minimal set for basic use, as the MCP specification asks; the rest is requested by
  step-up challenges.
- `resource_name` is the workspace `name`.
- Nothing else is published: no space names and no plugin list.
- Mode `gateway` publishes no metadata, because its callers are the gateway, not OAuth clients.

### 3.4 Enterprise-managed authorization (D108, D121)

The extension's resource-server obligation is to accept access tokens "audience-restricted to the MCP Server",
issued by the resource authorization server that the metadata names. 3.2 does exactly that, so **inbound
enterprise-managed authorization needs no Umbel-specific code**. The rest of the extension happens between the
client, the enterprise identity provider and the authorization server.

Phase 5 makes it checkable:
- `umbel-testkit-idp` runs the whole exchange: an ID token, the RFC 8693 exchange for an ID-JAG, and the RFC 7523
  grant for an access token;
- the exit test uses it (14, point 2).

**Outbound** (Umbel obtaining a token as the caller for a mounted server) is question 12.

## 4. Who the caller is

### 4.1 Mapping a verified token to a principal (D110, question 1)

**Recommended (question 1):**
- **A person** is `human:<alias>/<sub>`. OIDC subjects are unique per issuer and never reassigned.
- **The client** is `agent:<alias>/<client_id>`, acting for `<alias>/<sub>`.
- **A `client_credentials` token** (where `sub == client_id`, or the issuer marks it with `act` absent and no user)
  is `service:<alias>/<client_id>` with no `onBehalfOf`.
- An id over 128 characters (phase 2's limit) becomes `<alias>/h:<first 32 hex of SHA-256 of the value>`. The full
  value stays in `credentials`.
- `email`, `preferred_username` and other mutable claims never become an id.

This gives the effective principal `human:corp/U019488227` for an agent acting for that person (D53's rule,
unchanged), which `readers`, groups, memory ownership and approvers match.

The **operator** keeps `human:<local_id>` at the CLI and `agent:<local_id>` on stdio. A deployer who wants one
person's CLI and their hosted identity to be the same principal sets `principal.local_id = "corp/U019488227"`; the
doctor's `auth.principals` check shows both.

### 4.2 The context hook, version 1

| Transport | Mode | `actor` | `authentication` |
| --- | --- | --- | --- |
| stdio | any | as version 0 | `process` |
| Streamable HTTP | `none` | `agent:loopback` (D32) | `none` |
| Streamable HTTP | `oauth` | 4.1, from `Credentials` in the request extensions | `verified` |
| Streamable HTTP | `gateway` | 4.4, from the verified assertion in the extensions | `gateway` |
| CLI | any | `human:<local_id>` | `process` |
| Library | any | the embedder's | `embedder` |

The hook fails closed. An HTTP request in mode `oauth` or `gateway` that reaches it without verified credentials in
the extensions (a layer misordered or missing) is refused with `UNAUTHORIZED`, and `tests/auth_layers.rs` holds
that. As in phase 0, nothing is read from a header the caller controls.

### 4.3 Delegation: what an agent reads for its person (D111, question 2)

Today an agent acting for a person has the person's whole reader filter (`provenance.rs:236-249`).

**Recommended (question 2):** an agent's reader filter is the person's, **narrowed by its token**. A space the
token grants no verb in (5.2) is `SPACE_NOT_READABLE` for that call. The person's tokens (`principal:`, groups)
apply within the granted spaces. Scopes narrow; they never grant what `readers` and groups refuse (5.3).

`delegationChain` records the client, or the RFC 8693 `act` chain when the issuer is configured to emit it. It is
written into envelope version 3, and audit shows "agent X, for person Y, through client Z". Each `act` entry is
mapped as 4.1 maps a client. An `act` from an issuer not configured `delegation = "act"` is ignored and logged,
never trusted.

### 4.4 Gateway-trusted mode (D114, question 5)

**Recommended (question 5):** a gateway is trusted **only to say who authenticated**, never what they may do beyond
a ceiling, and never that a person is present. Every request must carry both of these:

1. **An authenticated channel.** An mTLS client certificate whose SHA-256 is in `client_cert_sha256`, or a
   loopback bind when the gateway is on the same host.
2. **A per-request assertion** in `Umbel-Gateway-Assertion`: a compact JWS with these properties:
   - `typ: umbel-gw+jwt`;
   - signed by a key in the pinned `keys` file;
   - `iss` equal to `[auth.gateway].issuer`, `aud` equal to `http.public_url`;
   - `iat` within `max_assertion_age_s`;
   - `jti` random, at least 128 bits, consumed once in the shared nonce store (10.2);
   - `htm` and `htu` equal to the request's method and URL;
   - `sub` (the person or service), `client` (the agent) and `scope` (space-delimited).

   `scope` is intersected with the gateway's ceiling, which is the same grammar as 5.1, configured as
   `[auth.gateway] max_scopes`.

The assertion maps as 4.1, with the gateway's alias, and `authentication = "gateway"`. The rules:
- `humanPresent`, `acr` and `auth_time` in an assertion are ignored: a person is proven only on the person page
  (section 7).
- A request with the header but no valid channel, or with the channel but no valid assertion, is 401.
- A plain identity header (`X-User` and the like) is never read.
- The assertion travels no further than the layer, as a token does.

### 4.5 Groups from token claims (D113, question 4)

**Recommended (question 4):**
- An `[access.groups.<g>]` may add `claim = { issuer, name, value }`. A verified caller holds `group:<g>` when the
  token from that issuer has the claim `name` (a string or an array of strings) containing exactly `value`.
- Static `members` still apply, and the two are unioned.
- Claims are read only from the issuer named, and never from a gateway assertion.
- A membership lasts no longer than the token (`max_token_lifetime_s`).

## 5. Scopes

### 5.1 The grammar

A scope is `<prefix>:<verb>`, or `<prefix>:<verb>:<space>` for a declared space id. The verbs are `read`, `write`,
`approve` and `erase`.

Each verb on a space implies `read` on that space. An unqualified scope implies the same verb on every space
(the hierarchy the MCP specification asks servers to respect). Scopes under other prefixes are ignored and are not
copied into the principal. Parsing is exact: no wildcards, case-sensitive, at most 64 Umbel scopes per token
(`INSUFFICIENT_SCOPE`'s suggestion says so when exceeded).

### 5.2 What a command needs (D112, question 3)

**Recommended (question 3):** scopes are derived from what the host already knows, never declared by a plugin.

| Command | Needs |
| --- | --- |
| Effects `inspect` only | `read` on each space of the call (the `space` or `spaces` input, else the default space) |
| Any mutating effect (`plugin-state`, `store-write`, `workspace-write`, `external`) | `write` on each space |
| `confirm = "require-human"` or an approval policy, reachable over MCP only by 7.3 | `approve` on the space, besides the person page |
| `memory-erase` | `erase` on the space, besides `verified` assurance (8.4) |
| A space-less command (a mount without `bind_space`, `workspace-show`, `space-list`) | For `external`: unqualified `write`. Otherwise any Umbel scope; results list only the spaces the token reads (9.4) |
| `afd-discover`, `afd-detail`, `afd-help`, `afd-context-*` | Any Umbel scope; with `filter_tools_by_scope`, they show only commands the token could call somewhere |
| `afd-call`, `afd-batch`, `afd-pipe` | Every step's needs, checked before the first step runs, all missing scopes in one refusal |
| A pipeline | The union of its steps' needs |

The **scope gate** is a host middleware between the space check and the plugin gate (`src/auth/scope_gate.rs`). A
missing scope is the tool error `INSUFFICIENT_SCOPE`, with `details.scopes` naming every missing scope and the
suggestion "Ask the authorization server for these scopes and retry". It is never retryable without a new token.

Per AFD's A5:
- for an individual first-class tool, whose needs do not depend on input, AFD's layer answers HTTP 403
  `insufficient_scope` from `Mcp-Name`;
- everything else is the tool error.

`tools/list` is filtered when `filter_tools_by_scope` is on, with `cacheScope: "private"`. Lists may vary by
authorization (MCP Tools).

### 5.3 Scopes and access

The reader filter for a call is built from three things:
- the effective principal (as phase 2);
- its static and claim-derived groups (4.5);
- **only within the spaces its scopes grant** (4.3).

So:
- A scope never makes an unreadable space readable. `readers` and access sets stay the only grants of
  visibility (D53).
- A token without `read:<s>` gets `SPACE_NOT_READABLE` in `s`, before the handler, as an unreadable space does
  today, with no difference between the two.
- Operators (CLI, library) have no scopes and are not narrowed, as today.

## 6. The hosted profile (D107)

### 6.1 What it is

The hosted profile is not a `profile` value: `profile` stays the scale switch (principle 13) and stays `team`, the
only value phases 0 to 4 accept. It is the set of requirements the doctor enforces whenever `auth.mode` is not
`none`.

| Doctor check | Fails when |
| --- | --- |
| `auth.mode` | `oauth` with no issuer; `gateway` without `[auth.gateway]` |
| `auth.public_url` | Not HTTPS; host not in `allowed_hosts`; path differs from `http.path` |
| `auth.tls` | A non-loopback bind without `[http.tls]`; the key file readable by group or other; the certificate expired or expiring in 14 days (warning) |
| `auth.issuers` | An issuer's metadata unreachable at open, or its `issuer` different from the configured value (warning at open, failure in the doctor) |
| `auth.person` | Any `person = "verified"` command or `approve_over_mcp` area while `[auth.person]` is absent |
| `auth.secrets` | A `*_env` variable unset |
| `auth.principals` | Shows the operator's principal beside the issuers' prefix; warns when `local_id` contains no `/` and the workspace has `oauth` readers, so operator and hosted users cannot collide |
| `auth.shared` | `state/shared/` not writable, or not on a local filesystem (D29) |
| `auth.confirmations` | `mcp.confirmations = "enforce"`, which lets an agent confirm its own call; hosted needs `require-human` (a warning in `none`) |

`workspace-show`'s `access` becomes:
- `{ "principals": "verified", "exact": ["library", "http"], "statistics": "per-filter" }` in `oauth` and
  `gateway`;
- phase 2's value in `none`.

### 6.2 Topology

Phase 5 hosts **one machine**: any number of host processes behind one URL (a load balancer in front, each
process with the same workspace on a local filesystem, D29), sharing `state/`. Several machines need shared
backends, which are phase 6. The shared-state traits (10.2) are designed so that phase 6 adds a backend without
changing this phase's callers.

TLS is terminated in the process when the bind is not loopback (rustls through `tokio-rustls`, TLS 1.2 and 1.3,
the platform's default cipher suites). A TLS-terminating proxy on the same host forwards to a loopback bind. A proxy
on another host must open TLS to Umbel, and plain HTTP across a network is refused by 2.2's rule. The DNS-rebinding
checks (`allowed_hosts`, `allowed_origins`) stay in front.

`/health` answers `{"status":"ok"}` without authentication in `oauth` and `gateway` modes, so load balancers can
probe it. It names nothing else. It stays behind the token in `none` (D32).

### 6.3 Layers on the HTTP surface, outermost first

1. TLS, and the client certificate when `client_ca` is set.
2. Size limit (`max_body_bytes`), then the per-token request limit (11).
3. The metadata routes and `/health`, which are public.
4. The bearer layer (mode `oauth`) or the gateway layer (mode `gateway`); in mode `none`, phase 0's token layer.
5. The person page routes (7.2), which authenticate by their own OIDC login, never by the bearer token.
6. AFD's host and origin checks, then the MCP service; inside it, the context hook (4.2), the event stamp, the space
   check, **the scope gate**, the plugin gate, the approval middleware, the journal.

`tests/auth_layers.rs` holds the order: each layer is removed in turn, and the request must then fail closed.

### 6.4 Tenancy (D123, question 14)

**Recommended (question 14):** a deployment is single-tenant, and **closes O5** that way:
- spaces isolate knowledge bases within one deployment (D26);
- organisations that must not share a process or keys run separate deployments (architecture section 7's
  strongest level);
- several issuers in one deployment are one tenant's federated identity sources, not tenants;
- `tenant` stays reserved in the principal and the envelope.

## 7. Proving a person

### 7.1 Assurance levels (D115, question 6)

Phase 3 says "`person` is not an attestation… phase 5 replaces it" (`authority.rs:5-7`).

**Recommended (question 6):** two levels, recorded on everything a person decides.

| Level | How | Where it counts |
| --- | --- | --- |
| `terminal` | Today's CLI check (D71, D86): a human at the CLI with stdin and stderr terminals, no `--yes`, no agent variable, answering the prompt | The operator's CLI, for every `require-human` command whose `person` is `terminal`. Unchanged and still not an attestation, as the record says |
| `verified` | The person page: the person opens Umbel's HTTPS page in their own browser, **logs in at the deployer's identity provider** with `prompt=login`, `max_age = max_age_s` and `acr_values`, sees the call's preview, and decides. Umbel checks the ID token's `sub` against the caller the decision is for | Over MCP for every gated call (7.3, 8.1, 8.2); at the CLI for a command declaring `person = "verified"` (8.4), where the CLI prints the URL and waits |

**No other path gives a person:**
- A token's `sub` is the user who authorised the client at some time, not a person present for this call.
- A form-mode answer is the client's (D99, `spec/command-metadata.md`).
- A gateway may not assert a person.

### 7.2 The person page (D115)

The page is under `[auth.person].path`. Umbel is an OIDC relying party here, a confidential client with
authorization code, PKCE (`S256`), `state` and `nonce`. It is not an authorization server.

1. **Begin.** A gated call over MCP (7.3) or at the CLI asks the host for a person decision. The host makes a
   decision record in `state/shared/person.sqlite3`:
   - `id`: 128 random bits;
   - `for`: the effective principal, the issuer alias and `sub`;
   - `command` and the canonical input digest;
   - `preview`: the command's `confirm_preview` text, or its prompt;
   - `expires`: 10 minutes;
   - `status = pending`.

   It answers with the URL `https://<public host><path>/d/<id>`. The URL holds no identity and no credential, and
   it is not pre-authenticated (MCP URL mode, "Safe URL Handling").
2. **Open.** The page answers `GET /d/<id>` with a redirect to the IdP's authorization endpoint (from its OIDC
   discovery, `issuer` checked), with `prompt=login`, `max_age`, `acr_values`, `state` (sealed: decision id, PKCE
   verifier digest, browser binding) and `nonce`. A `__Host-` cookie with `Secure`, `HttpOnly` and
   `SameSite=Lax` binds `state` to the browser.
3. **Return.** On the callback:
   - the code is exchanged with the PKCE verifier;
   - the ID token is verified (signature, `iss` (RFC 9207 `iss` checked when the IdP advertises it), `aud` equal to
     `client_id`, `nonce`, `exp`);
   - `auth_time` must be within `max_age_s` and `acr` among `acr_values` when any are set;
   - **`sub` must equal the decision's `for.sub` from the same issuer**, or the page says "This request is for
     another person" and records nothing (the URL-mode phishing rule).
4. **Decide.** The page shows these, sanitised, with no script from content and a strict CSP:
   - the preview;
   - who asked (the agent, the client and the delegation chain);
   - the space.

   It shows two buttons, posting a form with a per-decision CSRF token. The decision is stored with `level =
   "verified"`, `authTime`, `acr`, the `sub`, and the hash of the preview shown.
5. **Resume.** The client retries the call with the elicitation's `requestState`. The host finds the decided
   record, checks that the retrying caller's principal and the input digest are the decision's, spends the
   decision once through the nonce store, and runs the call with `humanPresent` set from it (2.1).
   - The plugin gate's `require-human` check (`middleware.rs:262-264`) accepts this decision in place of the CLI's
     mark. A command whose `person` is `verified` no longer accepts the CLI's mark alone.
   - One decision satisfies both the `require-human` gate and the command's approval policy, because both ask the
     same person about the same call. AFD's relay asks the host's `ApprovalRelay` (3.3), and the gate reads the
     same record.

Rules:
- A decision is single-use.
- Declining fails the call with `CONFIRMATION_DECLINED` (or `APPROVAL_REQUIRED` with reason `declined`, for
  approvals), not retryable.
- An expired or spent decision asks again.
- `person_pages_per_hour` limits begins per principal.
- The page renders no stored content beyond the preview, so the preview's own rules (D97: sanitised, capped,
  reader-filtered) bound what it shows.
- The person page journals each decision under its command's trace as the host's `person-decide` entry
  (digest-journaled, keeping `id`, `level` and `decision`).

At the CLI, a `person = "verified"` command prints the URL to stderr with "Open this in your browser and log in to
decide", and polls the record every second until it is decided or expires. No agent variable blocks it: the login
is the proof.

### 7.3 The MCP approval relay (D116, question 7; amends D99)

**Recommended (question 7):**
- Approve and reject only. Each knowledge area opts in with `approve_over_mcp`, default false.
- The relay is AFD's **host-verified mode** (3.1). The server answers `input_required` with a **URL-mode**
  elicitation to the person page, never a form, and the call runs only after a `verified` decision for the same
  person, command and input.
- The knowledge manifest (version 5) exposes `knowledge-approve` and `-reject` to MCP with `person = "verified"`.
  Exposure is per command, so the knowledge plugin refuses the call in every area without the opt-in
  (`APPROVAL_RELAY_DISABLED`), before anything is shown or asked. The call needs `approve` on the space, and the CLI
  path is unchanged.
- Every phase 2 and 4 rule holds unchanged:
  - approvers must be listed and read the target;
  - self-approval as D62 and D102;
  - approve's re-checks (D102, D103);
  - auto-approval refuses a relay (D98).
- Proposal record version 3 adds `decision.channel = "mcp-elicitation"` (the value D99 named) and
  `decision.assurance = { level, method: "person-page", issuer, authTime, acr? }`. A terminal decision records
  `{ level: "terminal", method: "cli-terminal" }`.
- A client without URL-mode elicitation gets `APPROVAL_REQUIRED` with `details.reason = "url-elicitation-required"`
  and the suggestion to approve at the CLI or from a client that supports URL elicitation.

Approval tokens still never travel over MCP (`with_include_token(false)`, `host/mod.rs:410-428`).

### 7.4 The dynamic prompt over MCP

Phase 4's preview (D97) closed the "must do before real use" follow-up at the CLI. Over MCP the same preview is the
person page's content (7.2, step 4). The elicitation `message` carries only "Open the link to review proposal
`<id>` in `<space>`", never content: URL mode keeps content off the client, and the page is reader-filtered for the
person who logs in.

## 8. Person-gated memory and the open owner questions

### 8.1 Gated commands over MCP (D117, question 8)

**Recommended (question 8):** `memory-confirm` and `curator-promote` may be reached by a verified person through the
person page.

`memory-confirm` gains `confirm_preview = "memory-preview"`, an `inspect` command returning the record's text,
sanitised, under the caller's filter. The person page shows it, so the content hash no longer has to stand in for
reading (D84 keeps it as a binding).

`memory-confirm` becomes MCP-exposed with `person = "verified"`, and the CLI keeps `terminal`. `curator-promote`
stays CLI only, because the curator is not in the request path (D90, 12.2), and declares `person = "verified"` so
that a hosted person promotes at the CLI through the page.

`memory-remember`'s `authority_prompt` (D86) stays CLI-only. Over MCP a remember is `agent`, and a person raises
it with `memory-confirm`.

### 8.2 Confirming another person's record (D117, question 8)

D88 refused this "until phase 5". **Recommended:** keep the refusal. A `verified` person can be attributed, but one
person vouching for another's text gives the record `person` authority, the default push path (D78), on someone
else's word. No use needs it yet.

### 8.3 Changing another person's shared record (D119, question 10)

Phase 3's step 10, item 1, asked whether a sharing writer may invalidate or supersede a readable record another
principal wrote. `memory_services.rs:215-253` allows it today; agents are already refused.

**Recommended (question 10):**
- Only the record's principal, or a person holding a token in a new `editors` list on the `memory_write` grant
  table (default empty), may invalidate or supersede it.
- Over MCP the editor must be `verified` for the call.
- `MEMORY_NOT_OWNED` otherwise.
- History keeps every version either way.

### 8.4 `memory-erase` (D118, question 9)

D85's conditions, each made concrete:
- `memory-erase { space, principal, ids?, dryRun }` in the memory plugin, digest-journaled (`keep = ["space",
  "principal", "dryRun"]`), with `confirm = "require-human"`, `person = "verified"`, `erase` scope, and exposed to
  MCP and the CLI.
- The caller's effective principal must hold a token in the grant table's `erasers` list, default empty. Else
  `MEMORY_ERASE_NOT_ALLOWED`, and the same for an unreadable target.
- `dryRun = true`, required first, returns the count and a `plan` hash of the ids and versions. The erase must
  present the same `plan`, and anything changed is `MEMORY_ERASE_PLAN_STALE`.
- Erasure is phase 3's forget path (D73, D82): keys destroyed first, then the byte-level deletion.
- **Disclosed residue**, as D85 lists: the journal's ids, the erased principal in `changes` and in the kept input,
  and any `derivedFrom` hash of an applied proposal.
- **Recommended addition:** the erased principal receives an event in their own stream (access
  `principal:<erased>`): "N records erased by `<eraser>` at `<time>`". An eraser cannot erase quietly, even
  records about themselves.

### 8.5 A draft its proposer can no longer read (D120, question 11)

**Recommended (question 11):** close the limit with a **host-run redaction**:
- When a forget or erase destroys keys, the host sends knowledge instances holding `memory` an `erased` notice
  under the host's own principal `service:umbel-host`.
- It carries a new `ReaderFilter::OwnRecordsCiting(ids)`, which admits only the instance's own proposal records
  that cite one of those ids.
- Under it the knowledge plugin may only **redact** (phase 4's 9.1 redaction, unchanged in content). It reads
  nothing out: the notice's result is counts only, and the store refuses any other use of the filter.

So the redaction reaches drafts no live caller can read, while nobody gains a read. `tests/host_redaction.rs` holds
both halves.

## 9. Exact filtering: statistics and hidden counts (D125)

Phase 2 accepted hidden counts "until phase 5 verifies callers". In modes `oauth` and `gateway` they are closed. In
mode `none` the same code runs, so behaviour is identical in every mode, except where a rule below says operator.

### 9.1 Knowledge: statistics per reader filter

`SearchIndex::query` scores through tantivy's `Bm25StatisticsProvider` (`bm25.rs:15`) with a provider computed under
the call's reader filter:
- `doc_freq(term)` counts readable chunks containing the term;
- `total_num_docs` counts readable chunks;
- `total_num_tokens(field)` sums field norms over readable chunks.

It is cached per (segment set, filter token digest) and dropped on any commit.

A caller's scores and order are then **a function of what it can read and nothing else**. Aggregation, graph
expansion (already readable-only, D60) and rounding (D58) are unchanged. The eval baseline is re-run: in the
seeded fixture an all-reading caller's statistics equal today's, so the gate must pass unchanged.
`store-embedded/tests/partitioned_stats.rs` holds that adding unreadable documents changes no byte of a caller's
results.

### 9.2 Memory: order without global statistics

FTS5's `bm25()` uses whole-table statistics (phase 3 5.3). The changes:
- Recall selects matching readable records with the boolean query, with no rank, in `recordedAt` descending order,
  up to `4 × limit`.
- It opens their bodies (as today) and orders them by the number of distinct query terms each matches (tokenised by
  `umbel-store`'s query tokenizer), then authority tier, then `recordedAt`, then id.
- No statistic depends on another record.
- Recall still returns no score (D70).

### 9.3 Revisions, sequence numbers and totals

| Today | Leaks | Phase 5 |
| --- | --- | --- |
| Cursor `v0:<space>:<seq>` (`cursor.rs`), `event-list` `head` | Gaps count hidden events | **Cursor version 1** `v1.<base64url>`: XChaCha20-Poly1305 under `state/keys/cursor.key`, over `{space, principal, seq}`, with the principal as associated data. Opaque, ordered only by the server, refused for another principal. `head` is a cursor. Version 0 cursors are still accepted from operators |
| `dev.umbel/index` `{ applied, head, schema }`; `knowledge-changes` revisions; `rev` in results | Gaps count hidden changes | Sealed the same way as `r1.<base64url>` tokens for non-operators, compared only for equality, and accepted back by `after` |
| Locator `indexVersion` `<space>@<rev>/<schema>` (D61) | The applied revision | **Locator version 2**: `indexVersion` is `<space>@r1.<token>/<schema>` for non-operators. The locator string's content hash is unchanged |
| `sources-sync`, `sources-status`, `knowledge-index` totals | Every file counted | Readable-only counts for non-operators; totals for operators |
| `store-show` head | Every change | Readable head for non-operators; CLI-only stays |

### 9.4 Spaces

`space-list` and `workspace-show` list only the spaces the caller's filter reads, and the scopes grant. In every
mode, an operator reads every space it is a reader of, as today. Closes the phase 2 step 4 follow-up.

## 10. Host services

### 10.1 Grants

No new plugin grant. `secrets` is defined for the host's own use (10.4), and stays refused to plugins until a
plugin needs it (phase 1 follow-up). Plugins never see `credentials` or the principal's extension fields beyond
what `CallContext` already carries (actor, effective principal, space).

### 10.2 Shared state for instances behind one URL (D126)

Principle 11's "instances behind one URL share the confirmation key and the approval nonce store", made concrete:

| State | Where | Rule |
| --- | --- | --- |
| Confirmation and approval keys | `state/keys/` (D29, unchanged) | Shared by every process, created race-safe |
| Cursor and revision sealing key | `state/keys/cursor.key` | As above, 32 bytes |
| Approval nonces, gateway `jti`s, person decisions spent | `state/shared/nonces.sqlite3`, WAL, mode 0600 | `ApprovalNonceStore::consume` is `INSERT … ON CONFLICT DO NOTHING` and `changes() == 1`: atomic across processes. Rows expire at their `expires_at`, and writes purge at most 64 |
| Person decisions | `state/shared/person.sqlite3` | 7.2 |
| Tasks | `state/shared/tasks.sqlite3` | 12.2 |
| Limit counters | `state/shared/limits.sqlite3` | 11 |

Each store is behind a trait in `src/shared/`, so that phase 6 adds a networked backend. Each waits at most
`store.lock_timeout_ms` (D51), and a timeout fails the request closed (`UMBEL_SHARED_BUSY`, retryable). The
confirmation `requestState` itself stays stateless (MRTR). The nonce store makes approvals and person decisions
single-use across processes.

### 10.3 `auth-show`

`auth-show` is a host built-in, `inspect`, exposed everywhere. It returns the caller's own projection: principal
string, authentication, issuer alias, scopes, spaces with verbs, `delegationChain`, token expiry. It never returns
claims beyond these, and never another principal's. It is how an agent learns why a call was narrowed.

### 10.4 Host secrets

The person page's client secret, introspection credentials and TLS key are host secrets: read from the environment
variable or file named in configuration, never stored in `umbel.toml`, never logged, `Debug`-redacted.

Phase 1's follow-up moves an HTTP mount's `bearer_env` under the same rule. It is already an environment variable
(`mounted/mod.rs:134-149`), so only the doctor's `auth.secrets` check and the redaction are new. A plugin `secrets`
grant stays out of scope.

## 11. Rate limits (D128)

Phase 3 limited memory writes per principal (D74), and phase 2 deferred read limits to verified callers. In modes
`oauth` and `gateway` there are three limits:
- **Per token**, in the HTTP layer: `calls_per_minute` per (issuer, `sub`, `client_id`), a fixed one-minute window.
  Over it is HTTP 429 with `Retry-After`.
- **Per principal**, in a host middleware: `read_bytes_per_minute` of result bytes per effective principal. Over it
  is the tool error `RATE_LIMITED` (retryable, `details.retryAfterMs`). A mutation's result is never withheld once
  it has run: the limit is checked before the handler, on the bytes already used.
- **Person pages:** `person_pages_per_hour` per principal.

Counters are in the shared store, so they hold across processes. Operators are not limited. Mode `none` keeps
phase 0's behaviour.

## 12. Usage, tasks, telemetry

### 12.1 Usage events (D122, question 13)

**Recommended (question 13):** one content-free record per MCP request in its own stream,
`state/usage/<yyyy-mm>.jsonl`, appended under its own lock (not the workspace lock), mode 0600:

```json
{ "version": 1, "id": "u-…", "at": "2026-11-03T10:00:00.000Z", "trace": "…",
  "principal": "human:corp/U019488227", "actor": "agent:corp/f53f191f9311af35", "issuer": "corp",
  "transport": "http", "tool": "knowledge-search", "command": "knowledge-search", "space": "main",
  "outcome": "ok", "bytesIn": 212, "bytesOut": 4810, "durationMs": 31, "task": false }
```

- `outcome` is `ok` or an error code.
- No input, result, query, document id or memory text is recorded, so a forget leaves nothing here.
- Tokens are not counted: the host has no tokenizer and does not guess. The architecture's "bytes and tokens" is
  amended to bytes (proposed).
- `usage-list { after?, principal?, limit }` is a host built-in, `inspect`. A caller sees their own records, and a
  principal or group in `usage.readers` sees everyone's. Operators see everything.
- Retention is `retention_days`; `event-rebuild` does not touch it.
- Usage events are not telemetry: AFD telemetry keeps the actor kind only (architecture section 5).

### 12.2 Tasks for long jobs (D127)

Commands declaring `task = "optional"` run as an MCP task when the request declares `io.modelcontextprotocol/tasks`,
and inline otherwise; `required` gives `-32021` without it. The first are `sources-sync`, `knowledge-index` and
`knowledge-refresh` (a pipeline; manifest version 5 admits `task` on a pipeline whose steps all admit it), each
`optional`.

A task record (`task-record.v1.json`) holds:
- `id`: 128 random bits as base32;
- `owner`: `{ effectivePrincipal, actor, issuer, clientId }`;
- `command`, `space`, `status`, `createdAt`, `lastUpdatedAt`;
- `ttlMs`: default 3 600 000, at most 86 400 000;
- `pollIntervalMs`: 2000;
- `statusMessage`: a host-written phase name, never content;
- `lease`: `{ process, until }`;
- `result` or `error`.

The rules:
- The record is durable before `CreateTaskResult` (ext-tasks "MUST").
- **Every `tasks/*` call compares the caller with `owner`.** A mismatch answers exactly as an unknown id.
- A task whose process died (lease past, renewed every 10 seconds) becomes `failed` with `TASK_LOST`, retryable.
- Cancel is cooperative, between batches (`limit` and `remaining`, phase 2).
- The result is kept until the TTL ends, then purged with `secure_delete`.
- Tasks run under the starting call's context: its principal, scopes and reader filter, frozen at the start.

**Guarantees kept:**
- Digest commands cannot be tasks (2.3), so a forget never leaves memory text in a task result.
- No CLI-only command can be a task, so the curator is never reached (D90).
- Confirmation and approval commands are never tasks.

### 12.3 Not in the request path

Nothing in this phase calls a model or runs the curator. `tests/hosted_not_request_path.rs` repeats phase 4's point
7 over the hosted HTTP surface with a verified token holding every scope.

### 12.4 Telemetry and OpenTelemetry export (D124, question 15)

The prerequisites row puts the Rust telemetry middleware in phase 5 "for usage events and OpenTelemetry export".
Usage events need no telemetry (12.1).

**Recommended (question 15):** leave OpenTelemetry export, and with it the Rust telemetry middleware, out of phase 5
while W12's conventions have no tagged release. The journal and usage events keep the record. Export follows the
first tagged release, in its own specification.

## 13. Security

### 13.1 What earlier phases decided, and how it holds

| Guarantee | How phase 5 keeps it |
| --- | --- |
| **Forget** (D73, D82, D103) | Digest commands cannot be tasks. Usage events hold no content. The person page stores only the preview's hash, never its text. Nonce, limit and task stores hold no memory text. Erase uses forget's path, and host-run redaction (8.5) reaches more drafts, never fewer |
| **Access filtering** (D53, D68) | Becomes a boundary in `oauth` and `gateway`. Scopes only narrow (5.3). Statistics, cursors and revisions stop showing hidden counts (9). The library embedder stays trusted, as D14 says |
| **Host-owned authority** (D71, D86) | `person` authority and `humanPresent` come only from the CLI's terminal check or a host-verified person-page decision. No token claim, gateway or plugin sets them (2.1, 4.4). `transcript` stays CLI or embedder only |
| **Attestation and verification** (D91) | Unchanged: the pipeline table, random step traces and the knowledge plugin's verification. A verified principal changes who the caller is, not what a drafter may claim |
| **Not in the request path** (principle 4, D90) | No model. The curator stays CLI-only, and tasks refuse CLI-only commands (12.2, 12.3) |

### 13.2 Threats

| Threat | Control | Test |
| --- | --- | --- |
| A token for another resource replayed here | Exact single audience; multi-audience refused (3.2, rule 5) | `afd` `tests/auth_verifier.rs`; `tests/auth_tokens.rs` |
| Algorithm confusion, or a key named by the token | Allow-list; `none` and HMAC always refused; `jku`, `x5u` and `jwk` refused | `auth_verifier.rs` |
| A token in a URL or a log | Query-string tokens refused; the raw token dropped at the layer; `Debug` redacted; a canary token never in logs, journal, usage or tasks | `tests/auth_tokens.rs`, `tests/token_canary.rs` |
| Token passthrough to mounts or upstreams | No token on the context; mounts keep the deployer's credential only (D43) | `tests/plugin_mounted.rs` (extended) |
| Stolen bearer token | Short lifetime cap; optional mTLS binding (RFC 8705); limits per token | `auth_tokens.rs`, `tests/limits.rs` |
| Forged identity header, or a misordered layer | No header read; the hook fails closed without verified extensions | `tests/auth_layers.rs` |
| A compromised or misconfigured gateway | Pinned channel plus signed per-request assertion, `jti` once, `htm` and `htu`, scope ceiling, no presence (4.4) | `tests/gateway_mode.rs` |
| Scope escalation through meta-tools, batch or pipe | Every step checked before the first runs (5.2) | `tests/scope_gate.rs` |
| A scope widening access | Scopes only narrow the reader filter (5.3) | `scope_gate.rs`, `first-party/tests/hosted_leaks.rs` |
| One actor replaying another's confirmation (#532) | Actor and credentials in the binding | AFD `tests/server_confirmations.rs`; `tests/confirm_binding.rs` |
| Approval or decision replay across instances | Shared atomic nonce store (10.2) | `tests/shared_nonces.rs` (two processes) |
| An agent answering an approval itself | Form answers never count; URL mode plus a fresh IdP login bound to `sub` (7) | `tests/person_page.rs`, `knowledge/tests/relay.rs` |
| Person-page phishing (another person opens the link) | `sub` must match the decision's (7.2, step 3) | `person_page.rs` |
| CSRF, open redirect or session fixation on the page | Sealed `state`, a `__Host-` cookie, PKCE, `nonce`, a CSRF token, a fixed redirect URI, no content script | `person_page.rs` |
| SSRF through issuer metadata or JWKS | Only configured issuers; HTTPS; no redirects; size and time caps | `tests/auth_keys.rs` |
| JWKS refresh used for denial of service | One refetch per minute per issuer on unknown `kid` | `auth_keys.rs` |
| Hidden counts | Per-filter statistics, opaque cursors and revisions, readable totals (9) | `partitioned_stats.rs`, `tests/cursor_v1.rs`, `hosted_leaks.rs` |
| Guessed task id, or another's task read | 128-bit ids; owner check answers as unknown | `tests/tasks.rs` |
| Usage records as surveillance | Content-free; own records only unless `usage.readers` (12.1) | `tests/usage.rs` |
| Abusive caller | Per-token and per-principal limits | `limits.rs` |
| Self-serving erasure | Verified eraser, `erasers` list, dry-run plan, notice to the erased principal (8.4) | `memory/tests/erase.rs` |
| DNS rebinding | Host and origin allow-lists stay in front (6.3) | `tests/protocol_http.rs` (existing) |
| Plain HTTP across a network | Non-loopback needs TLS (2.2) | `tests/config_v5.rs` |

Content trust stays phase 2's (D67): previews on the person page are `trust: "content"`, sanitised, and never put
into an elicitation `message`.

## 14. Exit criterion and tests

The exit criterion is met when `umbel.yml` is green on `main` with every test below and
`first-party/tests/exit_hosted.rs` passes in it.

**Setup:**
- `umbel-testkit-idp` on 127.0.0.1 with a test CA. It provides OIDC and RFC 8414 metadata, a JWKS, authorization
  code with PKCE and a scripted login (synthetic users `ada`, `bo` and `cy`, with test-only passwords), RFC 8693
  exchange to an ID-JAG, RFC 7523 grant, `client_credentials`, introspection, and `groups` claims.
- **Two** `umbel-first-party serve --http` processes, each bound to 127.0.0.1 with `[http.tls]` from the test CA
  and `auth.mode = "oauth"`, on one workspace, behind `first-party/tests/support/balancer.rs`, a TCP round-robin
  forwarder.
- `http.public_url = "https://umbel.test:<port>/mcp"`, with `umbel.test` resolved by the test client only.
- Spaces `alpha` and `beta`. Documents readable by `principal:human:idp/ada`, `principal:human:idp/bo`,
  `group:eng` (claim-derived for ada and cy), and `space`.

It asserts:

1. **Discovery.** No token: 401 with `resource_metadata`. Both RFC 9728 URIs serve the same document, whose
   `resource` is the public URL and whose `authorization_servers` is the fixture's.
2. **Results filtered for their users** (the exit criterion).
   - `ada` (authorization code), `bo` (authorization code) and `cy` (enterprise-managed: ID token, ID-JAG, access
     token) each call `knowledge-search` and `knowledge-open` over MCP and see exactly their sets.
   - `bo`'s answers are byte-identical, scores and opaque cursors included, to the same calls against a workspace
     without ada's documents (9.1).
   - Hidden ids, counts and titles are absent from every answer.
3. **Audience and token rules.** A token for another resource, with two audiences, expired, signed `HS256` with
   the public key, `alg: none`, with an unknown issuer, or sent in the query: each is 401, and nothing runs.
4. **Scopes.**
   - A token with `umbel:read:alpha` only: a search in `beta` is `SPACE_NOT_READABLE`; a mutation is
     `INSUFFICIENT_SCOPE` naming `umbel:write:alpha`.
   - An `afd-batch` mixing spaces names every missing scope in one refusal.
   - `tools/list` is filtered and private.
   - An agent token for ada narrowed to `alpha` cannot read ada's `beta` documents.
5. **Approval over MCP.**
   - `bo`'s agent proposes in an area with `approve_over_mcp`.
   - `ada`'s client calls `knowledge-approve` and receives a URL-mode elicitation.
   - The scripted browser opens it, logs in as ada with `prompt=login`, sees the preview with the diff, and
     approves.
   - The retry, routed to the *other* process, applies the proposal. Its record is version 3 with
     `decision.channel = "mcp-elicitation"` and `decision.assurance.level = "verified"`.
   - Each of these is refused: replaying the retry; a form-mode answer; `bo` opening ada's link; ada's token
     without the page; a confirmation `requestState` issued to ada and presented by bo.
6. **Tasks.**
   - `knowledge-refresh` as a task, polled through the balancer, completes.
   - `bo`'s `tasks/get` of ada's task answers as unknown.
   - Killing the running process makes the task `failed` with `TASK_LOST`.
7. **Usage.** Every call above has one usage event with its principal and bytes. `bo`'s `usage-list` returns only
   his own.
8. **Gateway mode.** A second workspace in `gateway` mode behind `testkit-idp`'s gateway signer with a pinned client
   certificate. These are accepted: a valid assertion, and the results filtered as in point 2. These are refused:
   no certificate; no assertion; a replayed `jti`; an assertion for another URL; a plain `X-User` header. An
   assertion claiming `humanPresent` gives no person.
9. **Forget still holds.** Ada's memory record is written and forgotten over MCP. Its canaries are absent from the
   task store, the usage stream, `nonces.sqlite3`, `person.sqlite3` and every file of the workspace.
10. **Unchanged locally.** stdio and the CLI behave as phase 4's exit tests assert, which re-run unchanged.

| Test file | Crate | Covers |
| --- | --- | --- |
| `tests/server_auth.rs`, `tests/auth_verifier.rs` | `afd` | 3.2's rules one by one; metadata routes; challenges; credentials on the context; no token on the context |
| `tests/server_confirmations.rs` (extended) | `afd` | #532 in every era |
| `tests/server_approval_relay.rs` | `afd` | Form mode per spec; host-verified mode; nonces; declined |
| `tests/server_tasks.rs` | `afd` | Negotiation, `-32021`, store durability, owner checks |
| `tests/schemas.rs` (extended) | host | Section 2's shapes and examples; version 0 principal and cursor still read |
| `tests/config_v5.rs` | host | 2.2's rules; versions 1 to 4 read as 5 with `none` |
| `tests/manifest_v5.rs` | host | `task` and `person` rules |
| `tests/auth_layers.rs` | host | 6.3's order; fail closed |
| `tests/auth_tokens.rs`, `tests/token_canary.rs`, `tests/auth_keys.rs` | host | 3.2, 3.3 through the host |
| `tests/principal_v1.rs` | host | 4.1 mapping, hashing of long ids, `act` chains, groups from claims |
| `tests/scope_gate.rs` | host | 5.2, 5.3 |
| `tests/gateway_mode.rs` | host | 4.4 |
| `tests/person_page.rs` | host | 7.2, every rule |
| `tests/shared_nonces.rs`, `tests/tasks.rs`, `tests/limits.rs`, `tests/usage.rs` | host | 10.2, 12.2, 11, 12.1, with two processes where shared |
| `tests/cursor_v1.rs` | host | 9.3 |
| `tests/space_visibility.rs` | host | 9.4 |
| `tests/host_redaction.rs` | host | 8.5 |
| `tests/no_auth_server.rs` | host | Section 1 |
| `store-embedded/tests/partitioned_stats.rs` | embedded | 9.1 differential; 9.2 order independent of other records |
| `plugins/knowledge/tests/relay.rs` | knowledge | 7.3; proposal version 3 |
| `plugins/knowledge/tests/eval_gate.rs` (existing) | knowledge | The baseline holds under per-filter statistics |
| `plugins/memory/tests/erase.rs`, `editors.rs`, `confirm_preview.rs` | memory | 8.4, 8.3, 8.1 |
| `first-party/tests/hosted_leaks.rs` | first-party | Differential probes over HTTP for every read command, as `curator_leaks.rs` |
| `first-party/tests/hosted_not_request_path.rs` | first-party | 12.3 |
| `first-party/tests/exit_hosted.rs` | first-party | The exit criterion |

**CI.** `umbel.yml` gains a `hosted` job: Linux, the `first-party` crate and the host's auth tests, which need no
external service or credential. `scripts/affected/suites.mjs` gains its local entry (the AGENTS.md rule for a new
job). AFD's step 0 tests run in `rust.yml` and the language workflows.

## 15. Out of scope, and the seams reserved

| Out of scope | When | Seam |
| --- | --- | --- |
| Several machines behind one URL | Phase 6 (shared backends) | The `src/shared/` traits (10.2) |
| DPoP, workload identity enforcement | When SEP-1932 and SEP-1933 are final (D19, W5) | `tokenBinding.kind = "dpop"` reserved; `cnf.jkt` refused rather than ignored |
| Umbel as an authorization server | Never (A7) | `tests/no_auth_server.rs` |
| Outbound per-caller credentials for mounts | Question 12; recommended for the federation specification with O1 | `bearer_env` under host secrets; D43 unchanged |
| OpenTelemetry export, the Rust telemetry middleware | Question 15; after W12's first tagged release | Usage events and the journal |
| Multi-tenant deployments | Question 14 | `tenant` reserved |
| A plugin `secrets` grant, `http` grant | The first plugin that needs them | Named and refused (D42) |
| CORS for browser clients | Loam's U1, a separate decision | `allowed_origins` |
| Server cards, registry entry | Phase 7 | Protected-resource metadata is the only public document |
| Push of usage or events over webhooks | W2 | Their streams |
| Documents as MCP resources (`kb://`) | After this phase, now that listings can be filtered | URI scheme reserved |

## 16. Implementation plan

Each step is one pull request, green on the repository's checks and `umbel.yml`, and updates
[STATUS.md](../../STATUS.md) and this file. A step that finds a design decision stops and amends this document. Steps
changing host code carry the `Plugin-isolation-exempt:` line. Steps 6, 10 and 11 depend on the owner's answers to
questions 7 to 11.

| Step | Pull request | Contents | Tests | Size |
| --- | --- | --- | --- | --- |
| 0a | AFD spec | `spec/command-metadata.md` (`scopes`, `task`, the relay's host-verified mode), `spec/error-codes.md` (`INSUFFICIENT_SCOPE`), a new `spec/authorization.md` (`credentials`, the HTTP behaviour, test vectors), #532's binding; the MCP Authorization and Tasks proposals moved to active | Spec vectors | M |
| 0b | AFD Rust auth | `server-auth`: `TokenVerifier`, `JwtVerifier`, `KeySource`, `ProtectedResource`, `BearerLayer`, `credentials`, `scopes`, the `Mcp-Name` 403, list filtering | `server_auth.rs`, `auth_verifier.rs` | L |
| 0c | AFD #532 | Actor and credentials in confirmation state, TypeScript, Python and Rust | Each language's confirmation suite | M |
| 0d | AFD Rust relay | Form-mode relay per spec; `ApprovalRelay` host-verified mode; nonce store use; parity row | `server_approval_relay.rs` | L |
| 0e | AFD Rust tasks | `TaskStore`, `tasks/*` handlers on rmcp's model types, `task` field, owner checks | `server_tasks.rs` | L |
| 1 | Umbel shapes | Section 2's schemas and examples; configuration version 5 parsing and its rules; manifest version 5 parsing; version constants | `schemas.rs`, `config_v5.rs`, `manifest_v5.rs` | M |
| 2 | Host: auth and principal | TLS listener; the layers of 6.3; metadata; issuers and `KeySource`; principal version 1 and 4.1 to 4.3; groups from claims; `auth-show`; doctor checks; `workspace-show` | `auth_layers.rs`, `auth_tokens.rs`, `token_canary.rs`, `auth_keys.rs`, `principal_v1.rs`, `no_auth_server.rs` | L |
| 3 | Host: scopes, shared state, limits | Scope gate; list filtering; `src/shared/` stores; nonce store wired into approvals; limits; space visibility | `scope_gate.rs`, `shared_nonces.rs`, `limits.rs`, `space_visibility.rs` | L |
| 4 | Host: gateway mode | 4.4 | `gateway_mode.rs` | M |
| 5 | Host: person page | 7.1, 7.2; manifest `person`; the CLI's URL flow; `humanPresent`; envelope version 3's `assurance` | `person_page.rs` | L |
| 6 | Knowledge: relay | `approve_over_mcp`; host-verified relay on approve and reject; proposal version 3 | `relay.rs` | M |
| 7 | Stores: exact filtering | 9.1 to 9.3; cursor version 1, locator version 2; readable totals; eval re-run | `partitioned_stats.rs`, `cursor_v1.rs`, `eval_gate.rs` | L |
| 8 | Tasks | Task store, manifest `task`, the three commands | `tasks.rs` | M |
| 9 | Usage | 12.1; `usage-list` | `usage.rs` | M |
| 10 | Memory | `memory-erase` (8.4), `editors` (8.3), `memory-preview` and `memory-confirm` over MCP (8.1) | `erase.rs`, `editors.rs`, `confirm_preview.rs` | M |
| 11 | Host-run redaction | 8.5 | `host_redaction.rs` | M |
| 12 | Exit | `umbel-testkit-idp`, the balancer, `hosted_leaks.rs`, `hosted_not_request_path.rs`, `exit_hosted.rs`; the `hosted` job and its `suites.mjs` entry; STATUS.md marks phase 5 done | The three | L |

**Order.** 0a first. 0b, 0c, 0d and 0e need 0a and may run in parallel. Step 1 needs 0a. Step 2 needs 0b and 1.
Step 3 needs 2. Step 4 needs 3. Step 5 needs 3 and 0d. Step 6 needs 5. Step 7 needs 1 and may run beside 2 to 6.
Step 8 needs 0e and 3. Steps 9, 10 and 11 need 3, and step 10 also needs 5. Step 12 needs all.

**Build cost.** Two dependency families: `jsonwebtoken` (with `aws-lc-rs`, already in the lock) and `rcgen` (dev
only). `aws-lc-rs` is a C build; share `CARGO_TARGET_DIR`, use `-p <crate>` and `-j4`, and build only under load 20.

## 17. For the owner

These are the trust-model and scope decisions. Each has a recommendation, the alternatives, and what it changes.
**None is decided.** The decision each becomes is pending in the log.

1. **Who a verified caller is** (D110; 4.1). *Recommended:* the person is `human:<issuer alias>/<sub>`, the client
   `agent:<alias>/<client_id>` acting for them, and a client-credentials token `service:<alias>/<client_id>`. Ids
   come from immutable subject identifiers only, and long ids are hashed. *Alternatives:* (a) a configured claim
   such as `email` or `preferred_username` as the id, which is readable but mutable and reassignable, so a new
   holder of an address would inherit someone's records; (b) an explicit deployer table from `iss`/`sub` to
   principal, refusing unmapped subjects, so no one reaches Umbel until listed.
2. **What an agent reads for its person** (D111; 4.3). *Recommended:* the person's reader filter, narrowed to the
   spaces the token's scopes grant. The `act` chain is recorded when the issuer is configured to emit it.
   *Alternatives:* (a) the person's whole filter, as today, with scopes gating commands only; (b) an agent never
   reads its person's private records (`principal:` token) unless the token holds a new `umbel:private` scope,
   which is stricter but breaks private-by-default memory recall for every agent that lacks it.
3. **Scope mapping, including per-space scopes** (D112; 5). *Recommended:* the verbs `read`, `write`, `approve` and
   `erase`, each optionally narrowed to one space, derived from effects and gates, never declared by plugins.
   Scopes only narrow access. *Alternatives:* (a) unqualified verbs only, leaving spaces to `readers`; (b)
   per-command scopes declared in manifests (`umbel:cmd:<name>`), so a plugin author decides what a deployer's
   authorization server must grant; (c) scopes that also grant space access, making the authorization server, not
   `umbel.toml`, the source of who reads a space.
4. **Groups from token claims** (D113; 4.5). *Recommended:* a group may take members from one issuer's claim with
   an exact value, unioned with static members and lasting no longer than the token. *Alternatives:* (a) static
   `members` only; (b) claims replace static members whenever configured.
5. **What a gateway is trusted for** (D114; 4.4). *Recommended:* identity only. Every request needs a pinned
   channel (mTLS or loopback) **and** a signed, single-use, request-bound assertion. Scopes are capped by a ceiling,
   and the gateway can never assert a person. *Alternatives:* (a) trust identity headers from a network-restricted
   peer, the classic trusted proxy; (b) a pinned channel with plain headers; (c) no gateway mode, so a gateway must
   forward audience-bound OAuth tokens to `oauth` mode.
6. **How a person is proven** (D115; 7). *Recommended:* two levels. `terminal` is the operator's CLI, unchanged.
   `verified` is the person page: URL-mode elicitation (or the CLI printing the URL), a fresh login at the
   deployer's identity provider with `prompt=login`, `max_age` and optional `acr`, the `sub` matched to the caller,
   and one decision bound to the call. *Alternatives:* (a) the token's `sub` is the person, with form-mode answers,
   as D99 first described; this proves a client answered; (b) RFC 9470 step-up: a fresh `auth_time` and `acr` on
   the access token, with form-mode answers, which proves a recent login but leaves the answer to the client; (c)
   WebAuthn user verification held by Umbel per decision, which makes Umbel hold passkeys, an identity role it does
   not have.
7. **The MCP approval relay** (D116, amends D99; 7.3). *Recommended:* approve and reject only, opted in per area,
   through the person page only (URL mode), recorded as `mcp-elicitation` with the assurance level. Clients without
   URL elicitation approve at the CLI. *Alternatives:* (a) AFD's form-mode relay, recording the token's subject;
   (b) form mode accepted when the token carries fresh step-up claims (question 6 (b)).
8. **Other person-gated commands over MCP** (D117; 8.1, 8.2). *Recommended:* `memory-confirm` over MCP with
   `verified` and a text preview, own records only (D88 kept). `curator-promote` stays CLI only and takes the
   person page there. *Alternatives:* (a) all stay CLI only, so hosted users can never confirm their notes and
   their default push stays empty; (b) also allow a verified person to confirm another person's record, recorded
   with both names.
9. **`memory-erase`** (D118; 8.4). *Recommended:* D85's conditions, with a `verified` eraser in `erasers`, a dry-run
   plan the erase must match, and a notice in the erased principal's stream. *Alternatives:* (a) a two-person rule,
   where a second verified eraser approves; (b) the operator's `terminal` level also suffices.
10. **Changing another person's shared record** (D119; 8.3). *Recommended:* only the record's principal or a person
    in a new `editors` list, verified over MCP. *Alternatives:* (a) keep today's rule, any sharing writer who can
    read it; (b) only the record's principal.
11. **A draft its proposer can no longer read** (D120; 8.5). *Recommended:* close it with a host-run,
    redaction-only pass under a filter that admits only the instance's own proposals citing the erased ids.
    *Alternatives:* (a) accept the limit as stated in phase 4; (b) let the knowledge plugin read its own records
    unfiltered whenever it holds `memory`, which is a general read, not only a redaction.
12. **Credentials toward mounted servers, and enterprise-managed authorization on connections** (D121; 3.4).
    *Recommended:* inbound enterprise-managed authorization is accepted with no special path. Outbound stays as D43
    (the deployer's credential, never the caller's), and per-caller token exchange for mounts is decided in the
    federation specification with O1, because it makes Umbel an OAuth client acting as each user and changes D43.
    *Alternatives:* (a) per-caller RFC 8693 or ID-JAG exchange for HTTP mounts in phase 5, so mounted servers filter
    by the user; (b) URL-mode third-party authorization per user, with Umbel storing each user's upstream tokens.
13. **Usage events** (D122; 12.1). *Recommended:* a content-free stream of its own. Each caller sees their own;
    `usage.readers` (default none) and operators see all. *Alternatives:* (a) usage in each space's event stream
    under the caller's access; (b) operators only, with callers unable to see their own.
14. **Tenancy, O5** (D123; 6.4). *Recommended:* single-tenant per deployment, closing O5; separate organisations
    run separate deployments, and `tenant` stays reserved. *Alternatives:* (a) a tenant per issuer inside one
    deployment, with spaces and keys per tenant; (b) leave O5 open.
15. **Telemetry export** (D124; 12.4). *Recommended:* no OpenTelemetry export, and no Rust telemetry middleware, in
    phase 5, until W12 has a tagged release. *Alternative:* build both now against the development conventions and
    absorb attribute churn.

### Decisions made here that do not change the trust model

These are proposed with the specification's approval, and the owner may overrule any:
- D106: AFD step 0.
- D107: auth modes, TLS on non-loopback binds, and the hosted profile as doctor-enforced requirements with
  `profile` unchanged.
- D108: token verification and audience rules, the strictest reading of the MCP text and RFC 9068.
- D109: protected-resource metadata, minimal.
- D125: exact filtering, statistics per reader filter, sealed cursors and revisions, which close the leaks phase 2
  accepted.
- D126: shared state on one machine.
- D127: tasks for plain-journaled MCP commands only.
- D128: rate limits.

## Follow-ups

| Date | Follow-up | Owner |
| --- | --- | --- |
| 2026-11-03 | An independent review of this specification, then a revision and the owner's answers (D24) | Owner's coordinator |
| 2026-11-03 | URL-mode elicitation is marked "may change" in MCP 2026-07-28; re-check it at each trajectory refresh while the relay depends on it | Phase 5 owning agent |
| 2026-11-03 | Client support for URL-mode elicitation is not yet in the extension client matrix; the relay's reach depends on it | Re-check at step 6 |
| 2026-11-03 | DPoP (SEP-1932) and workload identity (SEP-1933), when final | W5 |
| 2026-11-03 | MCP cites OAuth 2.1 draft 13, while draft 17 is current; re-read the resource-server sections at step 0b | Step 0b |
| 2026-11-03 | Several machines behind one URL: networked backends for `src/shared/` | Phase 6 |
| 2026-11-03 | Memory recall order changed (9.2) with no memory retrieval eval to measure it (phase 3 and 4 follow-ups) | After phase 5 |
| 2026-11-03 | A plugin `secrets` grant and `http` grant | The first plugin that needs them |
| 2026-11-03 | OpenTelemetry export and the Rust telemetry middleware | After W12's first tagged release (question 15) |
