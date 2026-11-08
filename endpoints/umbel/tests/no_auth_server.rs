//! Umbel is never an authorization server (A7, D107; phase 5 specification, section 1, and the
//! seam of section 15).
//!
//! - **The test identity provider stays a test dependency.** `umbel-testkit-idp` is a dependency
//!   of `umbel` only in `[dev-dependencies]` (its `Cargo.toml` as written), and `cargo metadata`
//!   shows no chain of normal or build dependencies from any workspace crate to it, so no shipped
//!   binary links it.
//! - **No route serves OAuth.** No routing call in any workspace crate's sources (`route`,
//!   `route_service`, `nest`, `nest_service`) names a token, authorization, introspection, JWKS or
//!   authorization-server metadata path; the only well-known path allowed is
//!   `/.well-known/oauth-protected-resource*` (RFC 9728, from step 2a). A path that is not a string
//!   literal is covered by the probe instead.
//! - **The router answers none of them.** Every OAuth path, with a credential the router admits,
//!   gets a 404 or 405 and no OAuth document, and without one a refusal, from the router of every
//!   auth mode the host serves. Step 2a adds its modes (`oauth`, `gateway`) to [`routers`], each
//!   with an admitted credential.
//!
//! The dependency walk reads `cargo metadata --no-deps` of the workspace, then of each path crate
//! outside it that the walk reaches (the afd crate), so it works offline.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use axum::body::Body;
use http::Request;
use serde_json::Value;
use support::mcp::Http;
use support::*;

const TESTKIT: &str = "umbel-testkit-idp";

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).to_path_buf()
}

fn metadata() -> Value {
    metadata_of(&workspace_root().join("Cargo.toml"))
}

/// `cargo metadata --no-deps --offline` of the workspace or package at `manifest`.
fn metadata_of(manifest: &Path) -> Value {
    let output = Command::new(env!("CARGO"))
        .args([
            "metadata",
            "--format-version",
            "1",
            "--no-deps",
            "--offline",
        ])
        .arg("--manifest-path")
        .arg(manifest)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}: {}",
        manifest.display(),
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

/// Whether one dependency entry of a manifest names the test kit: by key, by `package` (a renamed
/// dependency) or by `path`.
fn names_testkit(key: &str, entry: &toml::Value) -> bool {
    key == TESTKIT
        || entry.get("package").and_then(toml::Value::as_str) == Some(TESTKIT)
        || entry
            .get("path")
            .and_then(toml::Value::as_str)
            .is_some_and(|path| path.trim_end_matches('/').ends_with("testkit-idp"))
}

#[test]
fn the_host_manifest_names_the_test_kit_only_as_a_dev_dependency() {
    let text = fs::read_to_string(workspace_root().join("Cargo.toml")).unwrap();
    let manifest: toml::Table = text.parse().unwrap();
    let mut tables: Vec<(String, &toml::Table)> = Vec::new();
    for kind in ["dependencies", "build-dependencies"] {
        if let Some(table) = manifest.get(kind).and_then(toml::Value::as_table) {
            tables.push((kind.to_owned(), table));
        }
    }
    if let Some(targets) = manifest.get("target").and_then(toml::Value::as_table) {
        for (platform, target) in targets {
            for kind in ["dependencies", "build-dependencies"] {
                if let Some(table) = target.get(kind).and_then(toml::Value::as_table) {
                    tables.push((format!("target.{platform}.{kind}"), table));
                }
            }
        }
    }
    assert!(tables.iter().any(|(kind, _)| kind == "dependencies"));
    for (kind, table) in tables {
        for (key, entry) in table {
            assert!(
                !names_testkit(key, entry),
                "umbel names {TESTKIT} in [{kind}] as {key}; it belongs in [dev-dependencies] only"
            );
        }
    }
    // The kit is a workspace member, so `cargo test --workspace` (umbel.yml) runs its suite.
    let members = manifest["workspace"]["members"].as_array().unwrap();
    assert!(
        members
            .iter()
            .any(|member| member.as_str() == Some("testkit-idp"))
    );
    let excluded = manifest["workspace"].get("exclude");
    assert!(excluded.is_none_or(|exclude| !exclude.to_string().contains("testkit-idp")));
}

