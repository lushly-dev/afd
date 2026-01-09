# Part 1: AFD Rust Implementation

> **Goal**: Add Rust as a third language implementation to AFD, enabling native binary and WASM distribution targets.

## Overview

This plan adds a `packages/rust/` directory to the AFD monorepo containing a Rust crate that implements the AFD command pattern with full MCP server support.

## Package Structure

```
afd/
├── packages/
│   ├── core/           # @afd/core (TypeScript)
│   ├── server/         # @afd/server (TypeScript)
│   ├── cli/            # @afd/cli (TypeScript)
│   └── rust/           # NEW: afd-rust crate
│       ├── Cargo.toml
│       ├── README.md
│       ├── src/
│       │   ├── lib.rs           # Crate root, re-exports
│       │   ├── result.rs        # CommandResult<T>
│       │   ├── error.rs         # CommandError
│       │   ├── metadata.rs      # Source, PlanStep, etc.
│       │   ├── command.rs       # CommandDefinition trait
│       │   ├── registry.rs      # CommandRegistry
│       │   ├── server/
│       │   │   ├── mod.rs
│       │   │   ├── mcp.rs       # MCP protocol handler
│       │   │   ├── stdio.rs     # stdio transport
│       │   │   └── http.rs      # HTTP/SSE transport
│       │   └── macros.rs        # #[afd_command] proc macro
│       ├── examples/
│       │   ├── hello_mcp.rs     # Minimal MCP server
│       │   └── todo_app.rs      # Todo example (matches TS/Python)
│       └── tests/
│           ├── conformance.rs   # Run shared conformance tests
│           └── integration.rs
├── python/             # Python implementation
└── ...
```

## Core Types

### CommandResult

```rust
// src/result.rs
use serde::{Deserialize, Serialize};

/// Standard result type for all AFD commands.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult<T> {
    pub success: bool,
    
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
    
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<CommandError>,
    
    // UX-enabling fields
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
    
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
    
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sources: Option<Vec<Source>>,
    
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<Vec<PlanStep>>,
    
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alternatives: Option<Vec<Alternative<T>>>,
    
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warnings: Option<Vec<Warning>>,
    
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<ResultMetadata>,
}

/// Helper to create successful result.
pub fn success<T>(data: T) -> CommandResult<T> {
    CommandResult {
        success: true,
        data: Some(data),
        ..Default::default()
    }
}

/// Helper to create error result.
pub fn failure<T>(error: CommandError) -> CommandResult<T> {
    CommandResult {
        success: false,
        error: Some(error),
        ..Default::default()
    }
}
```

### CommandError

```rust
// src/error.rs
use serde::{Deserialize, Serialize};

/// Structured error with recovery guidance.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    /// Machine-readable error code (SCREAMING_SNAKE_CASE)
    pub code: String,
    
    /// Human-readable error description
    pub message: String,
    
    /// Recovery guidance
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggestion: Option<String>,
    
    /// Whether retry might succeed
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retryable: Option<bool>,
    
    /// Additional details
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

// Common error constructors
impl CommandError {
    pub fn not_found(resource: &str, id: &str) -> Self {
        Self {
            code: "NOT_FOUND".to_string(),
            message: format!("{} '{}' not found", resource, id),
            suggestion: Some(format!("Check the {} ID and try again", resource.to_lowercase())),
            retryable: Some(false),
            details: None,
        }
    }
    
    pub fn validation(message: &str, suggestion: Option<&str>) -> Self {
        Self {
            code: "VALIDATION_ERROR".to_string(),
            message: message.to_string(),
            suggestion: suggestion.map(|s| s.to_string()),
            retryable: Some(false),
            details: None,
        }
    }
}
```

### Command Definition

