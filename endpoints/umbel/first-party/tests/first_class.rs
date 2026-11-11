//! The first-party plugins' first-class suggestions together (Component Briefs step C3; phase 1
//! specification, section 8.4, D45): with all six enabled and no `mcp.first_class_tools`, the set
//! is the two built-ins and five suggestions, `components-brief` among them, under the cap of
//! eight, in the host and in the shipped binary's `tools/list`. Every plugin's skill is listed
//! beside the others, `components-guide` among them.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::Ws;
use support::binary::Bin;
use umbel::testkit::mcp::Client;

const ENABLED: [&str; 6] = [
    "sources",
    "knowledge",
    "memory",
    "context",
    "components",
    "curator",
];

/// The two built-ins, then each plugin's suggestions in `plugins.enabled` and manifest order.
const FIRST_CLASS: [&str; 7] = [
    "workspace-show",
    "event-list",
    "knowledge-search",
    "knowledge-open",
    "memory-remember",
    "context-bundle",
    "components-brief",
];

fn config() -> String {
    format!(
        r#"config_version = 4
default_space = "alpha"

[principal]
local_id = "ada"
on_behalf_of = "ada"

[spaces.alpha]
[spaces.alpha.collections.notes]
root = "spaces/alpha/notes"

[plugins]
enabled = {enabled:?}

[plugins.sources]
source = "compiled:sources"
[plugins.sources.grants.documents_write]
allow = ["alpha/*"]
[plugins.sources.grants.records_write]
allow = ["alpha"]

[plugins.knowledge]
source = "compiled:knowledge"
[plugins.knowledge.grants.index_write]
allow = ["alpha"]
[plugins.knowledge.grants.graph_write]
allow = ["alpha"]
[plugins.knowledge.grants.records_write]
allow = ["alpha"]
[plugins.knowledge.grants.documents_write]
allow = ["alpha/*"]
[plugins.knowledge.grants.content_write]
allow = ["alpha/*"]

[plugins.knowledge.config.areas.notes]
space = "alpha"
collection = "notes"

[plugins.knowledge.config.drafters.curator.targets.alpha]
collection = "notes"
prefix = "learned"

[plugins.memory]
source = "compiled:memory"
[plugins.memory.grants.memory_write]
allow = ["alpha"]

[plugins.context]
source = "compiled:context"

[plugins.components]
source = "compiled:components"

[plugins.curator]
source = "compiled:curator"
[plugins.curator.grants.records_write]
allow = ["alpha"]

[plugins.curator.config.spaces.alpha]
collection = "notes"
prefix = "learned"
"#,
        enabled = ENABLED,
    )
}

async fn doctor_check(ws: &Ws, id: &str) -> Value {
    let report = ws
        .call(support::human("ada"), "workspace-doctor", json!({}))
        .await;
    report["data"]["checks"]
        .as_array()
        .unwrap_or_else(|| panic!("{report}"))
        .iter()
        .find(|check| check["id"] == id)
        .unwrap()
        .clone()
}

#[tokio::test]
async fn the_six_plugins_suggest_five_first_class_tools_under_the_cap() {
    let ws = Ws::with_config(&config(), &["spaces/alpha/notes"]);
    assert_eq!(ws.host().first_class_tools(), FIRST_CLASS);
    let check = doctor_check(&ws, "plugins.first_class").await;
    assert_eq!(check["status"], "pass", "{check}");
    assert!(
        check["message"]
            .as_str()
            .unwrap()
            .starts_with("5 plugin suggestion(s) fit"),
        "{check}"
    );

    for mut client in Client::lanes(ws.host()).await {
        let lane = client.label();
        let listed = client.tool_names().await;
        for name in FIRST_CLASS {
            assert!(listed.contains(&name.to_owned()), "{lane}: {listed:?}");
        }
        assert!(!listed.contains(&"components-list".to_owned()), "{lane}");

        // Every plugin's skill, in `plugins.enabled` order.
        let skills = client.request("skills/list", json!({})).await;
        let names: Vec<_> = skills["result"]["skills"]
            .as_array()
            .unwrap()
            .iter()
            .map(|skill| skill["frontmatter"]["name"].as_str().unwrap().to_owned())
            .collect();
        assert_eq!(
            names,
            [
                "sources-guide",
                "knowledge-guide",
                "memory-guide",
                "context-guide",
                "components-guide",
                "curator-guide",
            ],
            "{lane}"
        );
    }
    let check = doctor_check(&ws, "plugins.skills").await;
    assert_eq!(check["status"], "pass", "{check}");
}

#[test]
fn the_binary_lists_the_five_suggestions() {
    let root = tempfile::tempdir().unwrap();
    let bin = Bin::new(root.path(), &config(), support::CLOCK);
    std::fs::create_dir_all(bin.ws.join("spaces/alpha/notes")).unwrap();
    let listed = bin.mcp().tool_names();
    for name in FIRST_CLASS {
        assert!(listed.contains(&name.to_owned()), "{listed:?}");
    }
    let brief = bin
        .mcp()
        .call("components-brief", &json!({ "tags": ["example-select"] }));
    assert_eq!(brief["success"], true, "{brief}");
}
