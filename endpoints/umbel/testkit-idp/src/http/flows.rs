//! The protocol: the authorization endpoint and its login (RFC 6749 4.1, RFC 7636, OpenID Connect
//! Core 3.1), the token endpoint's grants (authorization code, client credentials, RFC 8693 token
//! exchange to an ID-JAG, RFC 7523 JWT bearer), client authentication (RFC 6749 2.3.1),
//! certificate binding (RFC 8705 3) and introspection (RFC 7662).

use axum::http::{HeaderMap, StatusCode, header};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde_json::{Map, Value, json};
use url::Url;

use super::{Answer, PeerCertificate};
use crate::role::{Client, Code, LoginScript, Pending, ResponseIss, Role, RoleKind, ScriptedLogin};
use crate::token::{TokenBuilder, verify_signed};
use crate::{Pkce, b64, lock, now, random_token, sha256};

/// How long a code lives (RFC 6749, section 4.1.2 recommends at most ten minutes).
const CODE_LIFETIME_S: i64 = 60;
/// The skew allowed on a received token's `iat`.
const SKEW_S: f64 = 60.0;

/// Request parameters, with empty values left out (RFC 6749, section 3.1), and the first name
/// that appeared more than once where it may not.
struct Params {
    pairs: Vec<(String, String)>,
    repeated: Option<String>,
}

impl Params {
    /// Parse a query or form body. Only the names in `repeatable` may appear more than once
    /// (RFC 6749, section 3.1; RFC 8707 and RFC 8693 repeat `resource` and `audience`); of any
    /// other, the first value is kept and the name recorded.
    fn parse(bytes: &[u8], repeatable: &[&str]) -> Self {
        let mut pairs: Vec<(String, String)> = Vec::new();
        let mut repeated = None;
        for (name, value) in url::form_urlencoded::parse(bytes) {
            if value.is_empty() {
                continue;
            }
            if !repeatable.contains(&name.as_ref()) && pairs.iter().any(|(kept, _)| *kept == name) {
                repeated.get_or_insert_with(|| name.into_owned());
                continue;
            }
            pairs.push((name.into_owned(), value.into_owned()));
        }
        Self { pairs, repeated }
    }

    /// The parameters, or a `400 invalid_request` naming the repeated one.
    fn unique(bytes: &[u8], repeatable: &[&str]) -> Result<Self, Answer> {
        let params = Self::parse(bytes, repeatable);
        match &params.repeated {
            Some(name) => Err(bad_request(
                "invalid_request",
                &format!("{name} is repeated"),
            )),
            None => Ok(params),
        }
    }

    fn get(&self, name: &str) -> Option<&str> {
        self.pairs
            .iter()
            .find(|(kept, _)| kept == name)
            .map(|(_, value)| value.as_str())
    }

    fn all(&self, name: &str) -> Vec<&str> {
        self.pairs
            .iter()
            .filter(|(kept, _)| kept == name)
            .map(|(_, value)| value.as_str())
            .collect()
    }
}

fn bad_request(error: &str, description: &str) -> Answer {
    Answer::oauth_error(StatusCode::BAD_REQUEST, error, description)
}

/// An absolute `https` URI without a fragment: a resource indicator (RFC 8707, section 2) the kit
/// accepts.
fn resource_ok(resource: &str) -> bool {
    Url::parse(resource).is_ok_and(|url| url.scheme() == "https" && url.fragment().is_none())
}

