//! `store-show`, `store-check` and `store-backup` (phase 2 specification, section 3.5): counts,
//! a corrupted index, a missing journal entry, a recent change that is not reported, and a backup
//! that holds the index writer.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::{Actor, ActorKind, CommandResult, fixed_clock};
use serde_json::{Value, json};
use std::path::Path;
use support::store::{ALLOW_ALL, StoreProbe, config};
use support::{agent, call};
use umbel::plugins::sdk;
use umbel::{Host, HostBuilder};

const T0: i64 = 1_767_225_600_000; // 2026-01-01T00:00:00Z

fn human() -> Actor {
    Actor::new(ActorKind::Human).with_id("local")
}

fn host_at(dir: &Path, clock: i64, probe: StoreProbe) -> Host {
    HostBuilder::open(dir)
        .unwrap()
        .with_compiled(sdk(probe))
        .with_clock(fixed_clock(clock))
        .seal()
        .unwrap()
}

async fn put(host: &Host, id: &str, access: Value) -> CommandResult<Value> {
    let outcome = call(
        host,
        agent("writer"),
        "sp-write",
        json!({"op": "doc-put", "args": {"id": id, "text": "alpha bravo", "access": access}}),
    )
    .await;
    assert!(outcome.success, "{outcome:?}");
    outcome
}

async fn index(host: &Host, id: &str, applied: u64) {
    let outcome = call(
        host,
        agent("writer"),
        "sp-write",
        json!({"op": "index-replace", "args": {"id": id, "text": "alpha bravo", "applied": applied}}),
    )
    .await;
    assert!(outcome.success, "{outcome:?}");
}

/// Two documents, both indexed, the graph empty and caught up.
async fn seeded(dir: &Path, clock: i64) -> Host {
    let host = host_at(dir, clock, StoreProbe::new());
    put(&host, "notes/a", json!(["space"])).await;
    put(&host, "notes/b", json!(["space"])).await;
    index(&host, "notes/a", 2).await;
    index(&host, "notes/b", 2).await;
    let graph = call(
        &host,
        agent("writer"),
        "sp-write",
        json!({"op": "graph-apply", "args": {"applied": 2}}),
    )
    .await;
    assert!(graph.success, "{graph:?}");
    host
}

fn checks(outcome: &CommandResult<Value>) -> Vec<(String, String)> {
    let data = match (&outcome.data, &outcome.error) {
        (Some(data), _) => data.clone(),
        (_, Some(error)) => serde_json::to_value(error.details.clone().unwrap()).unwrap(),
        _ => panic!("{outcome:?}"),
    };
    data["checks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|check| {
            (
                check["id"].as_str().unwrap().to_owned(),
                check["status"].as_str().unwrap().to_owned(),
            )
        })
        .collect()
}

fn status<'a>(found: &'a [(String, String)], id: &str) -> &'a str {
    found
        .iter()
        .find(|(check, _)| check == id)
        .map(|(_, status)| status.as_str())
        .unwrap_or_else(|| panic!("no check {id} in {found:?}"))
}

fn workspace() -> tempfile::TempDir {
    support::workspace(&config("", "", ALLOW_ALL))
}

#[tokio::test]
async fn store_show_reports_the_stores_revisions_and_counts() {
    let dir = workspace();
    let host = seeded(dir.path(), T0).await;
    let shown = call(&host, human(), "store-show", json!({})).await;
    assert!(shown.success, "{shown:?}");
    let data = shown.data.unwrap();
    assert_eq!(data["space"], "main");
    assert_eq!(data["backend"], "embedded");
    assert_eq!(data["storeVersion"], 1);
    assert_eq!(data["schemaVersion"], 1);
    assert_eq!(data["head"], 2);
    assert_eq!(data["counts"]["documents"], 2);
    assert_eq!(data["counts"]["chunks"], 2);
    assert_eq!(data["index"]["applied"], 2);
    assert_eq!(data["graph"]["applied"], 2);
    assert!(data["files"]["databaseBytes"].as_u64().unwrap() > 0);
    // A library caller is not "a person at the CLI": no totals.
    assert!(data.get("totals").is_none());
    // The input is closed and the space is checked.
    let unknown = call(&host, human(), "store-show", json!({"space": "nowhere"})).await;
    assert_eq!(unknown.error.unwrap().code, "SPACE_NOT_FOUND");
}

