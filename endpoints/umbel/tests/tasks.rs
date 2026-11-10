//! MCP tasks for long jobs (phase 5 specification, sections 10.2 and 12.2; step 8), end to end
//! over HTTP with `umbel-testkit-idp`: two hosts on one workspace stand for two processes behind
//! one URL, sharing `state/shared/tasks.sqlite3`.
//!
//! It covers owners across actors, issuers' subjects and clients and across the two processes,
//! the one unknown-task answer, the caps, the TTL and the token's expiry on an injected clock,
//! the gateway's assertion, cancellation reaching the process that runs the task (a plugin on a
//! blocking thread included), the result shapes, a crash and a restart mid-task, and the callers
//! a server cannot tell apart.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use afd::{
    CommandContext, CommandDefinition, CommandHandler, CommandResult, ExposeOptions, ManualClock,
    TaskSupport,
};
use async_trait::async_trait;
use serde_json::{Value, json};
use support::hosted::{Client, PUBLIC_URL, Reply, Served};
use umbel::{Host, HostBuilder};
use umbel_sdk::{Cx, Outcome, Plugin};
use umbel_testkit_idp::{TestIdp, TokenBuilder};

const EXTENSION: &str = "io.modelcontextprotocol/tasks";
/// The one answer for a task that is not the caller's, has gone, or never was.
const UNKNOWN: &str =
    r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"Task not found"}}"#;

// ─── Commands ────────────────────────────────────────────────────────────────────────────────

/// What a test's jobs share: whether to finish, how many started, and how many were stopped
/// while they waited (their future dropped).
#[derive(Default)]
struct Gate {
    release: AtomicBool,
    /// Lets `job-hang` return.
    unhang: AtomicBool,
    started: AtomicUsize,
    stopped: AtomicUsize,
}

/// Counts a waiting job whose future is dropped before it finished.
struct Stopped(Arc<Gate>, bool);

impl Drop for Stopped {
    fn drop(&mut self) {
        if !self.1 {
            self.0.stopped.fetch_add(1, Ordering::SeqCst);
        }
    }
}

/// `job-wait`: waits for the gate, then answers what it saw (a mutation with a `space` input).
struct Wait(Arc<Gate>);

#[async_trait]
impl CommandHandler for Wait {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        self.0.started.fetch_add(1, Ordering::SeqCst);
        let mut guard = Stopped(Arc::clone(&self.0), false);
        while !self.0.release.load(Ordering::SeqCst) {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        guard.1 = true;
        seen(&input, &context)
    }
}

/// `job-hang`: blocks its runner's thread (it never awaits) until the gate lets it return, as a
/// runner that hangs does.
struct Hang(Arc<Gate>);

#[async_trait]
impl CommandHandler for Hang {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        self.0.started.fetch_add(1, Ordering::SeqCst);
        while !self.0.unhang.load(Ordering::SeqCst) {
            std::thread::sleep(Duration::from_millis(5));
        }
        afd::success(json!({ "hung": true }))
    }
}

/// `job-echo`: answers what it saw at once.
struct Echo;

#[async_trait]
impl CommandHandler for Echo {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        seen(&input, &context)
    }
}

fn seen(input: &Value, context: &CommandContext) -> CommandResult<Value> {
    if let Some(code) = input["fail_code"].as_str() {
        return afd::failure(
            afd::CommandError::new(code, "canary-own-message")
                .with_suggestion("canary-own-suggestion")
                .with_retryable(true),
        );
    }
    if input["fail"] == json!(true) {
        return afd::failure(
            afd::CommandError::new("JOB_FAILED", "The job failed").with_suggestion("Retry."),
        );
    }
    if let Some(size) = input["big"].as_u64() {
        return afd::success(json!({ "blob": "x".repeat(size as usize) }));
    }
    afd::success(json!({
        "space": input["space"],
        "actor": context.actor,
        "principal": context.extra.get("dev.umbel/principal"),
        "task": context.cancellation().is_some(),
    }))
}

fn exposed() -> ExposeOptions {
    ExposeOptions::new()
        .with_palette(false)
        .with_mcp(true)
        .with_agent(true)
        .with_cli(true)
}

fn schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "space": { "type": "string" },
            "fail": { "type": "boolean" },
            "fail_code": { "type": "string" },
            "big": { "type": "integer" },
        },
        "additionalProperties": false,
    })
}

fn job(name: &str, handler: impl CommandHandler + 'static, task: TaskSupport) -> CommandDefinition {
    CommandDefinition::new(name, "A test job.", vec![], handler)
        .with_expose(exposed())
        .as_mutation()
        .with_task(task)
}

/// Register the jobs: `job-wait` and `job-echo` (optional), `job-must` (required).
fn jobs(builder: HostBuilder, gate: &Arc<Gate>) -> HostBuilder {
    builder
        .register_with_schema(
            job("job-wait", Wait(Arc::clone(gate)), TaskSupport::Optional),
            schema(),
        )
        .register_with_schema(job("job-echo", Echo, TaskSupport::Optional), schema())
        .register_with_schema(job("job-must", Echo, TaskSupport::Required), schema())
        .register_with_schema(
            job("job-hang", Hang(Arc::clone(gate)), TaskSupport::Optional),
            schema(),
        )
}

// ─── A compiled plugin on a blocking thread ──────────────────────────────────────────────────

/// What each run of the tasker's commands did, by its input's `tag`: host calls given, whether
/// the host refused one, and the outcomes of `tasker-index`'s steps after its gate opened.
#[derive(Default, Clone, Debug)]
struct Seen {
    calls: usize,
    refused: bool,
    has_writer: bool,
    steps: Vec<(String, bool)>,
}

static SEEN: Mutex<BTreeMap<String, Seen>> = Mutex::new(BTreeMap::new());
/// The tags whose `tasker-index` may go on.
static GO: Mutex<Vec<String>> = Mutex::new(Vec::new());

fn seen_of(tag: &str) -> Seen {
    SEEN.lock().unwrap().get(tag).cloned().unwrap_or_default()
}

fn note(tag: &str, change: impl FnOnce(&mut Seen)) {
    change(SEEN.lock().unwrap().entry(tag.to_owned()).or_default());
}

