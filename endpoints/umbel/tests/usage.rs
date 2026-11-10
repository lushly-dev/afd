//! Usage events (phase 5 specification, sections 10.2, 12.1 and 12.3; step 9), end to end over
//! HTTP with `umbel-testkit-idp`: two hosts on one workspace stand for two processes behind one
//! URL, sharing `state/usage/usage.sqlite3`, and two `umbel serve --http` processes share it for
//! real.
//!
//! It covers one record per metered request on every method and outcome, with only
//! `usage-event.v1`'s fields; requests refused before their body is read, which are not metered;
//! a slow and a failing store that neither delay nor fail a request, with the drops counted;
//! `usage-list` for its own, `usage.readers` by principal, static group and claim group, and
//! everyone else, whose answers equal the empty answer byte for byte; sealed cursors and no
//! totals; retention and the purge from the database and its write-ahead log; the operator,
//! stdio, the library and mode `none`; equivalents; and the configuration's refusals.
//!
//! Every wait is bounded and waits for a state, never for a time.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use afd::{
    Actor, ActorKind, CommandContext, CommandDefinition, CommandHandler, CommandResult,
    ExposeOptions, ManualClock, TaskSupport,
};
use async_trait::async_trait;
use serde_json::{Value, json};
use support::hosted::{Client, PUBLIC_URL, Reply, Served};
use umbel::{Host, HostBuilder};
use umbel_sdk::{Cx, Outcome, Plugin};
use umbel_testkit_idp::TestIdp;

const EXTENSION: &str = "io.modelcontextprotocol/tasks";
/// Text a request carries that no record may hold.
const CANARY: &str = "canary-usage-input-7f3a";

// ─── Commands and a plugin ───────────────────────────────────────────────────────────────────

/// `job-echo`: answers at once; fails with `JOB_FAILED` when asked to. A mutation with a `space`
/// input that may run as a task.
struct Echo;

#[async_trait]
impl CommandHandler for Echo {
    async fn execute(&self, input: Value, _context: CommandContext) -> CommandResult<Value> {
        if input["fail"] == json!(true) {
            return afd::failure(
                afd::CommandError::new("JOB_FAILED", "The job failed").with_suggestion("Retry."),
            );
        }
        afd::success(json!({ "echoed": true }))
    }
}

fn exposed() -> ExposeOptions {
    ExposeOptions::new()
        .with_palette(false)
        .with_mcp(true)
        .with_agent(true)
        .with_cli(true)
}

fn job_echo() -> (CommandDefinition, Value) {
    (
        CommandDefinition::new("job-echo", "A test job.", vec![], Echo)
            .with_expose(exposed())
            .as_mutation()
            .with_task(TaskSupport::Optional),
        json!({
            "type": "object",
            "properties": {
                "space": { "type": "string" },
                "fail": { "type": "boolean" },
                "q": { "type": "string" },
            },
            "additionalProperties": false,
        }),
    )
}

/// `fixture-usage`: the usage slot id the context hook gave the call.
fn usage_key() -> CommandDefinition {
    support::fixture("fixture-usage", |_, context| {
        afd::success(json!({ "slot": context.extra.get("dev.umbel/usage") }))
    })
}

const PROBE: &str = r#"manifest_version = 5
protocol = 1

[plugin]
id = "probe"
title = "Probe"
version = "0.1.0"
description = "A plugin whose instance serves one space, for the usage tests."
kind = "compiled"
domains = ["probe"]

[[commands]]
name = "probe-run"
description = "Answer at once."
effects = ["inspect"]
input_schema = { type = "object", properties = { space = { type = "string" } }, additionalProperties = false }
"#;

struct Probe;

impl Plugin for Probe {
    fn manifest(&self) -> &'static str {
        PROBE
    }

    fn handle(&self, _name: &str, _input: Value, _cx: &mut Cx) -> Outcome {
        umbel_sdk::success(json!({ "probed": true }))
    }
}

/// `alpha` is ada's, `private` is bo's; `main`, the default, is anyone's. The probe instance
/// serves `private` only, so to ada its command does not exist (section 9.4).
const SPACES: &str = r#"[spaces.alpha]
readers = ["human:corp/ada"]

[spaces.private]
readers = ["human:corp/bo"]

[plugins]
enabled = ["probe"]

[plugins.probe]
spaces = ["private"]
"#;

// ─── Two processes on one oauth workspace ────────────────────────────────────────────────────

struct Process {
    host: Host,
    _served: Served,
    client: Client,
}

fn host_on(
    dir: &Path,
    kit: &TestIdp,
    clock: &ManualClock,
    configure: impl FnOnce(HostBuilder) -> HostBuilder,
) -> Host {
    support::oauth::host_with(dir, kit, Some(clock), None, |builder| {
        let (echo, schema) = job_echo();
        configure(
            builder
                .register_with_schema(echo, schema)
                .register(usage_key())
                .with_compiled(umbel::plugins::sdk(Probe)),
        )
    })
}

async fn serve(host: Host) -> Process {
    let served = Served::start(&host).await;
    let client = Client::plain(served.address);
    Process {
        host,
        _served: served,
        client,
    }
}

struct World {
    kit: TestIdp,
    dir: tempfile::TempDir,
    clock: ManualClock,
    a: Process,
    b: Process,
}

impl World {
    /// Two processes on a workspace with [`SPACES`] and `extra`; `configure` builds process `a`.
    async fn start(extra: &str, configure: impl FnOnce(HostBuilder) -> HostBuilder) -> Self {
        let kit = TestIdp::start().await.unwrap();
        let rest = format!("{SPACES}\n{extra}");
        let setup = support::oauth::Setup {
            rest: &rest,
            ..support::oauth::Setup::default()
        };
        let dir = support::workspace(&support::oauth::config(&kit, &setup));
        let clock = afd::fixed_clock(support::oauth::now_ms() / 1000 * 1000);
        let a = serve(host_on(dir.path(), &kit, &clock, configure)).await;
        let b = serve(host_on(dir.path(), &kit, &clock, |builder| builder)).await;
        Self {
            kit,
            dir,
            clock,
            a,
            b,
        }
    }