/// The authorization endpoint (`GET <issuer>/authorize`).
pub(super) fn authorize(role: &Role, query: &str) -> Answer {
    lock(&role.state).authorization_requests.push(
        url::form_urlencoded::parse(query.as_bytes())
            .map(|(name, value)| (name.into_owned(), value.into_owned()))
            .collect(),
    );
    let params = Params::parse(query.as_bytes(), &["resource"]);
    // Errors about the client or the redirect URI are never redirected (RFC 6749, 4.1.2.1).
    if let Some(name @ ("client_id" | "redirect_uri")) = params.repeated.as_deref() {
        return bad_request("invalid_request", &format!("{name} is repeated"));
    }
    let Some(client_id) = params.get("client_id") else {
        return bad_request("invalid_request", "client_id is required");
    };
    let Some(client) = client(role, client_id) else {
        return bad_request("invalid_request", "the client is not registered");
    };
    let Some(redirect_uri) = params.get("redirect_uri") else {
        return bad_request("invalid_request", "redirect_uri is required");
    };
    let registered = client.redirect_uris.iter().any(|uri| uri == redirect_uri);
    if !registered || Url::parse(redirect_uri).map_or(true, |url| url.fragment().is_some()) {
        return bad_request(
            "invalid_request",
            "redirect_uri is not registered for the client",
        );
    }
    let state = params.get("state");
    let fail = |error: &str, description: &str| {
        redirect(
            role,
            redirect_uri,
            &[("error", error), ("error_description", description)],
            state,
        )
    };
    if let Some(name) = &params.repeated {
        return fail("invalid_request", &format!("{name} is repeated"));
    }
    match params.get("response_type") {
        Some("code") => {}
        Some(_) => return fail("unsupported_response_type", "only code is supported"),
        None => return fail("invalid_request", "response_type is required"),
    }
    if params
        .get("response_mode")
        .is_some_and(|mode| mode != "query")
    {
        return fail("invalid_request", "only response_mode=query is supported");
    }
    let Some(code_challenge) = params.get("code_challenge") else {
        return fail(
            "invalid_request",
            "PKCE is required: code_challenge is missing",
        );
    };
    if params.get("code_challenge_method") != Some("S256") {
        return fail("invalid_request", "code_challenge_method must be S256");
    }
    let challenge_shape = code_challenge.len() == 43
        && code_challenge
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
    if !challenge_shape {
        return fail("invalid_request", "code_challenge is not an S256 challenge");
    }
    let scope = params.get("scope");
    if role.kind == RoleKind::IdentityProvider
        && !scope.is_some_and(|scope| scope.split(' ').any(|token| token == "openid"))
    {
        return fail("invalid_scope", "the openid scope is required");
    }
    let prompt: Vec<&str> = params
        .get("prompt")
        .map(|prompt| prompt.split(' ').collect())
        .unwrap_or_default();
    if prompt
        .iter()
        .any(|value| !matches!(*value, "none" | "login" | "consent" | "select_account"))
        || (prompt.contains(&"none") && prompt.len() > 1)
    {
        return fail("invalid_request", "prompt is not valid");
    }
    if params
        .get("max_age")
        .is_some_and(|max_age| max_age.parse::<u64>().is_err())
    {
        return fail("invalid_request", "max_age is not a non-negative integer");
    }
    if params.get("claims").is_some_and(|claims| {
        !serde_json::from_str::<Value>(claims).is_ok_and(|claims| claims.is_object())
    }) {
        return fail("invalid_request", "claims is not a JSON object");
    }
    let resources = params.all("resource");
    if !resources.iter().all(|resource| resource_ok(resource)) {
        return fail("invalid_target", "a resource is not an absolute https URI");
    }
    let pending = Pending {
        client_id: client.id.clone(),
        redirect_uri: redirect_uri.to_owned(),
        state: state.map(str::to_owned),
        nonce: params.get("nonce").map(str::to_owned),
        code_challenge: code_challenge.to_owned(),
        scope: scope.map(str::to_owned),
        resources: resources
            .iter()
            .map(|resource| (*resource).to_owned())
            .collect(),
    };
    let script = lock(&role.state).scripts.pop_front();
    match script {
        Some(LoginScript::Refuse(error)) => fail(&error, "the scripted login refused"),
        Some(LoginScript::Login(login)) => complete(role, pending, &login),
        None if prompt.contains(&"none") => fail("login_required", "no session, and prompt=none"),
        None => {
            let id = random_token(16);
            lock(&role.state).pending.insert(id.clone(), pending);
            login_form(role, &id, StatusCode::OK)
        }
    }
}

