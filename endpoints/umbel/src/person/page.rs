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
//! | `GET <path>/d/<id>[?page=<n>]` | With this browser's verified login of the decision, its page `n` (1 by default); else a login for a pending decision, then a redirect to the provider |
//! | `GET <path>/d/return` | The provider's answer: the login's checks, then the decision's first page, or the list |
//! | `POST <path>/d/<id>` | A page's choices and its `decision`: `next`, `previous`, `approve` or `decline`, the last two once |
//! | `GET <path>/d/[?namespace=<id>]` | The person's pending decisions, after a login of their own (the Ideas host-review specification, section 5) |
//! | `GET <path>/d/style.css` | The page's style sheet |
//!
//! **Every response** is `Cache-Control: no-store`, `Content-Security-Policy: default-src
//! 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
//! `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff`,
//! with no script. Every value shown is HTML-escaped. **Every request** must name the public
//! URL's host (its own host check, 6.3); a post must come from the public URL's origin (`Origin`
//! exactly, or `Origin: null` with `Sec-Fetch-Site: same-origin`, which a browser sends for a
//! same-origin form under `Referrer-Policy: no-referrer`) and carry the form's CSRF token (an
//! HMAC under `person.key` of the decision and login ids, and of the page shown and its hash) and
//! the login's cookie. A page renders for a login's cookie only on a request whose
//! `Sec-Fetch-Site` is `same-origin` or `none`.
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
//! **The page** (7.2, step 4) renders, at page time, one page of the command's preview under the
//! logged-in person's reader filter, who asked (the actor, the client and the delegation chain)
//! and the space. A paged preview's items each have a checkbox (the Ideas host-review
//! specification, sections 2 and 3): the form posts the page, the decision and the zero-based
//! positions left checked, which the store maps to the ids of the page it rendered. Only each
//! page's SHA-256 and its items' ids are kept, in the decision's row; a page that cannot be shown
//! uncut leaves only Decline, and Approve is offered once every page was shown.

use std::sync::Arc;

use axum::body::Body;
use axum::extract::Request;
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, header};
use axum::response::Response;
use http_body_util::BodyExt;

use super::oidc::{Expected, Refusal};
use super::service::{
    MAX_PREVIEW_ITEMS, MAX_PREVIEW_PAGES, PersonService, PreviewPage, is_id, random_id,
    random_secret, sha256_hex,
};
use crate::shared::person::{
    Action, Choice, Decided, LOGIN_START_TTL_MS, LoginStart, MAX_DECISION_LIFE_MS,
    MAX_LOGINS_PER_DECISION, NewListLogin, NewLogin, Render, Rendered, Status, Verified,
};

