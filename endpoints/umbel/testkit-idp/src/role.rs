//! The two HTTP roles, an identity provider and a resource authorization server: their users,
//! clients, scripted logins, faults, metadata and keys, and the handles tests hold.

use std::collections::{HashMap, HashSet, VecDeque};
use std::fmt;
use std::ops::Deref;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{Map, Value, json};

use crate::keys::{Algorithm, KeySet};
use crate::token::{IntrospectionAnswer, Registry, TokenBuilder, TokenKind, merge_patch};
use crate::{lock, now, random_token};

/// An endpoint a role serves, for [`Fault`]s and hit counts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Endpoint {
    /// RFC 8414 metadata at the path-inserted URL:
    /// `/.well-known/oauth-authorization-server<issuer path>`.
    OauthMetadata,
    /// OpenID Connect discovery at the path-inserted URL (RFC 8414, section 5):
    /// `/.well-known/openid-configuration<issuer path>`.
    OpenidMetadata,
    /// OpenID Connect discovery at the appended URL (OpenID Connect Discovery 1.0, section 4):
    /// `<issuer>/.well-known/openid-configuration`.
    OpenidMetadataAppended,
    /// The JWKS, `<issuer>/jwks`.
    Jwks,
    /// The authorization endpoint, `<issuer>/authorize`.
    Authorization,
    /// The password form's target, `<issuer>/login`.
    Login,
    /// The token endpoint, `<issuer>/token`.
    Token,
    /// The introspection endpoint, `<issuer>/introspect` (the authorization server only).
    Introspection,
}

impl Endpoint {
    pub(crate) fn slug(self) -> &'static str {
        match self {
            Self::OauthMetadata => "oauth-metadata",
            Self::OpenidMetadata => "openid-metadata",
            Self::OpenidMetadataAppended => "openid-metadata-appended",
            Self::Jwks => "jwks",
            Self::Authorization => "authorize",
            Self::Login => "login",
            Self::Token => "token",
            Self::Introspection => "introspect",
        }
    }

    /// The three metadata locations and the JWKS: the documents a key source fetches, and the
    /// endpoints a [`Fault::Redirect`] can move.
    pub const DOCUMENTS: [Endpoint; 4] = [
        Self::OauthMetadata,
        Self::OpenidMetadata,
        Self::OpenidMetadataAppended,
        Self::Jwks,
    ];
}

/// How an endpoint misbehaves until [`Issuer::clear_fault`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Fault {
    /// Answer with this status and the body `{"error":"testkit_fault"}`.
    Status(u16),
    /// Answer `302 Found` to `<issuer>/moved/<endpoint>`, which serves the real document and
    /// counts in [`Issuer::moved_hits`], so a test proves a client did not follow it. Meaningful
    /// for [`Endpoint::DOCUMENTS`]; any other endpoint's moved URL answers 404.
    Redirect,
    /// Answer normally after this delay.
    Delay(Duration),
    /// Answer normally, with the JSON object padded past 1 MiB by a `x-testkit-padding` member.
    Oversize,
    /// Answer `200` with this body as `application/json`.
    Body(String),
}

/// The RFC 9207 `iss` parameter on authorization responses.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResponseIss {
    /// The issuer, as the metadata advertises (`authorization_response_iss_parameter_supported`).
    Correct,
    /// Left out.
    Omitted,
    /// This value instead.
    Value(String),
}

/// A user who can log in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct User {
    name: String,
    password: String,
    subject: String,
    acr: Option<String>,
    amr: Vec<String>,
    groups: Vec<String>,
}

impl User {
    /// A user `name` with this password, subject `name`, `acr` `phr`, `amr` `["hwk", "pin"]` and no
    /// groups.
    pub fn new(name: &str, password: &str) -> Self {
        Self {
            name: name.to_owned(),
            password: password.to_owned(),
            subject: name.to_owned(),
            acr: Some("phr".to_owned()),
            amr: vec!["hwk".to_owned(), "pin".to_owned()],
            groups: Vec::new(),
        }
    }