fn login_form(role: &Role, request: &str, status: StatusCode) -> Answer {
    let html = format!(
        "<!doctype html><title>umbel-testkit-idp login</title>\
         <form method=\"post\" action=\"{}/login\">\
         <input type=\"hidden\" name=\"request\" value=\"{request}\">\
         <input name=\"username\"><input type=\"password\" name=\"password\">\
         <button>Log in</button></form>",
        role.path
    );
    Answer::html(status, html)
        .header("testkit-login-request", request)
        .no_store()
}

/// The password form's target (`POST <issuer>/login`).
pub(super) fn login(role: &Role, body: &[u8]) -> Answer {
    let params = match Params::unique(body, &[]) {
        Ok(params) => params,
        Err(answer) => return answer,
    };
    let Some(request) = params.get("request") else {
        return bad_request("invalid_request", "request is required");
    };
    let (pending, user) = {
        let state = lock(&role.state);
        let Some(pending) = state.pending.get(request).cloned() else {
            return bad_request("invalid_request", "the login request is unknown or used");
        };
        let user = state
            .users
            .iter()
            .find(|user| {
                Some(user.name()) == params.get("username")
                    && params.get("password").is_some_and(|password| {
                        aws_lc_rs::constant_time::verify_slices_are_equal(
                            password.as_bytes(),
                            user.password().as_bytes(),
                        )
                        .is_ok()
                    })
            })
            .cloned();
        (pending, user)
    };
    let Some(user) = user else {
        return login_form(role, request, StatusCode::UNAUTHORIZED);
    };
    lock(&role.state).pending.remove(request);
    complete(role, pending, &ScriptedLogin::user(user.name()))
}

/// Issue a code for `login` and redirect back with it.
fn complete(role: &Role, pending: Pending, login: &ScriptedLogin) -> Answer {
    let state = pending.state.clone();
    let Some(user) = lock(&role.state)
        .users
        .iter()
        .find(|user| user.name() == login.user)
        .cloned()
    else {
        return redirect(
            role,
            &pending.redirect_uri,
            &[
                ("error", "access_denied"),
                ("error_description", "no such user"),
            ],
            state.as_deref(),
        );
    };
    let code = random_token(32);
    let redirect_uri = pending.redirect_uri.clone();
    let record = Code {
        request: pending,
        subject: user.subject_id().to_owned(),
        acr: login.acr.clone().unwrap_or_else(|| user.acr_value()),
        amr: login.amr.clone().unwrap_or_else(|| user.amr_values()),
        auth_time: login.auth_time.unwrap_or_else(|| role.now()),
        adjust: login.adjust.clone(),
        expires: now() + CODE_LIFETIME_S,
    };
    lock(&role.state).codes.insert(code.clone(), record);
    redirect(role, &redirect_uri, &[("code", &code)], state.as_deref())
}

/// A redirect to `redirect_uri` with `pairs`, the `state` and the RFC 9207 `iss`.
fn redirect(
    role: &Role,
    redirect_uri: &str,
    pairs: &[(&str, &str)],
    state: Option<&str>,
) -> Answer {
    let Ok(mut url) = Url::parse(redirect_uri) else {
        return bad_request("invalid_request", "redirect_uri is not a URL");
    };
    let iss = lock(&role.state)
        .response_iss
        .clone()
        .unwrap_or(ResponseIss::Correct);
    {
        let mut query = url.query_pairs_mut();
        for (name, value) in pairs {
            query.append_pair(name, value);
        }
        if let Some(state) = state {
            query.append_pair("state", state);
        }
        match &iss {
            ResponseIss::Correct => {
                query.append_pair("iss", &role.issuer);
            }
            ResponseIss::Value(value) => {
                query.append_pair("iss", value);
            }
            ResponseIss::Omitted => {}
        }
    }
    Answer::redirect(url.as_str()).no_store()
}

fn client(role: &Role, id: &str) -> Option<Client> {
    lock(&role.state)
        .clients
        .iter()
        .find(|client| client.id == id)
        .cloned()
}

/// Whether the body is `application/x-www-form-urlencoded`.
fn form_body(headers: &HeaderMap) -> bool {
    headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .is_some_and(|media| {
            media
                .trim()
                .eq_ignore_ascii_case("application/x-www-form-urlencoded")
        })
}

