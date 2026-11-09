//! The decision before dispatch (`spec/authorization.md`, M6, "Before dispatch: the 403"), in one
//! implementation that the bearer layer and a host's own HTTP layer both run.

use std::sync::Arc;

use bytes::Bytes;
use http::header::{CONTENT_TYPE, WWW_AUTHENTICATE};
use http::{HeaderValue, Method, Response, StatusCode};
use http_body_util::Full;
use serde_json::{Map, Value};

use super::super::McpServer;
use super::resource::joined_tokens;
use super::scopes::{call_decision, request_missing, RequestDecision};
use super::{admitted, Authorization, Credentials};

/// The `WWW-Authenticate` challenge of a host's 403 when its callers authenticate by a scheme of
/// its own rather than `Bearer` (`spec/authorization.md`, M6, "A host's own layer"):
///
/// `<scheme> <name>="<value>", ..., error="insufficient_scope", scope="<missing>"`
///
/// The host's parameters come first, in the order given; `scope` follows M5's rules (only scope
/// tokens, joined by single spaces in M6's order, and left out rather than sent empty). Nothing
/// points to protected-resource metadata: a host with a scheme of its own publishes none for it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScopeChallenge {
    scheme: String,
    params: Vec<(String, String)>,
}

/// Whether `text` is an HTTP token (RFC 9110 5.6.2).
fn is_token(text: &str) -> bool {
    !text.is_empty()
        && text.bytes().all(|byte| {
            byte.is_ascii_alphanumeric()
                || matches!(
                    byte,
                    b'!' | b'#'
                        | b'$'
                        | b'%'
                        | b'&'
                        | b'\''
                        | b'*'
                        | b'+'
                        | b'-'
                        | b'.'
                        | b'^'
                        | b'_'
                        | b'`'
                        | b'|'
                        | b'~'
                )
        })
}

impl ScopeChallenge {
    /// A challenge in `scheme`.
    ///
    /// # Errors
    /// `scheme` is not an HTTP token, or is `Bearer` in any case: M5's `Bearer` challenge, with
    /// its `resource_metadata`, is the default and cannot be restated.
    pub fn new(scheme: impl Into<String>) -> Result<Self, String> {
        let scheme = scheme.into();
        if !is_token(&scheme) {
            return Err(format!(
                "[AFD] the challenge scheme {scheme:?} is not an HTTP token"
            ));
        }
        if scheme.eq_ignore_ascii_case("Bearer") {
            return Err(
                "[AFD] a Bearer 403 is M5's own challenge; a ScopeChallenge names another scheme"
                    .to_owned(),
            );
        }
        Ok(Self {
            scheme,
            params: Vec::new(),
        })
    }

    /// Add the parameter `name="value"` (a `realm`, say), after those added before.
    ///
    /// # Errors
    /// `name` is not an HTTP token, is `error` or `scope` in any case (the decision sets them), or
    /// was added before; `value` holds a character other than visible ASCII and the space, or a
    /// `"` or `\`, so the value is always one quoted string without escapes.
    pub fn with_param(
        mut self,
        name: impl Into<String>,
        value: impl Into<String>,
    ) -> Result<Self, String> {
        let (name, value) = (name.into(), value.into());
        if !is_token(&name) {
            return Err(format!(
                "[AFD] the challenge parameter {name:?} is not an HTTP token"
            ));
        }
        if name.eq_ignore_ascii_case("error") || name.eq_ignore_ascii_case("scope") {
            return Err(format!(
                "[AFD] the challenge parameter {name:?} is set by the scope decision"
            ));
        }
        if self
            .params
            .iter()
            .any(|(known, _)| known.eq_ignore_ascii_case(&name))
        {
            return Err(format!(
                "[AFD] the challenge parameter {name:?} is named more than once"
            ));
        }
        if !value
            .bytes()
            .all(|byte| (byte == b' ' || byte.is_ascii_graphic()) && byte != b'"' && byte != b'\\')
        {
            return Err(format!(
                "[AFD] the value of the challenge parameter {name:?} must be visible ASCII or spaces, without '\"' or '\\'"
            ));
        }
        self.params.push((name, value));
        Ok(self)
    }

    /// The challenge's value for the `missing` scopes, in order. A name that is not a scope
    /// token is left out, and with no scope left `scope` is left out rather than sent empty.
    pub fn header_value(&self, missing: &[String]) -> String {
        let mut params: Vec<String> = self
            .params
            .iter()
            .map(|(name, value)| format!("{name}=\"{value}\""))
            .collect();
        params.push("error=\"insufficient_scope\"".to_owned());
        let scopes = joined_tokens(missing);
        if !scopes.is_empty() {
            params.push(format!("scope=\"{scopes}\""));
        }
        format!("{} {}", self.scheme, params.join(", "))
    }
}

