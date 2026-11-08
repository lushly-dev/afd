//! The raw token goes no further than the verifier (phase 5 specification, section 3.2, "Never
//! passed on"; section 13.2's "a token in a URL or log"; step 2b): a unique canary token, JWT and
//! opaque, accepted, refused and running a mounted plugin's tool, never appears in a log line at
//! any level, an HTTP answer, an error, a file of the workspace (the journal, the event streams,
//! the state, task and usage records, when there are any), the context and its `Debug` output,
//! AFD's credentials as a command sees them, or what a mounted server receives.
#![allow(clippy::unwrap_used, clippy::expect_used)]

#[path = "support/logs.rs"]
mod logs;
#[path = "support/mounted.rs"]
mod mounted;
mod support;

use std::path::Path;

use mounted::{FX_HTTP, Seen, fixture_router, fx_manifest, plugin_dir, serve};
use serde_json::json;
use support::hosted::PUBLIC_URL;
use support::oauth::{Running, Setup};
use umbel_testkit_idp::{Client as KitClient, TestIdp};

/// The pieces of `token` that must never leave the verifier: the whole token and each of its
/// non-empty parts.
fn pieces(token: &str) -> Vec<String> {
    let mut pieces = vec![token.to_owned()];
    pieces.extend(
        token
            .split('.')
            .filter(|part| part.len() >= 16)
            .map(str::to_owned),
    );
    pieces
}

/// Every file under `dir`, as bytes.
fn files(dir: &Path) -> Vec<(String, Vec<u8>)> {
    let mut found = Vec::new();
    let mut pending = vec![dir.to_path_buf()];
    while let Some(next) = pending.pop() {
        for entry in std::fs::read_dir(&next).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                pending.push(path);
            } else if let Ok(bytes) = std::fs::read(&path) {
                found.push((path.display().to_string(), bytes));
            }
        }
    }
    found
}

fn contains(haystack: &[u8], needle: &str) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle.as_bytes())
}

/// Assert no `canary` piece is in any of `sinks` or any file under `dir`.
fn assert_absent(canaries: &[String], sinks: &[(&str, String)], dir: &Path) {
    let files = files(dir);
    assert!(!files.is_empty());
    for canary in canaries {
        for (name, text) in sinks {
            assert!(!text.contains(canary.as_str()), "the token reached {name}");
        }
        for (path, bytes) in &files {
            assert!(!contains(bytes, canary), "the token reached {path}");
        }
        for line in logs::lines("") {
            assert!(
                !line.contains(canary.as_str()),
                "the token reached the log: {line}"
            );
        }
    }
}

