//! The ten store grants (phase 2 specification, section 3.3): each granted, denied and withheld;
//! write grants without an `allow` list, with entries outside the instance's spaces, and writes
//! outside `allow`; derivation reads; provenance enforcement; the revisions a call wrote; the
//! gate's allow-list; `replay: "recorded"`; `spaces` checked like `space`; the error mapping.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::CommandResult;
use serde_json::{Value, json};
use std::path::Path;
use support::plugins::{metadata, seal};
use support::store::{ALL_GRANTS, ALLOW_ALL, ALLOW_MAIN, StoreProbe, config};
use support::{agent, call, events};
use umbel::plugins::sdk;
use umbel::{Host, HostBuilder};

fn make(config_text: &str, probe: StoreProbe) -> (tempfile::TempDir, Host) {
    let dir = support::workspace(config_text);
    let host = seal(dir.path(), |b| b.with_compiled(sdk(probe))).unwrap();
    (dir, host)
}

fn standard() -> (tempfile::TempDir, Host) {
    make(&config("", "", ALLOW_ALL), StoreProbe::new())
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

fn code(outcome: &CommandResult<Value>) -> String {
    assert!(!outcome.success, "expected a failure: {outcome:?}");
    outcome.error.as_ref().unwrap().code.clone()
}

fn message(outcome: &CommandResult<Value>) -> String {
    outcome.error.as_ref().unwrap().message.clone()
}

fn put(id: &str, text: &str) -> Value {
    json!({ "id": id, "text": text })
}

#[tokio::test]
async fn a_plugin_without_a_grant_cannot_reach_the_store() {
    // The plugin declares nothing: every store method answers NotGranted, and no store is even
    // created (the grants decide, not the plugin's code).
    let (dir, host) = make(&config("", "", ""), StoreProbe::with_grants(&[], true));
    for op in [
        "doc-get",
        "doc-list",
        "doc-changes",
        "record-list",
        "index-search",
        "index-applied",
        "graph-nodes",
        "graph-subgraph",
        "content-list",
    ] {
        let outcome = run(
            &host,
            "sp-read",
            "main",
            op,
            json!({"id": "notes/a", "collection": "notes"}),
        )
        .await;
        assert_eq!(code(&outcome), "NOT_GRANTED", "{op}: {outcome:?}");
    }
    for op in ["doc-put", "record-put", "index-writer", "graph-apply"] {
        let outcome = run(&host, "sp-write", "main", op, put("notes/a", "x")).await;
        assert_eq!(code(&outcome), "NOT_GRANTED", "{op}: {outcome:?}");
    }
    let files = run(
        &host,
        "sp-files",
        "main",
        "content-replace",
        json!({"collection": "notes", "path": "a.md", "text": "x"}),
    )
    .await;
    assert_eq!(code(&files), "NOT_GRANTED");
    assert!(!dir.path().join("state/spaces/main/store").exists());
    assert!(!dir.path().join("state/spaces/main/index").exists());
}

#[tokio::test]
async fn a_read_grant_alone_reads_and_writes_stay_refused() {
    let (_dir, host) = make(
        &config("", "", ""),
        StoreProbe::with_grants(&["documents", "index", "graph", "records", "content"], true),
    );
    assert_eq!(
        result(&run(&host, "sp-read", "main", "doc-list", json!({})).await),
        json!([])
    );
    let put = run(&host, "sp-write", "main", "doc-put", put("notes/a", "x")).await;
    assert_eq!(code(&put), "NOT_GRANTED");
    let rec = run(
        &host,
        "sp-write",
        "main",
        "record-put",
        json!({"kind": "k", "id": "i"}),
    )
    .await;
    assert_eq!(code(&rec), "NOT_GRANTED");
}

#[test]
fn a_required_write_grant_without_an_allow_list_fails_the_load() {
    for grant in [
        "content_write",
        "documents_write",
        "records_write",
        "index_write",
        "graph_write",
    ] {
        let dir = support::workspace(&config("", "", ""));
        let error = seal(dir.path(), |b| {
            b.with_compiled(sdk(StoreProbe::with_grants(&[grant], true)))
        })
        .err()
        .unwrap_or_else(|| panic!("{grant} loaded without an allow list"));
        assert_eq!(error.code(), "PLUGIN_GRANT_DENIED", "{grant}");
        assert!(error.message().contains("allow list"), "{error}");
        assert!(error.suggestion().contains("allow"), "{error}");
    }
}

#[tokio::test]
async fn an_optional_write_grant_without_allow_is_withheld_and_a_read_grant_needs_none() {
    let (_dir, host) = make(
        &config("", "", ""),
        StoreProbe::with_grants(&["documents", "documents_write"], false),
    );
    // Read granted, write withheld: the load succeeded.
    assert!(
        run(&host, "sp-read", "main", "doc-list", json!({}))
            .await
            .success
    );
    let outcome = run(&host, "sp-write", "main", "doc-put", put("notes/a", "x")).await;
    assert_eq!(code(&outcome), "NOT_GRANTED");
    let show = call(&host, agent("a"), "plugin-show", json!({"plugin": "sp"})).await;
    let text = serde_json::to_string(&show).unwrap();
    assert!(text.contains("needs an allow list"), "{text}");
}

#[test]
fn an_allow_entry_naming_a_space_the_instance_is_not_enabled_for_denies_the_grant() {
    let text = config(
        "",
        "",
        "spaces = [\"main\"]\n[plugins.sp.grants.documents_write]\nallow = [\"main/*\", \"beta/*\"]\n",
    );
    let dir = support::workspace(&text);
    let error = seal(dir.path(), |b| {
        b.with_compiled(sdk(StoreProbe::with_grants(&["documents_write"], true)))
    })
    .err()
    .unwrap();
    assert_eq!(error.code(), "PLUGIN_GRANT_DENIED");
    assert!(error.message().contains("beta/*"), "{error}");
}

#[tokio::test]
async fn a_write_outside_allow_is_store_write_not_allowed() {
    let text = config(
        "",
        "",
        "[plugins.sp.grants.documents_write]\nallow = [\"main/notes\"]\n[plugins.sp.grants.records_write]\nallow = [\"beta\"]\n[plugins.sp.grants.content_write]\nallow = [\"main/notes\"]\n[plugins.sp.grants.index_write]\nallow = [\"main\"]\n[plugins.sp.grants.graph_write]\nallow = [\"main\"]\n",
    );
    let (_dir, host) = make(&text, StoreProbe::new());
    assert!(
        run(&host, "sp-write", "main", "doc-put", put("notes/a", "x"))
            .await
            .success
    );
    // Another collection of an allowed space, and another space.
    let other = run(
        &host,
        "sp-write",
        "main",
        "doc-put",
        put("elsewhere/a", "x"),
    )
    .await;
    assert_eq!(code(&other), "NOT_GRANTED");
    assert!(
        message(&other).contains("STORE_WRITE_NOT_ALLOWED"),
        "{other:?}"
    );
    let beta = run(&host, "sp-write", "beta", "doc-put", put("notes/a", "x")).await;
    assert!(
        message(&beta).contains("STORE_WRITE_NOT_ALLOWED"),
        "{beta:?}"
    );
    // The same for records (beta only), the index and the graph.
    let record = run(
        &host,
        "sp-write",
        "main",
        "record-put",
        json!({"kind": "k", "id": "i", "access": ["space"]}),
    )
    .await;
    assert!(
        message(&record).contains("STORE_WRITE_NOT_ALLOWED"),
        "{record:?}"
    );
    let writer = run(&host, "sp-write", "beta", "index-writer", json!({})).await;
    assert!(
        message(&writer).contains("STORE_WRITE_NOT_ALLOWED"),
        "{writer:?}"
    );
    let graph = run(&host, "sp-write", "beta", "graph-apply", json!({})).await;
    assert!(
        message(&graph).contains("STORE_WRITE_NOT_ALLOWED"),
        "{graph:?}"
    );
    // A delete is a write too.
    let delete = run(
        &host,
        "sp-write",
        "main",
        "doc-delete",
        put("elsewhere/a", "x"),
    )
    .await;
    assert!(
        message(&delete).contains("STORE_WRITE_NOT_ALLOWED"),
        "{delete:?}"
    );
    let file = run(
        &host,
        "sp-files",
        "main",
        "content-replace",
        json!({"collection": "other", "path": "a.md", "text": "x"}),
    )
    .await;
    assert!(
        message(&file).contains("STORE_WRITE_NOT_ALLOWED"),
        "{file:?}"
    );
}

#[tokio::test]
async fn documents_records_the_index_and_the_graph_round_trip() {
    let (_dir, host) = standard();
    let first = run(
        &host,
        "sp-write",
        "main",
        "doc-put",
        put("notes/a", "alpha"),
    )
    .await;
    assert_eq!(result(&first)["rev"], 1);
    let listed = run(&host, "sp-read", "main", "doc-list", json!({})).await;
    assert_eq!(result(&listed), json!(["notes/a"]));
    let got = run(
        &host,
        "sp-read",
        "main",
        "doc-get",
        json!({"id": "notes/a"}),
    )
    .await;
    assert_eq!(result(&got), json!("notes/a"));
    let record = run(
        &host,
        "sp-write",
        "main",
        "record-put",
        json!({"kind": "sync", "id": "main/notes", "body": {"n": 1}}),
    )
    .await;
    assert!(record.success, "{record:?}");
    let body = run(
        &host,
        "sp-read",
        "main",
        "record-get",
        json!({"kind": "sync", "id": "main/notes"}),
    )
    .await;
    assert_eq!(result(&body), json!({"n": 1}));
    let indexed = run(
        &host,
        "sp-write",
        "main",
        "index-replace",
        json!({"id": "notes/a", "text": "alpha bravo", "applied": 2}),
    )
    .await;
    assert!(indexed.success, "{indexed:?}");
    let found = run(
        &host,
        "sp-read",
        "main",
        "index-search",
        json!({"text": "bravo"}),
    )
    .await;
    assert_eq!(result(&found), json!(["notes/a"]));
    assert_eq!(
        result(&run(&host, "sp-read", "main", "index-applied", json!({})).await),
        json!(2)
    );
    let graph = run(
        &host,
        "sp-write",
        "main",
        "graph-apply",
        json!({"applied": 2}),
    )
    .await;
    assert!(graph.success, "{graph:?}");
}

#[tokio::test]
async fn provenance_is_filled_from_the_call_and_the_store_refuses_what_it_must_hold() {
    let (_dir, host) = standard();
    run(
        &host,
        "sp-write",
        "main",
        "doc-put",
        put("notes/a", "alpha"),
    )
    .await;
    let envelope = result(
        &run(
            &host,
            "sp-read",
            "main",
            "doc-envelope",
            json!({"id": "notes/a"}),
        )
        .await,
    );
    // The plugin sent a forged principal, plugin and trace id; the host overwrote them.
    assert_eq!(envelope["principal"], "agent:a");
    assert_eq!(envelope["plugin"], "sp");
    assert_ne!(envelope["traceId"], "forged");
    assert_eq!(envelope["space"], "main");
    assert_eq!(envelope["agent"]["kind"], "agent");
    assert_eq!(envelope["agent"]["id"], "a");

    let mut unspecified = put("notes/b", "x");
    unspecified["origin"] = json!("unspecified");
    let refused = run(&host, "sp-write", "main", "doc-put", unspecified).await;
    assert_eq!(code(&refused), "INVALID");
    assert!(
        message(&refused).contains("STORE_PROVENANCE_REQUIRED"),
        "{refused:?}"
    );
    let mut missing = put("notes/c", "x");
    missing["no_sensitivity"] = json!(true);
    let refused = run(&host, "sp-write", "main", "doc-put", missing).await;
    assert!(
        message(&refused).contains("STORE_PROVENANCE_REQUIRED"),
        "{refused:?}"
    );
    // Nothing was written by either.
    let listed = run(&host, "sp-read", "main", "doc-list", json!({})).await;
    assert_eq!(result(&listed), json!(["notes/a"]));
}

#[tokio::test]
async fn the_gate_sets_changes_from_what_the_call_wrote_and_the_event_carries_them() {
    let (dir, host) = standard();
    let outcome = run(
        &host,
        "sp-write",
        "main",
        "doc-put-two",
        json!({"ids": ["notes/a", "notes/b"], "text": "x"}),
    )
    .await;
    assert!(outcome.success, "{outcome:?}");
    assert_eq!(
        metadata(&outcome)["dev.umbel/changes"],
        json!({"fromRev": 1, "toRev": 2, "count": 2})
    );
    let stream = events(dir.path(), "main");
    assert_eq!(stream.len(), 1);
    assert_eq!(stream[0]["version"], 1);
    assert_eq!(
        stream[0]["changes"],
        json!({"fromRev": 1, "toRev": 2, "count": 2})
    );
    // A read has none; a failed write sets none.
    let read = run(&host, "sp-read", "main", "doc-list", json!({})).await;
    assert!(metadata(&read).get("dev.umbel/changes").is_none());
    let failed = run(
        &host,
        "sp-write",
        "main",
        "doc-put-absent",
        put("notes/a", "x"),
    )
    .await;
    assert_eq!(code(&failed), "CONFLICT");
    assert!(metadata(&failed).get("dev.umbel/changes").is_none());
}

#[tokio::test]
async fn host_owned_keys_cannot_be_forged_through_the_gate() {
    let (dir, host) = standard();
    let forged = run(&host, "sp-forge", "main", "x", json!({})).await;
    assert!(forged.success, "{forged:?}");
    let meta = metadata(&forged);
    // `dev.umbel/changes` is the host's: the forged range is gone (nothing was written).
    assert!(meta.get("dev.umbel/changes").is_none(), "{meta}");
    // `dev.umbel/trust` keeps only the value "content"; "trusted" is dropped.
    assert!(meta.get("dev.umbel/trust").is_none(), "{meta}");
    // `dev.umbel/index` is kept for the call's spaces only: `main`, not `other`.
    assert_eq!(
        meta["dev.umbel/index"],
        json!({"main": {"applied": 1, "head": 2, "schema": 1}})
    );
    assert!(meta.get("dev.umbel/replay").is_none(), "{meta}");
    // The mutation and event version are the host's, whatever the plugin said.
    assert_eq!(meta["dev.umbel/mutation"], json!(true));
    assert_eq!(meta["dev.umbel/event-version"], json!(1));
    assert_eq!(meta["dev.umbel/plugin"]["id"], "sp");
    let stream = events(dir.path(), "main");
    assert_eq!(stream[0]["version"], 1);
    assert!(stream[0].get("changes").is_none(), "{:?}", stream[0]);
}

#[tokio::test]
async fn a_store_backed_result_is_recorded_and_other_results_replay() {
    let (_dir, host) = standard();
    let used = run(&host, "sp-read", "main", "doc-list", json!({})).await;
    assert_eq!(metadata(&used)["dev.umbel/replay"], "recorded");
    let wrote = run(&host, "sp-write", "main", "doc-put", put("notes/a", "x")).await;
    assert_eq!(metadata(&wrote)["dev.umbel/replay"], "recorded");
    let denied = run(
        &host,
        "sp-read",
        "main",
        "index-search",
        json!({"text": "x"}),
    )
    .await;
    assert!(denied.success);
    // A call that touched no store is replayable.
    let spaces = call(&host, agent("a"), "sp-read", json!({"op": "spaces"})).await;
    assert!(
        metadata(&spaces).get("dev.umbel/replay").is_none(),
        "{spaces:?}"
    );
}

#[tokio::test]
async fn spaces_is_checked_like_space() {
    let (_dir, host) = standard();
    let both = call(
        &host,
        agent("a"),
        "sp-read",
        json!({"spaces": ["main", "beta"], "op": "spaces"}),
    )
    .await;
    assert_eq!(result(&both), json!(["main", "beta"]));
    // Neither: the default space; `space` alone: that one.
    let default = call(&host, agent("a"), "sp-read", json!({"op": "spaces"})).await;
    assert_eq!(result(&default), json!(["main"]));
    let one = call(
        &host,
        agent("a"),
        "sp-read",
        json!({"space": "beta", "op": "spaces"}),
    )
    .await;
    assert_eq!(result(&one), json!(["beta"]));
    // An undeclared entry, both properties, an empty list and a repeat are refused before the handler.
    let unknown = call(
        &host,
        agent("a"),
        "sp-read",
        json!({"spaces": ["main", "nowhere"], "op": "spaces"}),
    )
    .await;
    assert_eq!(code(&unknown), "SPACE_NOT_FOUND");
    let given_both = call(
        &host,
        agent("a"),
        "sp-read",
        json!({"space": "main", "spaces": ["beta"], "op": "spaces"}),
    )
    .await;
    assert_eq!(code(&given_both), "VALIDATION_ERROR");
    let empty = call(
        &host,
        agent("a"),
        "sp-read",
        json!({"spaces": [], "op": "spaces"}),
    )
    .await;
    assert_eq!(code(&empty), "VALIDATION_ERROR");
    let repeated = call(
        &host,
        agent("a"),
        "sp-read",
        json!({"spaces": ["main", "main"], "op": "spaces"}),
    )
    .await;
    assert_eq!(code(&repeated), "VALIDATION_ERROR");
}

#[tokio::test]
async fn the_gate_checks_the_instance_is_enabled_for_every_space_of_spaces() {
    let text = config("", "", &format!("spaces = [\"main\"]\n{ALLOW_MAIN}"));
    let (_dir, host) = make(&text, StoreProbe::new());
    let refused = call(
        &host,
        agent("a"),
        "sp-read",
        json!({"spaces": ["main", "beta"], "op": "spaces"}),
    )
    .await;
    assert_eq!(code(&refused), "PLUGIN_NOT_ENABLED");
    let ok = call(
        &host,
        agent("a"),
        "sp-read",
        json!({"spaces": ["main"], "op": "spaces"}),
    )
    .await;
    assert!(ok.success, "{ok:?}");
}

#[tokio::test]
async fn the_store_methods_refuse_a_space_outside_the_calls_spaces() {
    let (_dir, host) = standard();
    // The call names `main`; the plugin asks for `beta` explicitly.
    let outcome = call(
        &host,
        agent("a"),
        "sp-read",
        json!({"space": "main", "op": "doc-list", "args": {}}),
    )
    .await;
    assert!(outcome.success);
    let bound = call(
        &host,
        agent("a"),
        "sp-read",
        json!({"space": "main", "op": "in-space", "args": {"space": "beta"}}),
    )
    .await;
    assert_eq!(code(&bound), "NOT_GRANTED");
    let bound_ok = call(
        &host,
        agent("a"),
        "sp-read",
        json!({"spaces": ["main", "beta"], "op": "in-space", "args": {"space": "beta"}}),
    )
    .await;
    assert_eq!(result(&bound_ok), json!([]));
}

#[tokio::test]
async fn derivation_reads_need_a_store_write_command_and_a_write_grant_for_the_space() {
    let (_dir, host) = standard();
    // Restricted content: the reader (an agent) cannot read it.
    let restricted = json!({"id": "notes/secret", "text": "x", "access": ["group:platform"]});
    assert!(
        run(&host, "sp-write", "main", "doc-put", restricted)
            .await
            .success
    );
    let plain = run(&host, "sp-read", "main", "doc-list", json!({})).await;
    assert_eq!(result(&plain), json!([]));
    // `sp-read` has no `store-write` effect: refused with STORE_WRITE_NOT_ALLOWED.
    let refused = run(&host, "sp-read", "main", "derive-changes", json!({})).await;
    assert_eq!(code(&refused), "NOT_GRANTED");
    assert!(
        message(&refused).contains("STORE_WRITE_NOT_ALLOWED"),
        "{refused:?}"
    );
    // `sp-write` has it, and reads everything.
    let derived = run(&host, "sp-write", "main", "derive-changes", json!({})).await;
    assert_eq!(result(&derived), json!(["notes/secret"]));
    let document = run(
        &host,
        "sp-write",
        "main",
        "derive-document",
        json!({"id": "notes/secret"}),
    )
    .await;
    assert_eq!(result(&document), json!("notes/secret"));
}

#[tokio::test]
async fn a_derivation_read_of_a_space_the_write_grants_do_not_allow_is_refused() {
    let text = config(
        "",
        "",
        "[plugins.sp.grants.index_write]\nallow = [\"main\"]\n[plugins.sp.grants.documents_write]\nallow = [\"main/*\", \"beta/*\"]\n",
    );
    let (_dir, host) = make(
        &text,
        StoreProbe::with_grants(&["documents", "documents_write", "index_write"], true),
    );
    assert!(
        run(&host, "sp-write", "main", "derive-changes", json!({}))
            .await
            .success
    );
    let beta = run(&host, "sp-write", "beta", "derive-changes", json!({})).await;
    assert!(
        message(&beta).contains("STORE_WRITE_NOT_ALLOWED"),
        "{beta:?}"
    );
}

#[tokio::test]
async fn store_errors_map_to_the_sdks_host_error() {
    let (dir, host) = make(
        &config("", "[store]\nlock_timeout_ms = 100\n", ALLOW_ALL),
        StoreProbe::new(),
    );
    // Conflict: a second write that expected the document absent.
    assert!(
        run(
            &host,
            "sp-write",
            "main",
            "doc-put-absent",
            put("notes/a", "x")
        )
        .await
        .success
    );
    let conflict = run(
        &host,
        "sp-write",
        "main",
        "doc-put-absent",
        put("notes/a", "y"),
    )
    .await;
    assert_eq!(code(&conflict), "CONFLICT");
    // Invalid: a query the index refuses.
    let invalid = run(
        &host,
        "sp-read",
        "main",
        "index-search",
        json!({"text": "access:space"}),
    )
    .await;
    assert_eq!(code(&invalid), "INVALID");
    // Busy: another holder has the index writer and the wait runs out.
    let outside = umbel_store_embedded::TantivyIndex::open(
        &dir.path().join("state/spaces/main"),
        "main",
        umbel_store_embedded::StoreOptions {
            lock_timeout_ms: 100,
        },
    )
    .unwrap();
    let held = umbel_store::SearchIndex::writer(&outside).unwrap();
    let busy = run(&host, "sp-write", "main", "index-writer", json!({})).await;
    assert_eq!(code(&busy), "BUSY");
    drop(held);
    let free = run(&host, "sp-write", "main", "index-writer", json!({})).await;
    assert!(free.success, "{free:?}");
}

#[tokio::test]
async fn the_content_grants_are_confined_to_the_collection_roots() {
    let (dir, host) = standard();
    let root = dir.path().join("spaces/main/notes");
    std::fs::create_dir_all(root.join("sub")).unwrap();
    std::fs::write(root.join("a.md"), "alpha").unwrap();
    std::fs::write(root.join("sub/b.md"), "bravo").unwrap();
    std::fs::write(dir.path().join("secret.txt"), "outside").unwrap();
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(dir.path().join("secret.txt"), root.join("link.md")).unwrap();
        std::os::unix::fs::symlink(dir.path(), root.join("up")).unwrap();
    }
    let listed = run(
        &host,
        "sp-read",
        "main",
        "content-list",
        json!({"collection": "notes"}),
    )
    .await;
    assert_eq!(
        result(&listed),
        json!(["a.md", "sub/b.md"]),
        "links are not followed"
    );
    let read = run(
        &host,
        "sp-read",
        "main",
        "content-read",
        json!({"collection": "notes", "path": "sub/b.md"}),
    )
    .await;
    assert_eq!(result(&read), json!("bravo"));
    for path in [
        "../secret.txt",
        "/etc/passwd",
        "sub/../../../secret.txt",
        "link.md",
        "up/secret.txt",
    ] {
        let outcome = run(
            &host,
            "sp-read",
            "main",
            "content-read",
            json!({"collection": "notes", "path": path}),
        )
        .await;
        assert!(!outcome.success, "{path}: {outcome:?}");
    }
    let unknown = run(
        &host,
        "sp-read",
        "main",
        "content-list",
        json!({"collection": "nowhere"}),
    )
    .await;
    assert_eq!(code(&unknown), "NOT_FOUND");
}