const TASKER: &str = r#"manifest_version = 5
protocol = 1

[plugin]
id = "tasker"
title = "Tasker"
version = "0.1.0"
description = "A plugin whose commands call the host on a blocking thread, as a long job does."
kind = "compiled"
domains = ["tasker"]

[[grants]]
name = "clock"
reason = "Reads the time on every turn of its loop, as a batch would call the host."

[[grants]]
name = "index"
reason = "Reads the index's applied revision."

[[grants]]
name = "index_write"
reason = "Opens an index writer session, as an indexer does."

[[commands]]
name = "tasker-loop"
description = "Call the host until it refuses, at most for thirty seconds."
effects = ["plugin-state"]
input_schema = { type = "object", properties = { space = { type = "string" }, tag = { type = "string" } }, additionalProperties = false }
task = "optional"

[[commands]]
name = "tasker-index"
description = "Open an index writer, wait for the test, then stage, derive, maintain and commit."
effects = ["store-write"]
input_schema = { type = "object", properties = { space = { type = "string" }, tag = { type = "string" } }, additionalProperties = false }
task = "optional"
"#;

struct Tasker;

impl Plugin for Tasker {
    fn manifest(&self) -> &'static str {
        TASKER
    }

    fn handle(&self, name: &str, input: Value, cx: &mut Cx) -> Outcome {
        let tag = input["tag"].as_str().unwrap_or("untagged").to_owned();
        let deadline = std::time::Instant::now() + Duration::from_secs(30);
        match name {
            "tasker-loop" => {
                while std::time::Instant::now() < deadline {
                    if cx.now_ms().is_err() {
                        note(&tag, |seen| seen.refused = true);
                        return umbel_sdk::failure("TASKER_STOPPED", "refused", "Nothing to do.");
                    }
                    note(&tag, |seen| seen.calls += 1);
                    std::thread::sleep(Duration::from_millis(2));
                }
                umbel_sdk::success(json!({ "turns": seen_of(&tag).calls }))
            }
            "tasker-index" => {
                let mut writer = match cx.index_writer("main") {
                    Ok(writer) => writer,
                    Err(error) => return umbel_sdk::failure("TASKER", &error.to_string(), "-"),
                };
                note(&tag, |seen| seen.has_writer = true);
                while !GO.lock().unwrap().contains(&tag) && std::time::Instant::now() < deadline {
                    std::thread::sleep(Duration::from_millis(2));
                }
                let doc: umbel_sdk::umbel_store::DocId = "doc-1".to_owned();
                let steps = [
                    ("replace", writer.replace(&doc, Vec::new()).is_ok()),
                    ("clear", writer.clear().is_ok()),
                    ("derive_head", cx.derive_head("main").is_ok()),
                    ("checkpoint", cx.checkpoint("main").is_ok()),
                    ("commit", writer.commit(1).is_ok()),
                    ("index_applied", cx.index_applied("main").is_ok()),
                ];
                note(&tag, |seen| {
                    seen.steps = steps.iter().map(|(n, ok)| ((*n).to_owned(), *ok)).collect();
                });
                umbel_sdk::success(json!({ "done": true }))
            }
            other => umbel_sdk::failure("NOT_FOUND", other, "-"),
        }
    }
}

/// The plugin table every tasker workspace enables it with.
const TASKER_PLUGINS: &str = "[plugins]\nenabled = [\"tasker\"]\n\n[plugins.tasker.grants.index_write]\nallow = [\"main\"]\n";

// ─── Two processes on one oauth workspace ────────────────────────────────────────────────────

/// `alpha` is ada's, `private` is bo's; `main`, the default, is anyone's.
const SPACES: &str = r#"[spaces.alpha]
readers = ["human:corp/ada"]

[spaces.private]
readers = ["human:corp/bo"]
"#;

struct Process {
    /// Kept so the host lives as long as its server.
    _host: Host,
    served: Served,
    client: Client,
}

/// A host on `dir` trusting `ca_pem` for its issuers' fetches, on `clock` for every call, token
/// times and the task store, with the jobs and the tasker plugin.
fn host_on(dir: &std::path::Path, ca_pem: &str, clock: &ManualClock, gate: &Arc<Gate>) -> Host {
    jobs(
        HostBuilder::open(dir)
            .unwrap()
            .with_auth_root_certificate(ca_pem.as_bytes().to_vec())
            .with_auth_clock(clock.clone())
            .with_clock(clock.clone()),
        gate,
    )
    .register(support::oauth::whoami())
    .register(support::oauth::touch())
    .with_compiled(umbel::plugins::sdk(Tasker))
    .seal()
    .unwrap()
}

/// [`host_on`], serving HTTP.
async fn process(
    dir: &std::path::Path,
    kit: &TestIdp,
    clock: &ManualClock,
    gate: &Arc<Gate>,
) -> Process {
    serve(host_on(dir, kit.ca().certificate_pem(), clock, gate)).await
}

async fn serve(host: Host) -> Process {
    let served = Served::start(&host).await;
    let client = Client::plain(served.address);
    Process {
        _host: host,
        served,
        client,
    }
}

/// A clock at now, in whole seconds, so a token's `exp` and a task's TTL fall on its ticks.
fn clock_now() -> ManualClock {
    afd::fixed_clock(support::oauth::now_ms() / 1000 * 1000)
}

struct World {
    kit: TestIdp,
    dir: tempfile::TempDir,
    clock: ManualClock,
    gate: Arc<Gate>,
    a: Process,
    b: Process,
}

impl World {
    async fn start() -> Self {
        Self::start_with("").await
    }

    async fn start_with(extra: &str) -> Self {
        let kit = TestIdp::start().await.unwrap();
        let rest = format!("{SPACES}\n{TASKER_PLUGINS}{extra}");
        let setup = support::oauth::Setup {
            rest: &rest,
            ..support::oauth::Setup::default()
        };
        // The identity provider issues access tokens too: a second issuer of the namespace.
        let config = support::oauth::config(&kit, &setup).replacen(
            "access_tokens = false",
            "access_tokens = true\nalgorithms = [\"ES256\", \"RS256\"]",
            1,
        );
        let dir = support::workspace(&config);
        let clock = clock_now();
        let gate = Arc::new(Gate::default());
        let a = process(dir.path(), &kit, &clock, &gate).await;
        let b = process(dir.path(), &kit, &clock, &gate).await;
        Self {
            kit,
            dir,
            clock,
            gate,
            a,
            b,
        }
    }

