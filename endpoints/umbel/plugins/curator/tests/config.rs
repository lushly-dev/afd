//! The curator's configuration, pack and manifest (phase 4 specification, sections 4.5, 8.5, 10.3,
//! 11.1 and 11.3): a target per space, checked against the workspace (unconfigured, missing, not
//! markdown, a collection the caller cannot read reported as missing, and the instance refused
//! when the `documents` grant that carries the collection metadata is denied) and refused at load
//! when its prefix is unsafe;
//! the settle pack per space; a configured model refused; a caller with no principal refused; the
//! grants (memory read only, no write to memory or knowledge); every command CLI only and
//! digest-journaled with `keep = ["space"]`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::{Actor, ActorKind};
use serde_json::json;
use support::*;

const TARGET: &str =
    "[plugins.curator.config.spaces.main]\ncollection = \"notes\"\nprefix = \"learned\"\n";

#[tokio::test]
async fn a_space_needs_a_markdown_collection_as_its_target() {
    let mut fx = Fx::new();
    fx.remember_twice(fact(1, "human:ada", &["space"], "Shared", "Text."), 2);
    fx.at(day(8));
    assert_eq!(fx.rows().await.len(), 1);
    // beta has no target.
    let beta = fx
        .candidates_as(human("local"), json!({ "space": "beta" }))
        .await;
    assert_eq!(code(&beta), "CURATOR_TARGET_UNCONFIGURED");
    assert_eq!(beta["error"]["details"]["reason"], "unconfigured");
    for (collection, reason) in [("nowhere", "collection-missing"), ("code", "not-markdown")] {
        fx.reconfigure(&config_with(
            &TARGET.replace("\"notes\"", &format!("\"{collection}\"")),
            "",
        ));
        let refused = fx.candidates().await;
        assert_eq!(
            code(&refused),
            "CURATOR_TARGET_UNCONFIGURED",
            "{collection}"
        );
        assert_eq!(refused["error"]["details"]["reason"], reason);
    }
    // A collection the caller cannot read is missing to them, the same answer: nothing of its
    // readers or sensitivity is shown. Its readers can still use it as their target.
    let adas = "[spaces.main.collections.adas]\nroot = \"spaces/main/adas\"\naccess = [\"principal:human:ada\"]\n";
    std::fs::create_dir_all(fx.path("spaces/main/adas")).unwrap();
    fx.reconfigure(&config_with(&TARGET.replace("\"notes\"", "\"adas\""), adas));
    let refused = fx.candidates().await;
    assert_eq!(code(&refused), "CURATOR_TARGET_UNCONFIGURED");
    assert_eq!(refused["error"]["details"]["reason"], "collection-missing");
    never_mentions(&refused.to_string(), &["principal:human:ada", "adas"]);
    let ada = fx.candidates_as(human("ada"), json!({})).await;
    assert_eq!(
        data(&ada)["target"],
        json!({ "collection": "adas", "prefix": "learned", "access": ["principal:human:ada"], "sensitivity": "internal" })
    );
    // Without a prefix, drafts go straight into the collection.
    fx.reconfigure(&config_with(
        "[plugins.curator.config.spaces.main]\ncollection = \"notes\"\n",
        "",
    ));
    let row = fx.only().await;
    assert_eq!(
        row["doc"],
        format!(
            "notes/{}",
            umbel_okf::draft::candidate_id("main", "human:local", &mem(1))
        )
    );
    assert_eq!(
        data(&fx.candidates().await)["target"],
        json!({ "collection": "notes", "prefix": null, "access": ["space"], "sensitivity": "internal" })
    );
}

