//! `knowledge-open`, `-find`, `-describe`, `-list` and `-changes` (specification sections 8.3 and
//! 8.5): windows, locators, `DOCUMENT_CHANGED`, find limits and the readable-only reads.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::*;

fn numbered(count: usize) -> String {
    (1..=count).map(|n| format!("line {n} of text\n")).collect()
}

async fn open(fx: &Fx, input: Value) -> Value {
    fx.as_actor(human("local"), "knowledge-open", input).await
}

async fn indexed_doc(path: &str, text: &str) -> Fx {
    let fx = Fx::new();
    fx.handbook(path, text);
    fx.refresh("main").await;
    fx
}

#[tokio::test]
async fn a_window_reads_lines_and_points_to_the_next_and_previous() {
    let fx = indexed_doc("long.md", &numbered(300)).await;
    let first = open(&fx, json!({ "doc": "handbook/long" })).await;
    let window = data(&first);
    assert_eq!(window["window"], json!({ "start": 1, "end": 120 }));
    assert_eq!(window["totalLines"], 300);
    assert_eq!(window["nextFromLine"], 121);
    assert_eq!(window["prevFromLine"], Value::Null);
    assert_eq!(window["trust"], "content");
    let text = window["text"].as_str().unwrap();
    assert!(
        text.starts_with("line 1 of text\n") && text.ends_with("line 120 of text"),
        "{text}"
    );

    let second = open(
        &fx,
        json!({ "doc": "handbook/long", "from_line": 121, "lines": 50 }),
    )
    .await;
    let window = data(&second);
    assert_eq!(window["window"], json!({ "start": 121, "end": 170 }));
    assert_eq!(window["prevFromLine"], 71);
    assert_eq!(window["nextFromLine"], 171);

    let last = open(
        &fx,
        json!({ "doc": "handbook/long", "from_line": 290, "lines": 400 }),
    )
    .await;
    let window = data(&last);
    assert_eq!(window["window"], json!({ "start": 290, "end": 300 }));
    assert_eq!(window["nextFromLine"], Value::Null);

    let past = open(&fx, json!({ "doc": "handbook/long", "from_line": 301 })).await;
    assert_eq!(code(&past), "WINDOW_OUT_OF_RANGE");
}

#[tokio::test]
async fn a_chunk_a_heading_and_a_locator_each_place_the_window() {
    let doc = format!(
        "# Top\n\n## Alpha\n\n{}\n\n## Beta\n\nbeta text one\nbeta text two\n",
        (0..260)
            .map(|n| format!("a{n}"))
            .collect::<Vec<_>>()
            .join(" ")
    );
    let fx = indexed_doc("sections.md", &doc).await;
    let by_heading = open(
        &fx,
        json!({ "doc": "handbook/sections", "heading": "beta" }),
    )
    .await;
    let window = data(&by_heading);
    assert!(window["text"].as_str().unwrap().contains("beta text two"));
    assert!(!window["text"].as_str().unwrap().contains("a10 "));
    assert_eq!(window["headingPath"], json!(["Top", "Beta"]));
    let missing = open(
        &fx,
        json!({ "doc": "handbook/sections", "heading": "nope" }),
    )
    .await;
    assert_eq!(code(&missing), "HEADING_NOT_FOUND");

    // The detailed search hit gives a chunk ordinal and a locator.
    let found = fx
        .search(
            human("local"),
            json!({ "query": "a10", "format": "detailed" }),
        )
        .await;
    let hit = &data(&found)["hits"][0];
    let ordinal = hit["chunks"][0]["ordinal"].as_u64().unwrap();
    let by_chunk = open(&fx, json!({ "doc": "handbook/sections", "chunk": ordinal })).await;
    assert!(
        data(&by_chunk)["text"].as_str().unwrap().contains("a10 "),
        "{by_chunk}"
    );
    let no_chunk = open(&fx, json!({ "doc": "handbook/sections", "chunk": 99 })).await;
    assert_eq!(code(&no_chunk), "CHUNK_NOT_FOUND");

    let by_locator = open(&fx, json!({ "locator": hit["locator"] })).await;
    assert_eq!(data(&by_locator)["text"], data(&by_chunk)["text"]);
    assert!(warning(&by_locator, "DOCUMENT_CHANGED").is_none());
}