    fn now_s(&self) -> i64 {
        afd::Clock::now(&self.clock).div_euclid(1000)
    }

    /// A token issued now for `subject` and `client`, for 300 seconds, reading and writing.
    fn token(&self, subject: &str, client: &str) -> String {
        self.builder(subject, client).sign()
    }

    /// As [`Self::token`], from the namespace's other issuer.
    fn idp_token(&self, subject: &str, client: &str) -> String {
        self.kit
            .identity_provider()
            .access_token(PUBLIC_URL)
            .issued_at(self.now_s())
            .lifetime(300)
            .subject(subject)
            .client_id(client)
            .scopes(["umbel:read", "umbel:write"])
            .sign()
    }

    fn builder(&self, subject: &str, client: &str) -> TokenBuilder {
        self.kit
            .authorization_server()
            .access_token(PUBLIC_URL)
            .issued_at(self.now_s())
            .lifetime(300)
            .subject(subject)
            .client_id(client)
            .scopes(["umbel:read", "umbel:write"])
    }
}

fn bearer(token: &str) -> Vec<(String, String)> {
    vec![("authorization".to_owned(), format!("Bearer {token}"))]
}

/// A 2026-07-28 JSON-RPC request with `auth` headers; `tasks` declares the extension. `Mcp-Name`
/// is the tool's name or the task id.
async fn rpc(
    client: &Client,
    method: &str,
    mut params: Value,
    tasks: bool,
    auth: &[(String, String)],
) -> Reply {
    let mut meta = support::mcp::modern_meta();
    if tasks {
        meta["io.modelcontextprotocol/clientCapabilities"] =
            json!({ "extensions": { EXTENSION: {} } });
    }
    params["_meta"] = meta;
    let name = params["name"]
        .as_str()
        .or(params["taskId"].as_str())
        .map(str::to_owned);
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
    let mut headers: Vec<(&str, &str)> = vec![
        ("content-type", "application/json"),
        ("accept", "application/json, text/event-stream"),
        ("mcp-protocol-version", "2026-07-28"),
        ("mcp-method", method),
    ];
    if let Some(name) = &name {
        headers.push(("mcp-name", name));
    }
    for (header, value) in auth {
        headers.push((header, value));
    }
    client
        .send(client.request("POST", "/mcp", &headers, body.to_string()))
        .await
}

/// `command` with `input` through `afd-call`, as a task when `tasks`.
async fn call(
    client: &Client,
    auth: &[(String, String)],
    command: &str,
    input: Value,
    tasks: bool,
) -> Reply {
    rpc(
        client,
        "tools/call",
        json!({ "name": "afd-call", "arguments": { "command": command, "input": input } }),
        tasks,
        auth,
    )
    .await
}

/// The `CreateTaskResult` of a call that became a task.
fn created(reply: &Reply) -> Value {
    assert_eq!(reply.status, 200, "{}", reply.text);
    let result = reply.json()["result"].clone();
    assert_eq!(result["resultType"], json!("task"), "{}", reply.text);
    result
}

fn id_of(reply: &Reply) -> String {
    created(reply)["taskId"].as_str().unwrap().to_owned()
}

async fn task_rpc(client: &Client, method: &str, id: &str, auth: &[(String, String)]) -> Reply {
    let mut params = json!({ "taskId": id });
    if method == "tasks/update" {
        params["inputResponses"] = json!({});
    }
    rpc(client, method, params, true, auth).await
}

async fn get(client: &Client, id: &str, auth: &[(String, String)]) -> Value {
    let reply = task_rpc(client, "tasks/get", id, auth).await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    reply.json()
}

/// Poll until the task leaves `working` (bounded: thirty seconds).
async fn settled(client: &Client, id: &str, auth: &[(String, String)]) -> Value {
    settled_with(client, id, || auth.to_vec()).await
}

