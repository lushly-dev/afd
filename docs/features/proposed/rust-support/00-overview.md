# AFD Rust Support - Plan Overview

> **Current status (2026-10-12):** The in-process core library is published as
> [`afd` 0.1.0](https://crates.io/crates/afd/0.1.0), tagged `rust-v0.1.0`.
> [Release evidence](../../../operations/native-first-releases.md) covers registry
> consumers and the GitHub trusted-publisher configuration. This historical
> proposal also includes general-purpose MCP transports and a distribution
> framework, which are outside the released crate. Those broader goals remain
> proposed; the diagrams and implementation sketches below are not current API
> documentation. See the [crate README](../../../../packages/rust/README.md).


> **Disposition (2026-10-25, audit #349): partially shipped, stays proposed.**
> Shipped: core types and registry (`rust-parity`, #181), WASM feature, `afd` 0.1.0 on crates.io (#379), and an optional `server` Cargo feature with stdio and Streamable HTTP on `rmcp` (#394).
> Remaining scope: `cargo-dist` distribution; the `#[afd_command]` proc macro and `hello_mcp`/`todo_app` examples sketched in [01-afd-rust.md](./01-afd-rust.md); and verified interop with Claude Desktop and Cursor. Moving this folder to `complete/` waits on those or on an explicit decision to drop them. Update the "Success Criteria" below when that happens.
>
> **Update (2026-10-31):** the `server` feature gained `structuredContent`, `outputSchema` and a per-request context hook (#523) and tool strategies, meta-tools and contexts (#526), under [parity-closure](../../active/parity-closure/parity-closure.plan.md) D1. The remaining scope above is unchanged: no `cargo-dist` config, `#[afd_command]` macro or `hello_mcp`/`todo_app` examples exist in `packages/rust`.

> **Goal**: Add Rust as a third language implementation to AFD, enabling native binary and WASM distribution targets alongside the existing TypeScript and Python implementations.

## The Vision

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          AFD (Public Package)                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐              │
│  │  TypeScript   │  │    Python     │  │     Rust      │              │
│  │  @afd/core    │  │    afd-py     │  │   afd-rust    │ ◄── NEW     │
│  │  @afd/server  │  │               │  │               │              │
│  └───────────────┘  └───────────────┘  └───────────────┘              │
│                                                                         │
│  All implementations share:                                             │
│  - CommandResult<T> type structure                                      │
│  - CommandError with recovery guidance                                  │
│  - MCP server protocol support                                          │
│  - Conformance test compatibility                                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Why Rust for AFD?

| Capability | TypeScript/Python | Rust |
|------------|-------------------|------|
| **Native CLI** | Requires bundler (50-150MB) | Native binary (3-8MB) |
| **WASM** | Limited | First-class support |
| **Cloudflare Workers** | TS only | WASM deployment |
| **Browser Standalone** | Requires server | WASM runs client-side |
| **Performance** | Interpreted | Compiled, zero-cost abstractions |

## Package Structure

```
afd/
├── packages/
│   ├── core/           # @afd/core (TypeScript)
│   ├── server/         # @afd/server (TypeScript)
│   ├── cli/            # @afd/cli (TypeScript)
│   └── rust/           # NEW: afd-rust crate
│       ├── Cargo.toml
│       ├── src/
│       │   ├── lib.rs           # Crate root
│       │   ├── result.rs        # CommandResult<T>
│       │   ├── error.rs         # CommandError
│       │   ├── command.rs       # Command trait
│       │   ├── registry.rs      # CommandRegistry
│       │   └── server/          # MCP server
│       ├── examples/
│       └── tests/
└── python/             # Python implementation
```

## Deliverables

1. **Core Types** - `CommandResult<T>`, `CommandError`, metadata types
2. **Command Registry** - Registration, validation, execution
3. **MCP Server** - stdio + HTTP/SSE transports
4. **WASM Target** - Browser and edge deployment
5. **Distribution** - cargo-dist configuration for automated releases

**See:** [01-afd-rust.md](./01-afd-rust.md) for full implementation details

## Success Criteria

- [x] All AFD types match TypeScript/Python exactly (JSON serialization)
- [x] Pass shared conformance test suite
- [ ] General-purpose MCP transports work with Claude Desktop and Cursor (stdio and Streamable HTTP ship behind the `server` feature, #394; client interop is not verified)
- [x] Build for Windows, Mac, Linux, and WASM
- [x] crates.io 0.1.0 published; GitHub trusted publisher configured (the tag check skips the existing version; a future release must verify an actual OIDC upload)
- [ ] cargo-dist distribution framework (outside the released core library)

## Timeline

| Phase | Effort |
|-------|--------|
| Core types | 1-2 days |
| Command registry | 1 day |
| MCP server | 2-3 days |
| WASM target | 1-2 days |
| Distribution (cargo-dist) | 1 day |
| **Total** | **~7 days** |

## Related Plans

- **[Mint Distribution](../rust-distribution/00-overview.md)** - Private framework that builds ON TOP of AFD Rust for multi-platform distribution
- **[Performance](../performance/06-performance.plan.md)** - Command batching and streaming (applies to all AFD implementations)
- **[Design-to-Code](../design-to-code/00-overview.md)** - Schema discovery commands (to be implemented in Rust)
