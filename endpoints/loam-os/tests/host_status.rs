//! `host-status` and the configuration checks, against the fake runtime (Loam OS M0, #2617).
//!
//! Each test opens a workspace from `examples/umbel.toml`, the file the runbook tells an operator
//! to start from, so the example stays valid.
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use afd::{Actor, ActorKind};
use loam_os_host::runtime::{FakeRuntime, Labelled, Runtime};
use loam_os_host::{HOST_NAME, HOST_VERSION, LoamOs};
use serde_json::{Value, json};
use umbel::HostBuilder;
use umbel::plugins::sdk;
use umbel::testkit::mcp::Http;

const EXAMPLE: &str = include_str!("../examples/umbel.toml");

/// A workspace holding `config` as its `umbel.toml`.
fn workspace(config: &str) -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("ws");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("umbel.toml"), config).unwrap();
    (dir, root)
}

/// The example with its `[plugins.loamos.config...]` tables replaced by `config`.
fn with_config(config: &str) -> String {
    let head = EXAMPLE
        .split("\n[plugins.loamos.config")
        .next()
        .unwrap()
        .to_owned();
    format!("{head}\n{config}")
}

fn host(root: &Path, runtime: Arc<dyn Runtime>) -> umbel::Host {
    HostBuilder::open(root)
        .unwrap()
        .with_compiled(sdk(LoamOs::with_runtime(runtime)))
        .with_server_identity(HOST_NAME, HOST_VERSION)
        .seal()
        .unwrap()
}

async fn call(host: &umbel::Host, name: &str) -> afd::CommandResult<Value> {
    let actor = Actor::new(ActorKind::Test).with_id("operator");
    host.registry()
        .execute(name, json!({}), Some(host.context(actor)))
        .await
}

/// The doctor's report, healthy or not.
async fn doctor(host: &umbel::Host) -> Value {
    let result = call(host, "workspace-doctor").await;
    if result.success {
        result.data.unwrap()
    } else {
        let error = result.error.unwrap();
        assert_eq!(error.code, "WORKSPACE_UNHEALTHY", "{error:?}");
        serde_json::to_value(error.details.unwrap()).unwrap()
    }
}

fn check<'a>(report: &'a Value, id: &str) -> &'a Value {
    report["checks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|check| check["id"] == id)
        .unwrap_or_else(|| panic!("no check {id}"))
}

#[tokio::test]
async fn host_status_names_the_host_its_runtime_and_the_image_by_digest() {
    let (_dir, root) = workspace(EXAMPLE);
    let runtime = Arc::new(FakeRuntime::reachable("29.9.3"));
    runtime.set_labelled(Labelled {
        containers: 2,
        volumes: 5,
    });
    let host = host(&root, runtime);
    let result = call(&host, "host-status").await;
    assert!(result.success, "{result:?}");
    let data = result.data.unwrap();
    assert_eq!(
        data["host"],
        json!({ "name": "loam-os", "version": HOST_VERSION })
    );
    assert_eq!(
        data["runtime"],
        json!({ "kind": "fake", "version": "29.9.3", "reachable": true, "error": null })
    );
    // Umbel's default journal until M1 (Umbel D208).
    assert_eq!(
        data["journal"],
        json!({ "mode": "best-effort", "writable": null, "pending": 0, "dropped": 0 })
    );
    let image = &data["images"][0];
    assert_eq!(image["name"], "session");
    assert_eq!(
        image["digest"],
        "sha256:0000000000000000000000000000000000000000000000000000000000000000"
    );
    assert_eq!(image["toolchain"]["node"], "26.13.1");
    assert_eq!(
        data["repositories"],
        json!([{ "name": "afd", "base": "main", "image": "session", "size": "lane" }])
    );
    assert_eq!(
        data["sizes"],
        json!([{ "name": "lane", "cpus": 8.0, "memoryGb": 16.0, "diskGb": 60.0 }])
    );
    assert_eq!(data["policies"][0], json!({ "name": "none", "hosts": [] }));
    assert_eq!(
        data["capacity"]["machines"],
        json!({ "max": 3, "active": 0 })
    );
    assert_eq!(data["capacity"]["diskGb"], 400.0);
    // M0 keeps no records, so everything labelled is unlisted.
    assert_eq!(
        data["unlisted"],
        json!({ "containers": 2, "volumes": 5, "error": null })
    );
    assert_eq!(data["capacity"]["usedGb"], Value::Null);
    assert_eq!(
        data["retention"],
        json!({ "recordsDays": 30, "logsDays": 7 })
    );

    let report = doctor(&host).await;
    let found = check(&report, "plugins.config_checks");
    assert_eq!(found["status"], "pass", "{found}");
    assert_eq!(report["healthy"], true, "{report}");
}