/// One form-urlencoded value (RFC 6749, appendix B).
fn form_decode(text: &str) -> String {
    url::form_urlencoded::parse(format!("v={text}").as_bytes())
        .next()
        .map(|(_, value)| value.into_owned())
        .unwrap_or_default()
}

/// Client authentication (RFC 6749, section 2.3.1): `client_secret_basic` or
/// `client_secret_post`, exactly one.
fn authenticate(role: &Role, headers: &HeaderMap, params: &Params) -> Result<Client, Answer> {
    let unauthorized = |description: &str, basic: bool| {
        let answer = Answer::oauth_error(StatusCode::UNAUTHORIZED, "invalid_client", description);
        if basic {
            answer.header("www-authenticate", "Basic realm=\"umbel-testkit-idp\"")
        } else {
            answer
        }
    };
    let basic = match headers.get(header::AUTHORIZATION) {
        None => None,
        Some(value) => {
            let credentials = value
                .to_str()
                .ok()
                .and_then(|value| value.split_once(' '))
                .filter(|(scheme, _)| scheme.eq_ignore_ascii_case("basic"))
                .and_then(|(_, encoded)| STANDARD.decode(encoded.trim()).ok())
                .and_then(|decoded| String::from_utf8(decoded).ok())
                .and_then(|decoded| {
                    decoded
                        .split_once(':')
                        .map(|(id, secret)| (form_decode(id), form_decode(secret)))
                });
            match credentials {
                Some(credentials) => Some(credentials),
                None => return Err(unauthorized("the Authorization header is not Basic", true)),
            }
        }
    };
    let (id, secret, is_basic) = match (basic, params.get("client_secret")) {
        (Some(_), Some(_)) => {
            return Err(bad_request(
                "invalid_request",
                "more than one client authentication method",
            ));
        }
        (Some((id, secret)), None) => {
            if params.get("client_id").is_some_and(|posted| posted != id) {
                return Err(bad_request(
                    "invalid_request",
                    "client_id differs from Basic",
                ));
            }
            (id, secret, true)
        }
        (None, Some(secret)) => {
            let Some(id) = params.get("client_id") else {
                return Err(bad_request("invalid_request", "client_id is required"));
            };
            (id.to_owned(), secret.to_owned(), false)
        }
        (None, None) => return Err(unauthorized("client authentication is required", true)),
    };
    match client(role, &id) {
        Some(client)
            if aws_lc_rs::constant_time::verify_slices_are_equal(
                client.secret.as_bytes(),
                secret.as_bytes(),
            )
            .is_ok() =>
        {
            Ok(client)
        }
        _ => Err(unauthorized("client authentication failed", is_basic)),
    }
}

/// The token endpoint (`POST <issuer>/token`).
pub(super) fn token(
    role: &Role,
    headers: &HeaderMap,
    body: &[u8],
    peer: Option<&PeerCertificate>,
) -> Answer {
    if !form_body(headers) {
        return bad_request("invalid_request", "the body must be form-urlencoded");
    }
    let params = match Params::unique(body, &["resource", "audience"]) {
        Ok(params) => params,
        Err(answer) => return answer,
    };
    let client = match authenticate(role, headers, &params) {
        Ok(client) => client,
        Err(answer) => return answer,
    };
    let result = match (role.kind, params.get("grant_type")) {
        (_, None) => Err(bad_request("invalid_request", "grant_type is required")),
        (_, Some("authorization_code")) => authorization_code(role, &client, &params, peer),
        (RoleKind::IdentityProvider, Some(crate::TOKEN_EXCHANGE_GRANT)) => {
            token_exchange(role, &client, &params)
        }
        (RoleKind::AuthorizationServer, Some("client_credentials")) => {
            client_credentials(role, &client, &params, peer)
        }
        (RoleKind::AuthorizationServer, Some(crate::JWT_BEARER_GRANT)) => {
            jwt_bearer(role, &client, &params, peer)
        }
        (_, Some(_)) => Err(bad_request(
            "unsupported_grant_type",
            "this grant type is not supported here",
        )),
    };
    match result {
        Ok(body) => Answer::json(StatusCode::OK, body).no_store(),
        Err(answer) => answer,
    }
}