#[tokio::test]
async fn a_changed_document_is_served_with_a_warning() {
    let fx = indexed_doc("note.md", "# Note\n\nfirst version\n").await;
    let found = fx.search(human("local"), json!({ "query": "first" })).await;
    let locator = data(&found)["hits"][0]["locator"]
        .as_str()
        .unwrap()
        .to_owned();
    fx.handbook("note.md", "# Note\n\nsecond version\n");
    fx.cli("sources-sync", json!({})).await;
    let opened = open(&fx, json!({ "locator": locator })).await;
    assert!(
        data(&opened)["text"]
            .as_str()
            .unwrap()
            .contains("second version"),
        "{opened}"
    );
    let changed = warning(&opened, "DOCUMENT_CHANGED").expect("changed");
    assert!(
        changed["details"]["contentHash"]
            .as_str()
            .unwrap()
            .starts_with("sha256:")
    );

    // The hash alone does the same.
    let current = data(&opened)["contentHash"].as_str().unwrap().to_owned();
    let same = open(
        &fx,
        json!({ "doc": "handbook/note", "expect_hash": current }),
    )
    .await;
    assert!(warning(&same, "DOCUMENT_CHANGED").is_none());
    let other = open(
        &fx,
        json!({ "doc": "handbook/note", "expect_hash": format!("sha256:{}", "0".repeat(64)) }),
    )
    .await;
    assert!(warning(&other, "DOCUMENT_CHANGED").is_some());
}

#[tokio::test]
async fn arguments_that_conflict_are_refused() {
    let fx = indexed_doc("note.md", "# Note\n\ntext\n").await;
    for input in [
        json!({}),
        json!({ "doc": "handbook/note", "locator": "umbel:main/handbook/note#L1-L2@aaaaaaaaaaaa" }),
        json!({ "doc": "handbook/note", "from_line": 1, "heading": "note" }),
        json!({ "doc": "handbook/note", "chunk": 0, "heading": "note" }),
    ] {
        let result = open(&fx, input.clone()).await;
        assert_eq!(code(&result), "OPEN_ARGUMENTS_INVALID", "{input}: {result}");
    }
    let bad = open(&fx, json!({ "locator": "not a locator" })).await;
    assert_eq!(code(&bad), "LOCATOR_INVALID");
    let other_space = open(
        &fx,
        json!({ "locator": "umbel:beta/notes/x#L1-L2@aaaaaaaaaaaa" }),
    )
    .await;
    assert_eq!(code(&other_space), "LOCATOR_INVALID");
    let absent = open(&fx, json!({ "doc": "handbook/absent" })).await;
    assert_eq!(code(&absent), "DOCUMENT_NOT_FOUND");
}

#[tokio::test]
async fn crlf_files_and_an_empty_file_open_cleanly() {
    let fx = indexed_doc("crlf.md", "# Title\r\n\r\nsecond line\r\n").await;
    let opened = open(&fx, json!({ "doc": "handbook/crlf" })).await;
    let text = data(&opened)["text"].as_str().unwrap().to_owned();
    assert!(text.contains("second line"), "{text:?}");
    assert_eq!(data(&opened)["totalLines"], 3);
    fx.handbook("empty.md", "");
    fx.refresh("main").await;
    let empty = open(&fx, json!({ "doc": "handbook/empty" })).await;
    assert_eq!(data(&empty)["totalLines"], 0);
    assert_eq!(data(&empty)["text"], "");
}

