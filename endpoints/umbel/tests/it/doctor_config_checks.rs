//! The doctor's `plugins.config_checks`: on a sealed host, each loaded compiled instance's
//! configuration goes to the plugin's own check (`umbel_sdk::Plugin::check_config`), so what a
//! configuration schema cannot say (one entry naming another, a service it names being
//! reachable) fails the doctor with the plugin's code before any command runs. Without a sealed
//! host the check is `skip`.
use std::fs;
use std::path::{Path, PathBuf};

use crate::support::mcp::Http;
use afd::{Actor, ActorKind};
use serde_json::{Value, json};
use umbel::HostBuilder;
use umbel::doctor::{self, CheckStatus};
use umbel::plugins::sdk;
use umbel_sdk::{Asset, Cx, Outcome, Plugin, failure, success};

const MANIFEST: &str = r#"manifest_version = 1
protocol = 1

[plugin]
id = "fleet"
title = "Fleet"
version = "1.0.0"
description = "A plugin whose repositories name its images."
kind = "compiled"
domains = ["fleet"]

[[grants]]
name = "config"
reason = "Reads its repositories and images."

[config]
schema = { type = "object", properties = { images = { type = "array", items = { type = "string" } }, repositories = { type = "object", additionalProperties = { type = "string" } }, busy = { type = "boolean" } }, additionalProperties = false }

[[commands]]
name = "fleet-count"
description = "Count the repositories."
effects = ["inspect"]
input_schema = "schemas/count.input.json"
"#;

const ASSETS: &[Asset] = &[Asset {
    path: "schemas/count.input.json",
    bytes: br#"{"type":"object","properties":{},"additionalProperties":false}"#,
}];

/// Refuses a repository naming an image the configuration does not list (with a problem for
/// each), and answers a retryable failure when `busy` is set.
struct Fleet;

fn read(cx: &Cx) -> Result<usize, Outcome> {
    let config = cx.config().map_err(|_| {
        failure(
            "FLEET_CONFIG_UNREADABLE",
            "the configuration cannot be read",
            "Retry.",
        )
    })?;
    if config["busy"] == true {
        return Err(failure(
            "FLEET_RUNTIME_UNREACHABLE",
            "the runtime did not answer",
            "Start the runtime.",
        )
        .with_retryable(true));
    }
    let images: Vec<&str> = config["images"]
        .as_array()
        .map(|images| images.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let repositories = config["repositories"]
        .as_object()
        .cloned()
        .unwrap_or_default();
    let problems: Vec<Value> = repositories
        .iter()
        .filter(|(_, image)| !images.contains(&image.as_str().unwrap_or_default()))
        .map(|(name, _)| json!({ "code": "IMAGE_UNKNOWN", "at": format!("/repositories/{name}") }))
        .collect();
    if !problems.is_empty() {
        let count = problems.len();
        return Err(failure(
            "FLEET_CONFIG_INVALID",
            &format!("{count} repository(ies) name an image that is not configured"),
            "Add the image to `images`, or name a configured one.",
        )
        .with_error_details(json!({ "problems": problems, "count": count })));
    }
    Ok(repositories.len())
}

impl Plugin for Fleet {
    fn manifest(&self) -> &'static str {
        MANIFEST
    }

    fn assets(&self) -> &'static [Asset] {
        ASSETS
    }

    fn handle(&self, _name: &str, _input: Value, cx: &mut Cx) -> Outcome {
        match read(cx) {
            Ok(count) => success(json!({ "repositories": count })),
            Err(refusal) => refusal,
        }
    }

    fn check_config(&self, cx: &mut Cx) -> Option<Outcome> {
        Some(match read(cx) {
            Ok(_) => success(json!({})),
            Err(refusal) => refusal,
        })
    }
}

/// The same manifest and no check of its own.
struct Unchecked;

impl Plugin for Unchecked {
    fn manifest(&self) -> &'static str {
        MANIFEST
    }

    fn assets(&self) -> &'static [Asset] {
        ASSETS
    }

    fn handle(&self, _name: &str, _input: Value, _cx: &mut Cx) -> Outcome {
        success(json!({}))
    }
}

fn workspace(plugin_config: &str) -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("ws");
    fs::create_dir_all(&root).unwrap();
    fs::write(
        root.join("umbel.toml"),
        format!(
            "config_version = 2\ndefault_space = \"main\"\n[spaces.main]\n[plugins]\nenabled = [\"fleet\"]\n{plugin_config}"
        ),
    )
    .unwrap();
    (dir, root)
}