/// The RFC 8705 binding for `client`: the presented certificate's thumbprint, required when the
/// client is registered for bound tokens.
fn binding(client: &Client, peer: Option<&PeerCertificate>) -> Result<Option<String>, Answer> {
    if !client.certificate_bound {
        return Ok(None);
    }
    match peer {
        Some(PeerCertificate(der)) => Ok(Some(b64(sha256(der)))),
        None => Err(bad_request(
            "invalid_request",
            "the client is registered for certificate-bound tokens and presented no certificate",
        )),
    }
}

/// `exp - now`, for `expires_in`.
fn expires_in(builder: &TokenBuilder) -> i64 {
    builder
        .claims()
        .get("exp")
        .and_then(Value::as_i64)
        .map_or(0, |exp| exp - now())
}

fn token_response(token: String, expires_in: i64, scope: Option<&str>) -> Value {
    let mut body =
        json!({ "access_token": token, "token_type": "Bearer", "expires_in": expires_in });
    if let Some(scope) = scope {
        body["scope"] = json!(scope);
    }
    body
}

/// Exactly one audience from these resource indicators.
fn one_resource(resources: &[String]) -> Result<String, Answer> {
    match resources {
        [resource] if resource_ok(resource) => Ok(resource.clone()),
        [] => Err(bad_request(
            "invalid_target",
            "a resource indicator is required: the kit issues audience-restricted tokens only",
        )),
        _ => Err(bad_request(
            "invalid_target",
            "exactly one absolute https resource is required",
        )),
    }
}

fn groups_of(role: &Role, subject: &str) -> Vec<String> {
    lock(&role.state)
        .users
        .iter()
        .find(|user| user.subject_id() == subject)
        .map(|user| user.groups_list().to_vec())
        .unwrap_or_default()
}

fn with_authentication(
    mut builder: TokenBuilder,
    auth_time: Option<&Value>,
    acr: Option<&Value>,
    amr: Option<&Value>,
) -> TokenBuilder {
    for (name, value) in [("auth_time", auth_time), ("acr", acr), ("amr", amr)] {
        if let Some(value) = value {
            builder = builder.claim(name, value.clone());
        }
    }
    builder
}

