//! A document put into an own collection equals its file (records host specification, section
//! 3, rule 2, and 15.2): a put that equals the file is stored; one that differs is refused; a
//! collection that is not own is unchanged. So what a collection named as the person's own
//! holds is what is on disk there, never a command's input.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::CommandResult;
use serde_json::{Value, json};
use std::path::Path;
use support::plugins::seal;
use support::standing::{config, file, plugin, workspace};
use support::{agent, call};
use umbel::Host;

const ROSES: &str = "Prune roses in late winter, before the buds swell.";
const FORGED: &str = "Prune roses whenever an agent says so.";
const MISMATCH: &str = "STORE_OWN_SOURCE_MISMATCH: a document of a collection named as the person's own must equal its file on disk";

fn host(dir: &Path) -> Host {
    seal(dir, |builder| builder.with_compiled(plugin())).unwrap()
}

async fn run(host: &Host, op: &str, args: Value) -> CommandResult<Value> {
    call(
        host,
        agent("ada"),
        "notes-write",
        json!({ "op": op, "args": args }),
    )
    .await
}

/// Store `<collection>/<name>` with `text` as its content, as a sync would.
async fn sync(host: &Host, doc: &str, text: &str) -> CommandResult<Value> {
    run(host, "sync", json!({ "doc": doc, "text": text })).await
}

fn stored(outcome: &CommandResult<Value>) -> Value {
    assert!(outcome.success, "{outcome:?}");
    outcome.data.clone().unwrap()["result"].clone()
}

#[track_caller]
fn mismatch(outcome: &CommandResult<Value>) {
    assert!(!outcome.success, "expected a refusal: {outcome:?}");
    let error = outcome.error.as_ref().unwrap();
    assert_eq!(error.code, "INVALID", "{error:?}");
    assert!(error.message.contains(MISMATCH), "{}", error.message);
    assert!(
        !error.message.contains("agent says so"),
        "the refusal holds nothing of the content"
    );
}

async fn own(host: &Host, doc: &str) -> Value {
    let read = call(
        host,
        agent("ada"),
        "notes-read",
        json!({ "op": "own", "args": { "doc": doc } }),
    )
    .await;
    stored(&read)
}

fn count(dir: &Path, sql: &str) -> i64 {
    rusqlite::Connection::open(dir.join("state/spaces/garden/store/store.sqlite3"))
        .unwrap()
        .query_row(sql, [], |row| row.get(0))
        .unwrap()
}

