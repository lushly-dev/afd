//! The person page's routes (phase 5 specification, sections 6.3 layer 4, 7.2 and 7.4; D115),
//! never behind the bearer or gateway layer: they authenticate by their own login. In mode
//! `oauth` they are mounted beside the MCP path, `<path>` being `http.path`; in mode `gateway`
//! they are the whole of the page's own listener (`[http.person]`, step 5b,
//! `crate::surfaces::http::person`), `<path>` empty, so the gateway never carries them. Every
//! check below is the same on both; "the public URL" is the page's (`http.public_url`, or
//! `http.person.public_url`).
//!
//! | Route | What |
//! | --- | --- |
//! | `GET <path>/d/<id>` | Open: a login for a pending decision, then a redirect to the provider |
//! | `GET <path>/d/return` | The provider's answer: the login's checks, then the decision page |
//! | `POST <path>/d/<id>` | Decide: approve or decline, once |
//! | `GET <path>/d/style.css` | The page's style sheet |
//!
//! **Every response** is `Cache-Control: no-store`, `Content-Security-Policy: default-src
//! 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
//! `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff`,
//! with no script. Every value shown is HTML-escaped. **Every request** must name the public
//! URL's host (its own host check, 6.3); a post must come from the public URL's origin (`Origin`
//! exactly, or `Origin: null` with `Sec-Fetch-Site: same-origin`, which a browser sends for a
//! same-origin form under `Referrer-Policy: no-referrer`) and carry the form's CSRF token (an
//! HMAC of the decision and login ids under `person.key`) and the login's cookie.
//!
//! **The login** (7.2, steps 2 and 3): a random login id, with the PKCE verifier and the `nonce`
//! kept in its row, and a `__Host-` cookie (`Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`) per
//! login holding a random browser value whose SHA-256 is in the row. `state` is the login id and
//! its HMAC under `person.key`. On the return: the `state`'s MAC, the login taken once, the
//! cookie, RFC 9207's `iss`, the code exchanged with the stored verifier, the ID token
//! ([`super::oidc`]), user verification, and the subject: the ID token's subject claim, mapped as
//! 4.1 maps it in the login's namespace, must be the decision's `for.subject`, else "This request
//! is for another person". Any refusal records nothing.
//!
//! **The page** (7.2, step 4) renders, at page time, the command's preview under the logged-in
//! person's reader filter, who asked (the actor, the client and the delegation chain) and the
//! space. Only the preview's SHA-256 is kept, in the login's row; a preview that cannot be shown
//! leaves only Decline.

use std::sync::Arc;

use axum::body::Body;
use axum::extract::Request;
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, header};
use axum::response::Response;
use http_body_util::BodyExt;

use super::oidc::{Expected, Refusal};
use super::service::{PersonService, is_id, random_id, random_secret, sha256_hex};
use crate::shared::person::{Decided, LoginStart, NewLogin, Status, Verified};

/// The page's Content Security Policy: nothing but its own style sheet and its own form target,
/// never framed.
pub(crate) const CSP: &str = "default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
/// How long a login lives, at most: the decision's own expiry caps it.
const LOGIN_TTL_MS: i64 = 600_000;
/// The largest form a decision posts.
const MAX_FORM_BYTES: usize = 4096;
/// The page's own limit (6.3, layer 4): requests a minute per decision, per login, or (for a
/// request naming neither) per peer.
pub(crate) const PAGE_REQUESTS_PER_MINUTE: u64 = 30;
/// The cookie name's prefix; the login id follows.
const COOKIE_PREFIX: &str = "__Host-umbel-person-";

const STYLE: &str = "body{font-family:system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;line-height:1.5;color:#1b1b1f;background:#fbfbfd}\
h1{font-size:1.4rem}dl{display:grid;grid-template-columns:max-content 1fr;gap:.25rem 1rem}dt{font-weight:600}\
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f0f0f4;padding:1rem;border-radius:.4rem}\
button{font-size:1rem;padding:.5rem 1.2rem;margin-right:.8rem}@media (prefers-color-scheme:dark){body{background:#151518;color:#e9e9ee}pre{background:#24242a}}";