/// As [`settled`], with fresh credentials for every poll (a gateway's assertion is spent once).
async fn settled_with(
    client: &Client,
    id: &str,
    auth: impl Fn() -> Vec<(String, String)>,
) -> Value {
    for _ in 0..3000 {
        let body = get(client, id, &auth()).await;
        if body["result"]["status"] != json!("working") {
            return body;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("the task never left working");
}

/// Wait until `condition` holds (bounded: thirty seconds).
async fn eventually(mut condition: impl FnMut() -> bool) {
    for _ in 0..3000 {
        if condition() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("the condition never held");
}

/// A task's row as the store holds it, read from the file directly: its status and its lease's
/// end. Reading it changes nothing, as a `tasks/get` may (it can find a lease run out).
fn stored(dir: &std::path::Path, id: &str) -> (String, Option<i64>) {
    let connection = rusqlite::Connection::open_with_flags(
        dir.join("state/shared/tasks.sqlite3"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .unwrap();
    connection
        .query_row(
            "SELECT status, lease_until_ms FROM tasks WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap()
}

/// Wait until the store holds the task finished, as its runner wrote it.
async fn finished_in_store(dir: &std::path::Path, id: &str) {
    eventually(|| stored(dir, id).0 != "working").await;
}

fn assert_unknown(reply: &Reply, label: &str) {
    assert_eq!(reply.status, 200, "{label}: {}", reply.text);
    assert_eq!(reply.text.trim(), UNKNOWN, "{label}");
}

/// The `CommandResult` a completed task holds.
fn task_result(body: &Value) -> Value {
    assert_eq!(body["result"]["status"], json!("completed"), "{body}");
    body["result"]["result"]["structuredContent"].clone()
}

/// The `CommandResult` of an inline call.
fn inline(reply: &Reply) -> Value {
    assert_eq!(reply.status, 200, "{}", reply.text);
    let result = reply.json()["result"].clone();
    assert_eq!(result["resultType"], json!("complete"), "{}", reply.text);
    result["structuredContent"].clone()
}

/// A `CommandResult` without what differs between two runs of one command (its trace id and
/// timing).
fn comparable(mut result: Value) -> Value {
    if let Some(metadata) = result["metadata"].as_object_mut() {
        metadata.remove("traceId");
        metadata.remove("executionTimeMs");
    }
    result
}

// ─── Owners, across processes ────────────────────────────────────────────────────────────────

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_task_created_on_one_process_is_its_owner_s_alone_on_every_process() {
    let world = World::start().await;
    let token = world.token("ada", "app");
    let ada = bearer(&token);
    let reply = call(&world.a.client, &ada, "job-wait", json!({}), true).await;
    let task = created(&reply);
    let id = task["taskId"].as_str().unwrap().to_owned();
    // Durable before the answer: the other process finds it at once.
    assert_eq!(
        get(&world.b.client, &id, &ada).await["result"]["status"],
        json!("working")
    );
    // The owner's new token, through either process: the same task.
    let renewed = bearer(&world.token("ada", "app"));
    for process in [&world.a, &world.b] {
        let body = get(&process.client, &id, &renewed).await;
        assert_eq!(body["result"]["taskId"], json!(id), "{body}");
    }
    // Another subject, another client of the same person, the same subject and client through
    // the namespace's other issuer: the one unknown answer, on every method and both processes,
    // byte for byte as an unknown and a malformed id.
    let other_issuer = world.idp_token("ada", "app");
    assert_eq!(
        inline(
            &call(
                &world.b.client,
                &bearer(&other_issuer),
                "job-echo",
                json!({}),
                false
            )
            .await
        )["success"],
        json!(true),
        "the other issuer's token is accepted"
    );
    let strangers = [
        bearer(&world.token("bo", "app")),
        bearer(&world.token("ada", "other-app")),
        bearer(&other_issuer),
    ];
    for process in [&world.a, &world.b] {
        for stranger in &strangers {
            for method in ["tasks/get", "tasks/update", "tasks/cancel"] {
                let reply = task_rpc(&process.client, method, &id, stranger).await;
                assert_unknown(&reply, method);
            }
        }
        let unknown = task_rpc(&process.client, "tasks/get", &"a".repeat(26), &ada).await;
        assert_unknown(&unknown, "unknown id");
        let malformed = task_rpc(&process.client, "tasks/get", "not-a-task", &ada).await;
        assert_unknown(&malformed, "malformed id");
    }
    // The strangers' cancels changed nothing.
    let body = get(&world.b.client, &id, &ada).await;
    assert_eq!(body["result"]["status"], json!("working"), "{body}");
    assert_eq!(world.gate.stopped.load(Ordering::SeqCst), 0);
    world.gate.release.store(true, Ordering::SeqCst);
    let done = task_result(&settled(&world.b.client, &id, &ada).await);
    assert_eq!(done["success"], json!(true), "{done}");
    assert_eq!(done["data"]["task"], json!(true), "{done}");
    // Nothing of the token is in the store.
    let signature = token.rsplit('.').next().unwrap();
    let file = std::fs::read(world.dir.path().join("state/shared/tasks.sqlite3")).unwrap();
    let wal =
        std::fs::read(world.dir.path().join("state/shared/tasks.sqlite3-wal")).unwrap_or_default();
    for bytes in [file, wal] {
        let text = String::from_utf8_lossy(&bytes);
        assert!(!text.contains(signature));
        assert!(!text.contains("Bearer"));
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn cancel_from_another_process_reaches_the_process_running_the_task() {
    let world = World::start().await;
    let ada = bearer(&world.token("ada", "app"));
    let id = id_of(&call(&world.a.client, &ada, "job-wait", json!({}), true).await);
    eventually(|| world.gate.started.load(Ordering::SeqCst) == 1).await;
    // The cancel arrives at b, which does not run it.
    let reply = task_rpc(&world.b.client, "tasks/cancel", &id, &ada).await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    assert!(reply.json()["error"].is_null(), "{}", reply.text);
    // a stops the handler, and the task is cancelled for every process.
    eventually(|| world.gate.stopped.load(Ordering::SeqCst) == 1).await;
    let body = settled(&world.b.client, &id, &ada).await;
    assert_eq!(body["result"]["status"], json!("cancelled"), "{body}");
    assert!(body["result"].get("result").is_none(), "{body}");
    assert_eq!(
        get(&world.a.client, &id, &ada).await["result"]["status"],
        json!("cancelled")
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn cancel_stops_a_plugin_on_a_blocking_thread_at_its_next_host_call() {
    let world = World::start().await;
    let ada = bearer(&world.token("ada", "app"));
    let tag = "cancel-loop";
    let id = id_of(
        &call(
            &world.a.client,
            &ada,
            "tasker-loop",
            json!({ "tag": tag }),
            true,
        )
        .await,
    );
    eventually(|| seen_of(tag).calls > 0).await;
    assert!(!seen_of(tag).refused);
    let reply = task_rpc(&world.b.client, "tasks/cancel", &id, &ada).await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    // AFD cannot stop a blocking thread; the host refuses the plugin's next call, so it stops.
    eventually(|| seen_of(tag).refused).await;
    let body = settled(&world.b.client, &id, &ada).await;
    assert_eq!(body["result"]["status"], json!("cancelled"), "{body}");
    let after = seen_of(tag).calls;
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(seen_of(tag).calls, after, "the loop stopped");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_stopped_task_s_writer_session_derivation_and_maintenance_are_refused() {
    let world = World::start().await;
    let ada = bearer(&world.token("ada", "app"));
    // First as an inline call: every step is given.
    let inline_tag = "index-inline";
    GO.lock().unwrap().push(inline_tag.to_owned());
    let done = inline(
        &call(
            &world.a.client,
            &ada,
            "tasker-index",
            json!({ "tag": inline_tag }),
            false,
        )
        .await,
    );
    assert_eq!(done["success"], json!(true), "{done}");
    assert!(
        seen_of(inline_tag).steps.iter().all(|(_, ok)| *ok),
        "{:?}",
        seen_of(inline_tag)
    );
    // As a task, cancelled while it holds a writer it opened before: nothing more is given.
    let tag = "index-task";
    let id = id_of(
        &call(
            &world.a.client,
            &ada,
            "tasker-index",
            json!({ "tag": tag }),
            true,
        )
        .await,
    );
    eventually(|| seen_of(tag).has_writer).await;
    let reply = task_rpc(&world.a.client, "tasks/cancel", &id, &ada).await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    let body = settled(&world.a.client, &id, &ada).await;
    assert_eq!(body["result"]["status"], json!("cancelled"), "{body}");
    GO.lock().unwrap().push(tag.to_owned());
    eventually(|| !seen_of(tag).steps.is_empty()).await;
    let steps = seen_of(tag).steps;
    assert!(steps.iter().all(|(_, ok)| !*ok), "{steps:?}");
    let (_, refused) = umbel::testkit::task_services("tasker-index");
    // The derivation read, the checkpoint and the index read (the session's own steps are refused
    // by the session).
    assert!(refused >= 3, "{refused}");
}

// ─── Result shapes, and no more than the inline call ─────────────────────────────────────────

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_task_s_result_is_the_inline_call_s_and_reveals_no_more() {
    let world = World::start().await;
    let ada = bearer(&world.token("ada", "app"));
    let client = &world.a.client;
    for input in [
        json!({ "space": "alpha" }),
        json!({}),
        json!({ "fail": true }),
        // bo's space and a space nobody declared: section 5.4's one answer, as a task too.
        json!({ "space": "private" }),
        json!({ "space": "nowhere" }),
    ] {
        let reply = call(client, &ada, "job-echo", input.clone(), true).await;
        let task = created(&reply);
        assert_eq!(task["status"], json!("working"));
        assert_eq!(task["pollIntervalMs"], json!(1000));
        let body = settled(&world.b.client, task["taskId"].as_str().unwrap(), &ada).await;
        let from_task = task_result(&body);
        let result = &body["result"]["result"];
        assert_eq!(result["resultType"], json!("complete"), "{body}");
        assert_eq!(
            result["isError"],
            json!(from_task["success"] == json!(false)),
            "{body}"
        );
        let mut from_inline = inline(&call(client, &ada, "job-echo", input.clone(), false).await);
        // Only the handler's own view of being a task differs.
        if from_inline["success"] == json!(true) {
            assert_eq!(from_inline["data"]["task"], json!(false));
            from_inline["data"]["task"] = json!(true);
        }
        assert_eq!(comparable(from_task), comparable(from_inline), "{input}");
    }
    // The two unreadable spaces' answers are one, byte for byte.
    let mut answers = Vec::new();
    for space in ["private", "nowhere"] {
        let id = id_of(&call(client, &ada, "job-echo", json!({ "space": space }), true).await);
        let body = settled(client, &id, &ada).await;
        let result = comparable(task_result(&body));
        assert_eq!(
            result["error"]["code"],
            json!("SPACE_NOT_READABLE"),
            "{result}"
        );
        answers.push(result.to_string());
    }
    assert_eq!(answers[0], answers[1]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_hidden_instance_s_command_is_no_task_and_an_unknown_name() {
    // The tasker instance serves only bo's space: to ada it does not exist (section 9.4).
    let kit = TestIdp::start().await.unwrap();
    let rest = format!(
        "{SPACES}\n[plugins]\nenabled = [\"tasker\"]\n\n[plugins.tasker]\nspaces = [\"private\"]\n\n[plugins.tasker.grants.index_write]\nallow = [\"private\"]\n"
    );
    let setup = support::oauth::Setup {
        rest: &rest,
        ..support::oauth::Setup::default()
    };
    let dir = support::workspace(&support::oauth::config(&kit, &setup));
    let clock = clock_now();
    let gate = Arc::new(Gate::default());
    let a = process(dir.path(), &kit, &clock, &gate).await;
    let token = kit
        .authorization_server()
        .access_token(PUBLIC_URL)
        .issued_at(afd::Clock::now(&clock).div_euclid(1000))
        .lifetime(300)
        .subject("ada")
        .client_id("app")
        .scopes(["umbel:read", "umbel:write"])
        .sign();
    let ada = bearer(&token);
    let hidden = call(&a.client, &ada, "tasker-loop", json!({}), true).await;
    let missing = call(&a.client, &ada, "tasker-nothing", json!({}), true).await;
    assert_eq!(hidden.status, 200, "{}", hidden.text);
    assert_eq!(
        hidden.text.replace("tasker-loop", "NAME"),
        missing.text.replace("tasker-nothing", "NAME")
    );
    assert_ne!(hidden.json()["result"]["resultType"], json!("task"));
    drop(a);
}

// ─── Caps ────────────────────────────────────────────────────────────────────────────────────

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_owner_s_tasks_are_capped_across_processes_and_a_result_is_capped() {
    let world = World::start().await;
    let ada = bearer(&world.token("ada", "app"));
    // Thirty-two working tasks, made through both processes, fill ada's share.
    let mut ids = Vec::new();
    for n in 0..32 {
        let process = if n % 2 == 0 { &world.a } else { &world.b };
        ids.push(id_of(
            &call(&process.client, &ada, "job-wait", json!({}), true).await,
        ));
    }
    for process in [&world.a, &world.b] {
        let refused = inline(&call(&process.client, &ada, "job-wait", json!({}), true).await);
        assert_eq!(refused["error"]["code"], json!("RATE_LIMITED"), "{refused}");
        assert_eq!(refused["error"]["retryable"], json!(true), "{refused}");
    }
    // Another of ada's clients is another owner, with its own share.
    let other = bearer(&world.token("ada", "other-app"));
    let id = id_of(&call(&world.a.client, &other, "job-echo", json!({}), true).await);
    settled(&world.a.client, &id, &other).await;
    // A finished task makes room.
    world.gate.release.store(true, Ordering::SeqCst);
    settled(&world.a.client, &ids[0], &ada).await;
    let id = id_of(&call(&world.b.client, &ada, "job-echo", json!({}), true).await);
    settled(&world.b.client, &id, &ada).await;
    // A result larger than a task keeps is replaced by a failure that says the command ran.
    let id = id_of(
        &call(
            &world.a.client,
            &other,
            "job-echo",
            json!({ "big": 1_100_000 }),
            true,
        )
        .await,
    );
    let result = task_result(&settled(&world.b.client, &id, &other).await);
    assert_eq!(result["error"]["code"], json!("INTERNAL_ERROR"), "{result}");
    assert_eq!(result["error"]["details"]["limitBytes"], json!(1_048_576));
    for id in &ids {
        settled(&world.a.client, id, &ada).await;
    }
}

// ─── The TTL and the token ───────────────────────────────────────────────────────────────────

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_task_stops_at_its_token_s_exp_and_only_that_notice_lasts_the_grace() {
    let world = World::start().await;
    let ada = bearer(&world.token("ada", "app"));
    // The token has 300 seconds: the TTL ends a minute after it.
    let task = created(&call(&world.a.client, &ada, "job-wait", json!({}), true).await);
    assert_eq!(task["ttlMs"], json!(360_000));
    let id = task["taskId"].as_str().unwrap().to_owned();
    // A task that finished before the token's exp, and one cancelled.
    let done = id_of(&call(&world.a.client, &ada, "job-echo", json!({}), true).await);
    settled(&world.a.client, &done, &ada).await;
    eventually(|| world.gate.started.load(Ordering::SeqCst) == 1).await;
    world.clock.advance(300_000);
    // The runner sees the token's expiry at its next check and writes it; only then is the task
    // polled, so no read can find its lease run out first.
    finished_in_store(world.dir.path(), &id).await;
    let renewed = bearer(&world.token("ada", "app"));
    let body = get(&world.b.client, &id, &renewed).await;
    let result = task_result(&body);
    assert_eq!(
        result["error"]["code"],
        json!("TASK_TOKEN_EXPIRED"),
        "{result}"
    );
    // A mutation that started may have made its change: not retryable.
    assert_eq!(result["error"]["retryable"], json!(false), "{result}");
    eventually(|| world.gate.stopped.load(Ordering::SeqCst) == 1).await;
    // The finished task's result did not outlive the token: gone, as an unknown id is.
    assert_unknown(
        &task_rpc(&world.b.client, "tasks/get", &done, &renewed).await,
        "a result past exp",
    );
    // The notice lasts the grace, on both processes, and is then gone.
    world.clock.advance(59_999);
    let renewed = bearer(&world.token("ada", "app"));
    for process in [&world.a, &world.b] {
        let body = get(&process.client, &id, &renewed).await;
        assert_eq!(
            task_result(&body)["error"]["code"],
            json!("TASK_TOKEN_EXPIRED")
        );
    }
    world.clock.advance(1);
    let renewed = bearer(&world.token("ada", "app"));
    assert_unknown(
        &task_rpc(&world.b.client, "tasks/get", &id, &renewed).await,
        "past the grace",
    );
    let unknown = task_rpc(&world.b.client, "tasks/get", &"b".repeat(26), &renewed).await;
    assert_unknown(&unknown, "unknown");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_ttl_never_runs_past_a_short_token_and_its_result_not_past_the_exp() {
    let world = World::start().await;
    let token = world.builder("ada", "app").lifetime(30).sign();
    let ada = bearer(&token);
    let task = created(&call(&world.a.client, &ada, "job-echo", json!({}), true).await);
    // The token's 30 seconds and the minute's grace, not the hour's default.
    assert_eq!(task["ttlMs"], json!(30_000 + 60_000));
    let id = task["taskId"].as_str().unwrap().to_owned();
    finished_in_store(world.dir.path(), &id).await;
    // The result lasts until the token's exp, and not a millisecond past it, though the TTL does.
    world.clock.advance(29_999);
    let renewed = bearer(&world.token("ada", "app"));
    assert_eq!(
        task_result(&get(&world.b.client, &id, &renewed).await)["success"],
        json!(true)
    );
    world.clock.advance(1);
    let renewed = bearer(&world.token("ada", "app"));
    assert_unknown(
        &task_rpc(&world.b.client, "tasks/get", &id, &renewed).await,
        "a result at its token's exp",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_command_s_own_failure_with_a_notice_s_code_is_the_host_s_notice() {
    let world = World::start().await;
    let ada = bearer(&world.token("ada", "app"));
    for code in ["TASK_LOST", "TASK_TOKEN_EXPIRED"] {
        let input = json!({ "fail_code": code });
        let id = id_of(&call(&world.a.client, &ada, "job-echo", input.clone(), true).await);
        let body = settled(&world.b.client, &id, &ada).await;
        let result = task_result(&body);
        assert_eq!(result["error"]["code"], json!(code), "{result}");
        assert_eq!(result["error"]["retryable"], json!(false), "{result}");
        assert!(!body.to_string().contains("canary-own"), "{body}");
        // The inline call answers the command's own words, as before.
        let own = inline(&call(&world.a.client, &ada, "job-echo", input, false).await);
        assert_eq!(own["error"]["message"], json!("canary-own-message"));
    }
}

// ─── Leases ──────────────────────────────────────────────────────────────────────────────────

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_live_runner_keeps_its_lease_across_clock_jumps_and_a_hung_one_loses_it() {
    let world = World::start().await;
    let ada = bearer(&world.token("ada", "app"));
    let dir = world.dir.path();
    let id = id_of(&call(&world.a.client, &ada, "job-wait", json!({}), true).await);
    eventually(|| world.gate.started.load(Ordering::SeqCst) == 1).await;
    let start = afd::Clock::now(&world.clock);
    assert_eq!(stored(dir, &id).1, Some(start + 10_000));
    // Twice, nearly a whole lease later: the runner's heartbeat renews it, and the other process
    // finds the task working.
    for _ in 0..2 {
        world.clock.advance(9_999);
        let now = afd::Clock::now(&world.clock);
        eventually(|| stored(dir, &id).1 == Some(now + 10_000)).await;
        let body = get(&world.b.client, &id, &ada).await;
        assert_eq!(body["result"]["status"], json!("working"), "{body}");
    }
    world.gate.release.store(true, Ordering::SeqCst);
    let done = settled(&world.b.client, &id, &ada).await;
    assert_eq!(task_result(&done)["success"], json!(true));
    // A runner that hangs in a live process renews nothing: a lease later, its task is lost.
    let hung = id_of(&call(&world.a.client, &ada, "job-hang", json!({}), true).await);
    eventually(|| world.gate.started.load(Ordering::SeqCst) == 2).await;
    let lease = stored(dir, &hung).1.unwrap();
    world.clock.advance(10_000);
    let lost = get(&world.b.client, &hung, &ada).await;
    assert_eq!(
        task_result(&lost)["error"]["code"],
        json!("TASK_LOST"),
        "{lost}"
    );
    // When the runner wakes, its late result changes nothing.
    world.gate.unhang.store(true, Ordering::SeqCst);
    tokio::time::sleep(Duration::from_millis(1_500)).await;
    let again = get(&world.a.client, &hung, &ada).await;
    assert_eq!(again, lost);
    assert!(lease <= afd::Clock::now(&world.clock));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_task_another_process_finds_lost_stops_where_it_runs_and_gets_no_more_services() {
    let world = World::start().await;
    let ada = bearer(&world.token("ada", "app"));
    let tag = "lost-loop";
    let id = id_of(
        &call(
            &world.a.client,
            &ada,
            "tasker-loop",
            json!({ "tag": tag }),
            true,
        )
        .await,
    );
    eventually(|| seen_of(tag).calls > 0).await;
    // The lease is forced out while the handler is live: as if its runner had stopped renewing.
    {
        let connection =
            rusqlite::Connection::open(world.dir.path().join("state/shared/tasks.sqlite3"))
                .unwrap();
        connection.busy_timeout(Duration::from_secs(5)).unwrap();
        connection
            .execute(
                "UPDATE tasks SET lease_process = 'p-elsewhere', lease_until_ms = 0 WHERE id = ?1",
                [&id],
            )
            .unwrap();
    }
    let lost = get(&world.b.client, &id, &ada).await;
    assert_eq!(
        task_result(&lost)["error"]["code"],
        json!("TASK_LOST"),
        "{lost}"
    );
    // The runner on a finds its task ended, stops it, and the plugin is refused its next call.
    eventually(|| seen_of(tag).refused).await;
    let after = seen_of(tag).calls;
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(seen_of(tag).calls, after, "the loop stopped");
    // Nothing was written over the loss, on either process.
    assert_eq!(get(&world.a.client, &id, &ada).await, lost);
    // A cancel now changes nothing, and is answered.
    let reply = task_rpc(&world.a.client, "tasks/cancel", &id, &ada).await;
    assert!(reply.json()["error"].is_null(), "{}", reply.text);
    assert_eq!(get(&world.b.client, &id, &ada).await, lost);
}

#[tokio::test]
async fn a_hosted_workspace_s_lock_wait_must_leave_the_lease_a_margin() {
    let kit = TestIdp::start().await.unwrap();
    for (wait, accepted) in [(5_000, true), (5_001, false)] {
        let rest = format!("[store]\nlock_timeout_ms = {wait}\n");
        let setup = support::oauth::Setup {
            rest: &rest,
            ..support::oauth::Setup::default()
        };
        let dir = support::workspace(&support::oauth::config(&kit, &setup));
        let sealed = HostBuilder::open(dir.path())
            .unwrap()
            .register(support::oauth::whoami())
            .register(support::oauth::touch())
            .seal();
        match sealed {
            Ok(_) => assert!(accepted, "{wait}"),
            Err(error) => {
                assert!(!accepted, "{wait}: {error:?}");
                assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID");
                assert!(
                    error.message().contains("store.lock_timeout_ms"),
                    "{error:?}"
                );
            }
        }
    }
}

// ─── A crash and a restart ───────────────────────────────────────────────────────────────────

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_task_whose_process_dies_is_lost_once_for_every_process() {
    let kit = TestIdp::start().await.unwrap();
    let rest = format!("{SPACES}\n{TASKER_PLUGINS}");
    let setup = support::oauth::Setup {
        rest: &rest,
        ..support::oauth::Setup::default()
    };
    let dir = support::workspace(&support::oauth::config(&kit, &setup));
    let clock = clock_now();
    let gate = Arc::new(Gate::default());
    let token = |subject: &str| {
        kit.authorization_server()
            .access_token(PUBLIC_URL)
            .issued_at(afd::Clock::now(&clock).div_euclid(1000))
            .lifetime(300)
            .subject(subject)
            .client_id("app")
            .scopes(["umbel:read", "umbel:write"])
            .sign()
    };
    // Process a runs on a runtime of its own, so the test can end it as a crash would: its
    // tasks stop at once and write nothing.
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap();
    let a = {
        let (dir, pem, clock, gate) = (
            dir.path().to_owned(),
            kit.ca().certificate_pem().to_owned(),
            clock.clone(),
            Arc::clone(&gate),
        );
        runtime
            .spawn(async move { serve(host_on(&dir, &pem, &clock, &gate)).await })
            .await
            .unwrap()
    };
    let address = a.served.address;
    let b = process(dir.path(), &kit, &clock, &gate).await;
    let ada = bearer(&token("ada"));
    let id = id_of(&call(&Client::plain(address), &ada, "job-wait", json!({}), true).await);
    eventually(|| gate.started.load(Ordering::SeqCst) == 1).await;
    // The crash: a's runtime ends with its handler mid-wait.
    let crashed = tokio::task::spawn_blocking(move || {
        runtime.shutdown_timeout(Duration::from_secs(10));
        a
    });
    drop(crashed.await.unwrap());
    assert_eq!(
        get(&b.client, &id, &ada).await["result"]["status"],
        json!("working")
    );
    // A restarted a, with a new lease name, on the same workspace.
    let restarted = process(dir.path(), &kit, &clock, &gate).await;
    // Ten seconds later the lease has not been renewed: lost, once, the same for every process.
    clock.advance(9_999);
    let ada = bearer(&token("ada"));
    assert_eq!(
        get(&restarted.client, &id, &ada).await["result"]["status"],
        json!("working")
    );
    clock.advance(1);
    let ada = bearer(&token("ada"));
    let lost = get(&restarted.client, &id, &ada).await;
    let result = task_result(&lost);
    assert_eq!(result["error"]["code"], json!("TASK_LOST"), "{result}");
    assert_eq!(result["error"]["retryable"], json!(false), "{result}");
    let again = get(&b.client, &id, &ada).await;
    assert_eq!(again, lost);
    // Still the owner's alone.
    let bo = bearer(&token("bo"));
    assert_unknown(&task_rpc(&b.client, "tasks/get", &id, &bo).await, "bo");
}

// ─── The gateway ─────────────────────────────────────────────────────────────────────────────

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_gateway_task_never_outlives_its_assertion() {
    let kit = TestIdp::start().await.unwrap();
    let dir = support::workspace(&support::gateway::config(
        &kit,
        &support::gateway::Setup::default(),
    ));
    support::gateway::write_keys(dir.path(), &kit);
    let clock = clock_now();
    let gate = Arc::new(Gate::default());
    let process = process(dir.path(), &kit, &clock, &gate).await;
    let client = &process.client;
    // A fresh assertion per request (each is spent once), issued now on the host's clock.
    let assertion = |caller: &str| {
        vec![(
            support::gateway::ASSERTION.to_owned(),
            kit.gateway()
                .assertion(PUBLIC_URL, "POST")
                .issued_at(afd::Clock::now(&clock).div_euclid(1000))
                .lifetime(60)
                .claim("client", json!(caller))
                .scopes(["umbel:read", "umbel:write"])
                .sign(),
        )]
    };
    let task = created(&call(client, &assertion("gw-client"), "job-wait", json!({}), true).await);
    // The assertion lives 60 seconds: the task's TTL ends a minute after it.
    assert_eq!(task["ttlMs"], json!(120_000));
    let id = task["taskId"].as_str().unwrap().to_owned();
    eventually(|| gate.started.load(Ordering::SeqCst) == 1).await;
    // Each poll carries a fresh assertion for the same caller: the same owner.
    assert_eq!(
        get(client, &id, &assertion("gw-client")).await["result"]["status"],
        json!("working")
    );
    assert_unknown(
        &task_rpc(client, "tasks/get", &id, &assertion("other-client")).await,
        "another gateway client",
    );
    // At the assertion's exp the task stops, though its caller is still polling with new ones:
    // no credential vouches for the caller who started it after that.
    clock.advance(60_000);
    finished_in_store(dir.path(), &id).await;
    let body = get(client, &id, &assertion("gw-client")).await;
    assert_eq!(
        task_result(&body)["error"]["code"],
        json!("TASK_TOKEN_EXPIRED"),
        "{body}"
    );
    eventually(|| gate.stopped.load(Ordering::SeqCst) == 1).await;
    clock.advance(60_000);
    assert_unknown(
        &task_rpc(client, "tasks/get", &id, &assertion("gw-client")).await,
        "past the grace",
    );
}

// ─── Callers a server cannot tell apart ──────────────────────────────────────────────────────

#[tokio::test]
async fn mode_none_over_http_starts_no_task() {
    let dir = support::workspace("config_version = 5\ndefault_space = \"main\"\n\n[spaces.main]\n");
    let gate = Arc::new(Gate::default());
    let host = jobs(HostBuilder::open(dir.path()).unwrap(), &gate)
        .seal()
        .unwrap();
    let http = support::mcp::Http::new(&host);
    let with_tasks = |params: Value| {
        let mut params = params;
        let mut meta = support::mcp::modern_meta();
        meta["io.modelcontextprotocol/clientCapabilities"] =
            json!({ "extensions": { EXTENSION: {} } });
        params["_meta"] = meta;
        params
    };
    // Every loopback caller is one principal: an optional command runs inline...
    let reply = http
        .modern_reply(
            "tools/call",
            with_tasks(
                json!({ "name": "afd-call", "arguments": { "command": "job-echo", "input": {} } }),
            ),
            &[],
        )
        .await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    assert_eq!(reply.json()["result"]["resultType"], json!("complete"));
    // ...a required one is refused before it runs...
    let reply = http
        .modern_reply(
            "tools/call",
            with_tasks(
                json!({ "name": "afd-call", "arguments": { "command": "job-must", "input": {} } }),
            ),
            &[],
        )
        .await;
    let result = reply.json()["result"]["structuredContent"].clone();
    assert_eq!(result["error"]["code"], json!("UNAUTHORIZED"), "{result}");
    // ...and there are no tasks to ask about.
    let reply = http
        .modern_reply(
            "tasks/get",
            with_tasks(json!({ "taskId": "a".repeat(26) })),
            &[("mcp-name", &"a".repeat(26))],
        )
        .await;
    assert_eq!(
        reply.json()["error"]["code"],
        json!(-32601),
        "{}",
        reply.text
    );
    assert!(
        !host.workspace().layout().tasks_store().exists(),
        "mode none keeps no shared task store"
    );
}

#[tokio::test]
async fn a_task_command_must_be_a_mutation_exposed_to_mcp() {
    let dir = support::minimal();
    let read = CommandDefinition::new("job-read", "A read.", vec![], Echo)
        .with_expose(exposed())
        .with_task(TaskSupport::Optional);
    let error = HostBuilder::open(dir.path())
        .unwrap()
        .register(read)
        .seal()
        .err()
        .unwrap();
    assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID");
    assert!(error.message().contains("not a mutation"), "{error:?}");
    let hidden = CommandDefinition::new("job-hidden", "A job.", vec![], Echo)
        .with_expose(ExposeOptions::new().with_cli(true))
        .as_mutation()
        .with_task(TaskSupport::Optional);
    let error = HostBuilder::open(dir.path())
        .unwrap()
        .register(hidden)
        .seal()
        .err()
        .unwrap();
    assert!(error.message().contains("not exposed to MCP"), "{error:?}");
}