#[tokio::test]
async fn store_show_gives_totals_to_a_person_at_the_cli_only() {
    let dir = support::workspace(&format!(
        "{}\n[access.groups.platform]\nmembers = [\"agent:ci\"]\n",
        config("", "", ALLOW_ALL)
    ));
    let host = host_at(dir.path(), T0, StoreProbe::new());
    put(&host, "notes/open", json!(["space"])).await;
    put(&host, "notes/hidden", json!(["group:platform"])).await;
    drop(host);
    let cli = support::cli_with(
        dir.path(),
        &["call", "store-show"],
        support::Scripted::no_terminal(),
        |b| b.with_compiled(sdk(StoreProbe::new())),
    )
    .await;
    assert_eq!(cli.code, 0, "{}", cli.stdout);
    let data = &cli.json()["data"];
    // `human:local` is in no group: readable counts exclude the hidden document; totals do not.
    assert_eq!(data["counts"]["documents"], 1);
    assert_eq!(data["totals"]["documents"], 2);
}

#[tokio::test]
async fn store_check_passes_on_sound_stores_and_is_cli_only() {
    let dir = workspace();
    let host = seeded(dir.path(), T0).await;
    let definition = host.registry().get("store-check").unwrap();
    assert!(definition.expose.cli && !definition.expose.mcp && !definition.expose.agent);
    let outcome = call(&host, human(), "store-check", json!({})).await;
    assert!(outcome.success, "{outcome:?}");
    let found = checks(&outcome);
    for id in [
        "store.sqlite",
        "store.index",
        "store.access",
        "store.revisions",
        "store.journal",
    ] {
        assert_eq!(status(&found, id), "pass", "{id}: {found:?}");
    }
}

#[tokio::test]
async fn store_check_finds_a_corrupted_index() {
    let dir = workspace();
    {
        let _host = seeded(dir.path(), T0).await;
    }
    // Flip a byte in a segment file; `meta.json` and the locks are left alone.
    let index = dir.path().join("state/spaces/main/index/v1");
    let mut damaged = None;
    for entry in std::fs::read_dir(&index).unwrap().flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.ends_with(".store") || name.ends_with(".idx") || name.ends_with(".term") {
            let mut bytes = std::fs::read(entry.path()).unwrap();
            let middle = bytes.len() / 2;
            bytes[middle] ^= 0xff;
            std::fs::write(entry.path(), bytes).unwrap();
            damaged = Some(name);
            break;
        }
    }
    let damaged = damaged.expect("a segment file to damage");
    let host = host_at(dir.path(), T0, StoreProbe::new());
    let outcome = call(&host, human(), "store-check", json!({})).await;
    let error = outcome
        .error
        .as_ref()
        .expect("an unhealthy store is a failure");
    assert_eq!(error.code, "STORE_CORRUPT");
    assert!(
        error.suggestion.as_deref().unwrap().contains("rebuild"),
        "{error:?}"
    );
    let found = checks(&outcome);
    assert_eq!(
        status(&found, "store.index"),
        "fail",
        "{damaged}: {found:?}"
    );
    // The database itself is fine.
    assert_eq!(status(&found, "store.sqlite"), "pass");
}

#[tokio::test]
async fn store_check_warns_of_a_change_with_no_journal_entry_but_not_of_a_recent_one() {
    let dir = workspace();
    {
        let _host = seeded(dir.path(), T0).await;
    }
    // A crash between the store write and the journal append: the entries are gone.
    std::fs::remove_file(dir.path().join("state/journal.jsonl")).unwrap();
    // Ten seconds later the change is recent: it may still be about to get its entry.
    let soon = host_at(dir.path(), T0 + 10_000, StoreProbe::new());
    let recent = call(&soon, human(), "store-check", json!({})).await;
    assert_eq!(status(&checks(&recent), "store.journal"), "pass");
    drop(soon);
    // Ten minutes later it is not; a missing entry is a warning, never a failure.
    let later = host_at(dir.path(), T0 + 600_000, StoreProbe::new());
    let outcome = call(&later, human(), "store-check", json!({})).await;
    assert!(
        outcome.success,
        "a missing journal entry is a warning: {outcome:?}"
    );
    assert_eq!(status(&checks(&outcome), "store.journal"), "warn");
    let warnings = outcome.warnings.unwrap();
    assert!(
        warnings.iter().any(|w| w.code == "STORE_CHECK_JOURNAL"),
        "{warnings:?}"
    );
}