    /// A synthetic user with the test-only password `<name>-test-password`; `ada` and `cy` are in
    /// the group `eng`.
    pub fn synthetic(name: &str) -> Self {
        let user = Self::new(name, &format!("{name}-test-password"));
        if matches!(name, "ada" | "cy") {
            user.groups(["eng"])
        } else {
            user
        }
    }

    /// The `sub` of the user's tokens.
    pub fn subject(mut self, subject: &str) -> Self {
        self.subject = subject.to_owned();
        self
    }

    /// The `acr` a login reports (`None`: no `acr`).
    pub fn acr(mut self, acr: Option<&str>) -> Self {
        self.acr = acr.map(str::to_owned);
        self
    }

    /// The `amr` a login reports (empty: no `amr`).
    pub fn amr<I, S>(mut self, amr: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.amr = amr.into_iter().map(Into::into).collect();
        self
    }

    /// The `groups` claim (empty: none).
    pub fn groups<I, S>(mut self, groups: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.groups = groups.into_iter().map(Into::into).collect();
        self
    }

    /// The login name.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// The test-only password.
    pub fn password(&self) -> &str {
        &self.password
    }

    /// The token subject.
    pub fn subject_id(&self) -> &str {
        &self.subject
    }

    pub(crate) fn acr_value(&self) -> Option<String> {
        self.acr.clone()
    }

    pub(crate) fn amr_values(&self) -> Vec<String> {
        self.amr.clone()
    }

    pub(crate) fn groups_list(&self) -> &[String] {
        &self.groups
    }
}

/// A confidential client (client authentication `client_secret_basic` or `client_secret_post`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Client {
    pub(crate) id: String,
    pub(crate) secret: String,
    pub(crate) redirect_uris: Vec<String>,
    pub(crate) may_introspect: bool,
    pub(crate) certificate_bound: bool,
    pub(crate) resource_client_id: Option<String>,
}

impl Client {
    /// A confidential client with no redirect URI, not allowed to introspect, issued bearer
    /// tokens.
    pub fn confidential(id: &str, secret: &str) -> Self {
        Self {
            id: id.to_owned(),
            secret: secret.to_owned(),
            redirect_uris: Vec::new(),
            may_introspect: false,
            certificate_bound: false,
            resource_client_id: None,
        }
    }

    /// Register a redirect URI, compared by exact string.
    pub fn redirect_uri(mut self, uri: &str) -> Self {
        self.redirect_uris.push(uri.to_owned());
        self
    }

    /// Allow the client to call the introspection endpoint (a resource server).
    pub fn introspection(mut self) -> Self {
        self.may_introspect = true;
        self
    }

    /// Issue the client certificate-bound access tokens (RFC 8705, section 3): its token requests
    /// must present a client certificate, whose thumbprint goes into `cnf`.
    pub fn certificate_bound(mut self) -> Self {
        self.certificate_bound = true;
        self
    }

    /// At the identity provider: the client's id at the resource authorization server, which an
    /// ID-JAG names as `client_id` (default: the same id).
    pub fn resource_client_id(mut self, id: &str) -> Self {
        self.resource_client_id = Some(id.to_owned());
        self
    }

    /// The client id.
    pub fn id(&self) -> &str {
        &self.id
    }

    /// The client secret.
    pub fn secret(&self) -> &str {
        &self.secret
    }
}

type Adjust = Arc<dyn Fn(TokenBuilder) -> TokenBuilder + Send + Sync>;

/// One scripted login: who logs in, and what the provider reports about it.
#[derive(Clone)]
pub struct ScriptedLogin {
    pub(crate) user: String,
    pub(crate) acr: Option<Option<String>>,
    pub(crate) amr: Option<Vec<String>>,
    pub(crate) auth_time: Option<i64>,
    pub(crate) adjust: Option<Adjust>,
}

