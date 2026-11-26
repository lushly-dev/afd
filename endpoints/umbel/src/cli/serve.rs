//! `umbel serve`: MCP over stdio or Streamable HTTP until the client leaves or a signal arrives.
//!
//! stdout belongs to JSON-RPC on stdio, so every message here goes to stderr; the one exception
//! is `--print-token`, which prints the bearer token alone on stdout in HTTP mode, where stdout
//! is otherwise unused.

use crate::host::{Host, HostError};
use crate::workspace::codes;
use std::fmt::Display;
use std::io::Write;
use std::net::SocketAddr;
use std::time::Duration;
use tokio::net::TcpListener;

/// How long requests in flight get after SIGINT or SIGTERM before the process exits anyway.
const GRACE: Duration = Duration::from_secs(10);

/// Which transport `umbel serve` runs.
pub(super) enum Mode {
    Stdio,
    Http { print_token: bool },
}

/// What `umbel serve` was asked for: the transport, and the metrics listener's loopback address
/// (`--metrics-bind` or `UMBEL_METRICS_BIND`, D217), none by default.
pub(super) struct Options {
    pub(super) mode: Mode,
    pub(super) metrics: Option<SocketAddr>,
}

/// Serve until the client disconnects (stdio) or a signal arrives; `Ok` is exit code 0.
///
/// # Errors
/// A startup failure: the token cannot be created, an address is in use, stdio cannot open.
pub(super) async fn serve(
    host: &Host,
    options: Options,
    out: &mut dyn Write,
) -> Result<(), HostError> {
    let signals = Signals::install();
    // The full catch-up of the event streams (a stream damaged by hand is repaired too), under
    // the workspace lock, before a client can ask for events. It runs before the runtime is busy
    // with any request, so blocking here is brief.
    host.repair_events()?;
    match options.mode {
        Mode::Stdio => Box::pin(serve_stdio(host, options.metrics, signals)).await,
        Mode::Http { print_token } => {
            Box::pin(serve_http(host, print_token, options.metrics, signals, out)).await
        }
    }
}

/// Bind the metrics listener (D217) when one is asked for: after the transport's own checks and
/// binds, so a refusal stays the one failure line on stderr.
async fn bind_metrics(bind: Option<SocketAddr>) -> Result<Option<TcpListener>, HostError> {
    let Some(bind) = bind else {
        return Ok(None);
    };
    let listener = TcpListener::bind(bind).await.map_err(|error| {
        HostError::new(
            codes::SERVER_START_FAILED,
            format!("Binding the metrics listener {bind} failed: {error}"),
            "Choose another address with --metrics-bind or UMBEL_METRICS_BIND (port 0 picks a free one; each process needs its own), or leave both out to serve without metrics.".to_owned(),
        )
    })?;
    let address = listener
        .local_addr()
        .map_err(|error| start_failed("Reading the bound address", error))?;
    eprintln!("umbel metrics on http://{address}/metrics");
    Ok(Some(listener))
}

/// The metrics listener's server until `until`. It ends only with an error: after a clean stop
/// (or without a listener) it never ends, so it never cuts short the grace the transport gives
/// requests in flight after a signal.
async fn exposition(
    host: &Host,
    listener: Option<TcpListener>,
    until: impl std::future::Future<Output = ()> + Send + 'static,
) -> Result<(), HostError> {
    if let Some(listener) = listener {
        crate::metrics::serve(listener, host.metrics(), until)
            .await
            .map_err(|error| start_failed("The metrics listener", error))?;
    }
    std::future::pending().await
}

async fn serve_stdio(
    host: &Host,
    metrics: Option<SocketAddr>,
    signals: Signals,
) -> Result<(), HostError> {
    let metrics = bind_metrics(metrics).await?;
    let mut server = Box::pin(host.mcp_server().serve_stdio());
    let mut exposition = Box::pin(exposition(host, metrics, std::future::pending()));
    tokio::select! {
        result = &mut server => {
            result.map_err(|message| start_failed("MCP stdio server", message))
        }
        result = &mut exposition => result,
        () = signals.wait() => Ok(()),
    }
}

