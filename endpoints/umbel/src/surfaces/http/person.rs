//! The person page's own listener in mode `gateway` (phase 5 specification, amendment from step
//! 5b; the owner's decision of 2026-11-09).
//!
//! A company that runs Umbel behind its own gateway gets the person page on a separate, direct
//! address: `[http.person]`, with its own TLS and its own public origin, a host the gateway never
//! serves. Browsers reach it directly, never through the gateway, so the gateway never carries the
//! page's login, cookie, CSRF token or decision, and cannot turn a person's Decline into Approve.
//! Section 7.2 holds on it unchanged; only the origin differs, and with it the links the relay and
//! the CLI hand out, the OpenID Connect `redirect_uri`, the cookies' host, the CSRF and `Origin`
//! checks, and what the CSP's `'self'` names.
//!
//! Its layers, outermost first:
//!
//! 0. `Strict-Transport-Security` on every answer;
//! 1. TLS of its own (`[http.person.tls]`), asking browsers for no client certificate: no
//!    gateway certificate is required, and no PROXY protocol header is read
//!    (`http.trusted_proxies` is the gateway-facing listener's);
//! 2. a body cap of its own, [`MAX_BODY_BYTES`], the largest form a decision posts;
//! 3. a per-IP limit (`limits.ip_requests_per_minute`) under keys of its own, so neither listener
//!    spends the other's budget;
//! 4. its host check: a `Host` that `http.person.allowed_hosts` does not admit is 421;
//! 5. `/health`, and the page's routes under `/d/` (its own limit and checks,
//!    [`crate::person::page`]). Nothing else is served: no MCP, no metadata, no gateway layer.

use std::convert::Infallible;
use std::sync::Arc;