/// What [`PreDispatchCheck::decide`] decided about a request.
#[derive(Debug)]
#[must_use]
pub enum PreDispatch {
    /// Pass the request on: no step is missing a scope, or the request is not one this decision
    /// decides (it is decided again after routing).
    Proceed,
    /// Answer with this response and pass nothing on: a 403 naming every missing scope, a 400
    /// for a JSON-RPC batch, or a 413 for a body over the authorization's cap. It is the bearer
    /// layer's own response, byte for byte, but for a 403's challenge when the host set one
    /// ([`PreDispatchCheck::with_challenge`]).
    Respond(Response<Full<Bytes>>),
}

/// The decision before dispatch (`spec/authorization.md`, M6), from
/// [`McpServer::pre_dispatch_check`]: the one the [`BearerLayer`](super::BearerLayer) runs, for
/// a host whose own HTTP layer admits credentials instead (a gateway that vouches for each
/// caller, for example).
///
/// It is the bearer layer's decision, not a copy: the layer runs this same value. So a host
/// that runs it answers every request exactly as the bearer layer would after admitting the
/// same credentials, and cannot drift from it:
///
/// - the same body cap ([`Authorization::with_max_body_bytes`]; over it, 413);
/// - a JSON-RPC batch (an array body) refused with 400 and `-32600` before anything is decided;
/// - the same commands named in a `tools/call` (a command's own tool, a hybrid first-class tool,
///   grouped actions, `afd-call`, every step of `afd-batch` and `afd-pipe`), resolved as the
///   router resolves them;
/// - a name that does not exist for the caller (unknown, not exposed to MCP, or hidden by the
///   resolver's [`known`](super::ScopeResolver::known)) decided on the required scopes alone,
///   with the resolver never asked about it, so a hidden command and a missing one get the same
///   answer;
/// - any missing step refusing the whole request with one 403 naming every missing scope, each
///   once, in step order; every other method needing the required scopes;
/// - a body it cannot parse, and every method but `POST`, passed on to be decided after routing.
///
/// The 403's body is M5's, with the suggestion
/// [`ProtectedResource::with_scope_source`](super::ProtectedResource::with_scope_source) names;
/// its challenge is M5's `Bearer` one unless the host sets its own scheme with
/// [`Self::with_challenge`].
#[derive(Clone)]
pub struct PreDispatchCheck {
    server: McpServer,
    pub(super) auth: Arc<Authorization>,
    challenge: Option<ScopeChallenge>,
}

impl std::fmt::Debug for PreDispatchCheck {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PreDispatchCheck")
            .field("challenge", &self.challenge)
            .finish_non_exhaustive()
    }
}

/// A JSON response with `body` and, when given, the challenge `challenge`.
pub(super) fn json_response(
    status: StatusCode,
    body: &Value,
    challenge: Option<String>,
) -> Response<Full<Bytes>> {
    let mut response = Response::new(Full::new(Bytes::from(body.to_string())));
    *response.status_mut() = status;
    response
        .headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    if let Some(challenge) = challenge {
        // The challenge is built from checked URLs, tokens and values: visible ASCII.
        if let Ok(value) = HeaderValue::from_str(&challenge) {
            response.headers_mut().insert(WWW_AUTHENTICATE, value);
        }
    }
    response
}

/// An empty response with `status`.
pub(super) fn plain(status: StatusCode) -> Response<Full<Bytes>> {
    let mut response = Response::new(Full::new(Bytes::new()));
    *response.status_mut() = status;
    response
}

/// The 400 for a JSON-RPC batch.
fn batch_refused() -> Response<Full<Bytes>> {
    json_response(
        StatusCode::BAD_REQUEST,
        &serde_json::json!({
            "jsonrpc": "2.0",
            "id": null,
            "error": {
                "code": -32600,
                "message": "JSON-RPC batches are not supported: send one message per request",
            },
        }),
        None,
    )
}

/// What the decision found in a body.
enum Decided {
    /// A JSON-RPC batch: MCP has none since 2025-06-18, so it is refused before deciding.
    Batch,
    /// The scope decision on the one message.
    Scopes(RequestDecision),
}

impl PreDispatchCheck {
    pub(super) fn new(server: McpServer, auth: Arc<Authorization>) -> Self {
        Self {
            server,
            auth,
            challenge: None,
        }
    }

    /// Answer a 403 with `challenge` instead of M5's `Bearer` one, for a host whose callers
    /// authenticate by another scheme. The body is unchanged; name its suggestion's source with
    /// [`ProtectedResource::with_scope_source`](super::ProtectedResource::with_scope_source).
    pub fn with_challenge(mut self, challenge: ScopeChallenge) -> Self {
        self.challenge = Some(challenge);
        self
    }

    /// The largest body the bearer layer reads ([`Authorization::with_max_body_bytes`]): read a
    /// request's body with at most this many bytes (a `http_body_util::Limited`, say) before
    /// [`Self::decide`], which answers a longer one with the bearer layer's 413.
    pub fn max_body_bytes(&self) -> usize {
        self.auth.max_body_bytes
    }