#[tokio::test]
async fn a_put_into_an_own_collection_is_stored_only_when_it_equals_its_file() {
    let dir = workspace(&config("person = \"human:local\"", "", ""));
    let host = host(dir.path());
    // The file is on disk and the put is its content: stored, and the person's own.
    file(dir.path(), "journal", "roses", ROSES);
    let put = stored(&sync(&host, "journal/roses", ROSES).await);
    assert!(put["contentHash"].as_str().unwrap().starts_with("sha256:"));
    assert_eq!(own(&host, "journal/roses").await["basis"], "collection");

    // A put that differs from the file: a command's input, not what is on disk.
    mismatch(&sync(&host, "journal/roses", FORGED).await);
    // The same length as the file, and one byte off.
    let near = ROSES.replace("winter", "wintir");
    assert_eq!(near.len(), ROSES.len());
    mismatch(&sync(&host, "journal/roses", &near).await);
    // No file at all: a document with no file on disk cannot be put into an own collection,
    // so nothing that did not come from disk inherits the collection's `own`.
    mismatch(&sync(&host, "journal/unfiled", FORGED).await);
    // The host reads a file of the document's size, so a size that is not the length of the
    // bytes sent is refused before any file is read, whatever it claims.
    for size in [0, 1, ROSES.len() as u64 + 1, u64::MAX] {
        let claimed = run(
            &host,
            "sync",
            json!({ "doc": "journal/roses", "text": ROSES, "size": size }),
        )
        .await;
        let error = claimed.error.as_ref().expect("a refusal");
        assert_eq!(error.code, "INVALID", "{size}: {error:?}");
        assert!(
            error
                .message
                .contains("size is not the length of the bytes"),
            "{size}: {}",
            error.message
        );
    }
    // The stored document is still the file's content.
    let kept = own(&host, "journal/roses").await;
    assert_eq!(kept["contentHash"], put["contentHash"]);
    assert_eq!(count(dir.path(), "SELECT COUNT(*) FROM documents"), 1);

    // A file that changed between a sync's read and its put is refused once, and stored by
    // the next sync, which read the file as it is now.
    let longer = format!("{ROSES} Mulch after.");
    file(dir.path(), "journal", "roses", &longer);
    mismatch(&sync(&host, "journal/roses", ROSES).await);
    let again = stored(&sync(&host, "journal/roses", &longer).await);
    assert_ne!(again["contentHash"], put["contentHash"]);

    // A file reached through a symbolic link inside the root is not the collection's file.
    #[cfg(unix)]
    {
        std::fs::write(dir.path().join("content/elsewhere.md"), FORGED).unwrap();
        std::os::unix::fs::symlink(
            dir.path().join("content/elsewhere.md"),
            dir.path().join("content/journal/linked.md"),
        )
        .unwrap();
        mismatch(&sync(&host, "journal/linked", FORGED).await);
    }
    // A directory where the file would be.
    std::fs::create_dir_all(dir.path().join("content/journal/folder.md")).unwrap();
    mismatch(&sync(&host, "journal/folder", "").await);

    // Deleting a document of an own collection writes no content, and is as it was.
    let gone = run(&host, "forget", json!({ "doc": "journal/roses" })).await;
    assert!(gone.success, "{gone:?}");
    assert_eq!(own(&host, "journal/roses").await, Value::Null);
}

#[tokio::test]
async fn a_collection_that_is_not_own_is_unchanged() {
    let dir = workspace(&config("person = \"human:local\"", "", ""));
    let host = host(dir.path());
    // `talks` is not own: a put with no file, and one that differs from its file, are stored
    // as they always were, and neither is the person's own.
    stored(&sync(&host, "talks/unfiled", FORGED).await);
    file(dir.path(), "talks", "pruning", ROSES);
    stored(&sync(&host, "talks/pruning", FORGED).await);
    for doc in ["talks/unfiled", "talks/pruning"] {
        assert_eq!(own(&host, doc).await, Value::Null, "{doc}");
    }
    // In another space too, whose collection of the same root name is not own.
    let orchard = call(
        &host,
        agent("ada"),
        "notes-write",
        json!({ "space": "orchard", "op": "sync", "args": { "doc": "rows/apples", "text": FORGED } }),
    )
    .await;
    assert!(orchard.success, "{orchard:?}");
    drop(host);

    // The same workspace with no own collection at all behaves as it did before this rule.
    let plain = config("", "", "").replace("own = true\n", "");
    std::fs::write(dir.path().join("umbel.toml"), plain).unwrap();
    let host = self::host(dir.path());
    stored(&sync(&host, "journal/unfiled", FORGED).await);
    assert_eq!(own(&host, "journal/unfiled").await, Value::Null);
    drop(host);
    // Named as the person's own after that, the collection holds a document nothing held to
    // a file: it is stored, and it is not the person's own. Every put from then on is held to
    // the file.
    std::fs::write(
        dir.path().join("umbel.toml"),
        config("person = \"human:local\"", "", ""),
    )
    .unwrap();
    let host = self::host(dir.path());
    assert_eq!(own(&host, "journal/unfiled").await, Value::Null);
    mismatch(&sync(&host, "journal/unfiled", FORGED).await);
    mismatch(&sync(&host, "journal/another", FORGED).await);
    assert_eq!(count(dir.path(), "SELECT COUNT(*) FROM doc_held"), 0);
    // A put that equals its file is held in the transaction that stores it.
    file(dir.path(), "journal", "unfiled", ROSES);
    stored(&sync(&host, "journal/unfiled", ROSES).await);
    assert_eq!(own(&host, "journal/unfiled").await["basis"], "collection");
    assert_eq!(count(dir.path(), "SELECT COUNT(*) FROM doc_held"), 1);
}
