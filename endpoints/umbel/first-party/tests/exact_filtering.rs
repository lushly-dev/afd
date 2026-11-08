//! Exact filtering through the first-party plugins (phase 5 sections 9.1 to 9.3; step 7): in a
//! hosted workspace a caller whose positions are sealed (here the library, as section 4.7 treats
//! an embedder's caller) gets byte for byte the same `knowledge-search` (scores, order, snippets,
//! locators, `dev.umbel/index`), `knowledge-list`, `knowledge-changes`, `knowledge-describe`,
//! `memory-recall` and `context-bundle` before and after records it cannot read are written and
//! indexed; `knowledge-index` counts only what it can read; and its revisions are sealed. A caller
//! who reads the hidden records sees them move.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::{Ws, data, human};

/// A hosted workspace (mode `oauth`; nothing is served here, but every library caller is then a
/// hosted caller who is not the operator): `alpha` with a handbook, the group `platform` (ada),
/// and the sources, knowledge, memory and context plugins.
const CONFIG: &str = r#"config_version = 5
default_space = "alpha"

[principal]
local_id = "corp/ada"

[http]
public_url = "https://umbel.example.com/mcp"
allowed_hosts = ["umbel.example.com"]

[auth]
mode = "oauth"

[auth.namespaces.corp]

[auth.issuers.as]
issuer = "https://as.example.com"
namespace = "corp"

[spaces.alpha]
[spaces.alpha.collections.handbook]
root = "spaces/alpha/handbook"
[spaces.alpha.collections.code]
root = "spaces/alpha/code"
kind = "code"

[access.groups.platform]
members = ["human:corp/ada"]

[plugins]
enabled = ["sources", "knowledge", "memory", "context"]

[plugins.sources]
source = "compiled:sources"
[plugins.sources.grants.documents_write]
allow = ["alpha/*"]
[plugins.sources.grants.records_write]
allow = ["alpha"]

[plugins.knowledge]
source = "compiled:knowledge"
[plugins.knowledge.grants.index_write]
allow = ["alpha"]
[plugins.knowledge.grants.graph_write]
allow = ["alpha"]
[plugins.knowledge.grants.records_write]
allow = ["alpha"]

[plugins.memory]
source = "compiled:memory"
[plugins.memory.grants.memory_write]
allow = ["alpha"]

[plugins.context]
source = "compiled:context"
"#;

const SECRET: &str = "---\naccess: [group:platform]\ntitle: Secret rollout\n---\n# Secret rollout\n\nThe rollout of the canary, the fleet and the rollback, again and again: rollout canary rollout.\n";

fn ada() -> afd::Actor {
    human("corp/ada")
}

fn bo() -> afd::Actor {
    human("corp/bo")
}

fn workspace() -> Ws {
    Ws::with_config(CONFIG, &["spaces/alpha/handbook", "spaces/alpha/code"])
}

/// `value` with what a run's answer may not be compared on across two workspaces: sealed
/// revisions (each workspace has its own key and its own revision numbers) and the journal's
/// random reference, beside the trace ids and timings.
fn comparable(mut value: Value) -> Value {
    fn walk(value: &mut Value) {
        match value {
            Value::Object(members) => {
                members.remove("dev.umbel/journal-ref");
                members.values_mut().for_each(walk);
            }
            Value::Array(items) => items.iter_mut().for_each(walk),
            Value::String(text) if text.starts_with("r1.") => *text = "r1.".to_owned(),
            _ => {}
        }
    }
    strip(&mut value);
    walk(&mut value);
    value
}

fn handbook(ws: &Ws, name: &str, text: &str) {
    std::fs::write(ws.path(&format!("spaces/alpha/handbook/{name}")), text).unwrap();
}

fn public(n: usize) -> String {
    format!(
        "---\ntitle: Rollout {n}\ntags: [ops]\n---\n# Rollout {n}\n\nThe rollout starts with a canary{}. See [the plan](plan.md).\n",
        " and then the fleet".repeat(n)
    )
}

/// Sync and index `alpha` as `actor`.
async fn refresh(ws: &Ws, actor: afd::Actor) {
    for command in ["sources-sync", "knowledge-index"] {
        let result = ws
            .cli(actor.clone(), command, json!({ "space": "alpha" }))
            .await;
        assert_eq!(result["success"], json!(true), "{command}: {result}");
    }
}

