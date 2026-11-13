//! The surfaces (specification, sections 7 and 11): the three first-class suggestions in
//! `tools/list`, on every lane; the preview, export and import off MCP; and the `ideas-guide`
//! skill served.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::{Actor, ActorKind, CommandInterface};
use serde_json::json;
use support::{Fx, data};
use umbel::testkit::mcp::Client;

const SKILL_URI: &str = "skill://ideas-guide/SKILL.md";

/// `TestHost` writes a version 2 configuration, which cannot allow a write grant, so the
/// tests' own workspace is used.
fn host() -> Fx {
    Fx::new()
}

#[tokio::test]
async fn three_first_class_suggestions_and_three_commands_off_mcp() {
    let host = host();
    assert_eq!(
        host.host.first_class_tools(),
        [
            "workspace-show",
            "event-list",
            "ideas-capture",
            "ideas-ask",
            "ideas-guide"
        ]
    );
    for mut client in Client::lanes(&host.host).await {
        let lane = client.label();
        let listed = client.tool_names().await;
        for name in ["ideas-capture", "ideas-ask", "ideas-guide"] {
            assert!(listed.contains(&name.to_owned()), "{lane}: {listed:?}");
        }
        for name in [
            "ideas-match",
            "ideas-find",
            "ideas-open",
            "ideas-review-stage",
        ] {
            assert!(!listed.contains(&name.to_owned()), "{lane}: {listed:?}");
        }
        // Off MCP altogether: not listed, and refused by name.
        for (name, input) in [
            (
                "ideas-review-preview",
                json!({ "review": "rev-1", "part": "*", "digest": "sha256:0" }),
            ),
            ("ideas-export", json!({})),
            ("ideas-import", json!({ "items": [{}] })),
        ] {
            let result = client.afd_call(name, input).await;
            assert_eq!(result["success"], false, "{lane} {name}: {result}");
            // Over MCP a command that is not exposed there does not exist.
            assert_eq!(
                result["error"]["code"], "COMMAND_NOT_FOUND",
                "{lane} {name}: {result}"
            );
        }
    }
    let definitions = host.host.registry();
    for name in ["ideas-review-preview", "ideas-export", "ideas-import"] {
        let definition = definitions.get(name).unwrap();
        assert!(
            !definition.expose.mcp && !definition.expose.agent && definition.expose.cli,
            "{name}"
        );
    }
    // No agent may confirm a review for the person (D86).
    let apply = definitions.get("ideas-review-apply").unwrap();
    assert!(!apply.expose.agent && apply.expose.cli);
}

#[tokio::test]
async fn the_skill_is_served() {
    let host = host();
    let bytes = std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("skills/ideas-guide/SKILL.md"),
    )
    .unwrap();
    let listed = host
        .call(
            Actor::new(ActorKind::Human).with_id("ada"),
            CommandInterface::Cli,
            "skill-list",
            json!({}),
        )
        .await;
    let skills = data(&listed)["skills"].as_array().unwrap();
    assert_eq!(skills.len(), 1);
    assert_eq!(skills[0]["name"], "ideas-guide");
    assert_eq!(skills[0]["uri"], SKILL_URI);
    for mut client in Client::lanes(&host.host).await {
        let lane = client.label();
        let read = client
            .request("resources/read", json!({ "uri": SKILL_URI }))
            .await;
        assert_eq!(
            read["result"]["contents"][0]["text"]
                .as_str()
                .unwrap()
                .as_bytes(),
            bytes.as_slice(),
            "{lane}"
        );
    }
    let text = String::from_utf8(bytes).unwrap();
    assert!(text.lines().count() < 80, "section 11.3: under 80 lines");
    let manifest = include_str!("../umbel-plugin.toml");
    for word in text.split(|c: char| !(c.is_ascii_alphanumeric() || c == '-')) {
        if word.starts_with("ideas-") && word != "ideas-guide" {
            assert!(
                manifest.contains(&format!("name = \"{word}\"")),
                "the skill names `{word}`, which the manifest does not declare"
            );
        }
    }
}

#[test]
fn the_skill_reviews_in_bulk_on_the_page_and_does_not_send_the_agent_to_the_guide_first() {
    // Section 11.3, and phase 0.10: an agent told to call the guide first called it before
    // every request.
    let text = include_str!("../skills/ideas-guide/SKILL.md");
    for needed in [
        "part `\"*\"`",
        "one link",
        "Never ask them to confirm decisions",
        "uncheck what they disagree with",
        "Send the same call again",
        "not before every request",
        "stage an `undo`",
    ] {
        assert!(text.contains(needed), "the skill lacks: {needed}");
    }
    for refused in [
        "ideas-guide first",
        "Call `ideas-guide` before",
        "Start with `ideas-guide`",
    ] {
        assert!(!text.contains(refused), "the skill says: {refused}");
    }
}