impl fmt::Debug for ScriptedLogin {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ScriptedLogin")
            .field("user", &self.user)
            .field("acr", &self.acr)
            .field("amr", &self.amr)
            .field("auth_time", &self.auth_time)
            .finish_non_exhaustive()
    }
}

impl ScriptedLogin {
    /// `user` logs in with their own `acr` and `amr`, at `auth_time` now.
    pub fn user(user: &str) -> Self {
        Self {
            user: user.to_owned(),
            acr: None,
            amr: None,
            auth_time: None,
            adjust: None,
        }
    }

    /// Report this `acr` (`None`: no `acr`).
    pub fn acr(mut self, acr: Option<&str>) -> Self {
        self.acr = Some(acr.map(str::to_owned));
        self
    }

    /// Report this `amr` (empty: no `amr`), such as `["pwd"]` for a login without user
    /// verification.
    pub fn amr<I, S>(mut self, amr: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.amr = Some(amr.into_iter().map(Into::into).collect());
        self
    }

    /// Report this `auth_time`: an earlier one is a provider that reused a session despite
    /// `prompt=login` or `max_age`.
    pub fn auth_time(mut self, auth_time: i64) -> Self {
        self.auth_time = Some(auth_time);
        self
    }

    /// Change the token the code is redeemed for (the ID token at the identity provider, the
    /// access token at the authorization server), for example to break its `nonce`, `aud` or
    /// signature.
    pub fn adjust_token(
        mut self,
        adjust: impl Fn(TokenBuilder) -> TokenBuilder + Send + Sync + 'static,
    ) -> Self {
        self.adjust = Some(Arc::new(adjust));
        self
    }
}

/// What the next authorization request meets, in place of the password form.
#[derive(Debug, Clone)]
pub enum LoginScript {
    /// Log a user in without a form.
    Login(ScriptedLogin),
    /// Redirect back with this `error` (`access_denied`, `login_required`, ...).
    Refuse(String),
}

impl From<ScriptedLogin> for LoginScript {
    fn from(login: ScriptedLogin) -> Self {
        Self::Login(login)
    }
}

/// Where a role's metadata is served.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MetadataUrls {
    /// `/.well-known/oauth-authorization-server` with the issuer's path inserted (RFC 8414,
    /// section 3.1).
    pub oauth: String,
    /// `/.well-known/openid-configuration` with the issuer's path inserted (RFC 8414, section 5).
    pub openid: String,
    /// `/.well-known/openid-configuration` appended to the issuer (OpenID Connect Discovery 1.0).
    pub openid_appended: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RoleKind {
    IdentityProvider,
    AuthorizationServer,
}

/// The other role: the authorization server an ID-JAG is for, or the identity provider whose
/// ID-JAGs the authorization server trusts.
pub(crate) struct Partner {
    pub(crate) issuer: String,
    pub(crate) keys: Arc<KeySet>,
}

/// An authorization request waiting for the password form.
#[derive(Clone)]
pub(crate) struct Pending {
    pub(crate) client_id: String,
    pub(crate) redirect_uri: String,
    pub(crate) state: Option<String>,
    pub(crate) nonce: Option<String>,
    pub(crate) code_challenge: String,
    pub(crate) scope: Option<String>,
    pub(crate) resources: Vec<String>,
}

/// An authorization code and what it was issued for.
#[derive(Clone)]
pub(crate) struct Code {
    pub(crate) request: Pending,
    pub(crate) subject: String,
    pub(crate) acr: Option<String>,
    pub(crate) amr: Vec<String>,
    pub(crate) auth_time: i64,
    pub(crate) adjust: Option<Adjust>,
    pub(crate) expires: i64,
}