/// The paths at which `a` and `b` differ.
fn differences(a: &Value, b: &Value, at: &str, out: &mut Vec<String>) {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            for key in x.keys().chain(y.keys().filter(|key| !x.contains_key(*key))) {
                let null = Value::Null;
                differences(
                    x.get(key).unwrap_or(&null),
                    y.get(key).unwrap_or(&null),
                    &format!("{at}/{key}"),
                    out,
                );
            }
        }
        (Value::Array(x), Value::Array(y)) if x.len() == y.len() => {
            for (n, (x, y)) in x.iter().zip(y).enumerate() {
                differences(x, y, &format!("{at}/{n}"), out);
            }
        }
        _ if a != b => out.push(format!("{at}: {a} != {b}")),
        _ => {}
    }
}

fn strip(value: &mut Value) {
    match value {
        Value::Object(members) => {
            for key in ["traceId", "executionTimeMs", "durationMs", "timing"] {
                members.remove(key);
            }
            members.values_mut().for_each(strip);
        }
        Value::Array(items) => items.iter_mut().for_each(strip),
        _ => {}
    }
}

/// What a caller is shown, with what differs between any two calls (trace ids, timings) left out.
async fn shown(ws: &Ws, actor: afd::Actor) -> Vec<Value> {
    let mut out = Vec::new();
    for (command, input) in [
        (
            "knowledge-search",
            json!({ "query": "rollout canary", "format": "detailed" }),
        ),
        (
            "knowledge-search",
            json!({ "query": "roll*", "format": "detailed", "expand": true }),
        ),
        ("knowledge-list", json!({})),
        ("knowledge-changes", json!({})),
        ("knowledge-describe", json!({ "doc": "handbook/r1" })),
        (
            "memory-recall",
            json!({ "query": "rollout canary", "format": "detailed" }),
        ),
        (
            "context-bundle",
            json!({ "task": "rollout canary", "render": "text" }),
        ),
    ] {
        let mut result = ws.call(actor.clone(), command, input).await;
        assert_eq!(result["success"], json!(true), "{command}: {result}");
        strip(&mut result);
        out.push(result);
    }
    out
}

async fn remember(ws: &Ws, actor: afd::Actor, subject: &str, text: &str) {
    let result = ws
        .call(
            actor,
            "memory-remember",
            json!({ "class": "semantic", "subject": subject, "text": text }),
        )
        .await;
    assert_eq!(result["success"], json!(true), "{result}");
}

#[tokio::test]
async fn a_sealed_callers_answers_do_not_move_with_records_it_cannot_read() {
    let ws = workspace();
    for n in 1..=3 {
        handbook(&ws, &format!("r{n}.md"), &public(n));
    }
    handbook(&ws, "plan.md", "# Plan\n\nThe rollout plan.\n");
    refresh(&ws, bo()).await;
    remember(
        &ws,
        bo(),
        "Bo's rollout",
        "the rollout starts with a canary",
    )
    .await;
    remember(&ws, bo(), "Bo's fleet", "the fleet follows the canary").await;
    let before = shown(&ws, bo()).await;
    let ada_before = shown(&ws, ada()).await;

    // Ada's group's documents and ada's private memory, with the same words many times over,
    // written and indexed.
    for n in 0..12 {
        handbook(&ws, &format!("secret-{n}.md"), SECRET);
        remember(
            &ws,
            ada(),
            &format!("Ada's rollout {n}"),
            &format!("rollout canary rollout canary {}", "padding ".repeat(n)),
        )
        .await;
    }
    refresh(&ws, ada()).await;
    let after = shown(&ws, bo()).await;
    let mut paths = Vec::new();
    for (n, (before, after)) in before.iter().zip(&after).enumerate() {
        differences(before, after, &format!("{n}"), &mut paths);
    }
    assert!(
        paths.is_empty(),
        "bo's answer moved with ada's records at {paths:?}"
    );
    assert_ne!(shown(&ws, ada()).await, ada_before, "ada reads them");

    // Bo's positions are sealed: a revision is `r1.`, a locator object version 2, and
    // `dev.umbel/index` holds sealed revisions.
    let search = &before[0];
    let hit = &search["data"]["hits"][0];
    assert_eq!(hit["locatorObject"]["version"], json!(2), "{hit}");
    let index_version = hit["locatorObject"]["indexVersion"].as_str().unwrap();
    assert!(index_version.starts_with("alpha@r1."), "{index_version}");
    assert!(index_version.ends_with("/2"), "{index_version}");
    let index = &search["metadata"]["dev.umbel/index"]["alpha"];
    assert!(
        index["applied"].as_str().unwrap().starts_with("r1."),
        "{index}"
    );
    assert_eq!(index["schema"], json!(2));
    for doc in data(&before[2])["documents"].as_array().unwrap() {
        assert!(doc["rev"].as_str().unwrap().starts_with("r1."), "{doc}");
    }
    let changes = data(&before[3]);
    assert!(
        changes["nextAfterRev"].as_str().unwrap().starts_with("r1."),
        "{changes}"
    );
    // knowledge-changes takes its own sealed revision back, and refuses a number.
    let next = ws
        .call(
            bo(),
            "knowledge-changes",
            json!({ "after_rev": changes["changes"][0]["rev"] }),
        )
        .await;
    assert_eq!(next["success"], json!(true), "{next}");
    assert_eq!(
        data(&next)["changes"].as_array().unwrap().len(),
        changes["changes"].as_array().unwrap().len() - 1
    );
    let number = ws
        .call(bo(), "knowledge-changes", json!({ "after_rev": 1 }))
        .await;
    assert_eq!(number["success"], json!(false), "{number}");
    // The bundle's store revisions are not shown to bo; recall found bo's two records.
    assert_eq!(
        data(&before[6])["state"],
        json!({ "indexApplied": null, "memoryHead": null })
    );
    assert_eq!(
        data(&before[5])["hits"].as_array().unwrap().len(),
        2,
        "{}",
        before[5]
    );
}

