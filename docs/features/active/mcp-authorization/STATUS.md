# MCP authorization: status

Epic: [#1552](https://github.com/lushly-dev/afd/issues/1552). File new work for this area as its sub-issue.

Read this before the [proposal](mcp-authorization.proposal.md). Last reconciled 2026-11-23
against `origin/main` at `eb457325`, using source, merged history, capability manifests and
GitHub sub-issues. This reconciliation did not rerun implementation test suites or verify a
live identity provider.

## Delivery

| Scope | State | Evidence / next gate |
| --- | --- | --- |
| Phase 1: contract | Done | #793; [authorization specification](../../../../spec/authorization.md), [cases](../../../../spec/authorization.json) (13 sections, 184 cases), [command metadata](../../../../spec/command-metadata.md) (`scopes`, `confirmationMode`, `HumanRelay`) and [error codes](../../../../spec/error-codes.md) (`INSUFFICIENT_SCOPE`) |
| Phase 4: Rust resource-server layer | Done | #798 (`server-auth`), #835 (host scope hook), #810 (`HumanRelay`), #1880 (merged in #1898, per-caller `ResourceProvider` `cacheScope: "private"`); loads all 13/13 sections (184 cases) in `packages/rust/tests/authorization_cases.rs`, plus `server_auth.rs`, `server_auth_pre_dispatch.rs`, `server_auth_hidden.rs`, `server_human_relay.rs` |
| Phase 2: TypeScript resource-server layer (M1–M7, `tasks/*`) | Done | #934 (verification), #1050 (pre-dispatch scopes), #1971 (merged in #2034, `tasks/*` auth), #2265 (per-caller `ResourceProvider` via `ResourceCaller` and `cacheScope: "private"`), #2263 (host-verified confirmation, `HumanRelay`, private relay evidence and `inputDigests`); loads all 13/13 sections (184 cases) across `packages/server/src/authorization-cases.test.ts`, `mcp-auth-scopes.test.ts`, `mcp-auth-resources.test.ts`, `principal-binding.test.ts`, `mcp-auth.test.ts`, `mcp-auth-verifier.test.ts`, `mcp-auth-host.test.ts`, `tasks.test.ts`, `human-relay.test.ts` |
| Phase 3: Python resource-server layer (M1–M7, `tasks/*`) | Done | #800 (#2025, `context_hook` + M8 binding), #1972 (#2134, base `tasks/*`), #2154 (#2162, M1–M5, M7, `tasks/*` binding), #2155 (#2193, M6 scopes, `ScopeResolver`, pre-dispatch 403, hidden commands, `server.admit`/`pre_dispatch_check`, `tasks/*` scopes), #2266 (#2360, per-caller `ResourceProvider` via `ResourceCaller` and `cacheScope: "private"`), #2264 (host-verified confirmation, `HumanRelay`, private relay evidence and `inputDigests`); loads all 13/13 sections (184 cases) across `python/tests/test_authorization_cases.py`, `test_principal_binding.py`, `test_context_hook.py`, `test_auth_verifier.py`, `test_mcp_auth.py`, `test_mcp_auth_scopes.py`, `test_mcp_auth_resources.py`, `test_human_relay.py` |
| Confirmation state bound to the caller (#532, M8) | Done in TypeScript, Python and Rust; C++ partial (stdio-only) | #801, #2025, #2162; TypeScript, Python and Rust load `principalBindings`. C++ (`afd::mcp_stdio`) has no HTTP server by design (M1–M7 and `HumanRelay` are N/A); its confirmation `requestState` HMAC-binds command, input and actor without HTTP credentials |
| Host-verified confirmation / `HumanRelay` + `inputDigests` | Done in Rust, TypeScript and Python | Rust done in #810 ([Umbel phase 5 specification](../../../../endpoints/umbel/docs/phases/5-auth-hosted/spec.md)); TypeScript done in [#2263](https://github.com/lushly-dev/afd/issues/2263) (#2514, `human-relay.ts`, `relay-evidence.ts`, `human-relay.test.ts`, `authorization-cases.test.ts`); Python done in [#2264](https://github.com/lushly-dev/afd/issues/2264) (#2541, `human_relay.py`, `relay_evidence.py`, `test_human_relay.py`, `test_authorization_cases.py`) |
| Per-caller `ResourceProvider` (M6 Other methods, R3/R4) | Done in Rust, TypeScript and Python | Rust `ResourceProvider::list_for`/`read_for` and `cacheScope: "private"` done in #798 and #1880 (#1898); TypeScript `ResourceProvider.list`/`read` (`ResourceCaller`) and `cacheScope: "private"` done in [#2265](https://github.com/lushly-dev/afd/issues/2265) (#2338, `mcp-auth-resources.test.ts`); Python `ResourceProvider.list`/`read` (`ResourceCaller`) and `cacheScope: "private"` done in [#2266](https://github.com/lushly-dev/afd/issues/2266) (#2360, `test_mcp_auth_resources.py`) |

## Remaining sub-issues

Each remaining sub-issue under [#1552](https://github.com/lushly-dev/afd/issues/1552) has its own line; edit only your own line when closing it.

- [#2263](https://github.com/lushly-dev/afd/issues/2263) (TypeScript — host-verified confirmation mode, `HumanRelay`, relay evidence and `inputDigests`): in [#2514](https://github.com/lushly-dev/afd/pull/2514) (`CommandConfirmationMode`, `HumanRelay` on `createMcpServer`/`createMcpHandler`, off-object private `WeakMap` relay evidence in `createApprovalMiddleware` spent once as `relay:<decisionId>`, `inputDigest` + all 5 `inputDigests` cases in `authorization-cases.test.ts`, `human-relay.test.ts`; `/direct` D115 ceilings raised 50,500 → 52,300, 64,600 → 67,000, 88,500 → 91,200 for 51,910 / 66,576 / 90,788 measured).

- [#2264](https://github.com/lushly-dev/afd/issues/2264) (Python — host-verified confirmation mode, `HumanRelay`, relay evidence and `inputDigests`): in [#2541](https://github.com/lushly-dev/afd/pull/2541) (`CommandConfirmationMode`, `HumanRelay` on `create_server`/`ServerConfig`, off-object private weakref relay evidence in `create_approval_middleware` spent once as `relay:<decision_id>`, `input_digest` + all 5 `inputDigests` cases in `test_authorization_cases.py`, `test_human_relay.py`).

- [#2265](https://github.com/lushly-dev/afd/issues/2265) (TypeScript — per-caller `ResourceProvider` and `cacheScope: "private"` under M6 / R3–R4): merged in [#2338](https://github.com/lushly-dev/afd/pull/2338) (`ResourceCaller` on `ResourceProvider.list`/`read`, Streamable HTTP both eras + host-admitted requests, `-32602` parity, `cacheScope: "private"` for provider responses under `auth` while static `SkillCatalog` reads stay `"public"`; `packages/server/src/mcp-auth-resources.test.ts`).

- [#2266](https://github.com/lushly-dev/afd/issues/2266) (Python — per-caller `ResourceProvider` and `cacheScope: "private"` under M6 / R3–R4): in [#2360](https://github.com/lushly-dev/afd/pull/2360) (`ResourceCaller` on `ResourceProvider.list`/`read`, Streamable HTTP both eras + SSE + host-admitted requests, `-32602` parity, `cacheScope: "private"` for provider responses under `auth` while static `SkillCatalog` reads stay `"public"`; `python/tests/test_mcp_auth_resources.py`).

## Separate follow-on work (outside #1552 closeout)

- **Decision A8 (issuer claim profiles and scope qualifier, Umbel D184):** specified in [Umbel's auth profiles specification](../../../../endpoints/umbel/docs/phases/5-auth-hosted/auth-profiles.spec.md) (decided under the owner's direction; unread by the owner). Step A1 has yet to add it to `spec/authorization.md` and `spec/authorization.json`. Not part of `#1552`'s already-specified M1–M8 and `HumanRelay` exit criteria.

## Next gate

Keep the feature active and [#1552](https://github.com/lushly-dev/afd/issues/1552) open until the remaining open sub-issues above are merged or explicitly dispositioned by the owner. Rust ran before TypeScript because Umbel needed it; the proposal's numbered phases are not execution order.
