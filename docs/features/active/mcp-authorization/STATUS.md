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
| Phase 3: Python authorization | Partial (context hook & M8 done; M1–M7 not started) | #800 adds the per-request context hook and binds its actor in confirmation/approval state; M1–M7 remain in the [parity matrix](../../../language-parity.md) |

## Next gate

Implement Python against the shared authorization cases, including principal binding, and carry
the outstanding host-verified confirmation behavior to the other server implementations. Rust
ran before TypeScript because Umbel needed it; the proposal's numbered phases are not execution
order. Keep the feature active until its cross-language scope is resolved.