#[test]
fn an_unsafe_target_prefix_is_refused_when_the_configuration_loads() {
    for prefix in [
        "../escape",
        "learned/",
        "/learned",
        "learned/.hidden",
        "Learned",
        "learned//x",
        "a/b/c/d/e/f/g/h/i",
    ] {
        let dir = tempfile::tempdir().unwrap();
        let config = config_with(
            &TARGET.replace(
                "prefix = \"learned\"",
                &format!("prefix = {}", serde_json::to_string(prefix).unwrap()),
            ),
            "",
        );
        std::fs::write(dir.path().join("umbel.toml"), config).unwrap();
        let sealed = umbel::HostBuilder::open(dir.path())
            .unwrap()
            .with_compiled(std::sync::Arc::new(umbel::plugins::sdk(
                umbel_plugin_curator::plugin(),
            )))
            .seal();
        let error = sealed
            .err()
            .map(|error| error.to_string())
            .unwrap_or_default();
        assert!(error.contains("PLUGIN_CONFIG_INVALID"), "{prefix}: {error}");
    }
}

#[test]
fn denying_the_grant_that_carries_the_collection_metadata_fails_closed() {
    // `documents` is required: denied, the instance does not load, so no command can run on a
    // guess at the target's readers. (The handler's own answer to a withheld service,
    // `collection-unknown`, is the crate's unit test.)
    let dir = tempfile::tempdir().unwrap();
    let config = config("").replace(
        "source = \"compiled:curator\"",
        "source = \"compiled:curator\"\ndeny = [\"documents\"]",
    );
    std::fs::write(dir.path().join("umbel.toml"), config).unwrap();
    let sealed = umbel::HostBuilder::open(dir.path())
        .unwrap()
        .with_compiled(std::sync::Arc::new(umbel::plugins::sdk(
            umbel_plugin_curator::plugin(),
        )))
        .seal();
    let error = sealed
        .err()
        .map(|error| error.to_string())
        .unwrap_or_default();
    assert!(
        error.contains("PLUGIN_GRANT_DENIED") && error.contains("documents"),
        "{error}"
    );
}

#[tokio::test]
async fn a_configured_model_is_refused_by_every_command() {
    let mut fx = Fx::with(&config(
        "[plugins.curator.config.model]\ncommand = \"a-local-model\"\n",
    ));
    fx.remember_twice(
        fact(
            1,
            "human:local",
            &["principal:human:local"],
            "Mine",
            "Text.",
        ),
        2,
    );
    fx.at(day(8));
    let refused = fx.candidates().await;
    assert_eq!(code(&refused), "CURATOR_MODEL_UNAVAILABLE");
    let hash = fx.record(&mem(1)).content_hash.as_str().to_owned();
    let candidate = umbel_okf::draft::candidate_id("main", "human:local", &mem(1));
    let (promote, asked) = fx
        .terminal(
            "curator-promote",
            json!({ "candidate": candidate, "contentHash": hash }),
            true,
        )
        .await;
    assert_eq!(code(&promote), "CURATOR_MODEL_UNAVAILABLE");
    assert_eq!(asked.len(), 1, "the host asks before the plugin refuses");
}

#[tokio::test]
async fn the_settle_pack_is_overridden_per_space_and_a_bad_one_refuses() {
    let mut fx = Fx::with(&config(
        "[plugins.curator.config.spaces.beta]\ncollection = \"notes\"\n",
    ));
    fx.remember_twice(fact(1, "human:ada", &["space"], "Shared", "Text."), 2);
    fx.at(day(4));
    assert_eq!(fx.only().await["status"], "settling");
    let dir = fx.path("spaces/main/packs/curator/settle");
    std::fs::create_dir_all(dir.join("data")).unwrap();
    std::fs::write(
        dir.join("pack.toml"),
        include_str!("../packs/settle/pack.toml"),
    )
    .unwrap();
    let shipped = include_str!("../packs/settle/data/settle.toml");
    std::fs::write(
        dir.join("data/settle.toml"),
        shipped.replace("semantic_days = 7", "semantic_days = 3"),
    )
    .unwrap();
    fx.at(day(4));
    assert_eq!(fx.only().await["status"], "ready");
    // beta keeps the shipped pack.
    let beta = fx
        .candidates_as(human("local"), json!({ "space": "beta" }))
        .await;
    assert_eq!(data(&beta)["counts"]["candidates"], 0);
    std::fs::write(dir.join("data/settle.toml"), "semantic_days = \"seven\"\n").unwrap();
    fx.at(day(4));
    let refused = fx.candidates().await;
    assert_eq!(code(&refused), "CURATOR_PACK_INVALID");
    std::fs::write(dir.join("data/settle.toml"), [0xff_u8, 0xfe]).unwrap();
    fx.at(day(4));
    assert_eq!(code(&fx.candidates().await), "CURATOR_PACK_INVALID");
}

