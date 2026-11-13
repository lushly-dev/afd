//! The paragraph for the server's instructions (specification, section 11.2): the README holds
//! it twice, as the text a deployer reads and inside the instance's `mcp.instructions`, and both
//! equal the specification's. A deployer's text replaces AFD's default whole, so the paragraph
//! starts with the default's sentences for the hybrid strategy, read here from a host with no
//! `mcp.instructions`. `ideas-guide`'s `start` is the rest of the paragraph, and none of it tells
//! an agent to call `ideas-guide` first (phase 0.10).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::json;
use support::{Fx, data};
use umbel::testkit::mcp::Stdio;

const README: &str = include_str!("../README.md");
const SPEC: &str = include_str!("../../../docs/plugins/ideas/spec.md");

/// The first blockquote after `heading`, its lines joined by spaces.
fn quoted_after(text: &str, heading: &str) -> String {
    let (_, rest) = text
        .split_once(heading)
        .unwrap_or_else(|| panic!("no {heading}"));
    rest.lines()
        .skip_while(|line| !line.starts_with('>'))
        .take_while(|line| line.starts_with('>'))
        .map(|line| line.trim_start_matches('>').trim())
        .collect::<Vec<_>>()
        .join(" ")
}

/// The README's instance: its first TOML block after "## A local instance".
fn readme_instance() -> toml::Table {
    let (_, rest) = README.split_once("## A local instance").unwrap();
    let (_, rest) = rest.split_once("```toml\n").unwrap();
    let (block, _) = rest.split_once("```").unwrap();
    block.parse().unwrap()
}

/// AFD's default instructions, as `initialize` answers them on a workspace with none set.
async fn afd_default() -> String {
    let fx = Fx::new();
    let mut stdio = Stdio::connect_modern(&fx.host);
    let initialize = stdio
        .request(
            "initialize",
            json!({
                "protocolVersion": "2025-11-25",
                "capabilities": {},
                "clientInfo": { "name": "test", "version": "0" },
            }),
        )
        .await;
    initialize["result"]["instructions"]
        .as_str()
        .unwrap_or_else(|| panic!("{initialize}"))
        .to_owned()
}

#[tokio::test]
async fn the_paragraph_starts_with_afds_default_for_the_hybrid_strategy() {
    let paragraph = quoted_after(SPEC, "### 11.2 The paragraph for the server's instructions");
    assert_eq!(
        quoted_after(README, "### The paragraph for the server's instructions"),
        paragraph,
        "the README's paragraph is the specification's"
    );
    let instance = readme_instance();
    assert_eq!(
        instance["mcp"]["instructions"].as_str().unwrap(),
        paragraph,
        "the README's instance pastes the paragraph into mcp.instructions"
    );

    // The default's sentences for the hybrid strategy: up to the sentence on batches and pipes.
    let default = afd_default().await;
    let end = "afd-pipe to chain them.";
    let head = &default[..default.find(end).unwrap() + end.len()];
    // The default names the server by its workspace's name; the paragraph names it Umbel.
    let (name, _) = head.split_once(" is an AFD server.").unwrap();
    let head = &format!("Umbel{}", &head[name.len()..]);
    assert!(
        head.contains("The command tools listed are the common ones."),
        "the hybrid strategy: {default}"
    );
    assert!(paragraph.starts_with(head), "{paragraph}\n\n{head}");

    // `ideas-guide`'s start is the rest, then how to review.
    let guide = Fx::new().agent("ideas-guide", json!({})).await;
    let start = data(&guide)["start"].as_str().unwrap().to_owned();
    let rest = paragraph[head.len()..].trim_start();
    assert!(start.starts_with(rest), "{start}");

    // Nothing sends an agent to the guide before each request.
    for text in [paragraph.as_str(), start.as_str()] {
        assert!(!text.contains("ideas-guide first"), "{text}");
        assert!(!text.contains("Call ideas-guide"), "{text}");
    }
}

#[test]
fn the_readme_instance_has_section_11_4s_settings() {
    let instance = readme_instance();
    let space = instance["default_space"].as_str().unwrap();
    let person = instance["principal"]["on_behalf_of"].as_str().unwrap();
    assert_eq!(
        instance["spaces"][space]["person"].as_str().unwrap(),
        format!("human:{person}")
    );
    assert!(instance["spaces"][space].get("verified_levels").is_none());
    let grant = &instance["plugins"]["ideas"]["grants"]["records_write"];
    assert_eq!(grant["default_access"].as_str(), Some("space"));
    assert_eq!(grant["allow"][0].as_str(), Some(space));
    assert_eq!(instance["person"]["local"]["enabled"].as_bool(), Some(true));
    assert_eq!(
        instance["person"]["decision_ttl_s"].as_integer(),
        Some(3600)
    );
    let first_class: Vec<&str> = instance["mcp"]["first_class_tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| tool.as_str().unwrap())
        .collect();
    assert_eq!(
        first_class[..3],
        ["ideas-capture", "ideas-ask", "ideas-guide"]
    );
    assert!(first_class.contains(&"memory-remember"), "phase 0.10");
}
