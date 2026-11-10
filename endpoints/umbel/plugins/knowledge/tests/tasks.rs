//! `knowledge-index` as an MCP task (phase 5 sections 12.2 and 14, point 6; step 8), end to end
//! with the kit over real sockets: for a sealed caller its result is the inline call's, and
//! reveals no document it cannot read; cancelled while it waits for the index writer, it commits
//! nothing, because every host service it asks for afterwards is refused.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod relay_kit;
mod support;

use std::time::Duration;

use afd::ManualClock;
use relay_kit::{Client, PUBLIC_URL, Reply, SCOPES, Served, human, library, run};
use serde_json::{Value, json};
use umbel_store::SearchIndex;
use umbel_store_embedded::{StoreOptions, TantivyIndex};
use umbel_testkit_idp::TestIdp;

const EXTENSION: &str = "io.modelcontextprotocol/tasks";

struct Workspace {
    dir: tempfile::TempDir,
    _host: umbel::Host,
    _served: Served,
    client: Client,
}

/// A served `oauth` workspace with the relay kit's spaces and files, `alpha`'s sources synced by
/// the operator and not yet indexed; `private` (bo's alone) left out when `hidden` is false.
async fn workspace(kit: &TestIdp, clock: &ManualClock, hidden: bool) -> Workspace {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join("umbel.toml"),
        relay_kit::oauth_config(kit, ""),
    )
    .unwrap();
    relay_kit::write_files(dir.path());
    if !hidden {
        std::fs::remove_file(dir.path().join("spaces/alpha/private/salaries.md")).unwrap();
    }
    // One seal key for every workspace, so their sealed positions compare.
    let keys = dir.path().join("state/keys");
    std::fs::create_dir_all(&keys).unwrap();
    std::fs::write(keys.join("cursor.key"), [7u8; 32]).unwrap();
    let host = relay_kit::host(dir.path(), kit, clock);
    let synced = run(
        &host,
        library(&host, human("corp/ada")),
        "sources-sync",
        json!({ "space": "alpha" }),
    )
    .await;
    assert_eq!(synced["success"], true, "{synced}");
    let served = Served::start(&host).await;
    let client = Client::plain(served.address);
    Workspace {
        dir,
        _host: host,
        _served: served,
        client,
    }
}

fn token(kit: &TestIdp, clock: &ManualClock) -> String {
    kit.authorization_server()
        .access_token(PUBLIC_URL)
        .issued_at(afd::Clock::now(clock).div_euclid(1000))
        .lifetime(300)
        .subject("ada")
        .client_id("app")
        .scopes(SCOPES)
        .sign()
}

async fn rpc(client: &Client, token: &str, method: &str, mut params: Value, tasks: bool) -> Reply {
    let mut meta = umbel::testkit::mcp::modern_meta();
    if tasks {
        meta["io.modelcontextprotocol/clientCapabilities"] =
            json!({ "extensions": { EXTENSION: {} } });
    }
    params["_meta"] = meta;
    let name = params["name"]
        .as_str()
        .or(params["taskId"].as_str())
        .unwrap()
        .to_owned();
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
    let bearer = format!("Bearer {token}");
    let headers = [
        ("content-type", "application/json"),
        ("accept", "application/json, text/event-stream"),
        ("mcp-protocol-version", "2026-07-28"),
        ("mcp-method", method),
        ("mcp-name", name.as_str()),
        ("authorization", bearer.as_str()),
    ];
    let reply = client
        .send(client.request("POST", "/mcp", &headers, body.to_string()))
        .await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    reply
}

async fn index(client: &Client, token: &str, tasks: bool) -> Value {
    rpc(
        client,
        token,
        "tools/call",
        json!({ "name": "afd-call", "arguments": { "command": "knowledge-index", "input": { "space": "alpha" } } }),
        tasks,
    )
    .await
    .json()["result"]
        .clone()
}

async fn task_get(client: &Client, token: &str, id: &str) -> Value {
    rpc(client, token, "tasks/get", json!({ "taskId": id }), true)
        .await
        .json()["result"]
        .clone()
}

/// Poll until the task leaves `working` (bounded: thirty seconds).
async fn settled(client: &Client, token: &str, id: &str) -> Value {
    for _ in 0..3000 {
        let task = task_get(client, token, id).await;
        if task["status"] != json!("working") {
            return task;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("the task never left working");
}

async fn eventually(mut condition: impl FnMut() -> bool) {
    for _ in 0..3000 {
        if condition() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("the condition never held");
}

/// A `CommandResult` without what differs between two runs (its trace id and timing).
fn comparable(mut result: Value) -> Value {
    if let Some(metadata) = result["metadata"].as_object_mut() {
        metadata.remove("traceId");
        metadata.remove("executionTimeMs");
        // The journal entry's own reference, random per call.
        metadata.remove("dev.umbel/journal-ref");
    }
    result
}

/// The two scenarios share the process's task-service counters, so they run in turn.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn knowledge_index_as_a_task() {
    let kit = TestIdp::start().await.unwrap();
    let clock = afd::fixed_clock(relay_kit::now_ms() / 1000 * 1000);
    let token = token(&kit, &clock);

    // ── For a sealed caller, the task's result is the inline call's, and reveals nothing hidden.
    let as_task = workspace(&kit, &clock, true).await;
    let inline = workspace(&kit, &clock, true).await;
    let unhidden = workspace(&kit, &clock, false).await;
    let mut results = Vec::new();
    for space in [&as_task, &unhidden] {
        let created = index(&space.client, &token, true).await;
        assert_eq!(created["resultType"], json!("task"), "{created}");
        let id = created["taskId"].as_str().unwrap();
        let done = settled(&space.client, &token, id).await;
        assert_eq!(done["status"], json!("completed"), "{done}");
        let result = done["result"]["structuredContent"].clone();
        assert_eq!(result["success"], json!(true), "{result}");
        results.push(comparable(result));
    }
    let answer = index(&inline.client, &token, false).await;
    assert_eq!(answer["resultType"], json!("complete"), "{answer}");
    let inline_result = comparable(answer["structuredContent"].clone());
    assert_eq!(
        results[0], inline_result,
        "the task's result is the inline call's"
    );
    assert_eq!(
        results[0], results[1],
        "a document the caller cannot read changes nothing it is told"
    );
    assert!(
        !results[0].to_string().contains("salaries"),
        "{}",
        results[0]
    );

    // ── Cancelled while it waits for the index writer, it commits nothing.
    let cancelled = workspace(&kit, &clock, true).await;
    let index_dir = cancelled.dir.path().join("state/spaces/alpha");
    let held = TantivyIndex::open(&index_dir, "alpha", StoreOptions::default()).unwrap();
    let writer = held.writer().unwrap();
    let (given, refused) = umbel::testkit::task_services("knowledge-index");
    let created = index(&cancelled.client, &token, true).await;
    let id = created["taskId"].as_str().unwrap().to_owned();
    // The handler has started: it asked for a host service, then waits for the writer.
    eventually(|| umbel::testkit::task_services("knowledge-index").0 > given).await;
    rpc(
        &cancelled.client,
        &token,
        "tasks/cancel",
        json!({ "taskId": id }),
        true,
    )
    .await;
    let done = settled(&cancelled.client, &token, &id).await;
    assert_eq!(done["status"], json!("cancelled"), "{done}");
    // The writer is free again: the handler takes it, and its next host service is refused.
    drop(writer);
    eventually(|| umbel::testkit::task_services("knowledge-index").1 > refused).await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(held.applied().unwrap(), 0, "nothing was committed");
}
