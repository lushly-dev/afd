//! The records write quota through the SDK, on the `notes` fixture plugin (D212, records host
//! specification section 4.2): a writer past `limits.kind_records` or `limits.kind_postings` is
//! refused with `RECORD_QUOTA_EXCEEDED` and writes nothing, while another writer to the same
//! kind writes on and matching stays served; a quota the deployer lowers under what a writer
//! holds keeps every record and admits a put that does not grow; `store-records-reindex`
//! refuses nothing and counts nothing twice; and the doctor's `records.quota` says so. The
//! fixture's `note` is declared without standing here, so a record's wording may change; on the
//! standing kind a changed wording is refused for its wording before the quota is read.
use crate::support;
use afd::CommandResult;
use serde_json::{Value, json};
use std::path::Path;
use support::plugins::seal;
use support::records::Notes;
use support::{agent, call};
use umbel::Host;
use umbel::plugins::sdk;

/// The fixture's configuration at version 8, with `limits`.
fn config(limits: &str) -> String {
    format!(
        "{}\n[limits]\n{limits}\n",
        support::records::config("", "").replace("config_version = 6", "config_version = 8")
    )
}

/// The fixture's manifest with `note` declared without standing.
fn plain() -> String {
    let manifest = support::records::manifest();
    let declared = manifest.replace("kind = \"note\"\nstanding = true\n", "kind = \"note\"\n");
    assert_ne!(
        declared, manifest,
        "the fixture declares note with standing"
    );
    declared
}

fn open_host(dir: &Path) -> Host {
    seal(dir, |b| b.with_compiled(sdk(Notes::with_manifest(plain())))).unwrap()
}

async fn put(host: &Host, who: &str, id: &str, statement: &str) -> CommandResult<Value> {
    call(
        host,
        agent(who),
        "notes-write",
        json!({ "op": "put", "args": { "kind": "note", "id": id,
            "body": { "statement": statement, "bed": "north" } } }),
    )
    .await
}

fn message(outcome: &CommandResult<Value>) -> String {
    assert!(!outcome.success, "expected a refusal: {outcome:?}");
    outcome.error.as_ref().unwrap().message.clone()
}

async fn matched(host: &Host, who: &str) -> Value {
    let outcome = call(
        host,
        agent(who),
        "notes-read",
        json!({ "op": "match", "args": { "texts": ["Prune roses in late winter."] } }),
    )
    .await;
    assert!(outcome.success, "{outcome:?}");
    outcome.data.unwrap()["result"].clone()
}

