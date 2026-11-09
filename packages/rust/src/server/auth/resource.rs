//! The protected resource: its URI, the audience rule, the metadata and the challenges
//! (`spec/authorization.md`, M3.1, M5 and M7).

use serde_json::{json, Map, Value};

use crate::credentials::is_scope_token;

/// The well-known suffix of protected-resource metadata (RFC 9728 3.1).
pub const PROTECTED_RESOURCE_WELL_KNOWN: &str = "/.well-known/oauth-protected-resource";

/// An absolute URL split into the parts the audience rule compares. Only `scheme://authority`
/// followed by a path is accepted: user information, a query or a fragment is refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct UrlParts<'a> {
    pub(crate) scheme: &'a str,
    pub(crate) host: &'a str,
    /// The port as written, without its colon; `None` when no colon is written.
    pub(crate) port: Option<&'a str>,
    /// Everything after the authority, as written (empty, or starting with `/`).
    pub(crate) path: &'a str,
    /// `scheme://authority`, as written.
    pub(crate) origin: &'a str,
}

/// Split `url` for comparison, or `None` when it is not `scheme://host[:port][path]` in visible
/// ASCII with no user information, query or fragment.
pub(crate) fn split_url(url: &str) -> Option<UrlParts<'_>> {
    if url.is_empty() || !url.bytes().all(|byte| byte.is_ascii_graphic()) {
        return None;
    }
    if url.contains(['?', '#', '"', '\\', '<', '>', '`', '{', '}', '|', '^']) {
        return None;
    }
    let (scheme, rest) = url.split_once("://")?;
    let mut scheme_bytes = scheme.bytes();
    if !scheme_bytes.next()?.is_ascii_alphabetic()
        || !scheme_bytes
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'-' | b'.'))
    {
        return None;
    }
    let authority_end = rest.find('/').unwrap_or(rest.len());
    let (authority, path) = rest.split_at(authority_end);
    if authority.is_empty() || authority.contains('@') {
        return None;
    }
    let (host, port) = if authority.starts_with('[') {
        let close = authority.find(']')?;
        let (host, after) = authority.split_at(close + 1);
        match after {
            "" => (host, None),
            _ => (host, Some(after.strip_prefix(':')?)),
        }
    } else {
        match authority.rsplit_once(':') {
            Some((host, port)) => (host, Some(port)),
            None => (authority, None),
        }
    };
    if host.is_empty()
        || (host.contains(':') && !host.starts_with('['))
        || port.is_some_and(|port| !port.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return None;
    }
    let origin = &url[..scheme.len() + 3 + authority.len()];
    Some(UrlParts {
        scheme,
        host,
        port,
        path,
        origin,
    })
}

/// Whether `candidate` names `resource` under `spec/authorization.md` M3.1: the scheme and the
/// host compare ignoring ASCII case; the port as written (`:443` is not the same as no port), the
/// path (a trailing slash differs), percent-encoding and case compare exactly; a value with user
/// information, a query or a fragment never matches.
pub(crate) fn same_resource(resource: &str, candidate: &str) -> bool {
    let (Some(expected), Some(actual)) = (split_url(resource), split_url(candidate)) else {
        return false;
    };
    expected.scheme.eq_ignore_ascii_case(actual.scheme)
        && expected.host.eq_ignore_ascii_case(actual.host)
        && expected.port == actual.port
        && expected.path == actual.path
}

/// Whether an `aud` claim (absent: `None`) accepts `resource` (`spec/authorization.md`, M3.1): a
/// string, or an array of exactly one string, naming the resource. A token with several
/// audiences is refused even when one matches.
pub fn audience_accepts(aud: Option<&Value>, resource: &str) -> bool {
    match aud {
        Some(Value::String(audience)) => same_resource(resource, audience),
        Some(Value::Array(audiences)) => match audiences.as_slice() {
            [Value::String(audience)] => same_resource(resource, audience),
            _ => false,
        },
        _ => false,
    }
}

/// Check that `url` can be the resource or an authorization server: an absolute `https` URL with
/// no user information, query or fragment, in visible ASCII.
pub(crate) fn check_https_url(what: &str, url: &str) -> Result<(), String> {
    match split_url(url) {
        Some(parts) if parts.scheme.eq_ignore_ascii_case("https") => Ok(()),
        _ => Err(format!(
            "[AFD] {what} {url:?} is not an absolute https URL without user information, query or fragment"
        )),
    }
}

