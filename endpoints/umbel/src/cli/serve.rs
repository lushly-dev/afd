//! `umbel serve`: MCP over stdio or Streamable HTTP until the client leaves or a signal arrives.
//!
//! stdout belongs to JSON-RPC on stdio, so every message here goes to stderr; the one exception
//! is `--print-token`, which prints the bearer token alone on stdout in HTTP mode, where stdout
//! is otherwise unused.

use crate::host::{Host, HostError};
use crate::workspace::codes;
use std::fmt::Display;
use std::io::Write;
use std::time::Duration;
use tokio::net::TcpListener;

/// How long requests in flight get after SIGINT or SIGTERM before the process exits anyway.
const GRACE: Duration = Duration::from_secs(10);

/// Which transport `umbel serve` runs.
pub(super) enum Mode {
    Stdio,
    Http { print_token: bool },
}

/// Serve until the client disconnects (stdio) or a signal arrives; `Ok` is exit code 0.
///
/// # Errors
/// A startup failure: the token cannot be created, the address is in use, stdio cannot open.
pub(super) async fn serve(host: &Host, mode: Mode, out: &mut dyn Write) -> Result<(), HostError> {
    let signals = Signals::install();
    // The full catch-up of the event streams (a stream damaged by hand is repaired too), under
    // the workspace lock, before a client can ask for events. It runs before the runtime is busy
    // with any request, so blocking here is brief.
    host.repair_events()?;
    match mode {
        Mode::Stdio => serve_stdio(host, signals).await,
        Mode::Http { print_token } => serve_http(host, print_token, signals, out).await,
    }
}

async fn serve_stdio(host: &Host, signals: Signals) -> Result<(), HostError> {
    tokio::select! {
        result = host.mcp_server().serve_stdio() => {
            result.map_err(|message| start_failed("MCP stdio server", message))
        }
        () = signals.wait() => Ok(()),
    }
}

async fn serve_http(
    host: &Host,
    print_token: bool,
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
    let bind = workspace.config().http.bind;
    let listener = TcpListener::bind(bind)
        .await
        .map_err(|error| start_failed(&format!("Binding {bind}"), error))?;
    let address = listener
        .local_addr()
        .map_err(|error| start_failed("Reading the bound address", error))?;
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
    if print_token {
        let token = workspace.http_token()?;
        let _ = writeln!(out, "{token}");
        let _ = out.flush();
    }

    let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
    let serving = server.serve(listener, async move {
        let _ = stopped.await;
    });
    tokio::pin!(serving);
    let interrupted = async {
        signals.wait().await;
        let _ = stop.send(());
        tokio::time::sleep(GRACE).await;
    };
    tokio::select! {
        result = &mut serving => result.map_err(|error| start_failed("The HTTP server", error)),
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
