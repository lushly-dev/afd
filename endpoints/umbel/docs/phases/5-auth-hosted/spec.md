# Phase 5 specification: auth and hosted

| Field | Value |
| --- | --- |
| Phase | 5, auth and hosted ([architecture section 9](../../architecture.md#9-phases)) |
| Owner | Repository owner approves; the phase 5 owning agent writes and implements |
| Read first | [STATUS.md](../../STATUS.md), then the [architecture](../../architecture.md), the [decision log](../../decisions.md), the [phase 2 specification](../2-knowledge/spec.md) (access, section 6), the [phase 3 specification](../3-memory-context/spec.md) (authority, section 3.3; who may change a record, section 6.3) and the [phase 4 specification](../4-curator/spec.md) (approval, section 8) |
| Elevation | Exact shapes, names, files, tests and pull requests. An implementing agent needs no further design decision; where it finds one, it stops and amends this document by pull request, as the earlier phases' steps did |

## Status

- **State:** **approved 2026-11-04, under the owner's 2026-10-31 delegation, with the owner's answers of 2026-11-04
  (D24)**, after an independent review and a revision.
  - Written 2026-11-03 and revised the same day after the review: 36 findings and 7 nits, every one holding, 3 in part
    ([Review response](#review-response)).
  - It adds decisions [D106 to D130](../../decisions.md), all decided. Seventeen are the owner's answers to section
    [17](#17-for-the-owner); the rest are decided with the approval under the delegation.
  - The owner took the recommended option on every question and asked for two strengthenings: **user verification
    is mandatory** on every person login (decision 6), and **a configurable two-person rule** for `memory-erase`
    (decision 9). Both are written into the sections they govern.
  - Step 0a, the AFD spec, done 2026-11-07 (documents and cases only;
    [Amendments from step 0a](#amendments-from-step-0a)).
  - Step 0b, AFD's Rust `server-auth` feature, done 2026-11-07
    ([Amendments from step 0b](#amendments-from-step-0b)).
  - Step 0c, [#532](https://github.com/lushly-dev/afd/issues/532) in TypeScript, Python and Rust, done 2026-11-07
    ([Amendments from step 0c](#amendments-from-step-0c)).
  - Step 0d, AFD's Rust host-verified mode and `HumanRelay`, done 2026-11-07
    ([Amendments from step 0d](#amendments-from-step-0d)).
  - Step 0e, AFD's Rust MCP Tasks, done 2026-11-07 ([Amendments from step 0e](#amendments-from-step-0e)). The AFD
    prerequisites 0a to 0e are complete.
  - Step 1, Umbel's shapes, done 2026-11-07: section 2's schemas, configuration and manifest version 5 parsing and
    the constants ([Amendments from step 1](#amendments-from-step-1)). Nothing acts on the new keys yet.
  - Step 1b, `umbel-testkit-idp` and the host's `tests/no_auth_server.rs`, done 2026-11-07
    ([Amendments from step 1b](#amendments-from-step-1b)). It changes no host code.
  - Step 2a, the host's listener and layers, done 2026-11-08: TLS with `client_auth`, section 6.3's order, the
    metadata, the per-IP limit and the context hook version 1 skeleton
    ([Amendments from step 2a](#amendments-from-step-2a)).
  - Step 2b, the host's verification and principal, done 2026-11-08: Umbel's `KeySource`, the verifier built from
    `[auth]` with the introspection issuer, the mapping of section 4.1 to principal version 1 with services, `act`,
    claim groups and equivalents, and an interim scope rule until step 3
    ([Amendments from step 2b](#amendments-from-step-2b)). Mode `oauth` verifies and maps, but a shipped build still
    refuses to serve it until the disclosure controls of steps 2c, 3 and 7 exist (a `testkit` seam serves it for the
    tests); `gateway` refuses to start until step 4.
  - Step 2c, the host's doctor and introspection, done 2026-11-08: every `auth.*` check of section 6.1 with
    `auth.ca_files`, the doctor the operator's alone in a hosted mode, `auth-show`, `workspace-show`'s hosted answer,
    and each issuer's `ca_file` ([Amendments from step 2c](#amendments-from-step-2c)). Its disclosure control is in;
    a shipped build still refuses to serve `oauth` until steps 3 and 7 land.
  - Step 3, the host's scopes, access, shared state and limits, done 2026-11-08: Umbel's `ScopeResolver` and scope
    gate by section 5.2's rules, section 5.4's one answer on every surface with `Caller` in `reader_filter`, the
    listings of 9.4 (and `plugin-list`, `plugin-show` and `skill-list`), the shared nonce store in approvals, the
    per-token and read limits, and `http.trusted_proxies` ([Amendments from step 3](#amendments-from-step-3)). Its
    disclosure controls are in; a shipped build still refuses to serve `oauth` until step 7 lands.
  - Step 3's follow-up to AFD, hidden commands, done 2026-11-08: AFD answers a command its resolver hides as an
    unknown name on every route before validation, and Umbel's resolver implements `known`
    ([Amendments from AFD's hidden commands](#amendments-from-afds-hidden-commands)).
  - Step 7, the stores' exact filtering, done 2026-11-08: BM25 statistics per reader filter for knowledge (index
    schema 2 with exact token counts) and for memory (BM25 in Rust with the memory tokenizer, and
    `MEMORY_QUERY_TOO_BROAD`), sealed positions (cursor version 1, locator version 2, sealed revisions) on every
    surface, readable-only totals, `workspace-show`'s per-filter statistics, and the follow-ups of steps 1, 2b, 2c
    and 3 it owned ([Amendments from step 7](#amendments-from-step-7)). **A shipped build now serves `oauth`**; the
    eval re-ran with every metric equal to the baseline; an independent security review's two blockers and seven
    improvements are fixed.
  - Step 4, the host's gateway mode, done 2026-11-08: the pinned channel (a pinned certificate on a `ca` channel,
    or the connection's own loopback address), the assertion verified rule by rule against the pinned key set and
    spent once in the shared nonce store, section 4.1's mapping in the gateway's namespace with `authentication`
    `gateway`, scopes cut to `max_scopes` by the meet, no metadata, the doctor's gateway checks, and the gateway's
    own 401 and 403 ([Amendments from step 4](#amendments-from-step-4)). **A shipped build now serves `gateway`**;
    steps 3 and 7 apply to its callers as to OAuth callers, but a missing scope is answered after routing rather
    than with 5.2's 403 (a follow-up to AFD). An independent security review's four improvements and five nits are
    fixed, each with a regression test.
- **Last verified:** 2026-11-03 against `main` at `e5b4e43c` (phase 4 done), and again for the review. Read in
  `endpoints/umbel`:
  - `src/principal.rs`:
    - The projection is version 0 (line 18), under the host-owned key `dev.umbel/principal` (line 21).
    - `Authentication` is `none`, `process` or `embedder` (lines 40-47).
    - The MCP hook maps any request with HTTP parts to `agent:loopback` with `none`, and every other request to
      `agent:<local_id>` acting for `on_behalf_of` with `process` (lines 107-139). Nothing of the request is read.
  - `schemas/principal.v0.json` (line 5) reserves these fields, each at the top level: `credentials`,
    `delegationChain`, `tokenBinding`, `humanPresent`, `policyDecision`, `policyVersion`, `scopes`, `spaces` and
    `tenant`.
  - `src/authority.rs`:
    - `person` "rests on a terminal check until phase 5" and is not an attestation (lines 5-7).
    - `cli_mark` needs the CLI interface, a human actor, transport `cli` and authentication `process`
      (lines 63-75).
    - An embedder's human is a person (lines 78-84, 97-109).
  - `src/middleware.rs`:
    - The space check refuses an undeclared space before the plugin gate (lines 147-198), with `SPACE_NOT_FOUND`
      (`src/host/space.rs:21-36`).
    - The plugin gate builds the reader filter and refuses an unreadable space with `SPACE_NOT_READABLE`
      (lines 254-261).
    - A `require-human` command needs the CLI's human-confirmed mark (lines 262-264, 278-285).
  - `src/plugins/manifest.rs:1607-1612`: `require_human()` refuses a `require-human` command that is exposed to
    MCP or to agents.
  - `plugins/knowledge/umbel-plugin.toml:298-310`: `knowledge-approve` has `approval = "required"`,
    `confirm = "require-human"`, a `confirm_prompt`, a `confirm_preview`, and CLI-only exposure.
    `plugins/curator/umbel-plugin.toml:59-61` has the same for `curator-promote`.
  - `src/surfaces/http.rs`:
    - One bearer layer compares SHA-256 digests of `state/keys/http.token` (lines 101-152).
    - It guards `/health` and the MCP path alike (lines 80-83).
  - `src/surfaces/mcp.rs`: hybrid, with the context hook and the shared confirmation key (lines 36-56).
  - `src/host/mod.rs`:
    - The approval middleware is installed `with_include_token(false)` (lines 410-428).
    - A library context is `library` and `embedder`, for any actor the embedder passes (lines 579-585).
    - The CLI context is `human:<local_id>`, `cli` and `process` (lines 602-609).
  - `src/workspace/config.rs`:
    - Configuration version 4 (line 23); `profile` must be `team` (lines 691-697).
    - `http.bind` must be loopback (lines 1240-1258).
  - `src/workspace/keys.rs`: the keys are 32 bytes, created race-safe and shared by every process (lines 15-27).
  - `src/access.rs` and `src/provenance.rs`:
    - `reader_filter` takes only a principal (`access.rs:77-110`).
    - The effective principal is `human:<onBehalfOf>` for any actor acting for someone (`provenance.rs:236-249`).
  - `src/commands/event_list.rs:74-79` calls `reader_filter` directly, so a host built-in bypasses any narrowing
    the plugin gate would apply.
  - `src/commands/event_ack.rs:50-66`: the stored cursor is parsed and written as a version 0 cursor.
  - `src/events/cursor.rs:1-4`: cursors are `v0:<space>:<seq>`.
  - `src/plugins/memory_services.rs`:
    - A sharing writer is a `person`, or a holder of a `writers` token who is a human or, with
      `agents_may_share`, anyone (lines 150-162).
    - Invalidate and supersede are open to a sharing writer who can read the record (lines 215-253).
  - The knowledge redaction sweep lists proposals with `record_list` under the caller's filter
    (`plugins/knowledge/src/proposal/redact.rs:216-240`, `src/plugins/store_services.rs:368-385`).
  - `store/src/access.rs:118-171`: `ReaderFilter::Derivation`. The memory store refuses it (D101).
  - The mounted loader sends the deployer's token from `bearer_env` and refuses redirects
    (`src/plugins/mounted/mod.rs:134-149`, `client.rs:490-503`).
- **Read in `packages/rust`:**
  - `src/commands.rs:414-482`: `CommandContext` has `actor` and `approval`, and no `credentials`.
  - `src/server/confirmations.rs`, the server-level gate, which runs before any registry middleware:
    - `check` (lines 239-348) verifies the retry, then accepts `confirm: true` under `Enforce` (lines 282-294).
    - It asks only with a **form** elicitation (lines 300-332).
    - `allows_form_elicitation` is false for a client that declares URL mode without form (lines 185-190), and such
      a client gets `CONFIRMATION_REQUIRED` (lines 334-348).
    - Under `RequireHuman`, an accepted form answer proceeds (lines 268-279).
    - The binding is the command and its input only (lines 91-103), which is
      [#532](https://github.com/lushly-dev/afd/issues/532), open on 2026-11-03.
  - `src/server/context_hook.rs`: the hook does not run on `tools/list`, `server/discover` or `initialize`
    (lines 52-54).
  - `src/approval/middleware.rs`:
    - `ApprovalNonceStore` must be atomic and is in memory by default (lines 55-64).
    - `with_nonce_store` is on line 163.
    - The token binds the actor (lines 344, 373).
  - `Cargo.toml:20-40`: features `native`, `wasm`, `journal-file`, `journal-file-shared`, `approval`, `server`
    and `frontmatter`, with `native`, `journal-file` and `approval` the defaults. No auth feature.
- **Read in the repository:**
  - The [MCP Authorization proposal](../../../../../docs/features/active/mcp-authorization/mcp-authorization.proposal.md),
    A1 to A7. A4 says scopes are "not inferred from `mutation`", and A5 gives a 403 through `Mcp-Name`.
  - The [MCP Tasks proposal](../../../../../docs/features/active/mcp-tasks/mcp-tasks.proposal.md).
  - [`spec/command-metadata.md`](../../../../../spec/command-metadata.md) lines 234-294.
  - [`docs/language-parity.md`](../../../../../docs/language-parity.md) line 136.
- **Read in the registry sources of the crates in the lock, or planned:**
  - `rmcp` 3.8.0: `task_manager.rs:300-315` (in memory); `transport/auth.rs` and `auth/enterprise.rs`
    (client side only).
  - `tantivy` 0.27.0: `src/query/bm25.rs:15`, `Bm25StatisticsProvider`.
  - `jsonwebtoken` 11.1.0, `src/validation.rs`:
    - `validate_nbf` defaults to `false`.
    - `aud` passes when **any** member matches (lines 243-247).
    - `typ` and `kid` are not checked.
    - The required claims can name only `exp`, `nbf`, `aud`, `iss` and `sub`.
  - `rustls-pki-types` 1.15.1 is in Umbel's lock.
- **External sources:** checked on 2026-11-03 (see [Trajectory refresh](#trajectory-refresh)).
- **No Rust was built** for this document. No cargo command was run except `cargo info`.
- **Done:** this specification, its revision and its approval with the owner's answers (2026-11-04).
  Step 0a (2026-11-07): [`spec/authorization.md`](../../../../../spec/authorization.md) with its cases in
  [`spec/authorization.json`](../../../../../spec/authorization.json); `scopes`, `confirmationMode`,
  `task`, #532's binding, the host-verified mode, relay evidence and Tasks in
  [`spec/command-metadata.md`](../../../../../spec/command-metadata.md); `INSUFFICIENT_SCOPE` and
  `TASK_TOKEN_EXPIRED` specified in [`spec/error-codes.md`](../../../../../spec/error-codes.md); the MCP
  Authorization and Tasks proposals moved to `docs/features/active/`.
  Step 0b (2026-11-07): `afd::server::auth` behind `server-auth` in `packages/rust` (`TokenVerifier`,
  `JwtVerifier`, `KeySource`, `ScopeResolver`, `ProtectedResource`, `BearerLayer`, `Authorization`),
  `afd::Credentials` on `CommandContext::credentials`, `CommandDefinition::with_scopes`, and
  `INSUFFICIENT_SCOPE` in the shared catalog (47 codes, all four languages); `tests/authorization_cases.rs`
  loads all 184 cases of `spec/authorization.json`, `tests/auth_verifier.rs` holds one test per M3 rule,
  `tests/server_auth.rs` the layer end to end and `tests/auth_canary.rs` the token canary.
  Step 0c (2026-11-07): confirmation `requestState` bound to the principal binding (M8) in TypeScript (the
  round's HMAC bind tag, confirmation and approval-relay answers alike), Python (the SDK's sealed state, through
  `bind_principal`) and Rust (the gate's HMAC associated data), each refusing a mismatch as it refuses a tampered
  state; TypeScript and Python load the `principalBindings` cases.
  Step 0d (2026-11-07): the host-verified mode, `HumanRelay`, relay evidence and the form-mode approval relay in
  Rust.
  Step 0e (2026-11-07): `task` (`CommandDefinition::with_task(TaskSupport)`), `afd::server::tasks` (`TaskStore`,
  the bounded `InMemoryTaskStore`, `TaskOptions`) and the `tasks/*` handlers in Rust, with the owner check in the
  store and the server; `TASK_TOKEN_EXPIRED` in the shared catalog (48 codes, all four languages);
  `tests/server_tasks.rs`.
  Step 1 (2026-11-07): eleven new schemas with examples (`principal.v1`, `provenance-envelope.v3`, `event.v3`,
  `memory-record.v2`, `proposal.v3`, `cursor.v1`, `locator.v2`, `task-record.v1`, `usage-event.v1`,
  `person-decision.v1`, `protected-resource.v1`) and two more (`workspace-config.v5`, `plugin-manifest.v5`);
  configuration version 5 (`src/workspace/hosted.rs`) and manifest version 5 (`src/plugins/manifest/v5.rs`)
  parsed and validated with every rule of 2.2 and 2.3, versions 1 to 4 reading as before; `src/auth/` with the
  constants, the scope grammar and the namespaced id form; `workspace-show`'s `versions`; `tests/config_v5.rs`,
  `tests/manifest_v5.rs`, `tests/schemas/phase5.rs` and `tests/schemas/phase5_records.rs`.
  Step 1b (2026-11-07): `umbel-testkit-idp` and `tests/no_auth_server.rs`.
  Step 2a (2026-11-08): the hosted HTTP surface (`src/surfaces/http.rs` with `http/tls.rs`, `http/listener.rs` and
  `http/layers.rs`): in-process TLS with `client_auth`, the client certificate passed to the verifier as AFD's
  `ClientCertificate`, the body size limit, the per-IP limit on the shared counters of `state/shared/limits.sqlite3`
  (`src/shared/`), `/health` and the protected-resource metadata in public, AFD's bearer layer and MCP service from one
  authorized server, the context hook version 1 skeleton, `Host::http_server` and `HttpServer::serve`, and the default
  `auth` feature; `tests/auth_layers.rs` and `no_auth_server.rs`'s `oauth` router.
  Step 2b (2026-11-08): `src/auth/keys.rs` (the `KeySource`), `fetch.rs`, `introspection.rs`, `verifier.rs`,
  `mapping.rs`, `caller.rs` and `interim.rs`; principal version 1 written on every surface (`src/principal.rs`), with
  `Config::policy_version`; equivalents and claim groups in `src/access.rs`, the memory services' ownership check and,
  through the SDK's new `CallContext::equivalents`, the knowledge plugin's self-approval check; `tests/auth_tokens.rs`,
  `tests/auth_keys.rs`, `tests/token_canary.rs` and `tests/principal_v1.rs`.
  Step 2c (2026-11-08): `src/auth/doctor.rs` (the hosted profile's checks) and `src/auth/files.rs` (certificates,
  roots and permissions), `[auth.issuers.<alias>] ca_file` in configuration version 5 and in the verifier's
  per-issuer client (`src/auth/fetch.rs`), `auth-show` (`src/commands/auth_show.rs`), `workspace-show`'s hosted
  answer and `workspace-doctor` for the operator alone in a hosted mode; `umbel-testkit-idp`'s
  `TestCa::valid_between` and `TestIdp::start_with_ca`; `tests/doctor_auth.rs`, `tests/auth_show.rs` and the
  `ca_file` cases of `tests/auth_keys.rs`, `tests/config_v5.rs` and `tests/schemas/phase5.rs`.
  Step 3 (2026-11-08): `src/auth/scopes.rs` (section 5.2's policy and Umbel's `ScopeResolver`), `scope_gate.rs`
  and the in-flight `CallerBook` (`caller.rs`); `Caller`, `Narrowing` and section 5.4's one answer in
  `src/access.rs`, with the space and access checks (`src/middleware.rs`); the listings of `space-list`,
  `plugin-list`, `plugin-show` and `skill-list`; `src/shared/nonces.rs` (the nonce store, in the approval
  middleware), `read_limit.rs` and the byte counters of `limits.rs`; the token gate of layer 6
  (`src/surfaces/http/layers.rs`); `http.trusted_proxies` with its PROXY protocol version 2 reader
  (`listener.rs`), schema and doctor check; `tests/scope_gate.rs`, `space_visibility.rs`, `shared_nonces.rs`,
  `limits.rs`, `confirm_binding.rs` and `trusted_proxies.rs`.
  Step 7 (2026-11-08): `store-embedded/src/index/stats.rs` (the per-filter statistics provider and its cache),
  index schema 2's `len_<field>` fast fields, readable prefix expansion and snippet weights
  (`store-embedded/src/index/`); `store-embedded/src/memory/rank.rs` and recall over every readable match with the
  ceiling; `umbel_store::memory::tokenizer`; `DocumentStore::last_readable`; `src/positions.rs` (the seal, the
  presenter and the journal's stash) with `state/keys/cursor.key`; sealed `event-list`, `event-ack` and
  `space-list`; the plugin gate's sealed metadata; the SDK's `Cx::doc_position`, `doc_position_of` and
  `CallContext::sealed_positions`, used by the knowledge and context plugins; `store-show` the operator's in hosted
  modes; `schemas/event-view.v1.json`; mode `oauth` served; `store-embedded/tests/partitioned_stats.rs`,
  `store/tests/memory_tokenizer.rs`, `tests/cursor_v1.rs`.
- **Not done:** steps 4 to 6 and 8 to 12 of section [16](#16-implementation-plan).
- **Follow-ups:** section [Follow-ups](#follow-ups).

### Review response

The independent review of 2026-11-03 raised 36 findings and 7 nits. Each was checked against the code and the
standards. All hold; three hold in part.

| # | Finding | Verdict | Change made |
| --- | --- | --- | --- |
| 1 | AFD's server gate runs first and sends only forms, so a URL-only client never reaches the relay; 6.1's reason was wrong | Holds (`confirmations.rs:185-190, 268-279, 300-348`) | A per-command **host-verified** confirmation mode in steps 0a and 0d: the gate never sends a form for such a command and defers to `HumanRelay`; relay evidence reaches the approval middleware through a crate-private context field, with tokens still off (3.1, 7.3). 6.1's check is restated |
| 2 | `require_human()` refuses MCP exposure; `person` was one value; `verified` unusable in `none`; CLI `for.sub` undefined; "a hosted person promotes at the CLI" contradicted the operator | Holds (`manifest.rs:1607-1612`) | `person` is per surface, `{ cli, mcp }`. Manifest version 5 admits MCP exposure of a `require-human` command only with `mcp = "verified"`. Such commands are not served over MCP without a person login. The CLI's subject comes from the mandatory namespaced `local_id` (4.6). `curator-promote` stays `terminal` (2.3, 7.1, 8.1) |
| 3 | URL mode must not authorize users for themselves; requests must bind client and user | Holds | 7.5 argues the difference; question 6 asks it; `for` holds actor, client, issuer, namespace and subject, all checked at resume (7.2) |
| 4 | Pairwise subjects, enterprise-managed `sub` from another issuer, gateway users, several issuers | Holds | Identity namespaces with a subject claim per issuer, a person login per namespace, the doctor checking `subject_types_supported`; the gateway names its namespace; exit point 5 covers an enterprise-managed user (4.1, 7.2, 14) |
| 5 | `human:ada` and `human:corp/U…` split ownership, self-approval, approvers, readers and cursors | Holds | `local_id` must be a namespaced id in hosted modes; a one-way equivalence table for legacy principals that every comparison consults; the doctor flags entries no namespace produces; migration is question 16 (4.6) |
| 6 | `SPACE_NOT_FOUND` versus `SPACE_NOT_READABLE`, and the scope gate before readability, reveal spaces | Holds (`space.rs:21-36`, `middleware.rs:147-198, 254-261`) | One answer for undeclared and unreadable spaces to non-operators, and readability before the scope gate (5.4); tested in `hosted_leaks.rs` |
| 7 | Sealed `head` and `applied` still move with hidden writes; random nonces defeat equality | Holds | Non-operators see readable positions only; sealing is deterministic (an SIV construction); exit point 2 is rewritten as a before-and-after comparison in one workspace (9.3, 14) |
| 8 | The library as operator contradicts `exact: ["library", "http"]` and leaks to embedders serving users | Holds | Only the CLI is an operator; library calls are treated by their actor; question 17 (4.7) |
| 9 | The preview stored in `person.sqlite3` holds memory text outside D82's keys | Holds | The preview is rendered at page time from the live store under the person's filter; only its hash and the declared ids are stored; exit point 9 extended (7.2) |
| 10 | Derived, input-dependent scopes conflict with A4 and A5; the hook skips `tools/list`; 403 is the MCP answer | Holds (`context_hook.rs:52-54`) | A `ScopeResolver` host trait in steps 0a and 0b, used before dispatch for an HTTP 403 and for list filtering (3.3, 5.2) |
| 11 | Layer order: the per-token limit sat before verification; the person page inside the bearer layer and outside host checks; "fail closed" too broad | Holds | A new order: an IP limit before verification, the token limit after it, the person page mounted beside MCP with its own host check; the test restated (6.3) |
| 12 | Several introspection issuers leak opaque tokens; RFC 7662 and RFC 9068 claim requirements | Holds | At most one introspection issuer, used only for non-JWS tokens; `exp`, `iat`, `iss`, `aud`, `sub` and `client_id` required in a response; `iat` and `jti` required in a JWT (3.2) |
| 13 | The relay protocol was under-specified | Holds | Pending retries, the relay `requestState`, the server-side PKCE verifier and the shared `person.key` are specified (7.2, 7.3) |
| 14 | `prompt=login` with empty `acr_values` is passable by browser automation; clickjacking | Holds | Threat row; the doctor warns on empty `acr_values` (made a failure, with user verification checked on every login, by owner decision 6 on 2026-11-04); `frame-ancestors 'none'` and `X-Frame-Options: DENY` (7.2, 6.1, 13.2) |
| 15 | `memory-erase` against D85's "blind" | Holds | Erase acts on the target principal's records without the eraser's filter and returns counts only (8.4) |
| 16 | Host-run redaction adds a privileged filter against D101; no durable trigger; ownership undefined | Holds | Question 11 amends D101 explicitly; an erasure outbox row in the forget's transaction; ownership is the instance's record namespace, with a host-only command (8.5) |
| 17 | Plan order | Holds | `umbel-testkit-idp` is step 1b; 0c needs 0b; step 2 split into 2a to 2c (16) |
| 18 | No error-code table; codes missing; prefix | Holds | Section 10.5; `WORKSPACE_SHARED_TIMEOUT`; `TOKEN_SCOPES_TOO_MANY` is a 401, not `INSUFFICIENT_SCOPE` |
| 19 | Stored version 0 cursors break stdio consumers | Holds (`event_ack.rs:50-66`) | Stored cursor files keep positions; only cursor strings handed to non-`process` callers are sealed; version 0 strings stay valid for `process` (9.3) |
| 20 | `client_credentials` detection unimplementable | Holds | An explicit rule per issuer: `services.clients` and `services.claim`, plus `sub == client_id` (4.1) |
| 21 | Claim-derived groups make the identity provider a visibility source | Holds | Said in 4.5 and question 4 |
| 22 | Tasks outlive their token and keep content | Holds | A task stops at its token's `exp`, re-checks readability per batch, and is admitted only for results without content (12.2) |
| 23 | Memory recall bounded by recency | Holds | BM25 per reader filter in Rust over every readable match, with a refusal past a ceiling instead of truncation (9.2) |
| 24 | Field norms are quantized; the eval claim was wrong | Holds in part: tantivy's own `total_num_tokens` is exact, but summing per-document norms is not | Exact per-chunk token counts in a fast field; the eval gate must pass within its tolerance, with no claim of equality (9.1) |
| 25 | Gateway and mTLS details | Holds | `htu` against `http.public_url`; the ceiling as a meet in the scope order; `client_auth = "ca"` with pins for gateways; bound tokens need in-process TLS; a 401 shape (4.4, 2.2) |
| 26 | The `auth.principals` warning was inverted | Holds | Replaced by 4.6's mandatory join check |
| 27 | The long-id hash collides with a literal subject | Holds | Ids starting with `~` are always hashed, and the hash form starts with `~` (4.1) |
| 28 | Verifier details and `jsonwebtoken` defaults | Holds (`validation.rs`) | Metadata discovery order, JWK binding to the header, refusal of `crit`, and every check made explicitly rather than by the crate's defaults (3.2) |
| 29 | Narrowing does not reach host built-ins | Holds (`event_list.rs:74-79`) | `reader_filter` takes the call's caller, scopes included (5.4) |
| 30 | Do 5.2's rows add up? | Holds | Needs are the union of every row that applies (5.2) |
| 31 | "Agents are already refused" | Holds in part: true only while `agents_may_share` is false | Restated; editors must be persons whatever `agents_may_share` says (8.3) |
| 32 | `rustls-pemfile` is archived | Holds in part: the archival was not re-checked; `rustls-pki-types` 1.15.1 is in the lock | `rustls-pki-types`' `PemObject` (1) |
| 33 | The architecture's trust model still names AFD's prompt | Holds | Architecture section 5 amended (decided with the approval) |
| 34 | `policyVersion` moved under `policyDecision` | Holds (D36) | Kept top-level (2.1) |
| 35 | Missing test files | Holds | `doctor_auth.rs`, `auth_show.rs`; `principal_v1.rs` and `person_page.rs` name the cases (14) |
| 36 | Question 15 was framed by cost | Holds | Restated as correctness (17, question 15) |
| N | Nits: the feature list; trajectory W5 "Drafts"; cipher suites; `SameSite=Lax` and `response_mode`; RFC 9068 has no `resource`; whether polls and lists count as usage; the doctor check for a remote proxy | Hold | Each fixed: Status; trajectory W5 row; 6.2; 7.2; 3.2; 12.1; 6.1 (`auth.tls`) |

## What this phase serves

The phase 5 row of the architecture:

> the MCP Authorization layer, the principal projected onto actor and credentials, enterprise-managed authorization,
> protected-resource metadata, gateway-trusted mode, the shared confirmation key and approval nonce store, Tasks for
> long jobs, usage events, the MCP approval relay on approve and reject (moved from phase 4, D99).

Its exit criterion: *a hosted deployment behind an external identity provider returns results filtered for its users.*

The row asks this specification to settle five things:

| Item | Where |
| --- | --- |
| Trait shapes | 3.3 (AFD), 10 (host) |
| The principal's extension fields | 2.1, 4 |
| Scope mapping, including per-space scopes | 5 |
| Audience rules | 3.2 |
| The hosted profile | 6 |

It also takes up what earlier phases deferred to it:

| Deferred item | From | Where here |
| --- | --- | --- |
| `memory-erase` | D85, phase 3 section 13 | 8.4 |
| #532 | Phase 0 review | 3.1, step 0c |
| Partitioned BM25 statistics; no hidden counts in scores, revisions, `seq`, totals, memory order | D53, phase 2 section 6, phase 3 5.3 | 9 |
| Token verification, `scopes`, `credentials` | Architecture prerequisites | 3 |
| The dynamic confirmation prompt | Phase 2 G2; done at the CLI by D97 | 7.4 |
| Real proof of a person | D71, D86, phase 3 3.3, W5 | 7 |
| The Rust MCP approval relay | D99, parity line 136 | 3.1, 7.3 |
| Read rate limits, limits on verified agents | D74, phase 2 section 13 | 11 |
| Delegation narrowing, `delegationChain` | Phase 2 section 6, phase 3 3.1 | 4.3 |
| `space-list` and `workspace-show` listing every space | STATUS follow-up, phase 2 step 4 | 9.4 |
| `memory-confirm` on another person's record | D88 | 8.2 |
| A sharing writer closing another person's record | Phase 3 step 10, item 1 | 8.3 |
| A draft whose proposer lost read access | Phase 4 step 3b, amendment 12; step 7, amendment 11 | 8.5 |
| `secrets`, and `bearer_env` under it | Phase 1 follow-up, D43 | 10.4 |
| Tenancy beyond spaces (O5) | Decision log | 6.4 |
| The Rust telemetry middleware | Prerequisites table | 12.4 |

| Principle | How phase 5 serves it |
| --- | --- |
| 1. Empty host | Auth, scopes, the person page, tasks, usage and limits are host services with no domain logic. Umbel is a resource server and owns no identity provider (A7) |
| 3. Everything is a command | `usage-list` and `auth-show` are commands. The person page is the one HTTP route that is not one: it is the out-of-band half of a command's elicitation (7.2) |
| 4. No model in the request path | Nothing here calls a model. The curator stays CLI only, and no task can run it (12.2) |
| 9. Stored content is untrusted input | Token claims and gateway assertions are verified before any field reaches the context; elicitation answers are never evidence of a person (7) |
| 10. Permission-aware | Filtering becomes a boundary, and it is exact: statistics and positions are per reader filter (9) |
| 11. Stateless and horizontal | Instances behind one URL share the keys, the nonce store, person decisions, tasks and limit counters (10.2) |
| 14. Every mutation is an event | Unchanged; usage is metering, kept apart from the event streams (12.1) |
| 15. AFD first | Token verification, scopes and their resolver, `credentials`, #532, the host-verified confirmation mode, the relay and Tasks land in AFD first (D106) |
| 16. Spaces do not mix | Per-space scopes narrow a token to spaces (5); a task belongs to one space |

Decisions served: D14, D19, D24, D25, D26, D29, D32, D36, D42, D43, D53, D62, D68, D71, D73, D74, D82, D84, D85,
D86, D88, D91, D97, D99, D101, D102 and D103, and the new D106 to D130. D116 amends D99, D120 amends D101, and D123
closes O5 (owner decision 14). O1 and O4 are untouched.

## Trajectory refresh

Refreshed 2026-11-03 against primary sources.

**One finding changes the design.** URL-mode elicitation in MCP 2026-07-28 makes an out-of-band, server-verified
person possible, which form mode cannot be (owner decision 6). **A second finding narrows scope.** Enterprise-managed
authorization asks nothing new of a resource server (3.4).

| Row | Checked against | Finding on 2026-11-03 | Effect on phase 5 |
| --- | --- | --- | --- |
| W1 release cycle | [MCP roadmap](https://modelcontextprotocol.io/development/roadmap), last updated 2026-08-22 | 2026-07-28 current. Priority 3, "Agent Identity and Enterprise-Ready Security": DPoP, SEP-1933, ID-JAG, RFC 8693. Human-presence attestation "under discussion" | Pins MCP 2026-07-28 and keeps 2025-11-25 |
| MCP Authorization | [Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization), [discovery](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery), [security considerations](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations), 2026-07-28 | <ul><li>OAuth 2.1 (cites draft 13); servers "MUST implement" RFC 9728, with at least one authorization server.</li><li>Discovery by `resource_metadata` or a well-known URI.</li><li>Audience validation "MUST"; "MUST NOT accept or transit any other tokens".</li><li>Insufficient scope "SHOULD" be a 403 with `error="insufficient_scope"`, all scopes in one challenge; required scopes "may be determined dynamically based on the specific request arguments"; scope hierarchies respected.</li><li>stdio "SHOULD NOT" follow it.</li></ul> | Section 3, 5.2 |
| Enterprise-managed authorization | [`ext-auth`](https://github.com/modelcontextprotocol/ext-auth), stable, revision 2026-07-28, last commit 2026-10-23 | <ul><li>ID token, then an ID-JAG by RFC 8693 at the IdP, then an access token by RFC 7523 at the resource authorization server, "audience-restricted to the MCP Server".</li><li>No step for the resource server.</li><li>The access token's `sub` is the resource authorization server's, which login at the IdP need not match.</li></ul> | 3.4, 4.1 (namespaces), owner decision 12 |
| W5 agent identity | [SEP-1932](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/1932), [SEP-1933](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/1933); GitHub API | Open pull requests, not drafts, updated 2026-11-02 | DPoP and workload identity stay reserved (D19) |
| Elicitation | [Elicitation, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation) | <ul><li>URL mode is "out-of-band… not exposed to the client".</li><li>Servers "MUST verify the identity of the user who opens the URL" and "MUST ensure that the user who started the elicitation request… is the same user who completes" it.</li><li>"MUST NOT provide a URL which is pre-authenticated".</li><li>"MUST bind elicitation requests to the client and user identity".</li><li>"MUST NOT rely on URL mode elicitation to authorize users for themselves".</li><li>URL mode "may change".</li></ul> | Section 7, 7.5, owner decision 6 |
| W7 Tasks | [Tasks](https://modelcontextprotocol.io/extensions/tasks/overview); [`ext-tasks`](https://github.com/modelcontextprotocol/ext-tasks) revision 2026-07-28, last commit 2026-10-20 | <ul><li>Only `tools/call` becomes a task.</li><li>Servers "MUST perform authentication and authorization checks on each task-related request", with unguessable ids, durable before `CreateTaskResult`.</li><li>`Mcp-Name` carries `taskId`; no progress notifications.</li></ul> | 12.2 |
| W2 MCP Events | [SEP-3415](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/3415) | Open, updated 2026-11-03 | Usage and events stay in Umbel's log |
| W12 OpenTelemetry GenAI | Not re-checked; phase 0's refresh (no tagged release) stands | | Owner decision 15 |
| IETF drafts | Datatracker API | `draft-ietf-oauth-v2-1` 17 (2026-10-31; MCP cites 13); `draft-ietf-oauth-identity-assertion-authz-grant` 06 (2026-10-31; EMA cites 04); `draft-ietf-oauth-client-id-metadata-document` 03 (2026-11-02) | The verifier follows the RFCs it uses: RFC 6750, 7519, 7662, 8414, 8705, 8707, 9068, 9207, 9728, and OIDC Core and Discovery |
| Libraries | `cargo info`; registry sources | <ul><li>`rmcp` 3.8.0: no server auth; `TaskManager` in memory.</li><li>`jsonwebtoken` 11.1.0 (MSRV 1.88, `aws_lc_rs` feature), with the defaults the Status lists.</li><li>`aws-lc-rs` 1.19.0, `rustls` 0.23.46, `tokio-rustls` 0.26.6 and `rustls-pki-types` 1.15.1 in the lock.</li><li>`tantivy` 0.27.0 `Bm25StatisticsProvider`.</li></ul> | 1, 3, 9 |

Rows W3, W4, W6, W8 to W11 and W13 to W18 were not re-checked.

## Terms

These enter the [glossary](../../architecture.md#12-glossary).

| Term | Meaning |
| --- | --- |
| Auth mode | `auth.mode`: `none` (today's loopback token), `oauth` (an OAuth 2.1 resource server) or `gateway` (a verified gateway assertion) |
| Canonical resource URI | `http.public_url`: the MCP endpoint's absolute HTTPS URL, the token audience (RFC 8707) and the metadata's `resource` (RFC 9728) |
| Identity namespace | `[auth.namespaces.<ns>]`: one population of people whose subject values are comparable, the prefix of their principal ids, with at most one person login |
| Issuer alias | The deployer's name for one trusted authorization server, `[auth.issuers.<alias>]`, mapped into one namespace |
| Verified principal | A principal whose actor comes from a verified token or gateway assertion (`authentication` `verified` or `gateway`) |
| Space scope | An OAuth scope narrowed to one space, `<prefix>:<verb>:<space>` |
| Gateway assertion | A short-lived JWS a configured gateway signs for one request, naming the caller it authenticated |
| Person assurance | How a person is proven for one decision: `terminal` (the CLI's check) or `verified` (a fresh login at the namespace's identity provider, on the person page) |
| Person page | The host's HTTPS page that a URL-mode elicitation, or the CLI, sends a person to, where they log in and decide one gated call |
| Host-verified confirmation | AFD's per-command confirmation mode under which the server never sends a form, and defers the decision to the host's `HumanRelay` |
| Operator | A caller at the host's own CLI (transport `cli`, authentication `process`); nothing else (owner decision 17) |
| Task | An MCP task running one command, bound to the principal that started it |
| Usage event | One request's content-free metering record |
| Hosted profile | The requirements the doctor enforces when `auth.mode` is not `none` |

## 1. Crate layout

```text
packages/rust/                    # step 0 (AFD first, D106)
├── src/server/auth/              # TokenVerifier, JwtVerifier, KeySource, ScopeResolver, ProtectedResource, BearerLayer
├── src/server/confirmations.rs   # #532; the per-command host-verified mode
├── src/server/human_relay.rs     # HumanRelay: host-decided confirmations and approvals over MCP
├── src/server/tasks/             # TaskStore, tasks/* handlers over rmcp's model types
├── src/approval/middleware.rs    # relay evidence accepted beside tokens (crate-private)
└── src/commands.rs               # CommandContext.credentials; CommandDefinition.scopes, .task, .confirmation_mode
endpoints/umbel/
├── src/auth/                     # modes, namespaces, issuers, mapping, scope resolver and gate, gateway verifier
├── src/person/                   # the person page: OIDC relying party, decisions, rendering
├── src/shared/                   # shared state stores: nonces, person decisions, tasks, limits
├── src/usage/                    # usage events and usage-list
├── src/surfaces/http.rs          # TLS listener, metadata and person routes, layers in order
├── store-embedded/src/           # per-filter BM25 statistics and exact token counts; memory BM25 in Rust
├── plugins/knowledge/            # approve and reject over MCP; proposal version 3; the host erasure sweep
├── plugins/memory/               # memory-erase; editors; memory-preview
├── testkit-idp/                  # umbel-testkit-idp: a credential-free identity provider, AS and gateway for tests
└── schemas/                      # + the shapes of section 2
```

| Crate | Depends on | New third-party dependencies | Notes |
| --- | --- | --- | --- |
| `afd` (`packages/rust`) | as before | `jsonwebtoken` 11.1 (feature `aws_lc_rs`), behind a new `server-auth` feature | Step 0. No HTTP client: key fetching is the `KeySource` trait |
| `umbel` (host) | + `afd/server-auth` | `tokio-rustls` (in the lock) and `rustls-pki-types`' `PemObject` (1.15.1, in the lock); `reqwest` (in the lock for mounts) joins the new default `auth` feature | Sections 3 to 12 |
| `umbel-store`, `umbel-store-embedded` | as before | none | Section 9 |
| `umbel-plugin-knowledge`, `umbel-plugin-memory` | as before | none | Sections 7, 8 |
| `umbel-testkit-idp` | `jsonwebtoken`, `axum`, `tokio-rustls` | `rcgen` (dev) for test certificates | Test-only, `publish = false`, quarantined with no route; never linked into a shipped binary |

`tests/no_auth_server.rs` (host) fails if `umbel` depends on `umbel-testkit-idp` outside `[dev-dependencies]`, or if
it serves a token or authorization endpoint. Umbel is never an authorization server (A7, D107).

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
| Person decision version 1 | `person-decision.v1.json` | new | 7.2 |
| Protected-resource metadata | `protected-resource.v1.json` | new; RFC 9728's fields | 3.3 |

`workspace-show`'s `versions` gains:
- `principal: [0, 1]`, `config: [1, 2, 3, 4, 5]` and `manifest: [1, 2, 3, 4, 5]`;
- `envelope: [0, 1, 2, 3]`, `event: [0, 1, 2, 3]` and `proposal: [1, 2, 3]`;
- `cursor: [0, 1]` and `locator: [1, 2]`;
- `task: 1`, `usage: 1` and `person: 1`.

The plugin protocol stays **1** (D40 as annotated by D54), and WIT world 1.0.0 is unchanged.

### 2.1 Principal projection, version 1 (D110, D111)

Version 0's four fields keep their meaning:
- `authentication` gains `verified` and `gateway`, as phase 0 reserved;
- the reserved top-level fields take their meanings, **each at the top level where version 0 reserved it** (D36),
  `policyVersion` included;
- `tenant` stays reserved (owner decision 14);
- Umbel never copies the token or AFD's `credentials` here.

```json
{
  "version": 1,
  "actor": { "kind": "agent", "id": "corp/f53f191f9311af35", "onBehalfOf": "corp/U019488227" },
  "transport": "http",
  "authentication": "verified",
  "namespace": "corp",
  "issuer": "corp-as",
  "delegationChain": [ { "kind": "agent", "id": "corp/f53f191f9311af35" } ],
  "tokenBinding": { "kind": "bearer" },
  "humanPresent": null,
  "scopes": ["umbel:read:main", "umbel:write:main"],
  "spaces": { "main": ["read", "write"] },
  "policyDecision": { "decision": "allow", "policy": "auth", "reason": null },
  "policyVersion": "sha256:9f…"
}
```

| Field | Rule |
| --- | --- |
| `namespace`, `issuer` | The identity namespace and the issuer alias (or the gateway's alias). `null` for `none`, `process` and `embedder` |
| `actor` | Mapped from the verified token or assertion (4.1); for `process` and `embedder`, as version 0 |
| `delegationChain` | Outermost first. `[client]`, or the RFC 8693 `act` chain when the issuer is configured `delegation = "act"` (4.3); `[]` otherwise; at most 8 |
| `tokenBinding` | `{ "kind": "bearer" }` or `{ "kind": "mtls", "thumbprint" }` (RFC 8705); `"dpop"` reserved and refused (D19); `null` without a token |
| `humanPresent` | `null`, or `{ "level": "terminal" \| "verified", "method": "cli-terminal" \| "person-page", "at", "authTime"?, "acr"? }`. Only the host sets it: the CLI's terminal check, or a completed person decision (7.2). **No token claim and no gateway sets it** |
| `scopes` | The granted Umbel scopes after the prefix filter (5.1) |
| `spaces` | Per readable space, the verbs the scopes grant there (5.4) |
| `policyDecision` | `{ decision, policy, reason }`; `reason` is a rule code, never a claim value |
| `policyVersion` | The SHA-256 of the `[auth]` and `[access]` tables as read |

The hook sets version 1 in every mode. A version 0 principal is read only from journal entries already written.

### 2.2 Workspace configuration, version 5 (D107)

Version 4 with these tables. Versions 1 to 4 read as version 5 with `auth.mode = "none"`; `umbel init` writes 5.

```toml
config_version = 5

[principal]
local_id = "corp/U019488227"                   # in oauth and gateway modes: <namespace>/<subject> (4.6)

[principal.equivalents]                        # legacy principal -> namespaced principal, one way (4.6, owner decision 16)
"human:ada" = "human:corp/U019488227"

[http]
bind = "0.0.0.0:8443"                          # non-loopback only with auth.mode != "none" and [http.tls]
public_url = "https://umbel.example.com/mcp"   # required when auth.mode != "none"; its path equals http.path
path = "/mcp"
allowed_hosts = ["umbel.example.com"]

[http.tls]
cert = "secrets/tls/cert.pem"
key = "secrets/tls/key.pem"
client_auth = "none"                           # "none" | "ca" (chain to client_ca) | "any" (self-signed, RFC 8705 binding only)
client_ca = "secrets/tls/gateway-ca.pem"       # required for client_auth = "ca"

[auth]
mode = "oauth"                                 # "none" | "oauth" | "gateway"
scope_prefix = "umbel"                         # ^[a-z][a-z0-9.-]{0,31}$
filter_tools_by_scope = true
clock_skew_s = 60                              # 0 to 300
max_token_lifetime_s = 3600
require_bound_tokens = false                   # true needs [http.tls] client_auth != "none"

[auth.namespaces.corp]                         # ^[a-z][a-z0-9-]{0,31}$
person = { issuer = "corp-idp", client_id = "umbel-person-page", client_secret_env = "UMBEL_PERSON_SECRET",
           subject_claim = "sub", max_age_s = 300,
           acr_values = ["phr"],                                        # required: classes needing user verification
           uv_amr = ["pin", "fpt", "face", "iris", "retina", "vbm"] }   # RFC 8176 user-verification methods

[auth.issuers.corp-idp]                        # an OIDC provider; issues the person login, and may issue tokens
issuer = "https://idp.example.com"
namespace = "corp"
subject_claim = "sub"                          # must be a public, non-pairwise subject (4.1)
verify = "jwt"                                 # "jwt" (RFC 9068) | "introspection" (RFC 7662), at most one issuer
algorithms = ["RS256", "PS256", "ES256", "EdDSA"]
delegation = "none"                            # "none" | "act"
services = { clients = ["build-bot"], claim = { name = "idtyp", value = "app" } }

[auth.issuers.corp-as]                         # the resource authorization server (enterprise-managed authorization)
issuer = "https://as.example.com"
namespace = "corp"
subject_claim = "sub"                          # the deployer asserts it equals corp-idp's subject (4.1, owner decision 1)

[auth.gateway]                                 # mode = "gateway" only (4.4, owner decision 5)
alias = "edge"
namespace = "corp"
issuer = "https://gateway.example.com"
keys = "secrets/gateway/jwks.json"
client_cert_sha256 = ["ab12…"]
max_assertion_age_s = 60
max_scopes = ["umbel:read", "umbel:write"]

[access.groups.eng]
members = ["human:corp/U019488227"]
claim = { issuer = "corp-idp", name = "groups", value = "engineering" }   # owner decision 4

[limits]
ip_requests_per_minute = 1200
calls_per_minute = 600
read_bytes_per_minute = 67108864
person_pages_per_hour = 30

[usage]
enabled = true
readers = []
retention_days = 400
```

Rules checked at open, each failing with `WORKSPACE_CONFIG_INVALID` naming the key:
- **Binding.** A non-loopback `http.bind` needs `auth.mode` other than `none` **and** `[http.tls]`.
- **Public URL.** `http.public_url` is `https`, with no query or fragment, a host in `allowed_hosts`, and a path
  equal to `http.path`.
- **Issuers.**
  - `oauth` needs at least one issuer.
  - At most one issuer may have `verify = "introspection"`.
  - Every issuer names a declared namespace.
- **Gateway.** `gateway` needs `[auth.gateway]` with `client_cert_sha256` and `client_auth = "ca"`, unless the bind
  is loopback.
- **Bound tokens.** `require_bound_tokens` needs `client_auth` other than `none`, so that the certificate reaches
  Umbel (in-process TLS).
- **Namespaces.** A namespace's `person.issuer` is an issuer of that namespace. Its `acr_values` and `uv_amr` must
  be non-empty, and `uv_amr` may name only RFC 8176 user-verification methods (`pin`, `fpt`, `face`, `iris`,
  `retina`, `vbm`). A person login without them is invalid, and its namespace's `verified` commands are not served
  (owner decision 6).
- **Secrets.** Every `*_env` key names a variable, never a value.
- **Operator id.** In modes `oauth` and `gateway`, `principal.local_id` is `<ns>/<subject>` for a declared
  namespace (4.6).
- **Equivalents.** Each `principal.equivalents` entry maps a principal string that no namespace can produce to one
  that a namespace produces, with no chains.
- **Profile.** `profile` stays `team` (6.1).

### 2.3 Plugin manifest, version 5 (D115, D127)

Version 4 with two keys, each also admitted on a pipeline when every step admits its value.

**`task = "never" | "optional" | "required"`**, default `never` (12.2). It is refused (`PLUGIN_MANIFEST_INVALID`)
on any of these:
- digest journaling, `confirm`, `approval` or `authority_prompt`;
- no MCP exposure;
- a mounted tool or a component command;
- a command whose effects include `inspect` alone, since read results carry content.

**`person = { cli = "terminal" | "verified", mcp = "verified" }`** on a `confirm = "require-human"` command. It
names the least person assurance per surface (7.1).

| Rule | Detail |
| --- | --- |
| Default | `{ cli = "terminal" }`: the phase 2 to 4 behaviour |
| `mcp` | May only be `"verified"`. **Only with `mcp` set may a `require-human` command be exposed to MCP**: `require_human()` (`manifest.rs:1607-1612`) admits `expose.mcp = true` in manifest version 5 when `person.mcp` is set, and still refuses agent exposure |
| A preview is required | A command with `person.mcp` or `person.cli = "verified"` must declare `confirm_preview`. Every property the preview declares must be in the command's `journal.keep`, so a person decision never stores text (7.2) |

A host reads manifest versions 1 to 5. `scopes` stays reserved (D37): scopes are resolved, never declared (5.2).

### 2.4 Envelope version 3, and the shapes that nest it (D111, D115)

Version 2 with two changes:
- **`delegationChain`** takes its meaning: the principal's chain at the write.
- **`confirmation`** gains `assurance`: `{ "level", "method", "namespace"?, "authTime"?, "acr"? }`.

`tenant` stays reserved. The shapes that nest it:
- event version 3;
- memory record version 2, on new versions only;
- proposal record version 3 (7.3).

Documents keep their envelope version: an applied document's decision trace is its proposal.

## 3. The MCP Authorization layer

### 3.1 AFD first: step 0 (D106)

These land in AFD before Umbel uses them (D25), spec first where cross-language. They move the MCP Authorization
and MCP Tasks proposals from proposed to active.

| Item | AFD change | Step |
| --- | --- | --- |
| `scopes`, `INSUFFICIENT_SCOPE`, and a **`ScopeResolver`** host override (3.3) | `spec/command-metadata.md`, `spec/error-codes.md`. A4 keeps static `scopes` as the default; a resolver, when installed, decides per call (command and input), as MCP allows. A5 is amended: a missing scope on any non-streamed `tools/call` is HTTP 403, decided before dispatch, through the resolver | 0a spec; 0b Rust |
| `CommandContext.credentials` | `{ issuer, subject, clientId, scopes, resource, expiresAt, issuedAt, authTime?, acr?, cnf? }`; never the raw token | 0a; 0b |
| The Rust bearer layer | `afd::server::auth` behind `server-auth` (3.3) | 0b |
| #532 | The confirmation `requestState` binds the actor and, when present, `credentials.issuer`, `.subject` and `.clientId`; a state bound to other values is refused as tampered | 0a spec; 0c in TypeScript, Python and Rust, **after 0b** (it needs `Credentials`); done 2026-11-07 |
| **Host-verified confirmation mode** | `CommandDefinition::confirmation_mode = HostVerified` (spec name `confirmationMode: "host-verified"`). For such a command the server-level gate (`confirmations.rs:239-348`) never sends a form, never accepts `confirm: true`, and never accepts a form answer. It calls the server's `HumanRelay::begin`, answers with the relay's `input_required`, and on a retry calls `HumanRelay::resume`. Without a relay installed, the command is refused with `CONFIRMATION_REQUIRED` | 0a spec; 0d Rust |
| **Relay evidence for approvals** | When a `HumanRelay` decision covers a command with an approval policy, the server sets a crate-private `relay_evidence` on the context: `{ command, inputDigest, actor, credentialsBinding, decisionId }`. It is never read from the request, as the private in-process exchange is not (#460). The approval middleware accepts it as evidence when its binding equals the call's and the decision id is consumed once in its nonce store. **Approval tokens stay off** (`with_include_token(false)`, `host/mod.rs:410-413`) | 0a spec; 0d Rust |
| The approval relay, form mode | Rust's form-mode relay per `spec/command-metadata.md`, for hosts that choose it; Umbel does not (7.3) | 0d |
| Tasks | `task` on a command, `TaskStore`, and the `tasks/*` handlers with a principal check on every call (T2, T3, T5) | 0a spec; 0e Rust |

### 3.2 Token verification and audience rules (D108)

On every MCP HTTP request in mode `oauth`, at the bearer layer (6.3), these rules apply in order.

A failure is HTTP 401 with `WWW-Authenticate: Bearer resource_metadata="<url>", scope="<prefix>:read"`, plus
`error="invalid_token"` when a token was sent. The body is `{"error":"UNAUTHORIZED","suggestion":"Obtain a token for
<public_url> from an authorization server named in <metadata url>."}`. The reason is logged at `warn` as the issuer
alias and a rule code, never the token or a claim value.

**`jsonwebtoken`'s defaults are not relied on.** AFD's `JwtVerifier` sets `validate_nbf = true`, `leeway =
clock_skew_s` and an algorithm list per key, and checks `typ`, `kid`, `aud`, `iat`, `jti`, `client_id` and `crit`
itself. `tests/auth_verifier.rs` holds each rule against a token built to break only that rule.

1. **One header.** Exactly one `Authorization: Bearer <token>`. A token in the query, in a form body or in a second
   header is refused (RFC 6750 2.3).
2. **Route by shape.**
   - A compact JWS goes to the JWT rules. Its `iss` must name a `verify = "jwt"` issuer, else 401 (rule
     `unknown-issuer`).
   - Anything else goes to the one introspection issuer, if there is one, else 401.
   - A token is never sent to any other issuer, so an opaque token never transits to an authorization server that
     did not issue it.
3. **Header.**
   - `typ` must be `at+jwt` or `application/at+jwt` (RFC 9068 2.1).
   - `alg` must be in the issuer's `algorithms`. `none` and every HMAC algorithm are always refused.
   - `kid` is required.
   - A `crit` header is refused (no extension is understood).
   - `jku`, `x5u`, `x5c` and an embedded `jwk` are refused.
4. **Key.** The key with that `kid` in that issuer's JWKS (3.3) must match the header:
   - its `kty` fits the `alg`'s family;
   - its `alg`, when present, equals the header's;
   - its `use`, when present, is `sig`;
   - its `key_ops`, when present, contain `verify`.
5. **Signature** under that key.
6. **Issuer.** `iss` equals exactly the configured `issuer` (simple string comparison).
7. **Audience** (RFC 8707 2, RFC 9068 4). `aud` is a string, or an array of **exactly one** string, equal to
   `http.public_url`. Scheme and host compare case-insensitively, as the MCP specification allows. A token with
   several audiences is refused, since any of them could replay it here.
8. **Required claims** (RFC 9068 2.2):
   - `exp`, `iat`, `jti`, `sub` and `client_id` are required;
   - each is a non-empty string of at most 255 characters, with no control character, or a number for the times.
9. **Time.**
   - `exp` must be in the future.
   - `iat` and `nbf`, when present, must be in the past.
   - Each is within `clock_skew_s`.
   - `exp - iat` must be at most `max_token_lifetime_s`.
10. **Scopes.** `scope` is split on spaces. More than 64 scopes under the prefix is 401 with rule
    `scopes-too-many` (`TOKEN_SCOPES_TOO_MANY` in the log), never `INSUFFICIENT_SCOPE`, since asking for more
    scopes cannot fix it.
11. **Binding.**
    - With `cnf.x5t#S256` (RFC 8705), the TLS client certificate's SHA-256 must match it.
    - Without one, `require_bound_tokens` refuses the token.
    - `cnf.jkt` (DPoP) is refused with rule `dpop-unsupported` while D19 reserves it, never treated as a bearer
      token.
12. **Introspection** (RFC 7662).
    - The response must say `active: true` and carry `exp`, `iat`, `iss`, `aud`, `sub` and `client_id` (all
      optional in RFC 7662, all required here).
    - Rules 6 to 11 apply to it.
    - Umbel authenticates to the endpoint with its own client credentials.
    - The response is cached by the token's SHA-256 until the earlier of `exp` and 60 seconds.

**Never passed on.** The verified claims become `credentials`, and the raw token is dropped at the layer. No
command, plugin, mount, journal entry, log line, task record, usage event or error message receives it. `Debug`
prints `[redacted]`.

**stdio and the CLI** are unaffected (MCP: stdio "SHOULD NOT" follow it).

### 3.3 Trait shapes (D106, D109)

Interfaces in `afd::server::auth` (step 0b) and `afd::server` (step 0d). They are the shapes the steps implement.

```text
trait TokenVerifier: Send + Sync
    async fn verify(&self, token: &str, request: &http::request::Parts) -> Result<Credentials, AuthRefusal>

trait KeySource: Send + Sync                           // the host fetches; AFD opens no socket
    async fn key(&self, issuer: &str, kid: &str) -> Result<Jwk, KeyError>

trait ScopeResolver: Send + Sync                       // host override of static `scopes`
    fn resolve(&self, command: &str, input: &Value, credentials: &Credentials) -> ScopeDecision
    fn visible(&self, command: &str, credentials: &Credentials) -> bool        // tools/list and afd-discover
enum ScopeDecision { Allowed, Missing(Vec<String>), Defer }                     // Defer: the registry answers

struct ProtectedResource { resource, authorization_servers, scopes_supported, resource_name?,
                           tls_client_certificate_bound_access_tokens }
struct BearerLayer { verifier, metadata, resolver: Option<Arc<dyn ScopeResolver>>, filter_tools_by_scope }

trait HumanRelay: Send + Sync                          // host-verified confirmations and approvals
    async fn begin(&self, call: &RelayCall) -> Result<RelayPrompt, CommandError>     // { url, message, state }
    async fn resume(&self, state: &str, call: &RelayCall) -> RelayOutcome
enum RelayOutcome { Approved { decision_id }, Declined, Pending(RelayPrompt), Invalid }
struct RelayCall { command, input_digest, actor, credentials: Option<Credentials>, client_capabilities }

trait TaskStore: Send + Sync
    async fn create(&self, record: TaskRecord) -> Result<(), TaskStoreError>       // durable before returning
    async fn get(&self, id: &str, owner: &TaskOwner) -> Result<Option<TaskRecord>, TaskStoreError>
    async fn update(&self, id: &str, owner: &TaskOwner, change: TaskChange) -> Result<(), TaskStoreError>
    async fn expire(&self, now: i64) -> Result<u64, TaskStoreError>
```

**How the bearer layer uses the resolver.** The layer parses a single `tools/call` body (it already caps the body),
including the command an `afd-call`, `afd-batch` or `afd-pipe` names, and asks `resolve` for each command:
- `Missing(scopes)` is HTTP 403 with `WWW-Authenticate: Bearer error="insufficient_scope", scope="<all missing>",
  resource_metadata="<url>"`, before any MCP handling;
- `Defer` lets the call through, so the registry answers. This is how an unreadable space stays indistinguishable
  (5.4).

A batch with any missing step is one 403 naming every missing scope. `tools/list` and `afd-discover` use `visible`,
since the context hook does not run on `tools/list` (`context_hook.rs:52-54`), with `cacheScope: "private"`.

**Umbel's implementations:**
- `KeySource` (`src/auth/keys.rs`), with `reqwest`. It fetches the configured issuer's metadata from
  `/.well-known/oauth-authorization-server` with path insertion first, then `/.well-known/openid-configuration` with
  path insertion, then appended (RFC 8414 3.1 and 5, the order MCP gives clients). The document's `issuer` must
  equal the configured one. It takes `jwks_uri` from the document and follows no redirects, over HTTPS only, with
  1 MiB and 10-second caps. It caches between 5 minutes and 24 hours, refetches at most once a minute per issuer on
  an unknown `kid`, and keeps the last good keys until their cache ends, then fails closed.
- `ScopeResolver` (5.2), `HumanRelay` (7.3), `TaskStore` (12.2), `ApprovalNonceStore` (10.2).

**Protected-resource metadata (D109)** is served without authentication at
`/.well-known/oauth-protected-resource<http.path>` and at `/.well-known/oauth-protected-resource`:

```json
{
  "resource": "https://umbel.example.com/mcp",
  "authorization_servers": ["https://idp.example.com", "https://as.example.com"],
  "scopes_supported": ["umbel:read"],
  "bearer_methods_supported": ["header"],
  "resource_name": "Umbel (example)",
  "tls_client_certificate_bound_access_tokens": false
}
```

- `resource` is `http.public_url` (RFC 9728 3.3).
- `authorization_servers` lists every issuer that issues tokens (not a login-only issuer), in configuration order.
- `scopes_supported` is minimal; the rest arrives by step-up.
- Nothing else is published, and mode `gateway` publishes none.

### 3.4 Enterprise-managed authorization (D108, D121)

The extension's resource-server obligation is to accept tokens "audience-restricted to the MCP Server" issued by the
resource authorization server that the metadata names. 3.2 does exactly that, so inbound needs no path of its own.
The access token's `sub` is the resource authorization server's, while a person logs in at the enterprise identity
provider. So the two meet only through a namespace in which the deployer declares both issuers' subject claims
comparable (4.1, owner decision 1).

`umbel-testkit-idp` runs the whole exchange (ID token, RFC 8693 ID-JAG, RFC 7523 grant), and the exit test uses it
for a user who also completes a person decision (14, point 5). Outbound stays D43 (owner decision 12).

## 4. Who the caller is

### 4.1 Identity namespaces and mapping (D110, owner decision 1)

**Owner decision 1:**
- **A person** is `human:<ns>/<subject>`, where `<subject>` is the issuer's `subject_claim` (default `sub`).
- **The client** is `agent:<ns>/<client_id>`, acting for `<ns>/<subject>`.
- **A service** is `service:<ns>/<client_id>` with no `onBehalfOf`. A token is a service token when any of these
  holds:
  - `sub == client_id` (RFC 9068's suggestion for client credentials);
  - `client_id` is in the issuer's `services.clients`;
  - the token has `services.claim` with its exact value (for example an `idtyp` of `app`).

  A token matching none is a person token. The doctor warns (`auth.services`) when an issuer sets neither list nor
  claim, since some identity providers mark app-only tokens only by a claim.
- **Comparable subjects.** A namespace's issuers must produce comparable subjects. `subject_claim` must name a
  claim that is **not pairwise** (OIDC Core 8). For an issuer with OIDC discovery, the doctor (`auth.subjects`)
  fails unless `subject_types_supported` contains `public`, or `subject_claim` is not `sub`. Two issuers in one
  namespace (an identity provider and an enterprise-managed resource authorization server) are the deployer's
  assertion that their subject claims name the same people. Umbel cannot verify that assertion, and the doctor
  prints it.
- **Long or unusual ids.** A subject or client id over 120 characters, or starting with `~`, becomes
  `~<52 lowercase base32 of its SHA-256>`. No literal id can produce that form. The full value stays in
  `credentials`.
- **No mutable claims.** `email`, `preferred_username` and other mutable claims never become an id.

### 4.2 The context hook, version 1

| Transport | Mode | `actor` | `authentication` |
| --- | --- | --- | --- |
| stdio | any | as version 0 | `process` |
| Streamable HTTP | `none` | `agent:loopback` (D32) | `none` |
| Streamable HTTP | `oauth` | 4.1, from `Credentials` in the request extensions | `verified` |
| Streamable HTTP | `gateway` | 4.4, from the verified assertion in the extensions | `gateway` |
| CLI | any | `human:<local_id>` | `process` |
| Library | any | the embedder's | `embedder` |

The hook fails closed: an HTTP request in `oauth` or `gateway` without verified extensions (a layer missing) is
`UNAUTHORIZED`. Nothing is read from a header the caller controls.

### 4.3 Delegation (D111, owner decision 2)

**Owner decision 2:**
- An agent's reader filter is its person's, **narrowed by its token**: a space the token grants no verb in is
  answered as unreadable (5.4).
- `delegationChain` records the client, or the RFC 8693 `act` chain when the issuer is configured
  `delegation = "act"`. Each entry is mapped as a client is in 4.1.
- An `act` from an issuer not so configured is ignored and logged.

### 4.4 Gateway-trusted mode (D114, owner decision 5)

**Owner decision 5:** a gateway is trusted only to say who authenticated. Every request needs both of these:

1. **A pinned, authenticated channel.**
   - `client_auth = "ca"`: the certificate chains to `client_ca`, and its SHA-256 is in `client_cert_sha256`.
   - Or a loopback bind, with the gateway on the same host.
2. **A per-request assertion** in `Umbel-Gateway-Assertion`, a compact JWS with these properties:
   - `typ: umbel-gw+jwt`, signed by a key in the pinned `keys` file, with rules 3 to 5 of 3.2 applied;
   - `iss` equal to `[auth.gateway].issuer`, and `aud` equal to `http.public_url`;
   - `iat` within `max_assertion_age_s`, and `exp` at most 60 seconds after it;
   - `jti` of at least 128 bits, consumed once in the shared nonce store;
   - `htm` equal to the method, and `htu` equal to `http.public_url` exactly;
   - `sub`, `client` and `scope`.

Mapping and scopes:
- The assertion maps as 4.1 in `[auth.gateway].namespace`, with `authentication = "gateway"`.
- **The scope ceiling is a meet in the scope order** (5.1). A granted scope is kept when some ceiling scope implies
  it. A ceiling scope is kept when some granted scope implies it. So `umbel:write` asserted under a ceiling of
  `umbel:write:alpha` yields `umbel:write:alpha`.
- `humanPresent`, `acr` and `auth_time` in an assertion are ignored.
- A gateway user is proven only on the namespace's person page, and only when the namespace has one (7.2).

**Refusals.** A failure is 401 with `WWW-Authenticate: Umbel-Gateway realm="umbel"` and the body
`{"error":"UNAUTHORIZED","suggestion":"The gateway must connect with its pinned certificate and send a valid
Umbel-Gateway-Assertion."}`. No identity header (`X-User` and the like) is ever read.

### 4.5 Groups from token claims (D113, owner decision 4)

**Owner decision 4:**
- `[access.groups.<g>] claim = { issuer, name, value }` adds members: callers whose token from that issuer carries
  claim `name` (a string or an array of strings) containing exactly `value`.
- They are unioned with static `members`, never taken from a gateway, and last no longer than the token.
- **This makes the identity provider a source of membership.** `umbel.toml` still names which groups read which
  space, but who is in a group is then partly the identity provider's. It is a narrower version of question 3's
  alternative (c), which the owner did not choose; decision 4 accepted it knowing so.

### 4.6 One person, one principal (D129, owner decision 16)

The identity split is real. Self-approval (D102) compares principal strings, so `human:ada` at the CLI and
`human:corp/U019488227` over HTTP would be two people: one person could approve their own draft. The split would also
orphan memory ownership, `readers`, approvers and cursors.

**Owner decision 16:**
- **The join is mandatory in hosted modes.** `principal.local_id` must be `<ns>/<subject>` of a declared namespace,
  so the operator at the CLI is the same principal as their hosted identity, and the CLI's person decisions
  (7.2) take their namespace and subject from it.
- **Legacy principals map one way.** Records written before the move (owned by `human:ada`, `agent:ada` or
  `agent:loopback`) map through `[principal.equivalents]`, legacy to namespaced. Every principal comparison
  consults it:
  - memory ownership and `MEMORY_NOT_OWNED`, and forget and confirm;
  - D102's self-approval, and approvers;
  - `readers` and group members, and `principal:` access tokens in a reader filter (the filter gains the legacy
    token);
  - cursor files.

  Nothing is rewritten. Sealed memory binds its owner as associated data (D82), so rewriting would mean re-sealing.
- The doctor's `auth.principals` fails, in hosted modes, on a `readers`, approver or group entry that no namespace
  or equivalent can produce, since such an entry grants no one.

### 4.7 Who is an operator (D130, owner decision 17)

**Owner decision 17:** only the CLI (transport `cli`, authentication `process`) is an operator. Library
calls are treated by their actor, so an embedder that serves several people through `Host::context`
(`host/mod.rs:579-585`) gets the same sealed positions, readable totals and own-only usage as HTTP callers.

stdio is not an operator, but it keeps version 0 cursor strings, because it is `process` (9.3). `workspace-show`'s
`exact` list is then truthful: `["library", "http"]` in hosted modes.

## 5. Scopes

### 5.1 The grammar

A scope is `<prefix>:<verb>`, or `<prefix>:<verb>:<space>`. The verbs are `read`, `write`, `approve` and `erase`.

**The order:**
- `<verb>` implies `<verb>:<s>` for every `s`.
- Every verb on `s` implies `read:<s>`.
- `write` does not imply `approve` or `erase`.

Parsing is exact (no wildcards, case-sensitive). Scopes under other prefixes are ignored.

### 5.2 What a call needs (D112, owner decision 3)

**Owner decision 3:** Umbel's `ScopeResolver` derives needs from what the host knows. **A call needs the
union of every row that applies.**

| Applies when | Adds |
| --- | --- |
| Any command with a space (the `space` or `spaces` input, else the default) | `read:<s>` for each space |
| Any mutating effect (`plugin-state`, `store-write`, `workspace-write`, `external`) | `write:<s>` |
| `confirm = "require-human"` or an approval policy | `approve:<s>` |
| `memory-erase` | `erase:<s>` |
| A space-less `external` command (a mount without `bind_space`) | unqualified `write` |
| A space-less host built-in (`workspace-show`, `space-list`, `auth-show`, `usage-list`), meta-tools, `afd-context-*` | any Umbel scope |
| `afd-call`, `afd-batch`, `afd-pipe`, a pipeline | every step's needs |

So `knowledge-approve` in `alpha` needs `write:alpha` and `approve:alpha`.

Missing scopes are an HTTP 403 decided before dispatch (3.3). The host's **scope gate** middleware repeats the
check inside the registry (`src/auth/scope_gate.rs`) for in-process and stdio-bridged calls, as defence in depth,
answering `INSUFFICIENT_SCOPE`.

### 5.3 Scopes and access

The reader filter is built from three things:
- the effective principal, its equivalents (4.6), and its static and claim groups;
- only within the spaces the token's scopes grant a verb in;
- for operators and the library, unnarrowed.

A scope never makes an unreadable space readable.

### 5.4 One answer for an absent or unreadable space

For non-operators:
- **Undeclared and unreadable spaces answer alike.** `SPACE_NOT_READABLE`, with one message and one suggestion
  ("The space does not exist or you may not read it"). The space check (`middleware.rs:147-198`) maps
  `SPACE_NOT_FOUND` to it, so an unreadable space and a missing one are indistinguishable.
- **Readability comes before scope.** A space the effective principal cannot read (by `readers`), or that the
  token grants no verb in, answers `SPACE_NOT_READABLE`, and the resolver returns `Defer` for it.
- `INSUFFICIENT_SCOPE` is answered **only for a space the person can read and the token grants some verb in**, so
  its naming of the space tells the caller nothing it could not already learn.
- **Narrowing reaches host built-ins.** `reader_filter(config, space, principal)` becomes
  `reader_filter(config, space, &Caller)`, where `Caller` carries the principal, the equivalents and the granted
  spaces. `event-list` (`event_list.rs:74-79`) and every other caller pass it, so the token narrows host
  built-ins as it narrows plugins.

Operators keep `SPACE_NOT_FOUND`. `first-party/tests/hosted_leaks.rs` holds both cases: an undeclared and an
unreadable space give byte-identical answers, over the 403 path and over the registry path.

## 6. The hosted profile (D107)

### 6.1 Doctor checks

`profile` stays the scale switch (principle 13), and stays `team`. The hosted profile is the doctor's `auth.*`
checks, which apply whenever `auth.mode` is not `none`.

| Check | Fails (or warns) when |
| --- | --- |
| `auth.mode` | `oauth` with no issuer; `gateway` without `[auth.gateway]` |
| `auth.public_url` | Not HTTPS; host not in `allowed_hosts`; path differs from `http.path` |
| `auth.tls` | A non-loopback bind without `[http.tls]`, including a bind meant for a proxy on another host, which must therefore speak TLS to Umbel; a key readable by group or other; a certificate expired (fail) or within 14 days (warn) |
| `auth.issuers` | Metadata unreachable or with a different `issuer` |
| `auth.subjects` | A `sub` subject claim at an issuer whose `subject_types_supported` lacks `public` (4.1) |
| `auth.services` | An issuer with neither `services.clients` nor `services.claim` (warn) |
| `auth.principals` | `local_id` not namespaced; a `readers`, approver or member entry no namespace or equivalent can produce (4.6) |
| `auth.person` | **Fails** (owner decision 6) when a namespace's person login has empty `acr_values` or `uv_amr`; when the provider publishes `acr_values_supported` without a configured class; or when it publishes `claims_supported` without `acr` or `amr`. While it fails, that namespace's `verified` commands are not served. Warns when an area with `approve_over_mcp`, or a command with `person.mcp`, has callers in a namespace with no person login; those commands are then not served to them (7.1) |
| `auth.secrets` | A `*_env` variable unset |
| `auth.shared` | `state/shared/` not writable, or not on a local filesystem (D29) |
| `auth.confirmations` | `mcp.confirmations = "enforce"` (fail). **Why:** under `enforce` the caller's own `confirm: true` proceeds, and under `require-human` an accepted form answer proceeds (`confirmations.rs:268-294`). Neither proves a person, so person-gated commands use the host-verified mode (3.1), and `mcp.confirmations` governs only ordinary `confirm_prompt` commands |

`workspace-show`'s `access` becomes:
- `{ "principals": "verified", "exact": ["library", "http"], "statistics": "per-filter" }` in hosted modes;
- phase 2's value in `none`.

### 6.2 Topology

Phase 5 hosts one machine: any number of processes behind one URL, on one workspace on a local filesystem (D29),
sharing `state/`. Several machines are phase 6, and the shared-state traits (10.2) allow a networked backend.

**TLS.**
- TLS is in process for a non-loopback bind: rustls through `tokio-rustls`, TLS 1.2 and 1.3, with the cipher suites
  of rustls' default `aws-lc-rs` provider.
- A TLS-terminating proxy forwards to a loopback bind on the same host.
- A proxy on another host reaches a non-loopback bind, which requires TLS (`auth.tls`).
- Bound tokens need in-process TLS (2.2).

`/health` answers `{"status":"ok"}` without authentication in hosted modes, and stays behind the token in `none`
(D32).

### 6.3 Layers on the HTTP surface, outermost first

1. TLS, with the client certificate per `client_auth`.
2. The body size limit (`max_body_bytes`).
3. **The per-IP limit** (`ip_requests_per_minute`), before any verification work.
4. **Public routes:**
   - the metadata routes and `/health`;
   - the **person page routes**, mounted beside the MCP path, never behind the bearer layer. They have their own
     host check against `http.public_url`'s host, their own origin check for posts, and their own limit; they
     authenticate by their own login (7.2).
5. **The bearer layer** (`oauth`, with the resolver's 403), the gateway layer (`gateway`), or phase 0's token layer
   (`none`).
6. **The per-token limit** (`calls_per_minute`), keyed on the verified issuer, subject and client.
7. AFD's host and origin checks, then the MCP service. Inside it run the context hook (4.2), the event stamp, the
   space check, the access check (5.4), the scope gate, the read limit (11), the plugin gate, the approval
   middleware and the journal.

`tests/auth_layers.rs` holds two things:
- removing any **authenticating** layer (5, or the hook's check) makes requests fail closed;
- each limit layer is present in its place (3 before 5, 6 after it) and refuses past its limit.

## 7. Proving a person

### 7.1 Assurance levels (D115, owner decision 6)

**Owner decision 6:** two levels, recorded on everything a person decides.

| Level | How | Where |
| --- | --- | --- |
| `terminal` | The CLI's check (D71, D86), unchanged and still not an attestation | `person.cli = "terminal"` commands at the operator's CLI |
| `verified` | The person page (7.2): a fresh login at the namespace's identity provider **with user verification**, the subject matched to the caller, one decision bound to the call | `person.mcp = "verified"` commands over MCP, and `person.cli = "verified"` commands at the CLI, which print the URL and wait |

**Rules:**
- A command with `person.mcp` is served over MCP **only in a hosted mode, and only for callers whose namespace has
  a valid person login** (one passing `auth.person`). Elsewhere it is not listed and is refused as an unexposed
  command, so mode `none` behaves as phases 2 to 4.
- **User verification is mandatory** (owner decision 6). Every person login requests an `acr` class that requires
  user verification, and every ID token it returns must prove it (7.2, step 3).
- A `person.cli = "verified"` command at the CLI needs a namespaced `local_id` and that namespace's login, else
  `PERSON_VERIFICATION_UNAVAILABLE`.
- No other path gives a person:
  - a token's `sub` is who authorised the client once;
  - a form answer is the client's;
  - a gateway may not assert one.

### 7.2 The person page (D115)

Umbel is an OIDC relying party here: a confidential client using authorization code, PKCE `S256`, `state`, `nonce`
and `response_mode=query` (so `SameSite=Lax` holds on the return). It is not an authorization server.

1. **Begin.** `HumanRelay::begin` (over MCP) or the CLI writes a person decision (`person-decision.v1.json`) to
   `state/shared/person.sqlite3`:
   - `id`: 128 random bits;
   - `for`: `{ actor, clientId, issuer, namespace, subject }`, from `credentials` over MCP, or from `local_id` at
     the CLI;
   - `command`, the canonical input digest, and **only the preview's declared properties** (ids, by 2.3's rule, so
     never text);
   - `expires`: 10 minutes; `status = pending`.

   The URL is `https://<public host><path>/d/<id>`. It holds no identity and is not pre-authenticated.
2. **Open.** `GET /d/<id>` makes a login row:
   - a random `login` id, with the **PKCE verifier and the `nonce` kept server-side in that row**;
   - a redirect to the namespace's identity provider (its OIDC discovery, `issuer` checked) with `prompt=login`,
     `max_age`, `acr_values`, a `claims` request marking `acr` essential with those values (OIDC Core 5.5.1.1),
     `response_mode=query` and `state`.

   `state` is `<login id>.<HMAC-SHA256 under state/keys/person.key>`. That key is 32 bytes, race-safe and shared
   by every process, so any process can finish the login. A `__Host-` cookie (`Secure`, `HttpOnly`,
   `SameSite=Lax`) holds a random browser value whose hash is in the row.
3. **Return.**
   - `state`'s MAC and the cookie must match the login row.
   - RFC 9207 `iss` is checked when the provider advertises it.
   - The code is exchanged with the stored verifier.
   - The ID token is verified: signature, `iss`, `aud` = `client_id`, the stored `nonce`, `exp`, and `auth_time`
     within `max_age_s`.
   - **User verification** (owner decision 6): `acr` must be one of `acr_values`, **and** `amr` must contain at least
     one `uv_amr` method. An ID token without both is refused with `PERSON_VERIFICATION_INSUFFICIENT`, and nothing
     is recorded. The check runs on every login, because no metadata can prove what a class means.
   - **Its `subject_claim` must equal `for.subject`, in the same namespace**; otherwise "This request is for another
     person", and nothing is recorded.
4. **Decide.** The page renders **at page time**:
   - the command's `confirm_preview`, called with the stored properties under the logged-in person's reader filter
     (D97's sanitising and caps);
   - who asked: the actor, the client and the delegation chain;
   - the space.

   Nothing of the preview is stored but its SHA-256. The page has two buttons in a form with a CSRF token
   (HMAC of the decision and login ids under `person.key`). Its headers are
   `Content-Security-Policy: default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'`,
   `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer`, and no content script. The decision stores the
   level, `authTime`, `acr` and the preview hash.
5. **Resume.** On the retry, `HumanRelay::resume` (or the CLI's poll) checks these, then spends the decision once in
   the nonce store and runs the call with `humanPresent` set:
   - the decision is decided and unexpired;
   - **every field of `for` equals the retrying caller's** actor, client, issuer, namespace and subject;
   - the input digest matches.
   - The plugin gate's `require-human` check (`middleware.rs:262-264`) accepts it for a `verified` surface, and
     accepts only the CLI mark for a `terminal` one.
   - One decision covers the command's `require-human` gate and its approval policy (3.1's relay evidence).

**Outcomes and limits:**
- Declining is `CONFIRMATION_DECLINED` (or `APPROVAL_REQUIRED`, `details.reason: "declined"`), not retryable.
- An expired decision is `PERSON_DECISION_EXPIRED` at the CLI; over MCP the relay asks again.
- `person_pages_per_hour` limits begins per principal.
- Each decision is journaled under its command's trace as a host `person-decide` entry, digest-journaled, keeping
  `id`, `level` and `decision`.

### 7.3 The MCP approval relay (D116, owner decision 7; amends D99)

**Owner decision 7:**
- **Approve and reject only.** An area opts in with `approve_over_mcp`, default false.
  - The knowledge manifest (version 5) gives both `person = { cli = "terminal", mcp = "verified" }` and
    `confirmationMode = "host-verified"`.
  - The knowledge plugin refuses the call in an area without the opt-in (`APPROVAL_RELAY_DISABLED`), before
    anything is asked.
  - The CLI path is unchanged.
- **The server never sends a form for them** (3.1).
- **First call.** `HumanRelay::begin` writes the decision and returns `input_required` with one URL-mode
  elicitation: message "Open the link to review proposal `<id>` in `<space>`", and the page URL. Its
  `requestState` is sealed with XChaCha20-Poly1305 under `state/keys/relay.key` (shared) and holds:
  - the decision id;
  - the command and input digest;
  - the actor;
  - `credentials.issuer`, `.subject` and `.clientId` (#532), as associated data.
- **Retry while pending.** URL-mode `accept` means only that the user consented to open the link. A retry while
  the decision is pending answers `input_required` again with the same URL and a fresh `requestState` for the same
  decision, until it is decided or expires.
- **Retry when decided.** The call runs with relay evidence (3.1). A declined decision fails it.
- **What holds unchanged:** approvers must be listed and read the target; self-approval as D62 and D102, through
  4.6's equivalents; approve's re-checks (D102, D103); auto-approval refuses a relay (D98).
- **Proposal record version 3** adds `decision.channel = "mcp-elicitation"` and `decision.assurance = { level,
  method: "person-page", namespace, authTime, acr? }`. A terminal decision records `{ level: "terminal",
  method: "cli-terminal" }`.
- A client without URL elicitation gets `APPROVAL_REQUIRED`, `details.reason = "url-elicitation-required"`.

Approval tokens never travel over MCP.

### 7.4 The preview over MCP

D97's preview is the person page's content, rendered at page time (7.2, step 4). The elicitation `message` carries
only ids, never content.

### 7.5 Why this is not URL mode authorising a user for itself

MCP 2026-07-28 says servers "MUST NOT rely on URL mode elicitation to authorize users for themselves". The text
around it is about access to the server: authorizing an MCP client is MCP Authorization's job.

Here:
- the caller is already authorized by a verified token, and the page grants no access, issues no token and
  creates no session the client can use;
- it confirms **one decision** by the person the token already names, and the login only proves that person is
  present;
- the request is bound to the client and user identity, as the same section requires (`for`, 7.2);
- the identity comes from the deployer's identity provider, as the phishing rule suggests.

The owner accepted this reading with decision 6.

## 8. Person-gated memory, and the questions earlier phases left open

### 8.1 Gated commands over MCP (D117, owner decision 8)

**Owner decision 8:**
- **`memory-confirm`** gains `confirm_preview = "memory-preview"` (an `inspect` command returning the record's
  text under the caller's filter, declaring `id` and `space`, both in its `keep`), and `person = { cli =
  "terminal", mcp = "verified" }`. Own records only (D88 kept).
- **`curator-promote`** stays CLI only at `terminal`, since the curator is not in the request path. It is the
  operator's.
- **`memory-remember`'s `authority_prompt`** stays CLI only.

### 8.2 Confirming another person's record

**Owner decision 8:** D88's refusal stays.

### 8.3 Changing another person's shared record (D119, owner decision 10)

Today a sharing writer who can read a record may invalidate or supersede it (`memory_services.rs:215-253`). A
sharing writer includes agents holding a `writers` token when `agents_may_share = true` (lines 150-162).

**Owner decision 10:**
- Only the record's principal (with equivalents), or **a person** holding a token in a new `editors` list on the
  `memory_write` grant table (default empty), may change another principal's record.
- An editor is a person whatever `agents_may_share` says, and must be `verified` over MCP.
- `MEMORY_NOT_OWNED` otherwise. History keeps every version.

### 8.4 `memory-erase` (D118, owner decision 9)

D85: blind, irreversible, resting on a verified person, and able to reach records a person's CLI cannot forget
(`agent:loopback`, `agent:<local_id>`).

- **Command.** `memory-erase { space, principal, ids?, dryRun, plan? }` in the memory plugin, digest-journaled with
  `keep = ["space", "principal", "dryRun"]`.
  - `confirm = "require-human"`, `person = { cli = "verified", mcp = "verified" }`, `confirmationMode =
    "host-verified"`.
  - It needs the `erase` scope and a preview (`memory-erase-preview`, declaring `space` and `principal`).
- **What is checked:**
  - the caller is verified, and its effective principal (with equivalents) holds a token in the grant table's
    `erasers` list, else `MEMORY_ERASE_NOT_ALLOWED`;
  - `principal` is a valid principal string.
  - **Nothing else.** The eraser's reader filter is not applied: the store's new `erase_targets(space, principal,
    ids?)` selects the target's records by owner, through equivalents, whatever their access set. That is the
    "blind" of D85, which no reader filter could give.
- **Dry run and plan.** `dryRun = true`, required first, returns only a count and a `plan` (the SHA-256 of the
  sorted ids and versions). The erase must present the same `plan`, else `MEMORY_ERASE_PLAN_STALE`.
- **Erasure** is phase 3's forget path (keys first, D73, D82). It returns counts only.
- **Disclosed residue**, as D85 lists. The erased principal also receives an event in their own stream (access
  `principal:<erased>`) naming every eraser who acted, the count and the time.
- **The two-person rule (owner decision 9's strengthening).** The `memory_write` grant table's
  `erase_approvals` is `1` or `2`, default `1`, and `erase_approval_window_s` is 600 to 604 800, default 86 400.
  They sit beside `erasers`, where D74 keeps the memory policy the host reads:

  ```toml
  [plugins.memory.grants.memory_write]
  erasers = ["group:records-admins"]
  erase_approvals = 2
  erase_approval_window_s = 86400
  ```

  - With `2`, the first eraser's erase (after the dry run, with the plan, and a `verified` decision) erases nothing.
    It writes an **erase request** in the memory database's new `erase_requests` table: request id `x-<20 hex>`,
    space, target principal, plan, the first eraser, `at` and `expiresAt`. It answers
    `{ "status": "awaiting-second-eraser", "request", "expiresAt" }`.
  - A **second eraser** runs their own dry run, which must produce the same plan, then
    `memory-erase { space, principal, plan, request }` with their own `verified` decision, inside the window.
  - The second eraser must be a different effective principal from the first, compared through equivalents (4.6),
    else `MEMORY_ERASE_SECOND_ERASER_REQUIRED`.
  - A plan that no longer matches voids the request (`MEMORY_ERASE_PLAN_STALE`), and so does the window passing
    (`MEMORY_ERASE_REQUEST_EXPIRED`).
  - Only when both have approved does the erase run. The journal keeps both erasers, the request id and the plan,
    and the erased principal's notice names both.
  - A request holds no text and no ids, only the plan's hash. It is deleted with `secure_delete` when it runs or
    expires.
  - **The default is `1` only because a deployment with a single administrator could not erase at all otherwise.**
    A deployment with two or more erasers should set `2`, and the doctor's `stores.memory_erase` check warns when
    `erasers` can produce two people and `erase_approvals` is `1`.
- In mode `none` the command is unavailable (no verified person), so local erasure waits for a hosted setup. The
  owner did not choose the terminal level for erase (decision 9).

### 8.5 A draft its proposer can no longer read (D120, owner decision 11; amends D101)

**Owner decision 11:** a host-run, redaction-only sweep. **It amends D101**, which keeps every privileged
read refused, by admitting one narrowly scoped one.

- **Durable trigger.** A forget or an erase writes an `erasure` outbox row (space, erased memory ids, the instances
  to notify) in the memory database, **in the same transaction that destroys the keys**. Each named instance's row
  is marked done only after its sweep commits. A host process drains the outbox at open, after each forget or
  erase, and before any `knowledge-proposal-*` read. The sweep is idempotent (phase 4's redaction is), so a crash
  re-runs it.
- **Ownership.** Records are already namespaced per plugin instance (`store_services.rs`). The sweep is a new
  host-only knowledge command, `knowledge-erasure-sweep`, exposed on no surface. The host calls it with a new
  `CallContext.host_task = Erasure { ids }`, which no caller can set, as the pipeline attestation table is
  host-only (D91).
- **The filter.** Under it the host's `ReaderFilter::OwnNamespace` admits the instance's own `proposal` records,
  and nothing else. The knowledge plugin redacts each non-applied proposal citing an erased id (phase 4 9.1,
  unchanged), and returns counts. The journal keeps the counts only.
- **Trust.** Compiled plugins are trusted code (D42), so the guarantee rests on four things: no surface reaches the
  command, the host alone sets `host_task`, the filter is namespace-bounded, and the result is counts.
  `tests/host_redaction.rs` holds each.

## 9. Exact filtering: statistics and hidden counts (D125)

In hosted modes, hidden counts are closed for every non-operator (4.7). The code is the same in every mode.

### 9.1 Knowledge: statistics per reader filter

`SearchIndex::query` scores through tantivy's `Bm25StatisticsProvider` (`bm25.rs:15`) under the call's reader
filter:
- `doc_freq(term)` counts readable chunks containing the term;
- `total_num_docs` counts readable chunks;
- `total_num_tokens(field)` sums **exact per-chunk token counts**, which the indexer writes in a new `u64` fast
  field per text field (`len_title`, `len_body`, …), never the quantized field norms;
- deleted documents are excluded.

The statistics are cached per (segment set, filter digest). The index schema version rises, so the next
`knowledge-index` rebuilds.

The eval gate re-runs. Its statistics now exclude deleted documents and use exact counts, so it must pass within its
committed tolerance, and **no equality with today is claimed**. `store-embedded/tests/partitioned_stats.rs` holds
that adding unreadable documents changes no byte of a caller's results.

### 9.2 Memory: BM25 per reader filter, in Rust

FTS5's `bm25()` uses whole-table statistics. Recall changes as follows:
- It selects **every** readable match with the boolean query and no rank.
- It opens their bodies (as today), tokenises them with `umbel-store`'s memory tokenizer (the FTS5
  `porter unicode61` rules, re-implemented and tested against FTS5's own tokens on a fixture), and computes BM25
  over the readable matches only.
- It orders by that score, then authority tier, then `recordedAt`, then id, and returns no score (D70).
- More than 50 000 readable matches is `MEMORY_QUERY_TOO_BROAD`: a refusal asking for a narrower query, never a
  silent truncation.

### 9.3 Positions, sequence numbers and totals

**Sealing is deterministic.** A sealed value is XChaCha20-Poly1305 under `state/keys/cursor.key`, with the nonce the
first 24 bytes of HMAC-SHA256 (under a second key derived from it) over the plaintext and its associated data. This
is an SIV construction: equal values seal equal, and other values cannot be told apart. No new dependency is needed.

| Value | Phase 5, for non-operators |
| --- | --- |
| `event-list` cursor | **Cursor version 1** `v1.<base64url>`, sealing `{space, seq}` with the principal as associated data; refused for another principal with `INVALID_CURSOR`, as a malformed one is. `head` is **the position of the last event this caller can read**, sealed |
| Stored cursor files | Unchanged on disk: they hold positions, not strings. No migration |
| Version 0 cursor strings | Accepted from `process` callers (stdio, CLI), so harness consumers keep working. From any other caller, `INVALID_CURSOR` |
| `dev.umbel/index` `{ applied, head }`, `knowledge-changes` revisions, `rev` | The last readable revision at or below each value, sealed as `r1.<base64url>`, compared only for equality, and accepted back by `after` |
| Locator `indexVersion` | **Locator version 2**: `<space>@r1.<token>/<schema>`, the last readable revision at or below the applied one |
| Index-building totals | Readable-only counts |
| `store-show` head | CLI only, as today |

So a caller's positions move only when something it can read changes.

### 9.4 Spaces

`space-list` and `workspace-show` list only the spaces the caller reads and the token grants (5.4). The operator
reads its spaces, as today.

## 10. Host services

### 10.1 Grants

No new plugin grant. `secrets` is the host's own (10.4), and stays refused to plugins. Plugins never see
`credentials`.

### 10.2 Shared state for instances behind one URL (D126)

| State | Where | Rule |
| --- | --- | --- |
| Confirmation and approval keys | `state/keys/` (D29) | Unchanged |
| Cursor, relay and person keys | `state/keys/cursor.key`, `relay.key`, `person.key` | 32 bytes, race-safe, shared |
| Approval nonces, relay evidence, gateway `jti`s, spent decisions | `state/shared/nonces.sqlite3`, WAL, mode 0600 | `consume` is `INSERT … ON CONFLICT DO NOTHING` with `changes() == 1`, atomic across processes; rows expire, and writes purge at most 64 |
| Person decisions and logins | `state/shared/person.sqlite3` | 7.2; `secure_delete=ON`; rows purged 1 hour after expiry |
| Tasks | `state/shared/tasks.sqlite3` | 12.2 |
| Limit counters | `state/shared/limits.sqlite3` | 11 |
| The erasure outbox | Inside `memory.sqlite3` | 8.5 |

Each store is behind a trait in `src/shared/`. A wait past `store.lock_timeout_ms` is `WORKSPACE_SHARED_TIMEOUT`,
retryable, and the request fails closed.

### 10.3 `auth-show`

A host built-in, `inspect`, exposed everywhere. It returns only the caller's own projection: principal, namespace,
issuer, authentication, scopes, spaces with verbs, `delegationChain` and token expiry.

### 10.4 Host secrets

The person-page client secret, introspection credentials and TLS key are read from the named environment variable
or file, never stored in `umbel.toml`, never logged, and redacted from `Debug` output. An HTTP mount's `bearer_env`
follows the same rule (phase 1 follow-up).

### 10.5 Error and warning codes

| Code | When | Retryable | Details |
| --- | --- | --- | --- |
| HTTP 401 `invalid_token` | 3.2's rules, with rule codes in the log only: `unknown-issuer`, `audience`, `expired`, `scopes-too-many`, `dpop-unsupported`, … | No (a new token) | None |
| HTTP 403 `insufficient_scope` | 5.2, before dispatch | No (a new token) | `scope` in the challenge |
| HTTP 429 | 11's IP and token limits | Yes | `Retry-After` |
| `UNAUTHORIZED` | The hook finds no verified extensions (4.2); a gateway refusal (4.4) | No | None |
| `INSUFFICIENT_SCOPE` | The scope gate inside the registry (5.2) | No | `scopes` |
| `SPACE_NOT_READABLE` | 5.4, for undeclared and unreadable spaces alike | No | None |
| `RATE_LIMITED` | 11's read-bytes limit | Yes | `retryAfterMs` |
| `PERSON_VERIFICATION_UNAVAILABLE` | A `verified` command with no namespaced `local_id` or person login (7.1) | No | None |
| `PERSON_DECISION_EXPIRED` | The CLI's decision expired before it was decided (7.2) | Yes | None |
| `PERSON_VERIFICATION_INSUFFICIENT` | The login's ID token lacks a configured `acr` or a user-verification `amr` (7.2) | Yes (log in again with user verification) | None |
| `APPROVAL_RELAY_DISABLED` | Approve or reject over MCP in an area without `approve_over_mcp` (7.3) | No | `area` |
| `APPROVAL_REQUIRED` | Reasons `declined` or `url-elicitation-required` (7.3) | No | `reason` |
| `MEMORY_ERASE_NOT_ALLOWED` | The caller is not an eraser (8.4) | No | None |
| `MEMORY_ERASE_PLAN_STALE` | The records changed since the dry run, or since an erase request (8.4) | No (run the dry run again) | None |
| `MEMORY_ERASE_SECOND_ERASER_REQUIRED` | With `erase_approvals = 2`, the approving eraser is the requesting one (8.4) | No | `request` |
| `MEMORY_ERASE_REQUEST_EXPIRED` | The erase request's window passed (8.4) | No (start again) | `request` |
| `MEMORY_QUERY_TOO_BROAD` | More than 50 000 readable matches (9.2) | No | `limit` |
| `INVALID_CURSOR` (existing) | A version 0 string from a non-`process` caller; another principal's version 1 cursor (9.3) | No | None |
| `TASK_LOST` | The task's process died; its lease expired (12.2) | Yes | None |
| `TASK_TOKEN_EXPIRED` | The starting token expired before the task finished (12.2) | Yes (start again) | None |
| `TASK_SPACE_UNREADABLE` | A batch found the space no longer readable (12.2) | No | None |
| `WORKSPACE_SHARED_TIMEOUT` | A shared store's lock wait passed `store.lock_timeout_ms` (10.2) | Yes | `store` |
| `WORKSPACE_CONFIG_INVALID` (existing) | 2.2's rules | No | `key` |

## 11. Rate limits (D128)

In hosted modes there are four limits. Counters are shared (10.2), and operators are not limited.

| Limit | Keyed on | Where | Over the limit |
| --- | --- | --- | --- |
| `ip_requests_per_minute` | The peer address | Before verification (6.3, layer 3) | HTTP 429 |
| `calls_per_minute` | The verified issuer, subject and client | After verification (layer 6) | HTTP 429 |
| `read_bytes_per_minute` | The effective principal's result bytes | A host middleware, checked before the handler on bytes already used, so a mutation's result is never withheld after it ran | `RATE_LIMITED` |
| `person_pages_per_hour` | The principal | When a person decision begins | Refused at begin |

## 12. Usage, tasks, telemetry

### 12.1 Usage events (D122, owner decision 13)

**Owner decision 13:** one content-free record per MCP HTTP request, in `state/usage/<yyyy-mm>.jsonl`,
under its own lock, mode 0600.

```json
{ "version": 1, "id": "u-…", "at": "2026-11-03T10:00:00.000Z", "trace": "…",
  "principal": "human:corp/U019488227", "actor": "agent:corp/f53f191f9311af35", "namespace": "corp",
  "transport": "http", "method": "tools/call", "tool": "knowledge-search", "command": "knowledge-search",
  "space": "main", "outcome": "ok", "bytesIn": 212, "bytesOut": 4810, "durationMs": 31, "task": null }
```

- **What counts.** Every request: `tools/call`, `tools/list`, `tasks/get`, `tasks/update` and `tasks/cancel`
  (`method` says which, with `command` and `task` set for task methods), and refused requests (`outcome` is the
  code or HTTP status).
- **What is never recorded:** inputs, results, queries, document ids or memory text.
- **Bytes, not tokens.** The host has no tokenizer and does not guess.
- **Reading it.** `usage-list` shows a caller their own records, everyone's to `usage.readers` (default none), and
  everything to the operator.
- **Not telemetry.** AFD telemetry keeps the actor kind only.

### 12.2 Tasks for long jobs (D127)

`task = "optional"` commands run as a task when the request declares `io.modelcontextprotocol/tasks`; `required`
gives `-32021` without it. The first are `sources-sync`, `knowledge-index` and `knowledge-refresh`, whose results
are counts and ids, never content.

**The task record** (`task-record.v1.json`):
- `id`: 128 random bits, base32;
- `owner`: `{ effectivePrincipal, actor, issuer, clientId }`;
- `command`, `space`, `status`, `createdAt`, `lastUpdatedAt`;
- `ttlMs`, default 3 600 000 and never past the starting token's `exp`; `pollIntervalMs`;
- `statusMessage`: a phase name only;
- `lease`: `{ process, until }`;
- `result` or `error`.

**Rules:**
- **Durable first.** The record exists before `CreateTaskResult`.
- **Owner checked.** Every `tasks/*` call compares the caller with `owner`, and a mismatch answers as an unknown
  id.
- **No content.** A result carrying `dev.umbel/trust: "content"` fails the task. Manifest version 5 refuses `task`
  on read commands (2.3), so no content is retained.
- **Revocation reaches a task.** It stops with `TASK_TOKEN_EXPIRED` at its starting token's `exp`, so a task
  never outlives the authorization that started it (3.2's lifetime cap). Before each batch it rebuilds the reader
  filter from the current configuration and the stored scopes, and stops with `TASK_SPACE_UNREADABLE` when the
  space is no longer readable.
- **Lost tasks.** A dead process (lease not renewed for 10 seconds) means `TASK_LOST`.
- **Cancel** is cooperative, between batches.
- **Purge.** Results are purged at TTL with `secure_delete`.

**Guarantees kept:**
- Digest, confirm, approval and CLI-only commands are never tasks.
- A forget never leaves memory text in a task.
- The curator is never reached.

### 12.3 Not in the request path

`first-party/tests/hosted_not_request_path.rs` repeats phase 4's point 7 over the hosted surface, with a token
holding every scope.

### 12.4 Telemetry and OpenTelemetry export (D124, owner decision 15)

**Owner decision 15:** no OpenTelemetry export, and no Rust telemetry middleware, in phase 5. While W12's
conventions have no tagged release, their attribute names may still change. Consumers who key dashboards, alerts or
audit queries on them would then silently read wrong or missing data. The journal and usage events keep the record
meanwhile.

## 13. Security

### 13.1 What earlier phases decided, and how it holds

| Guarantee | How phase 5 keeps it |
| --- | --- |
| **Forget** (D73, D82, D103) | Digest and read commands cannot be tasks. Usage holds no content. Person decisions store ids and a preview hash, never text, and the preview renders from the live store at page time. Nonce, limit and task stores hold no text. Erase uses forget's path, and the erasure sweep reaches more drafts |
| **Access filtering** (D53, D68) | A boundary in hosted modes. Scopes only narrow. Readability comes before scope. Statistics and positions are per filter. Library callers are treated by their actor (4.7). Equivalents never widen: they map a legacy string to the one person it was |
| **Host-owned authority** (D71, D86) | `person` and `humanPresent` come only from the CLI's check or a host-verified decision. No token claim, gateway or form answer sets them |
| **Attestation and verification** (D91) | Unchanged; `host_task` is a second host-only mark, like the pipeline table |
| **Not in the request path** | No model; the curator is CLI only and never a task |

### 13.2 Threats

| Threat | Control | Test |
| --- | --- | --- |
| A token for another resource | Exactly one audience (3.2, rule 7) | AFD `auth_verifier.rs`; `auth_tokens.rs` |
| Algorithm or key confusion | Allow-list; `none` and HMAC refused; JWK bound to the header; `crit`, `jku`, `x5u`, `x5c` and `jwk` refused | `auth_verifier.rs` |
| Library defaults weaker than the rules | Every check explicit, one test per rule | `auth_verifier.rs` |
| An opaque token sent to the wrong issuer | One introspection issuer; JWS routed by `iss` only | `auth_tokens.rs` |
| A token in a URL or log | Refused in the query; dropped at the layer; canary never in logs, journal, usage or tasks | `auth_tokens.rs`, `token_canary.rs` |
| Passthrough to mounts | No token on the context (D43) | `plugin_mounted.rs` (extended) |
| A stolen bearer token | Lifetime cap; optional mTLS binding; limits | `auth_tokens.rs`, `limits.rs` |
| A forged identity header, or a missing layer | No header read; the hook fails closed | `auth_layers.rs` |
| A compromised gateway | Pinned `ca` channel plus a signed, single-use, URL-bound assertion; a scope ceiling; no person | `gateway_mode.rs` |
| Identity split: self-approval or orphaned records | Mandatory join; equivalents everywhere (4.6) | `principal_v1.rs`, `knowledge/tests/relay.rs` |
| Pairwise or mismatched subjects | Namespaces, a subject claim, `auth.subjects` | `principal_v1.rs`, `doctor_auth.rs` |
| Space existence oracle | One answer; readability before scope (5.4) | `hosted_leaks.rs` |
| Scope escalation through batch or pipe | Every step resolved before dispatch | `scope_gate.rs` |
| Confirmation replay across actors (#532) | Actor and credentials bound | AFD `server_confirmations.rs`; `confirm_binding.rs` |
| An agent answering for a person | Host-verified mode: no form, no `confirm: true`; a URL login bound to `for` | `person_page.rs`, `relay.rs` |
| **Browser automation with saved credentials** passing `prompt=login` | **Closed under owner decision 6's condition:** every login must show a configured `acr` and a user-verification `amr` (a PIN or biometric at the authenticator), which stored credentials and a scripted browser cannot produce; `auth.person` fails without the configuration, and its commands are not served. Not defended, and stated: an attacker who controls the person's authenticator itself, which no remote check can detect | `doctor_auth.rs`, `person_page.rs` |
| A single eraser erasing alone where two are available | `erase_approvals = 2`; the doctor's `stores.memory_erase` warning (owner decision 9) | `memory/tests/erase.rs` |
| Clickjacking the decision | `frame-ancestors 'none'`, `X-Frame-Options: DENY` | `person_page.rs` |
| Phishing (another person opens the link) | `for.subject` and namespace matched | `person_page.rs` |
| CSRF, login CSRF, fixation | Server-side PKCE and `nonce`; a MAC on `state`; a `__Host-` cookie; a CSRF token; `response_mode=query` | `person_page.rs` |
| Decision or evidence replay across instances | Shared atomic nonce store | `shared_nonces.rs` |
| SSRF through issuer metadata | Only configured issuers; HTTPS; no redirects; caps | `auth_keys.rs` |
| JWKS refresh used to deny service | One refetch per minute per issuer; the IP limit first | `auth_keys.rs`, `limits.rs` |
| Hidden counts | Per-filter statistics, readable positions, deterministic seals | `partitioned_stats.rs`, `cursor_v1.rs`, `hosted_leaks.rs` |
| A task outliving its token, or keeping content | Stops at `exp`; readability re-checked; no content results | `tasks.rs` |
| Guessed task id | 128 bits; owner check | `tasks.rs` |
| Usage as surveillance | Content-free; own records unless `usage.readers` | `usage.rs` |
| Self-serving erasure | Verified eraser, plan, a notice to the erased | `memory/tests/erase.rs` |
| A privileged sweep misused | Host-only command and mark; namespace-bounded; counts only | `host_redaction.rs` |
| DNS rebinding | Host and origin checks; the person page's own host check | `protocol_http.rs`, `person_page.rs` |
| Plain HTTP across a network | Non-loopback needs TLS | `config_v5.rs` |

Content trust stays D67's: previews are sanitised, labelled content, never put into an elicitation `message`.

## 14. Exit criterion and tests

The exit criterion is met when `umbel.yml` is green on `main` with every test below and
`first-party/tests/exit_hosted.rs` passes in it.

**Setup:**
- `umbel-testkit-idp` on 127.0.0.1 with a test CA, playing three roles:
  - identity provider `idp`: OIDC with public subjects, a scripted login for synthetic users `ada`, `bo` and `cy`
    with test-only passwords, an `acr` class, and `groups` claims;
  - resource authorization server `as`: RFC 8414 metadata, a JWKS, authorization code with PKCE, RFC 7523
    grants from ID-JAGs, introspection and client credentials;
  - a gateway signer.
- **Two** `umbel-first-party serve --http` processes, bound to 127.0.0.1 with `[http.tls]` and `auth.mode =
  "oauth"`, on one workspace, behind `first-party/tests/support/balancer.rs` (TCP round-robin).
- One namespace `idp` holding both issuers, with the person login at `idp`, `acr_values` and `uv_amr` set (the
  fixture's scripted login reports `amr: ["hwk", "pin"]`), and `local_id = "idp/ada"`.
- Spaces `alpha` and `beta`. Documents readable by `principal:human:idp/ada`, by `principal:human:idp/bo`, by
  `group:eng` (claim-derived for ada and cy), and by `space`.

It asserts:

1. **Discovery.** No token: 401 with `resource_metadata`. Both RFC 9728 URIs serve the same document.
2. **Results filtered for their users** (the exit criterion).
   - ada and bo (authorization code at `as`) and cy (enterprise-managed: ID token at `idp`, ID-JAG, access token
     at `as`) each call `knowledge-search` and `knowledge-open` and see exactly their sets.
   - **bo's answers are byte-identical, scores and sealed positions included, before and after ada's hidden
     documents are written and indexed in the same workspace.**
   - No hidden id, count or title appears.
3. **Token rules.** Another resource, two audiences, expired, no `iat`, no `jti`, `HS256` with the public key,
   `alg: none`, unknown issuer, a `crit` header, a token in the query: each is 401, and nothing runs.
4. **Scopes and spaces.**
   - `umbel:read:alpha` alone: a mutation in `alpha` is a 403 naming `umbel:write:alpha`.
   - A call in `beta`, which ada can read, is `SPACE_NOT_READABLE`, byte-identical to a call in an undeclared space.
   - A mixed `afd-batch` is one 403 naming every missing scope.
   - `tools/list` is filtered.
5. **Approval over MCP.**
   - bo's agent proposes in an `approve_over_mcp` area.
   - ada's client calls `knowledge-approve`, receives a **URL-mode** elicitation and no form, and retries while
     pending, getting `input_required` again.
   - The scripted browser logs in as ada with the `acr` and user verification, sees the preview, and approves. A
     login without user verification (`amr: ["pwd"]`) is refused.
   - The retry, through the other process, applies the proposal (version 3, `mcp-elicitation`, `verified`).
   - **cy, the enterprise-managed user, completes a `memory-confirm` decision the same way**, matched across `as`
     and `idp` in one namespace.
   - Each of these is refused: replaying the retry; a form answer; `confirm: true`; bo opening ada's link; ada's
     decision retried by another client of hers; ada's token without the page; ada's confirmation `requestState`
     presented by bo.
   - At the CLI, `idp/ada` approves at a terminal (`terminal` assurance), and self-approval is detected for a draft
     of `human:ada`'s legacy memory, through `principal.equivalents`.
6. **Tasks.**
   - `knowledge-refresh` as a task, polled through the balancer, completes.
   - bo's `tasks/get` of ada's task answers as unknown.
   - Killing the running process gives `TASK_LOST`.
   - A task whose token expires gives `TASK_TOKEN_EXPIRED`.
7. **Usage.** Each call and poll has one usage event, and bo's `usage-list` shows only his.
8. **Gateway mode.** A second workspace in `gateway` mode, with a pinned certificate.
   - Accepted: a valid assertion, with results filtered as in point 2.
   - Refused: no certificate; no assertion; a replayed `jti`; a wrong `htu`; an `X-User` header.
   - An assertion claiming presence gives no person.
9. **Forget still holds.** Ada's memory record is confirmed through the person page, then forgotten over MCP. Its
   canaries are absent from `person.sqlite3`, the task store, usage, `nonces.sqlite3` and every file of the
   workspace.
10. **Unchanged locally.** stdio and the CLI pass phase 4's exit tests unchanged. A stored version 0 cursor still
    works for a stdio consumer.

| Test file | Crate | Covers |
| --- | --- | --- |
| `tests/server_auth.rs`, `tests/auth_verifier.rs` | `afd` | 3.2 rule by rule; metadata; the resolver's 403 and list filtering; no token on the context |
| `tests/server_confirmations.rs` (extended) | `afd` | #532; the host-verified mode never sends a form, never accepts `confirm: true` |
| `tests/server_human_relay.rs` | `afd` | Begin, pending, approved, declined; relay evidence accepted once by the approval middleware, tokens still off |
| `tests/server_tasks.rs` | `afd` | Negotiation, `-32021`, durability, owner checks |
| `tests/schemas.rs` (extended) | host | Section 2; version 0 shapes still read |
| `tests/config_v5.rs`, `tests/manifest_v5.rs` | host | 2.2, 2.3 (`person` per surface, MCP exposure only with `mcp`, the preview `keep` rule) |
| `tests/auth_layers.rs`, `tests/auth_tokens.rs`, `tests/token_canary.rs`, `tests/auth_keys.rs` | host | 6.3; 3.2 and 3.3 through the host |
| `tests/principal_v1.rs` | host | 4.1 (namespaces, subject claims, services, the `~` form), `act` from an `act` issuer kept and from a non-`act` issuer ignored, groups from claims, 4.6's equivalents |
| `tests/doctor_auth.rs` | host | Every `auth.*` check of 6.1; `auth.person` fails on empty `acr_values` or `uv_amr`, on an unsupported class, and on `claims_supported` without `acr` or `amr`, and while it fails the namespace's `verified` commands are neither listed nor callable |
| `tests/auth_show.rs` | host | 10.3: own projection only |
| `tests/scope_gate.rs`, `tests/space_visibility.rs` | host | 5.2 to 5.4, built-ins included |
| `tests/gateway_mode.rs` | host | 4.4, the meet included |
| `tests/person_page.rs` | host | 7.2: every rule, binding to every field of `for` (a different client of the same person refused), headers, the preview rendered at page time and not stored; an ID token with no `acr`, an unlisted `acr`, no `amr`, or only `pwd` and `otp` in `amr`, each refused with `PERSON_VERIFICATION_INSUFFICIENT` |
| `tests/confirm_binding.rs` | host | #532 through Umbel |
| `tests/shared_nonces.rs`, `tests/tasks.rs`, `tests/limits.rs`, `tests/usage.rs` | host | 10.2, 12.2, 11, 12.1, with two processes where shared |
| `tests/cursor_v1.rs` | host | 9.3: readable heads, deterministic equality, version 0 for `process` |
| `tests/host_redaction.rs` | host | 8.5: outbox durability across a crash, host-only reach, counts only |
| `tests/no_auth_server.rs` | host | Section 1 |
| `store-embedded/tests/partitioned_stats.rs` | embedded | 9.1 and 9.2 differentials; exact counts; `MEMORY_QUERY_TOO_BROAD` |
| `store/tests/memory_tokenizer.rs` | store | 9.2's tokenizer against FTS5's tokens |
| `plugins/knowledge/tests/relay.rs` | knowledge | 7.3; proposal version 3; self-approval through equivalents |
| `plugins/knowledge/tests/eval_gate.rs` (existing) | knowledge | Passes within tolerance under 9.1 |
| `plugins/memory/tests/erase.rs`, `editors.rs`, `confirm_preview.rs` | memory | 8.4, with `erase_approvals = 2`: one eraser alone erases nothing; the same eraser twice, or an equivalent principal, refused; a changed plan and an expired window void the request; two erasers erase, and the journal and notice name both. 8.3, 8.1 |
| `first-party/tests/hosted_leaks.rs` | first-party | Differential probes over HTTP for every read command, the space oracle both ways |
| `first-party/tests/hosted_not_request_path.rs` | first-party | 12.3 |
| `first-party/tests/exit_hosted.rs` | first-party | The exit criterion |

**CI.** `umbel.yml` gains a `hosted` job (Linux; no external service or credential) and `scripts/affected/suites.mjs`
its local entry. AFD's step 0 tests run in `rust.yml` and the language workflows.

## 15. Out of scope, and the seams reserved

| Out of scope | When | Seam |
| --- | --- | --- |
| Several machines behind one URL | Phase 6 | `src/shared/` traits |
| DPoP, workload identity | When SEP-1932 and SEP-1933 are final (D19) | `dpop` reserved; `cnf.jkt` refused |
| Umbel as an authorization server | Never (A7) | `no_auth_server.rs` |
| Outbound per-caller credentials | The federation specification with O1 (owner decision 12) | D43 unchanged |
| OpenTelemetry export | After W12's first tagged release (owner decision 15) | Journal and usage |
| Multi-tenant deployments | Never in one deployment (owner decision 14; O5 closed) | `tenant` reserved |
| Plugin `secrets` and `http` grants | The first plugin that needs them | Named and refused (D42) |
| CORS for browser clients | Loam's U1 | `allowed_origins` |
| Server cards, registry entry | Phase 7 | Metadata is the only public document |
| Documents as MCP resources (`kb://`) | After this phase | URI scheme reserved |

## 16. Implementation plan

Each step is one pull request, green on the repository's checks and `umbel.yml`, and updates STATUS.md and this file.
A step that finds a design decision stops and amends this document. Steps changing host code carry the
`Plugin-isolation-exempt:` line. Steps 6, 10 and 11 follow owner decisions 7 to 11.

| Step | Pull request | Contents | Tests | Size |
| --- | --- | --- | --- | --- |
| 0a | AFD spec | `spec/command-metadata.md` (`scopes` with the resolver, `task`, `confirmationMode: "host-verified"`, relay evidence), `spec/error-codes.md`, a new `spec/authorization.md` (`credentials`, the HTTP behaviour, 403 through the resolver, test vectors), #532's binding; the MCP Authorization and Tasks proposals made active. **Done 2026-11-07**; the choices it made are in [Amendments from step 0a](#amendments-from-step-0a) | Spec vectors (`spec/authorization.json`) | M |
| 0b | AFD Rust auth | `server-auth`: `TokenVerifier`, `JwtVerifier`, `KeySource`, `ScopeResolver`, `ProtectedResource`, `BearerLayer`, `credentials`, `scopes`. **Done 2026-11-07**; the choices it made are in [Amendments from step 0b](#amendments-from-step-0b) | `server_auth.rs`, `auth_verifier.rs` (and `authorization_cases.rs`, `auth_canary.rs`, `command_scopes.rs`) | L |
| 0c | AFD #532 | Actor and credentials in confirmation state in TypeScript, Python and Rust; **needs 0b**. **Done 2026-11-07**; the choices it made are in [Amendments from step 0c](#amendments-from-step-0c) | Each language's confirmation suite (`server_confirmations.rs`; `confirmations.test.ts`, `approval-relay.test.ts`, `principal-binding.test.ts`; `test_confirmations.py`, `test_principal_binding.py`) | M |
| 0d | AFD Rust relay | The host-verified mode in the gate; `HumanRelay`; relay evidence in the approval middleware; the form-mode relay; parity row. **Done 2026-11-07**; the choices it made are in [Amendments from step 0d](#amendments-from-step-0d) | `server_confirmations.rs`, `server_human_relay.rs` (and the middleware's unit tests, `authorization_cases.rs`) | L |
| 0e | AFD Rust tasks | `TaskStore`, the `tasks/*` handlers, `task`. **Done 2026-11-07**; the choices it made are in [Amendments from step 0e](#amendments-from-step-0e) | `server_tasks.rs` (and the unit tests of `src/server/tasks/runtime.rs` and `src/cancellation.rs`, `error_codes.rs`) | L |
| 1 | Umbel shapes | Section 2's schemas and examples; configuration and manifest version 5 parsing with their rules; constants. **Done 2026-11-07**; the choices it made are in [Amendments from step 1](#amendments-from-step-1) | `schemas.rs` (with `schemas/phase5.rs` and `schemas/phase5_records.rs`), `config_v5.rs`, `manifest_v5.rs` | M |
| 1b | Test identity provider | `umbel-testkit-idp`: identity provider, authorization server, ID-JAG, introspection, gateway signer, test CA. **Done 2026-11-07**, with `tests/no_auth_server.rs` (section 1); the choices it made are in [Amendments from step 1b](#amendments-from-step-1b) | Its own suite (`access_tokens.rs`, `discovery.rs`, `identity_provider.rs`, `authorization_server.rs`, `enterprise.rs`, `gateway.rs`) and `no_auth_server.rs` | M |
| 2a | Host: listener and layers | TLS and `client_auth`; 6.3's order; metadata; the IP limit; the context hook version 1 skeleton. **Done 2026-11-08**; the choices it made are in [Amendments from step 2a](#amendments-from-step-2a) | `auth_layers.rs`, `no_auth_server.rs` (and the unit tests of `src/shared/limits.rs` and `src/surfaces/http/layers.rs`) | M |
| 2b | Host: verification and principal | `KeySource`; the verifier wiring, with the introspection issuer (moved from 2c); namespaces, mapping, services, `act`, claim groups; 4.6's join and equivalents. **Done 2026-11-08**; the choices it made are in [Amendments from step 2b](#amendments-from-step-2b) | `auth_tokens.rs`, `token_canary.rs`, `auth_keys.rs`, `principal_v1.rs` (and the unit tests of `src/auth/` and `src/access.rs`) | L |
| 2c | Host: doctor | 6.1's checks; `auth-show`; `workspace-show`; each issuer's `ca_file` (a settled follow-up). **Done 2026-11-08**; the choices it made are in [Amendments from step 2c](#amendments-from-step-2c) | `doctor_auth.rs`, `auth_show.rs` (and the `ca_file` cases of `auth_keys.rs`, `config_v5.rs` and `schemas/phase5.rs`, the unit tests of `src/auth/doctor.rs` and `src/auth/files.rs`) | M |
| 3 | Host: scopes, access, shared state, limits | The resolver and scope gate; 5.4 (one answer, `Caller` in `reader_filter`); `src/shared/`; the nonce store in approvals; limits; `http.trusted_proxies` (step 2a's settled follow-up) and the plugin listings (step 2c's). **Done 2026-11-08**; the choices it made are in [Amendments from step 3](#amendments-from-step-3) | `scope_gate.rs`, `space_visibility.rs`, `shared_nonces.rs`, `limits.rs`, `confirm_binding.rs` (and `trusted_proxies.rs`, the unit tests of `src/auth/scopes.rs`, `caller.rs`, `src/access.rs`, `src/shared/nonces.rs`, `limits.rs` and `src/surfaces/http/listener.rs`) | L |
| 4 | Host: gateway mode | 4.4. **Done 2026-11-08**; the choices it made are in [Amendments from step 4](#amendments-from-step-4) | `gateway_mode.rs` (and the gateway router of `no_auth_server.rs`, the gateway cases of `doctor_auth.rs`, `config_v5.rs` and `auth_layers.rs`, the unit tests of `src/auth/gateway.rs`, `src/surfaces/http/gateway.rs` and `src/principal.rs`) | M |
| 5 | Host: person page | 7.1, 7.2, 7.5; manifest `person`; `HumanRelay`; the CLI's URL flow; envelope version 3's `assurance` | `person_page.rs` | L |
| 6 | Knowledge: relay | `approve_over_mcp`; proposal version 3 | `relay.rs` | M |
| 7 | Stores: exact filtering | 9.1 to 9.3; the memory tokenizer; cursor version 1, locator version 2; eval re-run. **Done 2026-11-08**, with the follow-ups of steps 1, 2b, 2c and 3 it owned and mode `oauth` served by a shipped build; the choices it made are in [Amendments from step 7](#amendments-from-step-7) | `partitioned_stats.rs`, `memory_tokenizer.rs`, `cursor_v1.rs`, `eval_gate.rs` (and the unit tests of `store-embedded/src/index/stats.rs`, `memory/rank.rs`, `store/src/memory/tokenizer.rs` and `src/positions.rs`, the conformance `access` and `memory_recall` groups, `auth_show.rs`, `auth_layers.rs`, `first-party/tests/exact_filtering.rs`) | L |
| 8 | Tasks | 12.2 | `tasks.rs` | M |
| 9 | Usage | 12.1 | `usage.rs` | M |
| 10 | Memory | 8.1, 8.3, 8.4 | `erase.rs`, `editors.rs`, `confirm_preview.rs` | M |
| 11 | Erasure sweep | 8.5 | `host_redaction.rs` | M |
| 12 | Exit | The balancer, `hosted_leaks.rs`, `hosted_not_request_path.rs`, `exit_hosted.rs`; the `hosted` job and its `suites.mjs` entry; STATUS.md marks phase 5 done | The three | L |

**Order:**
- 0a first. 0b, 0d and 0e need 0a; 0c needs 0b.
- 1 needs 0a. 1b needs nothing and may run beside 0a.
- 2a needs 0b, 1 and 1b. 2b needs 2a. 2c needs 2b.
- 3 needs 2b. 4 needs 3. 5 needs 3, 0c and 0d. 6 needs 5.
- 7 needs 1 and may run beside 2a to 6.
- 8 needs 0e and 3. 9 and 11 need 3. 10 needs 5.
- 12 needs all.

**Build cost.** Two dependency families: `jsonwebtoken` with `aws-lc-rs` (already in the lock, a C build) and
`rcgen` (dev). Share `CARGO_TARGET_DIR`, use `-p <crate>` and `-j4`, and build only under load 20.

## 17. For the owner

### Owner decisions, 2026-11-04

**The owner answered all seventeen questions on 2026-11-04.** They are final and written into the sections they
govern; do not ask again. Approval is under the owner's 2026-10-31 delegation, with these answers (D24).

The owner chose the recommended option on questions 1 to 4. For question 5 onward the owner said: *"I am not an
expert on these so I am fine going with your recommendations but lets make sure we are making good choices, not
cutting corners, investing in the best outcomes, and being secure."* So every question takes its recommendation,
and two are strengthened under that instruction: **user verification is mandatory** (decision 6), and **a
configurable two-person rule** applies to `memory-erase` (decision 9).

Each entry keeps the question as it was asked, the decision, and the alternatives not chosen.

1. **Who a verified caller is** (D110; 4.1). *Decided by the owner, 2026-11-04:*
   - People are `human:<namespace>/<subject>`, from a configured, non-pairwise subject claim.
   - Clients are `agent:<namespace>/<client_id>`, acting for them.
   - Services are `service:<namespace>/<client_id>`, recognised by `sub == client_id`, a listed client, or a
     configured claim.
   - Two issuers in one namespace are the deployer's assertion that their subjects name the same people.

   *Alternatives not chosen:* (a) a mutable claim such as `email` as the id, so a reassigned address inherits
   records; (b) an explicit table from issuer and subject to principal, refusing unmapped subjects; (c) one issuer per
   namespace, so enterprise-managed users could never be proven on the person page.
2. **What an agent reads for its person** (D111; 4.3). *Decided by the owner, 2026-11-04:* the person's filter
   narrowed to the token's granted spaces; the `act` chain recorded from an issuer configured for it. *Alternatives
   not chosen:* (a) the person's whole filter, with scopes gating commands only; (b) agents never read their person's
   private records without a new `umbel:private` scope.
3. **Scope mapping, including per-space scopes** (D112; 5). *Decided by the owner, 2026-11-04:* the verbs `read`,
   `write`, `approve` and `erase`, optionally narrowed to a space, resolved per call, with a call needing the union of
   what applies. Scopes only narrow access, and readability is checked before scope. *Alternatives not chosen:* (a)
   unqualified verbs only; (b) per-command scopes declared in manifests; (c) scopes that also grant space access.
4. **Groups from token claims** (D113; 4.5). *Decided by the owner, 2026-11-04:* a group may take members from one
   issuer's claim with an exact value, unioned with static members and lasting no longer than the token. This makes
   the identity provider a source of membership, while `umbel.toml` still says which group reads which space.
   *Alternatives not chosen:* (a) static `members` only; (b) claims replace static members.
5. **What a gateway is trusted for** (D114; 4.4). *Decided by the owner, 2026-11-04:* identity only, through a
   CA-validated, pinned channel (or loopback) and a signed, single-use, URL-bound assertion; scopes cut to a ceiling
   by the scope order; never a person. *Alternatives not chosen:* (a) identity headers from a network-restricted peer;
   (b) a pinned channel with plain headers; (c) no gateway mode.
6. **How a person is proven** (D115; 7, 7.5). *Decided by the owner, 2026-11-04, with a strengthening:*
   - Two levels. `terminal` is the operator's CLI, unchanged. `verified` is the person page: URL-mode elicitation or
     a CLI-printed URL, a fresh login at the namespace's identity provider (`prompt=login`, `max_age`), every field of
     `for` matched, and one decision bound to the call.
   - The owner accepted 7.5's reading of the MCP rule against using URL mode "to authorize users for themselves".
   - **Strengthening: user verification is mandatory.** Every person login must request an `acr` class requiring
     user verification, and each ID token must show that class and a user-verification `amr` (7.2). An empty
     `acr_values`, or a login without user verification, is no longer a warning: `auth.person` fails, and the
     namespace's `verified` commands are not served until it is fixed (2.2, 6.1).
   - With that, the browser-automation threat is closed except against an attacker who controls the person's
     authenticator (13.2).

   *Alternatives not chosen:* (a) the token's `sub` as the person, with form answers; (b) RFC 9470 step-up claims with
   form answers; (c) WebAuthn user verification held by Umbel per decision; and, for the strengthening, (d) a doctor
   warning only on empty `acr_values`, as the review-time text had.
7. **The MCP approval relay** (D116, amends D99; 7.3). *Decided by the owner, 2026-11-04:* approve and reject only,
   opted in per area, in AFD's host-verified mode so no form is ever sent, through the person page only, recorded as
   `mcp-elicitation` with the assurance. *Alternatives not chosen:* (a) AFD's form-mode relay; (b) form answers with
   step-up claims.
8. **Other person-gated commands** (D117; 8.1, 8.2). *Decided by the owner, 2026-11-04:* `memory-confirm` over MCP at
   `verified` with a text preview, own records only (D88 kept). `curator-promote` and `memory-remember`'s prompt stay
   CLI only at `terminal`. *Alternatives not chosen:* (a) all stay CLI only; (b) a verified person may confirm
   another's record.
9. **`memory-erase`** (D118; 8.4). *Decided by the owner, 2026-11-04, with a strengthening:*
   - Blind as D85 says: the target's records by owner, never the eraser's filter.
   - A `verified` eraser in `erasers`, a dry-run plan the erase must match, and counts only.
   - A notice in the erased principal's stream.
   - Unavailable in mode `none`.
   - **Strengthening: a configurable two-person rule.** `erase_approvals` is `1` or `2`. With `2`, a second
     verified eraser, other than the first, approves the same plan within `erase_approval_window_s` before anything
     is erased. Both are recorded, and the notice names both.
   - **The default is `1` only because a deployment with a single administrator could not erase otherwise.**

   *Alternatives not chosen:* (a) a two-person rule always, which a single-administrator deployment could never
   satisfy; (b) the operator's `terminal` level suffices.
10. **Changing another person's shared record** (D119; 8.3). *Decided by the owner, 2026-11-04:* only the record's
    principal, or a person in a new `editors` list, verified over MCP, whatever `agents_may_share` says. This answers
    phase 3's sharing-writer follow-up. *Alternatives not chosen:* (a) today's rule; (b) only the record's principal.
11. **A draft its proposer can no longer read** (D120; 8.5), **amending D101.** *Decided by the owner, 2026-11-04:* a
    host-run, redaction-only sweep with a durable trigger in the forget's transaction, a host-only command and mark,
    and a filter bounded to the instance's own proposals, returning counts. This answers phase 4 step 3b's amendment
    12 limit. *Alternatives not chosen:* (a) accept the limit, keeping D101 whole; (b) let the knowledge plugin read
    its own records unfiltered whenever it holds `memory`.
12. **Credentials toward mounted servers, and enterprise-managed authorization on connections** (D121; 3.4).
    *Decided by the owner, 2026-11-04:* inbound accepted with no special path; outbound stays D43; per-caller exchange
    for mounts is decided with O1. *Alternatives not chosen:* (a) per-caller RFC 8693 or ID-JAG exchange for HTTP
    mounts now; (b) URL-mode third-party authorization per user.
13. **Usage events** (D122; 12.1). *Decided by the owner, 2026-11-04:* a content-free stream counting every request;
    callers see their own, `usage.readers` and the operator all. *Alternatives not chosen:* (a) usage in each space's
    stream; (b) operator only.
14. **Tenancy, O5** (D123; 6.4). *Decided by the owner, 2026-11-04:* single-tenant per deployment; **O5 is closed**.
    *Alternatives not chosen:* (a) a tenant per namespace; (b) leave O5 open.
15. **Telemetry export** (D124; 12.4). *Decided by the owner, 2026-11-04:* none in phase 5, because consumers keying
    on the unstable GenAI attribute names would silently read wrong or missing data when they change. *Alternative not
    chosen:* export now against the development conventions.
16. **Joining a person's local and hosted identity, and migration** (D129; 4.6). *Decided by the owner, 2026-11-04:*
    in hosted modes `local_id` must be a namespaced id, and legacy principals map one way through
    `principal.equivalents`, which every principal comparison consults; nothing is rewritten. *Alternatives not
    chosen:* (a) rewrite ownership with a migration command, re-sealing memory; (b) no join.
17. **Who is an operator** (D130; 4.7). *Decided by the owner, 2026-11-04:* only the CLI; library calls are treated
    by their actor. *Alternatives not chosen:* (a) the CLI and the library; (b) the CLI and stdio.

### Decisions made here that do not change the trust model

These were decided with the specification's approval on 2026-11-04, under the owner's 2026-10-31 delegation:
- D106: AFD step 0, with the resolver, the host-verified mode and relay evidence.
- D107: auth modes, TLS, the hosted profile and the layer order.
- D108: token rules.
- D109: metadata.
- D125: exact filtering, with deterministic sealing.
- D126: shared state.
- D127: tasks without content, bounded by the token.
- D128: rate limits.

## Amendments from step 0a

Step 0a wrote [`spec/authorization.md`](../../../../../spec/authorization.md), its cases in
[`spec/authorization.json`](../../../../../spec/authorization.json), and the `scopes`, `confirmationMode`,
`task`, #532, host-verified, relay-evidence and Tasks sections of
[`spec/command-metadata.md`](../../../../../spec/command-metadata.md). It kept every rule of sections 3.1
to 3.3, 5.2 to 5.4, 7.3 and 12.2 and settled what they left open. These change what 0b to 0e build; the
AFD spec is binding where it and this document differ. None changes the trust model.

| Section | Was | Now | Why |
| --- | --- | --- | --- |
| 3.1, 3.3: where the 403 applies | "Any non-streamed `tools/call`" | A request whose JSON-RPC answer is the body of its own HTTP response: `tools/call` on Streamable HTTP, and AFD's `/rpc`, `/batch` and `/stream`. Anything else (the deprecated `/message` lane, a body the layer cannot parse) is decided again after routing, after the context hook and before the confirmation gate, as `INSUFFICIENT_SCOPE` with `details.scopes` (M6) | Makes "non-streamed" exact; no lane reaches a handler or a person with a missing scope |
| 3.3: which commands a request names | The command, and the commands `afd-call`, `afd-batch` and `afd-pipe` name | Also: a grouped action is resolved as the router would (unresolvable is `Defer`); a tool naming no command (`afd-discover`, `afd-detail`, `afd-help`, the context tools) is resolved under its own name; `input` is the arguments as sent, before validation | 5.2's "meta-tools need any Umbel scope" needs a name to resolve |
| 3.1: host-verified and the server option | Unstated | The mode applies **whatever `confirmations` says, `off` included** | Under `off` a person-gated command would otherwise run with no person; 6.1's `auth.confirmations` already reads `mcp.confirmations` as governing ordinary commands only |
| 3.1: what the relay can confirm | Unstated | Only a call routed to one command (its tool, first-class, grouped, `afd-call`) on an MCP 2026-07-28 request. A step of `afd-batch` or `afd-pipe`, a 2025-era request and the AFD HTTP routes get `CONFIRMATION_REQUIRED` | One decision binds one call, and `input_required` exists only on 2026-07-28; the same limit the form-mode approval relay has |
| 3.1: the input the person decides on | "The canonical input digest" | The server validates the input before `begin`; `inputDigest` is the unpadded base64url SHA-256 of the canonical JSON of the **validated** input, for `RelayCall` and relay evidence alike | The gate runs before validation and binds input as sent, while the approval middleware holds validated input: with any default applied, the digests would differ and every relayed approval would be refused. A person is also never asked about input that fails |
| 3.1, 7.3: the URL elicitation | `input_required` with the relay's prompt | Input key `relay`; `elicitationId` the unpadded base64url SHA-256 of the URL, so a pending decision keeps one id; the relay's `state` is the `requestState`. `decline` or `cancel` is `CONFIRMATION_DECLINED` without calling the relay; `accept` is never an answer, only a reason to call `resume`; `Invalid` begins again. Never sent to a client that did not declare URL mode: such a prompt becomes `CONFIRMATION_REQUIRED` | MCP requires `elicitationId` in URL mode (rmcp 3.8.0 `model.rs:3931-3937`) and forbids modes the client did not declare |
| 3.1: relay evidence and the nonce store | "The decision id is consumed once in its nonce store" | The middleware consumes `relay:<decisionId>`, kept 24 hours; a relay decision lives at most 24 hours. When present, relay evidence is the only evidence. Checked in order: command, input, actor, then credentials, each refusal with its `details.reason` (new: `credentials-mismatch`) | 7.2 step 5 has the relay spend the decision once in the same shared store: consuming the same key twice would refuse every relayed approval |
| 3.1: #532's binding | Actor and `credentials.issuer`, `.subject`, `.clientId` in the confirmation state | The same, defined once as the **principal binding** (canonical JSON of the actor's `kind`, `id`, `onBehalfOf` and the credentials' identity, M8), with cases; it also binds the form-mode approval relay's state, task owners and relay evidence | TypeScript carries confirmation and approval answers in one state; one definition keeps the four uses equal |
| 3.2: rule details | Rules 1 to 12 | A closed list of rule codes (M5). `typ` compared ignoring ASCII case (a media type, RFC 7515 4.1.9). The JWK's `crv` must fit `alg` (`ES256` and `P-256`, `EdDSA` and `Ed25519` or `Ed448`). `nbf`, `auth_time` and `acr` type-checked when present. Time as `now < exp + skew`, `iat ≤ now + skew`, `nbf ≤ now + skew`. The `scope` claim parsed strictly (`scope-malformed`), with the 64 counted under an optional prefix. A key source or introspection endpoint that cannot answer is a 401 (`unavailable`): fail closed. Credentials hold whole seconds, rounded down | Each needed one exact answer for the cases |
| 3.2, 3.3: challenge forms | The two header forms | Exact strings: the 401's `error="invalid_token"` comes last, the 403 keeps its order; `scope=` is left out of a 401 when nothing is published; no `error_description`. A 403 body `{"error":"INSUFFICIENT_SCOPE","suggestion":…}` beside the 401's | Byte-equal cases across languages |
| 3.3: metadata | The document | `scopes_supported` left out when empty; a resource with an empty path has one URL | RFC 9728 3.1 |
| 3.2: credentials | `Debug` prints `[redacted]` for the token | Credentials' own debug form prints `[redacted]` for every field but `issuer` and `expiresAt`; without a host mapping the server sets the actor `{ kind: "agent", id: clientId, onBehalfOf: subject }` (the proposal's default) | Subjects and client ids are identifiers that logs should not hold |
| 12.2: Tasks in AFD | `task`, `TaskStore`, the handlers, a principal check | Registration refuses `task` beside `confirmPrompt`, an approval policy or `confirmationMode`, so no AFD task is ever `input_required`. Only single-command calls become tasks; an `afd-batch` or `afd-pipe` step naming a `required` command fails the whole request (`INVALID_BATCH_REQUEST`, `INVALID_PIPELINE_REQUEST`). The owner is the principal binding; a foreign, expired or unknown id gets one answer. A task stops at `credentials.expiresAt` with **`TASK_TOKEN_EXPIRED`, now an AFD code**. A failed `CommandResult` is `completed` with `isError`, as the extension says | Manifest version 5 already refuses these for Umbel (2.3); AFD now refuses them for every host. The token bound belongs wherever `credentials` exist, not in Umbel only |
| 10.5: which codes are AFD's | One table | AFD specifies `INSUFFICIENT_SCOPE` and `TASK_TOKEN_EXPIRED` ([`spec/error-codes.md`](../../../../../spec/error-codes.md#specified-not-yet-in-the-catalog)), each joining the catalog with its four constants in the step that first emits it (0b, 0e). The rest stay Umbel's | The catalog's rule: a code joins when it is implemented |
| 16, 0a: where the cases live | "Spec vectors" | `spec/authorization.json`, beside `spec/vectors/`, listed in its README | `alfred parity` fails on a file in `vectors/` that some language does not load, and C++ has no HTTP server |

In Rust the server option's enum is already `ConfirmationMode` (`Off`, `Enforce`, `RequireHuman`); step 0d
gives the per-command setting a name that does not collide with it.

## Amendments from step 0b

Step 0b implemented `spec/authorization.md` M1 to M7 in `packages/rust` (`server-auth`). It kept every
rule of sections 3.1 to 3.3 and of the AFD spec, took the stricter reading where they left a choice,
and wrote the cross-language ones back into `spec/authorization.md` (none changes a case of
`authorization.json`). None changes the trust model; each makes a refusal more likely, never less.
An independent security review of the step found nine problems, fixed in the same branch; the rows
marked "(review)" record them.

| Section | Was | Now | Why |
| --- | --- | --- | --- |
| 3.2: how `jsonwebtoken` is used | "`JwtVerifier` sets `validate_nbf = true`, `leeway = clock_skew_s` and an algorithm list per key" | `jsonwebtoken` 11.1 checks the **signature only**, through its `aws-lc-rs` provider called directly (`crypto::aws_lc::DEFAULT_PROVIDER`, not the process default). AFD never calls `decode` and never builds a `Validation`, so no setting or default of the library applies; routing, the header, the key and every claim rule are AFD's own code | M3: "no library default is relied on". `Validation` reads times as integers (the `fractional times` case would fail), and the process-wide provider can be replaced by any crate in the process |
| 3.2, 3.3: algorithms | An issuer's `algorithms` | `SigningAlgorithm`: `RS256`, `RS384`, `RS512`, `PS256`, `PS384`, `PS512`, `ES256`, `ES384`, `EdDSA` (Ed25519), the set the backend verifies. `ES512` cannot be configured, so it is refused as `alg`; an Ed448 key fits rule 3 but is refused as `key` (unusable material) | Configuration cannot name an algorithm that would always fail at the signature |
| 3.2 rules 2 and 3: parsing | Unstated | A JWS whose payload is not one JSON object with unique member names is `unknown-issuer` (rule 1 cannot route it); such a header is `typ`. The key's own `kid` must equal the header's; key material that is not strict base64url or has a coordinate of the wrong length is `key` | RFC 7515 4 and 7519 4 let a reader refuse repeated names; reading the last one is a parser differential between verifiers |
| 3.2 rule 11: `cnf` | `x5t#S256` checked, `jkt` refused | Also: a `cnf` that is not an object, or holds any other confirmation method (`jwk`, `jku`, ...), is `binding`; an empty `cnf` is unbound | A proof-of-possession token AFD cannot check must not be accepted as a bearer token |
| 3.2 rule 11: the certificate | "The TLS client certificate's SHA-256" | The host's TLS layer inserts `ClientCertificate::from_der(der)` into the request's extensions; AFD computes the unpadded base64url SHA-256 itself | The host never hands AFD a thumbprint it encoded |
| 3.2 rule 12: introspection | Rules 6 to 11 apply | AFD's `check_introspection` applies M3's rules 5 to 10, so `jti` is required in an introspection answer too; an answer that is not an object is `inactive`. `JwtVerifier::with_introspection` sends every non-JWS token to the host's introspection verifier and never a JWS | "Rules 5 to 10 then apply to the response", read literally. Umbel step 2c's verifier calls `check_introspection` |
| 3.2: the log | "The issuer alias and a rule code" | Each `JwtIssuer` has a required alias (1 to 64 visible ASCII). The rule code is logged at `warn`, target `afd::auth`, as `rule` and `issuer` (`-` before an issuer is known, such as `no-token`); never the `iss` as sent | The `iss` is a claim value and attacker-chosen before routing |
| 3.2: the token | "The raw token is dropped at the layer" | The bearer layer also removes the `Authorization` header before the MCP service, so the context hook cannot read it; `ContextHookRequest::header("authorization")` is `None` | M2: "the token never goes further than the verifier" |
| 3.3: the configuration | `BearerLayer { verifier, metadata, resolver, filter_tools_by_scope }` | `Authorization::new(ProtectedResource, impl TokenVerifier)` with `with_required_scopes`, `with_resolver`, `with_filter_tools_by_scope` and `with_max_body_bytes` (1 MiB) goes on `McpServer::with_authorization`; **`McpServer::authorized_http_service(HttpOptions)` builds the Streamable HTTP service and its `BearerLayer` from the same server**, the documented path (`bearer_layer()` remains for hosts composing their own stack). `Authorization::new` refuses a `JwtVerifier` whose resource or bound-token rule differs from the metadata's. The resource and every authorization server must be absolute `https` URLs without user information, query or fragment | One configuration for the layer and the checks after routing; mismatched metadata would point clients at a token the server refuses |
| 3.3: `KeySource` | `key(issuer, kid) -> Result<Jwk, KeyError>` | As given, with `KeyError::{Unknown, Unavailable}` (`key` and `unavailable`) and `Jwk` as the key's JSON object, so rule 3 reads the members as published. `StaticKeys` serves a fixed JWKS | The `kid` is unverified: Umbel's `KeySource` keeps its once-a-minute refetch limit (3.3) |
| 3.3, M6: the resolver and `requiredScopes` | The resolver decides "instead of the static rule" | `requiredScopes` apply to every call under a resolver too: missing required scopes come first in `Missing`, and `Defer` never lifts one; `visible` needs them as well | `requiredScopes` are "needed for any request" (the Options table); a resolver that defers must not open the server to callers without them |
| 3.3, M6: an unresolvable grouped call | `Defer` | Decided as a tool that names no command, under the grouped tool's name (static: `requiredScopes`; resolver: asked with that name), then answered by the router | Deferring would let a caller without the required scopes probe group and action names and read `INVALID_GROUPED_CALL`'s action list |
| M6: unexposed commands | Unstated | A named command that is unknown or not exposed to MCP has no `scopes` of its own | A 403 must never name a scope of a command the caller cannot see (D4) |
| M6: listing | `tools/list`, `afd-discover`, `afd-detail`, `afd-help`, grouped actions | Also `afd-docs`, `afd-schema`, and the action list of `INVALID_GROUPED_CALL` and the not-found suggestions | Each describes commands; leaving one out would list what `tools/list` hides |
| M1, M6: answers off `tools/call` | Unstated | Without admitted credentials, `tools/call` is an `UNAUTHORIZED` tool result; `initialize`, `tools/list`, `server/discover`, `resources/*`, the Skills methods and custom requests are JSON-RPC `-32600` with `data.code` `UNAUTHORIZED` (or `INSUFFICIENT_SCOPE` with `data.scopes` for missing required scopes) | A failed list has no `CommandResult` to carry the code |
| M4: the hook and the actor | "A host maps credentials to actor" | The hook sees the credentials and the default actor; the server restores the verified credentials after it, and the credentials' actor also replaces an actor the hook removes and `McpServer::with_actor` on calls that carry credentials | Only the server sets credentials |
| M6: the routes | `tools/call`, `/rpc`, `/batch`, `/stream` before dispatch | Rust has no `/sse`, `/message`, `/rpc`, `/batch` or `/stream`: the layer decides a `tools/call` body and refuses a JSON-RPC batch (an array body) with 400 and `-32600` (MCP has had no batches since 2025-06-18); everything else, and any request a host's own layer admits credentials for (gateway mode, `Authorization::admit`), is decided after routing | Only Streamable HTTP reaches the Rust server |
| M2: the body | "It already caps the body" | The layer reads at most `max_body_bytes` (413 beyond); a form-encoded body is read before the token to apply M2, any other body only after the token is verified | An unauthenticated caller cannot make the layer buffer a JSON body |
| M7: other methods | `GET` | Another method on a metadata path is 405 with `Allow: GET` | |
| M1: fail closed, by admission (review) | An HTTP request "without verified credentials" | The server accepts only credentials **admitted for its own `Authorization`** (`Authorization::admit`, which the bearer layer calls; a per-configuration mark beside the `Credentials` in the request's extensions). Credentials inserted without the mark, or admitted by a layer built from another server's authorization, are `UNAUTHORIZED`, so a layer and service from different servers can no longer serve a request. A host's gateway layer calls `admit` itself | The extensions were a channel any layer could fill; a mismatched layer and service must not be silently trusted |
| M1: other transports (review) | "stdio is unaffected" | A request without an HTTP request is refused with `UNAUTHORIZED` on an authorized server unless the transport is trusted: `serve_stdio` marks its own connection, and a host serving a custom transport through `rmcp`'s `ServiceExt::serve` must call `McpServer::with_trusted_transport()`, documented as trusting the peer as a stdio peer | Fail-closed rested on the HTTP request being present, so any other transport skipped every check |
| M5, M6: a refusal without a name (review) | `Missing(scopes)` | Decisions travel as decisions (`RequestDecision::{Proceed, Forbidden}`, `request_decision`, replacing `forbidden_scopes`): any `Missing` refuses, even an empty one or one naming something that is not a scope token, which is logged at `warn` (no input) and left out. With no scope to name, the 403 leaves `scope=` out rather than send it empty, its suggestion asks for "the scopes this call needs", and `INSUFFICIENT_SCOPE` has `details.scopes: []` | An empty `Missing` used to read as no missing scope and let the call run |
| M6: at execution (review) | The resolver judges the arguments as sent | With a resolver, the registry asks it again for every command it runs with credentials (each batch item, each pipeline step, a nested call that passes its context on) on the **validated** input, defaults applied and pipeline references resolved, before middleware and handler; `Missing` there is `INSUFFICIENT_SCOPE`. The 403 before dispatch stays the early answer. Documented on `ScopeResolver` and in M6 | A rule keyed on an argument could be bypassed by leaving it to a default or drawing it from `$prev` |
| M6: suggestions (review) | "A hidden command looks unknown" on the listings | Also in every "did you mean" suggestion, on every route (a command's tool, grouped, hybrid, `afd-call`, `afd-batch`, `afd-pipe`), and a grouped tool whose every action is hidden answers as a tool that does not exist (`COMMAND_NOT_FOUND`), not `INVALID_GROUPED_CALL` | The suggestions were built from every MCP-exposed command and named hidden ones |
| M6: resources (review) | `resources/*` need `requiredScopes` | Additive: `ResourceProvider::list_for` and `read_for`, default methods given a `ResourceCaller` with the request's credentials, which the server now calls; `list` and `read` are unchanged | Hosts can gate resources per caller without a breaking change |
| 3.2 rule 9 (review) | `exp - iat` at most the maximum | Also at least 0: a token whose `exp` precedes its `iat` is `lifetime` | A token that expires before it was issued is malformed, not short-lived |
| M4: debug output (review) | Credentials redacted | `CommandContext`'s `Debug` also prints the actor's `id` and `onBehalfOf` as `[redacted]`, since the default actor carries the client id and the subject | The redaction held for `Credentials` but not for the actor derived from them |
| Follow-ups: OAuth 2.1 | "Re-read the resource-server sections at step 0b" | Re-read draft 17 (2026-10-31) section 5 on 2026-11-07: clients must not send a token in the query, form bodies are allowed only under conditions and never with `GET`, the resource server must check expiry, audience and scope, and `invalid_request` is suggested as 400. M2's refusals of the query and form body, and its single 401 shape, stay as written: stricter, and decided in step 0a | Closes the follow-up |

## Amendments from step 0c

Step 0c bound confirmation `requestState` to the principal binding (`spec/authorization.md`, M8) in
TypeScript, Python and Rust ([#532](https://github.com/lushly-dev/afd/issues/532)). It kept every rule of
section 3.1 and of the AFD spec, and settled how each language seals the binding. None changes the trust
model; each makes a refusal more likely, never less. The language rows of `spec/command-metadata.md`,
`spec/authorization.md` and `docs/language-parity.md` record the result.

| Section | Was | Now | Why |
| --- | --- | --- | --- |
| 3.1, #532: how the binding is sealed | "Sealed inside the state or as its associated data" | Never inside the state in readable form, in any language. **Rust:** HMAC associated data of `RequestStateCodec`, `["afd.confirm.v2", <principal binding as a JSON string>, [[command, input], ...]]` canonically. **TypeScript:** the SDK codec's HMAC bind tag (`b`, a truncated HMAC), over `["afd.requestState.v2", method, authInfo.clientId, <principal binding>]`. **Python:** the SDK's `RequestStateSecurity(bind_principal=...)`, which keeps a salted digest inside the AES-256-GCM seal | Integrity-protected, and the state names no one: TypeScript's state is signed, not encrypted, so a readable identity (or an unkeyed digest of a guessable one) would leak. Using each SDK's own check makes a mismatch fail at the same place, with the same answer, as an altered MAC |
| 3.1, #532: what "refused as tampered" is | "The same refusal as a tampered state" | Exactly the tampered answer of each language: TypeScript and Rust treat the state as no answer and ask again (the same `input_required` question, a fresh state); Python's SDK answers JSON-RPC `-32602` "Invalid or expired requestState" before any handler runs. A `decline` carried in another principal's state is no answer either: it is asked again, never `CONFIRMATION_DECLINED` | The spec's existing per-language tampering behaviour; a declined answer that is not the caller's must not end the call for them |
| 3.1, #532: old states | Unstated | A state minted before step 0c fails closed: Rust's and TypeScript's bindings carry a version label (`afd.confirm.v2`, `afd.requestState.v2`), so the old associated data or bind tag never verifies; Python's old state is refused by the SDK's principal check: a state minted without a token has no principal claim ("principal drift"), and one minted with a token carries the SDK's default claim, which no longer matches | A deployment rolling over keeps no confirmation that skipped the binding |
| 3.1, #532: whose actor | "The actor" | The actor the commands run with, when the gate runs. **Rust:** the context after the hook, the server's defaults and the restored credentials (the credentials' default actor included). **TypeScript:** `createContext`'s `actor`, else the server's `actor` option (`{ kind: "agent" }` by default), as the remote engine applies it; `actor` and `credentials` are reserved context-field names, so a client cannot set them through `_meta`. **Python:** the server's `actor`: Python has no per-request hook, so its confirmations bind the server's fixed actor; adding one is a parity follow-up, [#800](https://github.com/lushly-dev/afd/issues/800) | The gate runs before registry middleware, so middleware that refines the actor later (TypeScript's `afd-auth`, whose session is process-wide) cannot be bound; a host that tells callers apart does so in the hook or `createContext`, which the binding covers |
| 3.1, #532: credentials in TypeScript and Python, and incomplete credentials | "When the call has credentials" | **TypeScript** has no token verification yet: it binds `createContext`'s `credentials` (`{ issuer, subject, clientId }`), so its MCP authorization step only has to set them. **Python** binds the access token the MCP SDK verified (`iss` from its claims, `subject`, `client_id`), replacing the SDK's default `authenticated_principal`, which bound the same token components but not the actor. **Incomplete credentials fail closed in all three languages** (coordinator decision on the step 0c question, 2026-11-07): credentials whose issuer, subject or client id is missing or empty are never bound, and never taken as no credentials. No state is minted for such a call, and a retry carrying a state is refused before any state is verified, both as an internal error whose message names no one (Rust: `principal_binding` and `credentials_binding` return `Result<_, IncompleteCredentials>` and the gate answers JSON-RPC `-32603`; TypeScript: `principalBinding` throws and the lane answers its internal error, on the retry as well as the mint; Python: `IncompleteCredentials` from `sdk_credentials`, so the SDK refuses to seal with its internal error, and a check placed just before the SDK's request-state boundary refuses a retry with the same error instead of the boundary's `-32602`). Only a call with no credentials at all binds `null` (the actor alone). The actor and credentials are copied when a TypeScript call starts, so later in-place changes do not move the binding. The SDK's `authInfo` contributes only its `clientId` in TypeScript, so a host authenticating people through the SDK must copy their identity into `credentials` (documented on `createContext`) | One shape for every language; a binding that cannot tell two callers apart is never issued, rather than one that binds at client level (an earlier draft of this step bound a missing component as `null` in Python, as the SDK does; the coordinator chose to fail closed) |
| 3.1, 7.3: approval-relay state | "Confirmation and approval-relay state are both bound" | **TypeScript** carries confirmation and approval answers in one round state, so the one bind tag binds both; its approval binding already held the actor in a keyed digest, and now the credentials bind as well. **Rust and Python** have no form-mode approval relay; step 0d builds Rust's and must bind its state, and the `HumanRelay` state, to the principal binding the same way | Nothing in Rust or Python needed fixing for the relay; 0d is where the gap would open |
| Crate API | `confirmation_binding(command, input)`; `principal_binding` and `credentials_binding` returning `String` (step 0b) | `confirmation_binding(command, input, principal)`; `principal_binding` and `credentials_binding` return `Result<String, IncompleteCredentials>`, all breaking (recorded in the crate changelog); only the workspace's own tests call them | A public helper that returned the old binding, or a binding of empty fields, would mislead a host checking states |
| 16, 0c: tests | "Each language's confirmation suite" | Each suite proves a state issued to one actor (another id, `onBehalfOf`, kind, or no actor) and, where credentials exist, one issuer, subject and client (a different client of the same person included) gets the tampered answer and runs nothing, that the same caller (with another `label` or scopes) still confirms, that a pre-change state fails closed, and that credentials missing each of issuer, subject and client id (absent or empty) get the internal error on both the mint and the retry; each fails with the binding or the refusal removed. TypeScript and Python load the `principalBindings` cases (`principal-binding.test.ts`, `test_principal_binding.py`); `python.yml` triggers on `spec/authorization.json` | So the binding cannot silently fall back to the command and input |

## Amendments from step 0d

Step 0d implemented the host-verified confirmation mode, `HumanRelay`, relay evidence and the form-mode approval relay
in `packages/rust` ([`spec/command-metadata.md`](../../../../../spec/command-metadata.md), "Host-verified
confirmation", "Relay evidence" and "Asking the human over MCP"). It kept every rule of sections 3.1, 3.3 and 7.3 and of
the AFD spec, and took the stricter reading wherever they left a choice. None changes the trust model; each makes a
refusal more likely, never less. An independent security review of the step found no blocker and two improvements,
fixed in the same branch with a regression test each; the rows marked "(review)" record them and its two notes. The
language rows of `spec/command-metadata.md`, `spec/authorization.md` and
`docs/language-parity.md` record the result.

| Section | Was | Now | Why |
| --- | --- | --- | --- |
| 3.1: the Rust name (0a's note) | `CommandDefinition::confirmation_mode = HostVerified`, beside the server's `ConfirmationMode` | The field `confirmation_mode: Option<CommandConfirmationMode>`, with `CommandConfirmationMode::HostVerified` (`with_confirmation_mode`, `is_host_verified`), reported as `confirmationMode: "host-verified"`; the server option stays `ConfirmationMode` | The two answer different questions: the option says how a server treats `confirmPrompt`, the per-command mode says that only the host confirms the command at all |
| 3.1, 12.2: `task` beside the mode | "Registration refuses `task` beside `confirmationMode`" | `CommandDefinition` has no `task` yet, so registration calls one check, `validate_person_gates`, documented as the place step 0e refuses `task` beside `confirmPrompt`, an approval policy or `confirmationMode` | One place for 0e to add the refusal, for both registration paths |
| 3.1: which refusal | Batch, pipe and 2025 calls get "call it on its own from a 2026-07-28 client" | Without a relay installed, every call to a host-verified command, those included, gets the no-relay suggestion ("cannot confirm over MCP"; do not retry); with one, they get the "on its own" suggestion. The relay is checked before the era | Telling an agent to retry in a way that will fail again invites a loop |
| 3.1: the HTTP routes | `/rpc`, `/batch` and `/stream` fail with `CONFIRMATION_REQUIRED` | Rust serves none of them (step 0b's amendment): Streamable HTTP is MCP, held to the era rule, and the suite checks it on both eras and on stdio | Nothing to refuse; the rule holds where Rust has a route |
| 3.1 step 2: before `begin` | Validate, then digest | In order: credentials that cannot be bound fail with the generic `-32603` (M8), before validation and before the relay is asked, on a first call and a retry alike; the input is validated by the registry's own function (`VALIDATION_ERROR`); on an authorized server with a resolver, the resolver is asked again on the validated input (`INSUFFICIENT_SCOPE`); an input whose canonical JSON cannot be digested (an integer beyond 2^53) is `VALIDATION_ERROR` | No person is asked about a call that would be refused anyway, and M6's "at execution" check is not left until after a person decided |
| 3.1: `confirm` on a host-verified tool | "Never advertises or accepts an acknowledgement" | Its tools advertise no `confirm`, and a `confirm` argument is neither read nor removed: it is input like any other, so validation drops it unless the command declares it, and the digest covers what runs | An acknowledgement that is silently consumed would look accepted |
| 3.1 step 3: the relay's prompt | The URL "is an absolute `https` URL"; the state is integrity-protected | The server also checks what it can: a prompt whose URL is not `https://` with a host, or names user information, or holds whitespace or a control character, or whose state is empty, and an `Approved` with an empty decision id, are a generic `-32603`. `begin` is called even for a client without URL mode, as the spec says, so the relay can refuse with its own error (Umbel's `url-elicitation-required`); its prompt is then never sent (`CONFIRMATION_REQUIRED`) | A relay that breaks its contract fails closed rather than sending an identity-bearing link or a decision every later one would collide with |
| 3.1 step 4: other answers | `decline`, `cancel`, `accept` | Any other action, an answer without a state and a state without an answer are no answer: the relay begins again | Only the three actions MCP defines mean anything |
| 3.1, relay evidence: where it lives | A crate-private field the middleware checks | `CommandContext`'s crate-private `relay_evidence`, removed by the registry before the handler runs, so a command the handler calls in process meets an ordinary hold (no `details.reason`), not `command-mismatch`. When present, the middleware reads neither `context.approval` nor the in-process exchange. A middleware with `ApprovalReplay::WithinTtl` still spends `relay:<decisionId>` once, and an empty decision id is `already-used` | Rule 3's "a command the handler calls never runs on it" holds without relying on the comparison; rules 2 and 4 read literally |
| 3.1, 7.3: the form-mode relay in Rust | "Rust's form-mode relay per `spec/command-metadata.md`" | `ApprovalMiddlewareOptions::with_relay(ApprovalRelay::McpElicitation)`, off by default, as TypeScript's `relay: 'mcp-elicitation'`: the binding is a keyed digest (`relay\0` and the canonical `[command, input, actor]`) under each approval secret, the nonce and expiry under a MAC (`relay-hold\0`) with the approval secret, an answer counts for 10 minutes from its question and only within the middleware's own TTL, and its nonce is spent once unless `WithinTtl`. On a 2025 stdio connection the question is a server-sent elicitation and the call runs again with the answer, at most two questions per call. A host-verified command never gets the relay's channel, and the middleware ignores the channel when relay evidence is present | Parity with TypeScript; two independent guards keep a form from ever confirming a host-verified command |
| 3.1, #532 (0c's row): the state | `["afd.confirm.v2", principal, gated commands]` as associated data, payload `confirm` | One state per call for confirmation and approval answers (`{ p, a }`, as TypeScript), with the associated data `["afd.confirm.v3", <principal binding>, [[command, input as sent], ...]]` over every command the call runs; a v2 state fails closed and is asked again. `confirmation_binding` returns the new layout (breaking, recorded in the crate changelog) | The spec's "one `requestState` carries the answers of earlier rounds"; binding every command of the call, not only the gated ones, binds the approval answers to the same call |
| 3.3: the shapes | `RelayCall { command, input_digest, actor, credentials, client_capabilities }` and the rest | As given, with `credentials: Option<Arc<Credentials>>` and `client_capabilities: Option<rmcp::model::ClientCapabilities>`; `RelayCall`, `RelayPrompt` and `RelayOutcome` are `#[non_exhaustive]` (`RelayCall::new`, `RelayPrompt::new`), and `RelayCall` adds `principal_binding()` and `supports_url_elicitation()`. `afd::input_digest` is public, and `ApprovalRejection` gains `CredentialsMismatch` and `Declined` | What the relay must bind is one call away; later fields do not break hosts |
| 3.1, 7.3: the form relay's fallbacks (review) | "Fall back to `APPROVAL_REQUIRED` without a token" | With `ApprovalRelay::McpElicitation`, an MCP call that cannot be asked (no form capability, a 2025 request over Streamable HTTP, a batch or pipeline step, a nested command) never carries `details.approvalToken`, whatever `with_include_token` says; Rust's default otherwise stays `true` | Rust's default included the token, unlike TypeScript's "not on MCP", so the agent held an approval credential |
| 3.1 step 2: the scope check (review) | Untested | `tests/server_human_relay.rs` holds a resolver keyed on a defaulted field: `INSUFFICIENT_SCOPE`, and the relay is never asked | The check had no test that failed without it |
| 3.3: single use without a policy (review note) | "`Approved` at most once per decision" | Documented on `HumanRelay`: atomically, and for a command without an approval policy the relay's own guarantee is the only guard, since nothing in AFD spends that decision | The spec makes it the relay's duty; Umbel's step 5 relay must hold it under concurrent retries |
| 3.1: 2025 stdio (review note) | Unstated | The in-band approval question re-runs the registry pipeline, so outer middleware and the journal see a held attempt before the run; documented, not changed | The handler still runs only after approval |

## Amendments from step 0e

Step 0e implemented Tasks in `packages/rust` ([`spec/command-metadata.md`](../../../../../spec/command-metadata.md),
"Tasks"; the extension `io.modelcontextprotocol/tasks`, SEP-2663 revision 2026-07-28). It kept every rule of sections
3.1, 3.3 and 12.2 and of the AFD spec, and took the stricter reading wherever they left a choice; the cross-language
ones are written back into `spec/command-metadata.md`. None changes the trust model; each makes a refusal more likely,
never less. An independent security review of the step found no blocker and seven improvements, fixed in the same
branch with a regression test each, and four notes, three of them taken; the rows marked "(review)" record them. One
choice the review raised, whether a server that cannot tell its HTTP callers apart may create tasks, was settled for the
owner by the strictest reading: it may not. The
language rows of `spec/command-metadata.md`, `spec/authorization.md`, `spec/error-codes.md` and
`docs/language-parity.md` record the result.

| Section | Was | Now | Why |
| --- | --- | --- | --- |
| 3.1, 12.2: the runtime | The proposal's "Rust pilot on `rmcp`'s `TaskManager`, behind a store adapter" | `rmcp` 3.9's task model types (`Task`, `DetailedTask`, `CreateTaskResult`, `GetTaskResult`, `CallToolResponse::Task`), its `ServerHandler::get_task`, `update_task` and `cancel_task` hooks and `enable_tasks`, with AFD's own runner and store. `TaskManager` is not used | `TaskManager` keeps tasks in one process's memory with no owner, no pluggable store and no bound, and marks a task past its TTL `failed`; none of that fits the owner check or a shared store |
| 3.3: `TaskStore` | `create`, `get(id, owner)`, `update(id, owner, change)`, `expire(now)` | As given (`async_trait`), with `TaskRecord` (id, owner, command, `status`, `statusMessage`, `createdAt`, `lastUpdatedAt`, `ttlMs`, `pollIntervalMs`, `cancelRequested`, `result` or `error`; no token, credentials or input; `Serialize` for a host's store; `Debug` redacts the id and owner and elides results), `TaskOwner` (the principal binding as a string, `from_binding`, `as_str`, a constant-time `matches`, `Debug` redacted), `TaskChange::{Progress, CancelRequested, Completed, Failed, Cancelled}` applied by `TaskRecord::apply`, which leaves a finished task unchanged, and `TaskStoreError::{OwnerLimit, TotalLimit, Unavailable}`. Implemented for `Arc<T>`. `McpServer::with_task_store` and `with_task_options` (`TaskOptions`, read through getters: `ttl_ms`, `poll_interval_ms`, `check_interval_ms`, `max_result_bytes`, `max_running`, `token_expiry_grace_ms`) | A host's shared store (12.2's `tasks.sqlite3`, step 8) applies changes exactly as the default does; a `get` that ignores the owner is caught by the server's own check below |
| 12.2: defaults | `ttlMs` 3 600 000; `pollIntervalMs` unstated | `ttlMs` 3 600 000, `pollIntervalMs` 1 000, a running task checked every 1 000 ms, results kept up to 1 MiB, at most 64 tasks running at once per process; times from the server's clock (`McpServer::with_clock`), as ISO 8601 with milliseconds in UTC | The check interval is how often a runner reads the clock, its progress and the store's cancellation flag, so an injected clock drives the TTL and the token expiry in tests |
| 3.1: who gets a task | "A request that declares the extension" | An MCP 2026-07-28 request whose own `_meta` client capabilities declare it. A 2025 request never does, whatever it declared at `initialize` or in `_meta`, and its `tasks/*` requests are `-32021` too. The server declares the extension (`server/discover`, `initialize`) only when an MCP-exposed command may be a task; otherwise `tasks/*` stay `-32601` and its capabilities are unchanged | SEP-2663: under 2025-11-25 the extension "is not defined" and requests "proceed as if the client had declared no task capability"; a server with no task command keeps its old answers |
| 3.1: where the decision falls | "Everything an inline call meets before dispatch happens first" | The task is decided where the inline call would run: after the context hook, the scope check after routing, the context check and the confirmation gate's `Proceed` on the single-command path (the bearer layer's 403 is earlier still), so a call refused by any of them gets that refusal, not a task and not `-32021` | A task command has no person gate, so the gate always proceeds; deciding after it keeps the order identical to an inline call's |
| 12.2: the id | "128 random bits, base32" | 16 bytes from the OS random source (`getrandom`), unpadded lowercase RFC 4648 base32, 26 characters. A `tasks/*` id not of that form gets the unknown answer without asking the store | The stated form, exactly; a host store never sees arbitrary strings as keys |
| 3.1, M8: the owner | "The call's principal binding" | The principal binding of the actor the context hook left and the verified credentials, as for #532's state. Credentials that cannot be bound get no task: the call is a generic `-32603` and nothing runs; a `tasks/*` request with them is the same `-32603`. 12.2's `{ effectivePrincipal, actor, issuer, clientId }` remains Umbel's own record (step 8) | One binding for every use (step 0a); a binding that cannot tell two callers apart is never issued |
| M6, other methods: authorizing `tasks/*` | "The same authorization as a `tools/call`, then the owner check" | In order: `-32021` without the extension; fail closed without admitted credentials and the required scopes (`-32600` with `data.code`, before the task is looked up, so the answer is the same for any id); the context hook, given `ContextHookRequest::tool` as the method name (a refusal is `-32600` with `data.code` and `data.suggestion`); the owner check in the store and again in the server; the TTL; then, stricter, to read or update the task the owner's current token must still hold what a call of the task's command needs without its input: the command's `scopes` (named) or, under a resolver, its `visible` (none named), else `-32600` with `data.code` `INSUFFICIENT_SCOPE`. `tasks/cancel` does not ask that (review note: stopping a task only takes authority away, so an owner whose token was narrowed can still stop work running on the old token's authority) | The hook runs so the caller's actor is the one the owner was bound with; a task's result is the command's output, so reading or cancelling it needs what calling the command needs; only the owner can reach that check, so it reveals nothing |
| 3.1, 12.2: one answer | "A mismatch answers as an unknown id" | JSON-RPC `-32602` "Task not found", with no `data`, for another principal's (another actor, `onBehalfOf` or kind, issuer, subject or client), an expired, a malformed and an unknown task, on `tasks/get`, `tasks/update` and `tasks/cancel`; the suite compares the responses byte for byte. The server checks the owner and the TTL itself whatever the store returned, and reads never purge | SEP-2663's protocol error for an unknown id; a store that leaked or kept an expired task still reveals nothing |
| 3.1: `tasks/update` | "Finds no task waiting for input" | Acknowledges (`resultType: "complete"`) and ignores every `inputResponses` key, after the same checks | SEP-2663: a server "SHOULD ignore" responses for keys that are not outstanding, and no AFD task has any |
| 3.1, 12.2: cancellation | "Requests cooperative cancellation" | `tasks/cancel` records `cancelRequested` in the store, so a runner in any process sharing it stops the task within one check interval, and fires the signal of a task running in this process at once; it acknowledges, and a finished task is unchanged. A stopped task is `cancelled` | One rule for one process and for several behind one URL |
| 3.1: stopping | "Its cancellation signal fires" | The runner drops the handler's future when the signal fires, so the handler stops at its next `.await`; `CommandContext::cancellation()` (`afd::CancellationSignal`, `is_cancelled`, `cancelled().await`) lets work the handler spawned, and loops that do not await, stop too. There is no grace period. The context had no signal before this step | "Never outlives the token" holds without trusting the handler. 12.2's "cooperative, between batches" is Umbel's handler checking the signal; a grace, if step 8 needs one, is its amendment |
| 3.1, 12.2: the TTL | "The server may discard the task when its TTL ends" | At `createdAt + ttlMs` the task is gone: a running handler is stopped, the record is removed (`expire`), and every `tasks/*` answers it as unknown. A TTL-ended task is never `failed`. By default the TTL is not capped at the token's `exp` (step 0a). (review) A host may cap it: `TaskOptions::with_ttl_capped_at_token_expiry(grace_ms)` ends each task's `ttlMs` at its token's `expiresAt` plus `grace_ms` (12.2's rule is a grace of 0), and the capped `ttlMs` is the one the client sees. Which grace Umbel uses stays the 2026-11-07 follow-up's question for step 8 | SEP-2663 lets a server delete a task once its TTL elapses; deleting rather than failing keeps no result past its retention |
| 3.1, 3.2: the token | "Stops with `TASK_TOKEN_EXPIRED` at `credentials.expiresAt`" | At `now ≥ expiresAt × 1000` on the server's clock, with no skew, checked every check interval and when the handler returns: a result that arrives after `exp` is not delivered, and a task whose token had expired when it was created (a token the verifier accepted within its skew) completes with `TASK_TOKEN_EXPIRED` without its handler starting. The failure is `completed` with `isError`, and `TASK_TOKEN_EXPIRED` joins the shared catalog in all four languages (48 codes). (review) Its retryable value is "Varies" in `spec/error-codes.md`: `true` when the handler never started or the command is not a `mutation`; `false` for a mutation whose handler started, whose suggestion says it may have made its change (part of it, when stopped at an `.await`; all of it, when it returned after `exp`) and to check its effect first | "A task never outlives the token that started it", read strictly; the skew is for clocks that disagree, not a grace. Telling an agent to retry a change that may already have been made invites a double effect |
| 3.1: results | "The `CallToolResult` an inline call would return" | Exactly that object (`resultType: "complete"`, `content`, `structuredContent`, `isError`), `completed` even for a failed `CommandResult`; (review) a handler that had already returned when a `tasks/cancel` arrived keeps its result rather than becoming `cancelled` (SEP-2663: a cancelled task "MAY ultimately reach a terminal status other than `cancelled`"), so a change the command made is reported; `failed` only for a JSON-RPC error inside the server (a runner that panicked, a result that cannot be serialized): `{ "code": -32603, "message": "Internal error" }`. A result larger than `max_result_bytes` is replaced by an `INTERNAL_ERROR` failure (`retryable: false`, `details.limitBytes` and `actualBytes`) whose suggestion says the command ran. A store that fails the final update is asked twice more, one check interval apart | The extension's statuses; a kept result is bounded, and an agent is told that a mutation's change stands |
| 3.1: progress | "Updates `statusMessage` and `lastUpdatedAt`" | `CommandContext::report_progress(message)` keeps the latest message (at most 1024 bytes, cut at a character boundary); the runner writes it at its next check with the server's clock as `lastUpdatedAt`. A call that is not a task ignores it. `cancelRequested` does not move `lastUpdatedAt` | No notification exists for a task; the message may reach a model, so the docs say a phase or a count, never content (12.2's "a phase name only") |
| 3.3, 12.2: the bound | "Bounded so that one principal cannot exhaust memory" (step brief) | `InMemoryTaskStore` holds at most 32 tasks per owner and 256 in all (`with_limits`), counting finished tasks until their TTL ends and purging expired ones on every `create` and `expire`. (review) Over a limit it first makes room by dropping a finished task before its TTL: the owner's own oldest for the owner's limit, the oldest of the owner holding the most finished tasks for the total; only when every task in the way is working is the call refused. (review) Whatever the store allows, one process runs at most `TaskOptions::with_max_running` tasks (64). Every limit fails the call with the same `RATE_LIMITED` ("The task could not start: a task limit was reached, so nothing ran"; `retryable: true`) and nothing runs. With the 1 MiB result limit, one owner holds about 32 MiB at most. A store that cannot record a task fails the call with `INTERNAL_ERROR` (`retryable: true`), its own message never sent | Count limits a store can keep without knowing sizes, a result limit and a running limit the server keeps for every store (a host's SQLite store may set none); finished results can no longer keep every other caller out for an hour; one answer for every limit names no one and says nothing of the server's load. The limits bound memory, not principals: the host bounds who may get a token |
| 3.3: `TaskOptions` (review) | Public fields | Private fields read through getters; the builders clamp every value to at least 1, so a check interval of 0 cannot make a runner spin on the store | `#[non_exhaustive]` stops building the struct, not assigning a field |
| M6, other methods: fail closed (review) | Untested | `tests/server_tasks.rs` sends `tasks/get` and `tasks/cancel` to an authorized server's plain Streamable HTTP service, with no admitted credentials: `-32600` with `data.code` `UNAUTHORIZED`; and a store that answers with another of the owner's tasks than the id named gets the unknown answer | The bearer layer's 401 answered before the server's own check ran, so no test reached it |
| M8: callers the server cannot tell apart (review; settled 2026-11-07 by the strictest reading) | Unstated; after the review, documented as one shared owner and listed for the owner | Settled by the coordinator for the owner, by the strictest reading: **a server never creates a task without an owner that tells callers apart.** Without an HTTP request (stdio) tasks work as before. Over HTTP a call needs verified credentials (`server-auth`) or the host's declaration `TaskOptions::with_callers_identified_by_hook()`, which counts only while a context hook is installed and documents that every distinct caller must map to a distinct actor. Otherwise the server behaves as one without the extension: it does not declare it in `server/discover` or `initialize`, `tasks/*` answer `-32601`, an `optional` command runs inline, and a `required` one fails before anything runs with `UNAUTHORIZED` (`retryable: false`; the suggestion names authorization and the hook declaration), whether or not the request declared the extension. `UNAUTHORIZED` gains this case in `spec/error-codes.md`; no new code. Decided per request, from the configuration and the request (and on AFD's own HTTP service also when the capabilities are built), never at registration, so a `required` command registers before authorization is configured and a host's own HTTP stack is held to the rule | Every caller of such a server binds the same owner, so a task id (which `Mcp-Name` carries and logs may record) would be the only guard; `UNAUTHORIZED` fits ("not signed in": the server has no identity for the caller) and keeps `-32021` for a missing client capability, which declaring it would not fix |
| M8: the owner at rest (review note, not taken) | A keyed digest of the binding was suggested, so a store keeps no identifiers | The record keeps the binding itself (`TaskOwner`), as the AFD spec says, and its `Debug` is redacted | A keyed digest needs a key shared by every process behind the URL, which AFD does not have; Umbel's step 8 record keeps its own owner fields (12.2) and may store a digest there |
| Runner bookkeeping (review note) | Unregistered at the end of `run` | Unregistered by a guard, however the runner ends (a panic in the store included) | A leaked entry would hold a place under the running limit until the process ends |

## Amendments from step 1

Step 1 wrote section 2's shapes, configuration version 5 (`src/workspace/hosted.rs`), manifest version 5
(`src/plugins/manifest/v5.rs`) and the constants (`src/auth/mod.rs`). It kept every rule of sections 2.1 to 2.4 and
took the strictest reading wherever they, or the sections they point to, left a choice. None changes the trust
model; each makes a refusal more likely, never less. Nothing acts on the new keys yet: steps 2a to 10 consume the
typed configuration (`Config::auth`, `limits`, `usage`, `HttpConfig::public_url` and `tls`,
`PrincipalConfig::equivalents`, `AccessGroup::claim`, `MemoryWritePolicy`'s new fields, `CommandDecl::task` and
`person`).

| Section | Was | Now | Why |
| --- | --- | --- | --- |
| 2.2, 6.3: serving before step 2a | Unstated | A hosted configuration opens (the CLI, stdio and the doctor read it), but the HTTP surface (`Host::http_router`, `umbel serve --http`) refuses to start, with `WORKSPACE_CONFIG_INVALID` naming `auth.mode`, `http.tls` or `http.bind`, in a hosted mode, with `[http.tls]` or on a non-loopback bind. Step 2a removes the refusal when it builds the listener and layers | Otherwise a non-loopback bind the configuration now admits would be served in plain HTTP behind phase 0's loopback token |
| 2.2: binding | "A non-loopback `http.bind` needs ..." | Also the `--bind` and `UMBEL_HTTP_BIND` override, and the gateway's channel rule is checked again after it. In versions 1 to 4 a non-loopback bind stays refused, naming what version 5 needs | An override must not reopen what the file may not |
| 2.2: the public URL | `https`, no query or fragment, host in `allowed_hosts`, path `http.path` | Also: the scheme and host in lowercase (the canonical form), no user information, visible ASCII; the host matches an `allowed_hosts` entry ignoring case, and the port as written matches the entry's (an entry without a port admits any, as the host check does). In mode `none` the key is optional and checked when set | The audience comparison (AFD's `same_resource`) and the host check must agree with what the configuration admits |
| 2.2: issuers | `issuer`, `namespace`, `subject_claim`, `verify`, `algorithms`, `delegation`, `services` | Aliases (issuer and gateway) match `^[a-z][a-z0-9-]{0,62}$`; an issuer's `iss` is an absolute `https` URL without user information, query or fragment, unique among issuers; `algorithms` defaults to `["RS256"]` (RFC 9068 and OIDC require it) and names only AFD's `SigningAlgorithm` set, each once (`none`, `HS*` and `ES512` refused with why); `services` names a non-empty `clients`, a `claim` or both, never neither | A token's `iss` must route to exactly one issuer (3.2 rule 2), and configuration must not name an algorithm the verifier always refuses (step 0b) |
| 2.2, 3.2 rule 12: introspection credentials | "Umbel authenticates to the endpoint with its own client credentials", with no key | `introspection = { client_id, client_secret_env }` on the issuer, required exactly with `verify = "introspection"` | The credentials need a place; a secret is named by variable (10.4) |
| 3.3: a login-only issuer | "Every issuer that issues tokens (not a login-only issuer)", with no key | `access_tokens = true` or `false` on an issuer: **required** on an issuer that serves a person login, `false` for every issuer in mode `gateway` (where no access token is accepted), and `true` by default on an issuer that serves no login. `false` is a login-only issuer: step 2b refuses its access tokens and step 2a leaves it out of `authorization_servers`. It must serve some namespace's person login, cannot be introspected, and does not count toward mode `oauth`'s "at least one issuer"; a group claim cannot name it, so no group claim works in mode `gateway` | The metadata's rule needs to tell the two apart, and an issuer the deployer added for the person page must not become a token issuer by omission (review) |
| 2.2, 4.1: subject claims | "Must name a claim that is not pairwise"; "no mutable claims" | Checked at open as well: an issuer's and a person login's `subject_claim` are refused when they name one of OIDC Core 5.1's standard claims (every one but `sub`), the mutable `upn`, `unique_name` or `login_hint`, or a registered claim that names no one (`iss`, `aud`, `exp`, `nbf`, `iat`, `jti`, `typ`, `scope`, `scp`, `azp`, `acr`, `amr`, `auth_time`, `nonce`, `at_hash`, `c_hash`, `sid`, `cnf`, `act`, `may_act`, `client_id`, `groups`, `roles`). Pairwise subjects stay the doctor's (`auth.subjects`, step 2c), which needs the metadata | 4.1's rule, as far as text can check it |
| 2.2, 6.1: the person login | `acr_values` and `uv_amr` non-empty; otherwise "its namespace's `verified` commands are not served" | An empty or missing `acr_values` or `uv_amr` fails at open (`WORKSPACE_CONFIG_INVALID`), as 2.2's list of rules checked at open says; `auth.person` (step 2c) keeps the conditions that need the provider's metadata. `client_id` and `client_secret_env` are required (a confidential client, 7.2); `subject_claim` defaults to `sub`; `max_age_s` is 1 to 3600, default 300; `acr_values` are 1 to 255 visible ASCII characters each, once | The strictest reading of two sentences that differ: a configuration that can never prove a person does not open |
| 2.2: ranges the text does not give | `clock_skew_s` 0 to 300 | `max_token_lifetime_s` 1 to 86 400 (one day), default 3600; `max_assertion_age_s` 1 to 300, default 60; every `[limits]` value at least 1 (none means "unlimited"); `usage.retention_days` 1 to 36 500, default 400; `[usage] enabled` default true | A bound on every number, and no value that switches a limit off |
| 2.2: the operator id | `principal.local_id` is `<ns>/<subject>` in hosted modes | `principal.on_behalf_of`, when set, too; and the subject is one 4.1's mapping can produce (below) | The stdio agent acts for `on_behalf_of`, so a legacy value there would split the identity 4.6 joins |
| 4.1: long ids | Hashed over 120 characters or starting with `~` | Also hashed when `<ns>/<id>` would pass 128 characters, phase 2's principal id limit (`umbel::auth::is_mapped_id`); the hash form is `~` and 52 lowercase base32 characters | A literal mapping must stay a valid principal string in `readers`, access tokens and records |
| 2.2, 4.6: equivalents | "Maps a principal string that no namespace can produce to one that a namespace produces, with no chains" | A source is a principal string whose id does not start with `<declared namespace>/`; a target is `human`, `agent` or `service` with the id `<declared namespace>/<mapped id>`. So no target is a source and chains cannot form. In mode `none` a target still needs a declared namespace | "Can produce" made checkable at open |
| 2.2: bound tokens | `require_bound_tokens` needs `client_auth` other than `none` | Also: only in mode `oauth` | Only a token is bound to a certificate |
| 2.2, 4.4: the gateway | `[auth.gateway]` for mode `gateway` | Refused in any other mode, required in `gateway`. `client_cert_sha256` entries are 64 lowercase hexadecimal digits, each once; `max_scopes` is required and non-empty, each a 5.1 scope under `scope_prefix` naming a declared space if any; the alias is no issuer's and the `iss` no issuer's; `keys` is a file path | A ceiling that is empty or names nothing Umbel grants would be a mistake that silently grants nothing or everything |
| 2.2: file paths | `cert`, `key`, `client_ca`, `keys` | Absolute, or relative to the workspace and outside `state/`, with `/` separators and no `..` segment. Existence, permissions and expiry stay the doctor's (`auth.tls`, step 2c) | `state/` is the host's; the files are the deployer's |
| 4.5: group claims | `claim = { issuer, name, value }` | The issuer is an issuer alias whose access tokens are accepted: never the gateway (also by name), never a login-only issuer. `members` stays required (it may be `[]`) | Claims come from access tokens only |
| 12.1: usage readers | `usage.readers`, default none | Principal strings and `group:<id>` (a declared group), each once; `*` is refused | Everyone already reads their own; `*` would make usage everyone's |
| 8.3, 8.4: the `memory_write` table | `editors`, `erasers`, `erase_approvals`, `erase_approval_window_s` named in sections 8.3 and 8.4 | Configuration version 5 keys of `[plugins.<id>.grants.memory_write]`, with the access-token grammar of `writers`; `editors` and `erasers` refuse `space` (review: an editor changes other people's records, 8.3); `erase_approvals` is 1 or 2 (default 1); the window 600 to 604 800 (default 86 400). Before version 5 they are refused as "needs config_version = 5" | They are `umbel.toml` keys and the schema is closed; erasing reaches every principal's records, so erasers are named, never "whoever reads the space" |
| 10.5: `WORKSPACE_CONFIG_INVALID`'s details | `key` | Every `WORKSPACE_CONFIG_INVALID` that a rule on one key of `umbel.toml` raises carries `details.key` (`WorkspaceError::key`), beside the message that names it; a TOML syntax error names no key and carries none (review) | The table's column, made structured |
| 2.3, 7.3, 8.4: `confirmationMode` | "The knowledge manifest gives both `person` and `confirmationMode`" | Not a manifest key: a command with `person.mcp` is registered host-verified by the host (step 5), so no manifest can leave it to a form | A key a manifest could omit would let AFD's form confirm a person-gated command |
| 2.3: `person` | On a `require-human` command | Refused on any other command; `mcp` only `"verified"`; `person.mcp` needs `expose.mcp = true`; agents and a missing CLI stay refused. Every `require-human` command, of any manifest version, carries `{ cli = "terminal" }` when it gives none. Until step 5 such a command is registered off MCP whatever it declares (`CommandDecl::mcp_exposed`), so mode `none` behaves as phases 2 to 4 (7.1) | 7.1: served over MCP only in a hosted mode to callers with a valid person login, which step 5 builds |
| 7.1, 2.3: `person.cli = "verified"` before step 5 (review) | Unstated | Such a command parses and loads, but the plugin gate refuses every call to it with `PERSON_VERIFICATION_UNAVAILABLE` (retryable false) before its handler runs, at a terminal included, until step 5 proves a person on the person page | 7.1's "else `PERSON_VERIFICATION_UNAVAILABLE`", read for a build with no person page; the terminal check must never stand in for `verified` |
| 2.3: the preview rule | "Every property the preview declares must be in the command's `journal.keep`" | The command must declare `journal = { mode = "digest", keep = [...] }`, since `keep` exists only with `digest`; checked at parse for inline schemas and at load for schema files, as phase 4's preview rules are | A plain journal keeps the whole input, which the rule exists to prevent |
| 2.3: `task` | Refused with digest journaling, `confirm`, `approval`, `authority_prompt`, no MCP, mounted tools and components, `inspect` alone | Also refused beside `confirm_prompt` (and so `confirm_preview`), as AFD's registration refuses it (steps 0a and 0e); plain journaling is allowed | One rule for Umbel and AFD |
| 2.3: pipelines | "Admitted on a pipeline when every step admits its value" | At parse, a pipeline's own refusals: `task` with a digest journal, without MCP exposure, with effects `inspect` alone, or beside `person`; and `person` may only be `{ cli = "terminal" }` on a pipeline (review). At seal (`pipelines::plan`): `task` only when every step's own `task` is not `never` (host commands never are); `person` only when every step is a `require-human` command at the terminal (a step whose `person.cli` is `verified` is stronger than the pipeline). Otherwise `PLUGIN_MANIFEST_INVALID` naming the step | The steps are known only at seal, as for phase 4's exposure rule. A person-page decision needs a preview and `keep`, which a pipeline cannot declare, and the relay confirms no pipeline step (step 0a) |
| 2.2: the schema and the reader (review) | One rule | Where a schema pattern cannot say exactly what the reader does, it errs toward refusing and the reader is authoritative: `workspace-config.v5.json` treats only the canonical loopback forms (`127.x.x.x`, `[::1]`) as loopback, so a non-canonical IPv6 loopback such as `[0:0:0:0:0:0:0:1]` is refused by the schema without TLS though the reader admits it. `plugin-show` reports a command's MCP exposure as registered (`CommandDecl::mcp_exposed`), not as declared | A schema never admits what the host refuses |
| 2: `workspace-show`'s `versions` | The lists of section 2 | As listed, plus `memory: [1, 2]` for memory record version 2; `provenance` stays the envelope version this host writes (2) beside `envelope`. The constants that stamp what the host writes (`PRINCIPAL_VERSION`, `PROVENANCE_VERSION`, `EVENT_VERSION`, `PROPOSAL_VERSION`, `CURSOR_VERSION`) stay until the step that writes the next version; new list constants (`PRINCIPAL_VERSIONS` and the rest) name what is read | Section 2's table names memory record version 2, and changing a stamping constant early would write a shape the host cannot yet fill |
| 2.1: which fields are `null` | Unstated | For `none`, `process` and `embedder`: `namespace`, `issuer`, `tokenBinding`, `scopes` and `spaces` are `null` and `delegationChain` is `[]`. `verified` and `gateway` go over `http` with a namespaced agent acting for a namespaced person, or a namespaced service, and at least one chain entry; `verified` needs a `tokenBinding`, and `gateway` has `null` (an assertion is not a token); `none` is exactly `agent:loopback` over `http`; `process` is `stdio` (an agent) or `cli` (a human); `embedder` is `library` | `null` tells "no token, not narrowed" apart from a token granting nothing (`[]`, `{}`) |
| 2.1, 2.4, 7.3: assurance | `humanPresent` and `assurance` with `acr?` | `terminal` goes with `cli-terminal` and only a `process` caller over `cli`; `verified` with `person-page`; `humanPresent` is `null` on stdio, the library and loopback. A `verified` assurance requires `acr` (and, in envelopes and proposals, `namespace` and `authTime`). Chain entries are `{ kind: agent or service, id: <namespaced> }`, at most 8. `policyDecision.policy` and `reason` are kebab-case codes of at most 64 characters | Owner decision 6 makes `acr` mandatory on every person login; a code pattern keeps claim values out |
| 2.1, 2.4, 12.1, 12.2, 7.2: times | Unstated | `at`, `authTime`, `createdAt`, `lastUpdatedAt`, `expires` and `decidedAt` in Umbel's records are ISO 8601 UTC strings with milliseconds, as the envelope's are | One time form in Umbel's records |
| 2.4: envelope version 3 | `delegationChain` and `confirmation.assurance` | `delegationChain` is required and never `null` (`[]` without a token); `confirmation.assurance` is required whenever there is a confirmation. Event version 3 changes only its envelope: a stored line keeps cursor version 0 positions | Stored lines hold positions (9.3) |
| 7.3: proposal version 3 | `decision.channel = "mcp-elicitation"`, `decision.assurance` | `terminal` and `mcp-elicitation` decisions require `assurance` at their own level, and an `mcp-elicitation` decision is a human's; `policy` decisions carry none | 7.3 |
| 9.3: cursor and locator | `v1.<base64url>`; `<space>@r1.<token>/<schema>` | Cursor `^v1\.[A-Za-z0-9_-]{55,256}$` (a 24-byte nonce and a 16-byte tag make at least 41 bytes); locator `indexVersion` `^<space>@r1\.[A-Za-z0-9_-]{55,128}/[0-9]+$` | Bounds a seal can meet |
| 12.2: the task record | Its fields | `id` is 26 lowercase base32 characters (128 bits, step 0e); statuses `working`, `completed`, `failed`, `cancelled` (never `input_required`); `working` has a lease and no outcome, `completed` a `CallToolResult` (its `isError` results include `TASK_LOST` and `TASK_TOKEN_EXPIRED`), `failed` only `{ code: -32603, message: "Internal error" }`, `cancelled` neither; `statusMessage` a kebab-case phase name of at most 64 characters; `cancelRequested` kept from step 0e's record; the owner's `issuer` and `clientId` both set or both `null`; a result whose `_meta` or `structuredContent.metadata` says `dev.umbel/trust: "content"` is refused | "A phase name only" and "no content" made checkable |
| 12.1: the usage event | Its example | `id` is `u-` and 26 base32 characters (128 bits); `transport` is `http`; `method` one of the five; `outcome` `ok`, an upper-snake error code or a 4xx or 5xx status as a string; `principal`, `actor` and `namespace` `null` when a request is refused before its caller is known; `tools/list` has `null` `tool`, `command`, `space` and `task`, and task methods have no `tool` | The record names no content and no one it does not know |
| 7.2: the person decision | Its fields | `id` is 26 base32 characters (128 bits); `for.issuer` is the alias, and `issuer` and `clientId` are both `null` at the CLI; `properties` follow `journal.keep`'s value rule (at most 16, strings of at most 512 characters, lists of at most 100 strings); no `expired` status (a pending decision past `expires` is expired); `decidedAt` added, which `humanPresent.at` needs; a decided row carries `level: "verified"`, `authTime`, `acr` and `previewHash` | 7.2's "only the preview's declared properties" made checkable |
| 3.3: protected-resource metadata | RFC 9728's fields | Required: `resource` (https, with a path), `authorization_servers`, `bearer_methods_supported` and `tls_client_certificate_bound_access_tokens`; optional: `resource_name` and `scopes_supported` (left out when empty), as AFD's `ProtectedResource::document` emits them | Step 0a's amendment |

## Amendments from step 1b

Step 1b added `endpoints/umbel/testkit-idp`, the crate `umbel-testkit-idp`, and the host test `tests/no_auth_server.rs`.
It kept every rule of sections 1, 3.2 to 3.4, 4.4, 7.1, 7.2 and 14 that names the kit, and settled what they left
open. None changes the trust model. The kit is test infrastructure; where a choice existed, it took the one that
lets a later step's test fail for the right reason. An independent review of the step found one blocker (the token
exchange answered `invalid_grant` for a bad subject token, where RFC 8693 2.2.2 requires `invalid_request`), eight
improvements and thirteen nits; all are fixed in the same branch and folded into the rows below, and a second
review confirmed each fix. One forward note from it stands for step 2a: a gateway assertion is single-use and bound
to the method and URL, so `no_auth_server.rs`'s `gateway` probe needs a fresh assertion per request rather than a
static credential.

| Section | Was | Now | Why |
| --- | --- | --- | --- |
| 1: the kit's dependencies | `jsonwebtoken`, `axum`, `tokio-rustls`; `rcgen` as a dev-dependency | `rcgen` is a normal dependency: the test CA is part of the library. Also `aws-lc-rs`, `hyper`, `hyper-util`, `tower`, `url`, `time`, `serde` and `serde_json`, every one already in the lock, and `base64` 0.22. Only `jsonwebtoken` 11.1.0 (AFD's version, `aws_lc_rs`) and its own dependencies (`signature`, `base64` 0.22, `rand_core` 0.6, `zeroize_derive`) join the lock. The kit signs with `aws-lc-rs` directly, because a broken token needs the exact header and payload text (a repeated member, `alg: none`). `jsonwebtoken` verifies the tokens the kit receives, through its `aws-lc-rs` provider called directly, as AFD's verifier does. AFD with `server-auth`, `reqwest` and `async-trait` are dev-dependencies. That dev-dependency turns AFD's `server-auth` on in workspace-wide builds; `umbel.yml`'s per-feature clippy legs still build the host alone | A CA that only tests could use would be no CA for steps 2a to 12; a builder that only serializes valid JSON cannot break rule 2 |
| 1: what the kit is | "Test-only, `publish = false`, quarantined with no route" | As written. It has no binary for manual runs, since a binary would be a shipped surface. `scripts/repository-contract.test.mjs` holds the unit quarantined, private and route-less, refuses a `[[bin]]`, and keeps it out of the host's linked dependency tables. It is a workspace member that `umbel.yml`'s `check` job does not exclude, so the workspace clippy and `cargo test --workspace` run its suite, as `suites.mjs` does locally. `architecture.json` lists it as an `umbel` endpoint unit | The specification's words, held by tests |
| 1: `tests/no_auth_server.rs` | Fails if `umbel` depends on the kit outside `[dev-dependencies]`, or serves a token or authorization endpoint | Six tests. (1) `umbel`'s `Cargo.toml` names the kit in no `[dependencies]` or `[build-dependencies]` table, target tables included, by key, by `package` or by `path`; it is a workspace member and not excluded. (2) No workspace crate reaches the kit through a chain of normal or build dependencies. The walk reads `cargo metadata --no-deps --offline` of the workspace, then of each path crate outside it that it reaches (the afd crate), since a `publish = false` crate is reachable only through path dependencies; it asserts that it left the workspace. The kit has no binary target. (3) Every routing call (`route`, `route_service`, `nest`, `nest_service`) in every workspace crate's `src`, read with comments removed, names no OAuth path: a `token`, `revoke` or `userinfo` segment; a segment starting `authoriz`, `oauth`, `introspect` or `jwks`; or a well-known name other than `oauth-protected-resource`. A path that is not a string literal is left to (4). (4) Every OAuth path (`/token`, `/authorize`, `/oauth/…`, `/introspect`, `/jwks`, both authorization-server metadata names, path-inserted and appended), by GET and by POST, with a credential the router admits, gets 404 or 405 and no OAuth member; without a credential it gets a refusal (400 or more) and no OAuth member. This holds for each router in `routers()`. Step 2a adds its `oauth` and `gateway` routers there, each with an admitted credential (a kit access token for `http.public_url`, or a kit assertion over the pinned channel), so that a 404 proves no route matched rather than that the layer refused. A mutation run (a `/oauth/token` route, a normal dependency from `umbel-hook`) failed (2), (3) and (4) | An axum `Router` exposes no route table, so the test reads the routing calls and probes the router; both keep working as 2a adds `/.well-known/oauth-protected-resource*` |
| 3.2, 14: the token builder | "Each rule against a token built to break only that rule" | `TokenBuilder` makes access tokens, opaque tokens, ID tokens, ID-JAGs and gateway assertions. Each `Break` changes one thing, and `Break::rule` names AFD's rule code (M5). The codes hold under AFD's defaults: a skew of at most 300 seconds (and at least 2 for `ExpiresBeforeIssued`, whose `iat` is a second from now and `exp` now), a longest lifetime under a day, and 64 scopes. The breaks are defined for access tokens; on another kind a break changes the same member where that kind has it (`Typ` gives an ID token `at+jwt`; a missing `client_id` removes a gateway assertion's `client`), and `rule()` is an access token's code. Exact choices: `alg` `ES512`, which AFD cannot configure; `HS256` keyed with the signing key's public bytes; a repeated header member (`typ`) or claim (`sub`), refused as `typ` and `unknown-issuer` by 0b's parsing rule; another key of the same kind under the published `kid` (`signature`); a `kid` of a key of another type (`key`); 65 scopes under `umbel`; `cnf.jkt`; a `cnf` naming another certificate, or not an object (`binding`). The suite checks every break with `ES256` and `RS256` against `JwtVerifier`, and that the same token without the break is accepted, and the time breaks at skews of 2, 60 and 300 seconds | One rule at a time is only provable if the unbroken token passes beside it |
| 3.3, 14: topology and discovery | "On 127.0.0.1 with a test CA, playing three roles" | One HTTPS listener on `127.0.0.1:0`, never another address, with issuers `<base>/idp` and `<base>/as` and the gateway issuer `<base>/gateway`, which serves nothing. Issuers have paths so that the path-inserted and appended well-known URLs differ, which 3.3's order needs. Both roles serve their metadata at `/.well-known/oauth-authorization-server<path>`, `/.well-known/openid-configuration<path>` and `<issuer>/.well-known/openid-configuration`, and a JWKS at `<issuer>/jwks`. A `Fault` affects one location only: a status; a `302` to a URL that serves the real document and counts its hits, so a test proves the redirect was not followed; a delay; a valid JSON body over 1 MiB; or a malformed body. A status, redirect or body fault answers before the endpoint runs, so it spends no code. A metadata patch (RFC 7396) makes an `issuer` that does not match, an `http` `jwks_uri` or a missing `claims_supported`. Keys rotate (the old one stays published), retire (no longer published, still able to sign) or are replaced by an override. Each role starts with RSA 2048, P-256, P-384 and Ed25519 keys, made in memory and never written. The listener asks for a client certificate chaining to the kit's CA without requiring one, so mTLS and RFC 8705 binding use the same port. The authorization server's document at the `openid-configuration` URLs is its RFC 8414 document, served there so that 3.3's order can be tested; it is not a full OpenID Connect discovery document. A second loopback listener serves the same documents over plain HTTP and counts each fetch, so a test proves an `http` `jwks_uri` was refused rather than unreachable. The kit serves from a thread and Tokio runtime of its own, so a test that blocks its own runtime cannot stall it | Everything 2b's `auth_keys.rs` must refuse can be produced on demand |
| 7.1, 7.2, 14: the login | "A scripted login for synthetic users `ada`, `bo` and `cy` with test-only passwords, an `acr` class" | `ada`, `bo` and `cy` exist at both roles, each with the subject of their name, the password `<name>-test-password`, `acr` `phr` and `amr` `["hwk", "pin"]` (section 14); `ada` and `cy` are in `groups` `["eng"]`. An authorization request meets the next queued `LoginScript`: a `ScriptedLogin` (user; `acr`, `amr` and `auth_time` overridden or left out; `adjust_token` to change the ID token or access token redeemed), or a refusal with any `error`. With no script it meets a password form, whose request id is also in the `testkit-login-request` header. There are no sessions, so every login is fresh (`auth_time` now), and with no script queued `prompt=none` is `login_required` (a queued script stands in for an existing session); `ScriptedLogin::auth_time` stands in for a provider that reused a session despite `prompt=login` or `max_age`. `acr_values` and the `claims` request are not enforced: `claims` must be a JSON object and `max_age` an integer, and every authorization request is recorded as received (`Issuer::authorization_requests`), so a test asserts what the relying party asked for. The provider reports the user's `acr` whatever was asked, because 7.2 has the relying party check every login | The person page's refusals (`PERSON_VERIFICATION_INSUFFICIENT`, a stale `auth_time`, a wrong `nonce`) each need a provider that misbehaves in exactly one way |
| 7.2, 14: authorization requests | OIDC with PKCE, `state`, `nonce` | `response_type=code` only. PKCE `S256` is required (a missing challenge or `plain` is `invalid_request`), with the challenge's shape checked. `response_mode` is `query` only. Redirect URIs match the registered string exactly, with no fragment. `openid` is required at the identity provider. A bad `client_id` or `redirect_uri`, missing, unknown or repeated, is a 400 and never redirected (RFC 6749 4.1.2.1). Every other error, including another repeated parameter (only `resource` may repeat), is redirected with `state`. RFC 9207 `iss` is on every authorization response, and `ResponseIss` can leave it out or change it. A code lives 60 seconds and is spent by its first redemption, whatever the outcome. The verifier must have RFC 7636's shape. Token responses carry `Cache-Control: no-store` | RFC 6749, 7636 and 9207 as written |
| 3.2, 3.4, 14: the authorization server | "RFC 8414 metadata, a JWKS, authorization code with PKCE, RFC 7523 grants from ID-JAGs, introspection and client credentials" | RFC 9068 tokens (`typ` `at+jwt`, `ES256` by default, 300 seconds) carry exactly one audience. The authorization server needs exactly one `https` resource indicator (RFC 8707) across the authorization and token requests, the token request choosing among the authorization request's, and answers `invalid_target` otherwise. Tokens carry `auth_time`, `acr` and `amr` (RFC 9068 2.2.1) and `groups` (2.2.3.1) when known. Under client credentials, `sub` is the client. A client registered `certificate_bound()` must present a client certificate on the token request (`invalid_request` otherwise) and gets `cnf["x5t#S256"]` of it; the metadata advertises `tls_client_certificate_bound_access_tokens`. Client authentication is `client_secret_basic` (with RFC 6749 2.3.1's form-encoding) or `client_secret_post`, exactly one. A failure is `401 invalid_client`, with a `Basic` challenge when the client tried Basic or sent no credentials (RFC 6749 5.2). There are no public clients | One audience is 3.2 rule 7; a kit that issued multi-audience tokens by default would hide that rule |
| 3.2 rule 12, 14: introspection | RFC 7662 with client authentication | At the authorization server only. The caller must be a client registered with `introspection()`; otherwise it gets `401 invalid_client`. It answers for every token the server issued, opaque or JWT: `active: true` with the token's claims and `token_type` `Bearer`, or `{"active": false}` once it is expired, revoked or unknown. `token_type_hint` is accepted and ignored. `IntrospectionAnswer` scripts one token's answer: inactive, without a member, patched, or any JSON value. A claim break on an opaque token reaches the answer as it would a JWT. The suite checks each answer against AFD's `check_introspection` | Rule 12's required fields can each be removed alone |
| 3.4: the ID-JAG exchange | "ID token, RFC 8693 ID-JAG, RFC 7523 grant" | Per draft-ietf-oauth-identity-assertion-authz-grant-06 (2026-10-31). **Exchange** at the identity provider: client authentication; `requested_token_type` the ID-JAG type; `subject_token_type` `id_token` (SAML and refresh tokens are unsupported, `invalid_request`); exactly one `audience` (none or several is `invalid_request`), which must be the authorization server's issuer (`invalid_target` otherwise); no `actor_token`. The ID token is verified: signature under the provider's published keys, `iss`, `exp`, and `aud` naming the requesting client. A subject token that fails is `invalid_request`, as RFC 8693 2.2.2 and the draft's 4.3.4.3 require. The answer is `issued_token_type`, `token_type` `N_A` and `expires_in`. The ID-JAG has `typ` `oauth-id-jag+jwt` and `RS256`, the draft's mandatory algorithm. It carries `iss`, `sub`, `aud`, `client_id` (the client's id at the authorization server, `Client::resource_client_id`), `jti`, `iat`, `exp` (300 seconds), `resource` (a string, or an array for several), `scope`, and the ID token's `auth_time`, `acr` and `amr`. **Grant** at the authorization server: `typ` checked; `iss` the trusted provider; the signature under its published keys; `aud` the server's issuer, as a string or a one-element array; `exp` in the future and `iat` no later than now plus 60 seconds; `jti` and `sub` required; `client_id` equal to the authenticated client; the audience chosen among the ID-JAG's resources (a request may narrow, never add); scopes narrowed, never widened (`invalid_scope`); and the `jti` spent once, only after every other check. The grant's refusals are `invalid_grant`, `invalid_target` or `invalid_scope` | The extension's processing rules, so cy's chain in exit point 5 fails where a real deployment would |
| 4.4: the gateway signer | "A gateway signer" | `GatewaySigner::assertion(public_url, method)`: `typ` `umbel-gw+jwt`, `ES256`; `iss` `<base>/gateway`; `aud` and `htu` equal to the public URL; `htm`; `iat` now and `exp` 60 seconds later; a `jti` of 128 random bits; `sub` `ada`, `client` `gateway-client` and `scope` `umbel:read`. Every setter applies, and each break as `Break` documents for a non-access token. Its key set (`jwks`) is for the pinned `keys` file. Its client certificate, from the kit's CA, gives `sha256_hex` for `client_cert_sha256` and `x5t_s256` for binding | Section 4.4's fields, each changeable alone for `gateway_mode.rs` |
| 14: the test CA | "A test CA" | `TestCa` (also public, so a test can make a second, untrusted CA). P-256 keys; certificates valid from an hour ago for seven days, with random positive serial numbers; the CA has `pathLenConstraint` 0; leaves have `digitalSignature` and either `serverAuth` (IP or DNS names) or `clientAuth`, and an authority key identifier. `IssuedCertificate` gives the DER, PEM, PKCS #8 key and `identity_pem` for an HTTP client | What 2a's TLS and `client_auth` tests need |

## Amendments from step 2a

Step 2a built the host's listener and layers: in-process TLS with `client_auth`, the layers of section 6.3 in order,
the protected-resource metadata, the per-IP limit on shared counters, and the context hook version 1 skeleton
(`src/surfaces/http.rs` with `http/tls.rs`, `http/listener.rs` and `http/layers.rs`; `src/shared/`; `src/principal.rs`).
It kept every rule of sections 3.2, 3.3, 4.2, 6.2, 6.3, 10.2 and 11 that this step reaches, and took the strictest
reading wherever they, or the brief, left a choice. None changes the trust model; each makes a refusal more likely,
never less. An independent security review of the step found two blockers (one that the specification and STATUS.md
were not yet written, which they now are), seven improvements and five nits; all are fixed in the same branch, each
with a regression test that fails without its fix, and the rows marked "(review)" record them. Two questions it raised
for the owner are in the step's report and the follow-ups below; neither is decided here.

| Section | Was | Now | Why |
| --- | --- | --- | --- |
| 16, 2a: what 2b owns | "Token verification wiring" is step 2b's | **Mode `oauth` refuses to start** (`WORKSPACE_CONFIG_INVALID`, `details.key` `auth.mode`, naming step 2b) while the token verifier slot is empty, which it is in every shipped build until step 2b builds the verifier from `[auth.issuers]`. In step 2a only a test fills it, through `HostBuilder::with_token_verifier` (feature `testkit` only). **Even with a verifier the context hook refuses** every `tools/call` and `tasks/*` with `UNAUTHORIZED` until step 2b maps credentials to a version 1 principal. Step 1's refusal is lifted for mode `none` with `[http.tls]`, and for `oauth` as far as the slot is filled | The strictest of the options: a server that could verify nothing never starts, rather than starting and answering 401 to everyone, and a verified caller never runs as a principal that 2b has not defined |
| 4.2: the hook, version 1 skeleton | The table | Over HTTP the hook dispatches on `auth.mode`: `none` sets the loopback agent as before; `oauth` refuses as above, with credentials (logged at `warn`) or without (a layer missing, logged at `error`); `gateway` refuses until step 4. stdio, the CLI and the library are unchanged. The refusal is `UNAUTHORIZED`, "The caller could not be identified", with a suggestion naming `http.public_url` and nothing of the reason. The hook reads only `context.credentials`, which AFD's server sets from admitted credentials alone (step 0b's M1), never a header. The principal written stays version 0 until step 2b writes version 1 | Section 4.2's fail-closed rule, as far as this step can apply it |
| 4.4, 1b's note: gateway | "Step 2a adds its `oauth` and `gateway` routers to `no_auth_server.rs`'s `routers()`" | Mode `gateway` refuses to start (with a verifier or without) until step 4, as the brief keeps it. `routers()` gains `oauth` only, probed over its TLS listener; its `Probe::Hosted` credential is made per request from the method and path (a fresh kit token each time for `oauth`), which is the shape a single-use, URL-bound assertion needs. `the_gateway_mode_serves_no_router_until_step_4` holds the refusal; step 4 adds the gateway router with `GatewaySigner::assertion(public_url, method)` per request | No gateway router exists to probe until step 4; the probe is ready for one |
| 2.2, 6.2: `client_auth` | `"none"`, `"ca"` (chain to `client_ca`), `"any"` (self-signed, RFC 8705 binding only) | `none`: no certificate is asked for. `ca`: one is **required**, and the handshake fails unless it chains to `client_ca` within its validity with the `clientAuth` usage (rustls' WebPKI verifier). `any`: one is asked for and **optional**; any certificate that parses as X.509 and whose key the client proves in the handshake is accepted, and it is never trusted as an identity, only bound against `cnf.x5t#S256` | "Binding only" means a client without a certificate still sends unbound tokens, which `require_bound_tokens` refuses at the verifier; requiring one would add no assurance, since nothing vouches for it |
| 6.2: TLS | rustls through `tokio-rustls`, TLS 1.2 and 1.3, the cipher suites of rustls' default `aws-lc-rs` provider | As written, with the `aws-lc-rs` provider passed explicitly rather than read from the process default. Also: **session resumption is off** (no server session cache, no TLS 1.3 tickets), so a client certificate is verified on the connection that uses it and never carried over from an earlier session; ALPN offers `http/1.1` only, so a client that speaks only `h2` fails the handshake; a handshake has 10 seconds and a request's headers 30. The files are read at start, so a missing or invalid one stops the server before it binds; a key file's parser message is never shown or logged (only "cannot be read", "holds no PEM private key" or "is not a valid PEM private key"), and a key that does not match the certificate is refused naming `http.tls.key` | A process-wide provider can be replaced by any crate in the process (step 0b's reasoning); a resumed session would skip the certificate's verification (and its expiry) on the new connection |
| 3.2 rule 11, step 0b: the certificate | "The host's TLS layer inserts `ClientCertificate::from_der(der)`" | The listener inserts it from the end-entity certificate the handshake verified, into every request of that connection, beside the peer address (a crate-private `PeerAddr`). **No header is read for either**: `X-Client-Cert`, `X-SSL-Client-Cert`, `X-Forwarded-Client-Cert`, `X-Forwarded-For` and the like are the caller's to forge. Only the listener (`Host::http_server`, `HttpServer::serve`) serves `[http.tls]` or a hosted mode; `Host::http_router()`, the bare router, refuses both, so TLS and the peer address cannot be skipped by serving the router some other way | The certificate and the address are facts of the connection |
| 6.3: who serves | `axum::serve` (phase 0) | Umbel's own HTTP/1.1 accept loop on hyper, as `axum::serve` is built, with the same graceful shutdown | `axum::serve` cannot put the TLS client certificate in a request's extensions |
| 6.3, layer 2: the body limit | `max_body_bytes` | A request whose `Content-Length` declares more than `http.max_body_bytes`, or cannot be read as a length, is **413 with `Connection: close`** before anything reads the body, so before the per-IP count and any token work. A body without a length is capped as it streams: past the cap the reader behind the layer gets an error, and the answer is 413 whatever that reader made of it. The 413 has no body, as AFD's bearer layer's has none. The limit applies in mode `none` too. AFD's `Authorization::with_max_body_bytes` and `HttpOptions::max_body_bytes` take the same value | A body over the cap never reaches a reader that has no cap of its own |
| 6.3, layer 3; 11; 10.2: the per-IP limit | `ip_requests_per_minute`, keyed on the peer address, counters shared | **At most `n` requests from one peer in any 60-second interval** (a sliding window, not fixed minutes, which would admit `2n` across a boundary): each admitted request is one row of `state/shared/limits.sqlite3`, and a request is admitted only while fewer than `n` rows of its key fall in the last 60 seconds. A refused request writes nothing. The check and the insert are one `BEGIN IMMEDIATE` transaction, so processes behind one URL share one count. The file is WAL, mode 0600 in a 0700 `state/shared/`, `secure_delete` on, schema `user_version` 1 (another version refuses to open); every write purges at most 64 expired rows. **The key** is the socket's peer address: an IPv4 address, an IPv4-mapped IPv6 address as its IPv4 address, and an IPv6 address by its /64. A same-host proxy is one peer, since no forwarded header is read: a deployer behind one raises the limit or limits at the proxy. It applies in hosted modes only (11). Over the limit: 429 with `Retry-After` in whole seconds rounded up and `{"error":"RATE_LIMITED","suggestion":"Too many requests from this address; retry after <n> seconds."}`, naming no limit and no caller. A store held past `store.lock_timeout_ms`: 503 `WORKSPACE_SHARED_TIMEOUT` with `Retry-After: 1` and `details.store`; any other store failure, or a request with no peer address, 500. The 429 body's `error` is AFD's `RATE_LIMITED`, which 10.5 also gives the read-bytes limit: the status says which limit answered | The strictest exact reading of "per minute"; storage is bounded by the requests actually admitted; one host cannot spread its requests over its own IPv6 prefix |
| 4.2, 6.3: the host's own server (review) | The hook fails closed when a layer is missing | In a hosted mode `Host::mcp_server()` itself carries an AFD authorization whose verifier refuses every token and which nothing admits, so the server fails closed however it is served: over HTTP without the listener every method is `UNAUTHORIZED` (M1), `initialize` and `tools/list` included, which the hook never sees; stdio through `serve_stdio` is unaffected; another transport must be marked trusted (the testkit's in-memory stdio driver does). The listener serves a server of its own with the verifier slot's authorization. A build without the `auth` feature has no authorization to attach, so it refuses to seal a host on a hosted workspace (`WORKSPACE_CONFIG_INVALID` naming `auth.mode`) | The review found that an embedder serving `mcp_server()` over HTTP listed every tool to anyone; section 6.3 requires every request to fail closed without layer 5, not only calls |
| 13.2: denial of service at the edge (review) | Unstated | At most 1024 connections are served at once, TLS handshakes included; past that the listener stops accepting, leaving the rest to the operating system's backlog. A request's body has 30 seconds after its headers, else 408 with `Connection: close`, so a client trickling a form body (which AFD's layer reads before the token) cannot hold a connection. A refused body stays refused on every later read. Shutdown gives requests in flight 10 seconds, for embedders as for the CLI. The per-IP check runs one at a time per process, waiting no longer than `store.lock_timeout_ms` for its turn (else the 503), so a flood queues cheaply rather than filling the blocking pool, and a key this process saw refused is answered from memory (at most 4096 keys) until its window admits again, without touching the store; that is exact, since other processes can only add rows. The limit reads the system clock, never a host's injected one, so a frozen replay clock cannot hold every window shut. `state/shared/` and `limits.sqlite3` are narrowed to 0700 and 0600 when wider, and opening the store purges every expired row, so peer addresses do not outlive their window when traffic stops | The review's improvements I1, I2, N1, N4 and N5 |
| 6.3, layer 4: public routes | The metadata routes and `/health` | As written, `/health` answering `{"status":"ok"}` and the metadata served by AFD's bearer layer itself before any token work (M7, `GET` only, 405 with `Allow: GET` otherwise). A path that is neither public nor `http.path` is 404 at this layer, before the bearer layer, so MCP is served at `http.path` only; it reveals nothing the metadata's `resource` does not. Mode `none` keeps its token in front of everything, `/health` and unknown paths included (D32) | The bearer layer serves the metadata itself, so routing to it needs both paths; MCP at any other path would be a second endpoint |
| 3.3: the metadata | The example, with `resource_name` | `resource` is `http.public_url`; `authorization_servers` the issuers whose access tokens are accepted (`access_tokens = true`), in configuration order, never a login-only issuer; `scopes_supported` `["<prefix>:read"]`; `tls_client_certificate_bound_access_tokens` is `auth.require_bound_tokens`; **no `resource_name`**, since no key names the server publicly and the workspace's `name` stays private | "Nothing else is published" |
| 6.3, layer 7: the host check | AFD's host and origin checks | In hosted modes the allowed hosts are `http.allowed_hosts` alone: no loopback name or bound address is implied, as in mode `none`. An empty list, which AFD's server reads as "any host", refuses to start (`http.allowed_hosts`); configuration version 5 already requires the public URL's host in it | A hosted server answers to its public names only |
| 10.5: `WORKSPACE_SHARED_TIMEOUT` | Listed | Added (`src/shared/`), retryable; over HTTP it is the 503 above | The first shared store |
| 1: the crate | `umbel` gains `afd/server-auth`, `tokio-rustls` and `rustls-pki-types`; `reqwest` joins a new default `auth` feature | The default **`auth` feature** is added now, with `afd/server-auth`, `tokio-rustls`, `rustls-pki-types` and `rusqlite` (the shared counters); `reqwest` joins it at step 2b. `hyper`, `hyper-util` and `http-body`, which come with axum, are plain dependencies of the listener. Without `auth` the HTTP surface refuses `[http.tls]` and the hosted modes, naming the feature. `umbel-first-party` enables `auth`; `umbel-testkit-idp` is a dev-dependency of the host | The hosted surface's heavy dependencies stay out of an embedder's build that does not serve it |
| CLI | Unstated | `umbel serve --http --print-token` in a hosted mode is refused before anything is bound (`SERVER_START_FAILED`): the loopback token grants nothing there. The start line says `https` with TLS, and the mode and public URL in a hosted mode | A printed token that grants nothing would mislead |
| 6.1: what stays the doctor's | Unstated for 2a | The key file's permissions, the certificate's expiry and the rest of `auth.tls` stay step 2c's doctor checks; the listener only needs the files to load. The per-token limit (layer 6) is step 3's | Neither is needed to start safely |

## Amendments from step 2b

Step 2b built the host's token verification and the principal it maps to (`src/auth/`: `keys.rs`, `fetch.rs`,
`introspection.rs`, `verifier.rs`, `mapping.rs`, `caller.rs`, `interim.rs`; `src/principal.rs`; `src/access.rs`). It
kept every rule of sections 2.1, 3.2 to 3.4, 4.1 to 4.3, 4.5 to 4.7 and 13.2 that this step reaches, and took the
strictest reading wherever they, or the brief, left a choice. None changes the trust model; each makes a refusal more
likely, never less. An independent security review of the step found two blockers (a client hanging up mid-fetch
spent the minute's one key fetch, so the keys could be kept from ever refreshing; and lifting `oauth`'s refusal would
have served disclosures that later steps close) and six improvements (requests other than calls needed no scope;
introspection unbounded in size and concurrency; tests missing for the memory ownership check, the self-approval
call sites, `as_reader` and the replay clock; a weak canary for the introspection secret; `erase` decided by one
name; the outbound client's proxy and TLS provider left to defaults). All are fixed in the same branch, each with a
regression test that fails without its fix; the rows marked "(review)" record them.

| Section | Was | Now | Why |
| --- | --- | --- | --- |
| 16, 2b and 2c: introspection | Rule 12's verifier in step 2c ("Host: doctor and introspection"); step 0b's amendment named 2c | Step 2b, with the rest of verification. Step 2c is the doctor, `auth-show` and `workspace-show` | `oauth` cannot be lifted while one configured issuer's tokens could not be verified |
| 16, 2a's amendment: serving `oauth` (review) | Refused to start until 2b fills the verifier slot; the hook refused every verified caller | `Host::http_server` builds the host's verifier from `[auth]`, refusing (`WORKSPACE_CONFIG_INVALID` naming the key) when it cannot be built: an introspection issuer whose `client_secret_env` is unset or empty, or no issuer whose access tokens are accepted. The hook now maps verified callers. **A shipped build still refuses to serve `oauth`** (`WORKSPACE_CONFIG_INVALID` naming `auth.mode`) until the disclosure controls exist: 5.4's one answer and 9.4's listings (step 3; today `SPACE_NOT_FOUND` and `SPACE_NOT_READABLE` differ, and `space-list` lists every space), the exact filtering of 9.1 to 9.3 (step 7; hidden counts and positions), and `workspace-show`'s hosted answer (step 2c; today it names the workspace, its path and every space, and says the principals are unverified). The step that closes the last of them lifts the refusal. The `testkit` seam `HostBuilder::with_unfinished_oauth` serves it for tests; `with_token_verifier` stays a `testkit` seam whose verifier maps no caller, so the hook refuses everyone it admits | The review: a verified caller would otherwise learn which spaces exist and what they hold. 2b's own conditions for serving hold; the phase's do not yet |
| 3.2 rule 2: routing | A JWS by `iss` among the `jwt` issuers, anything else to the introspection issuer | As written, with AFD's `JwtVerifier` holding only the issuers with `verify = "jwt"` and `access_tokens = true`: a JWS naming a login-only issuer or the introspection issuer is `unknown-issuer`, and with only an introspection issuer every JWS is. A token is never sent to an issuer that did not issue it; `auth_tokens.rs` counts the kit's hits to prove it | Rule 2, held by the verifier's construction |
| 3.2, 3.3: the clock | Unstated | Verification and the key and introspection caches read the **system clock**, never `HostBuilder::with_clock`'s, so a replay clock cannot keep an expired token or key alive (step 2a's reasoning for the limits). The `testkit` seams `with_auth_clock`, `with_auth_root_certificate` and `with_auth_fetch_timeout` change the clock, the trusted roots and the timeout for tests only | A test or replay clock is not a security boundary |
| 3.3: discovery | RFC 8414 inserted, OIDC inserted, OIDC appended; `issuer` must match | **Only a 404 moves on** to the next location. Any other status, a redirect, a body over 1 MiB, a body that is not one JSON object, a time-out, a document whose `issuer` differs, or one without an `https` `jwks_uri` ends the discovery, and the token is `unavailable`. Without a path the two OIDC forms are one URL. Discovery is lazy: the first token of an issuer fetches its keys | Falling through on an error would let whoever controls one location choose the document; the doctor (2c) checks reachability at start |
| 3.3: caps | 1 MiB and 10-second caps | 1 MiB per body (refused on a `Content-Length` over it before reading, and while streaming), **10 seconds for a whole fetch**, metadata and key set together, and 10 for each request in it; HTTPS only (`reqwest`'s `https_only`, and each URL checked before use), no redirect, the platform's roots through `rustls-platform-verifier` on the `aws-lc-rs` provider passed explicitly, and (review) no proxy, an environment's `HTTPS_PROXY` included | The strictest reading of "10-second caps" |
| 3.3: the key set | "The key with that `kid`" | Keys without a non-empty string `kid` are left out (no token can name them); **two keys with one `kid` make the whole set unusable** (`unavailable`), since a token could not say which it means; a key that is not an object makes it unusable too | No ambiguity in which key verifies |
| 3.3, 13.2: a fetch outlives its caller (review) | Unstated | Every key fetch, and the introspection endpoint's discovery, runs on a task of its own that holds the issuer's lock and stores its result whether or not the request that started it still waits. A client that disconnects mid-fetch cannot spend the minute's one fetch and leave the cache empty | Otherwise one made-up `kid` a minute, its connection dropped, kept an issuer's keys from ever refreshing: the refetch limit itself became the denial of service |
| 3.3: the cache and refetching | 5 minutes to 24 hours; at most one refetch a minute per issuer on an unknown `kid`; the last good keys kept until their cache ends | The cache lasts the key set response's `max-age`, bounded to 5 minutes to 24 hours; without one, or with `no-store` or `no-cache`, 5 minutes. **At most one fetch a minute per issuer, whatever asks for it** (an unknown `kid`, the cache ending, the first token), counting failed fetches, one at a time; a clock that moved back counts as within the minute. A failed refetch keeps the last good keys until their cache ends; after that every token of the issuer is refused (`unavailable`) until a fetch succeeds | A dead issuer is asked once a minute, not once per request, and an expired key set is never trusted |
| 3.2 rule 12: introspection | Umbel's client credentials; the response cached by the token's SHA-256 until the earlier of `exp` and 60 seconds | The endpoint is the verified metadata's `introspection_endpoint` (`https`), found and cached as the key set's metadata is (5 minutes to 24 hours, one discovery a minute). Umbel authenticates with `client_secret_basic` (RFC 6749 2.3.1's form-encoding) and sends `token_type_hint=access_token`. **Only an accepted answer is cached**, at most 4096, in memory; each use checks it again with AFD's `check_introspection` at the current time and against the request's own certificate, and a refusal on reuse leaves the entry for the requests that present the bound certificate. A refused answer, a failed request and an endpoint that redirects or times out are never cached (`unavailable` or the answer's rule). (review) A token over 4096 bytes is `token-malformed` and sent nowhere, and at most 32 introspection requests are in flight at once; past that a token is `unavailable` at once, never queued | A revoked token outlives its revocation by at most the minute 3.2 allows, and a binding is checked per request |
| 4.1, 4.2: where mapping happens | The hook maps `Credentials` | AFD's `Credentials` carry no subject claim other than `sub`, no `act` and no group claims, so the **host's verifier maps** each verified token to a caller and leaves it in a per-request `CallerSlot` that the HTTP surface inserts into every request's extensions before AFD's bearer layer. The hook trusts the slot only when the caller's credentials **equal the ones AFD admitted** for the request; otherwise (no credentials, no slot, an empty slot, another's credentials) it refuses with `UNAUTHORIZED`. A token that cannot be mapped is refused at the bearer layer as `claims`, and Umbel logs its own reason (`subject-claim` or `act-chain`, target `umbel::auth`), never a value | Nothing runs for a token the host could not name, and the extension is trusted only as far as AFD's admission |
| 4.1: subjects and services | A person's `subject_claim`; a service by `sub == client_id`, `services.clients` or `services.claim` with its exact value | Only a person token needs its `subject_claim`, held to AFD's rule for `sub` (a string of 1 to 255 characters, no control character). `sub == client_id` reads `sub` itself, whatever `subject_claim` names. The services claim matches **only a string equal to the value**; an array holding it does not | A service is never inferred from a claim the deployer did not configure exactly |
| 4.3: `act` | The RFC 8693 chain, each entry mapped as a client | From an `act` issuer the chain **replaces** `[client]`, outermost first, each entry `agent:<ns>/<mapped act.sub>`. An `act` that is not an object, an entry without a valid `sub`, an `iss` other than the token's issuer, or a chain longer than 8 refuses the token (`claims`, `act-chain`). From any other issuer `act` is ignored, logged at `info` with the alias | An actor of another issuer has no id in this namespace, and a chain the host would have to cut is not recorded at all |
| 4.5: claim groups | Members from one issuer's claim, unioned, no longer than the token | Computed at verification, carried in the host-owned `CommandContext.extra["dev.umbel/claim-groups"]`, which the hook **always sets** (`[]` for every caller but a verified one) so no caller can, and read by every reader filter (`readers` and group tokens). A string claim, or an array of strings, must hold the value exactly. A reader filter for another principal (`as_reader`) gets none | The token's groups reach exactly the request that carried it |
| 2.1: principal version 1 | "The hook sets version 1 in every mode" | Every surface writes version 1: the CLI, the library, stdio and loopback with the `null` fields of step 1's amendment. **`humanPresent` stays `null` everywhere until step 5**: the CLI's terminal check remains the `dev.umbel/human-present` mark, and step 5 sets `humanPresent` with envelope version 3's assurance. `policyVersion` is `sha256:` and the hex SHA-256 of the canonical JSON (members sorted, no whitespace) of `{"access": ..., "auth": ...}`, each table as read or `null` (`Config::policy_version`). `spaces` lists, per space the caller may read (equivalents and claim groups included), the verbs **all** its Umbel scopes grant there, qualified ones too | A principal never claims a person it did not prove; `spaces` describes the grant, which the interim rule below may still refuse |
| 5.2, 5.3, 5.4 until step 3: authorising a verified call | Step 3's resolver and gate; owner decision 2's narrowing | The brief's "refuse what 2b cannot decide": AFD's resolver slot holds `InterimScopes`, which decides on **unqualified scopes only**. Every call needs `<prefix>:read`; a mutating command also `write`; an approval policy or host-verified confirmation also `approve`; `memory-erase`, and (review) any command whose name ends in `-erase`, also `erase`; a command's static `scopes` too; unknown, unexposed and meta-tool names `read` alone. (review) `<prefix>:read` is also AFD's required scope, so **every request** needs it itself, the listings, resources, the Skills methods and `server/discover` included, which no resolver sees; a token with only `write` is refused too, stricter than 5.1's implication. A token holding only space-qualified scopes is refused, 403 and `INSUFFICIENT_SCOPE` naming the unqualified scopes and never a space; listings are filtered by the same rule. An admitted token's unqualified verb grants every space, so owner decision 2's narrowing leaves the person's filter whole, as 5.3 says. **Still step 3's:** space-qualified scopes, 5.4's one answer, 9.4's listings and `Caller` in `reader_filter`; until they exist a shipped build does not serve `oauth` (above) | Never wider than section 5; stricter where 2b cannot decide |
| 4.6: equivalents | Every principal comparison consults them | Consulted now by the host's comparisons: a space's `readers`, group `members` and the `principal:` tokens of every reader filter (`src/access.rs::identities`), the memory services' `MEMORY_NOT_OWNED`, and, through the SDK's new `CallContext::equivalents` (the legacy principals the caller's effective principal stands for; filled for compiled plugins, empty for components and mounts), the knowledge plugin's self-approval check (D102), whose approvers already match through the reader tokens. **Not yet:** the memory plugin's own comparisons (`memory-confirm`'s own-records rule, status, export, filters), which only widen what a person reaches and stay narrower until step 10, and cursor files, which step 7 rewrites | The deny-side comparison (self-approval) is closed now; the allow-side ones fail safe until the steps whose tests section 14 assigns them |
| 4.6: tests of each comparison (review) | Unstated | `memory_grants.rs` holds the ownership check through equivalents (an agent for `corp/ada` changes `ada`'s private record; another's readable record is `MEMORY_NOT_OWNED`; one way); the knowledge plugin's two self-approval call sites go through one helper, `caller_wrote`, unit-tested with a caller whose `CallContext` carries the equivalent and one whose does not; `access.rs` holds that a read as another principal (`as_reader`) gets no claim groups; `auth_tokens.rs` holds that a host on a frozen `with_clock` still verifies on the system clock | Each check fails a test without it |
| 4.7: operators | Only the CLI | Unchanged in 2b: a verified caller whose person is the operator's `local_id` is still `verified` over `http`, never an operator | Mapping needs nothing more |
| 3.2: never passed on | The token dropped at the layer | Also: the host's verifier holds the token only while verifying (the introspection cache keys on its SHA-256); `VerifiedCaller`'s `Debug` redacts every identifier but the issuer alias and namespace; `token_canary.rs` checks a canary JWT, its parts and its `jti`, and an opaque canary, against every log line at `TRACE`, every answer and error, every file of the workspace, the command's context and its `Debug`, AFD's credentials as a command sees them, and a mounted server's request headers and answers; (review) and a distinctive introspection client secret, given through the `testkit` seam `with_auth_secret`, against the same sinks and the HTTP surface's `Debug` | 13.2's "a token in a URL or log" |

## Amendments from step 2c

Step 2c built the doctor's hosted profile, `auth-show`, `workspace-show`'s hosted answer and each issuer's `ca_file`
(`src/auth/doctor.rs`, `src/auth/files.rs`, `src/auth/fetch.rs`, `src/commands/auth_show.rs`,
`src/commands/workspace_show.rs`, `src/commands/workspace_doctor.rs`, `src/doctor.rs`). It kept every rule of sections
6.1, 6.2, 10.3, 10.4 and 13.2 that this step reaches, and the two follow-ups settled on 2026-11-08, and took the
strictest reading wherever they, or the brief, left a choice. None changes the trust model; each makes a refusal or a
finding more likely, never less. It does not lift the refusal to serve `oauth` (amendment from step 2b), which waits for
steps 3 and 7. No plugin crate changed. An independent security review of the step found one blocker (the identity
checks read the RFC 8414 document where an OpenID Connect provider's discovery document says otherwise), eight
improvements (a `ca_file` root expiring after start stayed trusted; the doctor gave an issuer two time limits where the
verifier gives one; file owners and directories unchecked; unbounded file reads; the operator test without the CLI
interface; the doctor's gate following only the sealed configuration; missing tests; a login-only issuer's `ca_file`
for step 5) and four nits. All are fixed in the same branch, each with a regression test that fails without its fix
where one can be written, and the rows marked "(review)" record them.

| Section | Was | Now | Why |
| --- | --- | --- | --- |
| 6.1: where and when the checks run | "The doctor's `auth.*` checks, which apply whenever `auth.mode` is not `none`" | In section 6.1's order right after `http.config`, with `auth.ca_files` (below) before `auth.issuers`, in `umbel workspace doctor` and in the doctor of a workspace that does not seal alike. They ask the issuers concurrently, on a thread and Tokio runtime of their own, through the verifier's own client (3.3's discovery order, HTTPS only, no redirect, 1 MiB, the time limit, the issuer's `ca_file`). In mode `none` none run, except `auth.tls` when `[http.tls]` is set. A hosted configuration that does not open skips all of them (`skip`, "needs a readable umbel.toml"). A build without the `auth` feature fails `auth.mode` and skips the rest | A key file is a key file in any mode; the doctor must ask an issuer exactly as the verifier will |
| 6.1, 4.7: who may run the doctor | Unstated; `workspace-doctor` was exposed everywhere but the palette | **In a hosted mode `workspace-doctor` is the operator's.** It is registered for the CLI alone (not MCP, not agents), so MCP neither lists nor serves it, stdio included, and its handler refuses any caller but the CLI's (the CLI interface, transport `cli` and authentication `process`, as `authority::cli_mark` requires them; (review) a forged CLI principal without the interface is refused) with `COMMAND_NOT_EXPOSED`, the library included. (review) The handler counts a workspace as hosted when the sealed configuration is, or when `umbel.toml` on disk now asks for a hosted mode, since the report reads the file. Mode `none` is unchanged | The report names the workspace's path, its files, its issuers, the variables holding its secrets and its operator, and running it makes the host ask every issuer: no remote caller may learn the one or trigger the other |
| 6.1: `auth.mode` | `oauth` with no issuer; `gateway` without `[auth.gateway]` | As written (both are refused at open too), and a **warning** while this build does not serve the mode over HTTP: `oauth` until steps 3 and 7 (amendment from step 2b), `gateway` until step 4. The `testkit` seam `with_unfinished_oauth` clears the `oauth` warning | The doctor must not call ready a deployment whose `umbel serve --http` refuses to start; stdio and the CLI still work, so it is not a failure |
| 6.1: `auth.public_url` | Not HTTPS, a host not allowed, another path | 2.2's rule again (`check_public_url`), naming the URL. It cannot fail on a configuration that opens; it stays so that a later change to the rules at open cannot pass unnoticed | The table's row, kept as defence in depth |
| 6.1: `auth.tls` | A non-loopback bind without TLS; a key readable by group or other; a certificate expired (fail) or within 14 days (warn) | **Every** certificate of `http.tls.cert` and `http.tls.client_ca` is read (`x509-parser`, validity only): any expired or not yet valid fails, any within 14 days warns, naming the date. The key fails when readable **or writable** by group or other (mode `& 077`); the certificate, the client CA and the gateway's pinned `keys` fail when writable by group or other (`& 022`). With no problem found, the listener's own loading runs, so a key that is not the certificate's, or a CA that cannot be an anchor, fails. The gateway's `keys` (step 1's amendment puts it here) must be a JWKS with a usable key. A loopback bind without TLS passes and says what a proxy needs (6.2). A key file's contents and its parser's account of them are never shown. (review) Every file is read only when it is a regular file (through links) of at most 1 MiB, by the doctor and by the listener at start alike, so a FIFO or a device never hangs either; on Unix each must also be owned by the user the host runs as, or by root, and sit in a directory (as named and as resolved) that group and other cannot write unless it is sticky; a platform without Unix permissions warns that they are not checked | Whoever can write a trust file, or replace it by a rename, chooses whom the host trusts; an expired intermediate breaks the chain as surely as an expired leaf |
| 2.2, 3.3, follow-up of 2026-11-08: `ca_file` | Settled: each issuer may name its own roots | **`[auth.issuers.<alias>] ca_file`**, a configuration version 5 key under 2.2's file-path rules (`$defs/filePath` in `workspace-config.v5.json`). The verifier gives such an issuer a client of its own that trusts **exactly** the file's roots (rustls' WebPKI verifier on the `aws-lc-rs` provider passed explicitly): never the platform's, never the test seam's extra roots, and never another issuer's. Every other issuer keeps the platform's client. `Host::http_server` refuses to start (`WORKSPACE_CONFIG_INVALID`, `details.key` `auth.issuers.<alias>.ca_file`) when the file cannot be read, holds no PEM certificate, or holds one that is not X.509, is expired or is not yet valid on the verification clock. (review) The client also refuses every handshake outside the window in which all of the file's roots are valid (`fetch::RootsInDate`), so a root that expires while the process runs stops being trusted then. The roots are read at start, so a renewed file needs a restart. Step 2c loads a `ca_file` for the issuers whose tokens the verifier accepts; the doctor checks every issuer's | WebPKI never checks a trust anchor's own validity, so an expired private root would otherwise be trusted for as long as the process runs |
| 6.1, the same follow-up: `auth.ca_files` | "The doctor checks the file in step 2c" | A check of its own, before `auth.issuers`: each `ca_file` exists, is not writable by group or other, holds at least one PEM certificate, each X.509, none expired or not yet valid (fail), any within 14 days (warn). It names the issuer each file alone serves | The file decides whom the host trusts for its issuer |
| 6.1: `auth.issuers` | Metadata unreachable or with a different `issuer` | Every issuer, login-only ones included, is discovered as 3.3 says, (review) with one time limit for the metadata and the key set together, as the verifier's fetch has (the introspection endpoint's discovery and its call one each, as the verifier's); a `jwt` issuer's key set must be fetchable and usable (keys with unique `kid`s, at least one) and hold a key that fits at least one of its `algorithms` (3.2 rule 4's fit), and an algorithm no key fits warns. The introspection issuer's metadata must name an `https` `introspection_endpoint`, which the doctor calls with Umbel's client credentials (`client_secret_basic`) and a token it makes up, expecting `{"active": false}`: a refusal of the credentials fails, and so does an endpoint that calls the made-up token active. With the secret unset it calls nothing. A message names the rule code, never a value from the remote document | The brief's "the key set; the introspection endpoint and credentials present", read as "work", not only "configured"; no caller's token ever leaves the host |
| 6.1, 4.1: `auth.subjects` | Fails unless an OIDC issuer's `subject_types_supported` contains `public`, or `subject_claim` is not `sub` | For every issuer, and every person login, whose subject claim is `sub`, (review) judged by the issuer's OpenID Connect discovery document whenever it publishes one (path inserted, then appended, only a 404 moving on, its `issuer` this one), else its RFC 8414 metadata: fails when `subject_types_supported` lacks `public` or is not a list, when an OpenID Connect document omits it (that document must publish it), and when the metadata cannot be read; **warns** only when there is no OpenID Connect document and the RFC 8414 one publishes none (an access-token `sub` may be pairwise, as Microsoft Entra's is). Each namespace with two or more issuers is printed as the deployer's assertion, which never changes the status | "Prints it", as 4.1 says; an unconfirmable claim is not a pass |
| 6.1: `auth.services` | An issuer with neither `services.clients` nor `services.claim` (warn) | As written, for issuers whose access tokens are accepted; a login-only issuer issues none | Nothing to mark there |
| 6.1, 4.6: `auth.principals` | `local_id` not namespaced; a `readers`, approver or member entry no namespace or equivalent can produce | Also `principal.on_behalf_of`. The entries are every principal the configuration grants something to: space `readers`, collection `access`, group `members`, `usage.readers`, the `memory_write` grants' `writers`, `editors` and `erasers`, and an area's `approvers` at `[plugins.<id>.config.areas.<area>]` (the knowledge plugin's documented place, read for any instance). An entry passes when a namespace produces it or it is a `[principal.equivalents]` source; `*`, `space` and group entries pass, a group by its members | The strictest reading of "readers, approver or member": every grant that names a principal |
| 6.1, 7.1: `auth.person` | Fails on empty `acr_values` or `uv_amr`, on `acr_values_supported` "without a configured class", on `claims_supported` without `acr` or `amr`; warns on an `approve_over_mcp` area or a `person.mcp` command with callers in a namespace with no login | (review) The provider's OpenID Connect discovery document is read whenever it publishes one, as the person page, an OpenID Connect relying party, will. "Without a configured class" is read as lacking **any** configured class (fail). A provider that publishes neither member **warns** (it cannot be confirmed before a login; step 5's person page checks every ID token). A provider whose metadata cannot be read fails. The `person.mcp` warning needs the loaded plugins, so only `umbel workspace doctor` on a sealed host gives it; the `approve_over_mcp` half waits for step 6, which adds the key. "While it fails, that namespace's verified commands are not served": until step 5 no `person.mcp` command is served over MCP at all (step 1's amendment), so section 14's `doctor_auth.rs` row holds the check, and step 5 wires its per-namespace outcome into serving (a follow-up) | The strictest of the two readings; owner decision 6 makes user verification mandatory |
| 6.1, 10.4: `auth.secrets` | A `*_env` variable unset | Unset **or empty**, for the person logins' and the introspection client's secrets and every enabled instance's `bearer_env` (10.4 puts a mount's bearer under the same rule). Each is named by its variable and its key, never by a value. The `testkit` seam `with_auth_secret` stands in for the environment | An empty variable is no secret |
| 6.1, D29: `auth.shared` | `state/shared/` not writable, or not on a local file system | Writability as `state.writable` probes it (the directory, or its nearest existing ancestor). The file system's type from `statfs` (Linux `f_type`, macOS `f_fstypename`): NFS, SMB and CIFS, AFP, WebDAV, Coda, AFS, 9P, Ceph, Lustre, GFS2, OCFS2 and FUSE (which may be remote) fail; a platform whose type is not read warns that it cannot tell | SQLite's WAL shares memory between the processes of one machine (D29) |
| 6.1: `auth.confirmations` | `mcp.confirmations = "enforce"` fails | As written; `require-human` and `off` pass. The default is `enforce`, so a hosted workspace must set it | 6.1's reasoning |
| 10.3: `auth-show` | "A host built-in, `inspect`, exposed everywhere. It returns only the caller's own projection: principal, namespace, issuer, authentication, scopes, spaces with verbs, `delegationChain` and token expiry" | Exactly eight members: `principal` (the actor: `kind`, `id`, `onBehalfOf`), `namespace`, `issuer`, `authentication`, `scopes`, `spaces` (the spaces the caller reads, with the verbs its scopes grant there), `delegationChain` and `tokenExpiresAt` (ISO 8601 UTC with milliseconds, from the credentials AFD admitted for the request); `null` where no token narrows the caller. It takes no input, so it can describe no one else; a call no surface prepared is `UNAUTHORIZED`. "Everywhere" is MCP, agents and the CLI, the palette off, as for every host built-in. It never shows the token or any other credential (the subject or client id as the issuer wrote them, `auth_time`, `acr`, the certificate's thumbprint), the claim groups, `transport`, `tokenBinding`, `policyVersion`, `policyDecision`, or anything of the configuration. Until step 3 it needs `<prefix>:read`, as every call does under step 2b's interim rule | The list, read as exhaustive |
| 6.1, 9.4, 4.7: `workspace-show`'s hosted answer | `access` becomes `{ "principals": "verified", "exact": ["library", "http"], "statistics": "per-filter" }` in hosted modes; 9.4 lists only the spaces the caller reads | In a hosted mode, to every caller but the operator (stdio and the library included, 4.7): `name` and `workspace` are `null`; `spaces` lists only the spaces the caller reads (a verified caller: its principal's `spaces`, the ones it reads and its token grants a verb in; any other caller: those its effective principal and claim groups read); `defaultSpace` is `null` unless it is one of them; `plugins` lists only the instances serving one of them, and (review) `surfaces.firstClassTools` only the tools that are no plugin's or whose plugin serves one of them; `profile`, `host` and `versions` stay. `access` is `{ "principals": "verified", "exact": ["library", "http"], "statistics": "shared" }` until step 7 makes the statistics per filter and the value `"per-filter"`. The operator gets the whole answer, with the hosted `access`. Mode `none` is unchanged | Step 2b's review blocker 2; the answer never claims what step 7 has not built |
| 16, 2b's amendment: serving `oauth` | Refused until the disclosure controls of steps 2c, 3 and 7 exist | 2c's control is in, and the refusal stays (settled 2026-11-08: it lifts only once 2c, 3 and 7 have all landed). Its message now names step 3 (5.4's one answer, 9.4's listings, and the plugin listings that name spaces: `plugin-list`, `plugin-show` and `skill-list` list every instance, its spaces and its packs per space to any caller, which this step found) and step 7 (hidden counts and positions) | Recorded, not lifted |
| 1: the crate | The host's third-party dependencies | `x509-parser` 0.18 (no default features: certificate validity only) and `rustix` 1 (`fs`: `statfs`) join the `auth` feature; both were already in the lock. `umbel-testkit-idp` gains `TestCa::valid_between` (a CA and every certificate it issues over a chosen window) and `TestIdp::start_with_ca` (the kit over such a CA, for an expired server certificate) | The doctor's expiry and file system checks, without unsafe code |

## Amendments from step 3

Step 3 built the host's scopes, access, shared state and limits (`src/auth/scopes.rs`, `scope_gate.rs` and
`caller.rs`; `src/access.rs`; `src/middleware.rs`; `src/shared/nonces.rs`, `read_limit.rs` and `limits.rs`;
`src/surfaces/http.rs` with `http/layers.rs` and `http/listener.rs`; the `space-list`, `plugin-list`, `plugin-show`
and `skill-list` built-ins; `http.trusted_proxies` in configuration version 5 and its doctor check). It kept every
rule of sections 3.3, 4.3, 5, 9.4, 10.1, 10.2, 10.5, 11 and 13.2 that this step reaches, and AFD's M6 (the 403
before dispatch, `Defer`, `visible`, and the check at execution on validated input), and closed the follow-ups
of steps 2a, 2b and 2c that it owns. It took the strictest reading wherever they, or the brief, left a choice.
None changes the trust model; each makes a refusal more likely, never less. It does not lift the refusal to serve
`oauth`, which now waits for step 7 alone. No plugin crate changed. A mutation run removed each security check in
turn, and a test failed for every one but the resolver's own token-grant test, which `Caller::reads` already
implies (kept as defence in depth for a call whose caller is unknown). An independent security review of the step
found one blocker (a `spaces` member on a command that declares only `space`, or a stray space member on a plugin
command that declares neither, named spaces the scope rules never looked at) and six improvements (a hidden
instance revealed by calling its commands; a withheld grant's `note` naming spaces; mode `none` and the operator
depending on `state/shared/`; a failed spend answered as a spent token; the resolver's caller lookup scanning
every request in flight; counter names that a dictionary could reverse), with six nits. All are fixed in the same
branch, each with a regression test that fails without its fix, and the rows marked "(review)" record them.

| Section | Was | Now | Why |
| --- | --- | --- | --- |
| 16, 2b's amendment: serving `oauth` | Refused until 2c, 3 and 7 have all landed | 3's controls are in; the refusal stays (`WORKSPACE_CONFIG_INVALID` naming `auth.mode`), its message and the doctor's `auth.mode` warning now naming step 7 (the exact filtering of 9.1 to 9.3) alone | Settled 2026-11-08: it lifts only once 2c, 3 and 7 have all landed |
| 5.2, 2b's interim rule | Unqualified scopes only; every request needs `<prefix>:read` itself | Removed (`src/auth/interim.rs`). Umbel's `ScopeResolver` (`UmbelScopes`) and the scope gate share one policy (`ScopePolicy`), fixed at seal over the registered commands. AFD's `requiredScopes` are no longer set | Section 5.2, as the step brief asks |
| 5.2: where a call runs | "The `space` or `spaces` input, else the default" | Every command runs in the spaces of its `space` or `spaces` input, as the host resolves them, else in the default space; a plugin command without a space input, and **an embedder's command** without one, in the default space (where its mutation's event goes). Space-less: a host built-in without a space input (`workspace-show`, `space-list`, `auth-show`, `plugin-list`, `plugin-show`, `skill-list` and the CLI-only ones; the table's list read as examples), AFD's meta-tools and bootstrap commands, and `afd-context-*` (every name starting `afd-` that no plugin owns) | "Else the default" read literally; the event stamp already puts such a command's events in the default space |
| 5.2: the verbs in each space | `read`; `write` for a mutating effect; `approve` for `require-human` or an approval policy; `erase` for `memory-erase` | As written, with `approve` also for a host-verified confirmation, and `erase` for `memory-erase` and any command whose name ends in `-erase` (2b's reading, kept until step 10). A pipeline adds every step's verbs and unqualified needs. A command's static `scopes` are needed exactly | A pipeline runs its steps in its own spaces |
| 5.2: space-less commands | "Any Umbel scope"; a space-less `external` command (a mount without `bind_space`) needs unqualified `write` | Any Umbel scope, plus, unqualified, every verb beyond `read` the command would need (a mutating space-less built-in, all CLI-only today, needs `write`). **Every** mounted tool without `bind_space` needs unqualified `write`, whatever its declared effects (the parenthetical defines the row), beside its default space's needs | The strictest reading of the row |
| 5.2, 3.3: a token with no Umbel scope | `<prefix>:read` as AFD's required scope (2b) | Every request is 403 `insufficient_scope` naming `<prefix>:read`: a `tools/call` through the resolver, every other method (listings, resources, the Skills methods, `server/discover`, `initialize`) at layer 6's token gate (`layers::TokenGate`). A scope naming a space nobody declared is an Umbel scope: this rule reads a scope's text alone, so it says nothing of which spaces exist | 5.2's "any Umbel scope" for everything that names no space; deciding it on declared spaces would be an existence oracle |
| 5.4, 3.3: what the resolver answers | `Defer` for an unreadable space; `Missing` otherwise | `Missing` only when **every** space of the call is one the token grants a verb in and the caller may read; otherwise `Defer`, so the registry answers (the access check precedes the scope gate, so a call with any such space gets `SPACE_NOT_READABLE`). A malformed `space` or `spaces` input defers too. Missing scopes are named in order: unqualified ones, then each space's in 5.1's verb order, then static ones | Readability before scope, for a call over several spaces as for one |
| 3.3: how the resolver knows the caller | AFD gives the resolver credentials alone | The HTTP surface enters every request's caller slot in an in-flight `CallerBook` before AFD's bearer layer and leaves it when the request is answered; (review) a filled slot is indexed by its credentials' issuer, subject and client, so a lookup reads only the requests in flight for that caller. The resolver finds the caller mapped for exactly the credentials it is asked about; when there is none (a task's later work), or two in-flight requests hold equal credentials mapped to callers that differ, it decides on the token alone: `Defer` where readability would matter, and `visible` is `false`. The scope gate, which always has its caller, then answers exactly | Readability needs the effective principal, equivalents and claim groups, which `Credentials` do not carry (a `subject_claim` other than `sub`, the claim groups) |
| 3.3: `visible` | Filters `tools/list` and `afd-discover` | True when the token holds an Umbel scope and some call of the command could be allowed in a space the caller reads and the token grants (a plugin command's candidates are its instance's spaces, any other's the declared spaces or the default one), or, for a space-less command, when the token holds its unqualified and static needs. It depends on nothing about spaces the caller cannot read | A listing must not tell which spaces exist |
| 5.2, 6.3: the scope gate | "Repeats the check inside the registry for in-process and stdio-bridged calls" | A registry middleware after the space and access checks, before the read limit and the plugin gate. It decides every call narrowed by a token (a verified or gateway principal's `scopes`, else AFD's credentials on the context) by the same policy, on the validated input; a call no token narrows passes. `INSUFFICIENT_SCOPE` with `details.scopes`, worded as AFD's | One rule, wherever the call came from |
| 5.4: the one answer | `SPACE_NOT_READABLE`, "The space does not exist or you may not read it" | Exactly that message, one fixed suggestion, no details and **no space named** (the default space is resolved for a caller who named none). Every hosted caller but the operator gets it, stdio and the library included (4.7); the operator keeps `SPACE_NOT_FOUND` and the named `SPACE_NOT_READABLE`. **Mode `none` is unchanged**, as section 14's point 10 requires of stdio and the CLI | Byte-identical answers; 4.7's operator |
| 5.4: where it is given | The space check maps `SPACE_NOT_FOUND` | The space check maps it; a new access check (after it) refuses a space the caller may not read or its token grants no verb in, for a plugin command and every command with a space input (`event-ack`, which reads no store, included), for every hosted caller but the operator and every caller a token narrows, so readability comes before the scope gate and before the plugin gate's `PLUGIN_NOT_ENABLED`, whose message then lists only the instance's spaces the caller reads (the plugin gate keeps its own order for mode `none` and the operator); the space check leaves the one answer without `dev.umbel/space` (it set it for a declared space, which this step's own byte comparison caught); `Workspace::resolve_spaces` checks a list's shape (repeats) before any entry's existence, in every mode (so in mode `none` `["ghost","ghost"]` is now `VALIDATION_ERROR`, not `SPACE_NOT_FOUND`, a change of precedence only between two refusals); and a plugin's `events` grant answers a `space` argument the caller may not read, or that is not declared, with the one answer before the instance's spaces are consulted. An embedder's command without a space input is checked by the scope gate (its default space) only for callers a token narrows, so mode `none` is unchanged | Every path that could tell the two apart |
| 5.2, 5.4: one reading of a call's spaces (review) | The host and the scope rules each read `space` and `spaces` | The space check refuses, with `VALIDATION_ERROR` and before anything reads it, in every mode: `spaces` on a command that declares only `space`, `space` on one that declares only `spaces`, and either on a compiled or component plugin command that declares neither (not a pipeline, whose steps each meet every check on their own input). A mounted tool's own arguments are the server's and are left alone (a `bind_space` tool still refuses `spaces`). So the spaces the scope rules decide are the spaces the access check, the plugin gate and a plugin's host services use | The review's blocker: `{"spaces": ["alpha"]}` on a space-only mutation was decided on the default space while the plugin's store writes reached `alpha` |
| 9.4: a hidden instance (review) | Its listings hide it | To a hosted caller a token narrows, a plugin command whose instance serves no space the caller reads does not exist: a new hidden-instance check, the first host middleware after the event stamp, answers its call exactly as AFD answers an unknown name (`COMMAND_NOT_FOUND`, the same suggestion over the caller's own visible commands), before the space, access and scope checks; the resolver decides it as an unknown name (any Umbel scope), so no 403 names its needs. AFD validates input before any middleware, so an invalid input still gets `VALIDATION_ERROR` (a follow-up for AFD). stdio and the library list every tool, so the check is for token-narrowed callers only | Calling a hidden command otherwise answered `PLUGIN_NOT_ENABLED` with an empty list, or a 403 |
| 9.4: `plugin-show`'s grants (review) | A withheld grant shows its `note` | Not to a hosted caller who is not the operator: the loader's notes can name a space | The review's second improvement |
| 5.3, 5.4: `Caller` | `reader_filter(config, space, &Caller)` carrying the principal, equivalents and granted spaces | `access::Caller`: the effective principal and the legacy principals it stands for, the claim groups, a `Narrowing` (`None`, or the token's Umbel scopes), and whether it is the operator; `Caller::reads` is readers-and-narrowing. Every reader filter is built from one: the plugin gate, the store services (`as_reader` keeps the call's narrowing and drops the claim groups), `event-list` and the `events` grant, the `store-*` built-ins | A scope never makes an unreadable space readable, on any path. (review) `Caller` also carries the token's scopes as sent, from the same source as its narrowing, for static `scopes` |
| 9.4, follow-up of 2c: listings | `space-list` and `workspace-show` list only readable spaces; the plugin listings were step 3's | For every hosted caller but the operator: `space-list` lists the spaces the caller reads and its token grants a verb in; `plugin-list` the instances serving one of them, without a failed instance's `error`; `plugin-show` answers an instance serving none of them exactly as one that does not exist (`PLUGIN_NOT_FOUND`), and otherwise shows only those spaces, in `spaces` and in each pack's per-space states, without `error`; `skill-list` the skills of the instances it lists. A listed space's `events` and `head` still count every event until step 7. The MCP Skills extension names skills only, never an instance or space, and is unchanged | Closes 2c's follow-up |
| 10.2: the nonce store | Approval nonces, relay evidence, gateway `jti`s and spent decisions in `nonces.sqlite3`, `INSERT ... ON CONFLICT DO NOTHING` with `changes() == 1`; rows expire, writes purge at most 64 | As written (`src/shared/nonces.rs`): WAL, mode 0600 in a 0700 `state/shared/`, `secure_delete`, `user_version` 1, one `BEGIN IMMEDIATE` per spend; a row holds the key and two times, kept from the spend until its expiry and at most 31 days; a spent key stays spent while its row exists; empty keys and keys over 512 bytes are never spent; opened on first use, waiting up to `store.lock_timeout_ms` while other processes open it; the system clock. In hosted modes AFD's approval middleware spends approval nonces and `relay:<decisionId>` there under the prefix `afd:` (`SharedApprovalNonces`; the gateway uses `gateway:` and the person page `person:`). A failure spends nothing and refuses the approval, (review) answered as the store's failure, `WORKSPACE_SHARED_TIMEOUT` (retryable, `details.store`) for a lock wait and `INTERNAL_ERROR` (retryable) otherwise, never as a spent token. (review) **Mode `none` keeps AFD's store in memory**, as phases 2 to 4 did | 10.2 is about instances behind one URL; section 14's point 10 keeps local behaviour; a client told its token was spent would ask for a new approval rather than retry |
| 10.2: the other stores | Person decisions and tasks in `src/shared/` | Not built here: `person.sqlite3` is step 5's and `tasks.sqlite3` step 8's, each behind a trait in `src/shared/` beside the nonce and limit stores; step 4's gateway `jti`s and step 5's spent decisions go through the nonce store's `NonceStore` trait under their own key prefixes | The steps that use them |
| 11: `calls_per_minute` | Keyed on the verified issuer, subject and client, after verification (layer 6) | Layer 6's token gate counts every request the bearer layer admitted (listings included), after its any-Umbel-scope check, on the shared counters with layer 3's sliding minute; (review) the counter's name is the HMAC-SHA256 of the three under a new workspace key, `state/keys/limits.key` (32 bytes, race-safe, shared), so the store holds no identifier a dictionary could recover; a new token for the same caller shares the budget; 429 with `Retry-After` and "Too many requests with this token"; 503 `WORKSPACE_SHARED_TIMEOUT` and 500 as layer 3 | Every request costs the server; the key must not hold identifiers |
| 11: `read_bytes_per_minute` | The effective principal's result bytes, a host middleware checked before the handler | A registry middleware after the scope gate: before the handler, `RATE_LIMITED` (retryable, `details.retryAfterMs`) once the bytes counted for the effective principal (named by its HMAC under `limits.key`; every caller without a principal shares one name) in the last minute reach the limit; after it, the serialized `CommandResult`'s bytes are counted, so a call's result, a mutation's included, is never withheld. Every nested call (a batch item, a pipeline step) counts its own. Hosted modes, every caller but the operator, stdio and the library included; (review) the store and the key are opened on the first limited call, so the operator never depends on `state/shared/`. `limits.sqlite3` takes schema version 2 (a byte table); version 1 is upgraded in place. A store held too long is `WORKSPACE_SHARED_TIMEOUT`, any other failure `INTERNAL_ERROR` (retryable); a failure to count after the handler is logged only | The strictest exact reading |
| 11: `person_pages_per_hour` | When a person decision begins | Step 5's, with the person page | Nothing begins a decision yet |
| 6.3, 11, follow-up of 2a: `http.trusted_proxies` | Settled: an opt-in list of exact peer addresses whose connections must open with a PROXY protocol version 2 header | Configuration version 5 key: IPv4 or IPv6 addresses only (no port, prefix length, zone or name), each once after reading an IPv4-mapped address as IPv4, never unspecified, multicast or broadcast, at most 64, and only in a hosted mode (`WORKSPACE_CONFIG_INVALID` naming `http.trusted_proxies` otherwise); in `workspace-config.v5.json`. The listener reads, before TLS and HTTP, exactly the header's bytes from a listed peer: version 2, the `PROXY` command, TCP over IPv4 or IPv6, at most 4096 bytes, within 10 seconds, TLVs skipped; its source address, neither unspecified nor multicast, becomes the connection's peer for the per-IP limit. A `LOCAL` command, version 1, another family or transport, a source that is unspecified, multicast or (review) the IPv4 broadcast address, a longer or late header, or none, closes the connection. No other peer's header is read, and no forwarded header ever is. The doctor's new **`auth.trusted_proxies`** (after `auth.tls`) passes unset, and warns on a loopback entry (any local process can name any client) and on a non-loopback entry with a loopback bind (it can never connect) | Closes 2a's follow-up; `LOCAL` names no client, and a local user could otherwise spend another client's budget |
| 6.3, 11: what layer 6 counts (review note) | Unstated | A 403 from the bearer layer's resolver is decided before layer 6, so it counts against the per-IP limit only, not the per-token one, as 6.3's order places them | Recorded, not changed |
| 6.3: composing layers 5 to 7 | `McpServer::authorized_http_service` | `bearer_layer()` over the token gate over `try_streamable_http_service`, all from one authorized server, so layer 6 sits between them, as AFD documents for a host composing its own stack | Layer 6 must follow verification and precede the service |
| 13.2, 14: `confirm_binding.rs` | "#532 through Umbel" | Two instances on one workspace: a confirmation `requestState` minted by one is read by the other for the same principal, and another person, or another client of the same person, presenting it is asked again; the same person and client with a new token is not refused. An approval token binds its actor on every instance and is spent once across them. A confirmation state is not single-use within its time to live for its own principal and call, as AFD designs it; person-gated commands never rest on one (host-verified mode, section 3.1) | Section 13.2's two rows |
| 1: tests | The five named files | Also `tests/trusted_proxies.rs`. The `testkit` seam `HostBuilder::with_approval_observer` hands every held approval, with its token, to a test, so a second host can be shown it; a shipped build never lets a token leave its process | Shared nonces cannot be shown across hosts otherwise |

## Amendments from AFD's hidden commands

Step 3's follow-up of 2026-11-08 landed in AFD: `spec/authorization.md` M6 gains
[hidden commands](../../../../../spec/authorization.md#hidden-commands), and AFD's Rust server implements them.
With filtered listings and a resolver, a command for which the resolver's new `known(command, credentials)` (default:
`visible`) is false does not exist for that caller: every route answers it byte for byte as a name nobody
registered, before its input is validated and before any middleware, confirmation, relay or task. Umbel's resolver
implements `known` as section 9.4's hidden instance reads it (`ScopePolicy::known`), not as `visible`, so a command
the caller may learn of but not call still gets the 403 that names the scope it lacks (5.4). It changes the trust
model nowhere; each change makes the hidden instance's answer more like an unknown name's, never less.

| Section | Was | Now | Why |
| --- | --- | --- | --- |
| 9.4, step 3's hidden instance | The hidden-instance check (a host middleware) answers a call of a hidden instance's command as an unknown name; AFD validates the input first, so an invalid input gets `VALIDATION_ERROR`, and a direct `tools/call` of the tool, a batch or pipeline step, or a confirmation could answer otherwise | `UmbelScopes::known` is false for an MCP-exposed plugin command whose instance serves no space the caller reads, and for every plugin command when the resolver cannot find the request's caller (it never guesses); true for every other exposed command, listed or not. AFD then answers such a call as an unknown name on every route (its own tool, `afd-call`, `afd-batch` and `afd-pipe` steps, `afd-detail`, the listings), with valid, invalid or no input, before validation | The follow-up of 2026-11-08 |
| 3.3: `visible` and `known` | `visible` alone filters the listings | The listings show a command only when `visible` and `known` both hold. `known` is wider than `visible`: a command that exists for the caller but that its token cannot call (`event-ack` to a reader of `alpha`) is unlisted and still decided by `resolve`, which names the missing scope; with `known` defaulting to `visible` it would have looked unknown instead, losing 5.4's step-up | 5.4: a missing scope is named for a space the caller reads |
| 5.2: the hidden-instance check | The only answer for a hidden instance's command | Kept as defence in depth for a call that reaches the registry another way with credentials (an in-process caller); a call over MCP no longer reaches it | Defence in depth |
| 5.2, 3.3: a token with no Umbel scope on a name that does not exist | AFD asked the resolver about every command name, so its any-Umbel-scope rule refused an unknown name before dispatch | AFD asks the resolver about no command name that does not exist for the caller (unknown, unexposed or hidden), deciding it on the required scopes alone, so no resolver can tell a hidden command from a missing one. Layer 6's token gate already refuses every admitted request from a token with no Umbel scope, `tools/call` included, with the same 403 naming `<prefix>:read` (the same body and challenge as the resolver's), so a hidden instance's command, a missing name and a command that exists all get the one 403 | The rule holds for every name, decided once |
| 3.3: when `known` is asked | Unstated | AFD decides `visible` and `known` once per request, as it arrives, while the request's caller is in the `CallerBook`; a task runs with that answer, so its runner never asks once the request is answered. A `tasks/*` request on a task whose command no longer exists for its owner gets the unknown-task answer | AFD's purity requirement; Umbel's `known` reads in-flight state |
| 14: `space_visibility.rs` | A hidden instance's command through `afd-call` with valid input | Also each input the schema refuses, and none, through its own tool, `afd-call`, `afd-batch`, `afd-pipe` and `afd-detail`, each byte for byte as an unknown name's; a token with no Umbel scope gets the one 403 for a hidden, a missing and an existing name; a unit test of `ScopePolicy::known` | The follow-up's routes |

## Amendments from step 7

Step 7 built exact filtering (section 9, D125): BM25 statistics per reader filter for knowledge
(`store-embedded/src/index/stats.rs`, index schema 2) and for memory (`store-embedded/src/memory/rank.rs`, with
`umbel-store`'s memory tokenizer, `store/src/memory/tokenizer.rs`), sealed positions (`src/positions.rs`) on every
surface that shows a position, sequence number or total to a hosted caller that is neither the operator nor stdio,
`workspace-show`'s per-filter statistics, and the four follow-ups it owned. It kept every rule of sections 9.1 to 9.4,
5.4, 4.6, 4.7, 13.2 and 14's point 10 that it reaches, and took the strictest reading wherever they, or the brief, left
a choice. None changes the trust model; each shows a caller less, never more, except where a row says it serves
something it refused before: mode `oauth` in a shipped build, which waited for this step alone. The knowledge eval
re-ran before and after the independent review's fixes, and every metric equals the baseline to four places, so the
baseline is unchanged. Plugin crates changed (`knowledge`, `context`, `memory`, `sources-filesystem`), as this step's
surfaces live there.

| Section | Was | Now | Why |
| --- | --- | --- | --- |
| 9.1: exact token counts | "A new `u64` fast field per text field (`len_title`, `len_body`, …)" | Index schema 2 (`index/v2/`) adds `len_<field>` for each of the 17 fields a query can score: the prose and code fields, `path` and `path_raw`, every raw field a query may name, and the JSON `meta` field. Each counts as tantivy's indexer counts: the tokens the field's analyzer emits, less any over tantivy's `MAX_TOKEN_LEN`, and for `meta` one per leaf (a string's tokens; a number, boolean or date one; `null` and a non-finite number none). Summed over an index without deletes they equal tantivy's own `total_num_tokens` for every field (`stats.rs`'s unit test). `doc` and `access` only ever filter, under a constant score, and have none; a field without counts cannot be scored (an error, never a whole-index figure) | "Per text field" read as every field a score can reach |
| 9.1: the old index | "The index schema version rises, so the next `knowledge-index` rebuilds" | Opening schema 2 removes `index/v1/`, and `store-backup` copies `index/v2/`. `dev.umbel/index`'s `schema` and a locator's `indexVersion` name schema 2 | Derived data left behind would keep the text of documents forgotten since (D73) |
| 9.1: the statistics | `doc_freq`, `total_num_docs` and `total_num_tokens` over readable chunks, deleted ones excluded, cached per (segment set, filter digest) | As written, through `Searcher::search_with_statistics_provider`. The cache key is the searcher's segments, each with its delete opstamp, and the reader's sorted token list (the derivation read its own key), 32 entries, an older segment set's dropped. The structured filters (`collection`, `tags`, ...) are not the reader's and change no statistic | A deleted chunk or a commit names a new segment set |
| 9.1: what else a hidden chunk could move (strictest reading of "changes no byte of a caller's results") | Statistics only | Two more: **a prefix** (`roll*`, `"canary rel"*`) expands into the first 256 terms in byte order that a chunk the reader may read holds, across segments, where tantivy took the first 256 of each segment's dictionary (hidden terms took slots, and the result depended on segment layout); the expansion still matches only and is never highlighted, as before. **A snippet** weighs its terms by how few readable live chunks hold them, where tantivy's `SnippetGenerator::create` counts the whole index; tantivy's own `SnippetGenerator::new` builds it | Both moved a reader's bytes with chunks it cannot read; `partitioned_stats.rs` holds each |
| 9.1: which tied chunks make the cut | Phase 2 collected the top `limit` plus a window of up to 4 096 by score, then sorted ties by document and ordinal | One collector over a total key: the score at four places descending, then the document id ascending (the `doc` field becomes a fast field in schema 2), then the ordinal. It keeps exactly the first `limit` chunks in that order, however many tie | With more ties than the window, which ones made the cut followed segment layout, which commits a reader cannot read change (found by the review) |
| 9.2: which records the statistics are over | "Computes BM25 over the readable matches only" | **Scores** every readable match, with FTS5's own `bm25()` formula (k1 1.2, b 0.75, the IDF floored at 1e-6, the column weights recall always used: subject 3, tags 2, text 1, the row's length summed over its columns, the expression's phrases in FTS5's order, the first required term twice as `fts5()` writes it) over **the reader's statistics**: the indexed records it may read that are not forgotten, their total length from FTS5's `records_fts_docsize` (the counts the tokenizer reproduces), and per phrase how many of them hold it (FTS5 counting the phrase alone under the reader's filter). A reader who reads every record gets FTS5's `bm25()` exactly | D125's "BM25 per reader filter ... over every readable match": the matches alone as the corpus would give every one-term query an IDF at the floor (each match holds the term), so every score would round to zero at four places and recall would rank by recency alone |
| 9.2: the order | "By that score, then authority tier, then `recordedAt`, then id" | The score at four places descending; then `Authority::tier` (`person`, `tool`, `agent`, `import`, `transcript`, phase 3 section 9.3's order, then `document` and `external`, which nothing pushes); then `recordedAt` descending; then id ascending. The conformance group's tie case holds the tier | The tier order the context plugin already uses |
| 9.2: the ceiling | More than 50 000 readable matches is `MEMORY_QUERY_TOO_BROAD` | Counted in the match query, before any body opens (`LIMIT 50001`): `StoreError::QueryTooBroad { limit }` (new), the SDK's `HostError::QueryTooBroad`, `MEMORY_QUERY_TOO_BROAD` with `details.limit`, not retryable, from `memory-recall` and from `context-bundle`. Matches whose body does not open are counted in `unreadable` and score nothing; a forgotten record's rows, which may match until the roll-forward removes them, are neither counted nor scored. A `testkit` seam, `SqliteMemoryStore::with_recall_ceiling`, lowers (never raises) the ceiling for tests; `MAX_RECALL_MATCHES` stays 50 000 and the host's `MAX_MEMORY_MATCHES` is it | Never a silent truncation |
| 9.2: the tokenizer | FTS5's `porter unicode61` rules, re-implemented and tested against FTS5's tokens on a fixture | `umbel_store::memory::tokenizer::tokens`: a port of SQLite 3.54.1's (the bundled amalgamation's) `porter unicode61 remove_diacritics 2`, its Unicode tables generated from the C arrays. A porter stem that cuts a multi-byte character (FTS5 indexes those bytes as they are) is held as U+FFFD and two hex digits per stray byte, so term identity and counts stay exact; the 32 768-byte token cap is kept. `store/tests/memory_tokenizer.rs` compares it with FTS5's own tokens (`fts5vocab` instances and `docsize`) on 234 fixture strings, 5 000 seeded random ones and 17 374 that place every non-ASCII code point. `rusqlite` (in the lock) is a dev-dependency of `umbel-store` for it | Exact counts need exact tokens |
| 9.3, 4.7: whose positions are sealed | "For non-operators"; cursor strings "handed to non-`process` callers" | A hosted caller that is neither the operator nor `process` (`Caller::seals_positions`): the library and every HTTP caller, which is `workspace-show`'s `exact` list. Mode `none`, the operator and stdio keep plain positions and version 0 cursors everywhere, as section 14's point 10 and 4.7 say of stdio | stdio is handed version 0 cursors, which count events, so sealing its other positions would hide nothing |
| 9.3: the seal | XChaCha20-Poly1305 under `cursor.key`, the nonce HMAC-SHA256 under a derived key over the plaintext and associated data; `{space, seq}` sealed with the principal as associated data | `state/keys/cursor.key` (32 bytes, created race-safe on first use). The plaintext is the position as eight big-endian bytes; the associated data binds the construction, the kind (cursor or revision), the space and the caller (its actor's kind and id, and the person it acts for); the cipher key is HMAC-SHA256(key, `umbel/positions/1/cipher`), and the nonce the first 24 bytes of HMAC-SHA256 under HMAC-SHA256(key, `umbel/positions/1/nonce`) over the associated data and plaintext, which opening checks, so neither use takes the file's key itself. A token is 48 bytes, unpadded canonical base64url: 64 characters after `v1.` or `r1.`. Another caller's, space's or kind's token, an altered one and a malformed one open alike to nothing. `chacha20poly1305` (in the lock) becomes a dependency of every host build, since any build may open a hosted workspace | Locator version 2's pattern bounds a token at 128 characters, which a 63-character space id in the plaintext could pass |
| 9.3, follow-up of step 1: an event's own counts | `id` (`<space>:<seq>`), `seq` and `journalSeq` count every event | To a sealed caller an event is **`event-view.v1`** (new schema): the stored line without `seq`, `journalSeq`, `changes` and the record's `version`, its `id` and `cursor` both the event's cursor version 1. A page holds `limit` events the caller can read; `cursor` is the last of them or, with none, the last it can read at or before where it started; `head` the last it can read; `hasMore` whether it can read one after `cursor`; `acknowledged` the last it can read at or before the stored position. A version 0 string, another caller's or space's token, an altered or malformed one, or a position past the stream is one `INVALID_CURSOR` naming nothing of the stream, from `event-list` and `event-ack` alike. `event-ack` stores the position and answers `acknowledged` and `previous` sealed. A damaged or unreadable stream keeps its code, but its message names no line (which would count the events before it) and no path | Closes step 1's follow-up; a page of fewer events than asked would count the hidden ones between |
| 9.3, 4.6, follow-up of step 2b: cursor files | Unchanged on disk; every principal comparison consults the equivalents | A caller's stored cursor is its own file, else the first legacy principal's (in the equivalents' order) that `[principal.equivalents]` maps to its actor, then to the principal it acts for; it writes only its own, so its first acknowledgement takes over and the legacy file is never changed. In every mode. For a sealed caller acting for a person, "its own" is keyed by the actor and that person, so two people on one OAuth client keep apart cursors, as their readable streams differ | Closes step 2b's follow-up; the person in the key was the review's |
| 9.4, follow-up of step 3: `space-list` | Each listed space's `events` and `head` count every event | To a sealed caller, `events` counts the events it can read and `head` is the cursor version 1 of the last of them | Closes step 3's follow-up |
| 9.3: store revisions | "`dev.umbel/index`, `knowledge-changes` revisions, `rev`: the last readable revision at or below each value, sealed as `r1.`, accepted back by `after`" | `DocumentStore::last_readable_document(at, reader)`: the last document change (a put or delete) at or below `at` that the reader may read, a trait default that pages `changes`, the embedded store's one query. Record changes never count: a space-readable bookkeeping record (a source's sync state) would move every reader's position on a write it cannot read, as `exact_filtering.rs`'s differential found; for the same reason `knowledge-changes` pages document changes alone to a sealed caller. The SDK's `Cx::doc_position` and `doc_position_of` (grant `documents`) show a revision and take it back, and `CallContext::sealed_positions` says whether totals must be readable-only. Every revision a knowledge command shows goes through them: `knowledge-list`'s and `knowledge-describe`'s `rev`, `indexApplied` and `graphApplied`; `knowledge-changes`' `rev` and `nextAfterRev`, its `after_rev` taking a number or a sealed revision; `knowledge-propose`'s and the batch's `rev`; an applied proposal's `document.rev` and, in `knowledge-proposal-show`, `result.rev`; `knowledge-search`'s `INDEX_STALE` details and a detailed hit's locator object, version 2 when sealed; `knowledge-index`'s revisions and `INDEX_REMAINING`; and `context-bundle`'s `INDEX_STALE` details. A plain caller's numbers and texts are as before; to a sealed caller no reasoning names a revision. `knowledge-proposal-feed` stays plain: only an attested pipeline step reaches it, and no sealed caller can obtain an attestation | "`rev`" read as every store revision a caller is shown |
| 9.3: host metadata | `dev.umbel/index` sealed | For a sealed caller the plugin gate leaves `dev.umbel/changes` and the record's `version` out of the result and seals `dev.umbel/index`'s `applied` and `head` in place (leaving the key out when a store or filter cannot be read). When the result will be journaled it keeps the two it removed under a fresh random reference, which the result carries as `dev.umbel/journal-ref`, and the journal's last look takes them back by it and drops the reference before the entry is stored, so the journal and every event stream rebuilt from it hold the changes and version whole; the index stays as the caller saw it. The reference names nothing, and a context without a trace id, or two calls sharing one, journal their own (the review found the trace id neither unique nor always present). At most 4 096 are held | The journal rebuilds every stream; the caller is shown only what it can read |
| 9.3: index-building totals | Readable-only counts | To a sealed caller `knowledge-index` counts only the documents it can read (a removal it can read in the change log, a write it can read now): indexed, removed, chunks, graph documents, nodes and edges, code files, symbols and degraded files, and limited documents; a link to a document it cannot read counts as broken, as `knowledge-describe` shows one; `remaining` asks only after changes it can read; the reasoning names no revision. Its `limit` counts readable document changes only: the run walks past changes the caller cannot read, indexing them too, and stops just before the first readable one past the limit, so how far a run gets never depends on them. Degraded and limited documents list the readable ones first, so a sealed caller's capped lists hold none it cannot read. `context-bundle`'s `state` (`indexApplied`, `memoryHead`, both revisions of every principal's writes) is `null` to a sealed caller, which its schema admits | A total of every document counts the hidden ones |
| 9.3: `store-show` and the CLI-only built-ins | "CLI only, as today" | `store-show` was exposed everywhere but the palette; its head, applied revisions, segments and file sizes count every principal's writes. In a hosted mode it is now registered for the CLI alone, and its handler, `event-rebuild`'s, `store-check`'s and `store-backup`'s refuse any caller but the operator (`COMMAND_NOT_EXPOSED`), as `workspace-doctor`'s does since step 2c, since the library checks no interface. Mode `none` is unchanged | "As today" read as what the table requires; the library path was the review's |
| 9.3: `sources-sync` and `sources-status` | Not named | To a sealed caller a sync's counts (added, updated, unchanged, removed, flagged) are of the documents it can read, `skipped` is 0, the skip warnings and `stoppedAfter` are left out, and `fromRev` and `toRev` are positions; the byte budget is spent on readable documents alone, and a run stops before writing the readable one past it. `sources-status` counts files, modified, deleted and unchanged among the stored documents it can read, `new` and `skipped` as 0, and shows `lastSync.rev` as a position | Their totals counted every principal's documents (found by the review) |

| 6.1, follow-up of step 2c: `workspace-show` | `statistics: "shared"` until step 7 | `"per-filter"` in hosted modes; mode `none` keeps phase 2's value | Closes step 2c's follow-up |
| 16, 2b's amendment: serving `oauth` | Refused in a shipped build until 2c, 3 and 7 have all landed | **Lifted.** `Host::http_server` serves mode `oauth` with the verifier it builds from `[auth]`; the doctor's `auth.mode` passes. The `testkit` seam `HostBuilder::with_unfinished_oauth` is removed, since nothing is left for it to unlock; `tests/auth_layers.rs` holds that a build with no seam serves it (the listener, the metadata, the 401). `gateway` still refuses to start until step 4, and person-gated commands stay off MCP until step 5 | Settled 2026-11-08: it lifts once 2c, 3 and 7 have all landed |
| 14: tests | `partitioned_stats.rs`, `memory_tokenizer.rs`, `cursor_v1.rs`, `eval_gate.rs` | As named, with the follow-ups' cases in `cursor_v1.rs` (event views, `space-list`, cursor files and equivalents) and `auth_show.rs` (`per-filter`), the exact counts as `stats.rs`'s unit tests, `last_readable` in the conformance `access` group, the tier in its `memory_recall` group, and the positions over HTTP in `cursor_v1.rs`, and each first-party command's differential in `first-party/tests/exact_filtering.rs` (knowledge, memory, context, sources). Each review fix has its regression test | |

An independent read-only security review of step 7's diff found two blockers and seven improvements, all fixed with a
regression test each: `knowledge-index`'s `limit` counted changes a sealed caller cannot read (B1); two people on one
OAuth client shared a cursor file (B2); tied chunks past the window followed segment layout (I1); degraded and limited
lists could fill with hidden documents (I2); the CLI-only built-ins answered the library (I3); the journal's stash was
keyed by trace id (I4); positions moved with sources' space-readable sync state, and `sources-sync` and
`sources-status` counted every document. Two it raised stay as follow-ups below: AFD's batch numbers each item's trace
id, and a prefix's expansion costs time in what the index holds.

## Amendments from step 4

Step 4 built the host's gateway-trusted mode (`src/auth/gateway.rs`: the pinned key set, the channel, the assertion's
rules, the meet and the mapping; `src/surfaces/http/gateway.rs`: the gateway layer and mode `gateway`'s router;
`src/principal.rs`, `src/auth/caller.rs`, `src/auth/doctor.rs`, `src/workspace/hosted.rs`, and the listener's new
`LocalAddr`). It kept every rule of sections 2.2, 3.3, 4.1, 4.2, 4.4, 4.5, 6.1, 6.3, 10.2 and 13.2 that this step
reaches, and took the strictest reading wherever they, or the brief, left a choice. None changes the trust model:
the gateway is still trusted only to say who authenticated. Every row makes a refusal more likely, never less, but
one: **a gateway caller's missing scope is answered after routing, not with section 5.2's 403 before dispatch**
(the row "where a call's scopes are decided"). The call is still refused before anything runs, with
`INSUFFICIENT_SCOPE` naming the same scopes; only the answer's shape differs from 5.2 and AFD's M6, because AFD
decides before dispatch only in its own bearer layer and exposes no public way for a host's layer to name a request's
commands (a follow-up to AFD below). A mutation run removed each security check in turn (44 mutants, every one
killed by a test). An independent security review found no blocker, four improvements and five nits; the owning
agent's decisions on them are in the rows marked "(review)", each fixed with a regression test that fails without
it. No plugin crate changed (`umbel-testkit-idp`'s `GatewaySigner` became `Clone`, for the probe of
`no_auth_server.rs`); the afd crate gained one additive option, `ProtectedResource::with_scope_source`.

| Section | Was | Now | Why |
| --- | --- | --- | --- |
| 16, 2a's amendment: serving `gateway` | Refused to start until step 4 | **Lifted.** `Host::http_server` serves mode `gateway` with the gateway layer it builds from `[auth.gateway]`, and refuses to start (`WORKSPACE_CONFIG_INVALID`, `details.key` `auth.gateway.keys`) when the pinned key set cannot be used. The doctor's `auth.mode` passes. `no_auth_server.rs`'s `routers()` gains the gateway router, probed over its pinned TLS channel with a fresh assertion per request's method | The step's purpose |
| 4.4: the channel | `client_auth = "ca"` with the certificate's SHA-256 in `client_cert_sha256`, or a loopback bind | Two legs, each decided from the connection alone, never a header. **Pinned** (`client_auth = "ca"` and pins): the end-entity certificate the handshake verified must have its SHA-256 pinned. **Loopback** (otherwise, which configuration admits only on a loopback bind): the accepted socket's own local address must be loopback (`LocalAddr`, a new connection fact the listener inserts beside `PeerAddr`), whatever listener an embedder serves on, and pins configured on this leg must match too. A failure is the one 401, rule `channel` | `http.bind` describes the CLI's listener, not an embedder's; pins a deployer wrote are never ignored |
| 2.2: pins with no certificate | `client_cert_sha256` required off loopback | Also: pins need `client_auth` other than `none` (refused at open naming `auth.gateway.client_cert_sha256`), since no certificate could ever match them; `workspace-config.v5.json`'s descriptions say so | A configuration that can serve no one is refused, not served |
| 4.4: the header | "A per-request assertion in `Umbel-Gateway-Assertion`" | Exactly one such header (two are `assertion-malformed`, none `no-assertion`), of at most 4096 bytes, a compact JWS whose header and claims are each one JSON object with unique member names. After the layer, the assertion and any `Authorization` header are removed, so nothing behind it can read either; no other header is read for anything | AFD's step 0b parsing rule; the assertion goes no further than the verifier, as a token does not |
| 4.4: `typ` | `umbel-gw+jwt` | Compared exactly: case-sensitive, and not as `application/umbel-gw+jwt` (an access token's `typ` is compared as a media type) | Umbel defines this type for its own gateways; nothing needs the other forms |
| 4.4, 3.2 rule 3: the algorithms | Rules 3 to 5 against "the pinned `keys`" | The gateway has no `algorithms` key, so **every pinned key must name its `alg`**, one of AFD's signing algorithms, and rule 3's allow-list is the pinned keys' own algorithms; AFD's `check_jws_header` applies the rest of rule 2 (`none` and `HS*` refused, `kid` required, `crit`, `jku`, `x5u`, `x5c` and `jwk` refused), and the header's `alg` must equal its key's | No key can be used under an algorithm the deployer did not pin it for |
| 4.4, 6.1: the pinned key set | "A JWKS with a usable key" (step 2c's doctor) | Read once at start by the gateway layer's own loader (`PinnedKeys`), which the doctor's `auth.tls` now calls too: 1 to 64 keys, each a unique non-empty `kid`, its `alg`, fitting it (AFD's `check_key_fit`: `kty`, curve, `use`, `key_ops`), material that verifies, and no private or symmetric member (`d`, `p`, `q`, `dp`, `dq`, `qi`, `oth`, `k`); one key that is not so refuses the file. At start the file must also pass the doctor's permission rule (writable by no one but its owner, this user or root, in a directory others cannot write), not only at the doctor. A rotated key needs a restart | Whoever can write the file chooses whom the gateway may assert; the doctor must pass exactly what the layer serves |
| 4.4: `iss`, `aud`, `htu`, `htm` | Equal to `[auth.gateway].issuer`, `http.public_url`, and the method | Byte for byte: `aud` a string or a one-element array, `htu` a string, both exactly `http.public_url` (no case folding of the scheme or host, unlike an access token's audience); `htm` exactly the request's method as sent | The gateway is configured with the same URL; any other spelling is another request |
| 4.4: times | `iat` within `max_assertion_age_s`, `exp` at most 60 seconds after it | Whole-second integers only (a fraction or a string is `claims`). `iat` no later than now plus `auth.clock_skew_s`; now minus `iat` at most `max_assertion_age_s`, with no skew added; `exp` 1 to 60 seconds after `iat`; `exp` after now, with no skew; an `nbf`, when present, no later than now plus the skew. The system clock (the `testkit` seam `with_auth_clock` in tests), never `HostBuilder::with_clock`'s | The strictest reading: skew only forgives a gateway's clock running ahead, never an old or expired assertion |
| 4.4: the `jti` | "At least 128 bits, consumed once in the shared nonce store" | Base64url characters only and at least 22 of them, or, when it holds only hexadecimal digits and hyphens, at least 32 hexadecimal digits (a UUID passes). Spent **last**, after every other rule, as `gateway:<jti>` in `state/shared/nonces.sqlite3` (step 3's `NonceStore`), kept until the later of `exp` and `iat` plus the longest age, plus the skew and a second; so a refused assertion spends nothing, and a second process behind the URL refuses a replay. A store that cannot spend is 503 `WORKSPACE_SHARED_TIMEOUT` (with `Retry-After: 1`) or 500, never a replay's 401. The layer checks that its caller slot is there before verifying, so a missing layer spends nothing | 128 bits cannot be measured, so the form that can carry them is required; a failed spend must not read as an attack |
| 4.4: the other claims | `sub`, `client` and `scope` | `sub` and `client` are claim texts (1 to 255 characters, no control character); `scope` is required, a non-empty string, parsed as AFD parses a scope claim, with at most 64 Umbel scopes (`scopes-too-many`). **A `cnf` claim refuses the assertion** (`binding`): an assertion is never bound, and one claiming a binding the host does not check must not pass as unbound. `humanPresent`, `acr`, `amr`, `auth_time`, `act` and group claims are ignored | Step 0b's reasoning for `cnf`; 4.4 and 4.5 for the rest |
| 4.4: the meet | "A granted scope is kept when some ceiling scope implies it; a ceiling scope is kept when some granted scope implies it" | Exactly those two rules, granted scopes first, each once; only Umbel scopes reach the credentials. Where the scope order's greatest lower bound would be wider, the rules win (`write:alpha` asserted under a ceiling of `read` keeps nothing, not `read:alpha`). An assertion that keeps no Umbel scope is refused at layer 6 with 403 and the gateway's own challenge, `Umbel-Gateway realm="umbel", error="insufficient_scope", scope="<prefix>:read"`, body `INSUFFICIENT_SCOPE` (no metadata URL) | Never wider than 4.4's words; mode `gateway` publishes no metadata to point at |
| 4.1, 4.4: the mapping | "As 4.1 in `[auth.gateway].namespace`" | A service when `sub` equals `client` (the gateway has no `services` key), else the agent `<ns>/<client>` acting for `<ns>/<sub>`, each id mapped as 4.1 maps it (`~` and base32 when long); the chain is the client; the principal's `issuer` is the gateway's alias and `tokenBinding` `null`. AFD's credentials carry the gateway's `iss`, `sub`, `client` as the client id, the scopes of the meet, `http.public_url`, `iat` and `exp`, and no `auth_time`, `acr` or binding | 2.1's `null` binding for `gateway` (step 1) |
| 3.3, 5.2, 6.3: where a call's scopes are decided (review) | The resolver's 403 before dispatch | **A deviation from 5.2's 403, kept because the alternative is not available here:** mode `gateway` has no bearer layer, so as AFD decides credentials a host's own layer admits (step 0b's M6), a call's missing scope is decided after routing (after the context hook, before the confirmation gate and any person) and at execution, and answered `INSUFFICIENT_SCOPE` (`details.scopes`), not a 403. AFD names a `tools/call` body's commands (`afd-call`, `afd-batch`, `afd-pipe`, grouped and hybrid tools) and decides hidden ones only inside its bearer layer, and exposes neither; re-implementing that naming in Umbel could tell a hidden command from a missing one, so it is not done (a follow-up to AFD). Everything else of steps 3 and 7 is mode `oauth`'s: the served server holds an authorization with Umbel's resolver over the same in-flight `CallerBook` (so `visible`, `known`, hidden commands and filtered listings), the scope gate, the one answer, the per-token limit keyed on the gateway's issuer, the subject and the client, the read limit and sealed positions | Section 4.4 says gateway callers are callers like any other once identified |
| 6.3: mode `gateway`'s layers | Layers 1 to 7 | Layers 1 to 3 as in mode `oauth`; layer 4 serves `/health` only, so both well-known metadata paths are 404 like every path but `http.path`; layer 5 is the gateway layer; layer 6 the token gate; layer 7 AFD's host and origin checks and the service. The 401 is exactly 4.4's challenge and body for every reason, logged at `warn` (target `umbel::auth`) as the gateway's alias and a rule code: `channel`, `no-assertion`, `assertion-malformed`, `typ`, `alg`, `kid`, `crit`, `key-reference`, `key`, `signature`, `issuer`, `audience`, `htm`, `htu`, `claims`, `jti`, `not-yet-valid`, `lifetime`, `expired`, `too-old`, `scope-malformed`, `scopes-too-many`, `binding`, `replayed` or `unavailable` | 3.3: mode `gateway` publishes no metadata |
| 4.2: the hook | Mode `gateway` maps "from the verified assertion in the extensions" | The hook takes, beside the credentials AFD admitted, only a caller vouched for as its mode vouches: a token's in mode `oauth`, an assertion's (`Vouched::Gateway`) in mode `gateway`; anything else is `UNAUTHORIZED`. The principal is `gateway` with no binding, and its claim groups are always empty | A caller one mode made can never stand in another |
| 6.1: the doctor | `auth.mode` warns until step 4; `auth.tls` checks the key set | `auth.mode` passes, naming the gateway's alias and namespace and that nothing is published; `auth.tls` loads the pinned key set with the gateway layer's loader (so every rule above, the file's permissions included) and names the channel (pinned, and how many certificates, or loopback); `auth.subjects` prints the gateway beside its namespace's issuers as a subject source the deployer asserts is comparable | The doctor passes exactly what `umbel serve --http` serves |
| 1: the crate | `umbel`'s `auth` dependencies | `jsonwebtoken` 11.1 (`aws_lc_rs`), AFD's own version and already in the lock, joins the `auth` feature for the assertion's signature, called as AFD calls it (the provider directly, never `decode` or a `Validation`); and `aws-lc-rs` (the test kit's version, in the lock) to parse the pinned keys (below) | No library default applies |
| 4.4, 6.1: key material that could never verify (review) | A pinned key "holds material that verifies", read as decodable | Refused when the file is read, at start and by the doctor alike: an RSA modulus outside 2048 to 8192 bits or an exponent below 3, and an EC point or Ed25519 key that `aws-lc-rs` (`ParsedPublicKey`, the curve's algorithm) does not parse, an off-curve point of the right length included ("cannot verify") | The doctor must pass exactly the keys the layer can verify with; a key that refuses every assertion is a configuration mistake to name at start |
| 10.2: how long a spent `jti` is kept (review) | Until the later of `exp` and `iat` plus the age limit, plus the skew and a second | As written, now held by tests: the store is asked to keep `gateway:<jti>` until `(max(exp, iat + max_assertion_age_s) + clock_skew_s + 1) * 1000`, and an assertion spent, then replayed half a minute later after another spend has purged expired rows, is still refused on both processes. With the age limit now at most 60 (below), the `iat` term only ever keeps a row longer than `exp` does, so it stays | A replay must find its row for as long as the assertion could be accepted |
| 6.3, 11: the per-IP limit in mode `gateway` (review) | Layer 3 counts every request by its peer address | **A connection whose TLS client certificate matches a configured pin skips the per-IP limit**: it is the gateway, authenticated at the channel, carrying many callers from one address, and the per-caller limits after verification (`calls_per_minute`, keyed on the gateway's issuer, the subject and the client, and the read limit) govern it. Every other connection, a certificate of the same CA that is not pinned and the loopback leg without pins included, keeps the per-IP limit before any verification work. No forwarded header is read. The doctor's `auth.tls` **warns** in mode `gateway` on the loopback leg without pins: any process on the host is on the channel and shares the per-IP limit | One address for every caller would make the per-IP limit a limit on the whole deployment; the exemption rests on the channel's own authentication |
| 4.2, 4.5, 3.3: one place for each invariant (review) | The hook alone checked the mode, and read the caller's claim groups field | `VerifiedCaller::claim_groups()` gives none for a gateway's caller whatever the field holds, and `VerifiedCaller::vouched_for(mode)` is the mode check; both the context hook and Umbel's scope resolver (its caller lookup, behind `resolve`, `visible` and `known`) use them, so a caller one mode made never stands in another and no group ever comes from a gateway, anywhere a caller is read | A rule kept at one call site is lost at the next |
| 5.2, 10.5: the suggestion of a missing scope (review) | "Obtain a token for `<public_url>` that also grants ..." | In mode `gateway`, AFD's after-routing and execution answers and Umbel's scope gate both say "Obtain a new Umbel-Gateway-Assertion from the gateway, within its scope ceiling, that also grants ...", through AFD's new additive `ProtectedResource::with_scope_source` (nothing published or challenged changes; without it every string is M5's); the token gate's 403 says what to assert | A gateway's caller holds no token to renew |
| 2.2, 4.4: `max_assertion_age_s` (review) | 1 to 300, default 60 | 1 to 60, default 60 (`WORKSPACE_CONFIG_INVALID` beyond, and `workspace-config.v5.json`'s maximum): an assertion expires at most 60 seconds after its `iat` and must not have expired, so a larger age could never admit one more assertion | A key whose larger values do nothing invites the belief that they do |
| 4.4: the time rules' boundaries (review) | Tested away from the edges | Held exactly at them: `exp` equal to now is refused; `iat` exactly the age limit ago is accepted and a second more refused; `iat` and `nbf` exactly the skew ahead are accepted and a second more refused; lifetimes of 1 and 60 seconds are accepted | An off-by-one at an edge is the usual mistake |
| 6.1, 10.4: reading the pinned key set (review) | The file's permissions checked by path, then the file read | The file is opened once and its permissions and owner are checked on the opened file (`fstat`, `files::read_trusted`) before it is read, besides the directory checks by path, so a file renamed into place after the check is never read in its stead. (The race itself cannot be staged deterministically; the unit test holds the check on the opened file) | Time-of-check to time-of-use |

## Follow-ups

| Date | Follow-up | Owner |
| --- | --- | --- |
| 2026-11-08 | A gateway caller's credentials expire with its assertion, at most 60 seconds after its `iat`, so a task it starts stops then with `TASK_TOKEN_EXPIRED` (step 0a's rule). Decide whether a gateway task may outlive its assertion; the strict reading is that it may not, as no credential vouches for the caller after `exp`. Document the decision and test it (found by step 4's review) | Step 8 |
| 2026-11-08 | AFD decides a missing scope with a 403 before dispatch only in its own bearer layer. Give a host's own layer (Umbel's gateway layer) a public way to ask for the same pre-dispatch decision on a request it admitted (naming the commands of a `tools/call` body and deciding hidden ones as M6 does), so mode `gateway` can answer 5.2's 403 instead of `INSUFFICIENT_SCOPE` after routing; then Umbel's gateway layer uses it, with the gateway's challenge (step 4's amendment) | AFD owner, then the phase 5 owning agent |
| 2026-11-03 | URL-mode elicitation "may change"; re-check at each refresh while the relay depends on it | Phase 5 owning agent |
| 2026-11-03 | Client support for URL-mode elicitation is not in the extension client matrix | Re-check at step 6 |
| 2026-11-03 | DPoP (SEP-1932), workload identity (SEP-1933) | W5 |
| 2026-11-03 | MCP cites OAuth 2.1 draft 13, while draft 17 is current; re-read the resource-server sections at step 0b | Closed 2026-11-07 by step 0b ([Amendments from step 0b](#amendments-from-step-0b)) |
| 2026-11-03 | Several machines behind one URL | Phase 6 |
| 2026-11-03 | Memory recall's ranking changed (9.2) with no memory retrieval eval | After phase 5 |
| 2026-11-03 | Plugin `secrets` and `http` grants | The first plugin that needs them |
| 2026-11-03 | OpenTelemetry export | After W12's first tagged release |
| 2026-11-07 | 12.2 caps a task's `ttlMs` at its token's `exp`, and the extension lets a server discard a task when its TTL ends, so a task stopped with `TASK_TOKEN_EXPIRED` may be gone before anyone polls it. AFD stops the work at `exp` and leaves the TTL cap to the host (step 0a); since step 0e a host sets it with `TaskOptions::with_ttl_capped_at_token_expiry(grace_ms)`. Decide the grace: 0, or a short, content-free one | Step 8 |
| 2026-11-03 | Whether `rustls-pemfile` is archived was not re-checked; `rustls-pki-types` replaces it either way | None |
| 2026-11-08 | Token verification trusts the platform's root certificates only, so an issuer behind a private certificate authority cannot be used. **Settled 2026-11-08:** each issuer may name its own roots (`[auth.issuers.<alias>] ca_file`, a PEM file under 2.2's file-path rules). When it is set, only those roots are trusted for that issuer's metadata, key-set and introspection fetches; the platform roots are not, and no other issuer is affected. Without it, the platform roots stand. The doctor checks the file in step 2c (step 2b) | Done 2026-11-08 in step 2c ([Amendments from step 2c](#amendments-from-step-2c)) |
| 2026-11-08 | `plugin-list`, `plugin-show` and `skill-list` list every plugin instance, the spaces each serves and its packs per space to any caller, so a hosted caller would learn the names of spaces it cannot read (found in step 2c). Filter them as 9.4 filters `space-list`, with step 2c's `access::listed_spaces`; until then a shipped build does not serve `oauth` | Done 2026-11-08 in step 3 ([Amendments from step 3](#amendments-from-step-3)) |
| 2026-11-08 | `auth.person`'s outcome per namespace must decide, at serve time, whether that namespace's `person.mcp` commands are listed and callable (7.1, section 14's `doctor_auth.rs` row): the check needs the provider's metadata, so step 5 runs it at start and again when the metadata's cache ends, and serves none of a namespace's verified commands while it fails or cannot run | Step 5 |
| 2026-11-08 | `auth.person` warns on an area with `approve_over_mcp` whose callers' namespace has no person login; the key arrives with the relay | Step 6 |
| 2026-11-08 | A login-only issuer's `ca_file` is checked by the doctor but loaded by no client yet, since step 2c's verifier fetches only from issuers whose tokens it accepts. The person page's fetches (its provider's metadata, key set and token endpoint) must go through `fetch::for_issuer`, so its private root is used and the platform's are not (found by step 2c's review) | Step 5 |
| 2026-11-08 | Behind a same-host TLS-terminating proxy (the topology 6.2 endorses), every request comes from the loopback address, so the per-IP limit becomes one limit for every caller, and one anonymous client can spend it. **Settled 2026-11-08 (strictest reading, no trust-model change):** no forwarded header is ever read (`Forwarded`, `X-Forwarded-For` and the like stay caller-controlled). Step 3 adds an opt-in `http.trusted_proxies`: a list of exact peer addresses whose connections must open with a PROXY protocol version 2 header, which supplies the client address used by the per-IP limit. That header is read only from a listed peer, and a listed peer whose connection lacks it is refused. Without the setting, step 2a's behaviour stands, and the per-token limits of step 3 keep a verified caller's budget its own | Done 2026-11-08 in step 3 ([Amendments from step 3](#amendments-from-step-3)) |
| 2026-11-08 | Step 2a keys an IPv6 peer on its /64, so the hosts sharing one /64 share one budget. **Settled 2026-11-08:** /64 stands. It is the smallest prefix a single site is normally assigned (RFC 6177), and keying on a full address would let one client rotate addresses within its own /64 to escape the limit | Done |
| 2026-11-07 | Section 9.3 seals the `event-list` cursor and `head`, but an event's own `id` (`<space>:<seq>`), `seq` and `journalSeq` still count every event, readable or not; event version 3 keeps the stored line's shape. Decide how `event-list` presents them to non-operators (found writing step 1's schemas) | Done 2026-11-08 in step 7 (`event-view.v1`; [Amendments from step 7](#amendments-from-step-7)) |
| 2026-11-08 | `space-list` lists only readable spaces since step 3, but each listed space's `events` and `head` still count every event of the space, readable or not (found in step 3). Make them the caller's readable positions with section 9.3's sealed head | Done 2026-11-08 in step 7 ([Amendments from step 7](#amendments-from-step-7)) |
| 2026-11-08 | `workspace-show`'s hosted `access.statistics` says `"shared"` until step 7 makes the statistics per filter (step 2c's amendment) | Done 2026-11-08 in step 7: `"per-filter"` |
| 2026-11-08 | Stored cursor files do not consult `[principal.equivalents]`, though 4.6 lists them among the comparisons that must (step 2b's amendment) | Done 2026-11-08 in step 7: a caller reads its own file, else its legacy principal's |
| 2026-11-08 | Memory recall now reads, for each recall, every record the reader may read (their lengths from `records_fts_docsize` and their key entries), and `event-list` and `space-list` read a space's whole stream for a sealed caller: both cost the size of what the caller can read, with no cache (step 7). Cache them per (memory head, reader) and per (stream tail, reader) if a deployment's recall or event listing grows slow | Phase 5 owning agent |
| 2026-11-08 | `context-bundle`'s `state` shows `indexApplied` and `memoryHead` as `null` to a sealed caller (step 7); a sealed memory revision would need the memory store's own "last readable revision" and a memory position service, which nothing else needs yet | When a client needs a sealed bundle state |
| 2026-11-08 | AFD's `batch` gives each item the trace id `<batch trace>-<index>`, so a batch item's journal entries and events carry its position in the batch. A sealed caller sees only its own batch's items, so nothing of another principal leaks, but an event's `traceId` read with another's could correlate the two batches' items (step 7's review). Decide in AFD whether item trace ids should be opaque | AFD owner, before phase 5's leak sweep (step 11) |
| 2026-11-08 | A prefix expands over readable terms by walking each segment's dictionary from the prefix until it has 256 readable ones, so its time grows with the hidden terms it passes (step 7's review): a timing channel bounded by the dictionary, not a result difference. Bound the walk, or precompute per-filter term lists, if section 8.5's sweep or step 12's hosted leak tests can measure it | Phase 5 owning agent, with step 12 |
| 2026-11-08 | Three `sources-sync` signals a sealed caller still shares with every reader of the collection (step 7's review): `limited` when the collection's directory holds more than 100 000 files, a run stopping early when one file passes the host's per-call read cap, and the sync state's own timestamps. Each describes the source tree the operator configured, not a document another principal wrote; decide in step 11's sweep whether they need readable-only forms | Step 11 |
| 2026-11-08 | AFD validates a call's input before any middleware runs, so a hosted caller can still learn that a command of an instance hidden from it exists by sending it an invalid input (`VALIDATION_ERROR` rather than `COMMAND_NOT_FOUND`), and a direct `tools/call` of a hidden tool differs from one of a tool that does not exist (found by step 3's review). Specify in AFD's M6 that a command a resolver hides from a caller is unknown to it on every route, before validation, and implement it in Rust | Done 2026-11-08 in AFD ([Amendments from AFD's hidden commands](#amendments-from-afds-hidden-commands)) |