#[tokio::test]
async fn a_caller_with_no_principal_has_no_candidates() {
    let fx = Fx::new();
    let anonymous = Actor::new(ActorKind::Human);
    let refused = fx.candidates_as(anonymous, json!({})).await;
    assert_eq!(code(&refused), "CURATOR_PRINCIPAL_UNKNOWN");
}

#[tokio::test]
async fn bad_input_is_refused_naming_the_rule() {
    let fx = Fx::new();
    for (input, rule) in [
        (json!({ "after": "c-zz" }), "after"),
        (json!({ "limit": 0 }), ""),
        (json!({ "status": ["nope"] }), ""),
        (json!({ "unknown": 1 }), ""),
    ] {
        let refused = fx.candidates_as(human("local"), input.clone()).await;
        assert_eq!(refused["success"], false, "{input}");
        assert!(
            refused["error"]["message"].as_str().unwrap().contains(rule),
            "{refused}"
        );
    }
}

#[test]
fn the_manifest_reads_memory_and_writes_only_its_own_records() {
    let manifest: toml::Value = toml::from_str(umbel_plugin_curator::MANIFEST).unwrap();
    assert_eq!(manifest["manifest_version"].as_integer(), Some(4));
    assert_eq!(manifest["plugin"]["id"].as_str(), Some("curator"));
    assert_eq!(manifest["plugin"]["kind"].as_str(), Some("compiled"));
    let grants: Vec<(String, bool)> = manifest["grants"]
        .as_array()
        .unwrap()
        .iter()
        .map(|g| {
            (
                g["name"].as_str().unwrap().to_owned(),
                g.get("required")
                    .and_then(toml::Value::as_bool)
                    .unwrap_or(true),
            )
        })
        .collect();
    let expected: Vec<(String, bool)> = [
        ("config", true),
        ("packs", true),
        ("clock", true),
        ("memory", true),
        ("documents", true),
        ("records", true),
        ("records_write", true),
    ]
    .into_iter()
    .map(|(name, required)| (name.to_owned(), required))
    .collect();
    assert_eq!(
        grants, expected,
        "no write grant to memory or knowledge (owner decision 8)"
    );
    for command in manifest["commands"].as_array().unwrap() {
        let name = command["name"].as_str().unwrap();
        let expose = &command["expose"];
        assert_eq!(
            (
                expose["mcp"].as_bool(),
                expose["agent"].as_bool(),
                expose["cli"].as_bool()
            ),
            (Some(false), Some(false), Some(true)),
            "{name}"
        );
        assert_eq!(
            command["journal"]["mode"].as_str(),
            Some("digest"),
            "{name}"
        );
        assert_eq!(
            command["journal"]["keep"].as_array().unwrap().len(),
            1,
            "{name}"
        );
        assert_eq!(command["journal"]["keep"][0].as_str(), Some("space"));
        assert!(command.get("first_class").is_none(), "{name}");
    }
    assert!(
        manifest.get("pipelines").is_none(),
        "curator-run is step 5's"
    );
}

#[tokio::test]
async fn neither_command_is_offered_over_mcp() {
    let fx = Fx::new();
    for name in ["curator-candidates", "curator-promote"] {
        let definition = fx.host.registry().get(name).unwrap();
        assert!(
            !definition.expose.mcp && !definition.expose.agent && definition.expose.cli,
            "{name}"
        );
        let refused = fx
            .call(human("local"), afd::CommandInterface::Mcp, name, json!({}))
            .await;
        assert_eq!(code(&refused), "COMMAND_NOT_EXPOSED", "{name}");
    }
}
