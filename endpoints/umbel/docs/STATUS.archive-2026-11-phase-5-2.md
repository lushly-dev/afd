# Umbel status archive: phase 5, part 2 of 2

Moved verbatim from [STATUS.md](STATUS.md) on 2026-11-23 ([#1803](https://github.com/lushly-dev/afd/issues/1803)), which is the index and the
current record. A line here keeps the wording it had when it was moved and is not updated after:
a status recorded here may have changed since, though the detail of a phase still open (its
decisions, what its exit has not proven) still applies unless the index or the phase's
specification says otherwise. A link to `#heading` in a moved line named a heading of STATUS.md as
it stood then; the heading is in this file or, through "Headings in other files" at the end, in
another archive file, which the index lists under [Archive](STATUS.md#archive). A moved line is
never edited; a change of status goes in the index.

### Phase 5. Auth and hosted (continued)

- **Done:** step 4, the host's gateway mode, 2026-11-08, on `lush/umbel-p5-4-gateway`:
  - **The channel** (`src/auth/gateway.rs`): with `client_auth = "ca"` and pins, the handshake's certificate must be
    pinned; otherwise (a loopback bind) the connection's own local address must be loopback (`LocalAddr`, a new
    listener fact), and any pins must match too. Pins need a client certificate to reach Umbel (`client_auth` other
    than `none`), checked at open.
  - **The assertion**: exactly one `Umbel-Gateway-Assertion` of at most 4096 bytes; strict JSON; `typ` exactly
    `umbel-gw+jwt`; AFD's header rules against the pinned key set, whose every key names its `alg` and is checked
    with AFD's `check_key_fit` when the file is read (at start, with the doctor's permission rule); the signature
    through `jsonwebtoken`'s `aws-lc-rs` provider; `iss`, `aud` and `htu` byte for byte, `htm` the method; `sub`,
    `client`, a 128-bit `jti`, a well-formed `scope`; no `cnf`; whole-second times within the skew and the age
    limit, 1 to 60 seconds long. Then the `jti` is spent once in the shared nonce store (`gateway:<jti>`), so a
    refused assertion spends nothing and a replay on another process is refused. Every refusal is one 401,
    `WWW-Authenticate: Umbel-Gateway realm="umbel"`, its reason logged as a rule code.
  - **The caller**: section 4.1's mapping in the gateway's namespace, `authentication` `gateway`, no binding, no
    person, no claim group; scopes cut to `max_scopes` by section 4.4's meet; nothing left is the gateway's own 403.
    The assertion and any `Authorization` header are removed before the service.
  - **The surface** (`src/surfaces/http/gateway.rs`): section 6.3's layers with the gateway layer at 5, `/health`
    the only public route (no metadata), and AFD's admission (`Authorization::admit`) into a server holding Umbel's
    resolver, so steps 3 and 7 apply unchanged: the scope gate, the one answer, filtered listings, hidden commands,
    the per-token and read limits, sealed positions. A call's missing scope is `INSUFFICIENT_SCOPE` after routing
    (superseded 2026-11-08 by the 403 before dispatch; see the follow-up's entry below).
  - **The doctor**: `auth.mode` passes; `auth.tls` loads the key set with the layer's own loader and names the
    channel, warning on the loopback leg without pins; `auth.subjects` lists the gateway among its namespace's
    subject sources.
  - **Limits**: a connection presenting a pinned certificate is the gateway, authenticated at the channel, and skips
    the per-IP limit; the per-caller limits after verification govern it. Every other connection keeps it.
  - **One deviation**: a gateway caller's missing scope is `INSUFFICIENT_SCOPE` after routing (before the
    confirmation gate and any person), not 5.2's 403 before dispatch, as AFD offers a host's own layer no
    pre-dispatch decision; a follow-up to AFD. **Closed 2026-11-08** by the follow-up's entry below. Its suggestion names a new assertion, never a token (AFD's additive
    `ProtectedResource::with_scope_source`).
  - **Review**: a mutation run removed each security check in turn (44 mutants, all killed). An independent security
    review found no blocker, four improvements (pinned keys that could never verify, the `jti` retention untested,
    the per-IP limit in gateway mode, two invariants kept at one call site) and five nits (the 403's shape and
    wording, `max_assertion_age_s` capped at 60, boundary tests, a follow-up for step 8's tasks, the key file
    checked as opened); all fixed with regression tests.
  - Tests: `tests/gateway_mode.rs` (accepted callers, every rule broken alone with its exact logged code, replay
    across two hosts on one workspace, the pinned and loopback channels, no identity header, no metadata, the key set
    at start, steps 3 and 7 for gateway callers, the per-token limit), the gateway router of `no_auth_server.rs`, the
    gateway cases of `doctor_auth.rs`, `config_v5.rs` and `auth_layers.rs`, and unit tests in `src/auth/gateway.rs`,
    `src/surfaces/http/gateway.rs`, `src/principal.rs`, `src/auth/scopes.rs` and `src/auth/scope_gate.rs`. No
    plugin crate changed; `umbel-testkit-idp`'s `GatewaySigner` is `Clone`; the afd crate gains
    `ProtectedResource::with_scope_source`. Choices are in the specification's
    [Amendments from step 4](phases/5-auth-hosted/spec.md#amendments-from-step-4).
- **Done:** step 4's follow-up to AFD, the decision before dispatch for a host's own layer, 2026-11-08, on
  `lush/afd-predispatch-scope-decision`: `spec/authorization.md` M6 specifies "A host's own layer", and AFD's Rust
  server exposes the bearer layer's own decision as `McpServer::pre_dispatch_check` (`PreDispatchCheck::decide`,
  `PreDispatch`, and `ScopeChallenge` for a host's own scheme); `BearerLayer` runs the same value. Umbel's gateway
  layer runs it after admitting the caller, so a gateway caller's missing scope is 5.2's 403 before dispatch,
  `WWW-Authenticate: Umbel-Gateway realm="umbel", error="insufficient_scope", scope="<missing>"`, with AFD's body and
  the gateway's suggestion; layer 6's 403 in mode `gateway` is now the same body and challenge, so an assertion with
  no Umbel scope gets one answer for every name. The parity tests found that AFD asked the resolver about a grouped
  call's tool name even when it was a hidden command's; AFD now decides a grouped call that resolves to no command on
  the required scopes alone. An independent review found one blocker, fixed: a call without an `action` of a tool
  that is both a group and a command, whose members the caller was shown none of, was decided as a group while the
  router ran the command (without its scopes under the static rule with filtered listings); AFD now names it as the
  router does. Its three improvements and two nits are fixed too. Tests: AFD's `tests/server_auth_pre_dispatch.rs` (every request of a matrix through the
  bearer layer and a host layer, byte for byte, in every strategy, under the static rule and a scope-naming resolver
  that hides commands), `tests/gateway_mode.rs`, and unit tests in `src/surfaces/http/gateway.rs` and
  `src/auth/gateway.rs`. Choices are in the specification's
  [Amendments from AFD's pre-dispatch decision](phases/5-auth-hosted/spec.md#amendments-from-afds-pre-dispatch-decision).
- **Done:** step 5, the host's person page, 2026-11-08, on `lush/umbel-p5-5-person-page`:
  - **The relying party** (`src/person/oidc.rs`): the namespace's provider by its OpenID Connect discovery document
    alone, through the login issuer's own client (its `ca_file`, step 2c's follow-up); authorization code with PKCE
    `S256`, `nonce`, `prompt=login`, `max_age`, `acr_values` and a `claims` request; the code exchanged with
    `client_secret_basic`; the ID token checked by Umbel's own code (AFD's header rules, the key's fit, the signature,
    `iss`, one `aud`, `azp`, times, `nonce`, `auth_time` fresh and after the login began), then `acr` and a
    user-verification `amr` on every login (`PERSON_VERIFICATION_INSUFFICIENT`), then the subject mapped as 4.1 maps
    it and matched to the decision's `for` ("This request is for another person").
  - **The page** (`src/person/page.rs`, mounted at layer 4 beside the MCP path): `GET <path>/d/<id>`, `GET
    <path>/d/return`, `POST <path>/d/<id>`; its own host check, origin check (`Origin`, or `Origin: null` with
    `Sec-Fetch-Site: same-origin`, which a browser sends under the page's own `no-referrer`), CSRF token, a `__Host-`
    cookie per login, its own limit; strict CSP, `X-Frame-Options: DENY`, `no-store`, `no-referrer`; everything
    escaped; the preview rendered at page time under the person's reader filter, only its hash kept; Decline alone
    when the preview cannot be shown.
  - **Decisions** (`src/shared/person.rs`, `state/shared/person.sqlite3`): bound to the command, the input digest and
    `for`; a login taken once with its cookie; decided once; expire after 10 minutes; spent once across processes
    (`person:<id>` by the relay or the CLI, `person-run:<id>` at the plugin gate); journaled as `person-decide`.
  - **The relay** (`src/person/relay.rs`): Umbel's `HumanRelay`, a `requestState` sealed under `relay.key`;
    `person.mcp` commands registered host-verified and served over MCP only in mode `oauth` with filtered listings,
    and only to callers whose namespace's login passes `auth.person` at serve time (step 2c's follow-up).
  - **The CLI's URL flow** (`src/cli/person.rs`): `person.cli = "verified"` prints the link and waits;
    `PERSON_VERIFICATION_UNAVAILABLE` lifted where the page is served; `PERSON_DECISION_EXPIRED`.
  - **Envelope version 3**: the host writes envelope and event version 3 (`delegationChain`), memory writes envelope
    version 3 (memory record version 2), and `memory-confirm` records its `assurance`.
  - **AFD** (additive, `server` feature): `RelayCall::input` and `::context`, `HumanRelay::approved_context`, public
    `CommandRegistry::validate`; `spec/command-metadata.md` and the crate's changelog record them.
  - Tests: `tests/person_page.rs` (32 end to end with the kit: the verified decision, every refusal, the relay, two
    hosts, the CLI, XSS, CSRF, headers, what is never shown or kept, serving per namespace, the review's fixes), unit
    tests in `src/person/` and `src/shared/person.rs`, a `doctor_auth.rs` case, and AFD's `server_human_relay.rs`
    for `approved_context`. A mutation run removed 18 security checks in turn; a test fails for each but the relay's
    re-check of `for` on resume, which sits behind the sealed state's binding.
  - **Independent security review**: one blocker (in mode `gateway` the gateway would stand between the person and
    the page; the page is not served there, an owner question), five improvements and nine nits; all fixed or
    recorded, each fix with a regression test. Plugin crates changed where envelope version 3 added a struct field
    (`memory`, `knowledge`, `curator`, `sources-filesystem`, `context`), and the `context` bundle leaves a
    confirmation's `assurance` out. Choices are in the
    specification's [Amendments from step 5](phases/5-auth-hosted/spec.md#amendments-from-step-5).
  - Verified 2026-11-08 on the branch, each exit code captured directly: `cargo fmt --all --check`; the workspace
    clippy `-D warnings`, the three `--no-default-features` legs, the SDK and hello leg, the `wasm32-wasip2` leg and
    the two plugin jobs' clippy (with the knowledge `--no-default-features` leg); the component builds and
    `hello-mcp`; Umbel's host tests in batches (94 suites, 1162 tests) and the other crates, conformance and external
    clients (143 suites, 981 tests; 34 of 34 cases on each conformance lane), and the knowledge plugin without
    default features (247 tests); every `rust.yml` leg of the afd crate and its docs.rs build; `pnpm check`; Loam's
    web build and `test:mounted` (24 tests). All exited 0.
- **Done:** step 5b, the person page in mode `gateway`, 2026-11-09, on `lush/umbel-p5-5b-gateway-person-page`, by the
  owner's decision of 2026-11-09 (a separate direct address):
  - **Configuration** (`src/workspace/hosted.rs`, `workspace-config.v5.json`): `[http.person]` with `bind`,
    `public_url` (an origin, `https://<host>[:<port>]`, on a host of its own: never `http.public_url`'s, since browsers
    send a host's cookies to every port of it), `allowed_hosts` (none shared with `http.allowed_hosts`) and
    `[http.person.tls]` (`cert` and `key` only); refused outside mode `gateway`; a bind sharing `http.bind`'s port
    refused, after `--bind` too.
  - **The listener** (`src/surfaces/http/person.rs`, `Host::person_server`, `umbel serve --http`): its own TLS asking
    no client certificate, a 4 KiB body cap, a per-IP limit under its own keys, a host check (421) on every route,
    then `/health` and the page's routes under `/d/` alone; no MCP, no metadata, no gateway layer. The gateway-facing
    listener never mounts a page route (404).
  - **The page** on that origin: the relay's and the CLI's links, the OpenID Connect `redirect_uri`, the `__Host-`
    cookies, the `Origin` and CSRF checks and the CSP's `'self'` all name it; section 7.2 is otherwise unchanged. A
    gateway caller's `for` is the gateway's alias, its `client`, its namespace and its `sub` mapped as 4.1 maps it, and
    the login's subject must map to the same.
  - **Serving**: mode `gateway` serves `person.mcp` and `person.cli = "verified"` with `[http.person]`,
    `auth.filter_tools_by_scope`, and a namespace login passing `auth.person`; otherwise none, as before.
  - **The doctor**: `auth.person_listener` (the certificate's validity, permissions and name, a wildcard warned, the
    key, the listener's own loading, the host neither `http.public_url`'s nor the gateway issuer's, both binds loopback
    failed, whether it is served at all, and the page probed at its origin for its own certificate and headers).
  - **Independent security review**: no blocker in the code; one question, settled as the strict reading of the
    owner's decision: the link reaches the client through the gateway, which could swap it and relay a phishable
    login, so in mode `gateway` every person-login class must be phishing-resistant (`phr`, `phrh`), checked by
    `auth.person` and again on every ID token, and mode `oauth` warns. Its eight improvements (the gateway issuer's
    host refused, the probe matching the presented certificate, the doctor's wording, both binds loopback failing,
    missing `Origin` and host tests, `http.trusted_proxies` ignored, `--person-bind` and `UMBEL_HTTP_PERSON_BIND`, the
    not-served warning) and six nits (canonical hosts, schema patterns, HSTS, the decision-limit denial of service in
    13.2, the test helper's origin assertion, IPv4-mapped binds) are fixed, each with a regression test. No plugin
    crate changed.
  - Verified 2026-11-09 on the branch, each exit code captured directly: `cargo fmt --all --check`; the workspace
    clippy `-D warnings`, the three `--no-default-features` legs, the SDK and hello leg, the `wasm32-wasip2` leg and
    the two plugin jobs' clippy (with the knowledge `--no-default-features` leg); the component builds and
    `hello-mcp`; Umbel's host tests in batches (98 suites, 1196 tests) and the other crates, conformance and external
    clients (143 suites, 981 tests; 34 of 34 cases on each conformance lane), and the knowledge plugin without
    default features; `pnpm check`; Loam's web build and `test:mounted` (24 tests). All exited 0.
  - Tests: `tests/person_page_gateway.rs` (end to end with the kit: the flow, the gateway's channel carrying nothing
    of the page, the `for` rule and 4.1's mapping through a gateway, two hosts, every refusal of step 5 on the direct
    listener, the CLI, `umbel serve --http`, the configuration's refusals and the schema, the doctor), and unit tests
    in `src/surfaces/http/person.rs` and `src/auth/files.rs`. Choices are in the specification's
    [Amendments from step 5b](phases/5-auth-hosted/spec.md#amendments-from-step-5b).
- **Done:** step 6, knowledge's relay, 2026-11-09, on `lush/umbel-p5-6-knowledge-relay`:
  - **Served over MCP**: `knowledge-approve` and `knowledge-reject` (manifest version 5, `person = { cli =
    "terminal", mcp = "verified" }`, exposed to MCP), host-verified through Umbel's relay wherever the person page is
    served; a client gets a URL-mode link "Open the link to review knowledge-approve (proposal p-...) in alpha", the
    person signs in again with user verification, sees the proposal's preview and decides, and the client's retry runs
    the decision once. In mode `none` and at the terminal nothing changed but the proposal's version.
  - **The area's opt-in** `approve_over_mcp` (default false, and only beside a non-empty `approvers` list): elsewhere
    `APPROVAL_RELAY_DISABLED` (`details.area`) before anyone is asked. **The host's check before begin** runs the
    command's own preview as the caller, marked (`CallContext::person_check`), and knowledge's preview then makes every
    check the decision makes (readable, area, opt-in, version 3, approvers, state, a draft's re-checks, self-approval),
    so no person is asked about a call that would be refused.
  - **Who decides**: the person, never the client (`decision.by` `human:<ns>/<subject>`); the host attests the decision
    to the plugin for this command and input only (`CallContext::person_decision`). Self-approval holds through the
    person's legacy principals (4.6); a person's own agent's proposal is allowed, as D62 says.
  - **Proposal version 3** (`PROPOSAL_VERSION` 3): envelope version 3 with the caller's `delegationChain` (the store
    envelope's filled by the host on every version 3 document or record write, a plugin's `confirmation` dropped);
    `decision.channel` `terminal`, `mcp-elicitation` or `policy`, and on a person's decision `decision.assurance`
    (`terminal`, or `verified` with the namespace, `authTime` and `acr`). Version 1 and 2 records stay readable and
    in their version, and are decided only at a terminal.
  - **The doctor's `auth.person`** names the `approve_over_mcp` areas a namespace with token callers and no person
    login cannot use, and where the page is not served (step 2c's last follow-up).
  - **A rejection's reason** is read and confirmed by the person: `knowledge-reject`'s own preview,
    `knowledge-rejection-preview`, shows it first, labelled as the client's words; manifest version 5's
    `journal.show` lets the decision hold it for its life without the journal keeping it; the record says who
    wrote it (`decision.reasonSource`: `client` over MCP, `person` at a terminal).
  - **Independent security review**: no blocker, four improvements and nine nits, settled by the coordinator and
    each fixed with a regression test (the reason above; the check mark honoured only by the check; no `.`, `:` or
    `/` in a message's ids and proposal ids checked by shape; end-to-end tests of drafts (D102, D103) and of a
    configuration changed after a decision; single use proven by the nonce alone; the check counted under
    `person_pages_per_hour` and journaled under the call's trace; approvers before the opt-in; a version's
    `details.reason`; the doctor reading knowledge instances alone; the kit's ID tokens on the host's clock).
  - Tests: `plugins/knowledge/tests/relay.rs` (23, end to end with the kit, its kit `tests/relay_kit/` including the
    host's `tests/support/hosted.rs`), a check-before-begin case in `tests/person_page.rs`, a chain and confirmation case
    in `tests/store_grants.rs`, a `journal.show` case in `tests/manifest_v5.rs`, unit tests in `src/person/`,
    `src/auth/doctor.rs` and the plugin, and the knowledge tests moved to version 3. Plugin crates changed:
    `knowledge`; the SDK gained three `CallContext` fields; `umbel-testkit-idp` gained `Issuer::follow_clock`; the
    afd crate did not change.
  - Verified 2026-11-09 on the branch, each exit code captured directly: `cargo fmt --all --check`; the workspace
    clippy `-D warnings`, the three `--no-default-features` legs, the SDK and hello leg, the `wasm32-wasip2` leg and
    the two plugin jobs' clippy (with the knowledge `--no-default-features` leg); the component builds and
    `hello-mcp`; Umbel's host tests in batches and the other crates, the knowledge eval gate, conformance (34 of
    34 on each lane) and external clients (271 suites, 2492 tests, none failed), and the knowledge plugin without
    default features; `pnpm check`; Loam's web build and `test:mounted` (24 tests). All exited 0.
    Choices are in the specification's
    [Amendments from step 6](phases/5-auth-hosted/spec.md#amendments-from-step-6).
- **Done:** step 8, tasks, 2026-11-09, on `lush/umbel-p5-8-tasks`:
  - **Long jobs run as MCP tasks** in the hosted modes: `knowledge-index`, `knowledge-refresh` and `sources-sync`
    are optional tasks (the sources manifest moved to version 5), and an embedder's task command must be a mutation
    exposed to MCP. stdio keeps AFD's in-memory store per connection; mode `none` over HTTP offers no tasks, since it
    cannot tell its callers apart.
  - **The shared store** `state/shared/tasks.sqlite3` (`src/shared/tasks.rs`) implements AFD's `TaskStore`: every
    lookup by the id and a keyed digest of the principal binding, so another caller, an expired task and an unknown
    id get one answer; durable before AFD answers; `task-record.v1` checked before it is written; 32 tasks per owner
    and 256 in all; no token, input, label or content, a notice's code replaced by the host's own words, and
    purged results truncated out of the write-ahead log.
  - **Time:** each task's time to live ends a minute after its token's `exp`, and only the notice that the token
    expired (or the task was lost) lasts that minute; a result is gone at the `exp`. **A gateway task never outlives
    its assertion** (the follow-up of 2026-11-08).
  - **Leases:** only the runner renews its lease (AFD's new `TaskStore::heartbeat`); any process finding it run out
    ends the task once with `TASK_LOST`, and the runner, if it wakes, stops (AFD's `Stop::Lost`). A hosted
    `store.lock_timeout_ms` may be at most half the lease.
  - **Stopping reaches the plugin:** every host service, an open index writer session included, refuses a stopped
    task's call, and one whose space its caller can no longer read (`TASK_SPACE_UNREADABLE`).
  - **Independent security review**: one blocker and six improvements, with several nits, decided by the
    coordinator and each fixed with a regression test (the specification's rows marked "(review)").
  - Tests: `tests/tasks.rs` (end to end with the kit, two hosts on one workspace), `plugins/knowledge/tests/tasks.rs`,
    unit tests of `src/shared/tasks.rs` and the task guard, and AFD's `tests/server_tasks.rs`. Plugin crates
    changed: `knowledge` (manifest, `src/index.rs`, the test) and `sources-filesystem` (manifest); the afd crate
    gained `TaskStore::create_for`, `TaskCall`, `TaskStore::heartbeat`, `server::failure_result` and `Stop::Lost`.
  - Verified 2026-11-09 on the branch, each exit code captured directly: `cargo fmt --all --check`; the workspace
    clippy `-D warnings`, the three `--no-default-features` legs, the SDK and hello leg, the `wasm32-wasip2` leg and
    the two plugin jobs' clippy (with the knowledge `--no-default-features` leg); the component builds and
    `hello-mcp`; Umbel's host tests in batches (1236 tests) and the other crates, conformance (34 of 34 on each
    lane) and external clients (1012 tests), and the knowledge plugin without default features; AFD's `rust.yml`
    legs (fmt, clippy and tests for each feature set, the `wasm32` checks, nightly rustdoc); `pnpm check`; Loam's
    web build and `test:mounted` (24 tests). All exited 0.
    Choices are in the specification's
    [Amendments from step 8](phases/5-auth-hosted/spec.md#amendments-from-step-8).
- **Done:** step 9, usage, 2026-11-10, on `lush/umbel-p5-9-usage`:
  - **One record per metered request:** every request on an HTTP surface (modes `none`, `oauth` and `gateway`)
    whose body the host read and found to be `tools/call`, `tools/list` or a task method gets one
    `usage-event.v1` record: who (the principal, actor and namespace the verifier or gateway mapped, or the loopback
    agent), what (a tool, command and space only when they ran or became its task, so a hidden command or an
    unreadable space is never named; a task's id), the outcome, bytes, duration and trace id. Never an input, a
    result, content or a token. A request refused before its caller is known is not metered, nor a hosted request
    no verifier or gateway layer mapped a caller for.
  - **Off the request path:** the record is built as the answer leaves and queued without waiting; one writer thread
    per surface appends it to `state/usage/usage.sqlite3` (`src/shared/usage.rs`). The queue is bounded (8192, and
    512 per principal, so one caller's flood drops only its own records); drops and failed appends are counted and
    written to the store. Retention per record, never read past it, purged from the database and its log.
  - **`usage-list`:** a caller's own records (with equivalents), everyone's to `usage.readers` (principals, static
    groups, claim groups; never `*`) and to the operator; stdio and the library read their actor's own, mode `none`
    the loopback agent's. An `own` reader's answer is exactly what it would be if no one else had called: no total,
    no trace id, no drop count, a sealed `u1.` cursor; reads never wait on another process's write. A hosted reader
    other than the operator never sees a space it does not read or a command hidden from it (5.4, 9.4).
  - **Independent security review**: one blocker (a form-encoded request was metered before its token was
    checked) and five improvements (an owed log truncation, a timed test, a failed poll's task id, the creation's
    command and default space, a reader's hidden names), each fixed with a regression test (the specification's
    rows marked "(review)").
  - Tests: `tests/usage.rs` (end to end with the kit, two hosts on one workspace, and two `umbel serve --http`
    processes), unit tests of `src/shared/usage.rs` and `src/usage/`; `tests/context_hook.rs` names the hook's new
    `dev.umbel/usage` key. No plugin crate changed; the afd crate did not change.
  - Verified 2026-11-10 on the branch, each exit code captured directly: `cargo fmt --all --check`; the workspace
    clippy `-D warnings`, the three `--no-default-features` legs, the SDK and hello leg, the `wasm32-wasip2` leg, the
    two plugin jobs' clippy (with the knowledge `--no-default-features` leg) and the `umbel-store` `wasm32` check;
    the component builds and `hello-mcp`; Umbel's host tests in batches, the other crates' tests, conformance (34 of
    34 on each lane, 5 of 5 confirmations) and external clients; `pnpm check`; Loam's web build and `test:mounted`
    (24 tests). All exited 0. The afd crate did not change, so `rust.yml` was not run.
- **Merged in [#1180](https://github.com/lushly-dev/afd/pull/1180):** step 10, memory, implemented 2026-11-10 and finalized 2026-11-13; the original implementation and validation history follows, with the resume and final-review corrections below:
  - **`memory-confirm` over MCP (8.1, owner decision 8):** the memory manifest is version 5; `memory-confirm` takes
    `person = { cli = "terminal", mcp = "verified" }` and `confirm_preview = "memory-preview"`, so in a workspace that
    serves the person page an MCP client gets the page's link and the person decides there, seeing the record's text
    (fenced as data) rendered under their own filter. Own records only (D88), now through equivalents. The host's
    check before begin refuses another's record, a flagged, transcript or person record, before anyone is asked.
  - **Editors (8.3, owner decision 10):** another principal's record changes only for its owner (with equivalents)
    or a person holding an `editors` token: at a terminal, or the operator's person through the library. A sharing
    writer as such no longer may; over MCP no change command is person-gated, so only the owner changes a record
    there, whatever `agents_may_share` says. The plugin refuses an agent itself first; a group's `*` names no editor.
  - **`memory-erase` (8.4, owner decision 9):** a person in `erasers`, verified on the person page for each call
    (the dry run included), erases another principal's records blind, by owner through equivalents whatever their
    access set, only with the plan its dry run gave; counts only. With `erase_approvals = 2` the first eraser's erase
    records an erase request (`erase_requests` in `memory.sqlite3`, ids and a hash only, expiring at the window's
    end) and a second eraser, another person, approves it; a changed plan or the window passing voids it, and the
    store re-checks the plan and takes the request in the erase's own first transaction. The erased principal's
    stream gets the erase's event, whose envelope carries a host-owned `erasure` naming every eraser, the count, the
    request and the plan. `stores.memory_erase` warns where one eraser could erase alone.
  - **The library's assurance (the owner's settlement of 2026-11-09):** `{ embedder, library }`, recorded as the
    embedding application's own word, and admitted only for the operator's person; a mark the plugin gate did not
    check against the shared ledger never counts as `verified`. Extended on 2026-11-10 (D86 amended): only the
    operator's person through the library remembers as `person` or is a person at all.
  - **The CLI's seal (2026-11-10):** every check that trusts the CLI (the operator, the terminal marks, the
    `require-human` gate, the person page's CLI surface, `store-show`'s totals, what plugins are told) needs the seal
    the host's own command line puts on its contexts, so an embedder posing as the CLI is the library.
  - **Independent security review:** one blocker (an embedding application writing the CLI's principal and marks
    into a library context was recorded `terminal`, for any person: the CLI's own contexts are now sealed with a
    key that never leaves the process, and the memory services require the seal) and five improvements (a wrong
    plan voided another eraser's request; the check before begin told an eraser's agent whether a principal had
    records; the second eraser's own dry run was not enforced, now recorded and used up; expired requests were
    purged only lazily, now also by every write and sweep; a library person's remember still got `person`: settled by the
    coordinator on 2026-11-10, D86 amended, the operator's person alone), and five nits (the first eraser's role re-checked at approval, exact codes in tests, the host's
    editors rule tested with no plugin in front, a notice kind only the host's erase can emit). All are fixed, each with a regression test.
  - Tests: `plugins/memory/tests/erase.rs`, `editors.rs` and `confirm_preview.rs` (end to end with the kit over real
    sockets, through `tests/hosted_kit/`), `store-embedded/tests/memory_erase.rs`, `tests/memory_grants.rs`, the
    schema cases, and unit tests of `erase_step`, the plan and the doctor check. Plugin crates changed: `memory`
    (code, manifest, schemas, skill, tests); a struct field in `context`'s source and in the test support of
    `context`, `curator`, `knowledge` and `umbel-first-party`. The afd crate did not change. Choices are in the
    specification's [Amendments from step 10](phases/5-auth-hosted/spec.md#amendments-from-step-10).
  - Verified 2026-11-10 on the branch, each exit code captured directly: `cargo fmt --all --check`; clippy
    `-D warnings` on every `umbel.yml` leg (the workspace, the three `--no-default-features` legs, the SDK and hello
    leg, the `wasm32-wasip2` leg, the two plugin jobs' with the knowledge `--no-default-features` leg) and the
    `umbel-store` `wasm32` check; the component builds and `hello-mcp`; Umbel's host tests in batches; the other
    crates' tests in batches (the shared machine's disk ran short, so they ran in smaller batches with the build
    output pruned between them), conformance (34 of 34 on each lane, 5 of 5 confirmations) and external clients;
    `pnpm check`; Loam's web build and `test:mounted` (24 tests). All exited 0; `plugin_mounted` passed without a
    rerun. The afd crate did not change, so `rust.yml` was not run.
- **Resume audit, 2026-11-13 (earlier checkpoint, superseded by the shipping entry below):** step 10 had no pull request. Its three local commits
  (`70aa013b`, `3c17d916`, `11738afa`) and 16 unfinished files were preserved in WIP commit
  `9921f0b5` and branch `lush/umbel-p5-10-memory-pre-main-20261113` before integrating
  `origin/main` at `e4c972a5031c3c9527bf0703fe925a8b23b16a40`. Both follow-up fixes from
  the last handoff are present: the library grants memory person authority only to the
  operator's person, and CLI trust checks require the host's seal. The saved
  `~/.cache/umbel-p5-10-logs/gates.txt` contradicts the all-green claim above:
  `rest exit 101`, with four failures in the filesystem source plugin's `readable_results`
  and `sync` tests. Re-running both targets on the merged candidate reproduced the same
  four failures (30 passed, 4 failed, exit 101). Their shared fixture builds a library
  context with the CLI interface (`plugins/sources-filesystem/tests/support/mod.rs`),
  which now lacks the host's CLI seal; repair the fixture while retaining its path-visibility
  assertions. This is a candidate result, not a standalone current-main reproduction.
  Full validation remains required before publication.
  - Resume checks: `pnpm install --frozen-lockfile` with Node 26; `cargo fmt --all --check`;
    `cargo test --locked -p umbel --no-default-features --features auth,cli,store-embedded,testkit`
    with `--lib authority::tests` (3 passed), `--lib person::tests` (25 passed), and the four
    integration targets `--test memory_grants --test store_commands --test person_local
    --test records_person_page` (51 passed). An independent review of the eight conflict
    resolutions found one main-added CLI fixture missing the new seal; its existing
    `gate_proof` test failed before the fixture was sealed, then passed with an explicit
    assertion that an unsealed copy is refused. The local-page refusal of memory confirmation
    and the record-review page both pass. No push, pull request, full `pnpm verify`, or full
    Umbel workspace validation was performed in this resume audit.
- **Final review fixes, 2026-11-13:** the filesystem source tests call the real CLI instead of
  constructing a library context with its interface; the original file-path assertions pass,
  and an unsealed-library negative assertion is retained. Two independent Sol/high reviews
  covered contracts and security. The general gate now admits only the approved operator's
  genuine library context for compiled, non-pipeline `memory-confirm` with `memory_write`,
  preserving `embedder` assurance and all ownership checks; it does not admit a library erase
  or a forged CLI principal. The erase rechecks its complete plan under the memory write lock
  held through key destruction. A deterministic test failed on the old transaction gap
  (an intervening invalidate was erased despite the stale plan); the regression also covers
  a newly written target. Full gate and focused-review receipts travel with this PR.
- **Steps merged by 2026-11-23** (the steps not merged yet are in [the index](STATUS.md#phase-5-auth-and-hosted)):
  - 0a, the AFD spec, documents and cases only: done 2026-11-07 in the step 0a pull request.
  - 0b, AFD's Rust `server-auth` feature: done 2026-11-07 in the step 0b pull request.
  - 0c, #532: confirmation state bound to the principal in TypeScript, Python and Rust: done 2026-11-07 in the step 0c pull request.
  - 0d, AFD's Rust host-verified mode, `HumanRelay`, relay evidence and the form-mode approval relay: done 2026-11-07 in the step 0d pull request.
  - 0e, AFD's Rust MCP Tasks: `task`, `TaskStore` and the `tasks/*` handlers: done 2026-11-07, completing the AFD prerequisites 0a to 0e.
  - 1, Umbel's shapes: section 2's schemas, configuration and manifest version 5 parsing, constants: done 2026-11-07 on `lush/umbel-p5-1-shapes`.
  - 1b, `umbel-testkit-idp` and `tests/no_auth_server.rs`: done 2026-11-07 in the step 1b pull request. `umbel-testkit-idp` is the test identity provider.
  - 2a, the host's listener and layers: TLS with `client_auth`, section 6.3's order, the metadata, the per-IP limit, the context hook version 1 skeleton: done 2026-11-08 in the step 2a pull request.
  - 2b, the host's verification and principal: the `KeySource`, the verifier and introspection, section 4.1's mapping to principal version 1, claim groups, equivalents, an interim scope rule: done 2026-11-08 on `lush/umbel-p5-2b-verification`.
  - 2c, the doctor's hosted profile, `auth-show`, `workspace-show`'s hosted answer, each issuer's `ca_file`: done 2026-11-08 on `lush/umbel-p5-2c-doctor`. Introspection moved to step 2b.
  - 3, the host's scopes, access, shared state and limits: done 2026-11-08, with its [amendments](phases/5-auth-hosted/spec.md#amendments-from-step-3).
  - 3's follow-up to AFD, hidden commands unknown before validation: done 2026-11-08, with its [amendments](phases/5-auth-hosted/spec.md#amendments-from-afds-hidden-commands).
  - 4, the host's gateway mode: the pinned channel, a verified single-use assertion per request, the scope ceiling's meet, no metadata; a shipped build now serves `gateway`: done 2026-11-08 on `lush/umbel-p5-4-gateway`, with its [amendments](phases/5-auth-hosted/spec.md#amendments-from-step-4). Its follow-up to AFD (the decision before dispatch for a host's own layer) was done 2026-11-08.
  - 5, the person page: the OpenID Connect relying party, decisions in `state/shared/person.sqlite3`, Umbel's `HumanRelay`, the CLI's URL flow, envelope version 3: done 2026-11-08 on `lush/umbel-p5-5-person-page`, with its [amendments](phases/5-auth-hosted/spec.md#amendments-from-step-5). `person.mcp` commands are served over MCP in mode `oauth`.
  - 5b, the person page in mode `gateway` on a listener of its own, with its own TLS and public origin, which browsers reach directly and never through the gateway: the owner's decision of 2026-11-09; mode `gateway` now serves verified commands with it: done 2026-11-09 on `lush/umbel-p5-5b-gateway-person-page`, with its [amendments](phases/5-auth-hosted/spec.md#amendments-from-step-5b).
  - 6, knowledge's relay: `knowledge-approve` and `knowledge-reject` decided over MCP on the person page in an area that sets `approve_over_mcp`; proposal version 3 written: done 2026-11-09 on `lush/umbel-p5-6-knowledge-relay`, with its [amendments](phases/5-auth-hosted/spec.md#amendments-from-step-6).
  - 7, the stores' exact filtering: BM25 statistics per reader filter for knowledge and memory, sealed positions, readable-only totals; a shipped build now serves `oauth`: done 2026-11-08 on `lush/umbel-p5-7-exact-filtering`, with its [amendments](phases/5-auth-hosted/spec.md#amendments-from-step-7).
  - 8, tasks: the shared task store, owner-checked, durable, bounded and leased, each task ended at its token's `exp`; a gateway task never outlives its assertion: done 2026-11-09 on `lush/umbel-p5-8-tasks`, with its [amendments](phases/5-auth-hosted/spec.md#amendments-from-step-8). Long jobs run as MCP tasks in the hosted modes, shared by every process behind the URL.
  - 9, usage: one content-free record per metered MCP HTTP request in `state/usage/usage.sqlite3`, written off the request path; `usage-list` shows a caller its own, everyone's to `usage.readers` and the operator: done 2026-11-10 on `lush/umbel-p5-9-usage`, with its [amendments](phases/5-auth-hosted/spec.md#amendments-from-step-9).
  - 10, memory: `memory-confirm` over MCP on the person page, `editors`, `memory-erase` with the two-person rule, the library's own assurance: merged in [#1180](https://github.com/lushly-dev/afd/pull/1180) (2026-11-13), with its [amendments](phases/5-auth-hosted/spec.md#amendments-from-step-10).

  - The owner's review checkpoint (D201, [#1932](https://github.com/lushly-dev/afd/issues/1932)), a brief of the unread decisions among D158 to D188, read and answered by him: done 2026-11-23 in [#2270](https://github.com/lushly-dev/afd/pull/2270) ([review brief](review-d158-d188.md), D203: 27 confirmed as written, D186 amended before implementation, D165 write-quota follow-up filed as [#2342](https://github.com/lushly-dev/afd/issues/2342)). Steps 11 and 12 are released.

### Further first-class plugins

- **`components`, as the Phases table gave it to 2026-11-18:** specification approved 2026-11-10 (#964), decisions D150 to D156; step C1 implemented: the crate, the reader with every check of the format, the scan, `components-list`, `components-open` and the graceful refusal; step C2 implemented 2026-11-11: `components-brief` (tags and source, sections and basis per section, shared rules once, `known`, `versions`, fitting to the budget, `render: "text"`); step C3 implemented 2026-11-11: the `components-guide` skill on the three delivery paths, `components-brief` as the fifth first-party suggestion (seven first-class tools with the built-ins, under the cap of eight), and the plugin as `plugin-show` and the doctor show it, with no host change; step C4 implemented 2026-11-11: the reader reads pack format 1, and FAST-AF's pack as Specimen exported it is served as a space override in `fast_af.rs` and `facts.rs` (criteria 1, 3 and 7 on the real library; criterion 2 measured and not met); step C5 done 2026-11-12, served to this repository's agents through `.mcp.json` (A21, A22); after C3, the doctor runs a compiled plugin's own pack check on each space override (A23, D172, the owner's decision of 2026-11-11).
- **`ideas`, as the Phases table gave it to 2026-11-18:** specification written 2026-11-12, decisions D173 to D180, with its review host specification; steps C1 to C4 merged (#1091, #1099, #1106, #1145): the crate compiled into `umbel-first-party`, capture, match, ask, find, open, the guide, export and import, review staged by an agent and confirmed in bulk at a terminal or on the local page, and the review report; step C5's repository part implemented 2026-11-13 on `lush/ideas-c5-first-use` (the `ideas-guide` skill, the README's local instance with the instructions paragraph and the settings, a walk-through of it), not merged.
- **The next gate, as the Phases table gave it to 2026-11-18:** `components`: the owner's answer on criterion 2, then step C5. `ideas`: the owner's own first use, which is C5's exit, pending.
