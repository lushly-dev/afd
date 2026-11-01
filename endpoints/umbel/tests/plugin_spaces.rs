//! Per-space enablement (phase 1 specification, sections 6 step 5, 8.1 and 9.1, D44): `spaces`
//! limits calls and grants, a plugin with a space-less command must include the default space,
//! and mutations project into the resolved space.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::json;
use support::plugins::{Probe, config, seal};
use support::{agent, call, events};
use umbel::plugins::sdk;

#[tokio::test]
async fn spaces_limit_calls_with_plugin_not_enabled() {
    let dir = support::workspace(&config(&[("probe", "spaces = [\"main\"]")], ""));
    let host = seal(dir.path(), |b| b.with_compiled(sdk(Probe::new(&[])))).unwrap();

    let allowed = call(&host, agent("a"), "probe-note", json!({"space": "main"})).await;
    assert!(allowed.success, "{allowed:?}");

    let refused = call(&host, agent("a"), "probe-note", json!({"space": "second"})).await;
    assert!(!refused.success);
    let error = refused.error.as_ref().unwrap();
    assert_eq!(error.code, "PLUGIN_NOT_ENABLED");
    assert!(error.message.contains("second"), "{error:?}");
    assert!(
        error
            .suggestion
            .as_deref()
            .unwrap()
            .contains("plugins.probe.spaces")
    );
    // Nothing ran: no event in `second`.
    assert!(events(dir.path(), "second").is_empty());

    // A space the workspace does not declare is the space check's refusal, before the gate.
    let unknown = call(&host, agent("a"), "probe-note", json!({"space": "nowhere"})).await;
    assert_eq!(unknown.error.as_ref().unwrap().code, "SPACE_NOT_FOUND");
}

#[test]
fn a_plugin_with_a_space_less_command_must_include_the_default_space() {
    let dir = support::workspace(&config(&[("probe", "spaces = [\"second\"]")], ""));
    let error = seal(dir.path(), |b| b.with_compiled(sdk(Probe::new(&[]))))
        .err()
        .unwrap();
    assert_eq!(error.code(), "PLUGIN_CONFIG_INVALID");
    assert!(error.message().contains("spaces"), "{error}");
    assert!(error.message().contains("main"), "{error}");
    assert!(error.message().contains("probe-grants"), "{error}");
}

#[tokio::test]
async fn a_plugin_whose_commands_all_take_a_space_may_leave_the_default_out() {
    // Only commands with a `space` input: one probe manifest with the space-less commands removed.
    let manifest = r#"manifest_version = 1
protocol = 1
[plugin]
id = "probe"
title = "Probe"
version = "0.3.0"
description = "d"
kind = "compiled"
domains = ["probe"]
[[commands]]
name = "probe-note"
description = "Record a note, in a space."
effects = ["plugin-state"]
input_schema = { type = "object", properties = { space = { type = "string" }, text = { type = "string" } }, additionalProperties = false }
"#;
    let dir = support::workspace(&config(&[("probe", "spaces = [\"second\"]")], ""));
    let host = seal(dir.path(), |b| {
        b.with_compiled(sdk(Probe::with_manifest(manifest.to_owned())))
    })
    .unwrap();
    let noted = call(&host, agent("a"), "probe-note", json!({"space": "second"})).await;
    assert!(noted.success, "{noted:?}");
    // The default space is not one of the instance's: a call without `space` is refused.
    let refused = call(&host, agent("a"), "probe-note", json!({})).await;
    assert_eq!(refused.error.as_ref().unwrap().code, "PLUGIN_NOT_ENABLED");
}

#[tokio::test]
async fn mutations_project_into_the_resolved_space() {
    let dir = support::workspace(&config(&[("probe", "")], ""));
    let host = seal(dir.path(), |b| b.with_compiled(sdk(Probe::new(&[])))).unwrap();

    let in_second = call(
        &host,
        agent("a"),
        "probe-note",
        json!({"space": "second", "text": "s"}),
    )
    .await;
    assert!(in_second.success);
    let by_default = call(&host, agent("a"), "probe-note", json!({"text": "d"})).await;
    assert!(by_default.success);
    let spaceless = call(&host, agent("a"), "probe-forge", json!({})).await;
    assert!(spaceless.success);

    let second = events(dir.path(), "second");
    assert_eq!(second.len(), 1, "{second:?}");
    assert_eq!(second[0]["record"]["id"], "s");
    let main = events(dir.path(), "main");
    assert_eq!(main.len(), 2, "{main:?}");
    assert_eq!(main[0]["record"]["id"], "d");
    // The space-less mutation landed in the default space, whatever the plugin forged.
    assert_eq!(main[1]["space"], "main");
}
