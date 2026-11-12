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
        message.contains("version 99") && message.contains("serves up to version 3"),
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

/// The record lane's checks (records host specification, section 12.3): `records.declared` and
/// `records.size`, which read the lane of each declared kind of each loaded plugin instance, and
/// `records.standing`, which reads the configuration of each space where a standing kind is
/// enabled.
mod records {
    use super::*;
    use support::records::{Notes, config as notes_config, manifest};

    fn notes_host(dir: &Path, manifest: String) -> Host {
        seal(dir, |b| {
            b.with_compiled(sdk(Notes::with_manifest(manifest)))
        })
        .unwrap()
    }

    async fn check(host: &Host, id: &str) -> (String, String, String) {
        let (_, data) = doctor(host).await;
        let found = data["checks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|check| check["id"] == id)
            .unwrap_or_else(|| panic!("no {id}"))
            .clone();
        let text = |key: &str| found[key].as_str().unwrap_or_default().to_owned();
        (text("status"), text("message"), text("suggestion"))
    }

    async fn put(host: &Host, kind: &str, id: &str, body: Value) {
        let args = json!({ "op": "put", "args": { "kind": kind, "id": id, "body": body } });
        let written = call(host, agent("ada"), "notes-write", args).await;
        assert!(written.success, "{written:?}");
    }

    async fn reindex(dir: &Path, manifest: String) -> support::Run {
        support::cli_with(
            dir,
            &["call", "store-records-reindex", "{}", "--yes"],
            support::Scripted::no_terminal(),
            |b| b.with_compiled(sdk(Notes::with_manifest(manifest))),
        )
        .await
    }

    /// The fixture's manifest without its declaration of `note`.
    fn undeclared() -> String {
        let text = manifest();
        let start = text.find("[[records]]\nkind = \"note\"").unwrap();
        let end = text.find("[[records]]\nkind = \"bed\"").unwrap();
        format!("{}{}", &text[..start], &text[end..])
    }

    #[tokio::test]
    async fn the_two_record_checks_pass_before_and_after_a_declared_put() {
        let dir = support::workspace(&notes_config("", ""));
        let host = notes_host(dir.path(), manifest());
        // No space has a store yet, and the doctor gives it none.
        let (status, message, _) = check(&host, "records.declared").await;
        assert_eq!(
            (status.as_str(), message.as_str()),
            ("pass", "No stored space holds a declared record kind")
        );
        assert!(!dir.path().join("state/spaces/garden/store").exists());
        put(
            &host,
            "note",
            "n1",
            json!({ "statement": "Prune roses in late winter." }),
        )
        .await;
        let (status, message, _) = check(&host, "records.declared").await;
        assert_eq!(
            (status.as_str(), message.as_str()),
            ("pass", "2 declared record kind(s) ready"),
            "the garden's two kinds; the orchard has no store"
        );
        let (status, message, _) = check(&host, "records.size").await;
        assert_eq!(
            (status.as_str(), message.as_str()),
            (
                "pass",
                "no declared record kind holds more than 100000 records in a space"
            )
        );
        assert!(!dir.path().join("state/spaces/orchard/store").exists());
    }

    #[tokio::test]
    async fn a_stale_kind_fails_and_an_unindexed_record_warns() {
        let dir = support::workspace(&notes_config("", ""));
        // A version of the plugin that does not declare `note` writes two: one the declaration
        // will admit, and one whose statement is not a string.
        let before = notes_host(dir.path(), undeclared());
        put(
            &before,
            "note",
            "n1",
            json!({ "statement": "Prune roses in late winter." }),
        )
        .await;
        put(
            &before,
            "note",
            "n2",
            json!({ "statement": ["Mulch", "the", "roses"] }),
        )
        .await;
        let (status, _, _) = check(&before, "records.declared").await;
        assert_eq!(
            status, "pass",
            "a kind no manifest declares is not the doctor's"
        );
        drop(before);
        // The next version declares it: the records predate the declaration.
        let host = notes_host(dir.path(), manifest());
        let (status, message, suggestion) = check(&host, "records.declared").await;
        assert_eq!(status, "fail", "{message}");
        assert_eq!(
            message,
            "declared record kinds whose lane must be rebuilt: garden: notes.note"
        );
        assert!(
            suggestion.contains("umbel store-records-reindex"),
            "{suggestion}"
        );
        let outcome = call(&host, agent("a"), "workspace-doctor", json!({})).await;
        assert_eq!(outcome.error.unwrap().code, "WORKSPACE_UNHEALTHY");
        drop(host);
        let rebuilt = reindex(dir.path(), manifest()).await;
        assert_eq!(rebuilt.code, 0, "{}", rebuilt.stdout);
        assert_eq!(rebuilt.json()["data"]["kinds"][0]["unindexed"], 1);
        // Ready, with the one record the declaration does not admit left out and counted.
        let host = notes_host(dir.path(), manifest());
        let (status, message, suggestion) = check(&host, "records.declared").await;
        assert_eq!(status, "warn", "{message}");
        assert!(message.ends_with("garden: notes.note (1)"), "{message}");
        assert!(!message.contains("Mulch"), "{message}");
        assert!(
            suggestion.contains("a text pointer holds a string"),
            "{suggestion}"
        );
        let outcome = call(&host, agent("a"), "workspace-doctor", json!({})).await;
        assert!(outcome.success, "a warning leaves the workspace healthy");
        let warned: Vec<String> = outcome
            .warnings
            .unwrap_or_default()
            .into_iter()
            .map(|warning| warning.code)
            .collect();
        assert!(
            warned.contains(&"DOCTOR_RECORDS_DECLARED".to_owned()),
            "{warned:?}"
        );
        // A put the declaration admits indexes the record, and the warning goes.
        put(
            &host,
            "note",
            "n2",
            json!({ "statement": "Mulch the roses." }),
        )
        .await;
        let (status, message, _) = check(&host, "records.declared").await;
        assert_eq!(status, "pass", "{message}");
    }

    #[tokio::test]
    async fn a_space_with_a_standing_kind_and_no_person_warns_and_each_is_listed() {
        use support::standing::{config, plugin, workspace};
        let writable = "\n[plugins.notes.grants.content_write]\nallow = [\"garden/wiki\"]\n";
        let garden = "person = \"human:local\"\nverified_admits = \"affirmed+attested\"";
        // The garden has its person; the orchard, where the same standing kind is enabled,
        // has none. No space has a store: the check reads the configuration and the manifests.
        let dir = workspace(&config(garden, "", writable));
        let host = seal(dir.path(), |b| b.with_compiled(plugin())).unwrap();
        let (status, message, suggestion) = check(&host, "records.standing").await;
        assert_eq!(status, "warn", "{message}");
        assert!(
            message.starts_with(
                "spaces where a standing record kind is enabled and no person is configured, so no record there can be affirmed or attested: orchard."
            ),
            "{message}"
        );
        assert!(
            message.contains(
                "garden (notes.note): own collections: journal; command-writable collections: wiki; verified_admits: affirmed+attested"
            ),
            "{message}"
        );
        assert!(
            message.contains(
                "orchard (notes.note): own collections: none; command-writable collections: none; verified_admits: affirmed"
            ),
            "{message}"
        );
        assert!(
            !message.contains("human:local"),
            "whether a person is set, never who: {message}"
        );
        assert!(
            suggestion.contains("person = \"human:<id>\""),
            "{suggestion}"
        );
        let outcome = call(&host, agent("a"), "workspace-doctor", json!({})).await;
        assert!(outcome.success, "a warning leaves the workspace healthy");
        drop(host);
        // With a person in each space the check passes, and still lists them.
        let dir = workspace(&config(garden, "person = \"human:rowan\"", writable));
        let host = seal(dir.path(), |b| b.with_compiled(plugin())).unwrap();
        let (status, message, _) = check(&host, "records.standing").await;
        assert_eq!(status, "pass", "{message}");
        assert!(
            message
                .starts_with("every space where a standing record kind is enabled has a person."),
            "{message}"
        );
        assert!(message.contains("orchard (notes.note)"), "{message}");
        // A workspace where no standing kind is enabled has nothing to say.
        let dir = support::workspace(&notes_config("", ""));
        let host = notes_host(dir.path(), undeclared());
        let (status, message, _) = check(&host, "records.standing").await;
        assert_eq!(status, "pass", "{message}");
        assert_eq!(message, "No space enables a standing record kind");
    }
}