/// What the routes need: the service and the page's public URL's parts.
#[derive(Clone)]
pub(crate) struct PersonPage {
    service: Arc<PersonService>,
    /// `http.path` followed by `/d/`.
    prefix: String,
    /// The public URL's host, lowercase.
    host: String,
    /// The public URL's port, when it names one.
    port: Option<u16>,
    /// `https://<host>[:<port>]`.
    origin: String,
    /// [`PAGE_REQUESTS_PER_MINUTE`] per peer.
    limit: Arc<crate::surfaces::http::layers::SlidingLimit>,
}

impl std::fmt::Debug for PersonPage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PersonPage")
            .field("prefix", &self.prefix)
            .finish_non_exhaustive()
    }
}

/// HTML-escape `text` for an element's content or a quoted attribute.
pub(crate) fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out
}

fn with_headers(mut response: Response) -> Response {
    let headers = response.headers_mut();
    for (name, value) in [
        (header::CACHE_CONTROL, "no-store"),
        (header::PRAGMA, "no-cache"),
        (header::CONTENT_SECURITY_POLICY, CSP),
        (header::X_FRAME_OPTIONS, "DENY"),
        (header::REFERRER_POLICY, "no-referrer"),
        (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
    ] {
        headers.insert(name, HeaderValue::from_static(value));
    }
    headers.insert(
        "cross-origin-opener-policy",
        HeaderValue::from_static("same-origin"),
    );
    response
}

impl PersonPage {
    /// The routes of `service`, under `path` (`http.path` in mode `oauth`, empty on the page's own
    /// listener).
    pub(crate) fn new(
        service: Arc<PersonService>,
        path: &str,
        limit: Arc<crate::surfaces::http::layers::SlidingLimit>,
    ) -> Option<Self> {
        let url = reqwest::Url::parse(service.page_url()).ok()?;
        let host = url.host_str()?.to_ascii_lowercase();
        let port = url.port();
        let origin = match port {
            Some(port) => format!("https://{host}:{port}"),
            None => format!("https://{host}"),
        };
        Some(Self {
            service,
            prefix: format!("{}/d/", path.trim_end_matches('/')),
            host,
            port,
            origin,
            limit,
        })
    }

    /// Whether `path` is one of the page's.
    pub(crate) fn serves(&self, path: &str) -> bool {
        path.starts_with(&self.prefix)
    }

    fn page(&self, status: StatusCode, title: &str, body: &str) -> Response {
        let html = format!(
            "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>{title}</title><link rel=\"stylesheet\" href=\"{prefix}style.css\"></head><body><main><h1>{title}</h1>{body}</main></body></html>",
            title = escape(title),
            prefix = escape(&self.prefix),
        );
        let mut response = Response::new(Body::from(html));
        *response.status_mut() = status;
        response.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("text/html; charset=utf-8"),
        );
        with_headers(response)
    }

    fn message(&self, status: StatusCode, title: &str, text: &str) -> Response {
        self.page(status, title, &format!("<p>{}</p>", escape(text)))
    }

    fn not_found(&self) -> Response {
        self.message(
            StatusCode::NOT_FOUND,
            "Not found",
            "This request is unknown or has expired. Ask the agent to start it again.",
        )
    }

    /// Whether the request names the public URL's host: its host, and its port when the public
    /// URL names one.
    fn host_ok(&self, headers: &HeaderMap) -> bool {
        let mut values = headers.get_all(header::HOST).iter();
        let (Some(value), None) = (values.next(), values.next()) else {
            return false;
        };
        let Ok(value) = value.to_str() else {
            return false;
        };
        let (host, port) = if let Some(rest) = value.strip_prefix('[') {
            let Some((inner, after)) = rest.split_once(']') else {
                return false;
            };
            let host = format!("[{inner}]");
            match after {
                "" => (host, None),
                after => match after
                    .strip_prefix(':')
                    .and_then(|port| port.parse::<u16>().ok())
                {
                    Some(port) => (host, Some(port)),
                    None => return false,
                },
            }
        } else {
            match value.split_once(':') {
                None => (value.to_owned(), None),
                Some((host, port)) => match port.parse::<u16>() {
                    Ok(port) => (host.to_owned(), Some(port)),
                    Err(_) => return false,
                },
            }
        };
        // Without a port in the public URL, the default port's: none, or 443.
        host.eq_ignore_ascii_case(&self.host) && port.unwrap_or(443) == self.port.unwrap_or(443)
    }

    /// Whether a post comes from the public URL's origin.
    fn origin_ok(&self, headers: &HeaderMap) -> bool {
        let mut values = headers.get_all(header::ORIGIN).iter();
        let (Some(origin), None) = (values.next(), values.next()) else {
            return false;
        };
        match origin.to_str() {
            Ok(origin) if origin == self.origin => true,
            // A browser serialises a same-origin form post's origin as `null` under the page's
            // own `Referrer-Policy: no-referrer` (Fetch, "append a request `Origin` header"); its
            // fetch metadata, which no page can set, says where the post came from.
            Ok("null") => {
                headers
                    .get("sec-fetch-site")
                    .and_then(|value| value.to_str().ok())
                    == Some("same-origin")
            }
            _ => false,
        }
    }

    /// Serve one request to the page.
    pub(crate) async fn handle(self, request: Request) -> Response {
        let bucket = self.bucket(&request);
        if let Some(refused) =
            crate::surfaces::http::layers::admit_page(&self.limit, request.extensions(), bucket)
                .await
        {
            return with_headers(refused);
        }
        if !self.host_ok(request.headers()) {
            return self.message(
                StatusCode::MISDIRECTED_REQUEST,
                "Wrong address",
                "Open the link exactly as it was given.",
            );
        }
        let path = request.uri().path().to_owned();
        let Some(rest) = path.strip_prefix(&self.prefix) else {
            return self.not_found();
        };
        let rest = rest.to_owned();
        let method = request.method().clone();
        match (rest.as_str(), &method) {
            ("style.css", &Method::GET) => {
                let mut response = Response::new(Body::from(STYLE));
                response.headers_mut().insert(
                    header::CONTENT_TYPE,
                    HeaderValue::from_static("text/css; charset=utf-8"),
                );
                with_headers(response)
            }
            ("return", &Method::GET) => self.returned(request).await,
            (id, &Method::GET) if is_id(id) => self.open(id, request.headers()).await,
            (id, &Method::POST) if is_id(id) => self.decide(id, request).await,
            ("style.css" | "return", _) => self.method_not_allowed("GET"),
            (id, _) if is_id(id) => self.method_not_allowed("GET, POST"),
            _ => self.not_found(),
        }
    }

    /// The limit's bucket of a request: the decision its path names, or the login its `state`
    /// names when the `state` verifies; `None` (the peer's) for anything else.
    fn bucket(&self, request: &Request) -> Option<String> {
        let rest = request.uri().path().strip_prefix(&self.prefix)?;
        if is_id(rest) {
            return Some(format!("decision:{rest}"));
        }
        if rest != "return" {
            return None;
        }
        let query = request.uri().query()?;
        let state = url::form_urlencoded::parse(query.as_bytes())
            .find(|(name, _)| name == "state")
            .map(|(_, value)| value.into_owned())?;
        let (login, mac) = state.split_once('.')?;
        let expected = self.service.mac("umbel/person/state/1", &[login]);
        (is_id(login) && crate::shared::person::same_digest(mac, &expected))
            .then(|| format!("login:{login}"))
    }

    fn method_not_allowed(&self, allow: &'static str) -> Response {
        let mut response = self.message(
            StatusCode::METHOD_NOT_ALLOWED,
            "Not allowed",
            "This address does not answer that method.",
        );
        response
            .headers_mut()
            .insert(header::ALLOW, HeaderValue::from_static(allow));
        response
    }

    fn unavailable_now(&self) -> Response {
        self.message(
            StatusCode::SERVICE_UNAVAILABLE,
            "Cannot sign in now",
            "The sign-in this request needs cannot be used now. Try again later; nothing was decided.",
        )
    }

    /// `GET <path>/d/<id>`: a login for a pending, live decision, then the provider.
    async fn open(&self, id: &str, headers: &HeaderMap) -> Response {
        let _ = headers;
        let decision = match self.service.decision(id).await {
            Ok(Some(decision)) => decision,
            Ok(None) => return self.not_found(),
            Err(_) => return self.unavailable_now(),
        };
        let now = self.service.now();
        if decision.status != Status::Pending || !decision.live(now) {
            return self.not_found();
        }
        let Some(provider) = self.service.provider(&decision.for_.namespace).cloned() else {
            return self.unavailable_now();
        };
        let Ok(doc) = provider.ensure().await else {
            return self.unavailable_now();
        };
        let (Some(login), Some(verifier), Some(nonce), Some(browser)) = (
            random_id(),
            random_secret(),
            random_secret(),
            random_secret(),
        ) else {
            return self.unavailable_now();
        };
        let started = {
            let store = Arc::clone(&self.service.store);
            let row = NewLogin {
                id: login.clone(),
                decision: id.to_owned(),
                verifier: verifier.clone(),
                nonce: nonce.clone(),
                browser_hash: sha256_hex(&browser),
                created_ms: now,
                expires_ms: now.saturating_add(LOGIN_TTL_MS),
            };
            tokio::task::spawn_blocking(move || store.start_login(&row, now)).await
        };
        match started {
            Ok(Ok(LoginStart::Started)) => {}
            Ok(Ok(LoginStart::NoDecision)) => return self.not_found(),
            Ok(Ok(LoginStart::TooMany)) => {
                return self.message(
                    StatusCode::TOO_MANY_REQUESTS,
                    "Too many sign-ins",
                    "This request was opened too many times. Ask the agent to start it again.",
                );
            }
            _ => return self.unavailable_now(),
        }
        let state = format!(
            "{login}.{}",
            self.service.mac("umbel/person/state/1", &[&login])
        );
        let challenge = {
            use base64::Engine;
            use sha2::{Digest, Sha256};
            base64::engine::general_purpose::URL_SAFE_NO_PAD
                .encode(Sha256::digest(verifier.as_bytes()))
        };
        let location = provider.authorization_url(
            &doc,
            &self.service.redirect_uri(),
            &state,
            &nonce,
            &challenge,
        );
        let mut response = Response::new(Body::empty());
        *response.status_mut() = StatusCode::FOUND;
        let Ok(location) = HeaderValue::from_str(&location) else {
            return self.unavailable_now();
        };
        response.headers_mut().insert(header::LOCATION, location);
        let cookie = format!(
            "{COOKIE_PREFIX}{login}={browser}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age={}",
            LOGIN_TTL_MS / 1000
        );
        if let Ok(cookie) = HeaderValue::from_str(&cookie) {
            response.headers_mut().insert(header::SET_COOKIE, cookie);
        }
        with_headers(response)
    }

    /// The cookie `name`'s one value, if the request sends exactly one.
    fn cookie(headers: &HeaderMap, name: &str) -> Option<String> {
        let mut found: Option<String> = None;
        for value in headers.get_all(header::COOKIE) {
            let value = value.to_str().ok()?;
            for pair in value.split(';') {
                let Some((key, value)) = pair.trim().split_once('=') else {
                    continue;
                };
                if key == name {
                    if found.is_some() {
                        return None;
                    }
                    found = Some(value.to_owned());
                }
            }
        }
        found
    }

    /// `GET <path>/d/return`: the provider's answer (7.2, step 3), then the page (step 4).
    async fn returned(&self, request: Request) -> Response {
        let refused = |page: &Self| {
            page.message(
                StatusCode::BAD_REQUEST,
                "Sign-in not completed",
                "This sign-in could not be completed, and nothing was decided. Open the request's link again to start over.",
            )
        };
        // Each parameter at most once.
        let query = request.uri().query().unwrap_or_default().to_owned();
        let mut params: std::collections::BTreeMap<String, String> = Default::default();
        for (name, value) in url::form_urlencoded::parse(query.as_bytes()) {
            if params
                .insert(name.into_owned(), value.into_owned())
                .is_some()
            {
                return refused(self);
            }
        }
        let Some(state) = params.get("state") else {
            return refused(self);
        };
        let Some((login, mac)) = state.split_once('.') else {
            return refused(self);
        };
        let expected = self.service.mac("umbel/person/state/1", &[login]);
        if !is_id(login) || !crate::shared::person::same_digest(mac, &expected) {
            log_refusal("state");
            return refused(self);
        }
        // The login is taken only with its browser's cookie: without it nothing is spent, so a
        // leaked `state` cannot burn the person's login.
        let Some(cookie) = Self::cookie(request.headers(), &format!("{COOKIE_PREFIX}{login}"))
        else {
            log_refusal("cookie");
            return refused(self);
        };
        let now = self.service.now();
        // Taken once: a replayed `state` finds nothing.
        let taken = {
            let store = Arc::clone(&self.service.store);
            let (login, hash) = (login.to_owned(), sha256_hex(&cookie));
            tokio::task::spawn_blocking(move || store.take_login(&login, &hash, now)).await
        };
        let row = match taken {
            Ok(Ok(Some(row))) => row,
            Ok(Ok(None)) => {
                log_refusal("login");
                return refused(self);
            }
            _ => return self.unavailable_now(),
        };
        let fail = |page: &Self, code: &str, response: Response| {
            log_refusal(code);
            let store = Arc::clone(&page.service.store);
            let login = row.id.clone();
            tokio::task::spawn_blocking(move || {
                let _ = store.finish_login(&login, None);
            });
            response
        };
        if params.contains_key("error") {
            return fail(self, "provider-error", refused(self));
        }
        let decision = match self.service.decision(&row.decision).await {
            Ok(Some(decision)) if decision.status == Status::Pending && decision.live(now) => {
                decision
            }
            Ok(_) => return fail(self, "decision", self.not_found()),
            Err(_) => return fail(self, "store", self.unavailable_now()),
        };
        let Some(provider) = self.service.provider(&decision.for_.namespace).cloned() else {
            return fail(self, "provider", self.unavailable_now());
        };
        let Ok(doc) = provider.ensure().await else {
            return fail(self, "provider", self.unavailable_now());
        };
        // RFC 9207: the response's `iss` is the provider's, and present when it advertises it.
        match params.get("iss") {
            Some(iss) if iss != &provider.issuer => {
                return fail(self, Refusal::IssParameter.code(), refused(self));
            }
            None if doc.iss_parameter => {
                return fail(self, Refusal::IssParameter.code(), refused(self));
            }
            _ => {}
        }
        let Some(code) = params
            .get("code")
            .filter(|code| !code.is_empty() && code.len() <= 2048)
        else {
            return fail(self, "code", refused(self));
        };
        let token = match provider
            .exchange(&doc, code, &self.service.redirect_uri(), &row.verifier)
            .await
        {
            Ok(token) => token,
            Err(refusal) => return fail(self, refusal.code(), refused(self)),
        };
        let proved = match provider
            .verify(
                &token,
                &Expected {
                    nonce: &row.nonce,
                    started_ms: row.created_ms,
                },
            )
            .await
        {
            Ok(proved) => proved,
            Err(refusal) if refusal.insufficient() => {
                return fail(
                    self,
                    refusal.code(),
                    self.message(
                        StatusCode::FORBIDDEN,
                        "Verification required",
                        &format!(
                            "{}: this sign-in did not verify you as a person (a PIN or biometric at your authenticator). Open the request's link again and sign in with user verification; nothing was decided.",
                            super::PERSON_VERIFICATION_INSUFFICIENT
                        ),
                    ),
                );
            }
            Err(refusal) => return fail(self, refusal.code(), refused(self)),
        };
        // The subject, mapped as 4.1 maps it in the login's namespace, is the person the request
        // is for (the login is the namespace's own, so the namespace matches by construction).
        let mapped = crate::auth::mapped_id(&decision.for_.namespace, &proved.subject);
        if provider.namespace != decision.for_.namespace || mapped != decision.for_.subject {
            return fail(
                self,
                "wrong-person",
                self.message(
                    StatusCode::FORBIDDEN,
                    "Another person's request",
                    "This request is for another person. Nothing was decided.",
                ),
            );
        }
        // The page, rendered now: the preview under this person's reader filter.
        let (preview, preview_ok) = self.service.preview(&decision).await;
        let verified = Verified {
            auth_time_ms: proved.auth_time_s.saturating_mul(1000),
            acr: proved.acr.clone(),
            preview_hash: format!("sha256:{}", sha256_hex(&preview)),
            preview_ok,
        };
        let finished = {
            let store = Arc::clone(&self.service.store);
            let login = row.id.clone();
            tokio::task::spawn_blocking(move || store.finish_login(&login, Some(&verified))).await
        };
        if !matches!(finished, Ok(Ok(true))) {
            return self.unavailable_now();
        }
        self.decision_page(&decision, &row.id, &mapped, &preview, preview_ok)
    }

    fn decision_page(
        &self,
        decision: &crate::shared::person::Decision,
        login: &str,
        person: &str,
        preview: &str,
        preview_ok: bool,
    ) -> Response {
        let csrf = self
            .service
            .mac("umbel/person/csrf/1", &[&decision.id, login]);
        let actor = decision.for_.actor.id.as_deref().unwrap_or("(none)");
        let client = decision
            .for_
            .client_id
            .as_deref()
            .unwrap_or("the umbel command at a terminal");
        let chain: Vec<&str> = decision
            .chain
            .iter()
            .map(|entry| entry.id.as_str())
            .collect();
        let chain = if chain.is_empty() {
            "(none)".to_owned()
        } else {
            chain.join(" \u{2192} ")
        };
        let approve = if preview_ok {
            "<button type=\"submit\" name=\"decision\" value=\"approve\">Approve</button>"
        } else {
            ""
        };
        let body = format!(
            "<p>Signed in as <b>{namespace}/{person}</b>. Decide this request yourself: approve it only if you asked for it.</p>\
             <dl><dt>Command</dt><dd><code>{command}</code></dd><dt>Spaces</dt><dd>{space}</dd>\
             <dt>Asked by</dt><dd><code>{actor}</code></dd><dt>Client</dt><dd><code>{client}</code></dd>\
             <dt>Through</dt><dd><code>{chain}</code></dd><dt>Asked at</dt><dd>{asked}</dd><dt>Expires</dt><dd>{expires}</dd></dl>\
             <h2>What it will do</h2><pre>{preview}</pre>\
             <form method=\"post\" action=\"{action}\"><input type=\"hidden\" name=\"login\" value=\"{login}\"><input type=\"hidden\" name=\"csrf\" value=\"{csrf}\">{approve}<button type=\"submit\" name=\"decision\" value=\"decline\">Decline</button></form>",
            namespace = escape(&decision.for_.namespace),
            person = escape(person),
            command = escape(&decision.command),
            space = escape(&decision.spaces.join(", ")),
            actor = escape(actor),
            client = escape(client),
            chain = escape(&chain),
            asked = escape(&super::iso(decision.created_ms)),
            expires = escape(&super::iso(decision.expires_ms)),
            preview = escape(preview),
            action = escape(&format!("{}{}", self.prefix, decision.id)),
            login = escape(login),
            csrf = escape(&csrf),
        );
        self.page(StatusCode::OK, "Review a request", &body)
    }

    /// `POST <path>/d/<id>`: the person's decision, once (7.2, step 4).
    async fn decide(&self, id: &str, request: Request) -> Response {
        let refused = |page: &Self| {
            page.message(
                StatusCode::FORBIDDEN,
                "Not recorded",
                "Nothing was recorded. Open the request's link again to sign in and decide.",
            )
        };
        if !self.origin_ok(request.headers()) {
            log_refusal("origin");
            return refused(self);
        }
        let form_type = request
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(';').next())
            .is_some_and(|media| {
                media
                    .trim()
                    .eq_ignore_ascii_case("application/x-www-form-urlencoded")
            });
        if !form_type {
            return refused(self);
        }
        let headers = request.headers().clone();
        let body = match http_body_util::Limited::new(request.into_body(), MAX_FORM_BYTES)
            .collect()
            .await
        {
            Ok(body) => body.to_bytes(),
            Err(_) => return refused(self),
        };
        let mut fields: std::collections::BTreeMap<String, String> = Default::default();
        for (name, value) in url::form_urlencoded::parse(&body) {
            let name = name.into_owned();
            if !matches!(name.as_str(), "login" | "csrf" | "decision")
                || fields.insert(name, value.into_owned()).is_some()
            {
                return refused(self);
            }
        }
        let (Some(login), Some(csrf), Some(choice)) = (
            fields.get("login"),
            fields.get("csrf"),
            fields.get("decision"),
        ) else {
            return refused(self);
        };
        let approve = match choice.as_str() {
            "approve" => true,
            "decline" => false,
            _ => return refused(self),
        };
        let expected = self.service.mac("umbel/person/csrf/1", &[id, login]);
        if !is_id(login) || !crate::shared::person::same_digest(csrf, &expected) {
            log_refusal("csrf");
            return refused(self);
        }
        let Some(cookie) = Self::cookie(&headers, &format!("{COOKIE_PREFIX}{login}")) else {
            log_refusal("cookie");
            return refused(self);
        };
        let now = self.service.now();
        let decided = {
            let store = Arc::clone(&self.service.store);
            let (id, login, hash) = (id.to_owned(), login.clone(), sha256_hex(&cookie));
            tokio::task::spawn_blocking(move || store.decide(&id, &login, &hash, approve, now))
                .await
        };
        let decision = match decided {
            Ok(Ok(Decided::Recorded(decision))) => decision,
            Ok(Ok(Decided::Refused)) => {
                log_refusal("decide");
                return refused(self);
            }
            _ => return self.unavailable_now(),
        };
        self.service.journal(&decision).await;
        let (title, text) = if approve {
            (
                "Approved",
                "You approved this request. You can close this page; the agent's next try runs it.",
            )
        } else {
            (
                "Declined",
                "You declined this request. You can close this page; it will not run.",
            )
        };
        let mut response = self.message(StatusCode::OK, title, text);
        if let Ok(cleared) = HeaderValue::from_str(&format!(
            "{COOKIE_PREFIX}{login}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0"
        )) {
            response.headers_mut().insert(header::SET_COOKIE, cleared);
        }
        response
    }
}

fn log_refusal(code: &str) {
    tracing::warn!(target: "umbel::person", rule = code, "the person page refused a request");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn everything_shown_is_escaped() {
        assert_eq!(
            escape("<script>alert('x')</script> & \"q\""),
            "&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; &quot;q&quot;"
        );
    }
}
