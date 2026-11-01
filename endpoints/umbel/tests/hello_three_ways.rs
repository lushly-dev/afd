//! The phase 1 exit run (specification section 13, run 1): the hello plugin, written once and
//! built three ways, answers `hello-greet` alike as compiled code, as a WebAssembly component and
//! as a mounted MCP server, over MCP in both eras and through the CLI.
//!
//! Each build gets a workspace of its own and the test kit's fixed clock. `space` is passed
//! explicitly, because the host's middleware cannot change a handler's input and the mounted
//! server sees the argument unresolved. The compiled and component results are equal, `at`
//! included; the mounted result's `data` equals theirs without `at` (the mounted server reads its
//! own clock) and carries the `recorded` stamp. No call writes an event, because every build
//! declares `inspect`.
#![cfg(all(feature = "component", feature = "mounted", feature = "cli"))]
#![allow(clippy::unwrap_used, clippy::expect_used)]

#[path = "support/components.rs"]
mod components;
#[path = "support/mounted.rs"]
mod mounted;
mod support;

use serde_json::{Value, json};
use umbel::testkit::{Era, TestHost};

const FIXED_AT: &str = "2026-01-01T00:00:00.000Z";

fn input() -> Value {
    json!({ "name": "Ada", "space": "main" })
}

/// hello's code as the host's own library loads it.
fn compiled() -> TestHost {
    TestHost::compiled(umbel::plugins::sdk(umbel_plugin_hello::plugin()))
        .boot()
        .unwrap()
}

/// hello as `plugins/hello` with its component, laid out as section 10.5 gives.
fn component(staging: &std::path::Path) -> TestHost {
    TestHost::directory(components::hello_dir(staging))
        .boot()
        .unwrap()
}

/// hello as `plugins/hello` with the `hello-mcp` binary, over stdio.
fn mounted_stdio(staging: &std::path::Path) -> TestHost {
    TestHost::directory(mounted::hello_dir(staging, "hello"))
        .boot()
        .unwrap()
}

/// What each surface answers: the `CommandResult`s of one build, labelled by surface.
async fn answers(host: &TestHost) -> Vec<(String, Value)> {
    let mut answers = Vec::new();
    for era in [Era::Modern, Era::Legacy] {
        for mut client in [host.mcp(era).await, host.http(era).await] {
            let label = client.label();
            let result = client.call("hello-greet", input()).await;
            answers.push((label, result));
        }
    }
    let output = host
        .cli(&["hello", "greet", "name=Ada", "space=main"])
        .await;
    assert_eq!(output.code, 0, "cli: {}", output.stdout);
    answers.push(("cli".to_owned(), output.json()));
    answers
}

fn without_at(data: &Value) -> Value {
    let mut data = data.clone();
    data.as_object_mut().unwrap().remove("at");
    data
}

/// The greeting every build agrees on, with `at` left out.
fn greeting() -> Value {
    json!({ "greeting": "Hello, Ada!", "space": "main" })
}

async fn assert_no_events(host: &TestHost, build: &str) {
    let listed = host.call("event-list", json!({ "space": "main" })).await;
    assert!(listed.success, "{build}: {listed:?}");
    let listed = listed.data.unwrap();
    assert_eq!(listed["events"], json!([]), "{build}: an event was written");
    assert_eq!(listed["head"], "v0:main:0", "{build}");
}

#[tokio::test(flavor = "multi_thread")]
async fn hello_answers_alike_compiled_as_a_component_and_mounted() {
    let staging = tempfile::tempdir().unwrap();
    let compiled_host = compiled();
    let component_host = component(&staging.path().join("component"));
    let mounted_host = mounted_stdio(&staging.path().join("mounted"));

    // Compiled and component: the data is equal, `at` included, on every surface.
    let compiled_answers = answers(&compiled_host).await;
    let component_answers = answers(&component_host).await;
    assert_eq!(compiled_answers.len(), 5);
    let expected = json!({
        "greeting": "Hello, Ada!",
        "space": "main",
        "at": FIXED_AT,
    });
    for (build, answers) in [
        ("compiled", &compiled_answers),
        ("component", &component_answers),
    ] {
        for (surface, result) in answers {
            assert_eq!(result["success"], true, "{build} {surface}: {result}");
            assert_eq!(result["data"], expected, "{build} {surface}");
        }
    }
    for ((surface, one), (_, two)) in compiled_answers.iter().zip(&component_answers) {
        assert_eq!(
            one["data"], two["data"],
            "compiled and component: {surface}"
        );
    }

    // Mounted: `data` equals the others' without `at`, whose value is the mounted server's own
    // clock; the result carries the `recorded` stamp, and is stamped external and mounted.
    let mounted_answers = answers(&mounted_host).await;
    assert_eq!(mounted_answers.len(), 5);
    for (surface, result) in &mounted_answers {
        assert_eq!(result["success"], true, "mounted {surface}: {result}");
        assert_eq!(without_at(&result["data"]), greeting(), "mounted {surface}");
        assert_eq!(
            without_at(&result["data"]),
            without_at(&compiled_answers[0].1["data"]),
            "mounted {surface}"
        );
        let at = result["data"]["at"].as_str().unwrap();
        assert!(at.starts_with("20"), "mounted {surface}: at is {at}");
        let metadata = &result["metadata"];
        assert_eq!(
            metadata["dev.umbel/replay"], "recorded",
            "mounted {surface}"
        );
        assert_eq!(metadata["dev.umbel/trust"], "external", "mounted {surface}");
        assert_eq!(
            metadata["dev.umbel/plugin"],
            json!({ "id": "hello", "kind": "mounted" }),
            "mounted {surface}"
        );
    }

    // The compiled and component builds are not recorded-only: their results replay.
    for (build, answers) in [
        ("compiled", &compiled_answers),
        ("component", &component_answers),
    ] {
        for (surface, result) in answers {
            assert_ne!(
                result["metadata"]["dev.umbel/replay"], "recorded",
                "{build} {surface}"
            );
        }
    }

    // `hello-greet` declares `inspect` in every build, so no call wrote an event.
    assert_no_events(&compiled_host, "compiled").await;
    assert_no_events(&component_host, "component").await;
    assert_no_events(&mounted_host, "mounted").await;
}