#[tokio::test]
async fn an_unreachable_runtime_is_shown_not_refused_and_the_doctor_warns() {
    let (_dir, root) = workspace(EXAMPLE);
    let host = host(&root, Arc::new(FakeRuntime::unreachable()));
    let result = call(&host, "host-status").await;
    assert!(result.success, "{result:?}");
    let data = result.data.unwrap();
    assert_eq!(data["runtime"]["reachable"], false);
    assert_eq!(data["runtime"]["version"], Value::Null);
    assert!(
        data["runtime"]["error"]
            .as_str()
            .unwrap()
            .contains("unreachable")
    );
    assert_eq!(
        data["unlisted"],
        json!({ "containers": null, "volumes": null, "error": null })
    );

    let found = check(&doctor(&host).await, "plugins.config_checks").clone();
    assert_eq!(found["status"], "warn", "{found}");
    assert!(
        found["message"]
            .as_str()
            .unwrap()
            .contains("RUNTIME_UNAVAILABLE"),
        "{found}"
    );
    assert!(
        found["suggestion"]
            .as_str()
            .unwrap()
            .starts_with("Start the container runtime")
    );
}

#[tokio::test]
async fn the_doctor_fails_what_the_schema_cannot_see() {
    let config = r#"[plugins.loamos.config.images.session]
reference = "loam-os-session:latest"

[plugins.loamos.config.sizes.lane]
cpus = 8
memory_gb = 16
disk_gb = 60

[plugins.loamos.config.repositories.afd]
source = "/srv/factory/afd"
image = "missing"
size = "huge"

[plugins.loamos.config.capacity]
machines = 3
disk_gb = 100
"#;
    let (_dir, root) = workspace(&with_config(config));
    let host = host(&root, Arc::new(FakeRuntime::reachable("29.9.3")));
    let report = doctor(&host).await;
    // The schema accepts the file; the plugin's own check does not.
    assert_eq!(check(&report, "plugins.config")["status"], "pass");
    let found = check(&report, "plugins.config_checks");
    assert_eq!(found["status"], "fail", "{found}");
    assert_eq!(
        found["message"],
        "loamos: its configuration fails the plugin's check: HOST_CONFIG_INVALID: image \
         `session` is `loam-os-session:latest`, which is not pinned by digest \
         (<name>@sha256:<64 lowercase hex>) (and 3 more problem(s)) (IMAGE_NOT_PINNED \
         /images/session/reference, IMAGE_UNKNOWN /repositories/afd/image, SIZE_UNKNOWN \
         /repositories/afd/size, and 1 more)"
    );
    assert_eq!(report["healthy"], false);
    // host-status still answers, with the image's digest absent.
    let result = call(&host, "host-status").await;
    assert!(result.success, "{result:?}");
    assert_eq!(result.data.unwrap()["images"][0]["digest"], Value::Null);
}

#[tokio::test]
async fn a_label_query_that_fails_says_why_while_the_runtime_answers() {
    let (_dir, root) = workspace(EXAMPLE);
    let runtime = Arc::new(FakeRuntime::reachable("29.9.3"));
    runtime.set_labelled_error(Some("`docker ps` did not answer within 5000 ms"));
    let host = host(&root, runtime);
    let data = call(&host, "host-status").await.data.unwrap();
    assert_eq!(data["runtime"]["reachable"], true);
    assert_eq!(
        data["unlisted"],
        json!({
            "containers": null,
            "volumes": null,
            "error": "`docker ps` did not answer within 5000 ms",
        })
    );
}

#[tokio::test]
async fn an_empty_configuration_takes_the_defaults() {
    let (_dir, root) = workspace(&with_config(""));
    let host = host(&root, Arc::new(FakeRuntime::reachable("5.6.0")));
    let data = call(&host, "host-status").await.data.unwrap();
    assert_eq!(data["repositories"], json!([]));
    assert_eq!(
        data["capacity"]["machines"],
        json!({ "max": 1, "active": 0 })
    );
    assert_eq!(data["capacity"]["diskGb"], Value::Null);
    assert_eq!(data["capacity"]["minFreeDiskGb"], 20.0);
    assert_eq!(
        data["retention"],
        json!({ "recordsDays": 30, "logsDays": 7 })
    );
}

#[tokio::test]
async fn the_mcp_server_is_loam_os_and_lists_host_status() {
    let (_dir, root) = workspace(EXAMPLE);
    let host = host(&root, Arc::new(FakeRuntime::reachable("29.9.3")));
    let http = Http::new(&host);
    let body = http.modern("server/discover", json!({})).await;
    assert_eq!(
        body["result"]["_meta"]["io.modelcontextprotocol/serverInfo"],
        json!({ "name": "loam-os", "version": HOST_VERSION })
    );
    let tools = http.modern("tools/list", json!({})).await;
    let names: Vec<&str> = tools["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|tool| tool["name"].as_str())
        .collect();
    assert!(names.contains(&"host-status"), "{names:?}");
}