    /// Decide the request whose head is `request` and whose body, already read, is `body`: the
    /// credentials decided are those admitted in `request`'s extensions for this server's own
    /// authorization ([`Authorization::admit`]). Call it after admitting them, and pass the
    /// request on only on [`PreDispatch::Proceed`].
    ///
    /// A body over [`Self::max_body_bytes`] is the bearer layer's 413 whatever the request.
    /// Otherwise a request without credentials admitted for this authorization is not decided
    /// here and proceeds: the server refuses it with `UNAUTHORIZED` before anything runs (M1).
    pub fn decide(&self, request: &http::request::Parts, body: &[u8]) -> PreDispatch {
        if body.len() > self.auth.max_body_bytes {
            return PreDispatch::Respond(plain(StatusCode::PAYLOAD_TOO_LARGE));
        }
        if request.method != Method::POST {
            return PreDispatch::Proceed;
        }
        let Some(credentials) = admitted(&self.auth, &request.extensions) else {
            return PreDispatch::Proceed;
        };
        match self.body_decision(body, credentials) {
            Some(Decided::Batch) => PreDispatch::Respond(batch_refused()),
            Some(Decided::Scopes(RequestDecision::Forbidden(missing))) => {
                PreDispatch::Respond(self.forbidden(&missing))
            }
            Some(Decided::Scopes(RequestDecision::Proceed)) | None => PreDispatch::Proceed,
        }
    }

    /// The 403 for the `missing` scopes (M5).
    fn forbidden(&self, missing: &[String]) -> Response<Full<Bytes>> {
        let metadata = &self.auth.metadata;
        let challenge = match &self.challenge {
            Some(challenge) => challenge.header_value(missing),
            None => metadata.forbidden_challenge(missing),
        };
        json_response(
            StatusCode::FORBIDDEN,
            &metadata.forbidden_body(missing),
            Some(challenge),
        )
    }

    /// The decision on a request body (M6): a JSON-RPC `tools/call` is decided over every call
    /// it names, any other message needs the required scopes. `None` for a body that cannot be
    /// parsed, decided again after routing.
    fn body_decision(&self, body: &[u8], credentials: &Credentials) -> Option<Decided> {
        let message = serde_json::from_slice::<Value>(body).ok()?;
        if message.is_array() {
            return Some(Decided::Batch);
        }
        let params = message.get("params");
        let name = params
            .and_then(|params| params.get("name"))
            .and_then(Value::as_str);
        Some(Decided::Scopes(
            match (message.get("method").and_then(Value::as_str), name) {
                (Some("tools/call"), Some(name)) => {
                    let args = params
                        .and_then(|params| params.get("arguments"))
                        .and_then(Value::as_object)
                        .cloned()
                        .unwrap_or_else(Map::new);
                    call_decision(&self.server, &self.auth, name, &args, credentials)
                }
                _ => request_missing(&self.auth, credentials),
            },
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_host_challenge_names_its_scheme_and_parameters_then_the_error_and_scopes() {
        let challenge = ScopeChallenge::new("Umbel-Gateway")
            .unwrap()
            .with_param("realm", "umbel")
            .unwrap();
        assert_eq!(
            challenge.header_value(&["a:write".to_owned(), "b:read".to_owned()]),
            "Umbel-Gateway realm=\"umbel\", error=\"insufficient_scope\", scope=\"a:write b:read\""
        );
        // Only scope tokens are named, and no empty `scope` is sent.
        assert_eq!(
            challenge.header_value(&["not a token".to_owned()]),
            "Umbel-Gateway realm=\"umbel\", error=\"insufficient_scope\""
        );
        assert_eq!(
            ScopeChallenge::new("X").unwrap().header_value(&[]),
            "X error=\"insufficient_scope\""
        );
    }

    #[test]
    fn a_host_challenge_is_always_one_valid_header_value() {
        for scheme in ["", "Bearer", "bearer", "a b", "a\"b", "é"] {
            assert!(ScopeChallenge::new(scheme).is_err(), "{scheme:?}");
        }
        let base = ScopeChallenge::new("Gw").unwrap();
        for (name, value) in [
            ("error", "x"),
            ("Scope", "x"),
            ("a b", "x"),
            ("", "x"),
            ("realm", "a\"b"),
            ("realm", "a\\b"),
            ("realm", "a\nb"),
            ("realm", "é"),
        ] {
            assert!(
                base.clone().with_param(name, value).is_err(),
                "{name:?}={value:?}"
            );
        }
        let realm = base.with_param("realm", "a b").unwrap();
        assert!(realm.clone().with_param("REALM", "c").is_err());
        assert!(HeaderValue::from_str(&realm.header_value(&["s".to_owned()])).is_ok());
    }
}