fn authorization_code(
    role: &Role,
    client: &Client,
    params: &Params,
    peer: Option<&PeerCertificate>,
) -> Result<Value, Answer> {
    let grant = |description: &str| bad_request("invalid_grant", description);
    let Some(code) = params.get("code") else {
        return Err(bad_request("invalid_request", "code is required"));
    };
    // A code is spent by its first redemption, whatever the outcome.
    let Some(record) = lock(&role.state).codes.remove(code) else {
        return Err(grant("the code is unknown or already used"));
    };
    if record.request.client_id != client.id {
        return Err(grant("the code was issued to another client"));
    }
    if record.expires <= now() {
        return Err(grant("the code has expired"));
    }
    if params.get("redirect_uri") != Some(record.request.redirect_uri.as_str()) {
        return Err(grant(
            "redirect_uri does not match the authorization request",
        ));
    }
    let Some(verifier) = params.get("code_verifier") else {
        return Err(bad_request("invalid_request", "code_verifier is required"));
    };
    let verifier_shape = (43..=128).contains(&verifier.len())
        && verifier
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-._~".contains(&byte));
    if !verifier_shape || Pkce::challenge_of(verifier) != record.request.code_challenge {
        return Err(grant("code_verifier does not match the code_challenge"));
    }
    let acr = record.acr.as_ref().map(|acr| json!(acr));
    let amr = (!record.amr.is_empty()).then(|| json!(record.amr));
    let auth_time = json!(record.auth_time);
    let groups = groups_of(role, &record.subject);
    let adjust = |builder: TokenBuilder| match &record.adjust {
        Some(adjust) => adjust(builder),
        None => builder,
    };
    let scope = record.request.scope.as_deref();
    match role.kind {
        RoleKind::IdentityProvider => {
            let mut builder = role.id_token(&record.subject, &client.id);
            if let Some(nonce) = &record.request.nonce {
                builder = builder.nonce(nonce);
            }
            builder = with_authentication(builder, Some(&auth_time), acr.as_ref(), amr.as_ref());
            if !groups.is_empty() {
                builder = builder.claim("groups", json!(groups));
            }
            let builder = adjust(builder);
            let lifetime = expires_in(&builder);
            let id_token = builder.try_sign().map_err(|_| server_error())?;
            let mut body = token_response(random_token(32), lifetime, scope);
            body["id_token"] = json!(id_token);
            Ok(body)
        }
        RoleKind::AuthorizationServer => {
            let requested: Vec<String> = params
                .all("resource")
                .into_iter()
                .map(str::to_owned)
                .collect();
            if !record.request.resources.is_empty()
                && requested
                    .iter()
                    .any(|resource| !record.request.resources.contains(resource))
            {
                return Err(bad_request(
                    "invalid_target",
                    "a resource was not in the authorization request",
                ));
            }
            let resources = if requested.is_empty() {
                record.request.resources.clone()
            } else {
                requested
            };
            let audience = one_resource(&resources)?;
            let mut builder = role
                .access_token(&audience)
                .subject(&record.subject)
                .client_id(&client.id);
            if let Some(scope) = scope {
                builder = builder.scope_text(scope);
            }
            builder = with_authentication(builder, Some(&auth_time), acr.as_ref(), amr.as_ref());
            if !groups.is_empty() {
                builder = builder.claim("groups", json!(groups));
            }
            if let Some(thumbprint) = binding(client, peer)? {
                builder = builder.cnf_x5t_s256(&thumbprint);
            }
            let builder = adjust(builder);
            let lifetime = expires_in(&builder);
            let token = builder.try_sign().map_err(|_| server_error())?;
            Ok(token_response(token, lifetime, scope))
        }
    }
}

fn server_error() -> Answer {
    Answer::oauth_error(
        StatusCode::INTERNAL_SERVER_ERROR,
        "server_error",
        "the kit could not sign the token",
    )
}

fn client_credentials(
    role: &Role,
    client: &Client,
    params: &Params,
    peer: Option<&PeerCertificate>,
) -> Result<Value, Answer> {
    let resources: Vec<String> = params
        .all("resource")
        .into_iter()
        .map(str::to_owned)
        .collect();
    let audience = one_resource(&resources)?;
    let scope = params.get("scope");
    // RFC 9068, section 2.2: for a client acting for itself, `sub` is the client.
    let mut builder = role
        .access_token(&audience)
        .subject(&client.id)
        .client_id(&client.id);
    if let Some(scope) = scope {
        builder = builder.scope_text(scope);
    }
    if let Some(thumbprint) = binding(client, peer)? {
        builder = builder.cnf_x5t_s256(&thumbprint);
    }
    let lifetime = expires_in(&builder);
    let token = builder.try_sign().map_err(|_| server_error())?;
    Ok(token_response(token, lifetime, scope))
}

fn audience_names(aud: Option<&Value>, expected: &str) -> bool {
    match aud {
        Some(Value::String(audience)) => audience == expected,
        Some(Value::Array(audiences)) => {
            matches!(audiences.as_slice(), [Value::String(audience)] if audience == expected)
        }
        _ => false,
    }
}

fn number(claims: &Map<String, Value>, name: &str) -> Option<f64> {
    claims.get(name).and_then(Value::as_f64)
}

fn text<'a>(claims: &'a Map<String, Value>, name: &str) -> Option<&'a str> {
    claims
        .get(name)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
}

