# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-01-07

### Changed

- **`failure()` function** - Now accepts all optional CommandResult fields (alternatives, sources, plan, reasoning, confidence), not just warnings and metadata. This enables richer failure responses with suggested alternatives.

### Added

- **Public npm publishing** - All 5 packages now published to npm under MIT license:
  - `@lushly-dev/afd-core` - Core types and utilities
  - `@lushly-dev/afd-client` - MCP client library
  - `@lushly-dev/afd-server` - Zod-based MCP server factory
  - `@lushly-dev/afd-cli` - Command-line interface
  - `@lushly-dev/afd-testing` - Testing utilities
- **LICENSE file** - MIT license with compiled-only note (source repo remains private)

---

## [0.7.0] - 2026-01-06

### Added

#### Todo Example Enhancements

- **Shared File Storage** - TypeScript and Python backends now share the same data file
  - New `FileStore` class in TypeScript with JSON persistence
  - Store factory with `TODO_STORE_TYPE` environment variable (`file` or `memory`)
  - Default path: `packages/examples/todo/data/todos.json`
  - Enables MCP clients and HTTP server to share data seamlessly
  - Python backend updated with matching file-based storage

- **React Frontend** - Complete rewrite with AFD UX principles
  - **Toast Notifications** - Rich toast system with confidence bars, execution time, warnings
  - **TrustPanel** - Displays command confidence, reasoning, sources, and execution plan
  - **ConfirmModal** - Confirmation dialogs for destructive operations with keyboard support
  - **ErrorRecovery** - Error panel with retry functionality and suggestions
  - **CommandLog** - Real-time command execution log with timestamps
  - **Remote Change Detection** - Polls for external changes (CLI/MCP) and shows batched notifications
  - **Batch Operations** - Select all, toggle selected, delete selected with batch commands
  - **Filters** - All/Pending/Completed filter buttons
  - New dark theme with accent color (#e94560)
  - `useConfirm` hook for promise-based confirmation dialogs
  - `useToast` hook with `showResultToast` and `showRemoteChanges` helpers

- **Vanilla JS Frontend** - Feature parity with React
  - Remote change detection with batched toast notifications
  - URL parameter support for view switching (`?view=pending`)
  - Integrated warnings in toasts instead of separate notifications
  - `hasBaseline` flag to prevent false positive change detection on first load

- **MCP Server Improvements**
  - Debug logging for grouped tool calls in dev mode
  - Better error messages for invalid grouped tool calls with available actions list
  - Transport mode configuration via `TRANSPORT` environment variable

### Changed

- All todo commands now use `store/index.ts` factory instead of direct memory store import
- React frontend styling completely redesigned with new color scheme
- Vanilla frontend updated with info toast type and remote change styling

### Fixed

- **Remote Change Detection** - Fixed false positive on first load when previous todos map was empty
  - Added `hasBaselineRef` (React) / `hasBaseline` (Vanilla) flag
  - Change detection now only triggers after baseline is established

### Documentation

- Updated TypeScript backend README with storage configuration
- Updated Python backend README with environment variables
- Added `data/.gitkeep` for shared data directory

#### Multi-Backend MCP Configuration

- **VS Code MCP Configuration** - Added `.vscode/mcp.json` setup documentation
  - TypeScript backend: stdio transport (auto-starts via VS Code)
  - Python backend: stdio transport (auto-starts via VS Code)
  - Rust backend: HTTP/SSE transport (requires manual server start)
  - Only ONE backend should be enabled at a time (tool name conflicts)

- **Rust Backend Fixes**
  - Fixed command names from dots to hyphens (`todo.create` → `todo-create`)
  - Fixed list response format to return `{ todos, total, hasMore }` object
  - Created comprehensive README with build/run instructions

- **Skill Files Updated** - All 5 AFD skill files aligned with implementation
  - `afd-developer`: Command naming convention `domain-action` not `domain.action`
  - `afd-typescript`: All command examples use hyphen format
  - `afd-python`: Multiple command references corrected
  - `afd-rust`: Registry and batch execution examples fixed
  - `pr-review`: Command naming guideline updated

---

## [0.6.0] - 2026-01-01

### Added

#### JTBD Testing Phase 4: Multi-App Support (`@afd/testing`)

- **App Adapter System** - Extensible adapter interface for different AFD applications
  - `AppAdapter` interface with CLI, fixture, commands, errors, and jobs configuration
  - `CliConfig` for CLI command configuration
  - `FixtureConfig` with `apply()`, `reset()`, and `validate()` methods
  - `CommandsConfig` with `list()`, `getSchema()`, and `mapFileToCommands()`
  - `ErrorsConfig` with `list()`, `getDescription()`, and `isRetryable()`
  - `JobsConfig` with `list()`, `getDescription()`, and `getRelatedCommands()`

- **Adapter Registry** - Manage multiple app adapters
  - `createAdapterRegistry()` - Create isolated registries
  - `registerAdapter()` - Register adapters globally
  - `getAdapter()` / `detectAdapter()` - Lookup by name or auto-detect from fixture
  - `listAdapters()` - List all registered adapters
  - Global registry with `getGlobalRegistry()`, `setGlobalRegistry()`, `resetGlobalRegistry()`

- **Generic Adapter** - Fallback for apps without specific adapters
  - `createGenericAdapter()` - Factory function with sensible defaults
  - `genericAdapter` - Default instance
  - Handles `data` and `setup` arrays in fixtures

- **Todo Adapter** - Adapter for the AFD Todo example app
  - `todoAdapter` - Pre-configured adapter for todo app
  - `createTodoAdapter()` - Factory for customized instances
  - Full support for 11 todo commands, error codes, and jobs
  - `mapFileToCommands()` for changed-files scenario suggestions

- **Fixture Loader Integration** - Updated to use adapters when available
  - `applyFixture()` now accepts `ApplyFixtureOptions` with adapter override
  - Auto-detects adapter from fixture's `app` field
  - Falls back to legacy app-specific handling

### Test Coverage

| Package | Tests | Status |
|---------|-------|--------|
| @afd/core | 57 | ✅ Pass |
| @afd/testing | 169 | ✅ Pass |
| @afd/example-todo | 78 | ✅ Pass |
| **Total** | 304 | ✅ Pass |

---

## [0.5.0] - 2026-01-01

### Added

#### JTBD Testing Phase 3: Agent Integration (`@afd/testing`)

- **MCP Server** - JSON-RPC 2.0 server for AI agent integration
  - `createMcpTestingServer()` - Factory function for MCP server instances
  - `runStdioServer()` - Start server with stdio transport
  - Handlers: `initialize`, `ping`, `tools/list`, `tools/call`
  - Protocol-compliant request/response handling

- **MCP Tool Generation** - Expose all scenario commands as MCP tools
  - `generateTools()` - Create tool definitions from commands
  - `createToolRegistry()` - Tool lookup and execution registry
  - `executeTool()` - Execute tool with context injection
  - Tools: `scenario_list`, `scenario_evaluate`, `scenario_coverage`, `scenario_create`, `scenario_suggest`

- **Agent Hints System** - AI-friendly metadata for result interpretation
  - `_agentHints` field added to all command results
  - `shouldRetry` - Boolean indicating if operation should be retried
  - `relatedCommands` - Suggested follow-up commands
  - `nextSteps` - Action recommendations based on result
  - `interpretationConfidence` - Confidence score (0-1) for result interpretation
  - `generateAgentHints()` - Generate hints for any command result
  - `enhanceWithAgentHints()` - Add hints to existing results

- **`scenario.suggest`** - AI-powered scenario suggestions
  - 5 context strategies for intelligent suggestions:
    - `changed-files` - Map changed files to relevant commands
    - `uncovered` - Use coverage data to find testing gaps
    - `failed` - Find scenarios needing attention
    - `command` - Generate test variations for specific command
    - `natural` - Keyword matching for natural language queries
  - Returns suggestions with confidence scores and reasoning
  - Optional skeleton generation for new scenarios

### Test Coverage

| Package | Tests | Status |
|---------|-------|--------|
| @afd/core | 57 | ✅ Pass |
| @afd/testing | 127 | ✅ Pass |
| @afd/example-todo | 78 | ✅ Pass |
| **Total** | 262 | ✅ Pass |

---

## [0.4.0] - 2025-01-17

### Added

#### JTBD Testing Phase 2: Command Suite (`@afd/testing`)

- **`scenario.list`** - List and filter scenarios in a directory
  - Filter by job name, tags, status, or search term
  - Sort by name, job, or step count
  - Output formats: terminal table, JSON
  - Includes scenario metadata (step count, fixture, tags)

- **`scenario.evaluate`** - Batch execute scenarios
  - Parallel execution with configurable concurrency
  - Fail-fast mode to stop on first failure
  - Per-scenario timeout support
  - Output formats: terminal, JSON, JUnit XML, Markdown
  - Exit code 0/1 for CI integration
  - Detailed test reports with summary statistics

- **`scenario.coverage`** - Calculate coverage metrics
  - Command coverage: which commands are tested
  - Error coverage: which error codes are tested
  - Job coverage: which user goals are covered
  - Identify untested commands against known list
  - Output formats: terminal, JSON, Markdown

- **`scenario.create`** - Generate scenario files from templates
  - Templates: blank, crud, error-handling, workflow
  - CRUD template includes create/read/update/delete/verify steps
  - Error-handling template includes validation and not-found tests
  - Workflow template includes setup/actions/verification steps
  - Generates proper YAML with step references

- **Output Formatters**
  - `formatTerminal()` - Colored terminal output
  - `formatJunit()` - JUnit XML for CI systems
  - `formatMarkdown()` - Markdown reports for documentation
  - `formatCoverageTerminal()` / `formatCoverageMarkdown()` - Coverage reports

### Changed

- Updated `packages/testing/src/index.ts` with Phase 2 exports
- Added 21 unit tests for new commands

### Test Coverage

| Package | Tests | Status |
|---------|-------|--------|
| @afd/core | 57 | ✅ Pass |
| @afd/testing | 95 | ✅ Pass |
| @afd/example-todo | 78 | ✅ Pass |
| **Total** | 230 | ✅ Pass |

---

## [0.3.1] - 2025-01-16

### Added

#### JTBD Scenario Runner UX Improvements (`@afd/testing`)

- **Better Assertion Error Messages** - Failed assertions now show expected vs actual values
  - Example: `"2 assertions failed: data.total: expected 99, got 2; data.completed: expected true, got false"`
  - Added `formatAssertionFailures()` internal helper for detailed error formatting

- **Dry Run Mode** - Validate scenarios without executing them
  - `validateScenario(scenario, options)` - Pre-flight validation function
  - `dryRun: true` option for `InProcessExecutor` - Returns validation results without execution
  - Validates command existence, step references, and fixture availability

- **Richer Fixture Callback** - `applyFixture()` now returns detailed command information
  - Changed `appliedCommands` from `string[]` to `AppliedCommand[]`
  - `AppliedCommand` type: `{ command: string; input?: Record<string, unknown> }`
  - Enables better debugging and logging of fixture application

- **New Exports** - Added types for programmatic usage
  - `AppliedCommand` - Single applied command with input data
  - `ApplyFixtureResult` - Full result of fixture application
  - `ScenarioValidationResult` - Result of dry-run validation
  - `validateScenario` - Pre-flight validation function

### Changed

- Updated `packages/testing/README.md` with new UX improvement documentation
- Updated fixture loader tests for new `AppliedCommand[]` type

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

- **@afd/example-todo** - Multi-stack Todo application (TypeScript + Python)
  - Shared conformance test suite in `dx/run-conformance.ts`
  - 8 commands: create, list, get, update, toggle, delete, clear, stats
  - Vanilla JS and React frontends

## [0.1.1] - 2026-01-01

### Added

- **Python Library Fixes**:
  - Dynamic function signature generation in `MCPServer` to support `FastMCP` introspection.
  - Fixed `_accepts_context` to correctly detect `context` parameter in handlers.
- **Conformance Runner**: Added `dx/run-conformance.ts` to the Todo example for cross-backend validation.

### Changed

- Updated Todo example to use `input_schema` for all commands to ensure strict validation.
- Improved Python backend implementation to match TypeScript behavior exactly.
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

| Command           | Baseline | Threshold |
| ----------------- | -------- | --------- |
| todo.create       | <1ms     | 10ms      |
| todo.get          | <0.1ms   | 5ms       |
| todo.update       | <0.2ms   | 10ms      |
| todo.toggle       | <0.2ms   | 10ms      |
| todo.delete       | <0.1ms   | 10ms      |
| todo.list (20)    | <10ms    | 20ms      |
| todo.stats        | <0.2ms   | 15ms      |
| bulk create (100) | <1ms     | 100ms     |
| bulk list (100)   | <0.1ms   | 50ms      |

---

## [0.3.0] - 2025-01-15

### Added

#### JTBD Scenario Testing (`@afd/testing`)

- **Scenario Runner** - Jobs-to-be-Done scenario testing framework
  - YAML scenario parser with full validation
  - `InProcessExecutor` for running scenarios against command handlers
  - `ConsoleReporter` for human-readable test output
  - Support for scenario metadata (tags, description, skip)

- **Fixture System** - Pre-seeded test data for scenarios
  - `loadFixture()` - Load JSON fixture files with inheritance
  - `applyFixture()` - Apply fixtures to test state via command handlers
  - Base fixture inheritance with `deepMerge()` for nested object merging
  - Inline overrides for scenario-specific customizations
  - Built-in handlers for `todo` and `violet` apps
  - Generic handler with `setup` command array for custom apps

- **Step References** - Dynamic data references between scenario steps
  - `${{ steps[N].data.path }}` syntax for referencing previous step results
  - Exact match (preserves type) vs embedded (string interpolation)
  - Nested path resolution with dot notation
  - Array index access (`items[0].name`)
  - 23 unit tests for step reference resolution
  - 18 unit tests for fixture loading

- **Scenario Documentation**
  - Updated `packages/testing/README.md` with JTBD runner docs
  - Example scenarios in `packages/examples/todo/scenarios/`
  - Fixture format documentation for todo/violet/generic apps

### Fixed

- **Todo Store Bug** - Fixed `store.update()` overwriting existing values with `undefined`
  - Root cause: JavaScript object spread `{ ...data }` where `data.title = undefined` 
    overwrites existing `title` property
  - Solution: Filter out undefined values before spreading
  - Affected commands: `todo.update`, `todo.get` (returned incomplete data)

### Changed

- Updated `AGENTS.md` with JTBD scenario testing documentation
- Updated repository structure to include `scenarios/` and `fixtures/` directories

### Test Coverage

| Package | Tests | Status |
|---------|-------|--------|
| @afd/core | 57 | ✅ Pass |
| @afd/testing | 74 | ✅ Pass |
| @afd/example-todo | 78 | ✅ Pass |
| **Total** | 209 | ✅ Pass |

---

## [0.2.0] - 2026-01-01

### Added

#### Performance Features

- **Command Batching** (`@afd/core`, `@afd/server`, `@afd/client`, `@afd/cli`)
  - `BatchRequest`, `BatchResult`, `BatchCommandResult` types for multi-command execution
  - `executeBatch()` method in CommandRegistry with partial success semantics
  - `afd.batch` MCP tool and `POST /batch` HTTP endpoint
  - `batch()` client method for type-safe batch execution
  - `afd batch` CLI command with `--stop-on-error`, `--timeout`, `--parallel` flags
  - Aggregated confidence calculation: `(successRatio * 0.5) + (avgCommandConfidence * 0.5)`
  - 18 unit tests for batch functionality

- **Streaming Results** (`@afd/core`, `@afd/server`, `@afd/client`, `@afd/cli`)
  - `StreamChunk<T>` discriminated union (`ProgressChunk`, `DataChunk`, `CompleteChunk`, `ErrorChunk`)
  - `executeStream()` AsyncGenerator in CommandRegistry
  - `GET /stream/:command` SSE endpoint for real-time streaming
  - `stream()` and `streamWithCallbacks()` client methods with AbortSignal support
  - `afd stream` CLI command with progress display and Ctrl+C cancellation
  - Error recovery metadata (`chunksBeforeError`, `recoverable`, `resumeFrom`)
  - 29 unit tests for streaming functionality

#### Performance Documentation

- **06a - Command Batching** - Implementation guide for batch command execution
- **06b - Streaming Results** - Implementation guide for incremental result delivery
- **06c - Horizontal Scaling Patterns** - Infrastructure scaling guidance (docs only)
- **06d - Optimistic UI Patterns** - Frontend patterns for perceived performance (docs only)
- **06e - State Layering Strategy** - Local vs command state separation (docs only)

### Performance Targets

| Metric | Target | Status |
|--------|--------|--------|
| Batch overhead | < 2x single command | ✅ Achieved |
| Streaming first-byte | < 100ms | ✅ Achieved |
| Backward compatibility | Non-streaming unchanged | ✅ Achieved |
| Stream cancellation | Abortable mid-flight | ✅ Achieved |

---

## [Unreleased]

### Planned

- VS Code extension for AFD development
- npm publish to public registry
- Additional example applications
- Database-backed store implementations
- WebSocket transport for real-time updates
