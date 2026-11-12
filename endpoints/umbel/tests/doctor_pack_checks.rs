//! The doctor's `plugins.pack_checks` (D172): on a sealed host, every space override of a compiled
//! instance's pack goes to the plugin's own check (`umbel_sdk::Plugin::check_pack`), so an
//! override the plugin would refuse on a call fails the doctor first, with the plugin's code and
//! the offending path and pointer. Without a sealed host the check is `skip`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::fs;
use std::path::{Path, PathBuf};

use afd::{Actor, ActorKind};
use serde_json::{Value, json};
use umbel::HostBuilder;
use umbel::doctor::{self, CheckStatus};
use umbel::plugins::sdk;
use umbel_sdk::{Asset, Cx, Outcome, Plugin, failure, success};

const MANIFEST: &str = r#"manifest_version = 1
protocol = 1

[plugin]
id = "checker"
title = "Checker"
version = "1.0.0"
description = "A plugin that checks one of its two packs."
kind = "compiled"
domains = ["checker"]

[[grants]]
name = "packs"
reason = "Reads its packs."

[[commands]]
name = "checker-count"
description = "Count the files of the voice pack."
effects = ["inspect"]
input_schema = "schemas/count.input.json"

[[packs]]
id = "voice"
path = "packs/voice"

[[packs]]
id = "plain"
path = "packs/plain"
"#;

const ASSETS: &[Asset] = &[
    Asset {
        path: "schemas/count.input.json",
        bytes: br#"{"type":"object","properties":{"space":{"type":"string"}},"additionalProperties":false}"#,
    },
    Asset {
        path: "packs/voice/pack.toml",
        bytes: b"pack_version = 1\nid = \"voice\"\nplugin = \"checker\"\nversion = \"1.0.0\"\ntitle = \"Voice\"\ndescription = \"d\"\n",
    },
    Asset {
        path: "packs/voice/data/words.txt",
        bytes: b"hello",
    },
    Asset {
        path: "packs/plain/pack.toml",
        bytes: b"pack_version = 1\nid = \"plain\"\nplugin = \"checker\"\nversion = \"1.0.0\"\ntitle = \"Plain\"\ndescription = \"d\"\n",
    },
    Asset {
        path: "packs/plain/data/words.txt",
        bytes: b"plain",
    },
];

/// Refuses a `voice` copy holding `data/bad.txt` (with a problem), answers a retryable failure
/// for one holding `data/busy.txt`, and offers no check for `plain`. Its command reads the pack
/// through the same function, as a real plugin's would.
struct Checker;

fn read_voice(cx: &Cx) -> Result<usize, Outcome> {
    let files = cx.pack_list("voice").map_err(|_| {
        failure(
            "VOICE_UNREADABLE",
            "the voice pack cannot be listed",
            "Retry.",
        )
    })?;
    if files.iter().any(|file| file == "data/bad.txt") {
        return Err(failure(
            "VOICE_INVALID",
            "the voice pack has 4 problem(s)",
            "Remove data/bad.txt from the voice pack.",
        )
        .with_error_details(json!({
            "problems": [
                { "code": "WORD_INVALID", "path": "data/bad.txt", "at": "/0" },
                { "code": "WORD_INVALID", "path": "data/bad.txt", "at": "/1" },
                { "code": "FILE_UNKNOWN", "path": "data/bad.txt" },
            ],
            "count": 4,
        })));
    }
    if files.iter().any(|file| file == "data/busy.txt") {
        return Err(failure(
            "VOICE_BUSY",
            "the voice pack is being replaced",
            "Retry in a moment.",
        )
        .with_retryable(true));
    }
    Ok(files.len())
}

impl Plugin for Checker {
    fn manifest(&self) -> &'static str {
        MANIFEST
    }

    fn assets(&self) -> &'static [Asset] {
        ASSETS
    }

    fn handle(&self, _name: &str, _input: Value, cx: &mut Cx) -> Outcome {
        match read_voice(cx) {
            Ok(count) => success(json!({ "files": count })),
            Err(refusal) => refusal,
        }
    }

    fn check_pack(&self, pack: &str, cx: &mut Cx) -> Option<Outcome> {
        (pack == "voice").then(|| match read_voice(cx) {
            Ok(_) => success(json!({})),
            Err(refusal) => refusal,
        })
    }
}

fn workspace(plugin_config: &str) -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("ws");
    fs::create_dir_all(&root).unwrap();
    fs::write(
        root.join("umbel.toml"),
        format!(
            "config_version = 2\ndefault_space = \"main\"\n[spaces.main]\n[spaces.beta]\n[spaces.gamma]\n[plugins]\nenabled = [\"checker\"]\n{plugin_config}"
        ),
    )
    .unwrap();
    (dir, root)
}

/// A space override of `pack` in `space`, holding `files` beside its `pack.toml`.
fn override_pack(root: &Path, space: &str, pack: &str, files: &[&str]) {
    let dir = root
        .join("spaces")
        .join(space)
        .join("packs/checker")
        .join(pack);
    fs::create_dir_all(dir.join("data")).unwrap();
    fs::write(
        dir.join("pack.toml"),
        format!(
            "pack_version = 1\nid = \"{pack}\"\nplugin = \"checker\"\nversion = \"2.0.0\"\ntitle = \"Over\"\ndescription = \"d\"\n"
        ),
    )
    .unwrap();
    for file in files {
        fs::write(dir.join("data").join(file), "x").unwrap();
    }
}

