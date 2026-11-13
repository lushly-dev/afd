//! The command line's call to a running server (the specification's 3.2):
//! when a server owns the store, `loam-mail <command>` does not open it, and
//! sends the call to the server's `/cli` route with `cli.token` instead.

use afd::{CommandError, CommandResult, failure};
use http_body_util::{BodyExt, Full, Limited};
use hyper::body::Bytes;
use hyper_util::rt::TokioIo;

use crate::home::Home;
use crate::serve::{CLI_PATH, Forwarded, cli_token_file, running};

/// The largest reply the command line reads: above every output budget's
/// maximum, which no command's goes past (the specification's 3.2).
const MOST_REPLY: usize = 8 * 1024 * 1024;

/// A running server, as its files in the data directory describe it.
#[derive(Debug, Clone)]
pub struct Server {
    port: u16,
    token: String,
}

impl Server {
    /// The server `home`'s files name, when both are there.
    #[must_use]
    pub fn find(home: &Home) -> Option<Self> {
        let entry = running(home)?;
        let token = std::fs::read_to_string(cli_token_file(home)).ok()?;
        Some(Self {
            port: entry.port,
            token: token.trim().to_string(),
        })
    }

    /// The port it serves on.
    #[must_use]
    pub fn port(&self) -> u16 {
        self.port
    }

    /// Sends `call` and returns the command's result, or a failure in the
    /// engine's words when the server cannot be reached or answers with
    /// something else.
    pub async fn call(&self, call: &Forwarded) -> CommandResult<serde_json::Value> {
        match self.send(call).await {
            Ok(result) => result,
            Err(problem) => failure(
                CommandError::new(
                    "STORE_IN_USE",
                    format!("a loam-mail server owns the store, and {problem}"),
                )
                .with_suggestion(
                    "Check that `loam-mail serve` is still running, or stop it and run the command again.",
                ),
            ),
        }
    }

    async fn send(&self, call: &Forwarded) -> Result<CommandResult<serde_json::Value>, String> {
        let body = serde_json::to_vec(call).map_err(|error| error.to_string())?;
        let stream = tokio::net::TcpStream::connect(("127.0.0.1", self.port))
            .await
            .map_err(|_| "it did not answer".to_string())?;
        let (mut sender, connection) = hyper::client::conn::http1::handshake(TokioIo::new(stream))
            .await
            .map_err(|_| "it did not answer".to_string())?;
        let connection = tokio::spawn(connection);
        let request = hyper::Request::post(CLI_PATH)
            .header(hyper::header::HOST, format!("127.0.0.1:{}", self.port))
            .header(
                hyper::header::AUTHORIZATION,
                format!("Bearer {}", self.token),
            )
            .header(hyper::header::CONTENT_TYPE, "application/json")
            .body(Full::new(Bytes::from(body)))
            .map_err(|error| error.to_string())?;
        let response = sender
            .send_request(request)
            .await
            .map_err(|_| "it stopped answering".to_string())?;
        let status = response.status();
        let body = Limited::new(response.into_body(), MOST_REPLY)
            .collect()
            .await
            .map_err(|_| "its reply could not be read".to_string())?
            .to_bytes();
        connection.abort();
        if status == hyper::StatusCode::UNAUTHORIZED || status == hyper::StatusCode::FORBIDDEN {
            return Err(
                "it refused the command line's token; it may have been restarted".to_string(),
            );
        }
        if !status.is_success() {
            return Err(format!("it answered {}", status.as_u16()));
        }
        serde_json::from_slice(&body).map_err(|_| "its reply could not be read".to_string())
    }
}
