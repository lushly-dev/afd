//! Logging: `tracing` to **stderr only**, on every surface.
//!
//! stdout belongs to the command's result (the CLI) or to JSON-RPC (stdio), so no log line ever
//! goes there. Inputs, results, keys and the HTTP token are never logged; at `debug` the command
//! name, trace id and duration are. The library never installs a subscriber: the `umbel` binary
//! does, through [`init`].

use tracing_subscriber::EnvFilter;

/// Install the stderr subscriber. `filter` is a `tracing` filter directive (`info`,
/// `umbel=debug`); an invalid one falls back to `info`. A second call, or a subscriber installed
/// by the embedder, leaves the first in place.
pub(crate) fn init(filter: &str, json: bool) {
    let filter = EnvFilter::try_new(filter).unwrap_or_else(|_| EnvFilter::new("info"));
    let builder = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(std::io::stderr)
        .with_ansi(false);
    let _ = if json {
        builder.json().try_init()
    } else {
        builder.try_init()
    };
}

/// The debug line every surface writes for a finished call.
pub(crate) fn log_call(command: &str, trace_id: Option<&str>, duration_ms: u128, success: bool) {
    tracing::debug!(
        command,
        trace_id = trace_id.unwrap_or(""),
        duration_ms = duration_ms as u64,
        success,
        "command finished"
    );
}
