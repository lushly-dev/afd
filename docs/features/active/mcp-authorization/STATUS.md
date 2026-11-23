# MCP authorization: status

Epic: [#1552](https://github.com/lushly-dev/afd/issues/1552). File new work for this area as its sub-issue.

Read this before the [proposal](mcp-authorization.proposal.md). Last reconciled 2026-11-13
against `main` at `1024546b`, using source and merged history. This audit did not rerun suites
or verify a live identity provider.

## Delivery

| Scope | State | Evidence / next gate |
| --- | --- | --- |
| Phase 1: contract | Done | #793; [authorization specification](../../../../spec/authorization.md) and [cases](../../../../spec/authorization.json) |
| Phase 4: Rust resource-server layer | Done | #798 (`server-auth`); `packages/rust/tests/authorization_cases.rs`, `server_auth.rs` and `server_auth_pre_dispatch.rs`; host scope hook in #835 |
| Phase 2: TypeScript resource-server layer | Done | #934 (verification) and #1050 (pre-dispatch scopes); `packages/server/src/authorization-cases.test.ts`, `mcp-auth.test.ts`, `mcp-auth-verifier.test.ts` and `mcp-auth-scopes.test.ts` |
| Confirmation state bound to the caller (#532) | Done in TypeScript, Python and Rust | #801; Python per-request context hook (`create_server(context_hook=...)`) binds the hook's actor in #800 (`python/tests/test_context_hook.py`, `test_principal_binding.py`); this alone does not implement Python's HTTP bearer/scope authorization layer |
| Host-verified confirmation / relay | Rust done; other ports remain | #810; [Umbel phase 5 specification](../../../../endpoints/umbel/docs/phases/5-auth-hosted/spec.md) |
| Phase 3: Python authorization | Done | #800 adds the per-request context hook and M8 principal binding; #2154 (merged in #2162) adds M1–M5, M7 and Tasks binding (`python/tests/test_authorization_cases.py`, `test_auth_verifier.py`, `test_mcp_auth.py`); #2155 (merged in #2193) adds M6 command `scopes`, `required_scopes`, `ScopeResolver` (`resolve`, `visible`, `known`), `ScopeChallenge`, pre-dispatch 403 and JSON-RPC batch 400 `-32600`, post-routing `INSUFFICIENT_SCOPE` before confirmations, execution-time resolver re-checks on validated input, `filter_tools_by_scope` (`cacheScope: "private"`), byte-identical hidden commands, `server.admit`/`server.pre_dispatch_check`, `tasks/*` scope enforcement, and `staticScopes`/`batches` conformance (`python/tests/test_mcp_auth_scopes.py`) |

## Next gate

Carry the outstanding host-verified confirmation behavior to TypeScript and Python. Rust ran before TypeScript because Umbel needed it; the proposal's numbered phases are not execution order. Keep the feature active until its cross-language scope is resolved.
