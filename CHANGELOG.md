# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-01-01

### Added

#### Core Framework
- **@afd/core** - Core types and interfaces for Agent-First Development
  - `CommandResult<T>` interface with UX-enabling metadata (confidence, reasoning, warnings)
  - `CommandError` standardized error type with suggestions
  - `CommandParameter` and `JsonSchema` types for MCP compatibility
  - Success/error factory functions (`success()`, `error()`)

#### Server Package
- **@afd/server** - Zod-based MCP server factory
  - `defineCommand()` for type-safe command definitions with Zod schemas
  - `createMcpServer()` factory for HTTP-based MCP servers
  - Input validation with detailed error messages
  - Middleware support (logging, timing, retry, tracing, rate limiting)
  - Automatic JSON Schema generation from Zod schemas

#### Client Package
- **@afd/client** - MCP client library
  - `McpClient` with automatic initialization handshake
  - `SseTransport` for Server-Sent Events connections
  - `HttpTransport` for HTTP-based communication
  - Connection state management with auto-reconnection support

#### Testing Package
- **@afd/testing** - Testing utilities for AFD commands
  - Command validators for AFD compliance
  - Test helpers and assertions
  - Mock server utilities

#### CLI Package
- **@afd/cli** - Command-line interface for AFD
  - `afd connect <url>` - Connect to MCP servers
  - `afd tools` - List available commands
  - `afd call <command> [args]` - Execute commands
  - `afd status` - Check connection status
  - Auto-reconnection with saved server URL

#### Example Applications
- **@afd/example-todo** - Complete Todo application demonstrating AFD patterns
  - 8 commands: create, list, get, update, toggle, delete, clear, stats
  - In-memory store with filtering, sorting, pagination
  - Web UI with real-time updates (3s polling)
  - MCP server at `http://localhost:3100`
  - Full test coverage:
    - 31 unit tests for command correctness
    - 13 performance tests with threshold validation
    - AFD compliance tests for CommandResult structure
    - Latency percentile tracking (p50/p95/p99)

#### Documentation
- Methodology documentation (README.md)
- Command Schema Guide - patterns for UX-enabling commands
- Trust Through Validation - how CLI validation builds trust
- Implementation Phases - 4-phase roadmap for AFD projects
- Production Considerations - security, observability, OpenTelemetry integration
- AGENTS.md - AI agent context for the repository

### Performance Baselines

Initial performance measurements for Todo app commands (in-memory store):

| Command | Baseline | Threshold |
|---------|----------|-----------|
| todo.create | <1ms | 10ms |
| todo.get | <0.1ms | 5ms |
| todo.update | <0.2ms | 10ms |
| todo.toggle | <0.2ms | 10ms |
| todo.delete | <0.1ms | 10ms |
| todo.list (20) | <10ms | 20ms |
| todo.stats | <0.2ms | 15ms |
| bulk create (100) | <1ms | 100ms |
| bulk list (100) | <0.1ms | 50ms |

---

## [Unreleased]

### Planned
- VS Code extension for AFD development
- npm publish to public registry
- Additional example applications
- Database-backed store implementations
- WebSocket transport for real-time updates