    fn now_s(&self) -> i64 {
        afd::Clock::now(&self.clock).div_euclid(1000)
    }

    /// A token for `subject` and `client`, for 300 seconds, with `scopes`.
    fn token(&self, subject: &str, client: &str, scopes: &[&str]) -> String {
        self.builder(subject, client, scopes).sign()
    }

    fn builder(
        &self,
        subject: &str,
        client: &str,
        scopes: &[&str],
    ) -> umbel_testkit_idp::TokenBuilder {
        self.kit
            .authorization_server()
            .access_token(PUBLIC_URL)
            .issued_at(self.now_s())
            .lifetime(300)
            .subject(subject)
            .client_id(client)
            .scopes(scopes.iter().copied())
    }

    fn rw(&self, subject: &str) -> String {
        self.token(subject, "app", &["umbel:read", "umbel:write"])
    }

    fn dir(&self) -> &Path {
        self.dir.path()
    }
}

/// A 2026-07-28 JSON-RPC request body; `tasks` declares the extension.
fn body(method: &str, mut params: Value, tasks: bool) -> String {
    let mut meta = support::mcp::modern_meta();
    if tasks {
        meta["io.modelcontextprotocol/clientCapabilities"] =
            json!({ "extensions": { EXTENSION: {} } });
    }
    params["_meta"] = meta;
    json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params }).to_string()
}

/// Send `method` with `params`, with a bearer `token` when given.
async fn rpc(
    client: &Client,
    method: &str,
    params: Value,
    tasks: bool,
    token: Option<&str>,
) -> Reply {
    let name = params["name"]
        .as_str()
        .or(params["taskId"].as_str())
        .map(str::to_owned);
    let text = body(method, params, tasks);
    let bearer = token.map(|token| format!("Bearer {token}"));
    let mut headers: Vec<(&str, &str)> = vec![
        ("content-type", "application/json"),
        ("accept", "application/json, text/event-stream"),
        ("mcp-protocol-version", "2026-07-28"),
        ("mcp-method", method),
    ];
    if let Some(name) = &name {
        headers.push(("mcp-name", name));
    }
    if let Some(bearer) = &bearer {
        headers.push(("authorization", bearer));
    }
    client
        .send(client.request("POST", "/mcp", &headers, text))
        .await
}

/// `command` with `input` through `afd-call`.
async fn afd_call(client: &Client, token: &str, command: &str, input: Value, tasks: bool) -> Reply {
    rpc(
        client,
        "tools/call",
        json!({ "name": "afd-call", "arguments": { "command": command, "input": input } }),
        tasks,
        Some(token),
    )
    .await
}

/// A call's `CommandResult`, which must have come back.
fn result(reply: &Reply) -> Value {
    assert_eq!(reply.status, 200, "{}", reply.text);
    reply.json()["result"]["structuredContent"].clone()
}

/// A `CommandResult` without what differs between two runs (trace id, timing).
fn comparable(mut result: Value) -> Value {
    if let Some(metadata) = result["metadata"].as_object_mut() {
        metadata.remove("traceId");
        metadata.remove("executionTimeMs");
    }
    result
}

// ─── The store, read from outside ────────────────────────────────────────────────────────────

fn store_path(dir: &Path) -> std::path::PathBuf {
    dir.join("state/usage/usage.sqlite3")
}

/// Every record the store holds, in the order appended.
fn stored(dir: &Path) -> Vec<Value> {
    let path = store_path(dir);
    if !path.is_file() {
        return Vec::new();
    }
    let Ok(connection) =
        rusqlite::Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
    else {
        return Vec::new();
    };
    let Ok(mut statement) = connection.prepare("SELECT record FROM usage ORDER BY seq") else {
        return Vec::new();
    };
    statement
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .map(|record| serde_json::from_str(&record.unwrap()).unwrap())
        .collect()
}