/// RFC 9728 protected-resource metadata, and the challenges that point to it
/// (`spec/authorization.md`, M5 and M7).
///
/// The metadata is served without authentication at two URLs built from the resource
/// ([`Self::metadata_urls`]); the first is the `resource_metadata` of every challenge.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProtectedResource {
    resource: String,
    authorization_servers: Vec<String>,
    scopes_supported: Vec<String>,
    resource_name: Option<String>,
    bound_tokens_required: bool,
    /// What a caller obtains to gain a scope, in the step-up suggestion; `None` for "a token for
    /// <resource>".
    scope_source: Option<String>,
}

impl ProtectedResource {
    /// The metadata of `resource` (the MCP endpoint's absolute `https` URL, the token audience),
    /// whose tokens the `authorization_servers` issue, in that order.
    ///
    /// # Errors
    /// `resource` or an authorization server is not an absolute `https` URL without user
    /// information, query or fragment; no authorization server is named, or one is named twice.
    pub fn new<I, S>(resource: impl Into<String>, authorization_servers: I) -> Result<Self, String>
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        let resource = resource.into();
        check_https_url("resource", &resource)?;
        let mut servers: Vec<String> = Vec::new();
        for server in authorization_servers {
            let server = server.into();
            check_https_url("authorization server", &server)?;
            if servers.contains(&server) {
                return Err(format!(
                    "[AFD] authorization server {server:?} is named more than once"
                ));
            }
            servers.push(server);
        }
        if servers.is_empty() {
            return Err(
                "[AFD] protected-resource metadata needs at least one authorization server"
                    .to_owned(),
            );
        }
        Ok(Self {
            resource,
            authorization_servers: servers,
            scopes_supported: Vec::new(),
            resource_name: None,
            bound_tokens_required: false,
            scope_source: None,
        })
    }

    /// Publish these scopes as `scopes_supported`, and in a 401's `scope`. May be minimal: further
    /// scopes arrive by step-up through 403 challenges. Default: none, and the field is left out.
    ///
    /// # Errors
    /// A scope that is not a scope token (RFC 6749 3.3), or one named twice.
    pub fn with_scopes_supported<I, S>(mut self, scopes: I) -> Result<Self, String>
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        let mut supported: Vec<String> = Vec::new();
        for scope in scopes {
            let scope = scope.into();
            if !is_scope_token(&scope) {
                return Err(format!("[AFD] scope {scope:?} is not an OAuth scope token"));
            }
            if supported.contains(&scope) {
                return Err(format!("[AFD] scope {scope:?} is published more than once"));
            }
            supported.push(scope);
        }
        self.scopes_supported = supported;
        Ok(self)
    }

    /// Publish `resource_name`. Default: none.
    pub fn with_resource_name(mut self, name: impl Into<String>) -> Self {
        self.resource_name = Some(name.into());
        self
    }

    /// Publish `tls_client_certificate_bound_access_tokens: true`: the verifier requires
    /// certificate-bound tokens. It must agree with the verifier's rules. Default: `false`.
    pub fn with_bound_tokens_required(mut self, required: bool) -> Self {
        self.bound_tokens_required = required;
        self
    }

    /// Name what a caller obtains to gain a scope, for a host whose callers are not token holders
    /// (a gateway that asserts each caller's scopes, say): the suggestion of a 403 body and of an
    /// `INSUFFICIENT_SCOPE` result becomes "Obtain `<source>` that also grants `<scopes>`, then
    /// retry." instead of "Obtain a token for `<resource>` ...". Nothing is published, and the
    /// challenges are unchanged. Default: a token for the resource, as `spec/authorization.md`
    /// M5 writes it.
    pub fn with_scope_source(mut self, source: impl Into<String>) -> Self {
        self.scope_source = Some(source.into());
        self
    }

    /// The resource, as configured.
    pub fn resource(&self) -> &str {
        &self.resource
    }

    /// The authorization servers, in configuration order.
    pub fn authorization_servers(&self) -> &[String] {
        &self.authorization_servers
    }

    /// The published scopes.
    pub fn scopes_supported(&self) -> &[String] {
        &self.scopes_supported
    }

    /// Whether bound tokens are required.
    pub fn bound_tokens_required(&self) -> bool {
        self.bound_tokens_required
    }

    /// The metadata URLs (RFC 9728 3.1): `/.well-known/oauth-protected-resource` inserted between
    /// the host (with its port) and the path, then the same with no path. A resource whose path is
    /// empty or `/` has one URL. The first is the challenges' `resource_metadata`.
    pub fn metadata_urls(&self) -> Vec<String> {
        let parts = split_url(&self.resource).expect("the resource was checked");
        let bare = format!("{}{PROTECTED_RESOURCE_WELL_KNOWN}", parts.origin);
        if parts.path.is_empty() || parts.path == "/" {
            vec![bare]
        } else {
            vec![format!("{bare}{}", parts.path), bare]
        }
    }

    /// The `resource_metadata` URL of a challenge: the first metadata URL.
    pub fn metadata_url(&self) -> String {
        self.metadata_urls().swap_remove(0)
    }

    /// The request paths of the metadata URLs, which the bearer layer serves without
    /// authentication.
    pub fn metadata_paths(&self) -> Vec<String> {
        let parts = split_url(&self.resource).expect("the resource was checked");
        if parts.path.is_empty() || parts.path == "/" {
            vec![PROTECTED_RESOURCE_WELL_KNOWN.to_owned()]
        } else {
            vec![
                format!("{PROTECTED_RESOURCE_WELL_KNOWN}{}", parts.path),
                PROTECTED_RESOURCE_WELL_KNOWN.to_owned(),
            ]
        }
    }

    /// The metadata document (`spec/authorization.md`, M7): `resource`, `authorization_servers`,
    /// `scopes_supported` (left out when empty), `bearer_methods_supported: ["header"]`,
    /// `resource_name` (only when configured) and `tls_client_certificate_bound_access_tokens`.
    /// Nothing else is published.
    pub fn document(&self) -> Value {
        let mut document = Map::new();
        document.insert("resource".into(), json!(self.resource));
        document.insert(
            "authorization_servers".into(),
            json!(self.authorization_servers),
        );
        if !self.scopes_supported.is_empty() {
            document.insert("scopes_supported".into(), json!(self.scopes_supported));
        }
        document.insert("bearer_methods_supported".into(), json!(["header"]));
        if let Some(name) = &self.resource_name {
            document.insert("resource_name".into(), json!(name));
        }
        document.insert(
            "tls_client_certificate_bound_access_tokens".into(),
            json!(self.bound_tokens_required),
        );
        Value::Object(document)
    }

    /// The 401's `WWW-Authenticate` value (`spec/authorization.md`, M5):
    /// `Bearer resource_metadata="<metadata>", scope="<scopes>"`, then `, error="invalid_token"`
    /// when a token was sent and refused. `scope` is left out when no scope is published.
    pub fn unauthorized_challenge(&self, token_sent: bool) -> String {
        let mut challenge = format!("Bearer resource_metadata=\"{}\"", self.metadata_url());
        if !self.scopes_supported.is_empty() {
            challenge.push_str(&format!(", scope=\"{}\"", self.scopes_supported.join(" ")));
        }
        if token_sent {
            challenge.push_str(", error=\"invalid_token\"");
        }
        challenge
    }

    /// The 401's JSON body.
    pub fn unauthorized_body(&self) -> Value {
        json!({
            "error": crate::error_codes::UNAUTHORIZED,
            "suggestion": format!(
                "Obtain a token for {} from an authorization server named in {}.",
                self.resource,
                self.metadata_url()
            ),
        })
    }

    /// The 403's `WWW-Authenticate` value for the `missing` scopes, in order:
    /// `Bearer error="insufficient_scope", scope="<missing>", resource_metadata="<metadata>"`.
    /// A name that is not a scope token is left out, so the value stays one quoted string, and
    /// with no scope left `scope` is left out rather than sent empty.
    pub fn forbidden_challenge(&self, missing: &[String]) -> String {
        let scopes = joined_tokens(missing);
        if scopes.is_empty() {
            format!(
                "Bearer error=\"insufficient_scope\", resource_metadata=\"{}\"",
                self.metadata_url()
            )
        } else {
            format!(
                "Bearer error=\"insufficient_scope\", scope=\"{scopes}\", resource_metadata=\"{}\"",
                self.metadata_url()
            )
        }
    }

    /// The 403's JSON body for the `missing` scopes.
    pub fn forbidden_body(&self, missing: &[String]) -> Value {
        json!({
            "error": crate::error_codes::INSUFFICIENT_SCOPE,
            "suggestion": self.insufficient_scope_suggestion(missing),
        })
    }

    /// The suggestion of a 403 body and of an `INSUFFICIENT_SCOPE` result.
    pub(crate) fn insufficient_scope_suggestion(&self, missing: &[String]) -> String {
        let scopes = joined_tokens(missing);
        let source = self
            .scope_source
            .clone()
            .unwrap_or_else(|| format!("a token for {}", self.resource));
        if scopes.is_empty() {
            format!("Obtain {source} that grants the scopes this call needs, then retry.")
        } else {
            format!("Obtain {source} that also grants {scopes}, then retry.")
        }
    }
}

