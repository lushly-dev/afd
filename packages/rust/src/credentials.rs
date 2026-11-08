//! Verified credentials and scope names (`spec/authorization.md`, M3.2, M4 and M8).
//!
//! [`Credentials`] are what a server configured with authorization (the `server-auth` feature,
//! `afd::server::auth`) learned from one request's verified access token. The MCP server puts
//! them on [`CommandContext::credentials`](crate::CommandContext::credentials) for every call of
//! that request, and nothing else sets them there: in process they are absent unless trusted host
//! code sets them. They never hold the raw token.
//!
//! The type, the scope grammar and the principal binding need no feature, so in-process hosts
//! (a host's own scope gate, for example) read the same values the server set.

use std::fmt;

use serde::ser::{SerializeMap, Serializer};
use serde::Serialize;
use serde_json::{Map, Value};

use crate::{Actor, ActorKind};

/// The verified claims of one request's access token (`spec/authorization.md`, M4).
///
/// - **Never the token.** No field holds it, and no API returns it.
/// - **Redacted in debug output.** `Debug` prints `[redacted]` for every field but `issuer` and
///   `expires_at`, since subjects and client ids are identifiers that logs should not hold.
/// - **Never passed on.** The server does not journal them or put them in results, telemetry or
///   logs. `Serialize` writes the specification's JSON form for hosts that need it (a status
///   command, a test); do not log or journal it.
///
/// Build one with [`Credentials::new`] in a host's own token verifier (introspection, for
/// example); AFD's verifiers build them from a verified token.
#[derive(Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct Credentials {
    /// `iss`: the issuer that issued the token, exactly as configured.
    pub issuer: String,
    /// `sub`: the subject.
    pub subject: String,
    /// `client_id`: the OAuth client the token was issued to.
    pub client_id: String,
    /// `scope`, parsed (`spec/authorization.md`, M3.2): each scope once, in token order.
    pub scopes: Vec<String>,
    /// The server's configured resource, as configured (not the token's spelling of `aud`).
    pub resource: String,
    /// `exp`, in whole seconds since the epoch, rounded down.
    pub expires_at: i64,
    /// `iat`, in whole seconds since the epoch, rounded down.
    pub issued_at: i64,
    /// `auth_time`, in whole seconds since the epoch, rounded down, when present.
    pub auth_time: Option<i64>,
    /// `acr`, when present.
    pub acr: Option<String>,
    /// `cnf["x5t#S256"]`: the SHA-256 thumbprint (unpadded base64url) of the TLS client
    /// certificate the token is bound to (RFC 8705 3.1), when it is certificate-bound.
    pub certificate_thumbprint: Option<String>,
}

impl Credentials {
    /// Credentials with no scope, `auth_time`, `acr` or binding.
    pub fn new(
        issuer: impl Into<String>,
        subject: impl Into<String>,
        client_id: impl Into<String>,
        resource: impl Into<String>,
        issued_at: i64,
        expires_at: i64,
    ) -> Self {
        Self {
            issuer: issuer.into(),
            subject: subject.into(),
            client_id: client_id.into(),
            scopes: Vec::new(),
            resource: resource.into(),
            expires_at,
            issued_at,
            auth_time: None,
            acr: None,
            certificate_thumbprint: None,
        }
    }

    /// Set the granted scopes. Each scope is kept once, at its first place.
    pub fn with_scopes<I, S>(mut self, scopes: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        let mut kept: Vec<String> = Vec::new();
        for scope in scopes {
            let scope = scope.into();
            if !kept.contains(&scope) {
                kept.push(scope);
            }
        }
        self.scopes = kept;
        self
    }

    /// Set `auth_time`.
    pub fn with_auth_time(mut self, auth_time: i64) -> Self {
        self.auth_time = Some(auth_time);
        self
    }

    /// Set `acr`.
    pub fn with_acr(mut self, acr: impl Into<String>) -> Self {
        self.acr = Some(acr.into());
        self
    }

    /// Set the certificate binding (`cnf["x5t#S256"]`).
    pub fn with_certificate_thumbprint(mut self, thumbprint: impl Into<String>) -> Self {
        self.certificate_thumbprint = Some(thumbprint.into());
        self
    }

    /// Whether the token grants `scope`, compared exactly: case-sensitive, with no wildcard and
    /// no hierarchy (`spec/authorization.md`, M3.2).
    pub fn has_scope(&self, scope: &str) -> bool {
        self.scopes.iter().any(|held| held == scope)
    }

    /// The actor a server sets when no host mapping does (`spec/authorization.md`, M4):
    /// `{ kind: "agent", id: <client_id>, onBehalfOf: <subject> }`.
    pub fn default_actor(&self) -> Actor {
        Actor::new(ActorKind::Agent)
            .with_id(self.client_id.clone())
            .with_on_behalf_of(self.subject.clone())
    }
}

impl fmt::Debug for Credentials {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        const REDACTED: &str = "[redacted]";
        f.debug_struct("Credentials")
            .field("issuer", &self.issuer)
            .field("subject", &REDACTED)
            .field("client_id", &REDACTED)
            .field("scopes", &REDACTED)
            .field("resource", &REDACTED)
            .field("expires_at", &self.expires_at)
            .field("issued_at", &REDACTED)
            .field("auth_time", &self.auth_time.map(|_| REDACTED))
            .field("acr", &self.acr.as_ref().map(|_| REDACTED))
            .field(
                "certificate_thumbprint",
                &self.certificate_thumbprint.as_ref().map(|_| REDACTED),
            )
            .finish()
    }
}