#[tokio::test]
async fn knowledge_index_counts_only_what_a_sealed_caller_can_read() {
    let ws = workspace();
    handbook(&ws, "r1.md", &public(1));
    refresh(&ws, bo()).await;
    // One more public document and five hidden ones, synced but not yet indexed.
    handbook(&ws, "r2.md", &public(2));
    for n in 0..5 {
        handbook(&ws, &format!("secret-{n}.md"), SECRET);
    }
    let sync = ws
        .cli(ada(), "sources-sync", json!({ "space": "alpha" }))
        .await;
    assert_eq!(sync["success"], json!(true), "{sync}");
    let run = ws
        .cli(bo(), "knowledge-index", json!({ "space": "alpha" }))
        .await;
    assert_eq!(run["success"], json!(true), "{run}");
    let indexed = data(&run);
    assert_eq!(
        indexed["documents"],
        json!({ "indexed": 1, "removed": 0 }),
        "{indexed}"
    );
    assert_eq!(indexed["graph"]["documents"], json!(1), "{indexed}");
    for field in ["fromRev", "toRev", "applied", "head", "graphApplied"] {
        assert!(
            indexed[field]
                .as_str()
                .is_some_and(|rev| rev.starts_with("r1.")),
            "{field}: {indexed}"
        );
    }
    assert_eq!(
        indexed["ids"],
        json!([{ "id": "handbook/r2", "change": "indexed" }])
    );
    let reasoning = run["metadata"]["reasoning"].as_str().unwrap_or_default();
    assert!(!reasoning.contains("revision"), "{reasoning}");
    assert!(run["metadata"].get("dev.umbel/changes").is_none(), "{run}");
    assert!(
        run["metadata"]["dev.umbel/record"].get("version").is_none(),
        "{run}"
    );
    // Everything was indexed, the hidden documents included: ada finds them.
    let found = ws
        .call(ada(), "knowledge-search", json!({ "query": "secret" }))
        .await;
    assert_eq!(data(&found)["hits"].as_array().unwrap().len(), 5, "{found}");
}

/// Every answer of `knowledge-index {limit: 1}` as bo, run after a sync of the public documents
/// and, when `hidden`, of ada's documents interleaved with them in the change log.
async fn one_at_a_time(hidden: bool) -> Vec<Value> {
    let ws = workspace();
    handbook(&ws, "plan.md", "# Plan\n\nThe rollout plan.\n");
    for (n, name) in ["b.md", "d.md", "f.md"].iter().enumerate() {
        handbook(&ws, name, &public(n + 1));
    }
    if hidden {
        for name in ["a.md", "c.md", "c2.md", "e.md", "g.md"] {
            handbook(&ws, name, SECRET);
        }
    }
    let sync = ws
        .cli(ada(), "sources-sync", json!({ "space": "alpha" }))
        .await;
    assert_eq!(sync["success"], json!(true), "{sync}");
    let mut answers = Vec::new();
    for _ in 0..10 {
        let run = ws
            .cli(
                bo(),
                "knowledge-index",
                json!({ "space": "alpha", "limit": 1 }),
            )
            .await;
        assert_eq!(run["success"], json!(true), "{run}");
        let more = data(&run)["remaining"] == json!(true);
        answers.push(comparable(run));
        if !more {
            break;
        }
    }
    answers
}

