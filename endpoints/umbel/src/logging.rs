//! Logging: `tracing` to **stderr only**, on every surface.
//!
//! stdout belongs to the command's result (the CLI) or to JSON-RPC (stdio), so no log line ever
//! goes there. Inputs, results, keys and the HTTP token are never logged. The library never
//! installs a subscriber: the `umbel` binary does, through [`init`].
//!
//! **The call line (D217).** Every finished call of a registered command, on every surface, writes
//! one `debug` event on the target `umbel::call` ([`log_call`]): the command, the request id, the
//! trace id, the duration, the outcome, for a failure the error code, and whether the registry
//! dropped the call before it answered (a timeout or a panic). The request id is the W3C trace id
//! of the `traceparent` an MCP 2026-07-28 request carries in `_meta`, so a line joins the caller's
//! trace; without one the host makes a new id in the same form ([`REQUEST_ID_KEY`]).

use std::time::Duration;

use afd::CommandContext;
use serde_json::Value;

/// The context key that carries a call's request id: set by the MCP context hook from
/// `_meta.traceparent` (or made new), never taken from what a request brought under this name.
/// The CLI's and a library call's context set it to their trace id, and the metrics layer sets it
/// on a call that has none, so a pipeline's steps and a batch's items share their call's id.
pub(crate) const REQUEST_ID_KEY: &str = "dev.umbel/request-id";

/// Install the stderr subscriber. `filter` is a `tracing` filter directive (`info`,
/// `umbel=debug`); an invalid one falls back to `info`. A second call, or a subscriber installed
/// by the embedder, leaves the first in place.
#[cfg(feature = "cli")]
pub(crate) fn init(filter: &str, json: bool) {
    use tracing_subscriber::EnvFilter;
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

/// The trace id of a W3C `traceparent` header value (Trace Context level 1, section 3.2):
/// `version-traceid-parentid-flags`, lowercase hex, neither id all zeros, version `ff` invalid.
/// A version after `00` may append fields after a `-`. `None` for anything else.
pub(crate) fn traceparent_trace_id(value: &str) -> Option<&str> {
    let hex = |part: &str, len: usize| {
        part.len() == len
            && part
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    };
    let mut parts = value.splitn(5, '-');
    let version = parts.next()?;
    let trace = parts.next()?;
    let parent = parts.next()?;
    let flags = parts.next()?;
    let rest = parts.next();
    let valid = hex(version, 2)
        && version != "ff"
        && hex(trace, 32)
        && trace.bytes().any(|byte| byte != b'0')
        && hex(parent, 16)
        && parent.bytes().any(|byte| byte != b'0')
        && hex(flags, 2)
        && (rest.is_none() || version != "00");
    valid.then_some(trace)
}

/// The request id of an MCP request whose `_meta.traceparent` is `traceparent`: its trace id
/// when it is valid, otherwise a new one in the same form (32 lowercase hex digits).
pub(crate) fn request_id_from(traceparent: Option<&str>) -> String {
    traceparent
        .and_then(traceparent_trace_id)
        .map_or_else(crate::host::new_trace_id, str::to_owned)
}

/// A call's request id: the one already set (by the MCP context hook, the CLI's or a library
/// call's context, or the metrics layer of an outer call), else the context's trace id, else a
/// new one.
pub(crate) fn request_id(context: &CommandContext) -> String {
    context
        .extra
        .get(REQUEST_ID_KEY)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .or_else(|| context.trace_id.clone())
        .unwrap_or_else(crate::host::new_trace_id)
}

/// What the call line says about one finished call.
pub(crate) struct Call<'a> {
    pub command: &'a str,
    pub request_id: &'a str,
    pub trace_id: Option<&'a str>,
    pub elapsed: Duration,
    pub success: bool,
    /// The error code of a failure; empty for a success.
    pub code: &'a str,
    /// The registry dropped the call before it answered: a timeout, a panic or a caller that
    /// went away.
    pub abandoned: bool,
}

/// The call line every surface writes for a finished call (D217).
pub(crate) fn log_call(call: &Call<'_>) {
    tracing::debug!(
        target: "umbel::call",
        command = call.command,
        request_id = call.request_id,
        trace_id = call.trace_id.unwrap_or(""),
        duration_ms = u64::try_from(call.elapsed.as_millis()).unwrap_or(u64::MAX),
        success = call.success,
        code = call.code,
        abandoned = call.abandoned,
        "command finished"
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALID: &str = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

    #[test]
    fn a_valid_traceparent_gives_its_trace_id() {
        assert_eq!(
            traceparent_trace_id(VALID),
            Some("4bf92f3577b34da6a3ce929d0e0e4736")
        );
        // A later version may append fields.
        assert_eq!(
            traceparent_trace_id("01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-extra"),
            Some("4bf92f3577b34da6a3ce929d0e0e4736")
        );
        assert_eq!(
            request_id_from(Some(VALID)),
            "4bf92f3577b34da6a3ce929d0e0e4736"
        );
    }

    #[test]
    fn a_malformed_traceparent_gives_a_new_id() {
        for bad in [
            "",
            "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7",
            "00-4BF92F3577B34DA6A3CE929D0E0E4736-00f067aa0ba902b7-01",
            "00-00000000000000000000000000000000-00f067aa0ba902b7-01",
            "00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01",
            "ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
            "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-extra",
            "00-4bf92f3577b34da6a3ce929d0e0e473-00f067aa0ba902b7-01",
        ] {
            assert_eq!(traceparent_trace_id(bad), None, "{bad}");
        }
        let made = request_id_from(Some("junk"));
        assert_eq!(made.len(), 32, "{made}");
        assert!(made.bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert_ne!(made, request_id_from(None));
    }

    #[test]
    fn the_hooks_id_wins_then_the_trace_id() {
        let mut context = CommandContext::new().with_trace_id("abc");
        assert_eq!(request_id(&context), "abc");
        context
            .extra
            .insert(REQUEST_ID_KEY.to_owned(), Value::from("r-1"));
        assert_eq!(request_id(&context), "r-1");
    }
}