async fn serve_http(
    host: &Host,
    print_token: bool,
    metrics: Option<SocketAddr>,
    signals: Signals,
    out: &mut dyn Write,
) -> Result<(), HostError> {
    let workspace = host.workspace();
    if print_token && workspace.config().auth.mode.is_hosted() {
        return Err(HostError::new(
            codes::SERVER_START_FAILED,
            format!(
                "--print-token prints the loopback token of auth.mode = \"none\", which grants nothing in auth.mode = \"{}\"",
                workspace.config().auth.mode.as_str()
            ),
            "Leave out --print-token: a hosted mode's callers get access tokens from an authorization server its protected-resource metadata names.".to_owned(),
        ));
    }
    // Everything that can refuse (the mode, the TLS files, the token, the shared stores) refuses
    // before the address is bound.
    let server = host.http_server()?;
    // The person page's own listener in mode `gateway` (phase 5 step 5b), built before anything
    // binds too.
    let person = host.person_server()?;
    let bind = workspace.config().http.bind;
    let listener = TcpListener::bind(bind)
        .await
        .map_err(|error| start_failed(&format!("Binding {bind}"), error))?;
    let address = listener
        .local_addr()
        .map_err(|error| start_failed("Reading the bound address", error))?;
    let person = match (person, &workspace.config().http.person) {
        (Some(server), Some(config)) => {
            let listener = TcpListener::bind(config.bind)
                .await
                .map_err(|error| start_failed(&format!("Binding {}", config.bind), error))?;
            let address = listener
                .local_addr()
                .map_err(|error| start_failed("Reading the bound address", error))?;
            Some((server, listener, address, config.public_url.clone()))
        }
        _ => None,
    };
    let metrics = bind_metrics(metrics).await?;
    // Signal handlers are installed above, before this line: a client that waits for it can
    // stop the server straight away.
    let scheme = if server.is_tls() { "https" } else { "http" };
    if workspace.config().auth.mode.is_hosted() {
        eprintln!(
            "umbel listening on {scheme}://{address}{} (auth.mode = \"{}\", public URL {})",
            workspace.config().http.path,
            workspace.config().auth.mode.as_str(),
            workspace
                .config()
                .http
                .public_url
                .as_deref()
                .unwrap_or_default()
        );
    } else {
        let token_file = workspace.layout().http_token();
        eprintln!(
            "umbel listening on {scheme}://{address}{} (token in {})",
            workspace.config().http.path,
            token_file.display()
        );
    }
    if let Some((_, _, address, public_url)) = &person {
        eprintln!(
            "umbel person page listening on https://{address} (public origin {public_url}; browsers reach it directly, never through the gateway)"
        );
    }
    if print_token {
        let token = workspace.http_token()?;
        let _ = writeln!(out, "{token}");
        let _ = out.flush();
    }

    let (stop, stopped) = tokio::sync::watch::channel(false);
    let until = |mut stopped: tokio::sync::watch::Receiver<bool>| async move {
        let _ = stopped.wait_for(|stop| *stop).await;
    };
    let mut serving = Box::pin(server.serve(listener, until(stopped.clone())));
    // The person listener beside it, stopped by the same signal; without one, never ending.
    let mut page = Box::pin(async {
        match person {
            Some((server, listener, _, _)) => server.serve(listener, until(stopped.clone())).await,
            None => std::future::pending().await,
        }
    });
    let mut exposition = Box::pin(exposition(host, metrics, until(stopped.clone())));
    let interrupted = async {
        signals.wait().await;
        let _ = stop.send(true);
        tokio::time::sleep(GRACE).await;
    };
    tokio::select! {
        result = &mut serving => result.map_err(|error| start_failed("The HTTP server", error)),
        result = &mut page => result.map_err(|error| start_failed("The person page's server", error)),
        result = &mut exposition => result,
        () = interrupted => Ok(()),
    }
}

fn start_failed(what: &str, error: impl Display) -> HostError {
    HostError::new(
        codes::SERVER_START_FAILED,
        format!("{what} failed: {error}"),
        "Choose another address with --bind (port 0 picks a free one), or stop the process using this one; run umbel workspace doctor to check the workspace."
            .to_owned(),
    )
}

/// SIGINT and SIGTERM, registered when installed so that none is missed after that point.
struct Signals {
    #[cfg(unix)]
    interrupt: Option<tokio::signal::unix::Signal>,
    #[cfg(unix)]
    terminate: Option<tokio::signal::unix::Signal>,
}

impl Signals {
    #[cfg(unix)]
    fn install() -> Self {
        use tokio::signal::unix::{SignalKind, signal};
        Self {
            interrupt: signal(SignalKind::interrupt()).ok(),
            terminate: signal(SignalKind::terminate()).ok(),
        }
    }

    #[cfg(not(unix))]
    fn install() -> Self {
        Self {}
    }

    #[cfg(unix)]
    async fn wait(mut self) {
        async fn next(signal: &mut Option<tokio::signal::unix::Signal>) {
            match signal {
                Some(signal) => {
                    signal.recv().await;
                }
                None => std::future::pending().await,
            }
        }
        tokio::select! {
            () = next(&mut self.interrupt) => {}
            () = next(&mut self.terminate) => {}
        }
    }

    #[cfg(not(unix))]
    async fn wait(self) {
        let _ = tokio::signal::ctrl_c().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn future_size_of<A, F: std::future::Future>(_: fn(A) -> F) -> usize {
        std::mem::size_of::<F>()
    }

    #[test]
    fn serve_futures_stay_small_enough_for_windows_main_stack() {
        let serve_size = future_size_of(|(host, options, out): (&Host, Options, &mut Vec<u8>)| {
            serve(host, options, out)
        });
        let stdio_size =
            future_size_of(|(host, signals): (&Host, Signals)| serve_stdio(host, None, signals));
        let http_size = future_size_of(
            |(host, print_token, signals, out): (&Host, bool, Signals, &mut Vec<u8>)| {
                serve_http(host, print_token, None, signals, out)
            },
        );
        for (name, size) in [
            ("serve::serve", serve_size),
            ("serve::serve_stdio", stdio_size),
            ("serve::serve_http", http_size),
        ] {
            assert!(
                size <= 16 * 1024,
                "{name} future is {size} bytes; keep inner serve futures boxed so Windows debug builds do not overflow the 1 MiB main thread stack"
            );
        }
    }
}