#[tokio::test]
async fn store_check_warns_of_an_index_behind_the_head() {
    let dir = workspace();
    let host = host_at(dir.path(), T0, StoreProbe::new());
    put(&host, "notes/a", json!(["space"])).await;
    let outcome = call(&host, human(), "store-check", json!({})).await;
    assert!(outcome.success, "{outcome:?}");
    assert_eq!(status(&checks(&outcome), "store.revisions"), "warn");
}

#[tokio::test]
async fn store_backup_copies_the_stores_with_a_manifest_of_digests() {
    let dir = workspace();
    let host = seeded(dir.path(), T0).await;
    let outcome = call(
        &host,
        human(),
        "store-backup",
        json!({"path": "backups/one"}),
    )
    .await;
    assert!(outcome.success, "{outcome:?}");
    let backup = dir.path().join("backups/one");
    let manifest: Value =
        serde_json::from_slice(&std::fs::read(backup.join("manifest.json")).unwrap()).unwrap();
    assert_eq!(manifest["version"], 1);
    assert_eq!(manifest["space"], "main");
    let files = manifest["files"].as_array().unwrap();
    assert!(files.iter().any(|f| f["path"] == "store.sqlite3"));
    assert!(
        files
            .iter()
            .any(|f| f["path"].as_str().unwrap().starts_with("index/v1/"))
    );
    // Every digest is of the bytes copied.
    for file in files {
        let bytes = std::fs::read(backup.join(file["path"].as_str().unwrap())).unwrap();
        assert_eq!(file["bytes"].as_u64().unwrap(), bytes.len() as u64);
        let digest = umbel_store::ContentHash::of(&bytes).to_string();
        assert_eq!(file["sha256"], digest);
    }
    // It is a mutation that is not projected into an event.
    assert!(
        support::events(dir.path(), "main")
            .iter()
            .all(|e| e["command"] != "store-backup")
    );
    // A destination that exists, escapes the workspace or lies in state/ is refused.
    for path in [
        "backups/one",
        "../elsewhere",
        "state/backup",
        "/tmp/umbel-backup-x",
    ] {
        let refused = call(&host, human(), "store-backup", json!({"path": path})).await;
        assert!(!refused.success, "{path}: {refused:?}");
    }
    // It opens as a store.
    let copy = rusqlite::Connection::open(backup.join("store.sqlite3")).unwrap();
    let documents: i64 = copy
        .query_row("SELECT COUNT(*) FROM documents", [], |row| row.get(0))
        .unwrap();
    assert_eq!(documents, 2);
}

#[tokio::test]
async fn store_backup_holds_the_index_writer_and_waits_for_a_running_indexer() {
    let dir = support::workspace(&config("", "[store]\nlock_timeout_ms = 100\n", ALLOW_ALL));
    let host = seeded(dir.path(), T0).await;
    let outside = umbel_store_embedded::TantivyIndex::open(
        &dir.path().join("state/spaces/main"),
        "main",
        umbel_store_embedded::StoreOptions {
            lock_timeout_ms: 100,
        },
    )
    .unwrap();
    let indexer = umbel_store::SearchIndex::writer(&outside).unwrap();
    let busy = call(
        &host,
        human(),
        "store-backup",
        json!({"path": "backups/busy"}),
    )
    .await;
    assert_eq!(busy.error.unwrap().code, "STORE_BUSY");
    assert!(
        !dir.path().join("backups/busy").exists(),
        "nothing half-written"
    );
    drop(indexer);
    // While the backup runs, no indexer can take the writer; afterwards they can.
    let ok = call(
        &host,
        human(),
        "store-backup",
        json!({"path": "backups/ok"}),
    )
    .await;
    assert!(ok.success, "{ok:?}");
    let again = umbel_store::SearchIndex::writer(&outside);
    assert!(again.is_ok());
}