/// The specification's JSON form (`spec/authorization.md`, M4): `issuer`, `subject`, `clientId`,
/// `scopes`, `resource`, `expiresAt`, `issuedAt`, then `authTime`, `acr` and
/// `cnf: { "x5t#S256": … }` when present.
impl Serialize for Credentials {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(None)?;
        map.serialize_entry("issuer", &self.issuer)?;
        map.serialize_entry("subject", &self.subject)?;
        map.serialize_entry("clientId", &self.client_id)?;
        map.serialize_entry("scopes", &self.scopes)?;
        map.serialize_entry("resource", &self.resource)?;
        map.serialize_entry("expiresAt", &self.expires_at)?;
        map.serialize_entry("issuedAt", &self.issued_at)?;
        if let Some(auth_time) = self.auth_time {
            map.serialize_entry("authTime", &auth_time)?;
        }
        if let Some(acr) = &self.acr {
            map.serialize_entry("acr", acr)?;
        }
        if let Some(thumbprint) = &self.certificate_thumbprint {
            let mut cnf = Map::new();
            cnf.insert("x5t#S256".to_owned(), Value::String(thumbprint.clone()));
            map.serialize_entry("cnf", &cnf)?;
        }
        map.end()
    }
}

/// Whether `scope` is one scope token of RFC 6749 3.3: one or more of `%x21 / %x23-5B /
/// %x5D-7E` (visible ASCII but `"` and `\`). Command `scopes`, a server's `requiredScopes` and
/// published `scopes_supported` must be scope tokens.
pub fn is_scope_token(scope: &str) -> bool {
    !scope.is_empty()
        && scope
            .bytes()
            .all(|byte| matches!(byte, 0x21 | 0x23..=0x5B | 0x5D..=0x7E))
}

/// The identity part of credentials that a principal binding holds: `{ issuer, subject,
/// clientId }`, or `null`.
fn identity_json(credentials: Option<&Credentials>) -> Value {
    match credentials {
        None => Value::Null,
        Some(credentials) => {
            let mut identity = Map::new();
            identity.insert("issuer".into(), Value::String(credentials.issuer.clone()));
            identity.insert("subject".into(), Value::String(credentials.subject.clone()));
            identity.insert(
                "clientId".into(),
                Value::String(credentials.client_id.clone()),
            );
            Value::Object(identity)
        }
    }
}

/// The actor part of a principal binding: `kind`, `id` and `onBehalfOf` when set (never
/// `label`), or `null`.
fn actor_identity_json(actor: Option<&Actor>) -> Value {
    match actor {
        None => Value::Null,
        Some(actor) => {
            let mut fields = Map::new();
            fields.insert(
                "kind".into(),
                serde_json::to_value(actor.kind).expect("actor kinds serialize"),
            );
            if let Some(id) = &actor.id {
                fields.insert("id".into(), Value::String(id.clone()));
            }
            if let Some(principal) = &actor.on_behalf_of {
                fields.insert("onBehalfOf".into(), Value::String(principal.clone()));
            }
            Value::Object(fields)
        }
    }
}

/// A call's principal binding (`spec/authorization.md`, M8): the canonical JSON of
/// `{ "actor": <actor>, "credentials": <identity> }`, where the actor is its `kind`, `id` and
/// `onBehalfOf` (never `label`) and the identity is the credentials' `issuer`, `subject` and
/// `clientId`, each `null` when absent. Two calls share a binding only when their actor and
/// their token's issuer, subject and client are the same.
pub fn principal_binding(actor: Option<&Actor>, credentials: Option<&Credentials>) -> String {
    let mut binding = Map::new();
    binding.insert("actor".into(), actor_identity_json(actor));
    binding.insert("credentials".into(), identity_json(credentials));
    crate::canonical::nearest(&Value::Object(binding))
}

/// The credentials' part of a principal binding alone (relay evidence's `credentialsBinding`):
/// the canonical JSON of `{ issuer, subject, clientId }`, or `null` without credentials.
pub fn credentials_binding(credentials: Option<&Credentials>) -> String {
    crate::canonical::nearest(&identity_json(credentials))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_prints_only_issuer_and_expiry() {
        let credentials = Credentials::new(
            "https://auth.example.com",
            "user-secret",
            "client-secret",
            "https://todo.example.com/mcp",
            1,
            2,
        )
        .with_scopes(["scope-secret"])
        .with_acr("acr-secret")
        .with_auth_time(3)
        .with_certificate_thumbprint("thumb-secret");
        let printed = format!("{credentials:?}");
        assert!(printed.contains("https://auth.example.com"), "{printed}");
        assert!(printed.contains("expires_at: 2"), "{printed}");
        for secret in [
            "user-secret",
            "client-secret",
            "scope-secret",
            "acr-secret",
            "thumb-secret",
            "todo.example.com",
            "issued_at: 1",
            "Some(3)",
        ] {
            assert!(!printed.contains(secret), "{secret} in {printed}");
        }
    }

    #[test]
    fn scope_tokens_follow_rfc_6749() {
        assert!(is_scope_token("todo:read"));
        assert!(is_scope_token("a!b#c[d]e~"));
        for bad in ["", "a b", "a\"b", "a\\b", "é", "a\tb"] {
            assert!(!is_scope_token(bad), "{bad:?}");
        }
    }
}