#[tokio::test]
async fn find_returns_matches_with_context_and_limits() {
    let doc = "# Find\n\nalpha one\nbeta two\nALPHA three\ngamma\nalpha four\n";
    let fx = indexed_doc("find.md", doc).await;
    let find = |input: Value| {
        let fx = &fx;
        async move { fx.as_actor(human("local"), "knowledge-find", input).await }
    };
    let found = find(json!({ "doc": "handbook/find", "pattern": "alpha" })).await;
    let matches = data(&found)["matches"].as_array().unwrap();
    assert_eq!(matches.len(), 3, "case-insensitive by default");
    assert_eq!(matches[0]["line"], 3);
    assert_eq!(matches[0]["column"], 1);
    assert_eq!(matches[0]["before"], json!([""]));
    assert_eq!(matches[0]["after"], json!(["beta two"]));
    assert_eq!(matches[0]["trust"], "content");
    assert!(
        matches[0]["locator"]
            .as_str()
            .unwrap()
            .starts_with("umbel:main/handbook/find#L3-L3@")
    );

    let exact =
        find(json!({ "doc": "handbook/find", "pattern": "ALPHA", "case_sensitive": true })).await;
    assert_eq!(data(&exact)["matches"].as_array().unwrap().len(), 1);

    let limited = find(
        json!({ "doc": "handbook/find", "pattern": "alpha", "max_matches": 2, "context_lines": 0 }),
    )
    .await;
    assert_eq!(data(&limited)["matches"].as_array().unwrap().len(), 2);
    assert_eq!(data(&limited)["more"], true);
    assert_eq!(data(&limited)["matches"][0]["before"], json!([]));

    let regex =
        find(json!({ "doc": "handbook/find", "pattern": "^(beta|gamma)\\b", "regex": true })).await;
    assert_eq!(data(&regex)["matches"].as_array().unwrap().len(), 2);

    // Literal text with regex metacharacters is not a pattern.
    let literal = find(json!({ "doc": "handbook/find", "pattern": "a.b" })).await;
    assert!(data(&literal)["matches"].as_array().unwrap().is_empty());

    for pattern in ["(unclosed", "(a)\\1", "(?=look)ahead"] {
        let bad = find(json!({ "doc": "handbook/find", "pattern": pattern, "regex": true })).await;
        assert_eq!(code(&bad), "QUERY_INVALID", "{pattern}: {bad}");
    }
    let huge =
        find(json!({ "doc": "handbook/find", "pattern": "(a{1000}){1000}", "regex": true })).await;
    assert_eq!(code(&huge), "QUERY_INVALID", "{huge}");
    let absent = find(json!({ "doc": "handbook/none", "pattern": "x" })).await;
    assert_eq!(code(&absent), "DOCUMENT_NOT_FOUND");
}

#[tokio::test]
async fn describe_gives_the_record_outline_links_and_chunk_count() {
    let fx = Fx::new();
    fx.handbook(
        "deploy/rollback.md",
        "---\ntitle: Rolling back\ntype: runbook\ntags: [ops]\nowners: [\"human:ada\"]\n---\n# Rolling back\n\nSee [canary](canary.md) and [missing](nowhere.md) and [site](https://example.com) and [up](#rolling-back).\n\n## Steps\n\nrevert.\n",
    );
    fx.handbook("deploy/canary.md", "# Canary\n\ntext\n");
    fx.refresh("main").await;
    let result = fx
        .as_actor(
            human("local"),
            "knowledge-describe",
            json!({ "doc": "handbook/deploy/rollback" }),
        )
        .await;
    let record = data(&result);
    assert_eq!(record["id"], "handbook/deploy/rollback");
    assert_eq!(record["title"], "Rolling back");
    assert_eq!(record["type"], "runbook");
    assert_eq!(record["status"], "stable");
    assert!(record.get("bytes").is_none(), "no bytes");
    assert_eq!(record["outline"][0]["text"], "Rolling back");
    assert_eq!(record["outline"][1]["slug"], "steps");
    let resolved: Vec<&str> = record["links"]["resolved"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| l["doc"].as_str().unwrap())
        .collect();
    assert_eq!(
        resolved,
        ["handbook/deploy/canary", "handbook/deploy/rollback"]
    );
    assert_eq!(record["links"]["broken"].as_array().unwrap().len(), 1);
    assert_eq!(
        record["links"]["external"][0]["target"],
        "https://example.com"
    );
    assert!(record["chunks"].as_u64().unwrap() >= 1);
    assert!(record["indexApplied"].as_u64().unwrap() > 0);
    assert_eq!(record["trust"], "content");
    // Backlinks are read from the graph, which step 7a builds: nothing yet.
    assert_eq!(record["backlinks"]["count"], 0);
}

