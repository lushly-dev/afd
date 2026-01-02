# AFD Rust Support - Plan Overview

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

- [ ] All AFD types match TypeScript/Python exactly (JSON serialization)
- [ ] Pass shared conformance test suite
- [ ] MCP server works with Claude Desktop and Cursor
- [ ] Build for Windows, Mac, Linux, and WASM
- [ ] Automated releases via cargo-dist

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
