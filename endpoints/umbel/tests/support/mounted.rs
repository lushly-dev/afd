//! Helpers for the mounted-loader tests: the `hello-mcp` and fixture binaries, plugin
//! directories, and servers on a thread of their own (the host's `seal` blocks the test's
//! runtime while it connects, so a server cannot live on it).
#![allow(
    dead_code,
    unreachable_pub,
    clippy::unwrap_used,
    clippy::expect_used,
    missing_docs
)]

#[path = "mount_fixture.rs"]
pub mod mount_fixture;

use axum::Router;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tempfile::TempDir;

/// The stdio fixture server (`src/bin/umbel-mount-fixture.rs`), built by `cargo test`.
pub fn fixture_bin() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_umbel-mount-fixture"))
}

/// `hello-mcp`, which another package builds (specification section 1, M6): next to the test
/// binaries' `deps/` directory, as `umbel.yml` builds it before the tests.
pub fn hello_mcp() -> PathBuf {
    let exe = std::env::current_exe().unwrap();
    let dir = exe.parent().and_then(Path::parent).unwrap();
    let path = dir.join(if cfg!(windows) {
        "hello-mcp.exe"
    } else {
        "hello-mcp"
    });
    assert!(
        path.is_file(),
        "{} is missing: build it first with `cargo build --locked -p umbel-plugin-hello --features mounted --bin hello-mcp`",
        path.display()
    );
    path
}

pub fn hello_crate() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("plugins/hello")
}

/// Hard-link `from` to `to` (a copy where the filesystems differ).
pub fn link_or_copy(from: &Path, to: &Path) {
    std::fs::create_dir_all(to.parent().unwrap()).unwrap();
    if std::fs::hard_link(from, to).is_err() {
        std::fs::copy(from, to).unwrap();
    }
}

fn copy_tree(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap().flatten() {
        let target = to.join(entry.file_name());
        if entry.path().is_dir() {
            copy_tree(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), &target).unwrap();
        }
    }
}

/// `plugins/<id>` in `workspace` with `manifest` as `umbel-plugin.toml`.
pub fn plugin_dir(workspace: &Path, id: &str, manifest: &str) -> PathBuf {
    let dir = workspace.join("plugins").join(id);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("umbel-plugin.toml"), manifest).unwrap();
    dir
}

/// The hello plugin built as a mounted server, as `plugins/<dir>` of `workspace`: its committed
/// mounted manifest, the `hello-mcp` binary, and its packs and skills.
pub fn hello_dir(workspace: &Path, dir: &str) -> PathBuf {
    let root = plugin_dir(workspace, dir, &hello_manifest());
    link_or_copy(&hello_mcp(), &root.join("bin/hello-mcp"));
    copy_tree(&hello_crate().join("packs"), &root.join("packs"));
    copy_tree(&hello_crate().join("skills"), &root.join("skills"));
    root
}

pub fn hello_manifest() -> String {
    std::fs::read_to_string(hello_crate().join("manifests/mounted.toml")).unwrap()
}

/// The hello manifest with `kind = "mounted"` over HTTP: the same plugin, mounted by URL.
pub fn hello_http_manifest(bearer: &str) -> String {
    hello_manifest().replace(
        "transport = \"stdio\"\ncommand = [\"bin/hello-mcp\"]",
        &format!("transport = \"http\"\nbearer = \"{bearer}\""),
    )
}

/// A manifest for the fixture plugin `fx` (prefix `fx`, domain `fx`), with `mount_extra` lines
/// under `[mount]` and `tools` after it (`[[mount.tools]]` entries and the like).
pub fn fx_manifest(transport_lines: &str, mount_extra: &str, tools: &str) -> String {
    format!(
        "manifest_version = 1\nprotocol = 1\n\n[plugin]\nid = \"fx\"\ntitle = \"Fixture\"\nversion = \"0.3.0\"\ndescription = \"A scriptable mounted server.\"\nkind = \"mounted\"\ndomains = [\"fx\"]\n\n[mount]\nprefix = \"fx\"\n{transport_lines}\n{mount_extra}\n{tools}\n"
    )
}

pub const FX_STDIO: &str = "transport = \"stdio\"\ncommand = [\"bin/fixture\"]";
pub const FX_HTTP: &str = "transport = \"http\"";

/// A workspace with the stdio fixture installed as `plugins/<dir>/bin/fixture`.
pub fn fx_dir(workspace: &Path, dir: &str, manifest: &str) -> PathBuf {
    let root = plugin_dir(workspace, dir, manifest);
    link_or_copy(&fixture_bin(), &root.join("bin/fixture"));
    root
}