/// The page's Content Security Policy: nothing but its own style sheet and its own form target,
/// never framed.
pub(crate) const CSP: &str = "default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
/// How long a login to the list of pending decisions lives. A decision's login lives as long as
/// its decision (the Ideas host-review specification, section 4).
const LIST_LOGIN_TTL_MS: i64 = 600_000;
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
button{font-size:1rem;padding:.5rem 1.2rem;margin-right:.8rem}\
ul.items{list-style:none;padding:0}ul.items li{margin:.4rem 0}ul.items label{display:flex;gap:.6rem;align-items:flex-start}\
ul.items span{white-space:pre-wrap;overflow-wrap:anywhere}table{border-collapse:collapse}td,th{text-align:left;padding:.25rem .8rem .25rem 0}@media (prefers-color-scheme:dark){body{background:#151518;color:#e9e9ee}pre{background:#24242a}}";

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
            ("", &Method::GET) => self.list(request.uri().query()).await,
            ("return", &Method::GET) => self.returned(request).await,
            (id, &Method::GET) if is_id(id) => {
                self.open(id, request.uri().query(), request.headers())
                    .await
            }
            (id, &Method::POST) if is_id(id) => self.decide(id, request).await,
            ("" | "style.css" | "return", _) => self.method_not_allowed("GET"),
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

    /// The query's parameters, each at most once and each one of `allowed`; `None` otherwise.
    fn query(
        query: Option<&str>,
        allowed: &[&str],
    ) -> Option<std::collections::BTreeMap<String, String>> {
        let query = query.unwrap_or_default();
        let mut params = std::collections::BTreeMap::new();
        for (name, value) in url::form_urlencoded::parse(query.as_bytes()) {
            if !allowed.contains(&name.as_ref())
                || params
                    .insert(name.into_owned(), value.into_owned())
                    .is_some()
            {
                return None;
            }
        }
        Some(params)
    }

    /// A page number as a form or a query gives it: 1 to [`MAX_PREVIEW_PAGES`].
    fn page_number(text: &str) -> Option<u32> {
        if text.is_empty() || text.len() > 3 || !text.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        text.parse::<u32>()
            .ok()
            .filter(|page| (1..=MAX_PREVIEW_PAGES).contains(page))
    }

    /// `GET <path>/d/<id>[?page=<n>]`: with a verified login of this decision in this browser,
    /// its page `n` (1 when not named); otherwise a login for the pending, live decision, then the
    /// provider.
    async fn open(&self, id: &str, query: Option<&str>, headers: &HeaderMap) -> Response {
        let Some(params) = Self::query(query, &["page"]) else {
            return self.not_found();
        };
        let page = match params.get("page") {
            None => 1,
            Some(text) => match Self::page_number(text) {
                Some(page) => page,
                None => return self.not_found(),
            },
        };
        let decision = match self.service.decision(id).await {
            Ok(Some(decision)) => decision,
            Ok(None) => return self.not_found(),
            Err(_) => return self.unavailable_now(),
        };
        let now = self.service.now();
        if decision.status != Status::Pending || !decision.live(now) {
            return self.not_found();
        }
        // The browser's login of this decision, if it holds one that is verified and live, on a
        // request the browser says is the page's own or typed (fetch metadata, which no page can
        // set): another site's link starts a fresh login instead of rendering a page.
        let own = matches!(
            headers
                .get("sec-fetch-site")
                .and_then(|value| value.to_str().ok()),
            Some("same-origin" | "none")
        );
        let cookies = if own {
            Self::login_cookies(headers)
        } else {
            Vec::new()
        };
        for (login, value) in cookies {
            let store = Arc::clone(&self.service.store);
            let (decision_id, login_id, hash) = (id.to_owned(), login.clone(), sha256_hex(&value));
            let verified = tokio::task::spawn_blocking(move || {
                store.verified_login(&decision_id, &login_id, &hash, now)
            })
            .await;
            match verified {
                Ok(Ok(true)) => {
                    let shown = self.service.preview_page(&decision, page).await;
                    return self.respond(&decision, &login, shown).await;
                }
                Ok(Ok(false)) => {}
                _ => return self.unavailable_now(),
            }
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
            // Ten minutes to come back from the provider; verified, as long as its decision
            // (section 4).
            let row = NewLogin {
                id: login.clone(),
                decision: id.to_owned(),
                verifier: verifier.clone(),
                nonce: nonce.clone(),
                browser_hash: sha256_hex(&browser),
                created_ms: now,
                expires_ms: now.saturating_add(LOGIN_START_TTL_MS),
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
        // The cookie may outlive the login: the row, not the cookie, decides.
        let life_ms = decision
            .created_ms
            .saturating_add(MAX_DECISION_LIFE_MS)
            .saturating_sub(now);
        self.to_provider(
            &provider, &doc, &login, &verifier, &nonce, &browser, life_ms,
        )
    }

    /// The redirect to `provider` for `login`, setting its cookie for `life_ms`.
    #[allow(clippy::too_many_arguments)]
    fn to_provider(
        &self,
        provider: &super::oidc::Provider,
        doc: &super::oidc::ProviderDoc,
        login: &str,
        verifier: &str,
        nonce: &str,
        browser: &str,
        life_ms: i64,
    ) -> Response {
        let state = format!(
            "{login}.{}",
            self.service.mac("umbel/person/state/1", &[login])
        );
        let challenge = {
            use base64::Engine;
            use sha2::{Digest, Sha256};
            base64::engine::general_purpose::URL_SAFE_NO_PAD
                .encode(Sha256::digest(verifier.as_bytes()))
        };
        let location = provider.authorization_url(
            doc,
            &self.service.redirect_uri(),
            &state,
            nonce,
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
            life_ms.max(0) / 1000
        );
        if let Ok(cookie) = HeaderValue::from_str(&cookie) {
            response.headers_mut().insert(header::SET_COOKIE, cookie);
        }
        with_headers(response)
    }

    /// `GET <path>/d/[?namespace=<id>]`: a login for the list of the person's pending decisions
    /// (section 5), then the provider. The namespace is the one named, or the page's only one;
    /// with several and none named, a choice of them.
    async fn list(&self, query: Option<&str>) -> Response {
        let Some(params) = Self::query(query, &["namespace"]) else {
            return self.not_found();
        };
        let namespaces = self.service.namespaces();
        let namespace = match (params.get("namespace"), namespaces.as_slice()) {
            (Some(named), _) if namespaces.contains(named) => named.clone(),
            (Some(_), _) | (None, []) => return self.not_found(),
            (None, [only]) => only.clone(),
            (None, several) => {
                let links: String = several
                    .iter()
                    .map(|namespace| {
                        let href = format!(
                            "{}?{}",
                            self.prefix,
                            url::form_urlencoded::Serializer::new(String::new())
                                .append_pair("namespace", namespace)
                                .finish()
                        );
                        format!(
                            "<li><a href=\"{}\">{}</a></li>",
                            escape(&href),
                            escape(namespace)
                        )
                    })
                    .collect();
                return self.page(
                    StatusCode::OK,
                    "Pending requests",
                    &format!("<p>Sign in to see your pending requests in:</p><ul>{links}</ul>"),
                );
            }
        };
        let Some(provider) = self.service.provider(&namespace).cloned() else {
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
        let now = self.service.now();
        let started = {
            let store = Arc::clone(&self.service.store);
            let row = NewListLogin {
                id: login.clone(),
                namespace,
                verifier: verifier.clone(),
                nonce: nonce.clone(),
                browser_hash: sha256_hex(&browser),
                created_ms: now,
                expires_ms: now.saturating_add(LIST_LOGIN_TTL_MS),
            };
            tokio::task::spawn_blocking(move || store.start_list_login(&row, now)).await
        };
        match started {
            Ok(Ok(LoginStart::Started)) => {}
            Ok(Ok(_)) => {
                return self.message(
                    StatusCode::TOO_MANY_REQUESTS,
                    "Too many sign-ins",
                    "Too many people are signing in to see their requests. Try again in a few minutes.",
                );
            }
            _ => return self.unavailable_now(),
        }
        self.to_provider(
            &provider,
            &doc,
            &login,
            &verifier,
            &nonce,
            &browser,
            LIST_LOGIN_TTL_MS,
        )
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

    /// Every login cookie the request sends, as its login id and value, at most
    /// [`MAX_LOGINS_PER_DECISION`] of them.
    fn login_cookies(headers: &HeaderMap) -> Vec<(String, String)> {
        let mut found = Vec::new();
        for value in headers.get_all(header::COOKIE) {
            let Ok(value) = value.to_str() else {
                continue;
            };
            for pair in value.split(';') {
                let Some((key, value)) = pair.trim().split_once('=') else {
                    continue;
                };
                if let Some(login) = key.strip_prefix(COOKIE_PREFIX)
                    && is_id(login)
                    && !found
                        .iter()
                        .any(|(seen, _): &(String, String)| seen == login)
                {
                    found.push((login.to_owned(), value.to_owned()));
                }
            }
        }
        found.truncate(usize::try_from(MAX_LOGINS_PER_DECISION).unwrap_or(8));
        found
    }

    /// `GET <path>/d/return`: the provider's answer (7.2, step 3), then the decision's first page
    /// (step 4), or the list of pending decisions for a login to the list.
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
        // A login to the list names its namespace; a decision's is its decision's.
        let (decision, namespace) = if row.decision.is_empty() {
            match &row.namespace {
                Some(namespace) => (None, namespace.clone()),
                None => return fail(self, "login", refused(self)),
            }
        } else {
            match self.service.decision(&row.decision).await {
                Ok(Some(decision)) if decision.status == Status::Pending && decision.live(now) => {
                    let namespace = decision.for_.namespace.clone();
                    (Some(decision), namespace)
                }
                Ok(_) => return fail(self, "decision", self.not_found()),
                Err(_) => return fail(self, "store", self.unavailable_now()),
            }
        };
        let Some(provider) = self.service.provider(&namespace).cloned() else {
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
        // The subject, mapped as 4.1 maps it in the login's namespace.
        let mapped = crate::auth::mapped_id(&namespace, &proved.subject);
        let Some(decision) = decision else {
            // The list (section 5): the person's own pending decisions, and nothing to decide.
            if provider.namespace != namespace {
                return fail(self, "wrong-person", refused(self));
            }
            let finished = {
                let store = Arc::clone(&self.service.store);
                let login = row.id.clone();
                let verified = Verified {
                    auth_time_ms: proved.auth_time_s.saturating_mul(1000),
                    acr: proved.acr.clone(),
                    preview_hash: format!("sha256:{}", sha256_hex("")),
                    preview_ok: false,
                };
                tokio::task::spawn_blocking(move || store.finish_login(&login, Some(&verified)))
                    .await
            };
            if !matches!(finished, Ok(Ok(true))) {
                return self.unavailable_now();
            }
            return self.list_page(&namespace, &mapped, now).await;
        };
        // The person the request is for (the login is the namespace's own, so the namespace
        // matches by construction).
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
        // The first page, rendered now: the preview under this person's reader filter.
        let shown = self.service.preview_page(&decision, 1).await;
        let verified = Verified {
            auth_time_ms: proved.auth_time_s.saturating_mul(1000),
            acr: proved.acr.clone(),
            preview_hash: shown.hash.clone(),
            preview_ok: shown.ok,
        };
        let finished = {
            let store = Arc::clone(&self.service.store);
            let login = row.id.clone();
            tokio::task::spawn_blocking(move || store.finish_login(&login, Some(&verified))).await
        };
        if !matches!(finished, Ok(Ok(true))) {
            return self.unavailable_now();
        }
        self.respond(&decision, &row.id, shown).await
    }

    /// The list of `namespace`'s person `subject`'s pending, live decisions (section 5): for
    /// each, the command, the spaces, when it was begun and when it expires, and a link to its
    /// page. No preview is run for it.
    async fn list_page(&self, namespace: &str, subject: &str, now: i64) -> Response {
        let found = {
            let store = Arc::clone(&self.service.store);
            let (namespace, subject) = (namespace.to_owned(), subject.to_owned());
            tokio::task::spawn_blocking(move || store.pending_for(&namespace, &subject, now)).await
        };
        let Ok(Ok(decisions)) = found else {
            return self.unavailable_now();
        };
        let rows: String = decisions
            .iter()
            .map(|decision| {
                format!(
                    "<tr><td><a href=\"{href}\"><code>{command}</code></a></td><td>{spaces}</td><td>{asked}</td><td>{expires}</td></tr>",
                    href = escape(&format!("{}{}", self.prefix, decision.id)),
                    command = escape(&decision.command),
                    spaces = escape(&decision.spaces.join(", ")),
                    asked = escape(&super::iso(decision.created_ms)),
                    expires = escape(&super::iso(decision.expires_ms)),
                )
            })
            .collect();
        let body = if decisions.is_empty() {
            "<p>Nothing is waiting for you.</p>".to_owned()
        } else {
            format!(
                "<table><thead><tr><th>Command</th><th>Spaces</th><th>Asked at</th><th>Expires</th></tr></thead><tbody>{rows}</tbody></table>"
            )
        };
        self.page(
            StatusCode::OK,
            "Pending requests",
            &format!(
                "<p>Signed in as <b>{namespace}/{subject}</b>. Open a request to review it; each asks you to sign in for it.</p>{body}",
                namespace = escape(namespace),
                subject = escape(subject),
            ),
        )
    }

    /// Record `shown`, a page of `decision` rendered for `login`, and answer it (section 2): a
    /// review that changed starts again from page 1, with a line that says so; a page whose
    /// items another page lists cannot be shown.
    async fn respond(
        &self,
        decision: &crate::shared::person::Decision,
        login: &str,
        mut shown: PreviewPage,
    ) -> Response {
        let mut notice = None;
        let mut decision = decision.clone();
        for _ in 0..2 {
            if !shown.ok {
                // A page recorded before that cannot be shown now is a review that changed: what
                // was seen of it no longer counts toward Approve.
                if decision.seen(shown.page).is_none() {
                    return self.decision_page(&decision, login, &shown, notice);
                }
                let cleared = {
                    let store = Arc::clone(&self.service.store);
                    let id = decision.id.clone();
                    tokio::task::spawn_blocking(move || store.clear_pages(&id)).await
                };
                if !matches!(cleared, Ok(Ok(()))) {
                    return self.unavailable_now();
                }
                decision.pages.clear();
                decision.pages_total = None;
                decision.excluded.clear();
                notice = Some("The review changed while you read it.");
                shown = self.service.preview_page(&decision, 1).await;
                continue;
            }
            let rendered = {
                let store = Arc::clone(&self.service.store);
                let render = Render {
                    decision: decision.id.clone(),
                    login: login.to_owned(),
                    page: shown.page,
                    pages: shown.pages,
                    hash: shown.hash.clone(),
                    items: shown.items.iter().map(|(id, _)| id.clone()).collect(),
                    ttl_ms: self.service.ttl_ms(),
                };
                let now = self.service.now();
                tokio::task::spawn_blocking(move || store.render(&render, now)).await
            };
            match rendered {
                Ok(Ok(Rendered::Recorded(now))) => {
                    return self.decision_page(&now, login, &shown, notice);
                }
                Ok(Ok(Rendered::Changed)) => {
                    notice = Some("The review changed while you read it.");
                    decision.pages.clear();
                    decision.pages_total = None;
                    decision.excluded.clear();
                    shown = self.service.preview_page(&decision, 1).await;
                }
                Ok(Ok(Rendered::Duplicate)) => {
                    return self.decision_page(
                        &decision,
                        login,
                        &PreviewPage::unavailable(shown.page),
                        notice,
                    );
                }
                Ok(Ok(Rendered::Gone)) => return self.not_found(),
                _ => return self.unavailable_now(),
            }
        }
        // It changed again as it was shown from the start: only Decline.
        self.decision_page(&decision, login, &PreviewPage::unavailable(1), notice)
    }

    /// The form's CSRF token: an HMAC of the decision, the login, and the page shown with its
    /// hash, so a form posts only from the page as it was shown.
    fn csrf(&self, decision: &str, login: &str, page: u32, hash: &str) -> String {
        self.service.mac(
            "umbel/person/csrf/2",
            &[decision, login, &page.to_string(), hash],
        )
    }

    fn decision_page(
        &self,
        decision: &crate::shared::person::Decision,
        login: &str,
        shown: &PreviewPage,
        notice: Option<&str>,
    ) -> Response {
        let csrf = self.csrf(&decision.id, login, shown.page, &shown.hash);
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
        let button = |action: &str, label: &str| {
            format!("<button type=\"submit\" name=\"decision\" value=\"{action}\">{label}</button>")
        };
        let mut buttons = String::new();
        if shown.ok && shown.page > 1 {
            buttons.push_str(&button("previous", "Previous page"));
        }
        if shown.ok && shown.page < shown.pages {
            buttons.push_str(&button("next", "Next page"));
        }
        // Approve only once every page was shown (section 2).
        if shown.ok && decision.every_page_seen() {
            buttons.push_str(&button("approve", "Approve"));
        }
        buttons.push_str(&button("decline", "Decline"));
        let items: String = shown
            .items
            .iter()
            .enumerate()
            .map(|(position, (id, text))| {
                format!(
                    "<li><label><input type=\"checkbox\" name=\"k\" value=\"{position}\"{checked}><span>{text}</span></label></li>",
                    checked = if decision.excluded.contains(id) {
                        ""
                    } else {
                        " checked"
                    },
                    text = escape(text),
                )
            })
            .collect();
        let items = if items.is_empty() {
            String::new()
        } else {
            format!(
                "<p>Uncheck an item to leave it out; the rest is applied.</p><ul class=\"items\">{items}</ul>"
            )
        };
        let paging = if shown.pages > 1 {
            format!(
                "<p>Page {} of {}. Approve appears once you have seen every page.</p>",
                shown.page, shown.pages
            )
        } else {
            String::new()
        };
        let notice = notice
            .map(|notice| format!("<p class=\"notice\"><b>{}</b></p>", escape(notice)))
            .unwrap_or_default();
        let body = format!(
            "{notice}<p>Signed in as <b>{namespace}/{person}</b>. Decide this request yourself: approve it only if you asked for it.</p>\
             <dl><dt>Command</dt><dd><code>{command}</code></dd><dt>Spaces</dt><dd>{space}</dd>\
             <dt>Asked by</dt><dd><code>{actor}</code></dd><dt>Client</dt><dd><code>{client}</code></dd>\
             <dt>Through</dt><dd><code>{chain}</code></dd><dt>Asked at</dt><dd>{asked}</dd><dt>Expires</dt><dd>{expires}</dd></dl>\
             <h2>What it will do</h2>{paging}\
             <form method=\"post\" action=\"{action}\"><pre>{preview}</pre>{items}<input type=\"hidden\" name=\"login\" value=\"{login}\"><input type=\"hidden\" name=\"csrf\" value=\"{csrf}\"><input type=\"hidden\" name=\"page\" value=\"{page}\">{buttons}</form>",
            namespace = escape(&decision.for_.namespace),
            person = escape(&decision.for_.subject),
            command = escape(&decision.command),
            space = escape(&decision.spaces.join(", ")),
            actor = escape(actor),
            client = escape(client),
            chain = escape(&chain),
            asked = escape(&super::iso(decision.created_ms)),
            expires = escape(&super::iso(decision.expires_ms)),
            preview = escape(&shown.heading),
            action = escape(&format!("{}{}", self.prefix, decision.id)),
            login = escape(login),
            csrf = escape(&csrf),
            page = shown.page,
        );
        self.page(StatusCode::OK, "Review a request", &body)
    }

    /// `POST <path>/d/<id>`: the person's choices on a page, and a move to another page or the
    /// decision, once (7.2, step 4; section 2).
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
        let mut checked: Vec<usize> = Vec::new();
        for (name, value) in url::form_urlencoded::parse(&body) {
            let name = name.into_owned();
            if name == "k" {
                // A position: digits only, on a page of at most `MAX_PREVIEW_ITEMS`.
                let position = (!value.is_empty()
                    && value.len() <= 3
                    && value.bytes().all(|byte| byte.is_ascii_digit()))
                .then(|| value.parse::<usize>().ok())
                .flatten()
                .filter(|position| *position < MAX_PREVIEW_ITEMS);
                match position {
                    Some(position) if checked.len() < MAX_PREVIEW_ITEMS => checked.push(position),
                    _ => return refused(self),
                }
                continue;
            }
            if !matches!(name.as_str(), "login" | "csrf" | "page" | "decision")
                || fields.insert(name, value.into_owned()).is_some()
            {
                return refused(self);
            }
        }
        // A form that names no page posts from the first, which is all an unpaged preview has: the
        // form phase 5 posts stays valid.
        let page = match fields.get("page") {
            None => Some(1),
            Some(page) => Self::page_number(page),
        };
        let (Some(login), Some(csrf), Some(page), Some(action)) = (
            fields.get("login"),
            fields.get("csrf"),
            page,
            fields
                .get("decision")
                .and_then(|action| Action::parse(action)),
        ) else {
            return refused(self);
        };
        if !is_id(login) {
            return refused(self);
        }
        // The token names the page shown: the page recorded under that number, or, for a
        // Decline, the page that could not be shown.
        let recorded = match self.service.decision(id).await {
            Ok(Some(decision)) => decision.seen(page).map(|seen| seen.hash.clone()),
            Ok(None) => None,
            Err(_) => return self.unavailable_now(),
        };
        let unshown = PreviewPage::unavailable(page).hash;
        let Some(shown_hash) = recorded.into_iter().chain([unshown]).find(|hash| {
            crate::shared::person::same_digest(csrf, &self.csrf(id, login, page, hash))
        }) else {
            log_refusal("csrf");
            return refused(self);
        };
        let Some(cookie) = Self::cookie(&headers, &format!("{COOKIE_PREFIX}{login}")) else {
            log_refusal("cookie");
            return refused(self);
        };
        let now = self.service.now();
        let decided = {
            let store = Arc::clone(&self.service.store);
            let (id, login, hash) = (id.to_owned(), login.clone(), sha256_hex(&cookie));
            let choice = Choice {
                page,
                action,
                checked,
                hash: shown_hash,
                max_age_ms: self.service.ttl_ms(),
            };
            tokio::task::spawn_blocking(move || store.decide(&id, &login, &hash, &choice, now))
                .await
        };
        let decision = match decided {
            Ok(Ok(Decided::Recorded(decision))) => decision,
            Ok(Ok(Decided::Moved(to))) => {
                let mut response = Response::new(Body::empty());
                *response.status_mut() = StatusCode::SEE_OTHER;
                if let Ok(location) =
                    HeaderValue::from_str(&format!("{}{id}?page={to}", self.prefix))
                {
                    response.headers_mut().insert(header::LOCATION, location);
                }
                return with_headers(response);
            }
            Ok(Ok(Decided::Changed)) => {
                log_refusal("changed");
                return self.message(
                    StatusCode::FORBIDDEN,
                    "This request changed",
                    "This request changed, and nothing was recorded. Open the request's link again to see it as it is now.",
                );
            }
            Ok(Ok(Decided::Refused)) => {
                log_refusal("decide");
                return refused(self);
            }
            Ok(Ok(Decided::Stale)) => {
                log_refusal("stale");
                return self.message(
                    StatusCode::FORBIDDEN,
                    "Sign in again",
                    "Your sign-in is older than this request's lifetime, so nothing was recorded. Open the request's link again to sign in and decide.",
                );
            }
            _ => return self.unavailable_now(),
        };
        self.service.journal(&decision).await;
        let approve = decision.status == Status::Approved;
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
