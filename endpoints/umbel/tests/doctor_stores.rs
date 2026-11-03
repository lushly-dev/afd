//! The doctor's store checks (phase 2 specification, section 3.5): `stores.version`,
//! `stores.access` and `stores.lag`, beside the earlier `collections.roots`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use std::io::{Seek, SeekFrom, Write};
use std::path::Path;
use support::plugins::seal;
use support::store::{ALLOW_ALL, StoreProbe, config};
use support::{agent, call};
use umbel::Host;
use umbel::plugins::sdk;

fn host(dir: &Path) -> Host {
    seal(dir, |b| b.with_compiled(sdk(StoreProbe::new()))).unwrap()
}

async fn doctor(host: &Host) -> (String, Value) {
    let outcome = call(host, agent("a"), "workspace-doctor", json!({})).await;
    let data = match (&outcome.data, &outcome.error) {
        (Some(data), _) => data.clone(),
        (_, Some(error)) => serde_json::to_value(error.details.clone().unwrap()).unwrap(),
        _ => panic!("{outcome:?}"),
    };
    let status = |id: &str| {
        data["checks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|check| check["id"] == id)
            .unwrap_or_else(|| panic!("no check {id}: {data}"))
            .clone()
    };
    let summary = [
        "stores.version",
        "stores.access",
        "stores.lag",
        "collections.roots",
    ]
    .map(|id| format!("{id}={}", status(id)["status"].as_str().unwrap()))
    .join(" ");
    (summary, data)
}

fn put(id: &str) -> Value {
    json!({"op": "doc-put", "args": {"id": id, "text": "x"}})
}

#[tokio::test]
async fn a_workspace_with_no_store_yet_passes_and_stays_without_one() {
    let dir = support::workspace(&config("", "", ALLOW_ALL));
    std::fs::create_dir_all(dir.path().join("spaces/main/notes")).unwrap();
    std::fs::create_dir_all(dir.path().join("spaces/beta/notes")).unwrap();
    let host = host(dir.path());
    let (summary, data) = doctor(&host).await;
    assert_eq!(
        summary,
        "stores.version=pass stores.access=pass stores.lag=pass collections.roots=pass"
    );
    let version = data["checks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "stores.version")
        .unwrap();
    assert!(
        version["message"]
            .as_str()
            .unwrap()
            .contains("No space has a store yet")
    );
    assert!(
        !dir.path().join("state/spaces/main/store").exists(),
        "a check creates nothing"
    );
}

#[tokio::test]
async fn lag_is_a_warning_and_a_missing_root_a_failure() {
    let dir = support::workspace(&config("", "", ALLOW_ALL));
    std::fs::create_dir_all(dir.path().join("spaces/main/notes")).unwrap();
    let host = host(dir.path());
    assert!(
        call(&host, agent("a"), "sp-write", put("notes/a"))
            .await
            .success
    );
    let (summary, _) = doctor(&host).await;
    // `beta`'s root does not exist: the failure is collections.roots', and the lag of `main`
    // (a document, no index) is a warning.
    assert_eq!(
        summary,
        "stores.version=pass stores.access=pass stores.lag=warn collections.roots=fail"
    );
}

#[tokio::test]
async fn a_document_with_no_access_token_fails_stores_access() {
    let dir = support::workspace(&config("", "", ALLOW_ALL));
    for space in ["main", "beta"] {
        std::fs::create_dir_all(dir.path().join(format!("spaces/{space}/notes"))).unwrap();
    }
    {
        let host = host(dir.path());
        assert!(
            call(&host, agent("a"), "sp-write", put("notes/a"))
                .await
                .success
        );
    }
    let database = dir.path().join("state/spaces/main/store/store.sqlite3");
    let connection = rusqlite::Connection::open(&database).unwrap();
    connection.execute("DELETE FROM doc_access", []).unwrap();
    drop(connection);
    let host = host(dir.path());
    let (summary, data) = doctor(&host).await;
    assert!(summary.contains("stores.access=fail"), "{summary}");
    let message = data["checks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "stores.access")
        .unwrap()["message"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(message.contains("notes/a"), "{message}");
}

#[tokio::test]
async fn a_store_newer_than_this_build_fails_stores_version() {
    let dir = support::workspace(&config("", "", ALLOW_ALL));
    for space in ["main", "beta"] {
        std::fs::create_dir_all(dir.path().join(format!("spaces/{space}/notes"))).unwrap();
    }
    {
        let host = host(dir.path());
        assert!(
            call(&host, agent("a"), "sp-write", put("notes/a"))
                .await
                .success
        );
        let shown = call(&host, agent("a"), "store-check", json!({})).await;
        assert!(shown.success, "{shown:?}");
    }
    // `PRAGMA user_version` lives at byte 60 of the database header (the WAL was truncated by
    // the check's checkpoint).
    let database = dir.path().join("state/spaces/main/store/store.sqlite3");
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .open(&database)
        .unwrap();
    file.seek(SeekFrom::Start(60)).unwrap();
    file.write_all(&99u32.to_be_bytes()).unwrap();
    drop(file);
    let host = host(dir.path());
    let (summary, data) = doctor(&host).await;
    assert!(summary.contains("stores.version=fail"), "{summary}");
    let message = data["checks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "stores.version")
        .unwrap()["message"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(
        message.contains("version 99") && message.contains("serves up to version 1"),
        "{message}"
    );
}

// ── The memory checks (phase 3 section 5.3) ────────────────────────────────────────────────────

mod memory {
    use super::*;
    use support::memory::{MemoryProbe, NOW, config as memory_config};

    fn memory_host(dir: &Path) -> Host {
        seal(dir, |b| {
            b.with_compiled(sdk(MemoryProbe::new()))
                .with_clock(afd::fixed_clock(NOW))
        })
        .unwrap()
    }

    const IDS: [&str; 7] = [
        "stores.memory",
        "stores.memory_keys",
        "stores.memory_modes",
        "stores.memory_backup",
        "stores.principals",
        "stores.sweep",
        "stores.capture",
    ];

    async fn statuses(host: &Host) -> Vec<(String, String, String)> {
        let (_, data) = doctor(host).await;
        IDS.iter()
            .map(|id| {
                let check = data["checks"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|check| check["id"] == *id)
                    .unwrap_or_else(|| panic!("no {id}"))
                    .clone();
                (
                    (*id).to_owned(),
                    check["status"].as_str().unwrap().to_owned(),
                    check["message"].as_str().unwrap().to_owned(),
                )
            })
            .collect()
    }

    fn status_of(found: &[(String, String, String)], id: &str) -> (String, String) {
        let (_, status, message) = found.iter().find(|(check, ..)| check == id).unwrap();
        (status.clone(), message.clone())
    }

    #[tokio::test]
    async fn the_seven_memory_checks_on_an_unwritten_and_a_written_store() {
        let dir = support::workspace(&memory_config("", "on_behalf_of = \"ada\""));
        let host = memory_host(dir.path());
        let found = statuses(&host).await;
        for (id, status, message) in &found {
            if id != "stores.capture" {
                assert_eq!(status, "pass", "{id}: {message}");
            }
        }
        assert!(
            !dir.path()
                .join("state/spaces/main/store/memory.sqlite3")
                .exists()
        );
        let outcome = call(
            &host,
            afd::Actor::new(afd::ActorKind::Human).with_id("ada"),
            "mem-remember",
            json!({ "space": "main", "args": { "n": 1 } }),
        )
        .await;
        assert!(outcome.success, "{outcome:?}");
        let found = statuses(&host).await;
        for id in [
            "stores.memory",
            "stores.memory_keys",
            "stores.memory_modes",
            "stores.memory_backup",
            "stores.principals",
            "stores.sweep",
        ] {
            let (status, message) = status_of(&found, id);
            assert_eq!(status, "pass", "{id}: {message}");
        }
        assert!(
            status_of(&found, "stores.memory_backup")
                .1
                .contains("store-backup")
        );
    }

    #[tokio::test]
    async fn a_missing_key_file_is_a_failure_naming_its_error() {
        let dir = support::workspace(&memory_config("", "on_behalf_of = \"ada\""));
        let host = memory_host(dir.path());
        let outcome = call(
            &host,
            afd::Actor::new(afd::ActorKind::Human).with_id("ada"),
            "mem-remember",
            json!({ "space": "main", "args": { "n": 1 } }),
        )
        .await;
        assert!(outcome.success);
        drop(host);
        std::fs::remove_file(dir.path().join("state/spaces/main/store/memory.keys")).unwrap();
        let host = memory_host(dir.path());
        let found = statuses(&host).await;
        let (status, message) = status_of(&found, "stores.memory_keys");
        assert_eq!(status, "fail", "{message}");
        assert!(message.contains("MEMORY_KEYS_MISSING"), "{message}");
    }

    #[tokio::test]
    async fn principals_warns_when_on_behalf_of_is_not_local_id() {
        let dir = support::workspace(&memory_config("", ""));
        let host = memory_host(dir.path());
        let (status, message) = status_of(&statuses(&host).await, "stores.principals");
        assert_eq!(status, "warn", "{message}");
        assert!(message.contains("mem"), "{message}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn modes_fail_when_a_memory_file_is_readable_by_others() {
        use std::os::unix::fs::PermissionsExt;
        let dir = support::workspace(&memory_config("", "on_behalf_of = \"ada\""));
        let host = memory_host(dir.path());
        let outcome = call(
            &host,
            afd::Actor::new(afd::ActorKind::Human).with_id("ada"),
            "mem-remember",
            json!({ "space": "main", "args": { "n": 1 } }),
        )
        .await;
        assert!(outcome.success);
        let file = dir.path().join("state/spaces/main/store/memory.keys");
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o644)).unwrap();
        let (status, message) = status_of(&statuses(&host).await, "stores.memory_modes");
        assert_eq!(status, "fail", "{message}");
    }
}
