//! The command line's call to a running server (the specification's 3.2):
//! when a server owns the store, `loam-mail <command>` does not open it, and
//! sends the call to the server's `/cli` route with `cli.token` instead.

use afd::{CommandError, CommandResult, failure};
use http_body_util::{BodyExt, Full, Limited};
use hyper::body::Bytes;
use hyper_util::rt::TokioIo;

use crate::home::Home;
use crate::pair::{decode_hex32, verify_health_proof};
use crate::serve::{CLI_PATH, Forwarded, HEALTH_PATH, PROOF_HEADER, cli_token_file, running};
use crate::tokens;

/// The largest reply the command line reads: above every output budget's
/// maximum, which no command's goes past (the specification's 3.2).
const MOST_REPLY: usize = 8 * 1024 * 1024;

/// Maximum `/health` response body bytes drained unread before reusing the
/// verified HTTP/1.1 connection for `/cli`.
const HEALTH_BODY_DISCARD_MAX: usize = 4096;

/// A running server, as its files in the data directory describe it.
#[derive(Debug, Clone)]
pub struct Server {
    port: u16,
    token: String,
    transport: Option<String>,
    proof_key: Option<[u8; 32]>,
}

impl Server {
    /// The server `home`'s files name, when both are there.
    #[must_use]
    pub fn find(home: &Home) -> Option<Self> {
        let entry = running(home)?;
        let token = std::fs::read_to_string(cli_token_file(home)).ok()?;
        let proof_key = match entry.proof_key.as_deref() {
            Some(hex) => Some(decode_hex32(hex)?),
            None => None,
        };
        Some(Self {
            port: entry.port,
            token: token.trim().to_string(),
            transport: entry.transport,
            proof_key,
        })
    }

    /// The port it serves on.
    #[must_use]
    pub fn port(&self) -> u16 {
        self.port
    }

    /// The server's transport label, defaulting to `"real"` for older
    /// `server.json` files without the field.
    #[must_use]
    pub fn transport(&self) -> &str {
        self.transport.as_deref().unwrap_or("real")
    }

    /// The server's expected proof key as 64 lowercase hex characters, if
    /// present in `server.json`.
    #[must_use]
    pub fn proof_key_hex(&self) -> Option<String> {
        self.proof_key.as_ref().map(|key| tokens::encode_hex(key))
    }

    /// Sends `call` and returns the command's result, or a failure in the
    /// engine's words when the server cannot be reached or answers with
    /// something else.
    pub async fn call(&self, call: &Forwarded) -> CommandResult<serde_json::Value> {
        self.call_inner(call, false).await
    }

    /// Sends `call` only after verifying `/health` `X-Loam-Proof` against the
    /// owner-protected `proof_key` on the same HTTP/1.1 connection. Fails
    /// closed when `server.json` carries no `proof_key` or the listener fails
    /// verification.
    pub async fn call_verified(&self, call: &Forwarded) -> CommandResult<serde_json::Value> {
        self.call_inner(call, true).await
    }

    async fn call_inner(
        &self,
        call: &Forwarded,
        require_proof: bool,
    ) -> CommandResult<serde_json::Value> {
        match self.send(call, require_proof).await {
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

    async fn send(
        &self,
        call: &Forwarded,
        require_proof: bool,
    ) -> Result<CommandResult<serde_json::Value>, String> {
        if require_proof && self.proof_key.is_none() {
            return Err("server.json lacks an instance proof key".to_string());
        }
        let body = serde_json::to_vec(call).map_err(|error| error.to_string())?;
        let host = format!("127.0.0.1:{}", self.port);
        let stream = tokio::net::TcpStream::connect(("127.0.0.1", self.port))
            .await
            .map_err(|_| "it did not answer".to_string())?;
        let (mut sender, connection) = hyper::client::conn::http1::handshake(TokioIo::new(stream))
            .await
            .map_err(|_| "it did not answer".to_string())?;
        let connection = tokio::spawn(connection);
        if let Some(expected_key) = self.proof_key.as_ref() {
            let nonce = tokens::random_hex(32)?;
            let health_req = hyper::Request::get(format!("{HEALTH_PATH}?nonce={nonce}"))
                .header(hyper::header::HOST, &host)
                .body(Full::new(Bytes::new()))
                .map_err(|error| error.to_string())?;
            sender
                .ready()
                .await
                .map_err(|_| "it stopped answering".to_string())?;
            let health_resp = sender
                .send_request(health_req)
                .await
                .map_err(|_| "it stopped answering".to_string())?;
            let proof_ok = if health_resp.status() == hyper::StatusCode::OK {
                let mut headers = health_resp.headers().get_all(PROOF_HEADER).iter();
                match (headers.next(), headers.next()) {
                    (Some(value), None) => value
                        .to_str()
                        .ok()
                        .is_some_and(|proof| verify_health_proof(expected_key, &nonce, proof)),
                    _ => false,
                }
            } else {
                false
            };
            if !proof_ok {
                connection.abort();
                return Err("the listener on that port failed identity verification".to_string());
            }
            if Limited::new(health_resp.into_body(), HEALTH_BODY_DISCARD_MAX)
                .collect()
                .await
                .is_err()
            {
                connection.abort();
                return Err("the listener returned an invalid health response".to_string());
            }
            sender
                .ready()
                .await
                .map_err(|_| "it closed the connection before handling the command".to_string())?;
        }
        let request = hyper::Request::post(CLI_PATH)
            .header(hyper::header::HOST, &host)
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
