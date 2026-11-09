//! Rate limits (phase 5 specification, sections 6.3 and 11; D128; step 3): the per-token limit
//! after verification (layer 6), keyed on the verified issuer, subject and client and shared by
//! every process behind one URL, and the read limit inside the registry, per effective principal,
//! checked before the handler on bytes already used. The per-IP limit before verification is
//! `auth_layers.rs`'s, and its client address from a trusted proxy `trusted_proxies.rs`'s.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use serde_json::json;
use support::hosted::{Client, Reply, Served};
use support::oauth::{Running, Setup};

/// The limited caller's subject. It holds letters no hex digit has, so a stored key's digest
/// cannot contain it by chance, as the default subject `ada` could.
const SUBJECT: &str = "zoe-limited";

fn too_many(reply: &Reply, whose: &str) {
    assert_eq!(reply.status, 429, "{}", reply.text);
    let seconds: u64 = reply
        .headers
        .get("retry-after")
        .unwrap()
        .to_str()
        .unwrap()
        .parse()
        .unwrap();
    assert!((1..=60).contains(&seconds), "{seconds}");
    let body: serde_json::Value = serde_json::from_str(&reply.text).unwrap();
    assert_eq!(body["error"], json!("RATE_LIMITED"));
    let suggestion = body["suggestion"].as_str().unwrap();
    assert!(suggestion.contains(whose), "{suggestion}");
}