/// The RFC 7523 grant with an ID-JAG (draft-ietf-oauth-identity-assertion-authz-grant, section
/// 4.4 and its processing rules).
fn jwt_bearer(
    role: &Role,
    client: &Client,
    params: &Params,
    peer: Option<&PeerCertificate>,
) -> Result<Value, Answer> {
    let grant = |description: &str| bad_request("invalid_grant", description);
    let Some(assertion) = params.get("assertion") else {
        return Err(bad_request("invalid_request", "assertion is required"));
    };
    let (_, claims) =
        verify_signed(assertion, &role.partner.keys, Some(crate::ID_JAG_TYP)).map_err(grant)?;
    if text(&claims, "iss") != Some(role.partner.issuer.as_str()) {
        return Err(grant("the ID-JAG's issuer is not trusted"));
    }
    if !audience_names(claims.get("aud"), &role.issuer) {
        return Err(grant(
            "the ID-JAG's audience is not this authorization server",
        ));
    }
    let now = now() as f64;
    match (number(&claims, "exp"), number(&claims, "iat")) {
        (Some(exp), Some(iat)) if exp > now && iat <= now + SKEW_S => {}
        _ => return Err(grant("the ID-JAG has expired, or its times are missing")),
    }
    let (Some(jti), Some(subject)) = (text(&claims, "jti"), text(&claims, "sub")) else {
        return Err(grant("the ID-JAG has no jti or sub"));
    };
    if text(&claims, "client_id") != Some(client.id.as_str()) {
        return Err(grant("the ID-JAG names another client"));
    }
    let named: Vec<String> = match claims.get("resource") {
        None => Vec::new(),
        Some(Value::String(resource)) => vec![resource.clone()],
        Some(Value::Array(resources)) => {
            let names: Option<Vec<String>> = resources
                .iter()
                .map(|resource| resource.as_str().map(str::to_owned))
                .collect();
            names.ok_or_else(|| grant("the ID-JAG's resource is malformed"))?
        }
        Some(_) => return Err(grant("the ID-JAG's resource is malformed")),
    };
    let requested: Vec<String> = params
        .all("resource")
        .into_iter()
        .map(str::to_owned)
        .collect();
    if !named.is_empty() && requested.iter().any(|resource| !named.contains(resource)) {
        return Err(bad_request(
            "invalid_target",
            "a resource is not in the ID-JAG",
        ));
    }
    let resources = if requested.is_empty() {
        named
    } else {
        requested
    };
    let audience = one_resource(&resources)?;
    let granted_scope = claims.get("scope").and_then(Value::as_str);
    let scope = match (params.get("scope"), granted_scope) {
        (Some(requested), Some(granted)) => {
            let granted: Vec<&str> = granted.split(' ').collect();
            if requested.split(' ').any(|scope| !granted.contains(&scope)) {
                return Err(bad_request("invalid_scope", "a scope is not in the ID-JAG"));
            }
            Some(requested)
        }
        (Some(_), None) => {
            return Err(bad_request("invalid_scope", "the ID-JAG grants no scope"));
        }
        (None, granted) => granted,
    };
    let thumbprint = binding(client, peer)?;
    // Single use: spent only once every other check has passed.
    let key = format!("{}\u{0}{jti}", role.partner.issuer);
    if !lock(&role.state).used_jtis.insert(key) {
        return Err(grant("the ID-JAG has already been used"));
    }
    let mut builder = role
        .access_token(&audience)
        .subject(subject)
        .client_id(&client.id);
    if let Some(scope) = scope {
        builder = builder.scope_text(scope);
    }
    builder = with_authentication(
        builder,
        claims.get("auth_time"),
        claims.get("acr"),
        claims.get("amr"),
    );
    let groups = groups_of(role, subject);
    if !groups.is_empty() {
        builder = builder.claim("groups", json!(groups));
    }
    if let Some(thumbprint) = thumbprint {
        builder = builder.cnf_x5t_s256(&thumbprint);
    }
    let lifetime = expires_in(&builder);
    let token = builder.try_sign().map_err(|_| server_error())?;
    Ok(token_response(token, lifetime, scope))
}