#[derive(Default)]
pub(crate) struct RoleState {
    pub(crate) users: Vec<User>,
    pub(crate) clients: Vec<Client>,
    pub(crate) scripts: VecDeque<LoginScript>,
    pub(crate) pending: HashMap<String, Pending>,
    pub(crate) codes: HashMap<String, Code>,
    pub(crate) used_jtis: HashSet<String>,
    pub(crate) faults: HashMap<Endpoint, Fault>,
    pub(crate) hits: HashMap<Endpoint, u64>,
    pub(crate) moved_hits: HashMap<Endpoint, u64>,
    pub(crate) plain_hits: HashMap<Endpoint, u64>,
    pub(crate) metadata_patch: Option<Value>,
    pub(crate) response_iss: Option<ResponseIss>,
    pub(crate) authorization_requests: Vec<Vec<(String, String)>>,
}

/// One role's shared state.
pub(crate) struct Role {
    pub(crate) kind: RoleKind,
    pub(crate) base: String,
    pub(crate) plain_base: String,
    pub(crate) path: String,
    pub(crate) issuer: String,
    pub(crate) keys: Arc<KeySet>,
    pub(crate) registry: Arc<Registry>,
    pub(crate) partner: Partner,
    pub(crate) state: Mutex<RoleState>,
    /// The clock the ID tokens it issues follow ([`Issuer::follow_clock`]); the wall clock when
    /// `None`.
    pub(crate) clock: Mutex<Option<KitClock>>,
}

/// A clock in Unix seconds, for the times of the ID tokens an issuer signs: a test's host
/// clock, so that the tokens never depend on the wall time.
pub type KitClock = Arc<dyn Fn() -> i64 + Send + Sync>;

impl Role {
    pub(crate) fn new(
        kind: RoleKind,
        (base, plain_base): (&str, &str),
        path: &str,
        keys: Arc<KeySet>,
        partner: Partner,
    ) -> Arc<Self> {
        Arc::new(Self {
            kind,
            base: base.to_owned(),
            plain_base: plain_base.to_owned(),
            path: path.to_owned(),
            issuer: format!("{base}{path}"),
            keys,
            registry: Arc::new(Registry::default()),
            partner,
            state: Mutex::new(RoleState::default()),
            clock: Mutex::new(None),
        })
    }

    /// Now, in Unix seconds, on the role's clock ([`Issuer::follow_clock`]).
    pub(crate) fn now(&self) -> i64 {
        let clock = lock(&self.clock).clone();
        clock.map_or_else(now, |clock| clock())
    }

    pub(crate) fn add_user(&self, user: User) {
        let mut state = lock(&self.state);
        state.users.retain(|kept| kept.name != user.name);
        state.users.push(user);
    }

    pub(crate) fn endpoint_url(&self, endpoint: Endpoint) -> String {
        let issuer = &self.issuer;
        match endpoint {
            Endpoint::OauthMetadata => format!(
                "{}/.well-known/oauth-authorization-server{}",
                self.base, self.path
            ),
            Endpoint::OpenidMetadata => {
                format!(
                    "{}/.well-known/openid-configuration{}",
                    self.base, self.path
                )
            }
            Endpoint::OpenidMetadataAppended => {
                format!("{issuer}/.well-known/openid-configuration")
            }
            Endpoint::Jwks => format!("{issuer}/jwks"),
            Endpoint::Authorization => format!("{issuer}/authorize"),
            Endpoint::Login => format!("{issuer}/login"),
            Endpoint::Token => format!("{issuer}/token"),
            Endpoint::Introspection => format!("{issuer}/introspect"),
        }
    }

    pub(crate) fn moved_path(&self, endpoint: Endpoint) -> String {
        format!("{}/moved/{}", self.path, endpoint.slug())
    }