/// A crate's normal and build dependencies (dev-dependencies never link into what it ships), as
/// `(name, path)`, the path set for a path dependency.
fn linked_dependencies(package: &Value) -> Vec<(String, Option<PathBuf>)> {
    package["dependencies"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|dependency| dependency["kind"].as_str() != Some("dev"))
        .map(|dependency| {
            (
                dependency["name"].as_str().unwrap().to_owned(),
                dependency["path"].as_str().map(PathBuf::from),
            )
        })
        .collect()
}

#[test]
fn no_workspace_crate_reaches_the_test_kit_through_a_normal_or_build_dependency() {
    let metadata = metadata();
    let packages = metadata["packages"].as_array().unwrap();
    let testkit = packages
        .iter()
        .find(|package| package["name"] == TESTKIT)
        .expect("the test kit is a workspace member");
    assert_eq!(
        testkit["publish"],
        serde_json::json!([]),
        "the kit is publish = false"
    );
    // A `publish = false` crate is reachable only through path dependencies: the workspace's own,
    // and those of path crates outside it (the afd crate), loaded as the walk reaches them.
    // A registry crate cannot depend on it.
    let mut edges: HashMap<String, Vec<(String, Option<PathBuf>)>> = packages
        .iter()
        .map(|package| {
            (
                package["name"].as_str().unwrap().to_owned(),
                linked_dependencies(package),
            )
        })
        .collect();
    let mut outside = 0;
    for package in packages {
        let start = package["name"].as_str().unwrap();
        if start == TESTKIT {
            continue;
        }
        let mut seen: BTreeSet<String> = BTreeSet::new();
        let mut stack: Vec<Vec<String>> = vec![vec![start.to_owned()]];
        while let Some(chain) = stack.pop() {
            let last = chain.last().unwrap().clone();
            assert_ne!(
                last,
                TESTKIT,
                "{} links {TESTKIT} through a normal or build dependency",
                chain.join(" -> ")
            );
            if !seen.insert(last.clone()) {
                continue;
            }
            let Some(dependencies) = edges.get(&last).cloned() else {
                continue;
            };
            for (name, path) in dependencies {
                if !edges.contains_key(&name)
                    && let Some(path) = path
                {
                    // A path crate outside the workspace: read its own declared dependencies.
                    let outer = metadata_of(&path.join("Cargo.toml"));
                    let found = outer["packages"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .find(|package| package["name"] == name.as_str())
                        .unwrap_or_else(|| panic!("{name} is not at {}", path.display()));
                    edges.insert(name.clone(), linked_dependencies(found));
                    outside += 1;
                }
                let mut longer = chain.clone();
                longer.push(name);
                stack.push(longer);
            }
        }
    }
    // The walk left the workspace: the afd crate's own dependencies were read.
    assert!(outside > 0 && edges.contains_key("afd"));
    // And the kit itself ships no binary.
    let binaries: Vec<&Value> = testkit["targets"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|target| target["kind"].as_array().unwrap().contains(&"bin".into()))
        .collect();
    assert!(binaries.is_empty(), "{TESTKIT} has a binary target");
}

/// Whether a route path is an OAuth endpoint Umbel must never serve.
fn oauth_path(route: &str) -> bool {
    let route = route.to_ascii_lowercase();
    if let Some((_, rest)) = route.split_once("/.well-known/")
        && !rest.starts_with("oauth-protected-resource")
    {
        return true;
    }
    // The protected-resource metadata's own name is not an OAuth endpoint; what follows it is
    // checked like any other path.
    let route = route.replace("/.well-known/oauth-protected-resource", "");
    route.split('/').any(|segment| {
        matches!(segment, "token" | "revoke" | "userinfo")
            || ["authoriz", "oauth", "introspect", "jwks"]
                .iter()
                .any(|prefix| segment.starts_with(prefix))
    })
}

#[test]
fn the_route_rule_tells_oauth_paths_apart() {
    for path in [
        "/token",
        "/oauth/token",
        "/oauth2/authorize",
        "/authorize",
        "/introspect",
        "/jwks",
        "/jwks.json",
        "/.well-known/openid-configuration",
        "/.well-known/oauth-authorization-server{path}",
        "/.well-known/jwks.json",
        "/mcp/token",
    ] {
        assert!(oauth_path(path), "{path}");
    }
    for path in [
        "/health",
        "/mcp",
        "/d/{id}",
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource{path}",
        "/.well-known/oauth-protected-resource/mcp",
    ] {
        assert!(!oauth_path(path), "{path}");
    }
}

/// Every `.rs` file under `dir`.
fn sources(dir: &Path, found: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries {
        let path = entry.unwrap().path();
        if path.is_dir() {
            sources(&path, found);
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            found.push(path);
        }
    }
}

/// `text` with comments removed and every string literal kept, as `(code, literals)`: the code
/// has each literal replaced by `"<n>"`, its index into the literals.
fn lex(text: &str) -> (String, Vec<String>) {
    let chars: Vec<char> = text.chars().collect();
    let mut code = String::new();
    let mut literals = Vec::new();
    let at = |position: usize| chars.get(position).copied();
    let mut index = 0;
    while index < chars.len() {
        match chars[index] {
            '/' if at(index + 1) == Some('/') => {
                while index < chars.len() && chars[index] != '\n' {
                    index += 1;
                }
            }
            '/' if at(index + 1) == Some('*') => {
                index += 2;
                while index < chars.len() && !(chars[index] == '*' && at(index + 1) == Some('/')) {
                    index += 1;
                }
                index += 2;
            }
            'r' if at(index + 1) == Some('"')
                || (at(index + 1) == Some('#') && matches!(at(index + 2), Some('"' | '#'))) =>
            {
                let mut hashes = 0;
                index += 1;
                while chars.get(index) == Some(&'#') {
                    hashes += 1;
                    index += 1;
                }
                index += 1;
                let mut literal = String::new();
                loop {
                    if index >= chars.len() {
                        break;
                    }
                    if chars[index] == '"'
                        && (1..=hashes).all(|offset| chars.get(index + offset) == Some(&'#'))
                    {
                        index += 1 + hashes;
                        break;
                    }
                    literal.push(chars[index]);
                    index += 1;
                }
                code.push_str(&format!("\"{}\"", literals.len()));
                literals.push(literal);
            }
            '"' => {
                index += 1;
                let mut literal = String::new();
                while index < chars.len() && chars[index] != '"' {
                    if chars[index] == '\\' {
                        literal.push(chars[index]);
                        index += 1;
                    }
                    if let Some(&next) = chars.get(index) {
                        literal.push(next);
                    }
                    index += 1;
                }
                index += 1;
                code.push_str(&format!("\"{}\"", literals.len()));
                literals.push(literal);
            }
            '\'' if at(index + 1) == Some('\\') => {
                // An escaped character literal: skip the escape, then to its closing quote.
                index += 3;
                while index < chars.len() && chars[index] != '\'' {
                    index += 1;
                }
                index += 1;
            }
            '\'' if at(index + 2) == Some('\'') => index += 3,
            other => {
                code.push(other);
                index += 1;
            }
        }
    }
    (code, literals)
}

/// The string literals in the first argument of each routing call in `text`.
fn route_paths(text: &str) -> Vec<String> {
    let (code, literals) = lex(text);
    let mut paths = Vec::new();
    for call in [".route(", ".route_service(", ".nest(", ".nest_service("] {
        for (start, _) in code.match_indices(call) {
            let mut depth = 0usize;
            let mut argument = String::new();
            for character in code[start + call.len()..].chars() {
                match character {
                    '(' | '[' | '{' => depth += 1,
                    ')' | ']' | '}' if depth == 0 => break,
                    ')' | ']' | '}' => depth -= 1,
                    ',' if depth == 0 => break,
                    _ => {}
                }
                argument.push(character);
            }
            for piece in argument.split('"').skip(1).step_by(2) {
                if let Ok(number) = piece.parse::<usize>() {
                    paths.push(literals[number].clone());
                }
            }
        }
    }
    paths
}

#[test]
fn the_route_scanner_reads_literals_and_skips_comments() {
    let text = r##"
        // .route("/token", get(nothing))
        /* .route("/authorize", get(nothing)) */
        let c = '"'; let d = '\''; let e: &'static str = "x";
        Router::new()
            .route("/health", get(health))
            .route(&format!("/.well-known/oauth-protected-resource{}", path), get(metadata))
            .nest_service(r#"/jwks"#, service)
            .route(PATH, get(other));
    "##;
    assert_eq!(
        route_paths(text),
        [
            "/health",
            "/.well-known/oauth-protected-resource{}",
            "/jwks"
        ]
    );
}

#[test]
fn no_routing_call_in_any_workspace_crate_names_an_oauth_path() {
    let metadata = metadata();
    let mut files = Vec::new();
    for package in metadata["packages"].as_array().unwrap() {
        if package["name"] == TESTKIT {
            continue;
        }
        let manifest = Path::new(package["manifest_path"].as_str().unwrap());
        sources(&manifest.parent().unwrap().join("src"), &mut files);
    }
    assert!(
        files
            .iter()
            .any(|file| file.ends_with("src/surfaces/http.rs"))
    );
    let mut routes = Vec::new();
    for file in &files {
        for path in route_paths(&fs::read_to_string(file).unwrap()) {
            assert!(
                !oauth_path(&path),
                "{} routes {path:?}: Umbel is never an authorization server (A7)",
                file.display()
            );
            routes.push(path);
        }
    }
    // The scan sees the router: today's one literal route.
    assert!(routes.iter().any(|route| route == "/health"), "{routes:?}");
}

/// One router to probe: the auth mode it serves, its workspace, and a driver whose credential
/// the router's authentication layer admits, so that the probe reaches the routes behind it.
struct Probed {
    mode: &'static str,
    _workspace: tempfile::TempDir,
    http: Http,
}

/// Every HTTP router the host builds, one per auth mode it serves. Mode `none` admits the
/// workspace's bearer token. Phase 5 step 2a adds `oauth` (with a `umbel-testkit-idp` access
/// token for `http.public_url`) and `gateway` (with a kit assertion over the pinned channel), each
/// with a credential its layer admits, so that a 404 or 405 proves no route matched rather than
/// that the layer refused.
fn routers() -> Vec<Probed> {
    let dir = minimal();
    let host = host(dir.path());
    let http = Http::new(&host);
    vec![Probed {
        mode: "none",
        _workspace: dir,
        http,
    }]
}

const PROBES: &[&str] = &[
    "/token",
    "/authorize",
    "/oauth/token",
    "/oauth/authorize",
    "/oauth2/token",
    "/oauth2/authorize",
    "/introspect",
    "/oauth/introspect",
    "/revoke",
    "/userinfo",
    "/jwks",
    "/jwks.json",
    "/.well-known/jwks.json",
    "/.well-known/openid-configuration",
    "/.well-known/oauth-authorization-server",
    "/.well-known/openid-configuration/mcp",
    "/.well-known/oauth-authorization-server/mcp",
    "/mcp/.well-known/openid-configuration",
    "/mcp/.well-known/oauth-authorization-server",
    "/mcp/token",
    "/mcp/authorize",
    "/mcp/jwks",
];

/// Members only an OAuth answer carries.
const OAUTH_MEMBERS: &[&str] = &[
    "access_token",
    "id_token",
    "token_endpoint",
    "authorization_endpoint",
    "jwks_uri",
    "keys",
    "active",
];

/// Send GET and POST to `path`, with the driver's bearer credential if it holds one.
async fn get_and_post(http: &Http, path: &str) -> [(&'static str, umbel::testkit::mcp::Reply); 2] {
    let mut post = Request::post(path)
        .header("host", "localhost")
        .header("content-type", "application/x-www-form-urlencoded");
    if let Some(token) = http.token() {
        post = post.header("authorization", format!("Bearer {token}"));
    }
    let post = post
        .body(Body::from(
            "grant_type=client_credentials&token=x&client_id=x&response_type=code",
        ))
        .unwrap();
    [
        ("GET", http.get(path).await),
        ("POST", http.send(post).await),
    ]
}

fn assert_no_oauth_member(
    mode: &str,
    method: &str,
    path: &str,
    reply: &umbel::testkit::mcp::Reply,
) {
    if let Value::Object(members) = reply.json() {
        for member in OAUTH_MEMBERS {
            assert!(
                !members.contains_key(*member),
                "{mode}: {method} {path} answered with {member}"
            );
        }
    }
}

#[tokio::test]
async fn no_router_answers_an_oauth_request() {
    for probed in routers() {
        let mode = probed.mode;
        for path in PROBES {
            // With an admitted credential the request reaches the routes, and none matches.
            for (method, reply) in get_and_post(&probed.http, path).await {
                assert!(
                    matches!(reply.status, 404 | 405),
                    "{mode}: {method} {path} answered {}",
                    reply.status
                );
                assert_no_oauth_member(mode, method, path, &reply);
            }
            // Without one, it is refused, and still serves nothing OAuth.
            let anonymous = probed.http.clone().with_token(None);
            for (method, reply) in get_and_post(&anonymous, path).await {
                assert!(
                    reply.status >= 400,
                    "{mode}: anonymous {method} {path} answered {}",
                    reply.status
                );
                assert_no_oauth_member(mode, method, path, &reply);
            }
        }
    }
}