```rust
// src/command.rs
use async_trait::async_trait;
use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;

/// Context passed to command handlers.
#[derive(Debug, Clone, Default)]
pub struct CommandContext {
    pub trace_id: Option<String>,
    pub user_id: Option<String>,
}

/// Trait for defining AFD commands.
#[async_trait]
pub trait Command: Send + Sync {
    /// Command name (dot notation: "node.create")
    fn name(&self) -> &str;
    
    /// Human-readable description
    fn description(&self) -> &str;
    
    /// JSON Schema for input validation
    fn input_schema(&self) -> Value;
    
    /// Execute the command
    async fn execute(&self, input: Value, ctx: CommandContext) -> CommandResult<Value>;
    
    /// Tags for categorization
    fn tags(&self) -> Vec<String> { vec![] }
    
    /// Whether command mutates state
    fn is_mutation(&self) -> bool { false }
}

/// Macro for defining commands with less boilerplate.
/// 
/// # Example
/// ```rust
/// use afd::{command, CommandResult, success};
/// use serde::{Deserialize, Serialize};
/// 
/// #[derive(Deserialize)]
/// struct PingInput {
///     message: Option<String>,
/// }
/// 
/// #[derive(Serialize)]
/// struct PingOutput {
///     response: String,
/// }
/// 
/// #[command(name = "ping", description = "Echo a message")]
/// async fn ping(input: PingInput) -> CommandResult<PingOutput> {
///     let msg = input.message.unwrap_or_else(|| "pong".to_string());
///     success(PingOutput { response: msg })
/// }
/// ```
// Proc macro implementation in macros.rs
```

## MCP Server

### Server Factory

```rust
// src/server/mod.rs
use crate::{Command, CommandRegistry};

pub struct McpServerConfig {
    pub name: String,
    pub version: String,
    pub transport: Transport,
}

pub enum Transport {
    Stdio,
    Http { host: String, port: u16 },
    Sse { host: String, port: u16 },
}

pub struct McpServer {
    config: McpServerConfig,
    registry: CommandRegistry,
}

impl McpServer {
    pub fn new(config: McpServerConfig) -> Self {
        Self {
            config,
            registry: CommandRegistry::new(),
        }
    }
    
    pub fn register<C: Command + 'static>(&mut self, command: C) {
        self.registry.register(Box::new(command));
    }
    
    pub async fn run(&self) -> Result<(), Box<dyn std::error::Error>> {
        match &self.config.transport {
            Transport::Stdio => self.run_stdio().await,
            Transport::Http { host, port } => self.run_http(host, *port).await,
            Transport::Sse { host, port } => self.run_sse(host, *port).await,
        }
    }
}
```

### stdio Transport

```rust
// src/server/stdio.rs
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

impl McpServer {
    pub async fn run_stdio(&self) -> Result<(), Box<dyn std::error::Error>> {
        let stdin = tokio::io::stdin();
        let mut stdout = tokio::io::stdout();
        let mut reader = BufReader::new(stdin);
        let mut line = String::new();
        
        // CRITICAL: All logging must go to stderr, not stdout
        eprintln!("[afd] MCP server starting (stdio)");
        
        loop {
            line.clear();
            if reader.read_line(&mut line).await? == 0 {
                break; // EOF
            }
            
            let request: McpRequest = serde_json::from_str(&line)?;
            let response = self.handle_request(request).await;
            
            let output = serde_json::to_string(&response)? + "\n";
            stdout.write_all(output.as_bytes()).await?;
            stdout.flush().await?;
        }
        
        Ok(())
    }
}
```

## WASM Target

### Cargo.toml Configuration

```toml
[package]
name = "afd"
version = "0.1.0"
edition = "2024"

[lib]
crate-type = ["cdylib", "rlib"]

[features]
default = ["native"]
native = ["tokio/full"]
wasm = ["wasm-bindgen", "wasm-bindgen-futures", "js-sys", "web-sys"]

[dependencies]
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
async-trait = "0.1"

# Native-only
tokio = { version = "1.0", features = ["full"], optional = true }

# WASM-only
wasm-bindgen = { version = "0.2", optional = true }
wasm-bindgen-futures = { version = "0.4", optional = true }
js-sys = { version = "0.3", optional = true }
web-sys = { version = "0.3", features = ["console"], optional = true }

[target.'cfg(not(target_arch = "wasm32"))'.dependencies]
rust-mcp-sdk = { version = "0.1", features = ["server"] }

[target.'cfg(target_arch = "wasm32")'.dependencies]
rust-mcp-sdk = { version = "0.1", default-features = false, features = ["server", "wasm"] }
```

### WASM Exports

```rust
// src/lib.rs
#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub struct WasmServer {
    inner: McpServer,
}