    /// The metadata document, the patch applied.
    pub(crate) fn metadata(&self) -> Value {
        let url = |endpoint| self.endpoint_url(endpoint);
        let algorithms: Vec<&str> = Algorithm::ALL.iter().map(|alg| alg.name()).collect();
        let mut document = json!({
            "issuer": self.issuer,
            "authorization_endpoint": url(Endpoint::Authorization),
            "token_endpoint": url(Endpoint::Token),
            "jwks_uri": url(Endpoint::Jwks),
            "response_types_supported": ["code"],
            "response_modes_supported": ["query"],
            "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post"],
            "code_challenge_methods_supported": ["S256"],
            "authorization_response_iss_parameter_supported": true,
        });
        let extra = match self.kind {
            RoleKind::IdentityProvider => json!({
                "grant_types_supported": ["authorization_code", crate::TOKEN_EXCHANGE_GRANT],
                "scopes_supported": ["openid"],
                "subject_types_supported": ["public"],
                "id_token_signing_alg_values_supported": algorithms,
                "claims_supported": [
                    "iss", "sub", "aud", "exp", "iat", "auth_time", "nonce", "acr", "amr", "azp",
                    "groups",
                ],
                "claims_parameter_supported": true,
                "acr_values_supported": ["phr", "phrh"],
                "prompt_values_supported": ["none", "login"],
                "identity_chaining_requested_token_types_supported": [crate::ID_JAG_TOKEN_TYPE],
                "id_jag_signing_alg_values_supported": algorithms,
            }),
            RoleKind::AuthorizationServer => json!({
                "grant_types_supported": [
                    "authorization_code", "client_credentials", crate::JWT_BEARER_GRANT,
                ],
                "introspection_endpoint": url(Endpoint::Introspection),
                "introspection_endpoint_auth_methods_supported": [
                    "client_secret_basic", "client_secret_post",
                ],
                "tls_client_certificate_bound_access_tokens": true,
                "authorization_grant_profiles_supported": [
                    "urn:ietf:params:oauth:grant-profile:id-jag",
                ],
            }),
        };
        merge_patch(&mut document, &extra);
        if let Some(patch) = &lock(&self.state).metadata_patch {
            merge_patch(&mut document, patch);
        }
        document
    }

    pub(crate) fn access_token(&self, resource: &str) -> TokenBuilder {
        let now = now();
        let mut claims = Map::new();
        claims.insert("iss".into(), json!(self.issuer));
        claims.insert("aud".into(), json!(resource));
        claims.insert("sub".into(), json!("ada"));
        claims.insert("client_id".into(), json!("test-client"));
        claims.insert("jti".into(), json!(random_token(16)));
        claims.insert("iat".into(), json!(now));
        claims.insert("exp".into(), json!(now + 300));
        TokenBuilder::new(
            TokenKind::AccessToken,
            Arc::clone(&self.keys),
            self.registers().then(|| Arc::clone(&self.registry)),
            claims,
        )
    }

    pub(crate) fn opaque_token(&self, resource: &str) -> TokenBuilder {
        let builder = self.access_token(resource);
        let claims = builder.claims().clone();
        TokenBuilder::new(
            TokenKind::Opaque,
            Arc::clone(&self.keys),
            Some(Arc::clone(&self.registry)),
            claims,
        )
    }

    pub(crate) fn id_token(&self, subject: &str, client_id: &str) -> TokenBuilder {
        let now = self.now();
        let mut claims = Map::new();
        claims.insert("iss".into(), json!(self.issuer));
        claims.insert("sub".into(), json!(subject));
        claims.insert("aud".into(), json!(client_id));
        claims.insert("azp".into(), json!(client_id));
        claims.insert("iat".into(), json!(now));
        claims.insert("exp".into(), json!(now + 300));
        claims.insert("auth_time".into(), json!(now));
        TokenBuilder::new(TokenKind::IdToken, Arc::clone(&self.keys), None, claims)
    }

    pub(crate) fn id_jag(&self, subject: &str, client_id: &str) -> TokenBuilder {
        let now = now();
        let mut claims = Map::new();
        claims.insert("iss".into(), json!(self.issuer));
        claims.insert("sub".into(), json!(subject));
        claims.insert("aud".into(), json!(self.partner.issuer));
        claims.insert("client_id".into(), json!(client_id));
        claims.insert("jti".into(), json!(random_token(16)));
        claims.insert("iat".into(), json!(now));
        claims.insert("exp".into(), json!(now + 300));
        TokenBuilder::new(TokenKind::IdJag, Arc::clone(&self.keys), None, claims)
    }

    /// Whether this role's access tokens are kept for introspection.
    fn registers(&self) -> bool {
        self.kind == RoleKind::AuthorizationServer
    }

    pub(crate) fn hit(&self, endpoint: Endpoint) {
        *lock(&self.state).hits.entry(endpoint).or_default() += 1;
    }

    pub(crate) fn fault(&self, endpoint: Endpoint) -> Option<Fault> {
        lock(&self.state).faults.get(&endpoint).cloned()
    }
}

