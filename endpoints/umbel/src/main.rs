//! The `umbel` binary. Phase 0 step 1 prints its version; the commands arrive in later steps.

use clap::Parser;

/// AFD Umbel: an empty host for capability plugins over MCP and CLI.
#[derive(Parser)]
#[command(name = "umbel", version)]
struct Cli {}

fn main() {
    Cli::parse();
}
