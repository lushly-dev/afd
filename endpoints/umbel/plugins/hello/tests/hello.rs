//! The hello plugin through the test kit: the SDK's `Outcome` is AFD's wire format, and
//! `hello-greet` answers with the default pack's salutation.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use afd::CommandResult;
use serde_json::{Value, json};
use umbel::plugins::sdk;
use umbel::testkit::TestHost;
use umbel_plugin_hello::{Hello, plugin};
use umbel_sdk::{CallContext, Cx, Outcome, Plugin};

fn config(pairs: &[(&str, &str)]) -> toml::Table {
    pairs
        .iter()
        .map(|(key, value)| ((*key).to_owned(), toml::Value::from(*value)))
        .collect()
}

#[test]
fn the_sdks_outcome_equals_afds_wire_format() {
    // Through the plugin's own entry point, with no host services: the failure path.
    let mut cx = Cx::without_grants(CallContext::default());
    let outcome: Outcome = Hello.handle("hello-greet", json!({}), &mut cx);
    assert!(!outcome.is_success(), "no grants, so no pack to read");
    let result: CommandResult<Value> = serde_json::from_value(outcome.as_value().clone()).unwrap();
    assert_eq!(serde_json::to_value(&result).unwrap(), *outcome.as_value());
    let error = result.error.unwrap();
    assert_eq!(error.code, "HELLO_UNAVAILABLE");
    assert!(!error.suggestion.unwrap().is_empty());
}

#[tokio::test]
async fn hello_greet_uses_the_default_pack_the_name_and_the_clock() {
    let host = TestHost::compiled(sdk(plugin())).boot().unwrap();
    let result = host.call("hello-greet", json!({"name": "Ada"})).await;
    assert!(result.success, "{result:?}");
    let data = result.data.unwrap();
    assert_eq!(data["greeting"], "Hello, Ada!");
    assert_eq!(data["space"], "main");
    assert_eq!(data["at"], "2026-01-01T00:00:00.000Z");

    // No name: the instance's default_name, whose schema default is "world".
    let world = host.call("hello-greet", json!({})).await.data.unwrap();
    assert_eq!(world["greeting"], "Hello, world!");
}

#[tokio::test]
async fn hello_greet_reads_default_name_from_the_instance_configuration() {
    let host = TestHost::compiled(sdk(plugin()))
        .config(config(&[("default_name", "team")]))
        .boot()
        .unwrap();
    let data = host.call("hello-greet", json!({})).await.data.unwrap();
    assert_eq!(data["greeting"], "Hello, team!");
}

#[tokio::test]
async fn a_configuration_the_schema_refuses_fails_the_load() {
    let error = TestHost::compiled(sdk(plugin()))
        .config(config(&[("unknown_key", "x")]))
        .boot()
        .err()
        .unwrap();
    assert_eq!(error.code(), "PLUGIN_CONFIG_INVALID");
    assert!(error.message().contains("hello"), "{error}");
}

#[tokio::test]
async fn the_manifest_the_plugin_embeds_validates() {
    let manifest =
        umbel::plugins::Manifest::parse(umbel_plugin_hello::COMPILED_MANIFEST, "hello").unwrap();
    assert_eq!(manifest.plugin.id, "hello");
    assert_eq!(manifest.commands.len(), 1);
    assert!(manifest.commands[0].first_class);
}

#[tokio::test]
async fn a_space_override_of_the_pack_changes_the_salutation_in_that_space_only() {
    let pack = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/casual");
    let host = TestHost::compiled(sdk(plugin()))
        .spaces(&["main", "casual"])
        .pack_override("casual", "greetings", &pack)
        .boot()
        .unwrap();
    let main = host
        .call("hello-greet", json!({"name": "Ada", "space": "main"}))
        .await;
    assert_eq!(main.data.unwrap()["greeting"], "Hello, Ada!");
    let casual = host
        .call("hello-greet", json!({"name": "Ada", "space": "casual"}))
        .await;
    assert_eq!(casual.data.unwrap()["greeting"], "Hey, Ada!");
}
