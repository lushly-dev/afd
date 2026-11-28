//! `host-status` and the configuration checks, against the fake runtime (Loam OS M0, #2617), and
//! from M1 step 2 (#2914) the journal's live state, the records and the host's own calls.
//!
//! Each test opens a workspace from `examples/umbel.toml`, the file the runbook tells an operator
//! to start from, so the example stays valid, and builds the host as the binary does
//! ([`loam_os_host::install`]): the records are the real ones, in the workspace's state.
use std::path::Path;
use std::sync::Arc;

use afd::CommandResult;
use loam_os_host::records::{FileRecords, MachineRecord, MachineState, RECORD_VERSION, Records};
use loam_os_host::runtime::{MOUNTS, container_name, volume_name};
use loam_os_host::{HOST_VERSION, JOURNAL_POLICIES, LoamOs, MANIFEST};
use serde_json::{Value, json};
use umbel::testkit::mcp::Http;

use crate::support::fakes::{FakeRuntime, FlakyStorage, MemoryRecords};
use crate::support::{EXAMPLE, call_as, with_config, workspace};

fn host(root: &Path, runtime: Arc<FakeRuntime>) -> umbel::Host {
    crate::support::host(root, LoamOs::default().with_runtime(runtime), None, None)
}

fn reachable() -> Arc<FakeRuntime> {
    Arc::new(FakeRuntime::reachable("fake", "29.9.3"))
}