async fn sealed(root: &Path) -> (umbel::Host, Value) {
    let host = HostBuilder::open(root)
        .unwrap()
        .with_compiled(sdk(Checker))
        .seal()
        .unwrap();
    let actor = Actor::new(ActorKind::Test).with_id("doctor");
    let result = host
        .registry()
        .execute("workspace-doctor", json!({}), Some(host.context(actor)))
        .await;
    // An unhealthy workspace fails with WORKSPACE_UNHEALTHY, the report in the error's details.
    let report = if result.success {
        result.data.unwrap()
    } else {
        let error = result.error.unwrap();
        assert_eq!(error.code, "WORKSPACE_UNHEALTHY", "{error:?}");
        serde_json::to_value(error.details.unwrap()).unwrap()
    };
    (host, report)
}

fn find<'a>(report: &'a Value, id: &str) -> &'a Value {
    report["checks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|check| check["id"] == id)
        .unwrap_or_else(|| panic!("no check {id}"))
}

#[tokio::test]
async fn no_override_passes_with_nothing_checked() {
    let (_dir, root) = workspace("");
    let (_host, report) = sealed(&root).await;
    let check = find(&report, "plugins.pack_checks");
    assert_eq!(check["status"], "pass", "{check}");
    assert_eq!(
        check["message"],
        "0 override(s) pass their plugin's own check"
    );
}

#[tokio::test]
async fn a_valid_override_passes_and_one_with_no_plugin_check_is_counted_as_layout_only() {
    let (_dir, root) = workspace("");
    override_pack(&root, "main", "voice", &["words.txt"]);
    override_pack(&root, "beta", "plain", &["bad.txt"]);
    let (_host, report) = sealed(&root).await;
    let check = find(&report, "plugins.pack_checks");
    assert_eq!(check["status"], "pass", "{check}");
    assert_eq!(
        check["message"],
        "1 override(s) pass their plugin's own check; 1 override(s) of plugins that offer no \
         check are checked for layout only"
    );
    assert_eq!(report["healthy"], true);
}

#[tokio::test]
async fn an_override_the_plugin_refuses_fails_with_its_code_paths_and_pointers() {
    let (_dir, root) = workspace("");
    override_pack(&root, "beta", "voice", &["bad.txt"]);
    let (host, report) = sealed(&root).await;
    // The layout check alone passes it.
    assert_eq!(find(&report, "plugins.packs")["status"], "pass");
    let check = find(&report, "plugins.pack_checks");
    assert_eq!(check["status"], "fail", "{check}");
    assert_eq!(
        check["message"],
        "checker: the override of pack `voice` in space `beta` fails the plugin's check: \
         VOICE_INVALID: the voice pack has 4 problem(s) (WORD_INVALID data/bad.txt#/0, \
         WORD_INVALID data/bad.txt#/1, FILE_UNKNOWN data/bad.txt, and 1 more)"
    );
    assert_eq!(
        check["suggestion"],
        "Remove data/bad.txt from the voice pack."
    );
    assert_eq!(report["healthy"], false);
    // The code is the one a call in that space gets; the other spaces are served.
    let actor = || Actor::new(ActorKind::Test).with_id("doctor");
    let refused = host
        .registry()
        .execute(
            "checker-count",
            json!({ "space": "beta" }),
            Some(host.context(actor())),
        )
        .await;
    assert_eq!(refused.error.unwrap().code, "VOICE_INVALID");
    let served = host
        .registry()
        .execute(
            "checker-count",
            json!({ "space": "main" }),
            Some(host.context(actor())),
        )
        .await;
    assert!(served.success, "{served:?}");
}

#[tokio::test]
async fn an_optional_instance_or_a_retryable_refusal_warns() {
    let (_dir, root) = workspace("[plugins.checker]\nrequired = false\n");
    override_pack(&root, "beta", "voice", &["bad.txt"]);
    let (_host, report) = sealed(&root).await;
    let check = find(&report, "plugins.pack_checks");
    assert_eq!(check["status"], "warn", "{check}");

    let (_dir, root) = workspace("");
    override_pack(&root, "gamma", "voice", &["busy.txt"]);
    let (_host, report) = sealed(&root).await;
    let check = find(&report, "plugins.pack_checks");
    assert_eq!(check["status"], "warn", "{check}");
    assert!(
        check["message"]
            .as_str()
            .unwrap()
            .contains("space `gamma` fails the plugin's check: VOICE_BUSY"),
        "{check}"
    );
}

#[tokio::test]
async fn every_failing_override_is_named() {
    let (_dir, root) = workspace("");
    override_pack(&root, "beta", "voice", &["bad.txt"]);
    override_pack(&root, "main", "voice", &["bad.txt"]);
    let (_host, report) = sealed(&root).await;
    let check = find(&report, "plugins.pack_checks");
    assert_eq!(check["status"], "fail", "{check}");
    let message = check["message"].as_str().unwrap();
    for space in ["main", "beta"] {
        assert!(
            message.contains(&format!("space `{space}` fails")),
            "{message}"
        );
    }
}

#[test]
fn without_a_sealed_host_the_check_is_skipped() {
    let (_dir, root) = workspace("");
    override_pack(&root, "beta", "voice", &["bad.txt"]);
    let report = doctor::run(&root);
    let check = report
        .checks
        .iter()
        .find(|check| check.id == "plugins.pack_checks")
        .unwrap();
    assert_eq!(check.status, CheckStatus::Skip);
    assert!(check.message.contains("sealed host"), "{}", check.message);
}