/// A role's handle: what the identity provider and the authorization server have in common.
#[derive(Clone)]
pub struct Issuer {
    pub(crate) role: Arc<Role>,
}

impl fmt::Debug for Issuer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Issuer")
            .field("issuer", &self.role.issuer)
            .finish_non_exhaustive()
    }
}

impl Issuer {
    pub(crate) fn new(role: Arc<Role>) -> Self {
        Self { role }
    }

    /// The issuer identifier, `https://127.0.0.1:<port>/<idp|as>`.
    pub fn issuer(&self) -> &str {
        &self.role.issuer
    }

    /// The three metadata URLs.
    pub fn metadata_urls(&self) -> MetadataUrls {
        MetadataUrls {
            oauth: self.role.endpoint_url(Endpoint::OauthMetadata),
            openid: self.role.endpoint_url(Endpoint::OpenidMetadata),
            openid_appended: self.role.endpoint_url(Endpoint::OpenidMetadataAppended),
        }
    }

    /// The URL of `endpoint`.
    pub fn url(&self, endpoint: Endpoint) -> String {
        self.role.endpoint_url(endpoint)
    }

    /// The metadata document every metadata URL serves, with the patch applied.
    pub fn metadata(&self) -> Value {
        self.role.metadata()
    }

    /// Apply an RFC 7396 merge patch to the metadata (`None`: none): an `issuer` that does not
    /// match, an `http` `jwks_uri`, no `claims_supported`, ...
    pub fn set_metadata_patch(&self, patch: Option<Value>) {
        lock(&self.role.state).metadata_patch = patch;
    }

    /// Sign ID tokens (their `iat`, `exp` and a login's default `auth_time`) on `clock`, Unix
    /// seconds, rather than the wall clock: a test's host clock, so a login is as fresh to the
    /// host as the test means it to be. `None` returns to the wall clock.
    pub fn follow_clock(&self, clock: Option<KitClock>) {
        *lock(&self.role.clock) = clock;
    }

    /// The role's signing keys.
    pub fn keys(&self) -> &KeySet {
        &self.role.keys
    }

    /// Add a user, or replace the one with the same name.
    pub fn add_user(&self, user: User) {
        self.role.add_user(user);
    }

    /// The user with this login name.
    pub fn user(&self, name: &str) -> Option<User> {
        lock(&self.role.state)
            .users
            .iter()
            .find(|user| user.name == name)
            .cloned()
    }

    /// Register a client, or replace the one with the same id.
    pub fn register_client(&self, client: Client) {
        let mut state = lock(&self.role.state);
        state.clients.retain(|kept| kept.id != client.id);
        state.clients.push(client);
    }

    /// Queue what the next authorization request meets instead of the password form; scripts
    /// are used once each, in order.
    pub fn script_login(&self, script: impl Into<LoginScript>) {
        lock(&self.role.state).scripts.push_back(script.into());
    }

    /// Make `endpoint` misbehave.
    pub fn set_fault(&self, endpoint: Endpoint, fault: Fault) {
        lock(&self.role.state).faults.insert(endpoint, fault);
    }

    /// Make `endpoint` behave again.
    pub fn clear_fault(&self, endpoint: Endpoint) {
        lock(&self.role.state).faults.remove(&endpoint);
    }

    /// How many requests `endpoint` has received, faulted ones included.
    pub fn hits(&self, endpoint: Endpoint) -> u64 {
        lock(&self.role.state)
            .hits
            .get(&endpoint)
            .copied()
            .unwrap_or(0)
    }