#[tokio::test]
async fn list_pages_through_the_readable_documents() {
    let fx = Fx::new();
    for n in 0..5 {
        fx.handbook(&format!("d{n}.md"), &format!("# D{n}\n\ntext\n"));
    }
    fx.refresh("main").await;
    let list = |input: Value| {
        let fx = &fx;
        async move { fx.as_actor(human("local"), "knowledge-list", input).await }
    };
    let first = list(json!({ "limit": 2 })).await;
    assert_eq!(data(&first)["count"], 2);
    let after = data(&first)["nextAfter"].as_str().unwrap().to_owned();
    assert_eq!(after, "handbook/d1");
    let second = list(json!({ "limit": 2, "after": after })).await;
    let ids: Vec<&str> = data(&second)["documents"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["handbook/d2", "handbook/d3"]);
    let last = list(json!({ "prefix": "handbook/d4" })).await;
    assert_eq!(data(&last)["count"], 1);
    assert_eq!(data(&last)["nextAfter"], Value::Null);
    assert_eq!(data(&last)["documents"][0]["trust"], "content");
    assert!(data(&last)["documents"][0].get("access").is_none());
}

#[tokio::test]
async fn changes_follow_the_log_and_hide_bookkeeping_records() {
    let fx = Fx::new();
    fx.handbook("a.md", "# A\n\ntext\n");
    fx.handbook("b.md", "# B\n\ntext\n");
    fx.refresh("main").await;
    let all = fx
        .as_actor(human("local"), "knowledge-changes", json!({}))
        .await;
    let changes = data(&all)["changes"].as_array().unwrap();
    let docs: Vec<&str> = changes.iter().map(|c| c["doc"].as_str().unwrap()).collect();
    assert_eq!(docs, ["handbook/a", "handbook/b"], "{all}");
    assert_eq!(changes[0]["kind"], "put");
    assert!(
        changes[0]["contentHash"]
            .as_str()
            .unwrap()
            .starts_with("sha256:")
    );
    let cursor = data(&all)["nextAfterRev"].as_u64().unwrap();
    assert!(cursor >= changes[1]["rev"].as_u64().unwrap());
    let none = fx
        .as_actor(
            human("local"),
            "knowledge-changes",
            json!({ "after_rev": cursor }),
        )
        .await;
    assert!(data(&none)["changes"].as_array().unwrap().is_empty());
    fx.handbook("a.md", "# A\n\nchanged\n");
    fx.cli("sources-sync", json!({})).await;
    let next = fx
        .as_actor(
            human("local"),
            "knowledge-changes",
            json!({ "after_rev": cursor }),
        )
        .await;
    assert_eq!(data(&next)["changes"].as_array().unwrap().len(), 1);
    // One call's changes by its trace id.
    let trace = changes[0]["traceId"].as_str().unwrap();
    let traced = fx
        .as_actor(
            human("local"),
            "knowledge-changes",
            json!({ "trace": trace }),
        )
        .await;
    assert!(data(&traced)["changes"].as_array().unwrap().len() >= 2);
}
