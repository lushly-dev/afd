//! The reporting checkpoint service, `truncate_wal` (phase 4 specification, section 9.1): a
//! command that removed text, as the knowledge plugin's redaction does, learns whether the removed
//! bytes are gone from `store.sqlite3` and its write-ahead log (`Clean`) or wait for a later
//! checkpoint because a reader holds the log (`Pending`). It needs what `checkpoint` needs: a write
//! grant allowed for the space, in one of the call's spaces.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::CommandResult;
use serde_json::{Value, json};
use support::plugins::seal;
use support::store::{ALLOW_ALL, StoreProbe, config};
use support::{agent, call};
use umbel::Host;
use umbel::plugins::sdk;

fn make(config_text: &str, probe: StoreProbe) -> (tempfile::TempDir, Host) {
    let dir = support::workspace(config_text);
    let host = seal(dir.path(), |b| b.with_compiled(sdk(probe))).unwrap();
    (dir, host)
}

async fn run(
    host: &Host,
    command: &str,
    space: &str,
    op: &str,
    args: Value,
) -> CommandResult<Value> {
    call(
        host,
        agent("a"),
        command,
        json!({ "space": space, "op": op, "args": args }),
    )
    .await
}

fn result(outcome: &CommandResult<Value>) -> Value {
    assert!(outcome.success, "{outcome:?}");
    outcome.data.clone().unwrap()["result"].clone()
}

#[tokio::test]
async fn a_reporting_checkpoint_answers_clean_or_pending() {
    let (dir, host) = make(&config("", "", ALLOW_ALL), StoreProbe::new());
    let put = |id: &str| json!({ "kind": "note", "id": id, "body": { "n": id } });
    assert!(
        run(&host, "sp-write", "main", "record-put", put("r1"))
            .await
            .success
    );
    assert_eq!(
        result(&run(&host, "sp-write", "main", "truncate-wal", json!({})).await),
        json!("clean")
    );

    // A reader holding a snapshot of the log: the frames of a later write cannot be truncated.
    let path = dir.path().join("state/spaces/main/store/store.sqlite3");
    let reader = rusqlite::Connection::open(&path).unwrap();
    reader
        .execute_batch("BEGIN; SELECT count(*) FROM records;")
        .unwrap();
    assert!(
        run(&host, "sp-write", "main", "record-put", put("r2"))
            .await
            .success
    );
    assert_eq!(
        result(&run(&host, "sp-write", "main", "truncate-wal", json!({})).await),
        json!("pending")
    );
    reader.execute_batch("COMMIT").unwrap();
    assert_eq!(
        result(&run(&host, "sp-write", "main", "truncate-wal", json!({})).await),
        json!("clean")
    );
}

#[tokio::test]
async fn a_reporting_checkpoint_needs_a_write_grant_allowed_for_the_space() {
    // A read-only instance holds no write grant.
    let (_dir, read_only) = make(
        &config("", "", ""),
        StoreProbe::with_grants(&["documents", "records", "index", "graph"], true),
    );
    let refused = run(&read_only, "sp-read", "main", "truncate-wal", json!({})).await;
    assert!(!refused.success, "{refused:?}");
    let error = refused.error.unwrap();
    assert_eq!(error.code, "NOT_GRANTED");
    assert!(
        error.message.contains("STORE_WRITE_NOT_ALLOWED"),
        "{error:?}"
    );

    // A write grant allowed for another space does not reach this one.
    let text = config(
        "",
        "",
        "[plugins.sp.grants.records_write]\nallow = [\"main\"]\n",
    );
    let (_dir, narrow) = make(&text, StoreProbe::with_grants(&["records_write"], true));
    assert_eq!(
        result(&run(&narrow, "sp-write", "main", "truncate-wal", json!({})).await),
        json!("clean")
    );
    let beta = run(&narrow, "sp-write", "beta", "truncate-wal", json!({})).await;
    assert!(!beta.success, "{beta:?}");
    assert!(
        beta.error
            .unwrap()
            .message
            .contains("STORE_WRITE_NOT_ALLOWED"),
        "the space beta is not allowed"
    );
}