#[tokio::test]
async fn the_per_token_limit_keeps_each_callers_budget_its_own_across_processes() {
    let running = Running::start(Setup {
        rest: "[limits]\ncalls_per_minute = 3\n",
        ..Setup::default()
    })
    .await;
    let zoe = running.token().subject(SUBJECT).sign();
    for _ in 0..3 {
        running.whoami(&zoe).await;
    }
    too_many(
        &running.call(Some(&zoe), "fixture-whoami", json!({})).await,
        "with this token",
    );
    // A new token for the same person and client shares the budget: the key is the verified
    // issuer, subject and client, not the token's text.
    let renewed = running.token().subject(SUBJECT).lifetime(200).sign();
    too_many(
        &running
            .call(Some(&renewed), "fixture-whoami", json!({}))
            .await,
        "with this token",
    );
    // A second process on the same workspace counts on the same rows.
    let second = support::oauth::host(running.dir.path(), &running.kit, Some(&running.clock), None);
    let served = Served::start(&second).await;
    let other = Client::plain(served.address);
    let reply = support::oauth::modern(
        &other,
        "tools/call",
        json!({ "name": "fixture-whoami", "arguments": {} }),
        Some(&zoe),
    )
    .await;
    too_many(&reply, "with this token");
    // Another person, and another client of the same person, have budgets of their own.
    let bo = running.token().subject("bo").sign();
    running.whoami(&bo).await;
    let other_client = running
        .token()
        .subject(SUBJECT)
        .client_id("other-client")
        .sign();
    running.whoami(&other_client).await;
    // The shared counters name no one: each name is keyed by the workspace's limits.key, so
    // neither an identifier nor its unkeyed digest is stored.
    let path = running.dir.path().join("state/shared/limits.sqlite3");
    let connection = rusqlite::Connection::open(&path).unwrap();
    let mut statement = connection.prepare("SELECT DISTINCT key FROM hits").unwrap();
    let keys: Vec<String> = statement
        .query_map([], |row| row.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    let issuer = running.kit.authorization_server().issuer();
    let unkeyed = {
        use sha2::Digest;
        let mut digest = sha2::Sha256::new();
        for part in [issuer, SUBJECT, "test-client"] {
            digest.update((part.len() as u64).to_be_bytes());
            digest.update(part.as_bytes());
        }
        let hex: String = digest
            .finalize()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        format!("token:{hex}")
    };
    let tokens: Vec<&String> = keys
        .iter()
        .filter(|key| key.starts_with("token:"))
        .collect();
    assert_eq!(tokens.len(), 3, "{keys:?}");
    assert!(!keys.contains(&unkeyed), "{keys:?}");
    for key in &keys {
        assert!(
            !key.contains(SUBJECT) && !key.contains("test-client"),
            "{key}"
        );
    }
    assert!(running.dir.path().join("state/keys/limits.key").exists());
}

#[tokio::test]
async fn the_per_token_limit_comes_after_verification_and_the_scope_check() {
    let running = Running::start(Setup {
        rest: "[limits]\ncalls_per_minute = 1\n",
        ..Setup::default()
    })
    .await;
    let ada = running.token().sign();
    running.whoami(&ada).await;
    // Over the limit, a token that does not verify is still a 401: nothing it sends is counted
    // or keyed.
    let broken = format!("{ada}x");
    let reply = running
        .call(Some(&broken), "fixture-whoami", json!({}))
        .await;
    assert_eq!(reply.status, 401, "{}", reply.text);
    // A token with no Umbel scope is refused before the limit counts it: bo's first call is
    // refused for its scope, and his second, with a scope, is still within his budget.
    let bo_none = running.token().subject("bo").scopes(["openid"]).sign();
    let reply = running
        .call(Some(&bo_none), "fixture-whoami", json!({}))
        .await;
    assert_eq!(reply.status, 403, "{}", reply.text);
    let bo = running.token().subject("bo").sign();
    running.whoami(&bo).await;
    too_many(
        &running.call(Some(&ada), "fixture-whoami", json!({})).await,
        "with this token",
    );
}

#[tokio::test]
async fn the_read_limit_refuses_before_the_handler_on_bytes_already_used() {
    let runs = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&runs);
    let running = Running::start_configured(
        Setup {
            rest: "[limits]\nread_bytes_per_minute = 64\n",
            ..Setup::default()
        },
        move |builder| {
            let mut big = support::fixture("fixture-big", move |_, _| {
                counted.fetch_add(1, Ordering::SeqCst);
                afd::success(json!("x".repeat(200)))
            });
            big.mutation = true;
            builder.register(big)
        },
    )
    .await;
    let ada = running.token().sign();
    let call = |token: String| {
        let running = &running;
        async move {
            running
                .result(
                    &token,
                    "afd-call",
                    json!({ "command": "fixture-big", "input": {} }),
                )
                .await
        }
    };
    // The first call is under the limit when it starts: it runs, and its result, a mutation's, is
    // returned whole although it carries the principal past the limit.
    let first = call(ada.clone()).await;
    assert_eq!(first["data"], json!("x".repeat(200)), "{first}");
    assert_eq!(runs.load(Ordering::SeqCst), 1);
    // The next is refused before its handler runs.
    let refused = call(ada.clone()).await;
    assert_eq!(refused["error"]["code"], json!("RATE_LIMITED"), "{refused}");
    assert_eq!(refused["error"]["retryable"], json!(true));
    let retry = refused["error"]["details"]["retryAfterMs"]
        .as_i64()
        .unwrap();
    assert!((1..=60_000).contains(&retry), "{retry}");
    assert_eq!(runs.load(Ordering::SeqCst), 1);
    // Another client of the same person is the same effective principal: refused too.
    let other_client = running.token().client_id("other-client").sign();
    let refused = call(other_client).await;
    assert_eq!(refused["error"]["code"], json!("RATE_LIMITED"), "{refused}");
    // Another person is not.
    let bo = running.token().subject("bo").sign();
    assert_eq!(call(bo).await["success"], json!(true));
    assert_eq!(runs.load(Ordering::SeqCst), 2);
    // A library call is treated by its actor (section 4.7): ada's person is limited there too.
    let ada_library = afd::Actor::new(afd::ActorKind::Agent)
        .with_id("corp/app")
        .with_on_behalf_of("corp/ada");
    let refused = support::call(&running.host, ada_library, "fixture-big", json!({})).await;
    assert_eq!(refused.error.unwrap().code, "RATE_LIMITED");
    // The operator is never limited.
    let configure = |builder: umbel::HostBuilder| {
        let mut big = support::fixture("fixture-big", |_, _| afd::success(json!("x".repeat(200))));
        big.mutation = true;
        builder
            .register(big)
            .register(support::oauth::whoami())
            .register(support::oauth::touch())
    };
    for _ in 0..2 {
        let run = support::cli_with(
            running.dir.path(),
            &["call", "fixture-big", "--yes"],
            support::Scripted::no_terminal(),
            configure,
        )
        .await;
        assert_eq!(run.code, 0, "{}", run.stdout);
    }
}