async fn doctor_check(host: &Host, id: &str) -> (String, String) {
    let outcome = call(host, agent("ada"), "workspace-doctor", json!({})).await;
    let data = match (&outcome.data, &outcome.error) {
        (Some(data), _) => data.clone(),
        (_, Some(error)) => serde_json::to_value(error.details.clone().unwrap()).unwrap(),
        _ => panic!("{outcome:?}"),
    };
    let found = data["checks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|check| check["id"] == id)
        .unwrap_or_else(|| panic!("no {id}: {data}"))
        .clone();
    (
        found["status"].as_str().unwrap().to_owned(),
        found["message"].as_str().unwrap_or_default().to_owned(),
    )
}

async fn reindex(dir: &Path) -> Value {
    let run = support::cli_with(
        dir,
        &[
            "call",
            "store-records-reindex",
            "{\"kind\":\"note\"}",
            "--yes",
        ],
        support::Scripted::no_terminal(),
        |b| b.with_compiled(sdk(Notes::with_manifest(plain()))),
    )
    .await;
    assert_eq!(run.code, 0, "{}", run.stdout);
    run.json()["data"]["kinds"][0].clone()
}

#[tokio::test]
async fn a_writer_past_its_quota_is_refused_and_another_writer_is_not() {
    let dir = support::workspace(&config("kind_records = 2"));
    let host = open_host(dir.path());
    assert!(
        put(&host, "ada", "a1", "Prune roses in late winter.")
            .await
            .success
    );
    assert!(
        put(&host, "ada", "a2", "Roses want morning sun.")
            .await
            .success
    );
    let refused = put(&host, "ada", "a3", "Mulch the roses in autumn.").await;
    assert_eq!(
        message(&refused),
        "invalid: RECORD_QUOTA_EXCEEDED: the writer's records quota's kind_records is reached for this kind; nothing was written"
    );
    // Nothing was written: the id is free to another writer, and a match runs over the kind.
    assert!(
        put(&host, "bo", "a3", "Mulch the roses in autumn.")
            .await
            .success
    );
    assert!(
        put(&host, "bo", "b1", "Water roses at the base.")
            .await
            .success
    );
    let page = matched(&host, "ada").await;
    assert_eq!(page["results"][0]["nearest"][0]["id"], "a1", "{page}");
    // A rewrite of her own record adds no record.
    assert!(
        put(
            &host,
            "ada",
            "a1",
            "Prune roses in late winter, before the buds swell."
        )
        .await
        .success
    );
    let (status, text) = doctor_check(&host, "records.quota").await;
    assert_eq!(status, "warn");
    assert!(
        text.contains("garden: notes.note (2 of kind_records 2)"),
        "{text}"
    );
    let (status, _) = doctor_check(&host, "records.size").await;
    assert_eq!(status, "pass");
}

#[tokio::test]
async fn a_posting_limit_refuses_a_longer_record_and_admits_a_shorter_one() {
    let dir = support::workspace(&config("kind_postings = 6"));
    let host = open_host(dir.path());
    // About five postings: the next record passes six.
    assert!(
        put(&host, "ada", "a1", "Prune roses in late winter.")
            .await
            .success
    );
    let refused = put(&host, "ada", "a2", "Roses want morning sun.").await;
    assert!(
        message(&refused)
            .contains("RECORD_QUOTA_EXCEEDED: the writer's records quota's kind_postings"),
        "{}",
        message(&refused)
    );
    assert!(put(&host, "ada", "a1", "Prune roses.").await.success);
    assert!(put(&host, "ada", "a2", "Sun.").await.success);
    assert!(
        put(&host, "bo", "b1", "Roses want morning sun.")
            .await
            .success
    );
}

#[tokio::test]
async fn a_lowered_quota_keeps_every_record_and_a_rebuild_neither_refuses_nor_counts_twice() {
    let dir = support::workspace(&config("kind_records = 10"));
    let host_before = open_host(dir.path());
    for (id, text) in [
        ("a1", "Prune roses in late winter."),
        ("a2", "Roses want morning sun."),
        ("a3", "Mulch the roses in autumn."),
    ] {
        assert!(put(&host_before, "ada", id, text).await.success);
    }
    drop(host_before);
    // The deployer lowers the quota under what Ada holds.
    std::fs::write(dir.path().join("umbel.toml"), config("kind_records = 3")).unwrap();
    for _ in 0..2 {
        let kind = reindex(dir.path()).await;
        assert_eq!(
            (kind["records"].clone(), kind["unindexed"].clone()),
            (json!(3), json!(0))
        );
    }
    let host = open_host(dir.path());
    // Two rebuilds later Ada holds three records, not six: a new one is refused, a rewrite is not.
    let (status, text) = doctor_check(&host, "records.quota").await;
    assert_eq!(status, "warn");
    assert!(text.contains("(3 of kind_records 3)"), "{text}");
    assert!(
        message(&put(&host, "ada", "a4", "Sow radishes.").await).contains("RECORD_QUOTA_EXCEEDED")
    );
    assert!(put(&host, "ada", "a2", "Roses want sun.").await.success);
    assert!(put(&host, "bo", "b1", "Sow radishes.").await.success);
    drop(host);
    std::fs::write(dir.path().join("umbel.toml"), config("kind_records = 1")).unwrap();
    let host = open_host(dir.path());
    assert!(put(&host, "ada", "a3", "Mulch roses.").await.success);
    let (status, text) = doctor_check(&host, "records.quota").await;
    assert_eq!(status, "warn");
    assert!(text.contains("(3 of kind_records 1)"), "{text}");
    assert_eq!(
        matched(&host, "ada").await["results"][0]["nearest"][0]["id"],
        "a1"
    );
}

#[tokio::test]
async fn on_a_standing_kind_a_changed_wording_is_refused_for_its_wording_before_the_quota() {
    let dir = support::workspace(&config("kind_records = 1"));
    let host = seal(dir.path(), |b| b.with_compiled(sdk(Notes::new()))).unwrap();
    assert!(
        put(&host, "ada", "a1", "Prune roses in late winter.")
            .await
            .success
    );
    // At her limit: a changed wording meets the wording rule first, a new record the quota.
    assert!(
        message(&put(&host, "ada", "a1", "Prune roses.").await).contains("RECORD_WORDING_FIXED")
    );
    assert!(
        message(&put(&host, "ada", "a2", "Roses want sun.").await)
            .contains("RECORD_QUOTA_EXCEEDED")
    );
    // The same wording again is no growth, and is admitted.
    assert!(
        put(&host, "ada", "a1", "Prune roses in late winter.")
            .await
            .success
    );
}