/// Wait until the store holds `n` records (bounded: thirty seconds), and no more.
async fn settle(dir: &Path, n: usize) -> Vec<Value> {
    for _ in 0..3000 {
        let records = stored(dir);
        if records.len() >= n {
            assert_eq!(records.len(), n, "{records:#?}");
            return records;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("the store never held {n} records: {:#?}", stored(dir));
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

/// Whether the store's database or its write-ahead log holds `needle`.
fn file_holds(dir: &Path, needle: &str) -> bool {
    ["usage.sqlite3", "usage.sqlite3-wal"].iter().any(|name| {
        std::fs::read(dir.join("state/usage").join(name))
            .is_ok_and(|bytes| String::from_utf8_lossy(&bytes).contains(needle))
    })
}

/// The members of a record a request decides, beside its caller.
fn shape(record: &Value) -> Value {
    json!({
        "principal": record["principal"],
        "actor": record["actor"],
        "namespace": record["namespace"],
        "method": record["method"],
        "tool": record["tool"],
        "command": record["command"],
        "space": record["space"],
        "outcome": record["outcome"],
        "task": record["task"],
    })
}

fn expected(
    who: (&str, &str),
    method: &str,
    tool: Value,
    command: Value,
    space: Value,
    outcome: &str,
    task: Value,
) -> Value {
    json!({
        "principal": who.0,
        "actor": who.1,
        "namespace": "corp",
        "method": method,
        "tool": tool,
        "command": command,
        "space": space,
        "outcome": outcome,
        "task": task,
    })
}

const ADA: (&str, &str) = ("human:corp/ada", "agent:corp/app");
const BO: (&str, &str) = ("human:corp/bo", "agent:corp/app");

/// The record without what differs between two requests that should be metered alike.
fn alike(mut record: Value) -> Value {
    for member in ["id", "at", "trace", "bytesIn", "bytesOut", "durationMs"] {
        record.as_object_mut().unwrap().remove(member);
    }
    record
}

// ─── Every method and outcome ────────────────────────────────────────────────────────────────

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn every_metered_method_and_outcome_is_one_record_of_its_fields_alone() {
    let world = World::start("", |builder| builder).await;
    let dir = world.dir();
    let ada = world.rw("ada");
    let bo = world.rw("bo");
    let (a, b) = (&world.a.client, &world.b.client);
    let validator = support::schema_validator("usage-event.v1");
    let mut n = 0;
    let mut next = |records: &[Value]| -> Value {
        n += 1;
        records[n - 1].clone()
    };

    // Refused before its caller is known: nothing is metered, even when a layer read the body
    // first (AFD reads a form body before it looks for the token, M2).
    let form = a
        .send(a.request(
            "POST",
            "/mcp",
            &[
                ("content-type", "application/x-www-form-urlencoded"),
                ("accept", "application/json, text/event-stream"),
            ],
            body("tools/list", json!({}), false),
        ))
        .await;
    assert_eq!(form.status, 401, "{}", form.text);
    assert_eq!(
        rpc(a, "tools/list", json!({}), false, None).await.status,
        401
    );
    assert_eq!(
        rpc(a, "tools/list", json!({}), false, Some("not-a-token"))
            .await
            .status,
        401
    );

    // tools/list.
    let reply = rpc(a, "tools/list", json!({}), false, Some(&ada)).await;
    assert_eq!(reply.status, 200);
    let record = next(&settle(dir, 1).await);
    assert_eq!(
        shape(&record),
        expected(
            ADA,
            "tools/list",
            Value::Null,
            Value::Null,
            Value::Null,
            "ok",
            Value::Null
        )
    );
    assert_eq!(record["transport"], "http");
    assert_eq!(record["trace"], Value::Null, "no command ran");

    // A first-class tool: its bytes as sent and received, and its trace id.
    let params = json!({ "name": "fixture-whoami", "arguments": {} });
    let sent = body("tools/call", params.clone(), false).len();
    let reply = rpc(a, "tools/call", params, false, Some(&ada)).await;
    assert_eq!(result(&reply)["success"], true);
    let record = next(&settle(dir, 2).await);
    assert_eq!(
        shape(&record),
        expected(
            ADA,
            "tools/call",
            json!("fixture-whoami"),
            json!("fixture-whoami"),
            Value::Null,
            "ok",
            Value::Null
        )
    );
    assert_eq!(record["bytesIn"], json!(sent));
    assert_eq!(record["bytesOut"], json!(reply.text.len()));
    assert!(
        record["trace"].as_str().is_some_and(|t| !t.is_empty()),
        "{record}"
    );
    let id = record["id"].as_str().unwrap();
    assert!(id.starts_with("u-") && id.len() == 28, "{id}");

    // `afd-call` in a space ada reads; the input's text is never kept.
    let reply = afd_call(
        a,
        &ada,
        "job-echo",
        json!({ "space": "alpha", "q": CANARY }),
        false,
    )
    .await;
    assert_eq!(result(&reply)["success"], true);
    let record = next(&settle(dir, 3).await);
    assert_eq!(
        shape(&record),
        expected(
            ADA,
            "tools/call",
            json!("afd-call"),
            json!("job-echo"),
            json!("alpha"),
            "ok",
            Value::Null
        )
    );

    // A command's own failure, in the default space it ran in.
    let reply = afd_call(a, &ada, "job-echo", json!({ "fail": true }), false).await;
    assert_eq!(result(&reply)["error"]["code"], "JOB_FAILED");
    let record = next(&settle(dir, 4).await);
    assert_eq!(
        shape(&record),
        expected(
            ADA,
            "tools/call",
            json!("afd-call"),
            json!("job-echo"),
            json!("main"),
            "JOB_FAILED",
            Value::Null
        )
    );

    // A space ada may not read and one that does not exist: one record, as one answer (5.4).
    let unreadable = afd_call(a, &ada, "job-echo", json!({ "space": "private" }), false).await;
    let undeclared = afd_call(a, &ada, "job-echo", json!({ "space": "nowhere" }), false).await;
    assert_eq!(
        comparable(result(&unreadable)),
        comparable(result(&undeclared))
    );
    assert_eq!(result(&unreadable)["error"]["code"], "SPACE_NOT_READABLE");
    let records = settle(dir, 6).await;
    let (first, second) = (next(&records), next(&records));
    assert_eq!(
        shape(&first),
        expected(
            ADA,
            "tools/call",
            json!("afd-call"),
            json!("job-echo"),
            Value::Null,
            "SPACE_NOT_READABLE",
            Value::Null
        )
    );
    assert_eq!(alike(first), alike(second));

    // A command hidden from ada (its instance serves no space she reads) and one that does not
    // exist: neither is named, and the two records are alike.
    let hidden = afd_call(a, &ada, "probe-run", json!({ "space": "private" }), false).await;
    let missing = afd_call(
        a,
        &ada,
        "probe-nothing",
        json!({ "space": "private" }),
        false,
    )
    .await;
    assert_eq!(
        comparable(result(&hidden))
            .to_string()
            .replace("probe-run", "NAME"),
        comparable(result(&missing))
            .to_string()
            .replace("probe-nothing", "NAME")
    );
    let records = settle(dir, 8).await;
    let (first, second) = (next(&records), next(&records));
    assert_eq!(first["command"], Value::Null, "{first}");
    assert_eq!(first["space"], Value::Null, "{first}");
    assert_eq!(alike(first), alike(second));
    // To bo, who reads `private`, it exists and runs there.
    let reply = afd_call(b, &bo, "probe-run", json!({ "space": "private" }), false).await;
    assert_eq!(result(&reply)["success"], true, "{}", reply.text);
    let record = next(&settle(dir, 9).await);
    assert_eq!(
        shape(&record),
        expected(
            BO,
            "tools/call",
            json!("afd-call"),
            json!("probe-run"),
            json!("private"),
            "ok",
            Value::Null
        )
    );

    // A tool that does not exist is not named either.
    let reply = rpc(
        a,
        "tools/call",
        json!({ "name": "no-such-tool", "arguments": {} }),
        false,
        Some(&ada),
    )
    .await;
    assert_eq!(reply.status, 200);
    let record = next(&settle(dir, 10).await);
    assert_eq!(
        (&record["tool"], &record["command"]),
        (&Value::Null, &Value::Null)
    );
    assert_ne!(record["outcome"], "ok", "{record}");

    // A missing scope, refused before dispatch once the body was read: its status, its caller.
    let reader = world.token("ada", "app", &["umbel:read"]);
    let reply = rpc(
        a,
        "tools/call",
        json!({ "name": "fixture-touch", "arguments": {} }),
        false,
        Some(&reader),
    )
    .await;
    assert_eq!(reply.status, 403, "{}", reply.text);
    let record = next(&settle(dir, 11).await);
    assert_eq!(
        shape(&record),
        expected(
            ADA,
            "tools/call",
            Value::Null,
            Value::Null,
            Value::Null,
            "403",
            Value::Null
        )
    );

    // A task: its creation on one process, then each task method on the other, metered with the
    // task's command and space, from the creation the owner recorded.
    let reply = afd_call(a, &ada, "job-echo", json!({ "space": "alpha" }), true).await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    let task = reply.json()["result"]["taskId"]
        .as_str()
        .unwrap()
        .to_owned();
    let record = next(&settle(dir, 12).await);
    assert_eq!(
        shape(&record),
        expected(
            ADA,
            "tools/call",
            json!("afd-call"),
            json!("job-echo"),
            json!("alpha"),
            "ok",
            json!(task)
        )
    );
    for (count, method) in [
        (13, "tasks/get"),
        (14, "tasks/update"),
        (15, "tasks/cancel"),
    ] {
        let mut params = json!({ "taskId": task });
        if method == "tasks/update" {
            params["inputResponses"] = json!({});
        }
        let reply = rpc(b, method, params, true, Some(&ada)).await;
        assert_eq!(reply.status, 200, "{}", reply.text);
        assert!(reply.json().get("error").is_none(), "{}", reply.text);
        let record = next(&settle(dir, count).await);
        assert_eq!(
            shape(&record),
            expected(
                ADA,
                method,
                Value::Null,
                json!("job-echo"),
                json!("alpha"),
                "ok",
                json!(task)
            ),
            "{method}"
        );
    }
    // Another principal's poll of it, and an unknown id: the one unknown answer, with no command.
    let reply = rpc(b, "tasks/get", json!({ "taskId": task }), true, Some(&bo)).await;
    assert_eq!(reply.json()["error"]["code"], -32602, "{}", reply.text);
    let unknown = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
    rpc(
        b,
        "tasks/get",
        json!({ "taskId": unknown }),
        true,
        Some(&ada),
    )
    .await;
    let records = settle(dir, 17).await;
    let (theirs, missing) = (next(&records), next(&records));
    assert_eq!(
        shape(&theirs),
        expected(
            BO,
            "tasks/get",
            Value::Null,
            Value::Null,
            Value::Null,
            "INVALID_PARAMS",
            Value::Null
        )
    );
    assert_eq!(
        shape(&missing),
        expected(
            ADA,
            "tasks/get",
            Value::Null,
            Value::Null,
            Value::Null,
            "INVALID_PARAMS",
            Value::Null
        )
    );
    // A failed poll keeps no id: neither another's task nor text the caller chose.
    let _ = unknown;

    // A task in a space ada may not read is created all the same (step 8: creation never depends
    // on the space), and its record names no space.
    let reply = afd_call(a, &ada, "job-echo", json!({ "space": "private" }), true).await;
    let hidden_task = reply.json()["result"]["taskId"]
        .as_str()
        .unwrap()
        .to_owned();
    let record = next(&settle(dir, 18).await);
    assert_eq!(
        shape(&record),
        expected(
            ADA,
            "tools/call",
            json!("afd-call"),
            json!("job-echo"),
            Value::Null,
            "ok",
            json!(hidden_task)
        )
    );
    // A task created without a space runs in the default space, which ada reads: its record
    // names it, as the task store does.
    let reply = afd_call(a, &ada, "job-echo", json!({}), true).await;
    let default_task = reply.json()["result"]["taskId"]
        .as_str()
        .unwrap()
        .to_owned();
    let record = next(&settle(dir, 19).await);
    assert_eq!(record["space"], "main", "{record}");
    assert_eq!(record["task"], json!(default_task));

    // A body that names a member twice is metered by its method and names nothing: which of the
    // two the server took is its own parser's choice.
    let twice = format!(
        r#"{{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{{"name":"afd-call","arguments":{{"command":"job-echo","command":"probe-run","input":{{"space":"alpha"}}}},"_meta":{}}}}}"#,
        support::mcp::modern_meta()
    );
    let bearer = format!("Bearer {ada}");
    let reply = a
        .send(a.request(
            "POST",
            "/mcp",
            &[
                ("content-type", "application/json"),
                ("accept", "application/json, text/event-stream"),
                ("mcp-protocol-version", "2026-07-28"),
                ("mcp-method", "tools/call"),
                ("mcp-name", "afd-call"),
                ("authorization", &bearer),
            ],
            twice,
        ))
        .await;
    assert!(reply.status == 200 || reply.status >= 400, "{}", reply.text);
    let record = next(&settle(dir, 20).await);
    assert_eq!(
        (
            &record["method"],
            &record["tool"],
            &record["command"],
            &record["space"]
        ),
        (
            &json!("tools/call"),
            &Value::Null,
            &Value::Null,
            &Value::Null
        ),
        "{record}"
    );

    // Every record is `usage-event.v1`, and none holds the input's text or a token.
    for record in stored(dir) {
        if let Err(error) = validator.validate(&record) {
            panic!("{error}: {record}");
        }
    }
    for needle in [CANARY, ada.as_str(), bo.as_str(), reader.as_str()] {
        assert!(!file_holds(dir, needle), "the store holds {needle}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_gateway_caller_is_metered_as_its_assertion_maps_it() {
    let running = support::gateway::Running::start(support::gateway::Setup::default()).await;
    let dir = running.dir.path();
    // No assertion: refused before the body is read, so not metered.
    let refused = running.call(None, "fixture-whoami", json!({})).await;
    assert_eq!(refused.status, 401);
    let shown = running
        .result(running.assertion(), "fixture-whoami", json!({}))
        .await;
    assert_eq!(shown["success"], true);
    let records = settle(dir, 1).await;
    assert_eq!(
        shape(&records[0]),
        json!({
            "principal": "human:corp/ada",
            "actor": "agent:corp/gateway-client",
            "namespace": "corp",
            "method": "tools/call",
            "tool": "fixture-whoami",
            "command": "fixture-whoami",
            "space": null,
            "outcome": "ok",
            "task": null,
        })
    );
}

// ─── Off the request path ────────────────────────────────────────────────────────────────────

/// A store a test holds: closed, every append waits; failing, every append fails.
#[derive(Default)]
struct Held {
    open: Mutex<bool>,
    changed: Condvar,
    failing: AtomicBool,
    failed: AtomicUsize,
    waiting: AtomicUsize,
}

impl Held {
    fn stall(&self, size: usize) -> Result<(), String> {
        if self.failing.load(Ordering::SeqCst) {
            self.failed.fetch_add(size, Ordering::SeqCst);
            return Err("the disk is full".into());
        }
        self.waiting.fetch_add(1, Ordering::SeqCst);
        let mut open = self.open.lock().unwrap();
        while !*open {
            open = self.changed.wait(open).unwrap();
        }
        Ok(())
    }

    fn release(&self) {
        *self.open.lock().unwrap() = true;
        self.changed.notify_all();
    }
}

/// What the operator's `usage-list` answers, from the CLI.
async fn operator_list(dir: &Path, args: &[&str]) -> Value {
    let mut argv = vec!["usage", "list"];
    argv.extend_from_slice(args);
    let run = support::cli_with(dir, &argv, support::Scripted::no_terminal(), |builder| {
        let (echo, schema) = job_echo();
        builder
            .register(support::oauth::whoami())
            .register(support::oauth::touch())
            .register_with_schema(echo, schema)
            .register(usage_key())
            .with_compiled(umbel::plugins::sdk(Probe))
    })
    .await;
    assert_eq!(run.code, 0, "{}", run.stdout);
    let answer = run.json();
    assert_eq!(answer["success"], true, "{answer}");
    answer["data"].clone()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_slow_or_failing_store_never_delays_or_fails_a_request_and_drops_are_counted() {
    let held = Arc::new(Held::default());
    let stall = Arc::clone(&held);
    let world = World::start("", move |builder| {
        builder
            .with_usage_stall(move |size| stall.stall(size))
            .with_usage_queue(64, 4)
    })
    .await;
    let dir = world.dir();
    let ada = world.rw("ada");
    let bo = world.rw("bo");
    let call = |token: String| {
        let client = world.a.client.clone();
        async move {
            // A request that waited on its record would never come back while the store is held.
            let reply = tokio::time::timeout(
                Duration::from_secs(20),
                rpc(
                    &client,
                    "tools/call",
                    json!({ "name": "fixture-whoami", "arguments": {} }),
                    false,
                    Some(&token),
                ),
            )
            .await
            .expect("the request waited on its usage record");
            assert_eq!(result(&reply)["success"], true);
        }
    };
    // The store is held: every request is answered, ada's past her share of the queue dropped,
    // bo's kept.
    for _ in 0..10 {
        call(ada.clone()).await;
    }
    for _ in 0..2 {
        call(bo.clone()).await;
    }
    eventually(|| held.waiting.load(Ordering::SeqCst) >= 1).await;
    assert!(
        stored(dir).is_empty(),
        "nothing is written while the store is held"
    );
    held.release();
    let records = settle(dir, 6).await;
    let principal = |who: &str| {
        records
            .iter()
            .filter(|record| record["principal"] == who)
            .count()
    };
    assert_eq!(
        (principal("human:corp/ada"), principal("human:corp/bo")),
        (4, 2)
    );
    assert_eq!(operator_list(dir, &[]).await["dropped"], 6);

    // The store fails: every request is answered, and its records are counted as dropped.
    held.failing.store(true, Ordering::SeqCst);
    for _ in 0..3 {
        call(ada.clone()).await;
    }
    eventually(|| held.failed.load(Ordering::SeqCst) == 3).await;
    held.failing.store(false, Ordering::SeqCst);
    call(ada.clone()).await;
    settle(dir, 7).await;
    assert_eq!(operator_list(dir, &[]).await["dropped"], 9);
}

// ─── Who reads what ──────────────────────────────────────────────────────────────────────────

/// `usage-list` over HTTP as `token`'s caller.
async fn http_list(client: &Client, token: &str, input: Value) -> Value {
    result(&afd_call(client, token, "usage-list", input, false).await)
}

/// `usage-list` in process as the library caller acting for `person` (an embedder serving one
/// person): it makes no usage record of its own.
async fn library_list(host: &Host, person: &str, input: Value) -> afd::CommandResult<Value> {
    let actor = Actor::new(ActorKind::Agent)
        .with_id("corp/embedder")
        .with_on_behalf_of(format!("corp/{person}"));
    support::call(host, actor, "usage-list", input).await
}

/// The empty answer a caller who reads only its own gets with no records.
fn empty_own() -> Value {
    json!({ "records": [], "next": null, "reads": "own" })
}

const READERS: &str = r#"
[access.groups.auditors]
members = ["human:corp/dee"]

[access.groups.claimed]
members = []
claim = { issuer = "as", name = "groups", value = "usage-audit" }

[usage]
readers = ["human:corp/cy", "group:auditors", "group:claimed"]
"#;

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn each_caller_reads_its_own_readers_read_everyone_s_and_no_one_else_learns_of_it() {
    let world = World::start(READERS, |builder| builder).await;
    let dir = world.dir();
    let (a, b) = (&world.a.client, &world.b.client);
    let eve = world.rw("eve");
    // Before anyone has called: eve's answer over HTTP, and hal's in process (a library caller
    // makes no record, so hal never has one).
    let before_http = comparable(http_list(a, &eve, json!({})).await);
    assert_eq!(before_http["data"], empty_own());
    let before = library_list(&world.a.host, "hal", json!({})).await;
    assert_eq!(before.data, Some(empty_own()));
    settle(dir, 1).await;

    // ada calls through one process, bo through the other.
    let ada = world.rw("ada");
    let bo = world.rw("bo");
    for _ in 0..2 {
        result(&afd_call(a, &ada, "job-echo", json!({ "space": "alpha" }), false).await);
    }
    result(&afd_call(b, &bo, "job-echo", json!({ "space": "private" }), false).await);
    settle(dir, 4).await;

    // ada, through the other process, reads her own two: no trace, no drop count.
    let mine = http_list(b, &ada, json!({})).await["data"].clone();
    assert_eq!(mine["reads"], "own");
    let records = mine["records"].as_array().unwrap();
    assert_eq!(records.len(), 2, "{mine}");
    assert!(
        records
            .iter()
            .all(|r| r["principal"] == "human:corp/ada" && r["trace"].is_null())
    );
    assert!(mine.get("dropped").is_none(), "{mine}");
    assert_eq!(mine.as_object().unwrap().len(), 3, "no total: {mine}");
    settle(dir, 5).await;

    // gus, who has never called, and bo naming ada: exactly eve's empty answer from before
    // anyone called.
    let gus = world.rw("gus");
    assert_eq!(comparable(http_list(a, &gus, json!({})).await), before_http);
    assert_eq!(
        comparable(http_list(a, &bo, json!({ "principal": "human:corp/ada" })).await),
        before_http
    );
    let after = library_list(&world.a.host, "hal", json!({})).await;
    assert_eq!(
        serde_json::to_string(&after.data).unwrap(),
        serde_json::to_string(&before.data).unwrap()
    );
    assert_eq!(after.error, before.error);
    settle(dir, 7).await;

    // A reader by name, by a static group and by its token's claim reads everyone's, traces and
    // the drop count included.
    let cy = world.rw("cy");
    let dee = world.rw("dee");
    let fay = world
        .builder("fay", "app", &["umbel:read", "umbel:write"])
        .claim("groups", json!(["usage-audit"]))
        .sign();
    for (who, token) in [("cy", &cy), ("dee", &dee), ("fay", &fay)] {
        let all =
            http_list(a, token, json!({ "principal": "human:corp/bo" })).await["data"].clone();
        assert_eq!(all["reads"], "all", "{who}: {all}");
        assert_eq!(all["dropped"], 0, "{who}");
        // bo's call, and his list naming ada.
        let records = all["records"].as_array().unwrap();
        assert_eq!(records.len(), 2, "{who}: {all}");
        assert!(
            records
                .iter()
                .all(|r| r["principal"] == "human:corp/bo" && r["trace"].is_string()),
            "{who}: {all}"
        );
        // A reader never sees the names 5.4 hides from it: bo's space `private` is not theirs.
        let call = records.iter().find(|r| r["command"] == "job-echo").unwrap();
        assert_eq!(call["space"], Value::Null, "{who}: {call}");
    }
    // bo runs the probe in `private`; to cy its instance does not exist (9.4), so the record names
    // neither the command nor its space, while the operator sees it whole.
    result(&afd_call(b, &bo, "probe-run", json!({ "space": "private" }), false).await);
    eventually(|| stored(dir).iter().any(|r| r["command"] == "probe-run")).await;
    let all = http_list(a, &cy, json!({ "principal": "human:corp/bo" })).await["data"].clone();
    let probe = &all["records"][0];
    assert_eq!(
        (&probe["tool"], &probe["command"], &probe["space"]),
        (&json!("afd-call"), &Value::Null, &Value::Null),
        "{all}"
    );
    // fay without the claim reads her own.
    let plain_fay = world.rw("fay");
    let own = http_list(a, &plain_fay, json!({})).await["data"].clone();
    assert_eq!(own["reads"], "own", "{own}");
    // The operator reads everyone's, whole.
    let operator = operator_list(dir, &["limit=200"]).await;
    assert_eq!(operator["reads"], "all");
    assert!(
        operator["records"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["command"] == "probe-run" && r["space"] == "private"),
        "{operator}"
    );
    assert!(
        operator["records"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["principal"] == "human:corp/ada")
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn cursors_are_sealed_for_their_caller_and_no_total_is_shown() {
    let world = World::start("", |builder| builder).await;
    let dir = world.dir();
    let (a, b) = (&world.a.client, &world.b.client);
    let ada = world.rw("ada");
    let bo = world.rw("bo");
    for n in 0..3 {
        result(&afd_call(a, &ada, "job-echo", json!({}), false).await);
        settle(dir, n * 2 + 1).await;
        // bo's records fall between ada's.
        result(&afd_call(b, &bo, "job-echo", json!({}), false).await);
        settle(dir, n * 2 + 2).await;
    }
    let page = |cursor: Option<String>| {
        let host = &world.a.host;
        async move {
            let mut input = json!({ "limit": 1 });
            if let Some(cursor) = cursor {
                input["cursor"] = json!(cursor);
            }
            library_list(host, "ada", input).await.data.unwrap()
        }
    };
    let first = page(None).await;
    let cursor = first["next"].as_str().unwrap().to_owned();
    // Sealed: `u1.` and 64 base64url characters, the same each time, naming no count.
    assert!(cursor.starts_with("u1.") && cursor.len() == 67, "{cursor}");
    assert!(
        cursor[3..]
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    );
    assert_eq!(page(None).await, first);
    let second = page(Some(cursor.clone())).await;
    let third = page(Some(second["next"].as_str().unwrap().to_owned())).await;
    assert_eq!(third["next"], Value::Null);
    let paged: Vec<Value> = [&first, &second, &third]
        .iter()
        .map(|page| page["records"][0]["id"].clone())
        .collect();
    let mut hers: Vec<Value> = stored(dir)
        .into_iter()
        .filter(|record| record["principal"] == "human:corp/ada")
        .map(|record| record["id"].clone())
        .collect();
    hers.reverse();
    assert_eq!(paged, hers, "newest first, every one of hers, none of bo's");

    // bo's activity moves nothing ada sees.
    result(&afd_call(b, &bo, "job-echo", json!({}), false).await);
    settle(dir, 7).await;
    assert_eq!(page(None).await, first);

    // ada's cursor is no one else's: bo gets the answer a malformed cursor gets.
    let theirs = library_list(&world.a.host, "bo", json!({ "cursor": cursor })).await;
    let malformed = library_list(&world.a.host, "bo", json!({ "cursor": "u1.nonsense" })).await;
    assert_eq!(theirs.error.as_ref().unwrap().code, "INVALID_CURSOR");
    assert_eq!(
        serde_json::to_string(&theirs.error).unwrap(),
        serde_json::to_string(&malformed.error).unwrap()
    );
    // Over HTTP too, byte for byte.
    let over_http = comparable(http_list(b, &bo, json!({ "cursor": cursor })).await);
    let garbage = comparable(http_list(b, &bo, json!({ "cursor": "u1.nonsense" })).await);
    assert_eq!(over_http, garbage);
}

// ─── Retention ───────────────────────────────────────────────────────────────────────────────

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn records_past_retention_are_never_read_and_are_purged_from_the_database_and_its_log() {
    let usage_clock = afd::fixed_clock(support::oauth::now_ms());
    let clock = usage_clock.clone();
    let world = World::start("[usage]\nretention_days = 1\n", move |builder| {
        builder.with_usage_clock(clock)
    })
    .await;
    let dir = world.dir();
    let old = world.rw("canary-old-caller");
    result(&afd_call(&world.a.client, &old, "job-echo", json!({}), false).await);
    settle(dir, 1).await;
    assert!(file_holds(dir, "canary-old-caller"));
    let host = &world.a.host;
    let list = |input: Value| {
        let actor = Actor::new(ActorKind::Agent)
            .with_id("corp/embedder")
            .with_on_behalf_of("corp/canary-old-caller");
        async move { support::call(host, actor, "usage-list", input).await }
    };
    let read = list(json!({})).await.data.unwrap();
    assert_eq!(read["records"].as_array().unwrap().len(), 1, "{read}");
    // Two days later on the usage clock, past the retention: never read, though not yet purged.
    usage_clock.advance(2 * 86_400_000);
    assert_eq!(list(json!({})).await.data.unwrap()["records"], json!([]));
    assert!(file_holds(dir, "canary-old-caller"));
    // A new record on the usage clock: the append purges the old one, from both files.
    let ada = world.rw("ada");
    result(&afd_call(&world.a.client, &ada, "job-echo", json!({}), false).await);
    eventually(|| {
        let records = stored(dir);
        records.len() == 1 && records[0]["principal"] == "human:corp/ada"
    })
    .await;
    // The log is truncated after the purge's commit: wait for that state, not a time.
    eventually(|| !file_holds(dir, "canary-old-caller")).await;
    let read = list(json!({})).await.data.unwrap();
    assert_eq!(read["records"], json!([]));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_record_past_retention_is_hidden_before_any_purge() {
    let dir = support::workspace(
        "config_version = 5\ndefault_space = \"main\"\n\n[spaces.main]\n\n[usage]\nretention_days = 1\n",
    );
    let clock = afd::fixed_clock(support::oauth::now_ms() - 3 * 86_400_000);
    let host = HostBuilder::open(dir.path())
        .unwrap()
        .with_usage_clock(clock.clone())
        .seal()
        .unwrap();
    let mut client = support::mcp::Client::connect(
        &host,
        support::mcp::Transport::Http,
        support::mcp::Era::Modern,
    )
    .await;
    client.call("workspace-show", json!({})).await;
    settle(dir.path(), 1).await;
    // Recorded three days ago: a host on the system clock reads none of it, and purges nothing
    // when it reads.
    let reader = HostBuilder::open(dir.path()).unwrap().seal().unwrap();
    let read = support::call(&reader, support::agent("loopback"), "usage-list", json!({})).await;
    assert_eq!(read.data, Some(empty_own()));
    assert_eq!(stored(dir.path()).len(), 1);
}

// ─── The operator, stdio, the library and mode `none` ────────────────────────────────────────

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn mode_none_stdio_the_library_and_the_operator_each_read_as_the_spec_says() {
    let dir = support::workspace(
        "config_version = 5\ndefault_space = \"main\"\n\n[principal]\nlocal_id = \"ops\"\n\n[spaces.main]\n",
    );
    let host = HostBuilder::open(dir.path())
        .unwrap()
        .register(usage_key())
        .seal()
        .unwrap();
    use support::mcp::{Client as Mcp, Era, Transport};
    let mut http = Mcp::connect(&host, Transport::Http, Era::Modern).await;
    // Mode `none`: every HTTP caller is the loopback agent, and its calls are metered.
    let slot = http.afd_call("fixture-usage", json!({})).await;
    assert!(slot["data"]["slot"].is_string(), "{slot}");
    http.call("workspace-show", json!({})).await;
    let records = settle(dir.path(), 2).await;
    assert!(
        records
            .iter()
            .all(|r| r["principal"] == "agent:loopback" && r["namespace"].is_null())
    );
    // It reads the loopback agent's own records.
    let own = http.afd_call("usage-list", json!({})).await;
    assert_eq!(own["data"]["reads"], "own", "{own}");
    assert_eq!(own["data"]["records"].as_array().unwrap().len(), 2, "{own}");
    settle(dir.path(), 3).await;

    // stdio is not the operator (4.7): it reads its actor's own, which never called over HTTP.
    let mut stdio = Mcp::connect(&host, Transport::Stdio, Era::Modern).await;
    let slot = stdio.afd_call("fixture-usage", json!({})).await;
    assert_eq!(slot["data"]["slot"], Value::Null, "stdio is not metered");
    let theirs = stdio.afd_call("usage-list", json!({})).await;
    assert_eq!(theirs["data"], empty_own());

    // The library is treated by its actor: the loopback agent's own, or nothing.
    let loopback = support::call(&host, support::agent("loopback"), "usage-list", json!({})).await;
    assert_eq!(
        loopback.data.unwrap()["records"].as_array().unwrap().len(),
        3
    );
    let other = support::call(&host, support::agent("someone"), "usage-list", json!({})).await;
    assert_eq!(other.data, Some(empty_own()));

    // The operator reads everyone's, with the drop count.
    let operator = operator_list(dir.path(), &[]).await;
    assert_eq!(operator["reads"], "all");
    assert_eq!(operator["dropped"], 0);
    let records = operator["records"].as_array().unwrap();
    assert_eq!(records.len(), 3);
    // The trace ids are the operator's to read; own readers get none.
    assert!(records.iter().all(|r| r["trace"].is_string()), "{operator}");
    assert!(
        own["data"]["records"]
            .as_array()
            .unwrap()
            .iter()
            .all(|r| r["trace"].is_null())
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn with_usage_off_no_request_is_watched() {
    let dir = support::workspace(
        "config_version = 5\ndefault_space = \"main\"\n\n[spaces.main]\n\n[usage]\nenabled = false\n",
    );
    let host = HostBuilder::open(dir.path())
        .unwrap()
        .register(usage_key())
        .seal()
        .unwrap();
    let mut http = support::mcp::Client::connect(
        &host,
        support::mcp::Transport::Http,
        support::mcp::Era::Modern,
    )
    .await;
    let slot = http.afd_call("fixture-usage", json!({})).await;
    assert_eq!(slot["data"]["slot"], Value::Null, "{slot}");
    assert!(!store_path(dir.path()).exists());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn legacy_records_are_their_person_s_own_through_equivalents() {
    // Records made in mode `none` belong to the loopback agent.
    let kit = TestIdp::start().await.unwrap();
    let dir = support::workspace("config_version = 5\ndefault_space = \"main\"\n\n[spaces.main]\n");
    {
        let host = HostBuilder::open(dir.path()).unwrap().seal().unwrap();
        let mut http = support::mcp::Client::connect(
            &host,
            support::mcp::Transport::Http,
            support::mcp::Era::Modern,
        )
        .await;
        http.call("workspace-show", json!({})).await;
        settle(dir.path(), 1).await;
    }
    // The move to mode `oauth` maps the loopback agent to ada (4.6).
    let setup = support::oauth::Setup {
        principal: "local_id = \"corp/ada\"\n\n[principal.equivalents]\n\"agent:loopback\" = \"human:corp/ada\"",
        ..support::oauth::Setup::default()
    };
    std::fs::write(
        dir.path().join("umbel.toml"),
        support::oauth::config(&kit, &setup),
    )
    .unwrap();
    let clock = afd::fixed_clock(support::oauth::now_ms());
    let host = support::oauth::host(dir.path(), &kit, Some(&clock), None);
    let ada = library_list(&host, "ada", json!({})).await.data.unwrap();
    assert_eq!(ada["records"][0]["principal"], "agent:loopback", "{ada}");
    let bo = library_list(&host, "bo", json!({ "principal": "agent:loopback" }))
        .await
        .data;
    assert_eq!(bo, Some(empty_own()));
}

#[test]
fn a_group_that_holds_everyone_cannot_read_everyone_s_usage() {
    let dir = support::workspace(
        "config_version = 5\n\n[access.groups.everyone]\nmembers = [\"*\"]\n\n[usage]\nreaders = [\"group:everyone\"]\n",
    );
    let error = umbel::Workspace::open(dir.path()).unwrap_err();
    assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID");
    assert!(error.to_string().contains("usage.readers"), "{error}");
}

// ─── Two real processes ──────────────────────────────────────────────────────────────────────

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn two_server_processes_append_to_one_store_the_operator_reads() {
    use support::process::{Process as Child, http, listening_port};
    let dir = support::workspace("config_version = 5\ndefault_space = \"main\"\n\n[spaces.main]\n");
    let spawn = || {
        let child = Child::spawn(
            dir.path(),
            &["serve", "--http", "--bind", "127.0.0.1:0", "--print-token"],
        );
        let port = listening_port(&child.stderr_line());
        let token = child.stdout_line();
        (child, port, token)
    };
    let (first, first_port, token) = spawn();
    let (second, second_port, _) = spawn();
    let call = format!(
        r#"{{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{{"name":"workspace-show","arguments":{{}},"_meta":{}}}}}"#,
        support::mcp::modern_meta()
    );
    let bearer = format!("Bearer {token}");
    for port in [first_port, second_port] {
        let (status, body) = http(
            port,
            "POST",
            "/mcp",
            &[
                ("Content-Type", "application/json"),
                ("Accept", "application/json, text/event-stream"),
                ("Mcp-Protocol-Version", "2026-07-28"),
                ("Mcp-Method", "tools/call"),
                ("Mcp-Name", "workspace-show"),
                ("Authorization", &bearer),
            ],
            Some(&call),
        );
        assert_eq!(status, 200, "{body}");
    }
    let records = settle(dir.path(), 2).await;
    assert!(records.iter().all(|r| r["command"] == "workspace-show"));
    assert_ne!(records[0]["id"], records[1]["id"]);
    let operator = operator_list(dir.path(), &[]).await;
    assert_eq!(operator["records"].as_array().unwrap().len(), 2);
    drop((first, second));
}
