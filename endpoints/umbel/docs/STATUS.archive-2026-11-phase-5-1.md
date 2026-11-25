# Umbel status archive: phase 5, part 1 of 2

Moved verbatim from [STATUS.md](STATUS.md) on 2026-11-23 ([#1803](https://github.com/lushly-dev/afd/issues/1803)), which is the index and the
current record. A line here keeps the wording it had when it was moved and is not updated after:
a status recorded here may have changed since, though the detail of a phase still open (its
decisions, what its exit has not proven) still applies unless the index or the phase's
specification says otherwise. A link to `#heading` in a moved line named a heading of STATUS.md as
it stood then; the heading is in this file or, through "Headings in other files" at the end, in
another archive file, which the index lists under [Archive](STATUS.md#archive). A moved line is
never edited; a change of status goes in the index.

## Phase detail

### Phase 5. Auth and hosted

- **State:** specification **approved 2026-11-04, under the owner's 2026-10-31 delegation, with the owner's answers of
  2026-11-04** (D24), after an independent review (36 findings and 7 nits, all holding, 3 in part) and a revision on
  2026-11-03. Last
  verified 2026-11-03 against `main` at `e5b4e43c` (the specification's Status lists every file and line read; no Rust
  built), and for step 0a on 2026-11-07 against `main` at `ceefba8c` (below).
- **Done:** [the specification](phases/5-auth-hosted/spec.md), with D106 to D130 decided and the architecture amendments they
  need (the auth middleware row, the principal and usage-event interfaces and the present-human rule, the Built on AFD rows,
  section 7's access paragraph, rate limits, the versioning list, the phase table and specification list, the prerequisites
  rows, O5 closed, the glossary).
- **Owner's decisions, 2026-11-04, final; do not ask again** ([section 17](phases/5-auth-hosted/spec.md#17-for-the-owner)): the
  recommended option on questions 1 to 4; for 5 onward, in the owner's words, *"I am not an expert on these so I am fine going
  with your recommendations but lets make sure we are making good choices, not cutting corners, investing in the best
  outcomes, and being secure"*, so every question takes its recommendation, with two strengthenings:
  1. Principals `human:<namespace>/<subject>` from non-pairwise subjects; clients and services by namespace (D110).
  2. An agent reads its person's filter narrowed to its token's spaces (D111).
  3. Verbs `read`, `write`, `approve`, `erase`, per space, resolved per call; scopes only narrow; readability before scope (D112).
  4. Groups may take members from one issuer's claim (D113).
  5. Gateways are trusted for identity only, through a pinned channel and a signed per-request assertion (D114).
  6. A person is proven at the CLI's terminal or on the person page; **strengthened: user verification is mandatory**, so
     `auth.person` fails on an empty `acr_values` and every login must show a user-verification `amr` (D115).
  7. The MCP approval relay: approve and reject, per area, host-verified, through the person page (D116, amends D99).
  8. `memory-confirm` over MCP at `verified`, own records only; `curator-promote` stays CLI (D117).
  9. `memory-erase` blind, verified, with a dry-run plan and a notice; **strengthened: a configurable two-person rule**,
     `erase_approvals` 1 or 2, default 1 only because a single-administrator deployment could not erase otherwise (D118).
  10. Only a record's principal or a verified person in `editors` changes another's shared memory (D119), answering phase
      3's follow-up.
  11. A host-run, redaction-only sweep for drafts their proposer cannot read (D120, amends D101), answering phase 4's step 3b
      limit.
  12. Outbound credentials stay D43; per-caller exchange waits for O1 (D121).
  13. Content-free usage events (D122).
  14. Single-tenant; O5 closed (D123).
  15. No OpenTelemetry export in phase 5 (D124).
  16. The operator's `local_id` is namespaced in hosted modes, with one-way legacy equivalents (D129).
  17. Only the CLI is an operator (D130).
- **Done:** step 0a, the AFD spec (documents and cases only), 2026-11-07, in the step 0a pull request:
  [`spec/authorization.md`](../../../spec/authorization.md) (M1 to M8: where it applies, the one bearer token, the
  verification rules with a closed list of rule codes, the audience, `credentials`, the 401 and 403 forms and bodies,
  static scopes and the `ScopeResolver` with the 403 before dispatch, `INSUFFICIENT_SCOPE` after routing, list
  filtering with `cacheScope: "private"`, RFC 9728 metadata, the principal binding) and its cases in
  [`spec/authorization.json`](../../../spec/authorization.json) (13 sections, 184 cases, beside `spec/vectors/`
  because no language loads them yet); [`spec/command-metadata.md`](../../../spec/command-metadata.md) gains
  `scopes`, `confirmationMode: "host-verified"` and `task`, #532's binding of confirmation and approval-relay
  state, the host-verified mode with `HumanRelay`, relay evidence and Tasks; `INSUFFICIENT_SCOPE` and
  `TASK_TOKEN_EXPIRED` specified in [`spec/error-codes.md`](../../../spec/error-codes.md) (joining the catalog in
  0b and 0e, so `vectors/error-codes.json` is unchanged); `tool-strategies.md`, `protocol-conformance.md`,
  `CHANGELOG.md` (`VERSION` unchanged) and the language parity rows (Planned); the
  [MCP Authorization](../../../docs/features/complete/mcp-authorization/mcp-authorization.proposal.md) and
  [MCP Tasks](../../../docs/features/complete/mcp-tasks/mcp-tasks.proposal.md) proposals moved to
  `docs/features/active/` with A4, A5, T1 and T5 annotated. Fifteen choices the specification left open are in its
  [Amendments from step 0a](phases/5-auth-hosted/spec.md#amendments-from-step-0a), none on the trust model.
  Verified 2026-11-07: Rust's confirmation gate (`confirmations.rs:239-348`) and approval middleware
  (`approval/middleware.rs`), TypeScript's `mcp-modern.ts` state codec and Python's SDK confirmation channel read
  for the #532 rows; rmcp 3.8.0's URL elicitation and task models; every expected value in `authorization.json`
  computed with Node from the rules as written. Gates on 2026-11-07: `pnpm check` passed (lint, build, typecheck,
  test, tooling tests); the `python.yml` and `alfred.yml` steps passed; the `rust.yml` legs passed except
  `cargo test --features server`, whose `tests/server_resources.rs` fails 7 Skills cases (`-32601`) when the
  unlocked crate resolves `rmcp` 3.9.0, and passes with `rmcp` 3.8.0 pinned: a regression outside this step,
  recorded in the follow-ups. `cpp.yml` was not run locally (no `cmake` on the machine).
- **Done:** step 0b, AFD's Rust `server-auth` feature, 2026-11-07, in the step 0b pull request: `afd::server::auth`
  (`Authorization` on `McpServer::with_authorization`; `McpServer::bearer_layer()`, the `BearerLayer` that serves
  RFC 9728 metadata at both paths, takes the one bearer token, verifies it, answers M5's exact 401 and 403, decides
  every command a `tools/call` names before dispatch and strips the token; `JwtVerifier` with `TokenRules`,
  `JwtIssuer`, `SigningAlgorithm`, `KeySource`, `StaticKeys` and `ClientCertificate`, every M3 rule in AFD's own code
  and `jsonwebtoken` 11.1 on `aws-lc-rs` for the signature only; `TokenVerifier` and `check_introspection` for the
  host's introspection; `ScopeResolver`, `ScopeDecision`, `static_decision`, `forbidden_scopes`; `ProtectedResource`;
  `RuleCode` logged at `warn` with the issuer alias). The server fails closed without the layer, puts
  `CommandContext::credentials` and the default actor on every call, decides again after the context hook and
  before the confirmation gate (`INSUFFICIENT_SCOPE`, which joins the shared catalog with its constants in all four
  languages, 47 codes), and filters listings with `cacheScope: "private"`. In the core crate: `afd::Credentials`,
  `CommandDefinition::with_scopes` (in `_meta`, grouped actions and `afd-detail`), `is_scope_token`,
  `principal_binding` and `credentials_binding` (M8, for 0c). `rust.yml` and `suites.mjs` gain the `server-auth`
  clippy and test legs, and `rust.yml` triggers on `spec/authorization.json` (and, in the
  coordinator's follow-up commit, on every spec case file the Rust tests load). Twenty choices are in the
  specification's [Amendments from step 0b](phases/5-auth-hosted/spec.md#amendments-from-step-0b), the
  cross-language ones written back into `spec/authorization.md`; none changes the trust model. An
  independent security review's nine findings are fixed on the same branch, each with a regression
  test in `tests/server_auth_hardening.rs` that fails without it, and recorded there as "(review)" rows:
  suggestions and hidden groups, any `Missing` refusing, fail closed on untrusted transports and on
  credentials not admitted for the server (`Authorization::admit`, `McpServer::authorized_http_service`,
  `with_trusted_transport`), the resolver again at execution on the validated input, per-caller
  resources (additive `ResourceProvider::list_for` and `read_for`), JSON-RPC batches refused, `exp`
  before `iat`, and the actor redacted in debug output. Verified
  2026-11-07 with every `rust.yml` leg, the wasm32 checks, the docs.rs build and `pnpm verify` (exit codes in the
  step 0b pull request).
- **Done:** step 0c, [#532](https://github.com/lushly-dev/afd/issues/532), 2026-11-07, in the step 0c pull request
  (stacked on step 0b's): confirmation `requestState` bound to the call's principal binding (M8) in TypeScript,
  Python and Rust, as integrity-protected input that never appears in the state, and a mismatch refused exactly as
  a tampered state is. Rust: the gate's HMAC associated data (`confirmations.rs`, a versioned layout) holds
  `afd::principal_binding` of the actor the hook left and `CommandContext::credentials`; `confirmation_binding`
  takes the principal (breaking, `server` feature). TypeScript: one HMAC bind tag over the method,
  `authInfo.clientId` and `principalBinding` (the actor the commands run with and `createContext`'s
  `credentials`) covers the round's state, so confirmation and approval-relay answers alike;
  `principalBinding`, `credentialsBinding` and `PrincipalCredentials` exported. Python: the SDK's sealed state,
  through `RequestStateSecurity(bind_principal=...)` with the server's `actor` and the SDK-verified token, so a
  mismatch is the SDK's `-32602`, as tampering is; `afd.server.principal_binding`, `credentials_binding` and
  `PrincipalCredentials`. TypeScript and Python load the `principalBindings` cases of `spec/authorization.json`.
  Each language's suite proves a state issued to one actor (and, where credentials exist, one issuer, subject and
  client) is refused for another with the tampered answer, that the same caller still succeeds, and that a state
  minted before the change fails closed; each fails with the binding removed. Credentials with a missing or empty
  issuer, subject or client id are never bound in any language: no state is minted and a retry is refused, both
  as an internal error naming no one (the coordinator's decision on this step's first question). Rust and Python
  have no approval relay yet (step 0d builds Rust's). Python has no per-request context hook, so its
  confirmations bind the server's fixed actor: a parity follow-up,
  [#800](https://github.com/lushly-dev/afd/issues/800). Choices are in the specification's
  [Amendments from step 0c](phases/5-auth-hosted/spec.md#amendments-from-step-0c).
- **Done:** step 0d, AFD's Rust relay, 2026-11-07, in the step 0d pull request (on top of steps 0a to 0c, merged):
  `CommandDefinition::with_confirmation_mode(CommandConfirmationMode::HostVerified)` (`confirmationMode` in `_meta`,
  grouped actions and `afd-detail`; named apart from the server's `ConfirmationMode`); the `HumanRelay` trait with
  `RelayCall`, `RelayPrompt` and `RelayOutcome` on `McpServer::with_human_relay`; the gate that never sends a form or
  takes an acknowledgement or form answer for such a command, whatever `confirmations` says, relays only one command
  per call on MCP 2026-07-28, validates before `begin`, answers with one URL-mode elicitation whose `elicitationId` is
  the URL's digest and never to a client without URL mode, and maps `decline`, `cancel` and the four outcomes as the
  spec gives; relay evidence in a crate-private context field, checked by the approval middleware in rule 3's order and
  spent once as `relay:<decisionId>` for 24 hours, removed before the handler runs; `afd::input_digest`, which
  `tests/authorization_cases.rs` now checks the `inputDigests` cases against; and the form-mode approval relay
  (`ApprovalRelay::McpElicitation`), sharing one principal-bound `requestState` per call with the confirmation
  (`afd.confirm.v3`; older states are asked again). Tests: `tests/server_human_relay.rs` end to end with a fake
  relay, additions to `tests/server_confirmations.rs`, and unit tests of the evidence checks; a mutation pass removed
  each security check in turn and a test failed for every one but two second-layer guards behind tested checks. An
  independent security review found no blocker and two improvements (no token on the form relay's MCP fallbacks
  whatever `with_include_token` says; a test for the scope check before `begin`), fixed with a regression test each.
  Choices are in the specification's [Amendments from step 0d](phases/5-auth-hosted/spec.md#amendments-from-step-0d).
  Verified 2026-11-07 with every `rust.yml` leg, the wasm32 checks, the docs.rs build and the rest of the
  `pnpm verify` plan (exit codes in the step 0d pull request); Umbel's `cargo test` ran in batches with test
  executables pruned between them, plus `umbel-plugin-curator`, which the batch scripts leave out.
- **Done:** step 0e, AFD's Rust tasks, 2026-11-07, on `lush/afd-rust-tasks` (on top of steps 0a to 0d, merged),
  completing the AFD prerequisites 0a to 0e: `CommandDefinition::with_task(TaskSupport)` (`task` in `_meta`, grouped
  actions and `afd-detail`), refused at registration beside `confirm_prompt`, an approval policy or
  `confirmation_mode` (the `validate_person_gates` hook step 0d left); `afd::server::tasks` with the `TaskStore` trait
  (3.3's shape: `create` durable before returning, `get` and `update` by owner, `expire`), the bounded
  `InMemoryTaskStore` (32 tasks per owner, 256 in all), `TaskOptions` (`ttlMs` 1 hour, `pollIntervalMs` 1 s, a 1 s
  check interval, results kept to 1 MiB), `McpServer::with_task_store` and `with_task_options`; the `tasks/get`,
  `tasks/update` and `tasks/cancel` handlers on `rmcp` 3.9's task types and hooks (not its `TaskManager`); tasks only
  for single-command calls on MCP 2026-07-28 requests that declare the extension, `-32021` for `required` otherwise,
  and `INVALID_BATCH_REQUEST` or `INVALID_PIPELINE_REQUEST` for a batch or pipeline naming a `required` command; 128-bit
  ids; the owner as the principal binding, checked by the store and again by the server, with one byte-identical
  `-32602` for another principal's, an expired or an unknown task; the runner's `CancellationSignal` on `tasks/cancel`,
  the TTL and the credentials' `expiresAt` (`TASK_TOKEN_EXPIRED`, which joins the shared catalog, 48 codes, in all four
  languages); `CommandContext::report_progress` and `cancellation`. Tests: `tests/server_tasks.rs` over Streamable HTTP
  (with and without the bearer layer) and stdio, on a manual clock; a mutation pass removed each security check in turn
  and a test failed for every one. An independent security review found no blocker and seven improvements, fixed with
  a regression test each: a handler that returned before a cancel keeps its result, and `TASK_TOKEN_EXPIRED` is not
  retryable for a mutation that may have run; finished tasks make room in a full store; at most 64 tasks run per
  process; `TaskOptions` clamps behind getters; `with_ttl_capped_at_token_expiry(grace_ms)` lets a host end a task's
  TTL at its token's `exp` (12.2); the in-server fail-closed check on `tasks/*` is tested; and a server that cannot tell
  its HTTP callers apart creates no task (settled by the strictest reading: no extension declared, `optional` inline,
  `required` refused with `UNAUTHORIZED`; tasks over HTTP need verified credentials or
  `TaskOptions::with_callers_identified_by_hook()` with a hook). Choices are in the
  specification's [Amendments from step 0e](phases/5-auth-hosted/spec.md#amendments-from-step-0e).
- **Done:** step 1, Umbel's shapes, 2026-11-07, in [#823](https://github.com/lushly-dev/afd/pull/823) (on top of steps 0a to 0e, merged):
  - **Schemas**, each closed JSON Schema 2020-12 with examples: `workspace-config.v5`, `plugin-manifest.v5`,
    `principal.v1`, `provenance-envelope.v3` and the shapes nesting it (`event.v3`, `memory-record.v2`,
    `proposal.v3`), `cursor.v1`, `locator.v2`, `task-record.v1`, `usage-event.v1`, `person-decision.v1` and
    `protected-resource.v1`.
  - **Configuration version 5** (`src/workspace/hosted.rs`), parsed into typed configuration and validated with
    every rule of section 2.2 at open (`WORKSPACE_CONFIG_INVALID` with `details.key`): `[auth]` (modes, the scope
    prefix, namespaces with their person logins, issuers, the gateway), `[http.tls]` and `http.public_url`,
    `[limits]`, `[usage]`, `[principal.equivalents]`, group claims, and the `memory_write` table's `editors`,
    `erasers`, `erase_approvals` and `erase_approval_window_s`. Versions 1 to 4 read as version 5 with `auth.mode
    = "none"` and refuse the new keys ("needs config_version = 5"); `umbel init` writes version 5.
  - **Manifest version 5** (`src/plugins/manifest/v5.rs`): `person` per surface on a `require-human` command, MCP
    exposure of such a command only with `person.mcp`, the preview and `journal.keep` rule, `task` and its
    refusals, both on pipelines with the "every step admits" rule at seal (`pipelines::plan`). Versions 1 to 4
    still load; `spec/plugin-manifest.md`'s P3 lists `task` and `person` as Umbel's from version 5.
  - **Constants** in `src/auth/mod.rs` (the scope grammar and order, the namespaced id form, the defaults and
    bounds), and the version lists `workspace-show` reports (`config` and `manifest` 1 to 5, `principal` 0 and 1,
    `envelope` and `event` 0 to 3, `proposal` 1 to 3, `cursor` 0 and 1, `locator` 1 and 2, `memory` 1 and 2,
    `task`, `usage` and `person` 1).
  - **Fail-closed seams until later steps:** a hosted configuration opens, but the HTTP surface refuses to start in
    a hosted mode, with `[http.tls]` or on a non-loopback bind until step 2a builds the listener; a `require-human`
    command with `person.mcp` stays off MCP, and every call to one with `person.cli = "verified"` is refused with
    `PERSON_VERIFICATION_UNAVAILABLE`, until step 5.
  - An independent review found one blocker (a `person.cli = "verified"` command ran on the terminal check) and nine
    improvements, all fixed with tests and recorded as "(review)" rows in the amendments.
  - Tests: `tests/config_v5.rs`, `tests/manifest_v5.rs`, `tests/schemas/phase5.rs`,
    `tests/schemas/phase5_records.rs`; older tests follow the version bump. Choices are in the specification's
    [Amendments from step 1](phases/5-auth-hosted/spec.md#amendments-from-step-1).
- **Done:** step 1b, the test identity provider, 2026-11-07, in the step 1b pull request: the test-only crate
  `umbel-testkit-idp` (`endpoints/umbel/testkit-idp`, `publish = false`, quarantined in the release inventory with no
  route, no binary). `TestIdp::start()` binds `127.0.0.1` with a test CA made in memory and plays three roles on one
  HTTPS listener: an OpenID Connect identity provider (discovery at the path-inserted and appended well-known URLs,
  a JWKS, a scripted login or a password form for `ada`, `bo` and `cy`, a PKCE `S256` token endpoint issuing ID tokens
  with `nonce`, `auth_time`, `acr`, `amr` and `groups`, and the RFC 8693 exchange to an ID-JAG); a resource
  authorization server (RFC 8414 metadata, a JWKS, authorization code with PKCE, client credentials, the RFC 7523
  grant redeeming an ID-JAG, RFC 9068 tokens for one audience, certificate-bound over mTLS, and RFC 7662
  introspection with client authentication); and the gateway signer of section 4.4. `TokenBuilder` with `Break`
  breaks one rule of section 3.2 at a time and names AFD's rule code; `IntrospectionAnswer`, `Fault`, metadata
  patches, key rotation, recorded authorization requests and a counting plain-HTTP listener script the rest; the
  kit runs on its own thread and runtime. Keys: RSA, P-256, P-384, Ed25519. Its suite (36 tests: 34 in six integration files, 2 unit tests)
  verifies the kit's access tokens with AFD's `JwtVerifier` and `check_introspection`, every break refused with its
  rule while the unbroken token passes. The host's `tests/no_auth_server.rs` (section 1) checks the manifest,
  `cargo metadata` reachability, the routing calls of every workspace crate and a probe of every router, and failed
  as it should under a mutation run. A repository-contract test holds the unit private and route-less. An independent review found one blocker
  (the token exchange's error for a bad subject token) and eight improvements, all fixed and re-reviewed. Choices are in
  the specification's [Amendments from step 1b](phases/5-auth-hosted/spec.md#amendments-from-step-1b). Verified
  2026-11-07 with `cargo fmt --all --check`, the workspace clippy, the kit's suite, `no_auth_server.rs`, Umbel's
  tests in batches and `pnpm check` (exit codes in the step 1b pull request).
- **Done:** step 2a, the host's listener and layers, 2026-11-08, in the step 2a pull request:
  - **The listener** (`Host::http_server`, `HttpServer::serve`; `src/surfaces/http/listener.rs`): HTTP/1.1 on hyper,
    as `axum::serve` is built, putting the socket's peer address and, from the TLS handshake, AFD's
    `ClientCertificate` in every request's extensions; never a header for either. `umbel serve --http` uses it; the
    bare `Host::http_router()` serves mode `none` without TLS only.
  - **TLS** (`http/tls.rs`): rustls 1.3 and 1.2 on the explicit `aws-lc-rs` provider, ALPN `http/1.1`, no session
    resumption, and `client_auth`: `none`; `ca` (required, chained to `client_ca`); `any` (optional, possession only,
    for RFC 8705 binding).
  - **Section 6.3's layers in order** (`http.rs`, `http/layers.rs`): the body size limit (413 on a declared length
    before anything reads it, and on a streamed body past the cap), the per-IP limit (a sliding minute on
    `state/shared/limits.sqlite3`, shared by every process, IPv6 by /64; 429 with `Retry-After`), `/health` and the
    protected-resource metadata at both well-known paths in public, then AFD's bearer layer and MCP service built
    from one authorized server (`authorized_http_service`), with hosted host checks on `http.allowed_hosts` alone.
  - **The context hook, version 1 skeleton** (`src/principal.rs`): over HTTP it dispatches on `auth.mode` and
    fails closed in `oauth` and `gateway`.
  - **What still failed closed** (step 2b lifted the first two): mode `oauth` refused to start in a shipped build until step 2b filled the token
    verifier slot from `[auth.issuers]` (only the `testkit` seam `HostBuilder::with_token_verifier` fills it now), and
    even then the hook refused every call until step 2b mapped credentials to a principal; mode `gateway` refuses to
    start until step 4; the per-token limit is step 3's; the doctor's `auth.*` checks are step 2c's.
  - The default `auth` feature (`afd/server-auth`, `tokio-rustls`, `rustls-pki-types`, `rusqlite`); `umbel-first-party`
    enables it.
  - Tests: `tests/auth_layers.rs` (each layer by what a request meets there, TLS and mTLS, the thumbprint from the
    handshake and never from a header, the metadata, the IP limit across two processes, the body caps, the 401 shape,
    a missing layer failing closed, stdio and the CLI unaffected, what refuses to start), `no_auth_server.rs` with the
    `oauth` router probed over TLS, and unit tests in `src/shared/limits.rs` and `src/surfaces/http/layers.rs`; a
    mutation run of thirteen checks (resumption, the hook's mode checks in `oauth` and `gateway`, the certificate,
    both body caps, the body deadline, a refused body staying refused, `client_auth = "ca"`, the hosted host list, the
    metadata's issuers, the host server's own authorization) failed each as it should.
  - An independent security review found two blockers (the host's own `mcp_server()` listed its tools over HTTP
    without the listener in a hosted mode, now fail-closed by an authorization that admits no one; and the documents,
    written after its snapshot), seven improvements and five nits (a connection cap, a body deadline, bounded
    and remembered limit checks, the system clock for limits, narrowed permissions, tests for forged identity and
    forwarding headers and the hook's gateway branch), all fixed with regression tests. Choices are in the
    specification's [Amendments from step 2a](phases/5-auth-hosted/spec.md#amendments-from-step-2a).
  - **Settled 2026-11-08** (the review's two rate-limit follow-ups; neither changes the trust model): no forwarded
    header is ever read, and step 3 adds an opt-in `http.trusted_proxies`, which accepts a PROXY protocol version 2
    header only from listed peers, for a same-host proxy; IPv6 peers stay keyed on their /64.
- **Done:** step 2b, the host's verification and principal, 2026-11-08, on `lush/umbel-p5-2b-verification`:
  - **Keys** (`src/auth/keys.rs`, `fetch.rs`): Umbel's `KeySource` over `reqwest`, with RFC 8414 discovery (path
    inserted, then OIDC inserted, then appended; only a 404 moves on), the `issuer` check, an `https` `jwks_uri`, no
    redirect, 1 MiB and 10 seconds per fetch, a cache of 5 minutes to 24 hours, at most one fetch a minute per issuer,
    and the last good keys kept until their cache ends, then fail closed.
  - **Verification** (`verifier.rs`, `introspection.rs`): AFD's `JwtVerifier` built from `[auth]` (the public URL,
    the skew, the lifetime, the scope prefix and limit, bound tokens, each issuer's algorithms), and the one
    introspection issuer with Umbel's client credentials and a 60-second cache of accepted answers by the token's
    SHA-256, bounded to 32 requests in flight and tokens of 4096 bytes. A fetch runs on a task of its own, so a client
    that hangs up cannot spend the minute's one fetch. A shipped build still refuses to serve `oauth` until the
    disclosure controls of steps 2c, 3 and 7 exist; the `testkit` seam `with_unfinished_oauth` serves it for tests. Settled 2026-11-08 as the
    strictest reading: a shipped build serves `oauth` only once 2c, 3 and 7 have all landed.
  - **The caller** (`mapping.rs`, `caller.rs`, `src/principal.rs`): section 4.1's mapping (namespaces, subject
    claims, services three ways, the `~` form), `act` from an `act` issuer, claim groups, into principal version 1,
    which every surface now writes (`humanPresent` stays `null` until step 5). The hook trusts the mapped caller only
    beside the credentials AFD admitted for the same request.
  - **Equivalents** (`src/access.rs`): consulted by readers, group members and reader-filter tokens, the memory
    services' ownership check, and the knowledge plugin's self-approval through the SDK's new
    `CallContext::equivalents`.
  - **Until step 3** (`interim.rs`): only unqualified scopes authorise a verified call, and every request needs
    `<prefix>:read` itself (plus write, approve or erase as the command needs); space-qualified scopes alone get a
    403 naming the unqualified ones.
  - **What still fails closed or waits:** serving `oauth` in a shipped build (until 2c, 3 and 7); space-qualified
    scopes, 5.4's one answer, 9.4's listings and `Caller` in `reader_filter` (step 3); hidden counts (step 7); the
    doctor's `auth.*` checks, `auth-show` and `workspace-show`'s hosted answer (2c); `gateway` (step 4); `humanPresent` and the person
    page (step 5); the memory plugin's own equivalents (step 10) and cursor files (step 7).
  - Tests: `tests/auth_tokens.rs` (every rule of 3.2 broken alone by the kit through the host, with its logged code;
    routing; the `[auth]` settings; bound tokens; introspection and its cache), `tests/auth_keys.rs`,
    `tests/token_canary.rs`, `tests/principal_v1.rs`, and unit tests in `src/auth/` and `src/access.rs`. Choices
    are in the specification's [Amendments from step 2b](phases/5-auth-hosted/spec.md#amendments-from-step-2b).
  - An independent security review found two blockers (a client hanging up mid-fetch spent the minute's one key
    fetch; lifting `oauth`'s refusal would have served disclosures later steps close) and six improvements, all
    fixed with regression tests.
- **Done:** step 2c, the host's doctor and introspection, 2026-11-08, on `lush/umbel-p5-2c-doctor`:
  - **The doctor's hosted profile** (`src/auth/doctor.rs`, `src/auth/files.rs`): every `auth.*` check of section
    6.1 with its severities, after `http.config`: `auth.mode` (warns while this build does not serve the mode),
    `auth.public_url`, `auth.tls` (every certificate's validity, the key readable by its owner only, trust files
    writable by no one else, the listener's own loading, the gateway's pinned key set), `auth.ca_files`,
    `auth.issuers` (3.3's discovery, the key set and its fit to the algorithms, the introspection endpoint called
    with Umbel's credentials and a made-up token), `auth.subjects`, `auth.services`, `auth.principals` (every
    principal the configuration grants to), `auth.person`, `auth.secrets` (by variable name, never a value),
    `auth.shared` (writable, and a local file system by `statfs`) and `auth.confirmations`. No check prints a
    secret, a token, a key or a remote value.
  - **The doctor is the operator's** in a hosted mode: CLI only, and its handler refuses any other caller.
  - **`auth-show`**: the caller's own projection, exactly section 10.3's eight members, never a token or claim.
  - **`workspace-show`'s hosted answer**: no name or path, only the spaces the caller reads, for every caller but
    the operator; `access` says `verified`, with statistics `shared` until step 7.
  - **`ca_file`** (the follow-up settled 2026-11-08): `[auth.issuers.<alias>] ca_file` in configuration version 5
    and its schema; the verifier gives that issuer a client trusting only those roots, and refuses to start on a
    file that is unreadable, empty, expired or not yet valid.
  - **Serving `oauth`** in a shipped build is still refused (settled 2026-11-08: only once 2c, 3 and 7 have
    landed); 2c's control is in, and 3 (5.4's one answer, 9.4's listings, and the plugin listings that name
    spaces, found here) and 7 (hidden counts) remain.
  - Tests: `tests/doctor_auth.rs`, `tests/auth_show.rs`, the `ca_file` cases of `tests/auth_keys.rs`,
    `tests/config_v5.rs` and `tests/schemas/phase5.rs`, and unit tests in `src/auth/doctor.rs` and `files.rs`.
    No plugin crate changed. Choices are in the specification's
    [Amendments from step 2c](phases/5-auth-hosted/spec.md#amendments-from-step-2c).
  - An independent security review found one blocker (`auth.subjects` and `auth.person` read the RFC 8414
    document where the provider's OpenID Connect discovery document could say otherwise) and eight improvements
    (a `ca_file` root expiring after start stayed trusted; two time limits where the verifier has one; file owners
    and directories unchecked; unbounded file reads; the operator test without the CLI interface; the doctor's
    gate following only the sealed configuration; missing tests; a login-only issuer's `ca_file`, a step 5
    follow-up), with four nits; all fixed, each with a regression test where one can be written.
  - Verified 2026-11-08 on the branch: `cargo fmt --all --check`; the workspace clippy `-D warnings`, the three
    `--no-default-features` legs, the SDK and hello leg, the `wasm32-wasip2` leg and the two plugin jobs' clippy;
    the component builds and `hello-mcp`; Umbel's host tests in batches (88 suites, 1022 tests) and the other
    crates, conformance and external clients (139 suites, 937 tests; 34 of 34 cases on each conformance lane);
    `pnpm check`; Loam's web build and `test:mounted` (24 tests). All exited 0.
- **Done:** step 3, the host's scopes, access, shared state and limits, 2026-11-08, on `lush/umbel-p5-3-scopes`:
  - **Scopes** (`src/auth/scopes.rs`, `scope_gate.rs`): section 5.2's rules as one policy fixed at seal, for
    Umbel's `ScopeResolver` (the 403 before dispatch, `Defer`, `visible`, and AFD's check at execution) and the
    scope gate inside the registry. A call needs `read` in each of its spaces (its `space` or `spaces` input, else
    the default space), `write` there for a mutation, `approve` for an approval policy, a host-verified mode or
    `require-human`, `erase` for an erase; a space-less command needs any Umbel scope plus its other verbs
    unqualified, and a mount without `bind_space` unqualified `write`. A token with no Umbel scope is 403 on every
    request. Step 2b's interim rule is gone.
  - **One answer** (`src/access.rs`, `src/middleware.rs`): `Caller` in every `reader_filter`; an undeclared space
    and one the caller may not read, or its token grants nothing in, answer byte for byte alike to every hosted
    caller but the operator (stdio and the library included), on every route, with nothing of the space in the
    answer; readability before scope and before `PLUGIN_NOT_ENABLED`. Mode `none` and the operator are unchanged.
    The resolver finds each request's mapped caller in an in-flight book, and defers when it cannot.
  - **Listings**: `space-list`, `plugin-list`, `plugin-show` and `skill-list` name only the spaces, instances and
    skills of spaces the caller reads (2c's follow-up); counts stay step 7's.
  - **Shared state** (`src/shared/nonces.rs`): `state/shared/nonces.sqlite3`, an atomic spend across processes, in
    the approval middleware (approval nonces and `relay:` evidence) in hosted modes; a failed spend is answered as
    the store's failure. Mode `none` keeps AFD's store in memory.
  - **Limits**: the per-token limit at layer 6 (`calls_per_minute`, per issuer, subject and client) and the read
    limit in the registry (`read_bytes_per_minute` per effective principal, checked before the handler on bytes
    already used, opened on the first limited call), on `limits.sqlite3`'s counters (schema version 2), each named
    by an HMAC under the new `state/keys/limits.key`.
  - **`http.trusted_proxies`** (2a's settled follow-up): a PROXY protocol version 2 header read only from listed
    peers and required of them, its client keying the per-IP limit; a configuration version 5 key with its schema
    and the doctor's `auth.trusted_proxies`.
  - **Serving `oauth`** in a shipped build is still refused: 2c's and 3's controls are in, and step 7 (hidden counts
    and positions) remains.
  - Tests: `tests/scope_gate.rs`, `space_visibility.rs`, `shared_nonces.rs`, `limits.rs`, `confirm_binding.rs`,
    `trusted_proxies.rs`, and unit tests in `src/auth/`, `src/access.rs`, `src/shared/` and
    `src/surfaces/http/listener.rs`. No plugin crate changed. Choices are in the specification's
    [Amendments from step 3](phases/5-auth-hosted/spec.md#amendments-from-step-3).
  - **Hidden instances**: a plugin command whose instance serves no space a token-narrowed hosted caller reads
    answers as an unknown command; a space member a command does not declare is refused before anything reads it.
  - A mutation run removed each security check in turn; a test failed for each (one equivalent mutant, recorded).
    An independent security review found one blocker (an undeclared `spaces` member reached spaces the scope rules
    never checked) and six improvements (a hidden instance revealed by calling it; a withheld grant's note; mode
    `none` and the operator depending on `state/shared/`; a failed spend answered as a spent token; the caller
    lookup's linear scan; reversible counter names), with six nits; all fixed with regression tests. One follow-up
    went to AFD (a hidden command must look unknown before input validation too), done the same day (below).
  - Verified 2026-11-08 on the branch: `cargo fmt --all --check`; the workspace clippy `-D warnings`, the three
    `--no-default-features` legs, the SDK and hello leg, the `wasm32-wasip2` leg and the two plugin jobs' clippy;
    the component builds and `hello-mcp`; Umbel's host tests in batches (91 suites, 1070 tests) and the other
    crates, conformance and external clients (139 suites, 937 tests); `pnpm check`; Loam's web build and
    `test:mounted` (24 tests). All exited 0.
- **Done:** step 3's follow-up to AFD, hidden commands, 2026-11-08, on `lush/afd-rust-hidden-before-validation`:
  `spec/authorization.md` M6 specifies them, and AFD's Rust server answers a command its resolver's new `known`
  rejects (with filtered listings) byte for byte as an unknown name on every route, before validation, middleware,
  confirmation, relay or task. Umbel's resolver implements `known` as 9.4's hidden instance (`ScopePolicy::known`),
  wider than `visible`, so a command the caller may learn of but not call keeps 5.4's 403 naming its missing scope.
  The hidden-instance check stays as defence in depth. Tests: `tests/space_visibility.rs` (invalid, valid and no
  input, through the command's own tool, `afd-call`, `afd-batch`, `afd-pipe` and `afd-detail`) and a unit test in
  `src/auth/scopes.rs`. Choices are in the specification's
  [Amendments from AFD's hidden commands](phases/5-auth-hosted/spec.md#amendments-from-afds-hidden-commands).
- **Done:** step 7, the stores' exact filtering, 2026-11-08, on `lush/umbel-p5-7-exact-filtering`:
  - **Knowledge statistics per reader filter** (9.1; `store-embedded/src/index/stats.rs`): a search scores through
    tantivy's `Bm25StatisticsProvider` over the chunks its reader may read, deleted ones excluded, with exact
    per-chunk token counts in index schema 2's `len_<field>` fast fields (equal to tantivy's own totals on an index
    without deletes); cached per segment set and filter. A prefix expands only into terms a readable chunk holds,
    and a snippet weighs its terms by readable chunks. `index/v1/` is removed when schema 2 opens; the next
    `knowledge-index` rebuilds.
  - **Memory BM25 per reader filter** (9.2; `store-embedded/src/memory/rank.rs`): recall ranks every readable match
    with FTS5's own `bm25()` formula over the reader's statistics (its readable records, their lengths, and how many
    hold each phrase), tokenised by `umbel-store`'s memory tokenizer (a port of FTS5's `porter unicode61
    remove_diacritics 2`, held to FTS5's own tokens over every non-ASCII code point); ties by authority tier, then
    recency, then id; over 50 000 readable matches is `MEMORY_QUERY_TOO_BROAD`.
  - **Positions** (9.3; `src/positions.rs`): to a hosted caller that is neither the operator nor stdio, cursors are
    version 1, revisions `r1.` tokens, a locator version 2, each the sealed last position it can read
    (XChaCha20-Poly1305 with a synthetic nonce under `state/keys/cursor.key`); `event-list` pages, heads and event
    views (`event-view.v1`: no `seq`, `journalSeq`, `changes` or record version), `event-ack`, `space-list`'s counts,
    every revision the knowledge and context plugins show (through the SDK's `Cx::doc_position`), the plugin gate's
    `dev.umbel/index`, `dev.umbel/changes` and record versions (the changes and versions kept whole for the
    journal under a random reference), `knowledge-index`'s totals and limit, and `sources-sync`'s and
    `sources-status`'s counts. Revisions are the last readable document change, so space-readable bookkeeping
    records move no position. `store-show`, `event-rebuild`, `store-check` and `store-backup` are the operator's in
    hosted modes, from the library too. Mode `none`, the operator and stdio are unchanged.
  - **Follow-ups closed:** event ids and sequence numbers (step 1), `space-list`'s counts (step 3),
    `workspace-show`'s `statistics: "per-filter"` (step 2c), stored cursor files consulting the equivalents (step
    2b).
  - **Serving `oauth`**: lifted. A shipped build serves mode `oauth`; the `testkit` seam `with_unfinished_oauth` is
    removed. `gateway` still waits for step 4, and person-gated commands for step 5.
  - **The eval** re-ran (`eval_gate.rs`): leaks 0, every unanswerable query empty, and every metric equal to
    `eval/baseline.json` to four places (overall with expansion: recall 1.0, nDCG 0.9273, MRR 0.9207; without:
    recall 0.8919, nDCG 0.9123, MRR 0.8784), before and after the review's fixes, so the baseline is unchanged.
  - **Independent security review** (read-only, of the diff against the specification): two blockers and seven
    improvements, all fixed with a regression test each (`knowledge-index`'s limit and lists, cursor files per
    person on a shared client, ties past the collector's window, the CLI-only built-ins from the library, the
    journal's stash reference, positions moved by sources' sync state, `sources-sync` and `sources-status` counts).
    AFD's numbered batch trace ids, a prefix's expansion time and three source-tree signals of `sources-sync` are
    follow-ups.
  - Tests: `store-embedded/tests/partitioned_stats.rs`, `store/tests/memory_tokenizer.rs`, `tests/cursor_v1.rs`,
    `eval_gate.rs`, `first-party/tests/exact_filtering.rs`, and unit tests in `stats.rs`, `rank.rs`, the tokenizer
    and `positions.rs`. Plugin crates changed (`knowledge`, `context`, `memory`, `sources-filesystem`). Choices are in the specification's
    [Amendments from step 7](phases/5-auth-hosted/spec.md#amendments-from-step-7).
