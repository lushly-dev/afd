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