#[tokio::test]
async fn the_canary_token_reaches_no_log_answer_file_context_or_mount() {
    logs::install();
    let seen = Seen::default();
    let mount = serve(
        fixture_router(
            mounted::mount_fixture::Fixture::default(),
            None,
            seen.clone(),
        ),
        None,
    );
    let rest = format!(
        "[plugins]\nenabled = [\"fx\"]\n\n[plugins.fx]\nsource = \"plugins/fx\"\nurl = \"http://127.0.0.1:{}/mcp\"\n",
        mount.port
    );
    let kit = TestIdp::start().await.unwrap();
    let setup = Setup {
        alias: "as-canary",
        rest: &rest,
        ..Setup::default()
    };
    let dir = support::workspace(&support::oauth::config(&kit, &setup));
    plugin_dir(
        dir.path(),
        "fx",
        &fx_manifest(
            FX_HTTP,
            "",
            "[[mount.tools]]\ntool = \"echo\"\neffects = [\"inspect\"]\n\n[[mount.tools]]\ntool = \"observed\"\neffects = [\"inspect\"]\n",
        ),
    );
    let clock = afd::fixed_clock(support::oauth::now_ms());
    let host = support::oauth::host(dir.path(), &kit, Some(&clock), None);
    let served = support::hosted::Served::start(&host).await;
    let running = Running {
        client: support::hosted::Client::plain(served.address),
        kit,
        dir,
        host,
        served,
        clock,
    };

    let jti = format!("canary-{}", support::oauth::now_ms());
    let canary = running
        .token()
        .jti(&jti)
        .scopes(["umbel:read", "umbel:write"])
        .sign();
    let mut sinks: Vec<(&str, String)> = Vec::new();
    // Accepted: a call that runs, its context, its credentials and its Debug output.
    let whoami = running.whoami(&canary).await;
    assert_eq!(whoami["principal"]["authentication"], "verified");
    sinks.push(("the command's context", whoami.to_string()));
    // A mounted server's tool, run by the verified caller: what it received.
    for tool in ["fx-echo", "fx-observed"] {
        let reply = running
            .call(
                Some(&canary),
                "afd-call",
                json!({ "command": tool, "input": { "value": "x" } }),
            )
            .await;
        assert_eq!(reply.status, 200, "{}", reply.text);
        assert!(
            reply.text.contains("\"success\":true"),
            "{tool}: {}",
            reply.text
        );
        sinks.push(("a mounted tool's answer", reply.text));
    }
    let mount_headers = format!("{:?}", seen.all());
    assert!(!seen.all().is_empty());
    assert!(
        seen.authorizations().iter().all(Option::is_none),
        "{mount_headers}"
    );
    sinks.push(("the mounted server's request headers", mount_headers));
    // Refused after verification: a scope it lacks (403), a command error.
    let read_only = running
        .token()
        .jti(&format!("{jti}-r"))
        .scopes(["umbel:read"])
        .sign();
    let reply = running
        .call(Some(&read_only), "fixture-touch", json!({}))
        .await;
    assert_eq!(reply.status, 403, "{}", reply.text);
    sinks.push(("a 403", format!("{:?} {}", reply.headers, reply.text)));
    let reply = running
        .call(Some(&canary), "event-list", json!({ "space": "nowhere" }))
        .await;
    sinks.push(("a command error", reply.text));
    // Refused by the verifier: the 401's headers and body.
    for broken in [
        running
            .token()
            .jti(&format!("{jti}-x"))
            .break_rule(umbel_testkit_idp::Break::Signature)
            .sign(),
        running
            .token()
            .jti(&format!("{jti}-y"))
            .break_rule(umbel_testkit_idp::Break::Expired)
            .sign(),
    ] {
        let reply = running
            .call(Some(&broken), "fixture-whoami", json!({}))
            .await;
        assert_eq!(reply.status, 401);
        sinks.push(("a 401", format!("{:?} {}", reply.headers, reply.text)));
        let mut canaries = pieces(&broken);
        canaries.push(jti.clone());
        assert_absent(&canaries, &sinks, running.dir.path());
    }
    let mut canaries = pieces(&canary);
    canaries.extend(pieces(&read_only));
    canaries.push(jti.clone());
    assert_absent(&canaries, &sinks, running.dir.path());
}

#[tokio::test]
async fn an_opaque_canary_and_the_introspection_secret_reach_only_the_endpoint() {
    logs::install();
    let kit = TestIdp::start().await.unwrap();
    let secret = format!("umbel-canary-secret-{}", support::oauth::now_ms());
    kit.authorization_server()
        .register_client(KitClient::confidential("umbel-rs", &secret).introspection());
    let setup = Setup {
        alias: "as-canary-intro",
        issuer: "verify = \"introspection\"\nintrospection = { client_id = \"umbel-rs\", client_secret_env = \"UMBEL_CANARY_SECRET\" }",
        ..Setup::default()
    };
    let dir = support::workspace(&support::oauth::config(&kit, &setup));
    let clock = afd::fixed_clock(support::oauth::now_ms());
    let host = umbel::HostBuilder::open(dir.path())
        .unwrap()
        .with_auth_root_certificate(kit.ca().certificate_pem().as_bytes().to_vec())
        .with_auth_secret("UMBEL_CANARY_SECRET", &secret)
        .with_auth_clock(clock.clone())
        .register(support::oauth::whoami())
        .register(support::oauth::touch())
        .seal()
        .unwrap();
    let served = support::hosted::Served::start(&host).await;
    let running = Running {
        client: support::hosted::Client::plain(served.address),
        kit,
        dir,
        host,
        served,
        clock,
    };
    let server = running.kit.authorization_server();
    let opaque = server
        .opaque_token(PUBLIC_URL)
        .issued_at(running.now_s())
        .subject("ada")
        .scopes(["umbel:read"])
        .sign();
    let whoami = running.whoami(&opaque).await;
    let revoked = server
        .opaque_token(PUBLIC_URL)
        .issued_at(running.now_s())
        .subject("ada")
        .sign();
    server.revoke(&revoked);
    let reply = running
        .call(Some(&revoked), "fixture-whoami", json!({}))
        .await;
    assert_eq!(reply.status, 401);
    let sinks = vec![
        ("the command's context", whoami.to_string()),
        ("a 401", format!("{:?} {}", reply.headers, reply.text)),
        (
            "the host's Debug output",
            format!("{:?}", running.host.http_server()),
        ),
    ];
    // The token and Umbel's own client secret, everywhere but the endpoint they are for.
    assert_absent(&[opaque, revoked, secret], &sinks, running.dir.path());
}