/// The scope tokens of `scopes`, joined by single spaces.
fn joined_tokens(scopes: &[String]) -> String {
    scopes
        .iter()
        .filter(|scope| is_scope_token(scope))
        .map(String::as_str)
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_host_may_name_what_its_callers_obtain_to_gain_a_scope() {
        let metadata =
            ProtectedResource::new("https://r.example.com/mcp", ["https://as.example.com"])
                .unwrap();
        let missing = ["todo:write".to_owned()];
        assert_eq!(
            metadata.insufficient_scope_suggestion(&missing),
            "Obtain a token for https://r.example.com/mcp that also grants todo:write, then retry."
        );
        let gateway = metadata
            .clone()
            .with_scope_source("a new assertion from the gateway");
        assert_eq!(
            gateway.insufficient_scope_suggestion(&missing),
            "Obtain a new assertion from the gateway that also grants todo:write, then retry."
        );
        assert_eq!(
            gateway.insufficient_scope_suggestion(&[]),
            "Obtain a new assertion from the gateway that grants the scopes this call needs, then retry."
        );
        // Nothing published changes.
        assert_eq!(gateway.document(), metadata.document());
        assert_eq!(
            gateway.forbidden_challenge(&missing),
            metadata.forbidden_challenge(&missing)
        );
    }

    #[test]
    fn urls_split_into_their_parts() {
        let parts = split_url("https://Todo.example.com:8443/api/mcp").unwrap();
        assert_eq!(parts.host, "Todo.example.com");
        assert_eq!(parts.port, Some("8443"));
        assert_eq!(parts.path, "/api/mcp");
        assert_eq!(parts.origin, "https://Todo.example.com:8443");
        let v6 = split_url("https://[::1]:8443/mcp").unwrap();
        assert_eq!((v6.host, v6.port), ("[::1]", Some("8443")));
        for bad in [
            "",
            "todo.example.com/mcp",
            "https://",
            "https://u@h/mcp",
            "https://h/mcp?x",
            "https://h/mcp#x",
            "https://h:x/mcp",
            "https://h /mcp",
            "https://a:b:c/mcp",
            "1ttp://h/mcp",
        ] {
            assert!(split_url(bad).is_none(), "{bad:?}");
        }
    }

    #[test]
    fn resources_must_be_https() {
        assert!(
            ProtectedResource::new("http://todo.example.com/mcp", ["https://a.example"]).is_err()
        );
        assert!(
            ProtectedResource::new("https://todo.example.com/mcp", ["http://a.example"]).is_err()
        );
        assert!(
            ProtectedResource::new("https://todo.example.com/mcp", Vec::<String>::new()).is_err()
        );
        assert!(ProtectedResource::new(
            "https://todo.example.com/mcp",
            ["https://a.example", "https://a.example"]
        )
        .is_err());
        let resource =
            ProtectedResource::new("https://todo.example.com/mcp", ["https://a.example"]).unwrap();
        assert!(resource.clone().with_scopes_supported(["a b"]).is_err());
        assert!(resource.with_scopes_supported(["x", "x"]).is_err());
    }
}