#[tokio::test]
async fn content_replace_writes_atomically_after_checking_the_expected_hash() {
    let (dir, host) = standard();
    let target = dir.path().join("spaces/main/notes/new.md");
    std::fs::create_dir_all(target.parent().unwrap()).unwrap();
    let args = |text: &str, expect: Option<&str>, path: &str| {
        let mut args = json!({"collection": "notes", "path": path, "text": text});
        if let Some(expect) = expect {
            args["expect"] = json!(expect);
        }
        args
    };
    let created = run(
        &host,
        "sp-files",
        "main",
        "content-replace",
        args("one", Some("absent"), "new.md"),
    )
    .await;
    let hash = result(&created).as_str().unwrap().to_owned();
    assert_eq!(std::fs::read_to_string(&target).unwrap(), "one");
    // Absent no longer holds, and a stale hash is a Conflict naming the current hash.
    let again = run(
        &host,
        "sp-files",
        "main",
        "content-replace",
        args("two", Some("absent"), "new.md"),
    )
    .await;
    assert_eq!(code(&again), "CONFLICT");
    let stale = run(
        &host,
        "sp-files",
        "main",
        "content-replace",
        args("two", Some(&format!("sha256:{}", "0".repeat(64))), "new.md"),
    )
    .await;
    assert_eq!(code(&stale), "CONFLICT");
    assert!(message(&stale).contains(&hash), "{stale:?}");
    assert_eq!(std::fs::read_to_string(&target).unwrap(), "one");
    let replaced = run(
        &host,
        "sp-files",
        "main",
        "content-replace",
        args("two", Some(&hash), "new.md"),
    )
    .await;
    assert!(replaced.success, "{replaced:?}");
    assert_eq!(std::fs::read_to_string(&target).unwrap(), "two");
    // No temporary file is left behind.
    let leftovers: Vec<_> = std::fs::read_dir(target.parent().unwrap())
        .unwrap()
        .filter_map(Result::ok)
        .filter(|e| e.file_name().to_string_lossy().starts_with(".umbel-write-"))
        .collect();
    assert!(leftovers.is_empty());
    // Reserved names, non-markdown files and escapes are never written.
    for path in ["index.md", "sub/log.md", "note.txt", "../x.md", "/abs.md"] {
        let outcome = run(
            &host,
            "sp-files",
            "main",
            "content-replace",
            args("x", None, path),
        )
        .await;
        assert!(!outcome.success, "{path}: {outcome:?}");
    }
    assert!(!dir.path().join("spaces/main/x.md").exists());
    // A new file in a new directory of the root.
    let nested = run(
        &host,
        "sp-files",
        "main",
        "content-replace",
        args("deep", None, "a/b/c.md"),
    )
    .await;
    assert!(nested.success, "{nested:?}");
    assert_eq!(
        std::fs::read_to_string(dir.path().join("spaces/main/notes/a/b/c.md")).unwrap(),
        "deep"
    );
}

#[tokio::test]
async fn a_second_process_style_open_of_the_same_stores_sees_the_writes() {
    // The host opens each space's stores once per process; a second host over the same workspace
    // (as `umbel serve` beside a CLI call) reads what the first wrote.
    let (dir, host) = standard();
    assert!(
        run(&host, "sp-write", "main", "doc-put", put("notes/a", "x"))
            .await
            .success
    );
    let second = HostBuilder::open(dir.path())
        .unwrap()
        .with_compiled(sdk(StoreProbe::new()))
        .seal()
        .unwrap();
    let listed = run(&second, "sp-read", "main", "doc-list", json!({})).await;
    assert_eq!(result(&listed), json!(["notes/a"]));
    let _ = ALL_GRANTS;
    let _: &Path = dir.path();
}