use axum::Router;
use axum::extract::{Request, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::middleware::{Next, from_fn_with_state};
use axum::response::{IntoResponse, Response};
use axum::routing::get;

use super::{HttpServer, layers};
use crate::host::HostError;
use crate::person::service::PersonService;
use crate::workspace::{AuthMode, Workspace};

/// `Strict-Transport-Security` on every answer of the listener: it is HTTPS only, and browsers
/// reach it directly, so they should never try its origin over plain HTTP.
pub(crate) const HSTS: &str = "max-age=31536000";
/// The person listener's body cap: the largest form a decision posts (the page's own limit).
pub(crate) const MAX_BODY_BYTES: usize = 4096;
/// The per-IP limit's key prefix on this listener.
const IP_PREFIX: &str = "person-listener:";

/// The person page's own listener of `workspace`, in mode `gateway` with `[http.person]` and a
/// person service (`loader::person_page_served`); `None` otherwise. Everything that can refuse
/// (the TLS files, the shared limits) refuses here, before anything binds.
///
/// # Errors
/// `WORKSPACE_CONFIG_INVALID` naming the `http.person.tls` key whose file is missing or invalid;
/// the errors of opening `state/shared/limits.sqlite3`.
pub(crate) fn server(
    workspace: &Workspace,
    person: Option<&Arc<PersonService>>,
) -> Result<Option<HttpServer>, HostError> {
    let config = workspace.config();
    let (Some(listener), Some(service)) = (&config.http.person, person) else {
        return Ok(None);
    };
    if config.auth.mode != AuthMode::Gateway {
        return Ok(None);
    }
    let tls = super::tls::acceptor_at(workspace.root(), &listener.tls, "http.person.tls")?;
    let lock_timeout = std::time::Duration::from_millis(config.store.lock_timeout_ms);
    let limits: Arc<dyn crate::shared::limits::LimitStore> =
        Arc::new(crate::shared::limits::SqliteLimits::open(
            &workspace.layout().limits_store(),
            config.store.lock_timeout_ms,
        )?);
    // The page at the origin's root: `/d/<id>`, `/d/return`, `/d/style.css`.
    let Some(page) = super::person_page(Some(service), "", &limits, lock_timeout) else {
        return Ok(None);
    };
    let pages = tower::service_fn(move |request: Request| {
        let page = page.clone();
        async move {
            if page.serves(request.uri().path()) {
                Ok::<Response, Infallible>(page.handle(request).await)
            } else {
                Ok(plain(StatusCode::NOT_FOUND))
            }
        }
    });
    let ip = Arc::new(layers::IpLimit::new(
        limits,
        config.limits.ip_requests_per_minute,
        lock_timeout,
    ));
    let hosts = Arc::new(listener.allowed_hosts.clone());
    tracing::info!(
        target: "umbel::http",
        "auth.mode = \"gateway\": serving the person page at {} on a listener of its own",
        listener.public_url
    );
    // `layer` wraps what is already there, so the last one added is the outermost.
    let router = Router::new()
        .route("/health", get(super::health))
        .fallback_service(pages)
        .layer(from_fn_with_state(hosts, check_host))
        .layer(from_fn_with_state(ip, limit_ip))
        .layer(from_fn_with_state(MAX_BODY_BYTES, layers::cap_body))
        .layer(axum::middleware::from_fn(strict_transport));
    Ok(Some(HttpServer {
        router,
        tls: Some(tls),
        person: None,
        proxies: Arc::from(Vec::new()),
    }))
}

/// The local person page (the Ideas host-review specification, section 6.3): the page's routes
/// at the root, `/d/<id>`, `/d/` and `/d/style.css`, over plain HTTP on the loopback bind of
/// `[person.local]`, which configuration refuses to be anything else. Its layers: the body cap of
/// the page's largest form, then the page's own limit and checks (its `Host` exactly the bind,
/// against DNS rebinding; a post's `Origin` exactly `http://<bind>`; the CSRF token bound to the
/// decision and the page shown). No TLS, no `/health`, and nothing else is served.
///
/// # Errors
/// The errors of opening `state/shared/limits.sqlite3`.
pub(crate) fn local_server(
    workspace: &Workspace,
    service: &Arc<PersonService>,
) -> Result<HttpServer, HostError> {
    let config = workspace.config();
    let lock_timeout = std::time::Duration::from_millis(config.store.lock_timeout_ms);
    let limits: Arc<dyn crate::shared::limits::LimitStore> =
        Arc::new(crate::shared::limits::SqliteLimits::open(
            &workspace.layout().limits_store(),
            config.store.lock_timeout_ms,
        )?);
    let page = super::person_page(Some(service), "", &limits, lock_timeout).ok_or_else(|| {
        HostError::from(crate::workspace::WorkspaceError::config_invalid(
            "person.local.bind",
            "the local person page cannot be served at this address",
        ))
    })?;
    let pages = tower::service_fn(move |request: Request| {
        let page = page.clone();
        async move {
            if page.serves(request.uri().path()) {
                Ok::<Response, Infallible>(page.handle(request).await)
            } else {
                Ok(plain(StatusCode::NOT_FOUND))
            }
        }
    });
    let router = Router::new()
        .fallback_service(pages)
        .layer(from_fn_with_state(MAX_BODY_BYTES, layers::cap_body));
    Ok(HttpServer {
        router,
        tls: None,
        person: None,
        proxies: Arc::from(Vec::new()),
    })
}

/// Every answer, refusals included, carries [`HSTS`].
async fn strict_transport(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    response.headers_mut().insert(
        header::STRICT_TRANSPORT_SECURITY,
        HeaderValue::from_static(HSTS),
    );
    response
}

async fn limit_ip(
    State(limit): State<Arc<layers::IpLimit>>,
    request: Request,
    next: Next,
) -> Response {
    layers::limit_peer(&limit, IP_PREFIX, request, next).await
}

/// Layer 4: the request names a host `http.person.allowed_hosts` admits, else 421.
async fn check_host(
    State(allowed): State<Arc<Vec<String>>>,
    request: Request,
    next: Next,
) -> Response {
    if host_admitted(request.headers(), &allowed) {
        next.run(request).await
    } else {
        plain(StatusCode::MISDIRECTED_REQUEST)
    }
}

/// Whether the request's one `Host` header names a host, and port, one of `allowed` admits: an
/// entry without a port admits any port, case-insensitively.
fn host_admitted(headers: &HeaderMap, allowed: &[String]) -> bool {
    let mut values = headers.get_all(header::HOST).iter();
    let (Some(value), None) = (values.next(), values.next()) else {
        return false;
    };
    let Ok(value) = value.to_str() else {
        return false;
    };
    let Some((host, port)) = split(value) else {
        return false;
    };
    allowed.iter().any(|entry| {
        split(entry).is_some_and(|(allowed_host, allowed_port)| {
            allowed_host.eq_ignore_ascii_case(host)
                && allowed_port.is_none_or(|allowed_port| Some(allowed_port) == port)
        })
    })
}

/// `host[:port]` or `[ipv6][:port]` as a host and a port.
fn split(value: &str) -> Option<(&str, Option<u16>)> {
    let (host, port) = if value.starts_with('[') {
        let end = value.find(']')?;
        let (host, rest) = value.split_at(end + 1);
        match rest {
            "" => (host, None),
            rest => (host, Some(rest.strip_prefix(':')?)),
        }
    } else {
        match value.split_once(':') {
            Some((host, port)) => (host, Some(port)),
            None => (value, None),
        }
    };
    if host.is_empty() {
        return None;
    }
    let port = match port {
        None => None,
        Some(port) => Some(port.parse::<u16>().ok()?),
    };
    Some((host, port))
}

/// A response with no body, never stored.
fn plain(status: StatusCode) -> Response {
    let mut response = status.into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headers(hosts: &[&str]) -> HeaderMap {
        let mut headers = HeaderMap::new();
        for host in hosts {
            headers.append(
                header::HOST,
                HeaderValue::from_str(host).unwrap_or_else(|_| HeaderValue::from_static("x")),
            );
        }
        headers
    }

    #[test]
    fn the_host_check_admits_only_the_listeners_own_names() {
        let allowed = vec!["person.example.com".to_owned(), "[::1]:8444".to_owned()];
        assert!(host_admitted(&headers(&["person.example.com"]), &allowed));
        assert!(host_admitted(
            &headers(&["PERSON.example.com:8444"]),
            &allowed
        ));
        assert!(host_admitted(&headers(&["[::1]:8444"]), &allowed));
        assert!(!host_admitted(&headers(&["[::1]:8445"]), &allowed));
        assert!(!host_admitted(&headers(&["[::1]"]), &allowed));
        assert!(!host_admitted(&headers(&["umbel.example.com"]), &allowed));
        assert!(!host_admitted(
            &headers(&["person.example.com.evil"]),
            &allowed
        ));
        assert!(!host_admitted(
            &headers(&["person.example.com:x"]),
            &allowed
        ));
        assert!(!host_admitted(&headers(&[]), &allowed));
        assert!(!host_admitted(
            &headers(&["person.example.com", "person.example.com"]),
            &allowed
        ));
    }
}