async fn call(host: &umbel::Host, name: &str) -> CommandResult<Value> {
    call_as(host, "operator", name, json!({})).await
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

/// A ready machine's record, naming its container and volumes.
fn machine(id: &str, state: MachineState) -> MachineRecord {
    let active = state.is_active();
    MachineRecord {
        v: RECORD_VERSION,
        id: id.to_owned(),
        repository: "afd".to_owned(),
        branch: format!("fix/{id}"),
        size: Some("lane".to_owned()),
        image: None,
        state,
        created_at: None,
        expires_at: None,
        destroyed_at: None,
        destroyed_by: None,
        reason: None,
        container: active.then(|| container_name(id)),
        volumes: if active {
            MOUNTS
                .iter()
                .map(|mount| ((*mount).to_owned(), volume_name(id, mount)))
                .collect()
        } else {
            Default::default()
        },
    }
}

fn hold(runtime: &FakeRuntime, record: &MachineRecord) {
    for name in record.container.iter() {
        runtime.hold_container(name, &record.id, 0);
    }
    for name in record.volumes.values() {
        runtime.hold_volume(name, &record.id, 0);
    }
}

#[tokio::test]
async fn host_status_names_the_host_its_runtime_and_the_image_by_digest() {
    let (_dir, root) = workspace(EXAMPLE);
    let runtime = reachable();
    // Nothing is in the records yet, so everything labelled is unlisted.
    runtime.hold_container("left-1", "m-9", 0);
    runtime.hold_container("left-2", "m-9", 0);
    for n in 0..5 {
        runtime.hold_volume(&format!("left-v{n}"), "m-9", 0);
    }
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
    // The binary's journal policies, with the live counts (Umbel D224).
    assert_eq!(
        data["journal"],
        json!({ "mode": "required", "writable": true, "pending": 0, "dropped": 0 })
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
    let host = host(
        &root,
        Arc::new(FakeRuntime::unreachable(
            "fake",
            "the fake runtime is unreachable",
        )),
    );
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
    let host = host(&root, reachable());
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
    let runtime = reachable();
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
    let host = host(&root, Arc::new(FakeRuntime::reachable("fake", "5.6.0")));
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
    let host = host(&root, reachable());
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

#[tokio::test]
async fn the_records_in_the_workspace_count_and_account_and_outlive_the_host() {
    let (_dir, root) = workspace(EXAMPLE);
    let runtime = reachable();
    let records = FileRecords::in_state(&root.join("state"));
    let ready = machine("m-01", MachineState::Ready);
    let busy = machine("m-02", MachineState::Busy);
    records.put_machine(&ready).unwrap();
    records.put_machine(&busy).unwrap();
    records
        .put_machine(&machine("m-00", MachineState::Destroyed))
        .unwrap();
    hold(&runtime, &ready);
    hold(&runtime, &busy);
    // A leftover no record names.
    runtime.hold_volume("loam-os-m-77-build", "m-77", 0);
    {
        let host = host(&root, Arc::clone(&runtime));
        let data = call(&host, "host-status").await.data.unwrap();
        assert_eq!(data["capacity"]["machines"]["active"], 2);
        assert_eq!(
            data["unlisted"],
            json!({ "containers": 0, "volumes": 1, "error": null })
        );
    }
    // A new host over the same workspace reads the same records.
    let host = host(&root, runtime);
    let data = call(&host, "host-status").await.data.unwrap();
    assert_eq!(data["capacity"]["machines"]["active"], 2);
    assert_eq!(data["unlisted"]["volumes"], 1);
    assert_eq!(
        records.machine("m-01").unwrap().unwrap().state,
        MachineState::Ready
    );
}

#[tokio::test]
async fn records_that_cannot_be_read_are_a_warning_not_a_refusal() {
    let (_dir, root) = workspace(EXAMPLE);
    let records = Arc::new(MemoryRecords::default());
    records.set_unreadable(Some("the records' disk is gone"));
    let plugin = LoamOs::default()
        .with_runtime(reachable())
        .with_records(records);
    let host = crate::support::host(&root, plugin, None, None);
    let result = call(&host, "host-status").await;
    assert!(result.success, "{result:?}");
    let warning = &result.warnings.as_ref().unwrap()[0];
    assert_eq!(warning.code, "RECORDS_UNREADABLE");
    assert!(warning.message.contains("the records' disk is gone"));
    let data = result.data.unwrap();
    assert_eq!(data["capacity"]["machines"]["active"], Value::Null);
    assert_eq!(data["unlisted"]["containers"], Value::Null);
    assert!(
        data["unlisted"]["error"]
            .as_str()
            .unwrap()
            .contains("records cannot be read")
    );
}

#[tokio::test]
async fn the_journal_reads_live_and_a_read_still_answers_when_it_is_down() {
    let (_dir, root) = workspace(EXAMPLE);
    let storage = FlakyStorage::default();
    let plugin = LoamOs::default().with_runtime(reachable());
    let host = crate::support::host(&root, plugin, Some(storage.clone()), None);
    let journal = |result: CommandResult<Value>| result.data.unwrap()["journal"].clone();
    assert_eq!(
        journal(call(&host, "host-status").await),
        json!({ "mode": "required", "writable": true, "pending": 0, "dropped": 0 })
    );
    storage.set_down(Some("No space left on device"));
    // The first read after the journal went down is answered before its own entry is tried.
    assert!(call(&host, "host-status").await.success);
    // host-status is droppable: its entry was dropped and counted, and the read answers.
    let after = call(&host, "host-status").await;
    assert!(after.success, "{after:?}");
    assert_eq!(
        journal(after),
        json!({ "mode": "required", "writable": false, "pending": 0, "dropped": 1 })
    );
    storage.set_down(None);
    // Only a journal write raises `writable` again (D224).
    assert!(call(&host, "host-status").await.success);
    let back = journal(call(&host, "host-status").await);
    assert_eq!(back["writable"], true, "{back}");
    assert_eq!(back["dropped"], 2, "{back}");
    assert_eq!(
        host.journal_health().unwrap().dropped(),
        2,
        "the plugin reads the host's own handle"
    );
}

#[test]
fn every_command_the_manifest_declares_has_a_journal_policy() {
    // Each `name` under a `[[commands]]` table.
    let mut manifest = Vec::new();
    let mut in_command = false;
    for line in MANIFEST.lines() {
        if line.starts_with('[') {
            in_command = line == "[[commands]]";
        } else if in_command
            && let Some(name) = line
                .strip_prefix("name = \"")
                .and_then(|rest| rest.strip_suffix('"'))
        {
            manifest.push(name);
        }
    }
    let policies: Vec<&str> = JOURNAL_POLICIES.iter().map(|(name, _)| *name).collect();
    assert_eq!(manifest, policies);
}

#[tokio::test]
async fn a_workspace_without_the_plugin_gets_no_journal_policies() {
    let config = EXAMPLE
        .replace("enabled = [\"loamos\"]", "enabled = []")
        .split("\n[plugins.loamos]")
        .next()
        .unwrap()
        .to_owned();
    let (_dir, root) = workspace(&config);
    let host = crate::support::host(&root, LoamOs::default(), None, None);
    assert!(host.journal_health().is_none());
    assert!(!call(&host, "host-status").await.success);
}

#[tokio::test]
async fn the_hosts_own_calls_go_through_the_registry_as_a_service() {
    let (_dir, root) = workspace(EXAMPLE);
    let host = host(&root, reachable());
    let result = loam_os_host::call_as_service(&host, "reaper", "host-status", json!({})).await;
    assert!(result.success, "{result:?}");
    // The journal recorder, the registry's outermost layer, wrote the call with its actor: it
    // went through `registry.execute`, which gives every call a dispatch id (Umbel D221).
    let journal = std::fs::read_to_string(root.join("state").join("journal.jsonl")).unwrap();
    let entry: Value = journal
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .find(|entry| entry["command"] == "host-status")
        .unwrap_or_else(|| panic!("no host-status entry in {journal}"));
    let actor = entry.to_string();
    assert!(
        actor.contains("\"service\"") && actor.contains("\"reaper\""),
        "{entry}"
    );
}