#[cfg(feature = "wasm")]
#[wasm_bindgen]
impl WasmServer {
    #[wasm_bindgen(constructor)]
    pub fn new(name: &str, version: &str) -> Self {
        Self {
            inner: McpServer::new(McpServerConfig {
                name: name.to_string(),
                version: version.to_string(),
                transport: Transport::Sse { host: "0.0.0.0".to_string(), port: 3100 },
            }),
        }
    }
    
    #[wasm_bindgen]
    pub async fn handle_request(&self, json: &str) -> String {
        let request: McpRequest = serde_json::from_str(json).unwrap();
        let response = self.inner.handle_request(request).await;
        serde_json::to_string(&response).unwrap()
    }
}
```

## Distribution Configuration

### cargo-dist Setup

```toml
# Cargo.toml additions
[workspace.metadata.dist]
# Targets to build
targets = [
    "x86_64-unknown-linux-gnu",
    "aarch64-unknown-linux-gnu",
    "x86_64-apple-darwin",
    "aarch64-apple-darwin",
    "x86_64-pc-windows-msvc",
]

# Installers to generate
installers = ["shell", "powershell", "homebrew", "npm"]

# Homebrew tap
tap = "Falkicon/homebrew-tap"

# npm package name
npm-package = "@afd/rust"

# Include WASM artifacts
include = ["pkg/*.wasm", "pkg/*.js"]
```

### Build Script

```bash
#!/bin/bash
# scripts/build-all.sh

set -e

echo "Building native targets..."
cargo build --release

echo "Building WASM target..."
cargo build --release --target wasm32-unknown-unknown --features wasm --no-default-features
wasm-pack build --target web --out-dir pkg

echo "Running tests..."
cargo test

echo "Build complete!"
```

## Conformance Tests

The Rust implementation must pass the same conformance tests as TypeScript and Python:

```rust
// tests/conformance.rs
use afd::{success, failure, CommandError, CommandResult};

#[test]
fn test_success_result_structure() {
    let result: CommandResult<String> = success("hello".to_string());
    
    assert!(result.success);
    assert_eq!(result.data, Some("hello".to_string()));
    assert!(result.error.is_none());
}

#[test]
fn test_error_result_structure() {
    let result: CommandResult<String> = failure(CommandError::not_found("Item", "123"));
    
    assert!(!result.success);
    assert!(result.data.is_none());
    assert!(result.error.is_some());
    assert_eq!(result.error.as_ref().unwrap().code, "NOT_FOUND");
}

#[test]
fn test_json_serialization() {
    let result: CommandResult<serde_json::Value> = success(serde_json::json!({
        "id": "123",
        "name": "Test"
    }));
    
    let json = serde_json::to_string(&result).unwrap();
    
    // Verify camelCase serialization
    assert!(json.contains("\"success\":true"));
    assert!(json.contains("\"data\":{"));
}
```

## Implementation Phases

### Phase 1.1: Core Types (Day 1)
- [ ] Create `packages/rust/` directory
- [ ] Implement `CommandResult<T>`
- [ ] Implement `CommandError`
- [ ] Implement metadata types (Source, PlanStep, etc.)
- [ ] Add serde serialization with camelCase
- [ ] Basic unit tests

### Phase 1.2: Command Registry (Day 2)
- [ ] Implement `Command` trait
- [ ] Implement `CommandRegistry`
- [ ] Add input validation (JSON Schema)
- [ ] Create `#[afd_command]` proc macro
- [ ] Example commands

### Phase 1.3: MCP Server (Days 3-4)
- [ ] stdio transport
- [ ] HTTP/SSE transport
- [ ] MCP protocol handling (initialize, tools/list, tools/call)
- [ ] Integration tests with MCP client

### Phase 1.4: WASM Target (Day 5)
- [ ] Configure cargo for WASM
- [ ] wasm-bindgen exports
- [ ] wasm-pack build
- [ ] Browser test page
- [ ] Cloudflare Worker example

### Phase 1.5: Distribution (Day 6)
- [ ] cargo-dist configuration
- [ ] GitHub Actions workflow
- [ ] Homebrew formula
- [ ] npm package wrapper
- [ ] Release documentation

## Success Criteria

1. **Type Parity**: All AFD types match TypeScript/Python exactly (JSON serialization)
2. **Conformance**: Pass shared conformance test suite
3. **MCP Compatibility**: Work with Claude Desktop and Cursor
4. **Multi-Target**: Build for Windows, Mac, Linux, and WASM
5. **Distribution**: Automated releases via cargo-dist