/// A server on a thread of its own, stopped when dropped.
pub struct Server {
    pub port: u16,
    stop: Option<tokio::sync::oneshot::Sender<()>>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Drop for Server {
    fn drop(&mut self) {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// Serve `router` on a loopback port: plain HTTP, or HTTPS with `tls`.
pub fn serve(router: Router, tls: Option<Arc<tokio_rustls::rustls::ServerConfig>>) -> Server {
    let (ready, port) = std::sync::mpsc::channel();
    let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
    let thread = std::thread::spawn(move || {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async move {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            ready.send(listener.local_addr().unwrap().port()).unwrap();
            match tls {
                None => {
                    axum::serve(listener, router)
                        .with_graceful_shutdown(async move {
                            let _ = stopped.await;
                        })
                        .await
                        .unwrap();
                }
                Some(config) => serve_tls(listener, router, config, stopped).await,
            }
        });
    });
    Server {
        port: port.recv().unwrap(),
        stop: Some(stop),
        thread: Some(thread),
    }
}

async fn serve_tls(
    listener: tokio::net::TcpListener,
    router: Router,
    config: Arc<tokio_rustls::rustls::ServerConfig>,
    mut stopped: tokio::sync::oneshot::Receiver<()>,
) {
    let acceptor = tokio_rustls::TlsAcceptor::from(config);
    loop {
        tokio::select! {
            _ = &mut stopped => return,
            accepted = listener.accept() => {
                let Ok((stream, _)) = accepted else { continue };
                let acceptor = acceptor.clone();
                let router = router.clone();
                tokio::spawn(async move {
                    let Ok(stream) = acceptor.accept(stream).await else { return };
                    let service = hyper_util::service::TowerToHyperService::new(router);
                    let _ = hyper::server::conn::http1::Builder::new()
                        .serve_connection(hyper_util::rt::TokioIo::new(stream), service)
                        .await;
                });
            }
        }
    }
}

/// A server certificate for `localhost`, and its PEM for the client to trust.
pub fn certificate() -> (Arc<tokio_rustls::rustls::ServerConfig>, String) {
    let certified = rcgen::generate_simple_self_signed(vec!["localhost".to_owned()]).unwrap();
    let pem = certified.cert.pem();
    let der = certified.cert.der().clone();
    let key = tokio_rustls::rustls::pki_types::PrivateKeyDer::try_from(
        certified.signing_key.serialize_der(),
    )
    .unwrap();
    let provider = Arc::new(tokio_rustls::rustls::crypto::aws_lc_rs::default_provider());
    let config = tokio_rustls::rustls::ServerConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(vec![der], key)
        .unwrap();
    (Arc::new(config), pem)
}

/// What an HTTP fixture saw: every request's headers, as `(name, value)` pairs.
#[derive(Clone, Default)]
pub struct Seen(pub Arc<Mutex<Vec<Vec<(String, String)>>>>);

impl Seen {
    pub fn all(&self) -> Vec<Vec<(String, String)>> {
        self.0.lock().unwrap().clone()
    }

    pub fn authorizations(&self) -> Vec<Option<String>> {
        self.all()
            .iter()
            .map(|headers| {
                headers
                    .iter()
                    .find(|(name, _)| name.eq_ignore_ascii_case("authorization"))
                    .map(|(_, value)| value.clone())
            })
            .collect()
    }
}

/// A router at `/mcp` that answers every JSON-RPC POST with the fixture's reply, requiring
/// `bearer` (`Authorization: Bearer <bearer>`) when it is `Some`.
pub fn fixture_router(fixture: mount_fixture::Fixture, bearer: Option<&str>, seen: Seen) -> Router {
    use axum::body::Bytes;
    use axum::http::{HeaderMap, StatusCode, header};
    use axum::response::IntoResponse;
    let fixture = Arc::new(fixture);
    let bearer = bearer.map(|token| format!("Bearer {token}"));
    Router::new().route(
        "/mcp",
        axum::routing::post(move |headers: HeaderMap, body: Bytes| {
            let fixture = Arc::clone(&fixture);
            let bearer = bearer.clone();
            let seen = seen.clone();
            async move {
                seen.0.lock().unwrap().push(
                    headers
                        .iter()
                        .map(|(name, value)| {
                            (
                                name.to_string(),
                                String::from_utf8_lossy(value.as_bytes()).into_owned(),
                            )
                        })
                        .collect(),
                );
                if let Some(expected) = &bearer
                    && headers
                        .get(header::AUTHORIZATION)
                        .and_then(|v| v.to_str().ok())
                        != Some(expected.as_str())
                {
                    return (StatusCode::UNAUTHORIZED, "unauthorized").into_response();
                }
                let Ok(request) = serde_json::from_slice::<Value>(&body) else {
                    return StatusCode::BAD_REQUEST.into_response();
                };
                match fixture.respond(&request) {
                    None => StatusCode::ACCEPTED.into_response(),
                    Some(reply) => (
                        [(header::CONTENT_TYPE, "application/json")],
                        reply.to_string(),
                    )
                        .into_response(),
                }
            }
        }),
    )
}

/// A router serving the hello plugin as an MCP server at `/mcp`.
pub fn hello_router(seen: Seen, bearer: Option<&str>) -> Router {
    use afd::server::HttpOptions;
    use axum::extract::Request;
    use axum::http::{StatusCode, header};
    use axum::response::IntoResponse;
    use tower::Service;
    let server = umbel_sdk::mounted_server(umbel_plugin_hello::plugin()).unwrap();
    let service = server
        .try_streamable_http_service(HttpOptions {
            allowed_hosts: vec!["localhost".into(), "127.0.0.1".into()],
            allowed_origins: vec![],
            max_body_bytes: 1024 * 1024,
        })
        .unwrap();
    let bearer = bearer.map(|token| format!("Bearer {token}"));
    Router::new().route_service(
        "/mcp",
        tower::service_fn(move |request: Request| {
            let mut service = service.clone();
            let seen = seen.clone();
            let bearer = bearer.clone();
            async move {
                seen.0.lock().unwrap().push(
                    request
                        .headers()
                        .iter()
                        .map(|(name, value)| {
                            (
                                name.to_string(),
                                String::from_utf8_lossy(value.as_bytes()).into_owned(),
                            )
                        })
                        .collect(),
                );
                if let Some(expected) = &bearer
                    && request
                        .headers()
                        .get(header::AUTHORIZATION)
                        .and_then(|v| v.to_str().ok())
                        != Some(expected.as_str())
                {
                    return Ok::<_, std::convert::Infallible>(
                        (StatusCode::UNAUTHORIZED, "unauthorized").into_response(),
                    );
                }
                match service.call(request).await {
                    Ok(response) => Ok(response.into_response()),
                    Err(never) => match never {},
                }
            }
        }),
    )
}

pub fn workspace_with(config: &str) -> TempDir {
    crate::support::workspace(config)
}
