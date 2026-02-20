# AFD Rust

Rust implementation of Agent-First Development core types.

## Overview

This crate provides the same API as `@lushly-dev/afd-core` (TypeScript) and `afd` (Python), enabling multi-language AFD applications with guaranteed type compatibility.

## Installation

```toml
[dependencies]
afd = "0.1"
```

## Quick Start

```rust
use afd::{success, failure, CommandError, CommandResult};

// Create a successful result
let result: CommandResult<String> = success("Hello, AFD!".to_string(), None);
assert!(result.success);

// Create a failure result
let error = CommandError::not_found("Todo", "123");
let result: CommandResult<()> = failure(error, None);
assert!(!result.success);
```

## API Coverage

This crate matches the TypeScript and Python APIs exactly:

### Core Types
- `CommandResult<T>` - Standard result type with UX-enabling fields
- `CommandError` - Structured error with recovery guidance
- `Source`, `PlanStep`, `Alternative`, `Warning` - Metadata types

### Batch Operations
- `BatchCommand`, `BatchRequest`, `BatchResult` - Multi-command execution
- `BatchCommandResult`, `BatchSummary`, `BatchTiming` - Batch result details

### Streaming
- `ProgressChunk`, `DataChunk`, `CompleteChunk`, `ErrorChunk` - Stream chunks
- `StreamChunk` - Discriminated union of all chunk types
- `StreamOptions`, `StreamCallbacks` - Stream configuration

### Helper Functions
- `success()`, `failure()` - Create results
- `is_success()`, `is_failure()` - Type guards
- Error factories: `validation_error()`, `not_found_error()`, etc.

## JSON Serialization

All types serialize to camelCase JSON, matching TypeScript/Python:

```rust
use afd::success;
use serde_json;

let result = success("hello".to_string(), None);
let json = serde_json::to_string(&result).unwrap();
// {"success":true,"data":"hello"}
```

## Features

- `native` (default) - Native async runtime with Tokio
- `wasm` - WebAssembly target support

## License

MIT
