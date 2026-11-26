//! The paragraph for the server's instructions (specification, section 11.2): the manifest
//! declares it as `instructions` (manifest version 7), and the host adds it after AFD's default
//! (Umbel's phase 1 specification, section 8.7), so the README's instance sets no
//! `mcp.instructions`. The manifest's paragraph equals the specification's and the README's, a host
//! serves it after AFD's default for the hybrid strategy, `ideas-guide`'s `start` begins with it,
//! and none of it tells an agent to call `ideas-guide` first (phase 0.10).
use crate::support;
use serde_json::json;
use support::{Fx, data};
use umbel::testkit::mcp::Stdio;

const README: &str = include_str!("../../README.md");
const SPEC: &str = include_str!("../../../../docs/plugins/ideas/spec.md");

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

/// The server's instructions, as `initialize` answers them over stdio on `fx`'s host.
async fn initialize_instructions(fx: &Fx) -> String {
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
async fn the_manifest_paragraph_follows_afds_default_for_the_hybrid_strategy() {
    let paragraph = quoted_after(SPEC, "### 11.2 The paragraph for the server's instructions");
    let manifest: toml::Table = umbel_plugin_ideas::MANIFEST.parse().unwrap();
    assert_eq!(manifest["manifest_version"].as_integer(), Some(7));
    assert_eq!(
        manifest["instructions"].as_str().unwrap(),
        paragraph,
        "the manifest's paragraph is the specification's"
    );
    assert_eq!(
        quoted_after(README, "### The paragraph for the server's instructions"),
        paragraph,
        "the README's paragraph is the specification's"
    );
    let instance = readme_instance();
    assert!(
        instance["mcp"].get("instructions").is_none(),
        "the README's instance leaves the text to the host"
    );

    // AFD's default for the hybrid strategy, read from a host with no plugin enabled (the
    // plugin contributes no context, so its sentence is not in either), then the paragraph.
    let bare = Fx::with("config_version = 6\ndefault_space = \"main\"\n\n[spaces.main]\n");
    let default = initialize_instructions(&bare).await;
    assert!(
        default.contains("The command tools listed are the common ones."),
        "the hybrid strategy: {default}"
    );
    let served = initialize_instructions(&Fx::new()).await;
    assert_eq!(served, format!("{default}\n\n{paragraph}"));

    // `ideas-guide`'s start is the paragraph, then how to review.
    let guide = Fx::new().agent("ideas-guide", json!({})).await;
    let start = data(&guide)["start"].as_str().unwrap().to_owned();
    assert!(start.starts_with(&format!("{paragraph}\n")), "{start}");

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