    /// How many requests reached the target of `endpoint`'s [`Fault::Redirect`].
    pub fn moved_hits(&self, endpoint: Endpoint) -> u64 {
        lock(&self.role.state)
            .moved_hits
            .get(&endpoint)
            .copied()
            .unwrap_or(0)
    }

    /// The URL of `endpoint` on the kit's plain-HTTP listener, which serves only
    /// [`Endpoint::DOCUMENTS`] (any other answers 404): an `http` URL to put in a metadata patch.
    pub fn plain_url(&self, endpoint: Endpoint) -> String {
        let url = self.role.endpoint_url(endpoint);
        match url.strip_prefix(&self.role.base) {
            Some(path) => format!("{}{path}", self.role.plain_base),
            None => url,
        }
    }

    /// How many requests `endpoint` received on the plain-HTTP listener.
    pub fn plain_hits(&self, endpoint: Endpoint) -> u64 {
        lock(&self.role.state)
            .plain_hits
            .get(&endpoint)
            .copied()
            .unwrap_or(0)
    }

    /// Every authorization request received, oldest first, as its query's name-value pairs in
    /// order (repeats and empty values included): what a relying party sent (`prompt`, `max_age`,
    /// `acr_values`, `claims`, `code_challenge_method`, `response_mode`, ...).
    pub fn authorization_requests(&self) -> Vec<Vec<(String, String)>> {
        lock(&self.role.state).authorization_requests.clone()
    }

    /// Choose the RFC 9207 `iss` of authorization responses.
    pub fn set_response_iss(&self, iss: ResponseIss) {
        lock(&self.role.state).response_iss = Some(iss);
    }

    /// An RFC 9068 access token from this issuer for the audience `resource`: `sub` `ada`,
    /// `client_id` `test-client`, no `scope`. The authorization server's are kept for
    /// introspection.
    pub fn access_token(&self, resource: &str) -> TokenBuilder {
        self.role.access_token(resource)
    }
}

/// The identity provider (an OpenID Connect provider).
#[derive(Debug, Clone)]
pub struct IdentityProvider(pub(crate) Issuer);

impl Deref for IdentityProvider {
    type Target = Issuer;

    fn deref(&self) -> &Issuer {
        &self.0
    }
}

impl IdentityProvider {
    /// An ID token of `subject` for the client `client_id` (`aud` and `azp`), with `auth_time`
    /// now; add `nonce`, `acr`, `amr` and `groups` as the test needs.
    pub fn id_token(&self, subject: &str, client_id: &str) -> TokenBuilder {
        self.role.id_token(subject, client_id)
    }

    /// An ID-JAG of `subject` for the authorization server (`aud`), naming the client there as
    /// `client_id`.
    pub fn id_jag(&self, subject: &str, client_id: &str) -> TokenBuilder {
        self.role.id_jag(subject, client_id)
    }
}

/// The resource authorization server.
#[derive(Debug, Clone)]
pub struct AuthorizationServer(pub(crate) Issuer);

impl Deref for AuthorizationServer {
    type Target = Issuer;

    fn deref(&self) -> &Issuer {
        &self.0
    }
}

impl AuthorizationServer {
    /// An opaque access token for `resource`, answered only through introspection, with the same
    /// claims an [`Issuer::access_token`] would carry. Use the builder's setters and breaks on its
    /// claims, and [`TokenBuilder::introspection`] for its answer.
    pub fn opaque_token(&self, resource: &str) -> TokenBuilder {
        self.role.opaque_token(resource)
    }

    /// Revoke a token this server issued: introspection answers `active: false`. Returns whether
    /// it knew the token.
    pub fn revoke(&self, token: &str) -> bool {
        self.role.registry.revoke(token)
    }

    /// Change how introspection answers for a token this server issued. Returns whether it knew
    /// the token.
    pub fn set_introspection_answer(&self, token: &str, answer: IntrospectionAnswer) -> bool {
        self.role.registry.set_answer(token, answer)
    }
}
