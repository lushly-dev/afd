//! First-class suggestions (phase 1 specification, section 8.4, D45): manifests suggest, the
//! deployer's list always wins. With no `mcp.first_class_tools`, the default set is
//! `workspace-show`, `event-list`, then every suggestion in `plugins.enabled` order and manifest
//! order, up to the cap of 8.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::mcp::{Client, Era, Transport};
use support::plugins::{Raw, closure, config, seal};
use support::{agent, call};

/// One command of a suggesting plugin.
struct Cmd {
    name: &'static str,
    first_class: bool,
    mcp: bool,
}

const fn cmd(name: &'static str, first_class: bool) -> Cmd {
    Cmd {
        name,
        first_class,
        mcp: true,
    }
}

/// A raw plugin `id` with the commands `commands`; each answers `{}`.
fn suggesting(id: &str, commands: &[Cmd]) -> Raw {
    let mut manifest = format!(
        r#"manifest_version = 1
protocol = 1

[plugin]
id = "{id}"
title = "{id}"
version = "1.0.0"
description = "Suggests first-class tools."
kind = "compiled"
domains = ["{id}"]
"#
    );
    for command in commands {
        manifest.push_str(&format!(
            r#"
[[commands]]
name = "{}"
description = "A command."
effects = ["inspect"]
input_schema = {{ type = "object", properties = {{}}, additionalProperties = false }}
first_class = {}
expose = {{ mcp = {}, agent = true, cli = true }}
"#,
            command.name, command.first_class, command.mcp
        ));
    }
    let names: Vec<&'static str> = commands.iter().map(|command| command.name).collect();
    Raw::new(manifest, move |_| {
        Ok(names
            .iter()
            .map(|name| closure(name, |_, _| afd::success(json!({}))))
            .collect())
    })
}

fn names(host: &umbel::Host) -> Vec<String> {
    host.first_class_tools().to_vec()
}

async fn doctor_check(host: &umbel::Host, id: &str) -> Value {
    let report = call(host, agent("a"), "workspace-doctor", json!({})).await;
    report.data.unwrap()["checks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|check| check["id"] == id)
        .unwrap()
        .clone()
}

#[tokio::test]
async fn suggestions_follow_the_built_ins_in_instance_and_manifest_order() {
    // `beta` is enabled first, so its suggestions come first.
    let dir = support::workspace(&config(&[("beta", ""), ("alpha", "")], ""));
    let host = seal(dir.path(), |b| {
        b.with_compiled(suggesting(
            "alpha",
            &[
                cmd("alpha-one", true),
                cmd("alpha-quiet", false),
                cmd("alpha-two", true),
            ],
        ))
        .with_compiled(suggesting(
            "beta",
            &[cmd("beta-quiet", false), cmd("beta-one", true)],
        ))
    })
    .unwrap();
    let expected = [
        "workspace-show",
        "event-list",
        "beta-one",
        "alpha-one",
        "alpha-two",
    ];
    assert_eq!(names(&host), expected);

    // The set is what workspace-show reports and what every lane lists as tools.
    let shown = call(&host, agent("a"), "workspace-show", json!({})).await;
    assert_eq!(
        shown.data.unwrap()["surfaces"]["firstClassTools"],
        json!(expected)
    );
    for mut client in Client::lanes(&host).await {
        let listed = client.tool_names().await;
        for name in expected {
            assert!(
                listed.contains(&name.to_owned()),
                "{}: {listed:?}",
                client.label()
            );
        }
        assert!(!listed.contains(&"alpha-quiet".to_owned()));
        let result = client.call("alpha-two", json!({})).await;
        assert_eq!(result["success"], true, "{}: {result}", client.label());
    }
    let check = doctor_check(&host, "plugins.first_class").await;
    assert_eq!(check["status"], "pass", "{check}");
}

#[tokio::test]
async fn no_plugin_leaves_the_two_built_ins() {
    let dir = support::workspace(&config(&[], ""));
    let host = seal(dir.path(), |b| b).unwrap();
    assert_eq!(names(&host), ["workspace-show", "event-list"]);
    let check = doctor_check(&host, "plugins.first_class").await;
    assert_eq!(check["status"], "pass", "{check}");
}

#[tokio::test]
async fn the_set_stops_at_the_cap_of_eight_and_the_doctor_names_what_was_dropped() {
    let dir = support::workspace(&config(&[("many", "")], ""));
    let commands = [
        cmd("many-a", true),
        cmd("many-b", true),
        cmd("many-c", true),
        cmd("many-d", true),
        cmd("many-e", true),
        cmd("many-f", true),
        cmd("many-g", true),
        cmd("many-h", true),
    ];
    let host = seal(dir.path(), |b| {
        b.with_compiled(suggesting("many", &commands))
    })
    .unwrap();
    // Two built-ins and six of the eight suggestions.
    assert_eq!(
        names(&host),
        [
            "workspace-show",
            "event-list",
            "many-a",
            "many-b",
            "many-c",
            "many-d",
            "many-e",
            "many-f",
        ]
    );
    let check = doctor_check(&host, "plugins.first_class").await;
    assert_eq!(check["status"], "warn", "{check}");
    let message = check["message"].as_str().unwrap();
    assert!(message.contains("many-g, many-h"), "{message}");
    assert!(!message.contains("many-f"), "{message}");
    assert!(
        check["suggestion"]
            .as_str()
            .unwrap()
            .contains("mcp.first_class_tools")
    );
    // The two commands past the cap are still callable by name (H7), just not listed.
    let mut client = Client::connect(&host, Transport::Stdio, Era::Modern).await;
    assert!(!client.tool_names().await.contains(&"many-g".to_owned()));
    assert_eq!(client.call("many-g", json!({})).await["success"], true);
}

#[tokio::test]
async fn the_deployers_list_always_wins() {
    let dir = support::workspace(&config(
        &[("alpha", "")],
        "\n[mcp]\nfirst_class_tools = [\"workspace-show\", \"alpha-two\"]\n",
    ));
    let host = seal(dir.path(), |b| {
        b.with_compiled(suggesting(
            "alpha",
            &[cmd("alpha-one", true), cmd("alpha-two", false)],
        ))
    })
    .unwrap();
    assert_eq!(names(&host), ["workspace-show", "alpha-two"]);
    let check = doctor_check(&host, "plugins.first_class").await;
    assert_eq!(check["status"], "pass", "{check}");
    let message = check["message"].as_str().unwrap();
    assert!(message.contains("wins"), "{message}");
    assert!(message.contains("alpha-one"), "{message}");
}

#[tokio::test]
async fn a_command_that_mcp_does_not_expose_is_never_suggested() {
    let dir = support::workspace(&config(&[("alpha", "")], ""));
    let host = seal(dir.path(), |b| {
        b.with_compiled(suggesting(
            "alpha",
            &[
                Cmd {
                    name: "alpha-cli",
                    first_class: true,
                    mcp: false,
                },
                cmd("alpha-mcp", true),
            ],
        ))
    })
    .unwrap();
    assert_eq!(names(&host), ["workspace-show", "event-list", "alpha-mcp"]);
}

#[tokio::test]
async fn hello_suggests_hello_greet() {
    let dir = support::workspace(&config(&[("hello", "")], ""));
    let host = seal(dir.path(), |b| {
        b.with_compiled(umbel::plugins::sdk(umbel_plugin_hello::plugin()))
    })
    .unwrap();
    assert_eq!(
        names(&host),
        ["workspace-show", "event-list", "hello-greet"]
    );
}
