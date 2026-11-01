//! The Streamable HTTP surface: `http.path` and `/health` behind the bearer layer.
//!
//! The layer is access control, not identity (D32). Loopback is reachable by every process and
//! every user on the machine, so every request, `/health` included, must carry the workspace's
//! token. It runs before AFD's Host and Origin checks, and a valid token says nothing about who
//! calls: the context hook still sets the one loopback principal.

use crate::host::HostError;
use crate::workspace::Workspace;
use afd::server::{HttpOptions, McpServer};
use axum::Router;
use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::middleware::{Next, from_fn_with_state};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::convert::Infallible;
use std::net::IpAddr;
use std::sync::Arc;
use tower::Service;

/// The names a loopback `Host` header may carry, which AFD's default also allows.
const LOOPBACK_NAMES: [&str; 3] = ["localhost", "127.0.0.1", "[::1]"];

/// `HttpOptions` from configuration: the loopback names, the bound IP when it is another
/// loopback address, and `http.allowed_hosts`; `http.allowed_origins`; `http.max_body_bytes`.
pub(crate) fn options(workspace: &Workspace) -> HttpOptions {
    let http = &workspace.config().http;
    let mut allowed_hosts: Vec<String> = LOOPBACK_NAMES.iter().map(|name| (*name).into()).collect();
    let bound = match http.bind.ip() {
        IpAddr::V4(ip) => ip.to_string(),
        IpAddr::V6(ip) => format!("[{ip}]"),
    };
    allowed_hosts.push(bound);
    allowed_hosts.extend(http.allowed_hosts.iter().cloned());
    HttpOptions {
        allowed_hosts,
        allowed_origins: http.allowed_origins.clone(),
        max_body_bytes: usize::try_from(http.max_body_bytes).unwrap_or(usize::MAX),
    }
}

/// The router: the MCP endpoint at `http.path` and `GET /health`, behind the bearer layer.
///
/// # Errors
/// `WORKSPACE_KEY_INVALID` when `state/keys/http.token` exists but is malformed, and
/// `WORKSPACE_STATE_UNWRITABLE` when it cannot be created; `WORKSPACE_CONFIG_INVALID` naming
/// `mcp.first_class_tools` when the server's surface is invalid.
pub(crate) fn router(server: &McpServer, workspace: &Workspace) -> Result<Router, HostError> {
    let token = workspace.http_token()?;
    let service = server
        .try_streamable_http_service(options(workspace))
        .map_err(|message| {
            HostError::config_invalid(
                "mcp.first_class_tools",
                &format!("is not valid: {message}"),
                "Name 1 to 8 registered commands that are exposed to MCP.",
            )
        })?;
    let path = workspace.config().http.path.clone();
    // An exact-path service rather than `nest_service`: the path is deployer text, and axum
    // reads braces and wildcards in a nested path as captures.
    let mcp = tower::service_fn(move |request: Request| {
        let mut service = service.clone();
        let at_path = request.uri().path() == path;
        async move {
            if !at_path {
                return Ok::<Response, Infallible>(StatusCode::NOT_FOUND.into_response());
            }
            match service.call(request).await {
                Ok(response) => Ok(response.into_response()),
                Err(never) => match never {},
            }
        }
    });
    let bearer = Arc::new(Bearer::new(&token, &workspace.layout().http_token()));
    Ok(Router::new()
        .route("/health", get(health))
        .fallback_service(mcp)
        .layer(from_fn_with_state(bearer, require_bearer)))
}

async fn health() -> Response {
    json_response(StatusCode::OK, &json!({ "status": "ok" }).to_string())
}

fn json_response(status: StatusCode, body: &str) -> Response {
    let mut response = Response::new(Body::from(body.to_owned()));
    *response.status_mut() = status;
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_static("application/json"),
    );
    response
}

/// The stored token as a digest, and the body of a refusal.
struct Bearer {
    digest: [u8; 32],
    refusal: String,
}

impl Bearer {
    fn new(token: &str, token_file: &std::path::Path) -> Self {
        Self {
            digest: Sha256::digest(token.as_bytes()).into(),
            refusal: json!({
                "error": "UNAUTHORIZED",
                "suggestion": format!(
                    "Send Authorization: Bearer <token>; the token is in {}, readable by the workspace owner.",
                    token_file.display()
                ),
            })
            .to_string(),
        }
    }

    /// Whether the request carries the token. Both sides are hashed first, so the comparison's
    /// time does not depend on how much of the token matches.
    fn permits(&self, headers: &HeaderMap) -> bool {
        let Some(value) = headers
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
        else {
            return false;
        };
        let Some((scheme, presented)) = value.split_once(' ') else {
            return false;
        };
        if !scheme.eq_ignore_ascii_case("bearer") {
            return false;
        }
        let presented: [u8; 32] = Sha256::digest(presented.trim().as_bytes()).into();
        presented
            .iter()
            .zip(self.digest.iter())
            .fold(0u8, |difference, (a, b)| difference | (a ^ b))
            == 0
    }

    fn refuse(&self) -> Response {
        let mut response = json_response(StatusCode::UNAUTHORIZED, &self.refusal);
        response.headers_mut().insert(
            header::WWW_AUTHENTICATE,
            header::HeaderValue::from_static("Bearer realm=\"umbel\""),
        );
        response
    }
}

async fn require_bearer(
    State(bearer): State<Arc<Bearer>>,
    request: Request,
    next: Next,
) -> Response {
    if bearer.permits(request.headers()) {
        next.run(request).await
    } else {
        bearer.refuse()
    }
}
