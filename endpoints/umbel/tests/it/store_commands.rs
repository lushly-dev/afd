//! `store-show`, `store-check` and `store-backup` (phase 2 specification, section 3.5): counts,
//! a corrupted index, a missing journal entry, a recent change that is not reported, and a backup
//! that holds the index writer.
use crate::support;
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
    assert_eq!(data["storeVersion"], 3);
    assert_eq!(data["schemaVersion"], 5);
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
    // A library context that writes the CLI's interface and principal, without the host's seal
    // (phase 5 step 10), is the library's: no totals.
    let host = host_at(dir.path(), T0, StoreProbe::new());
    let mut posing = host
        .context(human())
        .with_interface(afd::CommandInterface::Cli);
    let mut principal = posing.extra["dev.umbel/principal"].clone();
    principal["transport"] = json!("cli");
    principal["authentication"] = json!("process");
    posing
        .extra
        .insert("dev.umbel/principal".to_owned(), principal);
    let shown = host
        .registry()
        .execute("store-show", json!({}), Some(posing))
        .await;
    assert!(shown.success, "{shown:?}");
    let shown = shown.data.unwrap();
    assert_eq!(shown["counts"]["documents"], 1);
    assert!(shown.get("totals").is_none(), "{shown}");
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
    let index = dir.path().join("state/spaces/main/index/v2");
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
    if let Err(error) = crate::schemas::validator("store-backup.v1").validate(&manifest) {
        panic!("{error}: {manifest}");
    }
    assert_eq!(manifest["version"], 1);
    assert_eq!(manifest["space"], "main");
    let files = manifest["files"].as_array().unwrap();
    assert!(files.iter().any(|f| f["path"] == "store.sqlite3"));
    assert!(
        files
            .iter()
            .any(|f| f["path"].as_str().unwrap().starts_with("index/v2/"))
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

/// What a reader sees of `main`: the documents, the changes, a search and the stores' state.
async fn reads(host: &Host) -> Value {
    let mut seen = serde_json::Map::new();
    for (op, args) in [
        ("doc-list", json!({})),
        ("doc-changes", json!({})),
        ("index-search", json!({"text": "alpha"})),
        ("index-applied", json!({})),
        ("graph-applied", json!({})),
    ] {
        let outcome = call(
            host,
            agent("reader"),
            "sp-read",
            json!({"op": op, "args": args}),
        )
        .await;
        assert!(outcome.success, "{op}: {outcome:?}");
        seen.insert(op.to_owned(), outcome.data.unwrap()["result"].clone());
    }
    let shown = call(host, human(), "store-show", json!({})).await;
    let shown = shown.data.unwrap();
    for key in ["head", "counts", "index", "graph"] {
        let mut value = shown[key].clone();
        if let Some(index) = value.as_object_mut() {
            // Sizes and segment layout are the copy's own; what they hold is compared above.
            index.retain(|k, _| !k.ends_with("Bytes") && k != "segments");
        }
        seen.insert(format!("store-show.{key}"), value);
    }
    Value::Object(seen)
}

#[tokio::test]
async fn store_restore_puts_a_backup_back_and_reads_the_same() {
    let dir = workspace();
    let host = seeded(dir.path(), T0).await;
    let before = reads(&host).await;
    let backup = call(
        &host,
        human(),
        "store-backup",
        json!({"path": "backups/one"}),
    )
    .await;
    assert!(backup.success, "{backup:?}");
    // A restore over the live stores is refused, and writes nothing.
    let refused = call(
        &host,
        human(),
        "store-restore",
        json!({"path": "backups/one"}),
    )
    .await;
    assert_eq!(refused.error.unwrap().code, "STORE_RESTORE_NOT_EMPTY");
    drop(host);
    // The space is lost.
    let space = dir.path().join("state/spaces/main");
    std::fs::remove_dir_all(space.join("store")).unwrap();
    std::fs::remove_dir_all(space.join("index")).unwrap();
    let host = host_at(dir.path(), T0, StoreProbe::new());
    let restored = call(
        &host,
        human(),
        "store-restore",
        json!({"path": "backups/one"}),
    )
    .await;
    assert!(restored.success, "{restored:?}");
    let data = restored.data.clone().unwrap();
    assert_eq!(data["healthy"], true, "{data}");
    assert_eq!(data["memory"], false);
    assert_eq!(data["memoryKeys"], "none");
    assert_eq!(reads(&host).await, before);
    assert!(!space.join(".restore-staging").exists());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(space.join("store/store.sqlite3"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o077, 0, "the restored store is private");
    }
    // It writes after the restore as before it.
    put(&host, "notes/c", json!(["space"])).await;
    // It is a mutation that is not projected into an event.
    assert!(
        support::events(dir.path(), "main")
            .iter()
            .all(|e| e["command"] != "store-restore")
    );
}

#[tokio::test]
async fn store_restore_refuses_a_damaged_backup_and_writes_nothing() {
    let dir = workspace();
    let host = seeded(dir.path(), T0).await;
    let backup = call(
        &host,
        human(),
        "store-backup",
        json!({"path": "backups/one"}),
    )
    .await;
    assert!(backup.success, "{backup:?}");
    drop(host);
    let space = dir.path().join("state/spaces/main");
    std::fs::remove_dir_all(space.join("store")).unwrap();
    std::fs::remove_dir_all(space.join("index")).unwrap();
    let copy = dir.path().join("backups/one");
    let manifest_path = copy.join("manifest.json");
    let manifest = std::fs::read(&manifest_path).unwrap();
    let host = host_at(dir.path(), T0, StoreProbe::new());
    let restore = |path: &'static str| {
        let host = &host;
        async move { call(host, human(), "store-restore", json!({"path": path})).await }
    };
    let code = |outcome: CommandResult<Value>| outcome.error.unwrap().code;
    // A byte changed in an index file: its digest fails, and nothing is left behind.
    let index_file = std::fs::read_dir(copy.join("index/v2"))
        .unwrap()
        .flatten()
        .find(|entry| entry.path().extension().is_some_and(|ext| ext == "idx"))
        .unwrap()
        .path();
    let original = std::fs::read(&index_file).unwrap();
    let mut changed = original.clone();
    changed[0] ^= 0xff;
    std::fs::write(&index_file, &changed).unwrap();
    assert_eq!(code(restore("backups/one").await), "STORE_BACKUP_DAMAGED");
    assert!(!space.join("store/store.sqlite3").exists());
    assert!(
        std::fs::read_dir(space.join("index/v2"))
            .map(|mut dir| dir.next().is_none())
            .unwrap_or(true)
    );
    std::fs::write(&index_file, &original).unwrap();
    // The same bytes behind a link: a restore reads only regular files inside the backup.
    #[cfg(unix)]
    {
        let outside = dir.path().join("outside.idx");
        std::fs::write(&outside, &original).unwrap();
        std::fs::remove_file(&index_file).unwrap();
        std::os::unix::fs::symlink(&outside, &index_file).unwrap();
        assert_eq!(code(restore("backups/one").await), "STORE_BACKUP_DAMAGED");
        std::fs::remove_file(&index_file).unwrap();
        std::fs::write(&index_file, &original).unwrap();
    }
    // A rollback journal left from the database that was there would be applied over the copy.
    std::fs::create_dir_all(space.join("store")).unwrap();
    let stale = space.join("store/store.sqlite3-journal");
    std::fs::write(&stale, b"stale").unwrap();
    assert_eq!(
        code(restore("backups/one").await),
        "STORE_RESTORE_NOT_EMPTY"
    );
    std::fs::remove_file(&stale).unwrap();
    // A manifest that names a file outside the backup, of another space, or of another version.
    let edited = |edit: &dyn Fn(&mut Value)| {
        let mut value: Value = serde_json::from_slice(&manifest).unwrap();
        edit(&mut value);
        std::fs::write(&manifest_path, serde_json::to_vec(&value).unwrap()).unwrap();
    };
    edited(&|m| m["files"][0]["path"] = json!("../../umbel.toml"));
    assert_eq!(code(restore("backups/one").await), "STORE_BACKUP_DAMAGED");
    edited(&|m| m["files"][0]["path"] = json!("state.json"));
    assert_eq!(code(restore("backups/one").await), "STORE_BACKUP_DAMAGED");
    edited(&|m| m["space"] = json!("other"));
    assert_eq!(
        code(restore("backups/one").await),
        "STORE_RESTORE_SPACE_MISMATCH"
    );
    edited(&|m| m["version"] = json!(2));
    assert_eq!(
        code(restore("backups/one").await),
        "STORE_BACKUP_UNSUPPORTED"
    );
    // A path outside the workspace, in state/ or absent.
    for path in ["../elsewhere", "state/spaces", "backups/none"] {
        let refused = call(&host, human(), "store-restore", json!({"path": path})).await;
        assert_eq!(refused.error.unwrap().code, "VALIDATION_ERROR", "{path}");
    }
    assert!(!space.join("store/store.sqlite3").exists());
    // As written, it restores.
    std::fs::write(&manifest_path, &manifest).unwrap();
    let restored = restore("backups/one").await;
    assert!(restored.success, "{restored:?}");
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

// ── The memory store (phase 3 sections 5.3 and 5.4) ───────────────────────────────────────────

mod memory {
    use super::*;
    use support::memory::{MemoryProbe, NOW, config as memory_config};
    use support::{Scripted, cli_with};

    fn ada() -> Actor {
        Actor::new(ActorKind::Human).with_id("ada")
    }

    fn memory_host(dir: &Path) -> Host {
        HostBuilder::open(dir)
            .unwrap()
            .with_compiled(sdk(MemoryProbe::new()))
            .with_clock(fixed_clock(NOW))
            .seal()
            .unwrap()
    }

    async fn remember(host: &Host, n: u64) -> String {
        let outcome = call(
            host,
            ada(),
            "mem-remember",
            json!({ "space": "main", "args": { "n": n, "text": format!("memory text {n}") } }),
        )
        .await;
        assert!(outcome.success, "{outcome:?}");
        outcome.data.unwrap()["ids"][0].as_str().unwrap().to_owned()
    }

    async fn store_cli(dir: &Path, words: &[&str]) -> support::Run {
        cli_with(dir, words, Scripted::no_terminal(), |b| {
            b.with_compiled(sdk(MemoryProbe::new()))
                .with_clock(fixed_clock(NOW))
        })
        .await
    }

    fn check_status(run: &support::Run, id: &str) -> (String, String) {
        let value = run.json();
        let checks = if value["success"] == true {
            value["data"]["checks"].clone()
        } else {
            value["error"]["details"]["checks"].clone()
        };
        let found = checks
            .as_array()
            .unwrap()
            .iter()
            .find(|check| check["id"] == id)
            .unwrap_or_else(|| panic!("no {id}: {value}"))
            .clone();
        (
            found["status"].as_str().unwrap().to_owned(),
            found["message"].as_str().unwrap().to_owned(),
        )
    }

    fn sqlite(path: &Path) -> rusqlite::Connection {
        rusqlite::Connection::open(path).unwrap()
    }

    fn store_dir(dir: &Path) -> std::path::PathBuf {
        dir.join("state/spaces/main/store")
    }

    #[tokio::test]
    async fn store_show_reports_memory_without_creating_it() {
        let dir = support::workspace(&memory_config("", ""));
        let host = memory_host(dir.path());
        let shown = call(&host, ada(), "store-show", json!({})).await;
        assert_eq!(
            shown.data.unwrap()["memory"],
            json!({ "provisioned": false })
        );
        assert!(!store_dir(dir.path()).join("memory.sqlite3").exists());
        remember(&host, 1).await;
        let shown = call(&host, ada(), "store-show", json!({}))
            .await
            .data
            .unwrap();
        let memory = &shown["memory"];
        assert_eq!(memory["provisioned"], true);
        assert_eq!(memory["keyFile"], "present");
        assert_eq!(memory["counts"]["byClass"]["semantic"]["live"], 1);
        assert!(memory["files"]["keysBytes"].as_u64().unwrap() > 0);
        assert!(
            memory.get("head").is_none(),
            "a library caller is not the CLI's person"
        );
        // Another reader counts nothing of ada's private record.
        let bo = call(
            &host,
            Actor::new(ActorKind::Human).with_id("bo"),
            "store-show",
            json!({}),
        )
        .await;
        assert_eq!(
            bo.data.unwrap()["memory"]["counts"]["byClass"]["semantic"]["live"],
            0
        );
        drop(host);
        let run = store_cli(dir.path(), &["store", "show"]).await;
        assert_eq!(run.json()["data"]["memory"]["head"], 1, "{}", run.stdout);
    }

    #[tokio::test]
    async fn store_check_finds_a_damaged_index_a_missing_key_and_a_failed_seal() {
        let dir = support::workspace(&memory_config("", ""));
        let host = memory_host(dir.path());
        let first = remember(&host, 1).await;
        let second = remember(&host, 2).await;
        let third = remember(&host, 3).await;
        drop(host);
        let healthy = store_cli(dir.path(), &["store", "check"]).await;
        assert_eq!(healthy.code, 0, "{}", healthy.stdout);
        for id in [
            "store.memory",
            "store.memory_keys",
            "store.memory_index",
            "store.memory_access",
            "store.memory_rows",
            "store.memory_journal",
        ] {
            assert_eq!(
                check_status(&healthy, id).0,
                "pass",
                "{id}: {}",
                healthy.stdout
            );
        }
        // A damaged lexical lane: a row in the index that no record has.
        sqlite(&store_dir(dir.path()).join("memory.sqlite3"))
            .execute(
                "INSERT INTO records_fts (rowid, subject, tags, text) VALUES (999, 'x', 'x', 'x')",
                [],
            )
            .unwrap();
        let damaged = store_cli(dir.path(), &["store", "check"]).await;
        assert_eq!(damaged.code, 1);
        assert_eq!(check_status(&damaged, "store.memory_index").0, "fail");
        sqlite(&store_dir(dir.path()).join("memory.sqlite3"))
            .execute("DELETE FROM records_fts WHERE rowid = 999", [])
            .unwrap();
        // A missing key entry and a failed seal.
        sqlite(&store_dir(dir.path()).join("memory.keys"))
            .execute("DELETE FROM record_keys WHERE id = ?1", [&first])
            .unwrap();
        sqlite(&store_dir(dir.path()).join("memory.sqlite3"))
            .execute(
                "UPDATE records SET sealed = CAST(zeroblob(64) AS BLOB) WHERE id = ?1",
                [&second],
            )
            .unwrap();
        let broken = store_cli(dir.path(), &["store", "check"]).await;
        let (status, message) = check_status(&broken, "store.memory_rows");
        assert_eq!(status, "fail", "{message}");
        assert!(
            message.contains("1 with no key entry") && message.contains("1 whose seal fails"),
            "{message}"
        );
        // After memory-reindex skipped both rows, the counts agree and the rows are still a finding.
        let host = memory_host(dir.path());
        let reindex = call(
            &host,
            ada(),
            "mem-change",
            json!({ "space": "main", "args": { "op": "reindex" } }),
        )
        .await;
        assert_eq!(reindex.data.unwrap()["result"], 1, "only {third} reindexed");
        drop(host);
        let after = store_cli(dir.path(), &["store", "check"]).await;
        assert_eq!(
            check_status(&after, "store.memory_index").0,
            "pass",
            "{}",
            after.stdout
        );
        assert_eq!(check_status(&after, "store.memory_rows").0, "fail");
    }

    #[tokio::test]
    async fn store_check_tells_the_deployer_to_keep_the_memory_files_when_the_stores_do_not_open() {
        let dir = support::workspace(&memory_config("", ""));
        let host = memory_host(dir.path());
        remember(&host, 1).await;
        drop(host);
        std::fs::write(
            store_dir(dir.path()).join("store.sqlite3"),
            b"not a database",
        )
        .unwrap();
        let run = store_cli(dir.path(), &["store", "check"]).await;
        let suggestion = run.json()["error"]["suggestion"]
            .as_str()
            .unwrap_or_default()
            .to_owned();
        assert_eq!(
            suggestion,
            "Restore state/spaces from a backup. To derive the knowledge stores again, move store.sqlite3 and the index aside and run sources-sync and knowledge-index rebuild=true. Keep memory.sqlite3 and memory.keys: memory cannot be derived.",
            "{}",
            run.stdout
        );
    }

    async fn show(host: &Host, id: String) -> Value {
        let outcome = call(
            host,
            ada(),
            "mem-read",
            json!({ "space": "main", "args": { "op": "show", "id": id } }),
        )
        .await;
        assert!(outcome.success, "{outcome:?}");
        outcome.data.unwrap()["result"].clone()
    }

    #[tokio::test]
    async fn store_restore_puts_memory_back_and_reads_it_with_the_key_file_kept_apart() {
        let dir = support::workspace(&memory_config("", ""));
        let host = memory_host(dir.path());
        let first = remember(&host, 1).await;
        let second = remember(&host, 2).await;
        let before = (
            show(&host, first.clone()).await,
            show(&host, second.clone()).await,
        );
        drop(host);
        let run = store_cli(dir.path(), &["store", "backup", "path=backups/one"]).await;
        assert_eq!(run.code, 0, "{}", run.stdout);
        // The space is lost but for the key file, which the deployer keeps apart (D82).
        let store = store_dir(dir.path());
        let keys = std::fs::read(store.join("memory.keys")).unwrap();
        std::fs::remove_dir_all(&store).unwrap();
        std::fs::remove_dir_all(dir.path().join("state/spaces/main/index")).unwrap();
        // Restored without it, memory is in place and the result says what is missing.
        let run = store_cli(dir.path(), &["store", "restore", "path=backups/one"]).await;
        let value = run.json();
        assert_eq!(value["data"]["memory"], true, "{value}");
        assert_eq!(value["data"]["memoryKeys"], "missing", "{value}");
        assert!(
            value["warnings"]
                .as_array()
                .unwrap()
                .iter()
                .any(|w| w["code"] == "MEMORY_KEYS_MISSING"),
            "{value}"
        );
        // With the key file back, memory reads as before, its index rebuilt on open.
        std::fs::write(store.join("memory.keys"), &keys).unwrap();
        let healthy = store_cli(dir.path(), &["store", "check"]).await;
        assert_eq!(healthy.code, 0, "{}", healthy.stdout);
        let host = memory_host(dir.path());
        assert_eq!(
            (show(&host, first).await, show(&host, second).await),
            before
        );
    }

    /// Every file under `dir`, by its path relative to it.
    fn files_under(dir: &Path) -> Vec<String> {
        let mut found = Vec::new();
        let mut stack = vec![dir.to_path_buf()];
        while let Some(next) = stack.pop() {
            for entry in std::fs::read_dir(&next).into_iter().flatten().flatten() {
                if entry.path().is_dir() {
                    stack.push(entry.path());
                } else {
                    let relative = entry.path().strip_prefix(dir).unwrap().to_path_buf();
                    found.push(relative.to_string_lossy().replace('\\', "/"));
                }
            }
        }
        found.sort();
        found
    }

    #[tokio::test]
    async fn workspace_restore_puts_a_workspace_backup_back_into_a_new_workspace() {
        let dir = support::workspace(&memory_config("", ""));
        let host = memory_host(dir.path());
        let first = remember(&host, 1).await;
        let second = remember(&host, 2).await;
        let before = (
            show(&host, first.clone()).await,
            show(&host, second.clone()).await,
        );
        drop(host);
        let events_before = support::events(dir.path(), "main");
        assert!(!events_before.is_empty());
        // As `umbel init` leaves it, with a cursor temporary a reader left mid-write.
        std::fs::write(dir.path().join("state/.gitignore"), "*\n").unwrap();
        let cursors = dir.path().join("state/spaces/main/cursors");
        std::fs::create_dir_all(&cursors).unwrap();
        std::fs::write(cursors.join(".abc.1.t.tmp"), b"{").unwrap();
        let run = store_cli(dir.path(), &["workspace", "backup", "path=backups/w"]).await;
        assert_eq!(run.code, 0, "{}", run.stdout);
        let value = run.json();
        assert_eq!(
            value["warnings"][0]["code"], "MEMORY_KEYS_NOT_BACKED_UP",
            "{value}"
        );
        let backup = dir.path().join("backups/w");
        let manifest: Value =
            serde_json::from_slice(&std::fs::read(backup.join("manifest.json")).unwrap()).unwrap();
        if let Err(error) = crate::schemas::validator("workspace-backup.v1").validate(&manifest) {
            panic!("{error}: {manifest}");
        }
        // The journal, the events, the stores and memory are in it; no key file is.
        let kinds: Vec<&str> = manifest["files"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| f["kind"].as_str().unwrap())
            .collect();
        for kind in ["journal", "events", "store", "memory", "index"] {
            assert!(kinds.contains(&kind), "{kind}: {manifest}");
        }
        let copied = files_under(&backup);
        for name in &copied {
            assert!(
                !name.starts_with("state/keys") && !name.ends_with("memory.keys"),
                "{name} is a key file"
            );
            assert!(!name.contains("/."), "{name} is a hidden file");
        }
        let keys: Vec<&str> = manifest["keys"]
            .as_array()
            .unwrap()
            .iter()
            .map(|k| k["path"].as_str().unwrap())
            .collect();
        assert!(
            keys.contains(&"state/spaces/main/store/memory.keys"),
            "{keys:?}"
        );
        assert!(keys.contains(&"state/keys/approval.key"), "{keys:?}");
        // Every listed file is there with its digest.
        for file in manifest["files"].as_array().unwrap() {
            let bytes = std::fs::read(backup.join(file["path"].as_str().unwrap())).unwrap();
            assert_eq!(
                file["sha256"],
                umbel_store::ContentHash::of(&bytes).to_string()
            );
        }
        // Over the workspace it was taken from, a restore is refused.
        let refused = store_cli(dir.path(), &["workspace", "restore", "path=backups/w"]).await;
        assert_eq!(
            refused.json()["error"]["code"],
            "STORE_RESTORE_NOT_EMPTY",
            "{}",
            refused.stdout
        );
        // A store backup restore refuses a workspace backup.
        let refused = store_cli(dir.path(), &["store", "restore", "path=backups/w"]).await;
        assert_eq!(
            refused.json()["error"]["code"],
            "STORE_BACKUP_UNSUPPORTED",
            "{}",
            refused.stdout
        );

        // A new workspace as `umbel init` leaves it, the same configuration, and the key files the
        // deployer kept apart.
        let fresh = support::workspace(&memory_config("", ""));
        std::fs::create_dir_all(fresh.path().join("state")).unwrap();
        std::fs::write(fresh.path().join("state/.gitignore"), "*\n").unwrap();
        let copy_tree = |from: &Path, to: &Path| {
            for name in files_under(from) {
                let target = to.join(&name);
                std::fs::create_dir_all(target.parent().unwrap()).unwrap();
                std::fs::copy(from.join(&name), target).unwrap();
            }
        };
        // A first attempt, before the backup is there, fails and is journaled.
        let early = store_cli(fresh.path(), &["workspace", "restore", "path=backups/w"]).await;
        assert_eq!(
            early.json()["error"]["code"],
            "VALIDATION_ERROR",
            "{}",
            early.stdout
        );
        let journaled_first =
            std::fs::read_to_string(fresh.path().join("state/journal.jsonl")).unwrap_or_default();
        assert!(
            !journaled_first.is_empty(),
            "the failed attempt is journaled"
        );
        // And a line cut short by a crash mid-append, which the merge drops.
        let mut torn = std::fs::OpenOptions::new()
            .append(true)
            .open(fresh.path().join("state/journal.jsonl"))
            .unwrap();
        std::io::Write::write_all(&mut torn, b"{\"seq\":").unwrap();
        drop(torn);
        copy_tree(&backup, &fresh.path().join("backups/w"));
        copy_tree(
            &dir.path().join("state/keys"),
            &fresh.path().join("state/keys"),
        );
        let keys_file = fresh.path().join("state/spaces/main/store/memory.keys");
        std::fs::create_dir_all(keys_file.parent().unwrap()).unwrap();
        std::fs::copy(store_dir(dir.path()).join("memory.keys"), &keys_file).unwrap();
        let run = store_cli(fresh.path(), &["workspace", "restore", "path=backups/w"]).await;
        assert_eq!(run.code, 0, "{}", run.stdout);
        let value = run.json();
        assert_eq!(value["data"]["spaces"][0]["healthy"], true, "{value}");
        assert_eq!(
            value["data"]["spaces"][0]["memoryKeys"], "present",
            "{value}"
        );
        assert_eq!(
            value["data"]["keysMissing"].as_array().unwrap().len(),
            0,
            "{value}"
        );
        // The journal and events read as they did, and so does memory.
        let journal = std::fs::read_to_string(fresh.path().join("state/journal.jsonl")).unwrap();
        let backed_up = std::fs::read_to_string(backup.join("state/journal.jsonl")).unwrap();
        // The backup's journal, then what the new workspace journaled before the restore, then
        // the restore's own entry.
        let without_seq = |text: &str| -> Vec<Value> {
            text.lines()
                .filter_map(|line| serde_json::from_str::<Value>(line).ok())
                .map(|mut entry| {
                    entry.as_object_mut().unwrap().remove("seq");
                    entry
                })
                .collect()
        };
        assert!(journal.starts_with(&backed_up));
        let after = without_seq(&journal[backed_up.len()..]);
        let earlier = without_seq(&journaled_first);
        assert_eq!(after[..earlier.len()], earlier[..]);
        assert_eq!(
            after.len(),
            earlier.len() + 1,
            "and the restore's own entry"
        );
        assert_eq!(support::events(fresh.path(), "main"), events_before);
        let host = memory_host(fresh.path());
        assert_eq!(
            (show(&host, first).await, show(&host, second).await),
            before
        );
        // The journal's numbers run on from the backup's, so a write after the restore is
        // projected into the restored stream like any other.
        let seqs: Vec<u64> = journal
            .lines()
            .filter_map(|line| serde_json::from_str::<Value>(line).ok())
            .filter_map(|entry| entry["seq"].as_u64())
            .collect();
        assert!(seqs.windows(2).all(|pair| pair[0] < pair[1]), "{seqs:?}");
        remember(&host, 3).await;
        assert_eq!(
            support::events(fresh.path(), "main").len(),
            events_before.len() + 1
        );
    }

    #[tokio::test]
    async fn workspace_restore_refuses_a_manifest_that_reaches_past_what_a_backup_holds() {
        let dir = support::workspace(&memory_config("", ""));
        let host = memory_host(dir.path());
        remember(&host, 1).await;
        drop(host);
        let run = store_cli(dir.path(), &["workspace", "backup", "path=backups/w"]).await;
        assert_eq!(run.code, 0, "{}", run.stdout);
        let backup = dir.path().join("backups/w");
        let manifest_path = backup.join("manifest.json");
        let manifest: Value =
            serde_json::from_slice(&std::fs::read(&manifest_path).unwrap()).unwrap();
        let fresh = support::workspace(&memory_config("", ""));
        let target = fresh.path().join("backups/w");
        let edited = |edit: &dyn Fn(&mut Value)| {
            for name in files_under(&backup) {
                let to = target.join(&name);
                std::fs::create_dir_all(to.parent().unwrap()).unwrap();
                std::fs::copy(backup.join(&name), to).unwrap();
            }
            let mut value = manifest.clone();
            edit(&mut value);
            std::fs::write(
                target.join("manifest.json"),
                serde_json::to_vec(&value).unwrap(),
            )
            .unwrap();
        };
        let journal = |m: &mut Value| {
            m["files"]
                .as_array_mut()
                .unwrap()
                .iter_mut()
                .find(|f| f["kind"] == "journal")
                .unwrap()
                .clone()
        };
        let restore = || async {
            let run = store_cli(fresh.path(), &["workspace", "restore", "path=backups/w"]).await;
            run.json()["error"]["code"]
                .as_str()
                .unwrap_or("none")
                .to_owned()
        };
        // A key file under another case, the lock, a derived file, another kind, a duplicate.
        for (path, kind) in [
            ("state/Keys/http.token", "state"),
            ("state/keys/http.token", "state"),
            ("state/lock", "state"),
            ("state/spaces/main/events.idx", "state"),
            ("state/journal.jsonl", "state"),
        ] {
            edited(&|m| {
                let mut entry = journal(m);
                entry["path"] = json!(path);
                entry["kind"] = json!(kind);
                m["files"].as_array_mut().unwrap().push(entry);
            });
            assert_eq!(restore().await, "STORE_BACKUP_DAMAGED", "{path}");
        }
        edited(&|m| {
            let entry = journal(m);
            m["files"].as_array_mut().unwrap().push(entry);
        });
        assert_eq!(restore().await, "STORE_BACKUP_DAMAGED", "a duplicate");
        // Events of a space this workspace does not declare.
        edited(&|m| {
            let mut entry = journal(m);
            entry["path"] = json!("state/spaces/other/events.jsonl");
            entry["kind"] = json!("events");
            m["files"].as_array_mut().unwrap().push(entry);
        });
        assert_eq!(restore().await, "STORE_RESTORE_SPACE_MISMATCH");
        // A digest that does not match.
        edited(&|m| {
            let files = m["files"].as_array_mut().unwrap();
            let entry = files.iter_mut().find(|f| f["kind"] == "journal").unwrap();
            entry["sha256"] = json!(format!("sha256:{}", "0".repeat(64)));
        });
        assert_eq!(restore().await, "STORE_BACKUP_DAMAGED");
        // None of it left anything behind: as written, it restores.
        assert!(!fresh.path().join("state/spaces/main/events.jsonl").exists());
        assert!(
            !fresh
                .path()
                .join("state/spaces/main/store/store.sqlite3")
                .exists()
        );
        edited(&|_| {});
        assert_eq!(restore().await, "none");
    }

    #[tokio::test]
    async fn store_backup_copies_memory_without_its_keys_or_index_and_says_so() {
        let dir = support::workspace(&memory_config("", ""));
        let host = memory_host(dir.path());
        let outcome = call(
            &host,
            ada(),
            "mem-remember",
            json!({ "space": "main", "args": { "n": 1, "text": "canarybackupzq" } }),
        )
        .await;
        assert!(outcome.success);
        drop(host);
        let run = store_cli(dir.path(), &["store", "backup", "path=backups/one"]).await;
        assert_eq!(run.code, 0, "{}", run.stdout);
        let value = run.json();
        assert_eq!(
            value["warnings"][0]["code"], "MEMORY_KEYS_NOT_BACKED_UP",
            "{value}"
        );
        let target = dir.path().join("backups/one");
        assert!(target.join("memory.sqlite3").is_file());
        assert!(!target.join("memory.keys").exists());
        let manifest: Value =
            serde_json::from_slice(&std::fs::read(target.join("manifest.json")).unwrap()).unwrap();
        assert_eq!(manifest["memoryKeys"], "excluded");
        assert_eq!(manifest["memoryFts"], "excluded");
        assert!(
            manifest["files"]
                .as_array()
                .unwrap()
                .iter()
                .any(|f| f["path"] == "memory.sqlite3")
        );
        for entry in std::fs::read_dir(&target).unwrap().flatten() {
            if entry.path().is_file() {
                let bytes = std::fs::read(entry.path()).unwrap();
                assert!(
                    !bytes.windows(14).any(|w| w == b"canarybackupzq"),
                    "{} holds the canary",
                    entry.path().display()
                );
            }
        }
        // Before any memory write, a backup has no memory and no warning.
        let empty = support::workspace(&memory_config("", ""));
        let run = store_cli(empty.path(), &["store", "backup", "path=backups/two"]).await;
        assert_eq!(run.code, 0, "{}", run.stdout);
        assert!(run.json()["warnings"].is_null());
        assert!(!empty.path().join("backups/two/memory.sqlite3").exists());
    }
}