#[tokio::test]
async fn knowledge_index_spends_its_limit_on_what_a_sealed_caller_can_read() {
    // The review's B1: a limit counted over every change would let bo count ada's changes by
    // how many one-change runs index nothing.
    let plain = one_at_a_time(false).await;
    assert_eq!(plain.len(), 4, "plan, b, d and f, one a run: {plain:?}");
    assert_eq!(one_at_a_time(true).await, plain);
}

#[tokio::test]
async fn the_degraded_files_named_are_the_first_twenty_a_sealed_caller_can_read() {
    // The review's I2: 21 of ada's degraded code files sort before bo's one.
    let ws = workspace();
    let garbage = "@#$%^&*(){}[]<>;;; ".repeat(500);
    std::fs::create_dir_all(ws.path("spaces/alpha/code/a")).unwrap();
    std::fs::write(
        ws.path("spaces/alpha/code/a/.umbel-access.toml"),
        "access = [\"group:platform\"]\n",
    )
    .unwrap();
    for n in 0..21 {
        std::fs::write(
            ws.path(&format!("spaces/alpha/code/a/h{n:02}.rs")),
            &garbage,
        )
        .unwrap();
    }
    std::fs::write(ws.path("spaces/alpha/code/z.rs"), &garbage).unwrap();
    let sync = ws
        .cli(ada(), "sources-sync", json!({ "space": "alpha" }))
        .await;
    assert_eq!(sync["success"], json!(true), "{sync}");
    let run = ws
        .cli(bo(), "knowledge-index", json!({ "space": "alpha" }))
        .await;
    assert_eq!(run["success"], json!(true), "{run}");
    assert_eq!(data(&run)["code"]["degraded"], json!(1), "{run}");
    let warning = support::warning(&run, "CODE_PARSE_DEGRADED")
        .expect("the warning")
        .clone();
    assert_eq!(
        warning["details"],
        json!({ "count": 1, "files": [{ "id": "code/z.rs", "reason": "error-rate" }] })
    );
}

/// Every answer of `sources-sync {limit: 1}` as bo, and then `sources-status`, over the public
/// documents and, when `hidden`, ada's documents among them.
async fn synced_one_at_a_time(hidden: bool) -> Vec<Value> {
    let ws = workspace();
    for (n, name) in ["b.md", "d.md", "f.md"].iter().enumerate() {
        handbook(&ws, name, &public(n + 1));
    }
    if hidden {
        for name in ["a.md", "c.md", "c2.md", "e.md", "g.md"] {
            handbook(&ws, name, SECRET);
        }
    }
    let mut answers = Vec::new();
    for _ in 0..10 {
        let run = ws
            .cli(
                bo(),
                "sources-sync",
                json!({ "space": "alpha", "collection": "handbook", "limit": 1 }),
            )
            .await;
        assert_eq!(run["success"], json!(true), "{run}");
        let more = data(&run)["remaining"] == json!(true);
        answers.push(comparable(run));
        if !more {
            break;
        }
    }
    // One more file of each kind, not synced yet: neither is counted for bo.
    handbook(&ws, "h.md", &public(4));
    if hidden {
        handbook(&ws, "i.md", SECRET);
    }
    let status = ws
        .cli(bo(), "sources-status", json!({ "space": "alpha" }))
        .await;
    assert_eq!(status["success"], json!(true), "{status}");
    answers.push(comparable(status));
    answers
}

#[tokio::test]
async fn sources_sync_and_status_count_only_what_a_sealed_caller_can_read() {
    let plain = synced_one_at_a_time(false).await;
    assert_eq!(
        plain.len(),
        4,
        "b, d and f, one a run, then the status: {plain:?}"
    );
    let first = data(&plain[0]);
    assert_eq!(first["totals"]["added"], json!(1), "{first}");
    assert_eq!(
        first["collections"][0]["stoppedAfter"],
        Value::Null,
        "{first}"
    );
    assert_eq!(synced_one_at_a_time(true).await, plain);
    // The status names bo's three documents and nothing of the files not synced yet.
    let status = &data(&plain[3])["collections"][0];
    assert_eq!(status["files"], json!(3), "{status}");
    assert_eq!(status["new"], json!(0), "{status}");
}