/// The RFC 8693 token exchange of an ID token for an ID-JAG
/// (draft-ietf-oauth-identity-assertion-authz-grant, section 4.3).
fn token_exchange(role: &Role, client: &Client, params: &Params) -> Result<Value, Answer> {
    // RFC 8693, section 2.2.2, and the ID-JAG draft, section 4.3.4.3: a subject token that
    // fails validation is `invalid_request`, not `invalid_grant`.
    let refused = |description: &str| bad_request("invalid_request", description);
    if params.get("requested_token_type") != Some(crate::ID_JAG_TOKEN_TYPE) {
        return Err(bad_request(
            "invalid_request",
            "requested_token_type must be the ID-JAG type",
        ));
    }
    if params.get("subject_token_type") != Some(crate::ID_TOKEN_TOKEN_TYPE) {
        return Err(bad_request(
            "invalid_request",
            "subject_token_type must be the ID token type",
        ));
    }
    if params.get("actor_token").is_some() {
        return Err(bad_request(
            "invalid_request",
            "actor tokens are not supported",
        ));
    }
    match params.all("audience").as_slice() {
        [audience] if *audience == role.partner.issuer => {}
        [_] => {
            return Err(bad_request(
                "invalid_target",
                "the audience is not a known authorization server",
            ));
        }
        _ => {
            return Err(bad_request(
                "invalid_request",
                "exactly one audience is required",
            ));
        }
    }
    let Some(subject_token) = params.get("subject_token") else {
        return Err(bad_request("invalid_request", "subject_token is required"));
    };
    let (_, claims) = verify_signed(subject_token, &role.keys, None).map_err(refused)?;
    if text(&claims, "iss") != Some(role.issuer.as_str()) {
        return Err(refused("the ID token was not issued here"));
    }
    if !number(&claims, "exp").is_some_and(|exp| exp > now() as f64) {
        return Err(refused("the ID token has expired"));
    }
    let issued_to_client = match claims.get("aud") {
        Some(Value::String(audience)) => *audience == client.id,
        Some(Value::Array(audiences)) => audiences
            .iter()
            .any(|audience| audience.as_str() == Some(&client.id)),
        _ => false,
    };
    if !issued_to_client {
        return Err(refused("the ID token was issued to another client"));
    }
    let Some(subject) = text(&claims, "sub") else {
        return Err(refused("the ID token has no sub"));
    };
    let resources = params.all("resource");
    if !resources.iter().all(|resource| resource_ok(resource)) {
        return Err(bad_request(
            "invalid_target",
            "a resource is not an absolute https URI",
        ));
    }
    let resource_client = client.resource_client_id.as_deref().unwrap_or(&client.id);
    let mut builder = role.id_jag(subject, resource_client);
    match resources.as_slice() {
        [] => {}
        [resource] => builder = builder.claim("resource", json!(resource)),
        several => builder = builder.claim("resource", json!(several)),
    }
    let scope = params.get("scope");
    if let Some(scope) = scope {
        builder = builder.scope_text(scope);
    }
    builder = with_authentication(
        builder,
        claims.get("auth_time"),
        claims.get("acr"),
        claims.get("amr"),
    );
    let lifetime = expires_in(&builder);
    let jag = builder.try_sign().map_err(|_| server_error())?;
    let mut body = json!({
        "issued_token_type": crate::ID_JAG_TOKEN_TYPE,
        "access_token": jag,
        "token_type": "N_A",
        "expires_in": lifetime,
    });
    if let Some(scope) = scope {
        body["scope"] = json!(scope);
    }
    Ok(body)
}

/// The introspection endpoint (`POST <issuer>/introspect`, RFC 7662).
pub(super) fn introspect(role: &Role, headers: &HeaderMap, body: &[u8]) -> Answer {
    if !form_body(headers) {
        return bad_request("invalid_request", "the body must be form-urlencoded");
    }
    let params = match Params::unique(body, &[]) {
        Ok(params) => params,
        Err(answer) => return answer,
    };
    let client = match authenticate(role, headers, &params) {
        Ok(client) => client,
        Err(answer) => return answer,
    };
    if !client.may_introspect {
        return Answer::oauth_error(
            StatusCode::UNAUTHORIZED,
            "invalid_client",
            "the client may not introspect",
        );
    }
    let Some(token) = params.get("token") else {
        return bad_request("invalid_request", "token is required");
    };
    Answer::json(StatusCode::OK, role.registry.answer(token, now())).no_store()
}