async fn sealed(root: &Path, plugin: impl Plugin) -> (umbel::Host, Value) {
    let host = HostBuilder::open(root)
        .unwrap()
        .with_compiled(sdk(plugin))
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

const VALID: &str =
    "[plugins.fleet.config]\nimages = [\"session\"]\nrepositories = { afd = \"session\" }\n";

#[tokio::test]
async fn a_valid_configuration_passes() {
    let (_dir, root) = workspace(VALID);
    let (_host, report) = sealed(&root, Fleet).await;
    let check = find(&report, "plugins.config_checks");
    assert_eq!(check["status"], "pass", "{check}");
    assert_eq!(
        check["message"],
        "1 instance(s) pass their plugin's configuration check"
    );
    assert_eq!(report["healthy"], true);
}

#[tokio::test]
async fn a_plugin_with_no_check_is_counted_as_schema_only() {
    let (_dir, root) = workspace(VALID);
    let (_host, report) = sealed(&root, Unchecked).await;
    let check = find(&report, "plugins.config_checks");
    assert_eq!(check["status"], "pass", "{check}");
    assert_eq!(
        check["message"],
        "0 instance(s) pass their plugin's configuration check; 1 instance(s) of plugins that \
         offer no check are checked against their schema only"
    );
}

#[tokio::test]
async fn a_configuration_the_plugin_refuses_fails_with_its_code_and_pointers() {
    let (_dir, root) = workspace(
        "[plugins.fleet.config]\nimages = [\"session\"]\nrepositories = { afd = \"old\", lushly = \"gone\" }\n",
    );
    let (host, report) = sealed(&root, Fleet).await;
    // The schema alone accepts it.
    assert_eq!(find(&report, "plugins.config")["status"], "pass");
    let check = find(&report, "plugins.config_checks");
    assert_eq!(check["status"], "fail", "{check}");
    assert_eq!(
        check["message"],
        "fleet: its configuration fails the plugin's check: FLEET_CONFIG_INVALID: 2 \
         repository(ies) name an image that is not configured (IMAGE_UNKNOWN /repositories/afd, \
         IMAGE_UNKNOWN /repositories/lushly)"
    );
    assert_eq!(
        check["suggestion"],
        "Add the image to `images`, or name a configured one."
    );
    assert_eq!(report["healthy"], false);
    // The code is the one a call gets.
    let actor = Actor::new(ActorKind::Test).with_id("doctor");
    let refused = host
        .registry()
        .execute("fleet-count", json!({}), Some(host.context(actor)))
        .await;
    assert_eq!(refused.error.unwrap().code, "FLEET_CONFIG_INVALID");
}

#[tokio::test]
async fn an_optional_instance_or_a_retryable_refusal_warns() {
    let (_dir, root) = workspace(
        "[plugins.fleet]\nrequired = false\n[plugins.fleet.config]\nimages = []\nrepositories = { afd = \"old\" }\n",
    );
    let (_host, report) = sealed(&root, Fleet).await;
    let check = find(&report, "plugins.config_checks");
    assert_eq!(check["status"], "warn", "{check}");

    let (_dir, root) = workspace("[plugins.fleet.config]\nbusy = true\n");
    let (_host, report) = sealed(&root, Fleet).await;
    let check = find(&report, "plugins.config_checks");
    assert_eq!(check["status"], "warn", "{check}");
    assert!(
        check["message"]
            .as_str()
            .unwrap()
            .contains("FLEET_RUNTIME_UNREACHABLE"),
        "{check}"
    );
}

#[test]
fn without_a_sealed_host_the_check_is_skipped() {
    let (_dir, root) = workspace(VALID);
    let report = doctor::run(&root);
    let check = report
        .checks
        .iter()
        .find(|check| check.id == "plugins.config_checks")
        .unwrap();
    assert_eq!(check.status, CheckStatus::Skip);
    assert!(check.message.contains("sealed host"), "{}", check.message);
}

#[tokio::test]
async fn the_embedder_names_the_mcp_server() {
    let discover = |host: &umbel::Host| {
        let http = Http::new(host);
        async move {
            let body = http.modern("server/discover", json!({})).await;
            body["result"]["_meta"]["io.modelcontextprotocol/serverInfo"].clone()
        }
    };
    let (_dir, root) = workspace(VALID);
    let host = HostBuilder::open(&root)
        .unwrap()
        .with_compiled(sdk(Fleet))
        .with_server_identity("loam-os", "0.1.0")
        .seal()
        .unwrap();
    let info = discover(&host).await;
    assert_eq!(info, json!({ "name": "loam-os", "version": "0.1.0" }));
    // The doctor's surface check still validates the embedder's server.
    let actor = Actor::new(ActorKind::Test).with_id("doctor");
    let result = host
        .registry()
        .execute("workspace-doctor", json!({}), Some(host.context(actor)))
        .await;
    let report = result.data.unwrap();
    assert_eq!(find(&report, "mcp.surface")["status"], "pass");

    let (_dir, root) = workspace(VALID);
    let (host, _) = sealed(&root, Fleet).await;
    let info = discover(&host).await;
    assert_eq!(info["name"], "umbel");
    assert_eq!(info["version"], env!("CARGO_PKG_VERSION"));
}

const WHERE_MANIFEST: &str = r#"manifest_version = 1
protocol = 1

[plugin]
id = "where"
title = "Where"
version = "1.0.0"
description = "A plugin whose check says which space it ran in."
kind = "compiled"
domains = ["where"]

[[commands]]
name = "where-am-i"
description = "Say the call's space."
effects = ["inspect"]
input_schema = "schemas/where.input.json"
"#;

const WHERE_ASSETS: &[Asset] = &[Asset {
    path: "schemas/where.input.json",
    bytes: br#"{"type":"object","properties":{"space":{"type":"string"}},"additionalProperties":false}"#,
}];

/// Fails its check with the space it ran in, four problems and no suggestion of its own.
struct Where;

impl Plugin for Where {
    fn manifest(&self) -> &'static str {
        WHERE_MANIFEST
    }

    fn assets(&self) -> &'static [Asset] {
        WHERE_ASSETS
    }

    fn handle(&self, _name: &str, _input: Value, cx: &mut Cx) -> Outcome {
        success(json!({ "space": cx.call().space }))
    }

    fn check_config(&self, cx: &mut Cx) -> Option<Outcome> {
        let space = cx.call().space.clone().unwrap_or_default();
        let problems: Vec<Value> = (0..4)
            .map(|n| json!({ "code": "SPOT_INVALID", "at": format!("/spots/{n}") }))
            .collect();
        Some(
            failure("WHERE_CHECKED", &format!("checked in space {space}"), "")
                .with_error_details(json!({ "problems": problems, "count": 4 })),
        )
    }
}

async fn where_report(instance: &str) -> Value {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("ws");
    fs::create_dir_all(&root).unwrap();
    fs::write(
        root.join("umbel.toml"),
        format!(
            "config_version = 2\ndefault_space = \"main\"\n[spaces.main]\n[spaces.beta]\n[plugins]\nenabled = [\"where\"]\n{instance}"
        ),
    )
    .unwrap();
    let (_host, report) = sealed(&root, Where).await;
    find(&report, "plugins.config_checks").clone()
}

#[tokio::test]
async fn the_check_runs_in_the_default_space_or_the_instances_own_and_falls_back_to_a_suggestion() {
    let check = where_report("").await;
    assert_eq!(check["status"], "fail", "{check}");
    assert_eq!(
        check["message"],
        "where: its configuration fails the plugin's check: WHERE_CHECKED: checked in space main \
         (SPOT_INVALID /spots/0, SPOT_INVALID /spots/1, SPOT_INVALID /spots/2, and 1 more)"
    );
    assert_eq!(
        check["suggestion"],
        "Fix [plugins.where.config] in umbel.toml, then run workspace-doctor again."
    );
    // An instance enabled only in `beta` is checked there, where its grants hold.
    let check = where_report("[plugins.where]\nspaces = [\"beta\"]\n").await;
    assert!(
        check["message"]
            .as_str()
            .unwrap()
            .contains("checked in space beta"),
        "{check}"
    );
}

/// Panics in its configuration check.
struct Panicky;

impl Plugin for Panicky {
    fn manifest(&self) -> &'static str {
        MANIFEST
    }

    fn assets(&self) -> &'static [Asset] {
        ASSETS
    }

    fn handle(&self, _name: &str, _input: Value, _cx: &mut Cx) -> Outcome {
        success(json!({}))
    }

    fn check_config(&self, _cx: &mut Cx) -> Option<Outcome> {
        panic!("the configuration check panicked on purpose")
    }
}

#[tokio::test]
async fn a_check_that_panics_fails_instead_of_staying_skipped() {
    let (_dir, root) = workspace(VALID);
    let (_host, report) = sealed(&root, Panicky).await;
    let check = find(&report, "plugins.config_checks");
    assert_eq!(check["status"], "fail", "{check}");
    assert!(
        check["message"].as_str().unwrap().contains("panicked"),
        "{check}"
    );
    assert_eq!(report["healthy"], false);
}
