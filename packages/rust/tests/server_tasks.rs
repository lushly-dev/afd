//! MCP Tasks (`spec/command-metadata.md`, "Tasks"; the Tasks extension, SEP-2663) end to end over
//! Streamable HTTP and stdio: negotiation, every route, ownership across actors, issuers,
//! subjects and clients, unguessable ids, cancellation, the TTL and token expiry on an injectable
//! clock, result shapes, the store, its limits, and the registration refusals.
#![cfg(feature = "server")]

mod common;

use std::future::Future;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use afd::server::{
    failure_result, InMemoryTaskStore, McpServer, TaskCall, TaskChange, TaskOptions, TaskOwner,
    TaskRecord, TaskStore, TaskStoreError, ToolStrategy, TASKS_EXTENSION_ID,
};
use afd::{
    error_codes, failure, fixed_clock, success, Actor, ActorKind, ApprovalPolicy,
    CommandConfirmationMode, CommandContext, CommandDefinition, CommandError, CommandHandler,
    CommandParameter, CommandRegistry, CommandResult, ContextConfig, ManualClock, TaskSupport,
};
use async_trait::async_trait;
use common::Stdio;
use http_body_util::{BodyExt, Full};
use serde_json::{json, Value};
use tokio::sync::Notify;
use tower::ServiceExt;

/// The server's clock at the start of every test.
const NOW_MS: i64 = 1_793_016_000_000;
const NOW_ISO: &str = "2026-10-26T12:00:00.000Z";
const TTL_MS: u64 = 60_000;

fn meta(tasks: bool) -> Value {
    let mut meta: Value = serde_json::from_str(common::META).unwrap();
    if tasks {
        meta["io.modelcontextprotocol/clientCapabilities"] =
            json!({ "extensions": { TASKS_EXTENSION_ID: {} } });
    }
    meta
}

// ─── Commands ────────────────────────────────────────────────────────────────────────────────

#[derive(Default)]
struct Runs {
    echo: AtomicUsize,
    list: AtomicUsize,
    started: AtomicUsize,
    dropped: AtomicUsize,
    signalled: AtomicUsize,
    release: Notify,
}

impl Runs {
    fn count(counter: &AtomicUsize) -> usize {
        counter.load(Ordering::SeqCst)
    }
}

/// Echoes its input and actor, and whether it runs as a task.
struct Echo(Arc<Runs>);

#[async_trait]
impl CommandHandler for Echo {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        self.0.echo.fetch_add(1, Ordering::SeqCst);
        success(json!({
            "input": input,
            "actor": context.actor,
            "task": context.cancellation().is_some(),
        }))
    }
}

struct Fail;

#[async_trait]
impl CommandHandler for Fail {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        failure(
            CommandError::new(error_codes::NOT_FOUND, "No such job")
                .with_suggestion("Check the id"),
        )
    }
}

/// Counts a handler that was dropped before it finished.
struct Unfinished(Arc<Runs>, bool);

impl Drop for Unfinished {
    fn drop(&mut self) {
        if self.1 {
            self.0.dropped.fetch_add(1, Ordering::SeqCst);
        }
    }
}

/// Reports progress, then waits until the test releases it.
struct Wait(Arc<Runs>);

#[async_trait]
impl CommandHandler for Wait {
    async fn execute(&self, _input: Value, context: CommandContext) -> CommandResult<Value> {
        let runs = Arc::clone(&self.0);
        runs.started.fetch_add(1, Ordering::SeqCst);
        if let Some(signal) = context.cancellation() {
            // Work spawned elsewhere watches the signal.
            let signal = signal.clone();
            let watcher = Arc::clone(&runs);
            tokio::spawn(async move {
                signal.cancelled().await;
                watcher.signalled.fetch_add(1, Ordering::SeqCst);
            });
        }
        context.report_progress("phase-1");
        let mut guard = Unfinished(Arc::clone(&runs), true);
        runs.release.notified().await;
        guard.1 = false;
        success(json!({ "waited": true }))
    }
}

struct Big;

#[async_trait]
impl CommandHandler for Big {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        success(json!({ "blob": "x".repeat(4096) }))
    }
}

struct List(Arc<Runs>);

#[async_trait]
impl CommandHandler for List {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        self.0.list.fetch_add(1, Ordering::SeqCst);
        success(json!([]))
    }
}

fn exposed(command: CommandDefinition) -> CommandDefinition {
    let mut command = command;
    command.expose.mcp = true;
    command
}

fn note() -> Vec<CommandParameter> {
    vec![CommandParameter::optional_string("note", "A note")]
}

fn registry(runs: &Arc<Runs>) -> Arc<CommandRegistry> {
    let registry = Arc::new(CommandRegistry::new());
    let commands = [
        CommandDefinition::new("job-echo", "Echo", note(), Echo(Arc::clone(runs)))
            .with_task(TaskSupport::Optional),
        CommandDefinition::new("job-must", "Echo as a task", note(), Echo(Arc::clone(runs)))
            .with_task(TaskSupport::Required),
        CommandDefinition::new("job-fail", "Fail", note(), Fail).with_task(TaskSupport::Optional),
        CommandDefinition::new("job-wait", "Wait", note(), Wait(Arc::clone(runs)))
            .with_task(TaskSupport::Optional),
        CommandDefinition::new("job-big", "Big", note(), Big).with_task(TaskSupport::Optional),
        CommandDefinition::new("job-write", "Write, slowly", note(), Wait(Arc::clone(runs)))
            .as_mutation()
            .with_task(TaskSupport::Optional),
        CommandDefinition::new("job-scoped", "Scoped", note(), Echo(Arc::clone(runs)))
            .with_task(TaskSupport::Optional)
            .with_scopes(["jobs:run"]),
        CommandDefinition::new("todo-list", "List", vec![], List(Arc::clone(runs))),
    ];
    for command in commands {
        registry.register(exposed(command)).unwrap();
    }
    registry
}

struct Fixture {
    runs: Arc<Runs>,
    clock: ManualClock,
    registry: Arc<CommandRegistry>,
}

fn fixture() -> Fixture {
    let runs = Arc::new(Runs::default());
    Fixture {
        registry: registry(&runs),
        runs,
        clock: fixed_clock(NOW_MS),
    }
}

/// The test options, without the hook declaration.
fn plain_options() -> TaskOptions {
    TaskOptions::new()
        .with_ttl_ms(TTL_MS)
        .with_poll_interval_ms(250)
        .with_check_interval_ms(2)
}

/// The test options, declaring that the context hook identifies callers. The declaration counts
/// only on a server with a hook, so [`Fixture::bare`] still cannot tell its HTTP callers apart.
fn options() -> TaskOptions {
    plain_options().with_callers_identified_by_hook()
}

/// Add the identifying context hook: it maps `x-actor` (id), `x-kind` (`human`), `x-for`
/// (`onBehalfOf`) and `x-label` to the actor, refuses `x-deny`, and records each `tool` it sees.
fn identifying(server: McpServer, seen: Arc<Mutex<Vec<String>>>) -> McpServer {
    server.with_context_hook(move |request, context| {
        let seen = Arc::clone(&seen);
        async move {
            seen.lock().unwrap().push(request.tool.clone());
            if request.header("x-deny").is_some() {
                return Err(CommandError::new("UNAUTHORIZED", "Not you").with_suggestion("Sign in"));
            }
            let kind = match request.header("x-kind") {
                Some("human") => ActorKind::Human,
                _ => ActorKind::Agent,
            };
            let mut actor = Actor::new(kind);
            if let Some(id) = request.header("x-actor") {
                actor = actor.with_id(id);
            }
            if let Some(principal) = request.header("x-for") {
                actor = actor.with_on_behalf_of(principal);
            }
            if let Some(label) = request.header("x-label") {
                actor = actor.with_label(label);
            }
            Ok(context.with_actor(actor))
        }
    })
}

impl Fixture {
    /// A server with no context hook: over HTTP it cannot tell its callers apart unless it has
    /// authorization (its options declare the hook, which does not count without one).
    fn bare(&self, strategy: ToolStrategy) -> McpServer {
        let server = McpServer::new(Arc::clone(&self.registry), "jobs", "1.0.0")
            .with_tool_strategy(strategy)
            .with_clock(self.clock.clone())
            .with_task_options(options());
        if strategy == ToolStrategy::Hybrid {
            server.with_first_class_tools(["job-echo", "job-must", "job-wait"])
        } else {
            server
        }
    }

    /// A server whose context hook identifies callers, as its options declare.
    fn server(&self, strategy: ToolStrategy) -> McpServer {
        identifying(self.bare(strategy), Arc::new(Mutex::new(Vec::new())))
    }

    /// The individual-strategy [`Self::server`].
    fn hooked(&self) -> McpServer {
        self.server(ToolStrategy::Individual)
    }

    fn hooked_seeing(&self, seen: Arc<Mutex<Vec<String>>>) -> McpServer {
        identifying(self.bare(ToolStrategy::Individual), seen)
    }
}

// ─── Streamable HTTP ─────────────────────────────────────────────────────────────────────────

struct Answer {
    status: u16,
    body: Value,
    text: String,
}

/// A 2026-07-28 JSON-RPC request; `Mcp-Name` is the tool name or the task id unless `headers`
/// set it.
fn request(
    method: &str,
    params: Value,
    tasks: bool,
    headers: &[(&str, &str)],
) -> http::Request<Full<bytes::Bytes>> {
    let mut params = params;
    params["_meta"] = meta(tasks);
    let name = params["name"]
        .as_str()
        .or(params["taskId"].as_str())
        .map(str::to_owned);
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
    let mut builder = http::Request::post("/mcp")
        .header("host", "localhost")
        .header("content-type", "application/json")
        .header("accept", "application/json, text/event-stream")
        .header("mcp-protocol-version", "2026-07-28")
        .header("mcp-method", method);
    let sets_name = headers.iter().any(|(header, _)| *header == "mcp-name");
    if let (Some(name), false) = (name, sets_name) {
        builder = builder.header("mcp-name", name);
    }
    for (header, value) in headers {
        builder = builder.header(*header, *value);
    }
    builder
        .body(Full::new(bytes::Bytes::from(body.to_string())))
        .unwrap()
}

async fn answer_of<S, B>(service: S, request: http::Request<Full<bytes::Bytes>>) -> Answer
where
    S: tower::Service<http::Request<Full<bytes::Bytes>>, Response = http::Response<B>>,
    S::Error: std::fmt::Debug,
    B: BodyExt,
    B::Error: std::fmt::Debug,
{
    let response = service.oneshot(request).await.unwrap();
    let status = response.status().as_u16();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8_lossy(&bytes).to_string();
    let body = serde_json::from_str(&text).unwrap_or_else(|_| {
        text.lines()
            .find_map(|line| line.strip_prefix("data: "))
            .and_then(|data| serde_json::from_str(data).ok())
            .unwrap_or(Value::Null)
    });
    Answer { status, body, text }
}

async fn send(
    server: &McpServer,
    method: &str,
    params: Value,
    tasks: bool,
    headers: &[(&str, &str)],
) -> Answer {
    let service = server.streamable_http_service(afd::server::HttpOptions::default());
    answer_of(service, request(method, params, tasks, headers)).await
}

fn call(name: &str, arguments: Value) -> Value {
    json!({ "name": name, "arguments": arguments })
}

fn task(id: &str) -> Value {
    json!({ "taskId": id })
}

/// The task id of a `CreateTaskResult` answer.
fn created(answer: &Answer) -> String {
    let result = &answer.body["result"];
    assert_eq!(result["resultType"], "task", "{}", answer.text);
    result["taskId"].as_str().unwrap().to_owned()
}

/// Poll with `get` until the task leaves `working`.
async fn settled<F, Fut>(mut get: F) -> Value
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Value>,
{
    for _ in 0..2000 {
        let body = get().await;
        if body["result"]["status"] != "working" {
            return body;
        }
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
    panic!("the task never left working");
}

/// Wait until `condition` holds.
async fn eventually(mut condition: impl FnMut() -> bool) {
    for _ in 0..2000 {
        if condition() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
    panic!("the condition never held");
}

async fn get_over_http(server: &McpServer, id: &str, headers: &[(&str, &str)]) -> Value {
    send(server, "tasks/get", task(id), true, headers)
        .await
        .body
}

async fn settle_over_http(server: &McpServer, id: &str, headers: &[(&str, &str)]) -> Value {
    settled(|| get_over_http(server, id, headers)).await
}

/// The `CommandResult` a task's `CallToolResult` carries.
fn task_command_result(body: &Value) -> Value {
    body["result"]["result"]["structuredContent"].clone()
}

fn assert_unknown(answer: &Answer) {
    assert_eq!(answer.status, 200, "{}", answer.text);
    assert_eq!(
        answer.body["error"],
        json!({ "code": -32602, "message": "Task not found" }),
        "{}",
        answer.text
    );
}

// ─── Negotiation ─────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn the_extension_is_declared_only_when_a_command_may_be_a_task() {
    let fixture = fixture();
    let discovered = send(
        &fixture.server(ToolStrategy::Individual),
        "server/discover",
        json!({}),
        false,
        &[],
    )
    .await;
    assert_eq!(
        discovered.body["result"]["capabilities"]["extensions"][TASKS_EXTENSION_ID],
        json!({}),
        "{}",
        discovered.text
    );

    // No command may be a task: no extension, and `tasks/get` is an unknown method.
    let runs = Arc::new(Runs::default());
    let plain = Arc::new(CommandRegistry::new());
    plain
        .register(exposed(CommandDefinition::new(
            "todo-list",
            "List",
            vec![],
            List(Arc::clone(&runs)),
        )))
        .unwrap();
    let server = McpServer::new(plain, "plain", "1.0.0");
    let discovered = send(&server, "server/discover", json!({}), false, &[]).await;
    assert!(
        discovered.body["result"]["capabilities"]["extensions"]
            .get(TASKS_EXTENSION_ID)
            .is_none(),
        "{}",
        discovered.text
    );
    let answer = send(&server, "tasks/get", task(&"a".repeat(26)), true, &[]).await;
    assert_eq!(answer.body["error"]["code"], -32601, "{}", answer.text);
}

#[tokio::test]
async fn optional_is_a_task_only_for_a_request_that_declares_the_extension() {
    let fixture = fixture();
    let server = fixture.server(ToolStrategy::Individual);

    let inline = send(
        &server,
        "tools/call",
        call("job-echo", json!({})),
        false,
        &[],
    )
    .await;
    assert_eq!(
        inline.body["result"]["resultType"], "complete",
        "{}",
        inline.text
    );
    assert_eq!(
        inline.body["result"]["structuredContent"]["data"]["task"],
        false
    );

    let answer = send(
        &server,
        "tools/call",
        call("job-echo", json!({ "note": "n" })),
        true,
        &[],
    )
    .await;
    let id = created(&answer);
    let mut seed = answer.body["result"].clone();
    seed.as_object_mut().unwrap().remove("taskId");
    assert_eq!(
        seed,
        json!({
            "resultType": "task",
            "status": "working",
            "createdAt": NOW_ISO,
            "lastUpdatedAt": NOW_ISO,
            "ttlMs": TTL_MS,
            "pollIntervalMs": 250,
        })
    );
    let done = settle_over_http(&server, &id, &[]).await;
    assert_eq!(done["result"]["status"], "completed", "{done}");
    assert_eq!(done["result"]["resultType"], "complete");
    assert_eq!(done["result"]["taskId"], id.as_str());
    let result = task_command_result(&done);
    assert_eq!(result["success"], true);
    assert_eq!(result["data"]["task"], true);
    assert_eq!(result["data"]["input"], json!({ "note": "n" }));
    assert_eq!(Runs::count(&fixture.runs.echo), 2);
}

#[tokio::test]
async fn required_without_the_extension_is_32021_and_runs_nothing() {
    let fixture = fixture();
    let server = fixture.server(ToolStrategy::Individual);
    let answer = send(
        &server,
        "tools/call",
        call("job-must", json!({})),
        false,
        &[],
    )
    .await;
    assert_eq!(answer.status, 400, "{}", answer.text);
    assert_eq!(answer.body["error"]["code"], -32021);
    assert_eq!(
        answer.body["error"]["data"]["requiredCapabilities"]["extensions"],
        json!({ TASKS_EXTENSION_ID: {} })
    );
    assert_eq!(Runs::count(&fixture.runs.echo), 0);

    // With the extension it is a task.
    let answer = send(
        &server,
        "tools/call",
        call("job-must", json!({})),
        true,
        &[],
    )
    .await;
    let id = created(&answer);
    let done = settle_over_http(&server, &id, &[]).await;
    assert_eq!(done["result"]["status"], "completed");
    assert_eq!(Runs::count(&fixture.runs.echo), 1);
}

#[tokio::test]
async fn never_runs_inline_even_with_the_extension() {
    let fixture = fixture();
    let server = fixture.server(ToolStrategy::Individual);
    let answer = send(
        &server,
        "tools/call",
        call("todo-list", json!({})),
        true,
        &[],
    )
    .await;
    assert_eq!(
        answer.body["result"]["resultType"], "complete",
        "{}",
        answer.text
    );
    assert_eq!(answer.body["result"]["structuredContent"]["success"], true);
    assert_eq!(Runs::count(&fixture.runs.list), 1);
}

#[tokio::test]
async fn tasks_methods_need_the_extension_on_the_request() {
    let fixture = fixture();
    let server = fixture.server(ToolStrategy::Individual);
    let id = created(
        &send(
            &server,
            "tools/call",
            call("job-echo", json!({})),
            true,
            &[],
        )
        .await,
    );
    for method in ["tasks/get", "tasks/update", "tasks/cancel"] {
        let mut params = task(&id);
        if method == "tasks/update" {
            params["inputResponses"] = json!({});
        }
        let answer = send(&server, method, params, false, &[]).await;
        assert_eq!(answer.status, 400, "{method}: {}", answer.text);
        assert_eq!(answer.body["error"]["code"], -32021, "{method}");
    }
}

#[tokio::test]
async fn mcp_name_must_carry_the_task_id() {
    let fixture = fixture();
    let server = fixture.server(ToolStrategy::Individual);
    let id = created(
        &send(
            &server,
            "tools/call",
            call("job-echo", json!({})),
            true,
            &[],
        )
        .await,
    );
    let answer = send(
        &server,
        "tasks/get",
        task(&id),
        true,
        &[("mcp-name", "job-echo")],
    )
    .await;
    assert_eq!(answer.status, 400, "{}", answer.text);
    assert_eq!(answer.body["error"]["code"], -32020);
}

#[tokio::test]
async fn a_2025_connection_never_gets_a_task() {
    let fixture = fixture();
    // The client declared the extension at `initialize`: it is not defined for 2025 requests.
    let mut client = Stdio::connect_with(
        fixture.server(ToolStrategy::Individual),
        json!({ "extensions": { TASKS_EXTENSION_ID: {} } }),
    )
    .await;
    let answer = client
        .request("tools/call", call("job-echo", json!({})))
        .await;
    assert_eq!(
        answer["result"]["structuredContent"]["data"]["task"], false,
        "{answer}"
    );
    let answer = client
        .request("tools/call", call("job-must", json!({})))
        .await;
    assert_eq!(answer["error"]["code"], -32021, "{answer}");
    let answer = client.request("tasks/get", task(&"a".repeat(26))).await;
    assert_eq!(answer["error"]["code"], -32021, "{answer}");
    // A 2025 request that also declares the extension in its own `_meta`.
    let declared = json!({
        "io.modelcontextprotocol/clientCapabilities": { "extensions": { TASKS_EXTENSION_ID: {} } },
    });
    let mut params = call("job-echo", json!({}));
    params["_meta"] = declared.clone();
    let answer = client.request("tools/call", params).await;
    assert_eq!(
        answer["result"]["structuredContent"]["data"]["task"], false,
        "{answer}"
    );
    let mut params = call("job-must", json!({}));
    params["_meta"] = declared.clone();
    let answer = client.request("tools/call", params).await;
    assert_eq!(answer["error"]["code"], -32021, "{answer}");
    let mut params = task(&"a".repeat(26));
    params["_meta"] = declared;
    let answer = client.request("tasks/get", params).await;
    assert_eq!(answer["error"]["code"], -32021, "{answer}");
    assert_eq!(Runs::count(&fixture.runs.echo), 2);
}

// ─── Routes ──────────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn every_route_to_one_command_can_be_a_task() {
    let fixture = fixture();
    let routes = [
        (
            ToolStrategy::Individual,
            call("job-echo", json!({ "note": "direct" })),
        ),
        (
            ToolStrategy::Individual,
            call(
                "afd-call",
                json!({ "command": "job-echo", "input": { "note": "afd-call" } }),
            ),
        ),
        (
            ToolStrategy::Grouped,
            call(
                "job",
                json!({ "action": "echo", "params": { "note": "grouped" } }),
            ),
        ),
        (
            ToolStrategy::Hybrid,
            call("job-echo", json!({ "note": "hybrid" })),
        ),
        (
            ToolStrategy::Hybrid,
            call(
                "afd-call",
                json!({ "command": "job-must", "input": { "note": "hybrid-call" } }),
            ),
        ),
    ];
    for (strategy, params) in routes {
        let server = fixture.server(strategy);
        let answer = send(&server, "tools/call", params.clone(), true, &[]).await;
        let id = created(&answer);
        let done = settle_over_http(&server, &id, &[]).await;
        let result = task_command_result(&done);
        assert_eq!(result["data"]["task"], true, "{params}: {done}");
        assert_eq!(
            result["data"]["input"]["note"],
            params["arguments"]["note"]
                .as_str()
                .or(params["arguments"]["input"]["note"].as_str())
                .or(params["arguments"]["params"]["note"].as_str())
                .unwrap()
        );
    }
}

#[tokio::test]
async fn a_batch_runs_an_optional_step_inline_and_refuses_a_required_one() {
    for tasks in [true, false] {
        let fixture = fixture();
        let server = fixture.server(ToolStrategy::Individual);
        let answer = send(
            &server,
            "tools/call",
            call(
                "afd-batch",
                json!({ "commands": [
                    { "command": "todo-list", "input": {} },
                    { "command": "job-echo", "input": {} },
                ] }),
            ),
            tasks,
            &[],
        )
        .await;
        let result = &answer.body["result"];
        assert_eq!(result["resultType"], "complete", "{}", answer.text);
        assert_eq!(result["structuredContent"]["success"], true);
        assert_eq!(
            result["structuredContent"]["results"][1]["result"]["data"]["task"],
            false
        );
        assert_eq!(Runs::count(&fixture.runs.list), 1);

        let answer = send(
            &server,
            "tools/call",
            call(
                "afd-batch",
                json!({ "commands": [
                    { "command": "todo-list", "input": {} },
                    { "command": "job-must", "input": {} },
                ] }),
            ),
            tasks,
            &[],
        )
        .await;
        let result = &answer.body["result"]["structuredContent"];
        assert_eq!(answer.body["result"]["isError"], true, "{}", answer.text);
        assert_eq!(result["error"]["code"], error_codes::INVALID_BATCH_REQUEST);
        assert!(result["error"]["message"]
            .as_str()
            .unwrap()
            .contains("'job-must'"));
        // Nothing ran: not even the step before it.
        assert_eq!(Runs::count(&fixture.runs.list), 1);
        assert_eq!(Runs::count(&fixture.runs.echo), 1);
    }
}

#[tokio::test]
async fn a_pipeline_runs_an_optional_step_inline_and_refuses_a_required_one() {
    for tasks in [true, false] {
        let fixture = fixture();
        let server = fixture.server(ToolStrategy::Individual);
        let answer = send(
            &server,
            "tools/call",
            call(
                "afd-pipe",
                json!({ "steps": [
                    { "command": "todo-list", "input": {} },
                    { "command": "job-echo", "input": {} },
                ] }),
            ),
            tasks,
            &[],
        )
        .await;
        let result = &answer.body["result"]["structuredContent"];
        assert_eq!(answer.body["result"]["isError"], false, "{}", answer.text);
        assert_eq!(result["steps"][1]["data"]["task"], false);
        assert_eq!(Runs::count(&fixture.runs.list), 1);

        let answer = send(
            &server,
            "tools/call",
            call(
                "afd-pipe",
                json!({ "steps": [
                    { "command": "todo-list", "input": {} },
                    { "command": "job-must", "input": {} },
                ] }),
            ),
            tasks,
            &[],
        )
        .await;
        let result = &answer.body["result"]["structuredContent"];
        assert_eq!(answer.body["result"]["isError"], true, "{}", answer.text);
        assert_eq!(
            result["steps"][0]["error"]["code"],
            error_codes::INVALID_PIPELINE_REQUEST
        );
        assert_eq!(Runs::count(&fixture.runs.list), 1);
        assert_eq!(Runs::count(&fixture.runs.echo), 1);
    }
}

// ─── Results ─────────────────────────────────────────────────────────────────────────────────

/// A `CommandResult` without the fields that differ between two runs.
fn comparable(mut result: Value) -> Value {
    if let Some(metadata) = result["metadata"].as_object_mut() {
        metadata.remove("executionTimeMs");
        metadata.remove("traceId");
    }
    result
}

#[tokio::test]
async fn a_task_result_is_the_inline_call_tool_result() {
    let fixture = fixture();
    let server = fixture.server(ToolStrategy::Individual);
    for name in ["job-fail", "job-echo"] {
        let inline = send(&server, "tools/call", call(name, json!({})), false, &[]).await;
        let mut inline = inline.body["result"].clone();
        let id = created(&send(&server, "tools/call", call(name, json!({})), true, &[]).await);
        let mut tasked = settle_over_http(&server, &id, &[]).await["result"]["result"].clone();
        let text: Value =
            serde_json::from_str(tasked["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(text, tasked["structuredContent"]);
        // The one difference: whether the handler ran as a task.
        for result in [&mut inline, &mut tasked] {
            if let Some(data) = result
                .get_mut("structuredContent")
                .and_then(|content| content.get_mut("data"))
                .and_then(Value::as_object_mut)
            {
                data.remove("task");
            }
        }
        assert_eq!(tasked["isError"], inline["isError"]);
        assert_eq!(tasked["resultType"], inline["resultType"]);
        assert_eq!(
            comparable(tasked["structuredContent"].clone()),
            comparable(inline["structuredContent"].clone())
        );
    }
}

#[tokio::test]
async fn a_failed_command_result_is_completed_with_is_error() {
    let fixture = fixture();
    let server = fixture.server(ToolStrategy::Individual);
    let id = created(
        &send(
            &server,
            "tools/call",
            call("job-fail", json!({})),
            true,
            &[],
        )
        .await,
    );
    let done = settle_over_http(&server, &id, &[]).await;
    assert_eq!(done["result"]["status"], "completed", "{done}");
    assert_eq!(done["result"]["result"]["isError"], true);
    assert_eq!(
        task_command_result(&done)["error"]["code"],
        error_codes::NOT_FOUND
    );
    assert!(done["result"].get("error").is_none());
}

#[tokio::test]
async fn failed_carries_the_json_rpc_error() {
    let fixture = fixture();
    let store = Arc::new(InMemoryTaskStore::new());
    let server = fixture
        .server(ToolStrategy::Individual)
        .with_task_store(Arc::clone(&store));
    let id = created(
        &send(
            &server,
            "tools/call",
            call("job-wait", json!({})),
            true,
            &[],
        )
        .await,
    );
    // As the runner records a JSON-RPC error.
    let owner = TaskOwner::from_binding(
        afd::principal_binding(Some(&Actor::new(ActorKind::Agent)), None).unwrap(),
    );
    let error = json!({ "code": -32603, "message": "Internal error" });
    store
        .update(
            &id,
            &owner,
            TaskChange::Failed {
                error: error.as_object().unwrap().clone(),
                at: NOW_MS + 5,
            },
        )
        .await
        .unwrap();
    let done = get_over_http(&server, &id, &[]).await;
    assert_eq!(done["result"]["status"], "failed", "{done}");
    assert_eq!(done["result"]["error"], error);
    assert!(done["result"].get("result").is_none());
    fixture.runs.release.notify_one();
}

#[tokio::test]
async fn progress_sets_the_status_message_and_last_updated_at() {
    let fixture = fixture();
    let server = fixture.server(ToolStrategy::Individual);
    let id = created(
        &send(
            &server,
            "tools/call",
            call("job-wait", json!({})),
            true,
            &[],
        )
        .await,
    );
    let mut body = Value::Null;
    for _ in 0..2000 {
        body = get_over_http(&server, &id, &[]).await;
        if body["result"]["statusMessage"] == "phase-1" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
    assert_eq!(body["result"]["statusMessage"], "phase-1", "{body}");
    assert_eq!(body["result"]["status"], "working");
    fixture.clock.advance(1_000);
    fixture.runs.release.notify_one();
    let done = settle_over_http(&server, &id, &[]).await;
    assert_eq!(done["result"]["status"], "completed");
    assert_eq!(done["result"]["createdAt"], NOW_ISO);
    assert_eq!(done["result"]["lastUpdatedAt"], "2026-10-26T12:00:01.000Z");
}

#[tokio::test]
async fn a_result_larger_than_the_limit_is_replaced_and_says_the_command_ran() {
    let fixture = fixture();
    let server = fixture
        .server(ToolStrategy::Individual)
        .with_task_options(options().with_max_result_bytes(1024));
    let id = created(&send(&server, "tools/call", call("job-big", json!({})), true, &[]).await);
    let done = settle_over_http(&server, &id, &[]).await;
    assert_eq!(done["result"]["status"], "completed");
    assert_eq!(done["result"]["result"]["isError"], true);
    let error = &task_command_result(&done)["error"];
    assert_eq!(error["code"], error_codes::INTERNAL_ERROR);
    assert_eq!(error["details"]["limitBytes"], 1024);
    assert!(error["details"]["actualBytes"].as_u64().unwrap() > 4096);
    assert!(error["suggestion"]
        .as_str()
        .unwrap()
        .contains("The command ran"));
}

// ─── Cancellation and time ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn cancel_stops_the_handler_and_the_task_is_cancelled() {
    let fixture = fixture();
    let server = fixture.server(ToolStrategy::Individual);
    let id = created(
        &send(
            &server,
            "tools/call",
            call("job-wait", json!({})),
            true,
            &[],
        )
        .await,
    );
    let runs = Arc::clone(&fixture.runs);
    eventually(|| Runs::count(&runs.started) == 1).await;
    let ack = send(&server, "tasks/cancel", task(&id), true, &[]).await;
    assert_eq!(
        ack.body["result"],
        json!({ "resultType": "complete" }),
        "{}",
        ack.text
    );
    let done = settle_over_http(&server, &id, &[]).await;
    assert_eq!(done["result"]["status"], "cancelled", "{done}");
    assert!(done["result"].get("result").is_none());
    eventually(|| Runs::count(&runs.dropped) == 1).await;
    eventually(|| Runs::count(&runs.signalled) == 1).await;
}

#[tokio::test]
async fn cancel_in_the_same_process_stops_the_handler_at_once() {
    let fixture = fixture();
    // No tick for ten minutes: only the signal can stop it.
    let server = fixture
        .server(ToolStrategy::Individual)
        .with_task_options(options().with_check_interval_ms(600_000));
    let id = created(
        &send(
            &server,
            "tools/call",
            call("job-wait", json!({})),
            true,
            &[],
        )
        .await,
    );
    let runs = Arc::clone(&fixture.runs);
    eventually(|| Runs::count(&runs.started) == 1).await;
    send(&server, "tasks/cancel", task(&id), true, &[]).await;
    let done = settle_over_http(&server, &id, &[]).await;
    assert_eq!(done["result"]["status"], "cancelled", "{done}");
    eventually(|| Runs::count(&runs.dropped) == 1).await;
}

#[tokio::test]
async fn cancelling_a_finished_task_changes_nothing() {
    let fixture = fixture();
    let server = fixture.server(ToolStrategy::Individual);
    let id = created(
        &send(
            &server,
            "tools/call",
            call("job-echo", json!({})),
            true,
            &[],
        )
        .await,
    );
    let done = settle_over_http(&server, &id, &[]).await;
    let ack = send(&server, "tasks/cancel", task(&id), true, &[]).await;
    assert_eq!(ack.body["result"], json!({ "resultType": "complete" }));
    assert_eq!(get_over_http(&server, &id, &[]).await, done);
}

#[tokio::test]
async fn update_finds_no_input_to_give_and_acknowledges() {
    let fixture = fixture();
    let server = fixture.server(ToolStrategy::Individual);
    let id = created(
        &send(
            &server,
            "tools/call",
            call("job-wait", json!({})),
            true,
            &[],
        )
        .await,
    );
    let mut params = task(&id);
    params["inputResponses"] =
        json!({ "confirm": { "action": "accept", "content": { "confirm": true } } });
    let ack = send(&server, "tasks/update", params, true, &[]).await;
    assert_eq!(
        ack.body["result"],
        json!({ "resultType": "complete" }),
        "{}",
        ack.text
    );
    assert_eq!(
        get_over_http(&server, &id, &[]).await["result"]["status"],
        "working"
    );
    fixture.runs.release.notify_one();
    assert_eq!(
        settle_over_http(&server, &id, &[]).await["result"]["status"],
        "completed"
    );
}

#[tokio::test]
async fn cancel_reaches_a_task_running_in_another_process_through_the_store() {
    let fixture = fixture();
    let store = Arc::new(InMemoryTaskStore::new());
    let first = fixture
        .server(ToolStrategy::Individual)
        .with_task_store(Arc::clone(&store));
    // Another process: its own runtime, the same store.
    let second = identifying(
        McpServer::new(registry(&Arc::new(Runs::default())), "jobs", "1.0.0")
            .with_clock(fixture.clock.clone())
            .with_task_options(options())
            .with_task_store(Arc::clone(&store)),
        Arc::new(Mutex::new(Vec::new())),
    );
    let id = created(&send(&first, "tools/call", call("job-wait", json!({})), true, &[]).await);
    let runs = Arc::clone(&fixture.runs);
    eventually(|| Runs::count(&runs.started) == 1).await;
    let ack = send(&second, "tasks/cancel", task(&id), true, &[]).await;
    assert_eq!(
        ack.body["result"],
        json!({ "resultType": "complete" }),
        "{}",
        ack.text
    );
    let done = settle_over_http(&second, &id, &[]).await;
    assert_eq!(done["result"]["status"], "cancelled", "{done}");
    eventually(|| Runs::count(&runs.dropped) == 1).await;
}

#[tokio::test]
async fn at_its_ttl_a_running_task_is_stopped_and_gone() {
    let fixture = fixture();
    let server = fixture.server(ToolStrategy::Individual);
    let id = created(
        &send(
            &server,
            "tools/call",
            call("job-wait", json!({})),
            true,
            &[],
        )
        .await,
    );
    let runs = Arc::clone(&fixture.runs);
    eventually(|| Runs::count(&runs.started) == 1).await;
    fixture.clock.advance(TTL_MS as i64);
    eventually(|| Runs::count(&runs.dropped) == 1).await;
    let gone = send(&server, "tasks/get", task(&id), true, &[]).await;
    let unknown = send(&server, "tasks/get", task(&"q".repeat(26)), true, &[]).await;
    assert_unknown(&gone);
    assert_eq!(gone.text, unknown.text);
}

/// A store that never purges: the server's own TTL check must hide an expired task.
struct NeverExpires(InMemoryTaskStore);

#[async_trait]
impl TaskStore for NeverExpires {
    async fn create(&self, record: TaskRecord) -> Result<(), TaskStoreError> {
        self.0.create(record).await
    }
    async fn get(&self, id: &str, owner: &TaskOwner) -> Result<Option<TaskRecord>, TaskStoreError> {
        self.0.get(id, owner).await
    }
    async fn update(
        &self,
        id: &str,
        owner: &TaskOwner,
        change: TaskChange,
    ) -> Result<(), TaskStoreError> {
        self.0.update(id, owner, change).await
    }
    async fn expire(&self, _now: i64) -> Result<u64, TaskStoreError> {
        Ok(0)
    }
}

#[tokio::test]
async fn a_finished_task_is_gone_at_its_ttl_even_when_the_store_keeps_it() {
    let fixture = fixture();
    let server = fixture
        .server(ToolStrategy::Individual)
        .with_task_store(NeverExpires(InMemoryTaskStore::with_limits(1000, 1000)));
    let id = created(
        &send(
            &server,
            "tools/call",
            call("job-echo", json!({})),
            true,
            &[],
        )
        .await,
    );
    assert_eq!(
        settle_over_http(&server, &id, &[]).await["result"]["status"],
        "completed"
    );
    fixture.clock.advance(TTL_MS as i64 - 1);
    assert_eq!(
        get_over_http(&server, &id, &[]).await["result"]["status"],
        "completed"
    );
    fixture.clock.advance(1);
    for method in ["tasks/get", "tasks/cancel"] {
        assert_unknown(&send(&server, method, task(&id), true, &[]).await);
    }
}

/// A store that keeps what `create_for` saw of each call: the command, the input and the actor.
#[derive(Default)]
struct SeesCalls {
    inner: InMemoryTaskStore,
    seen: Mutex<Vec<(String, Value, Option<String>)>>,
}

#[async_trait]
impl TaskStore for SeesCalls {
    async fn create(&self, _record: TaskRecord) -> Result<(), TaskStoreError> {
        Err(TaskStoreError::Unavailable(
            "the server must call create_for".into(),
        ))
    }
    async fn create_for(
        &self,
        record: TaskRecord,
        call: TaskCall<'_>,
    ) -> Result<(), TaskStoreError> {
        self.seen.lock().unwrap().push((
            call.command.name.clone(),
            call.input.clone(),
            call.context
                .actor
                .as_ref()
                .and_then(|actor| actor.id.clone()),
        ));
        self.inner.create(record).await
    }
    async fn get(&self, id: &str, owner: &TaskOwner) -> Result<Option<TaskRecord>, TaskStoreError> {
        self.inner.get(id, owner).await
    }
    async fn update(
        &self,
        id: &str,
        owner: &TaskOwner,
        change: TaskChange,
    ) -> Result<(), TaskStoreError> {
        self.inner.update(id, owner, change).await
    }
    async fn expire(&self, now: i64) -> Result<u64, TaskStoreError> {
        self.inner.expire(now).await
    }
}

#[tokio::test]
async fn the_store_is_given_the_call_it_records_a_task_for() {
    let fixture = fixture();
    let store = Arc::new(SeesCalls::default());
    let server = fixture.hooked().with_task_store(Arc::clone(&store));
    let owner: &[(&str, &str)] = &[("x-actor", "a1")];
    let id = created(
        &send(
            &server,
            "tools/call",
            call("job-echo", json!({ "note": "n" })),
            true,
            owner,
        )
        .await,
    );
    assert_eq!(
        settle_over_http(&server, &id, owner).await["result"]["status"],
        "completed"
    );
    assert_eq!(
        *store.seen.lock().unwrap(),
        [(
            "job-echo".to_owned(),
            json!({ "note": "n" }),
            Some("a1".to_owned())
        )]
    );
}

#[test]
fn a_failure_result_is_the_call_tool_result_of_an_inline_failure() {
    let error = CommandError::new("TASK_LOST", "Lost")
        .with_suggestion("Start it again.")
        .with_retryable(true);
    let result = failure_result(error).unwrap();
    assert_eq!(result["isError"], json!(true));
    assert_eq!(
        result["structuredContent"]["error"]["code"],
        json!("TASK_LOST")
    );
    assert_eq!(result["structuredContent"]["success"], json!(false));
}

/// A store another process can end a task in (as a host's store does when it finds a lease run
/// out), counting the runner's heartbeats.
#[derive(Default)]
struct Shared {
    inner: InMemoryTaskStore,
    owners: Mutex<Vec<(String, TaskOwner)>>,
    heartbeats: AtomicUsize,
}

impl Shared {
    /// End task `id` as another process would: completed, with a result this runner never made.
    async fn end_elsewhere(&self, id: &str) {
        let owner = self
            .owners
            .lock()
            .unwrap()
            .iter()
            .find(|(known, _)| known == id)
            .map(|(_, owner)| owner.clone())
            .unwrap();
        let mut result = serde_json::Map::new();
        result.insert("content".into(), json!([]));
        result.insert("isError".into(), json!(true));
        self.inner
            .update(id, &owner, TaskChange::Completed { result, at: NOW_MS })
            .await
            .unwrap();
    }
}

#[async_trait]
impl TaskStore for Shared {
    async fn create(&self, record: TaskRecord) -> Result<(), TaskStoreError> {
        self.owners
            .lock()
            .unwrap()
            .push((record.id.clone(), record.owner.clone()));
        self.inner.create(record).await
    }
    async fn get(&self, id: &str, owner: &TaskOwner) -> Result<Option<TaskRecord>, TaskStoreError> {
        self.inner.get(id, owner).await
    }
    async fn update(
        &self,
        id: &str,
        owner: &TaskOwner,
        change: TaskChange,
    ) -> Result<(), TaskStoreError> {
        self.inner.update(id, owner, change).await
    }
    async fn expire(&self, now: i64) -> Result<u64, TaskStoreError> {
        self.inner.expire(now).await
    }
    async fn heartbeat(
        &self,
        _id: &str,
        _owner: &TaskOwner,
        _now: i64,
    ) -> Result<(), TaskStoreError> {
        self.heartbeats.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

#[tokio::test]
async fn a_runner_whose_task_another_process_ended_stops_and_writes_nothing() {
    let fixture = fixture();
    let store = Arc::new(Shared::default());
    let server = fixture.hooked().with_task_store(Arc::clone(&store));
    let id = created(
        &send(
            &server,
            "tools/call",
            call("job-wait", json!({})),
            true,
            &[],
        )
        .await,
    );
    let runs = Arc::clone(&fixture.runs);
    eventually(|| Runs::count(&runs.started) == 1).await;
    // The runner heartbeats while it runs; a poll does not.
    eventually(|| store.heartbeats.load(Ordering::SeqCst) > 0).await;
    store.end_elsewhere(&id).await;
    // The runner reads the ended record at its next check, stops the handler and writes nothing
    // over the end the store holds.
    eventually(|| Runs::count(&runs.dropped) == 1).await;
    eventually(|| Runs::count(&runs.signalled) == 1).await;
    let body = get_over_http(&server, &id, &[]).await;
    assert_eq!(body["result"]["status"], "completed", "{body}");
    assert_eq!(body["result"]["result"]["isError"], json!(true), "{body}");
    assert_eq!(body["result"]["result"]["content"], json!([]), "{body}");
    let beats = store.heartbeats.load(Ordering::SeqCst);
    for _ in 0..3 {
        get_over_http(&server, &id, &[]).await;
    }
    assert_eq!(
        store.heartbeats.load(Ordering::SeqCst),
        beats,
        "polls never heartbeat"
    );
}

#[tokio::test]
async fn cancel_stops_a_runner_whose_task_the_store_holds_ended() {
    let fixture = fixture();
    let store = Arc::new(Shared::default());
    // Checks far apart, so the runner does not see the ended record before the cancel arrives.
    let server = identifying(
        McpServer::new(Arc::clone(&fixture.registry), "jobs", "1.0.0")
            .with_clock(fixture.clock.clone())
            .with_task_options(options().with_check_interval_ms(3_600_000))
            .with_task_store(Arc::clone(&store)),
        Arc::new(Mutex::new(Vec::new())),
    );
    let id = created(
        &send(
            &server,
            "tools/call",
            call("job-wait", json!({})),
            true,
            &[],
        )
        .await,
    );
    let runs = Arc::clone(&fixture.runs);
    eventually(|| Runs::count(&runs.started) == 1).await;
    store.end_elsewhere(&id).await;
    assert_eq!(Runs::count(&runs.dropped), 0);
    let ack = send(&server, "tasks/cancel", task(&id), true, &[]).await;
    assert_eq!(
        ack.body["result"],
        json!({ "resultType": "complete" }),
        "{}",
        ack.text
    );
    eventually(|| Runs::count(&runs.dropped) == 1).await;
    let body = get_over_http(&server, &id, &[]).await;
    assert_eq!(body["result"]["status"], "completed", "{body}");
}

// ─── Ownership ───────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn another_actor_gets_the_one_unknown_task_answer() {
    let fixture = fixture();
    let server = fixture.hooked();
    let owner: &[(&str, &str)] = &[("x-actor", "a1"), ("x-for", "ada")];
    let id = created(
        &send(
            &server,
            "tools/call",
            call("job-wait", json!({})),
            true,
            owner,
        )
        .await,
    );
    let runs = Arc::clone(&fixture.runs);
    eventually(|| Runs::count(&runs.started) == 1).await;

    let strangers: [&[(&str, &str)]; 5] = [
        &[("x-actor", "a2"), ("x-for", "ada")],
        &[("x-actor", "a1"), ("x-for", "bo")],
        &[("x-actor", "a1")],
        &[("x-actor", "a1"), ("x-for", "ada"), ("x-kind", "human")],
        &[],
    ];
    let unknown = send(&server, "tasks/get", task(&"b".repeat(26)), true, owner).await;
    let malformed = send(&server, "tasks/get", task("not-a-task"), true, owner).await;
    assert_unknown(&unknown);
    assert_eq!(malformed.text, unknown.text);
    for stranger in strangers {
        let answer = send(&server, "tasks/get", task(&id), true, stranger).await;
        assert_unknown(&answer);
        // Byte for byte the answer to an id that does not exist.
        assert_eq!(answer.text, unknown.text, "{stranger:?}");
        let cancel = send(&server, "tasks/cancel", task(&id), true, stranger).await;
        assert_unknown(&cancel);
        let mut params = task(&id);
        params["inputResponses"] = json!({});
        assert_unknown(&send(&server, "tasks/update", params, true, stranger).await);
    }
    // No stranger's cancel reached it; another label is the same caller.
    let same = &[("x-actor", "a1"), ("x-for", "ada"), ("x-label", "laptop")];
    let mine = send(&server, "tasks/get", task(&id), true, same).await;
    assert_eq!(mine.body["result"]["status"], "working", "{}", mine.text);
    assert_eq!(Runs::count(&runs.dropped), 0);
    fixture.runs.release.notify_one();
    assert_eq!(
        settle_over_http(&server, &id, owner).await["result"]["status"],
        "completed"
    );
}

/// A store that ignores the owner on `get`: the server's own owner check must still hide the
/// task.
struct Leaky(InMemoryTaskStore, Mutex<Option<TaskOwner>>);

#[async_trait]
impl TaskStore for Leaky {
    async fn create(&self, record: TaskRecord) -> Result<(), TaskStoreError> {
        *self.1.lock().unwrap() = Some(record.owner.clone());
        self.0.create(record).await
    }
    async fn get(
        &self,
        id: &str,
        _owner: &TaskOwner,
    ) -> Result<Option<TaskRecord>, TaskStoreError> {
        let owner = self.1.lock().unwrap().clone().unwrap();
        self.0.get(id, &owner).await
    }
    async fn update(
        &self,
        id: &str,
        owner: &TaskOwner,
        change: TaskChange,
    ) -> Result<(), TaskStoreError> {
        self.0.update(id, owner, change).await
    }
    async fn expire(&self, now: i64) -> Result<u64, TaskStoreError> {
        self.0.expire(now).await
    }
}

#[tokio::test]
async fn a_store_that_ignores_the_owner_does_not_reveal_a_task() {
    let fixture = fixture();
    let server = fixture
        .hooked()
        .with_task_store(Leaky(InMemoryTaskStore::new(), Mutex::new(None)));
    let id = created(
        &send(
            &server,
            "tools/call",
            call("job-echo", json!({})),
            true,
            &[("x-actor", "a1")],
        )
        .await,
    );
    assert_eq!(
        settle_over_http(&server, &id, &[("x-actor", "a1")]).await["result"]["status"],
        "completed"
    );
    assert_unknown(&send(&server, "tasks/get", task(&id), true, &[("x-actor", "a2")]).await);
}

#[tokio::test]
async fn the_context_hook_runs_on_tasks_methods_and_can_refuse() {
    let fixture = fixture();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let server = fixture.hooked_seeing(Arc::clone(&seen));
    let id = created(
        &send(
            &server,
            "tools/call",
            call("job-echo", json!({})),
            true,
            &[],
        )
        .await,
    );
    settle_over_http(&server, &id, &[]).await;
    let refused = send(&server, "tasks/get", task(&id), true, &[("x-deny", "1")]).await;
    assert_eq!(refused.body["error"]["code"], -32600, "{}", refused.text);
    assert_eq!(refused.body["error"]["data"]["code"], "UNAUTHORIZED");
    assert!(refused.body["error"]["data"].get("taskId").is_none());
    let seen = seen.lock().unwrap().clone();
    assert!(seen.contains(&"tasks/get".to_owned()), "{seen:?}");
    // A refused `tools/call` creates nothing.
    let refused = send(
        &server,
        "tools/call",
        call("job-echo", json!({})),
        true,
        &[("x-deny", "1")],
    )
    .await;
    assert_eq!(
        refused.body["result"]["structuredContent"]["error"]["code"],
        "UNAUTHORIZED"
    );
}

// ─── Ids ─────────────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn task_ids_are_128_random_bits_and_a_neighbour_is_unknown() {
    let fixture = fixture();
    let server = fixture
        .server(ToolStrategy::Individual)
        .with_task_store(InMemoryTaskStore::with_limits(100, 100));
    let mut ids = std::collections::HashSet::new();
    for _ in 0..40 {
        let id = created(
            &send(
                &server,
                "tools/call",
                call("job-echo", json!({})),
                true,
                &[],
            )
            .await,
        );
        assert_eq!(id.len(), 26, "{id}");
        assert!(
            id.bytes()
                .all(|byte| matches!(byte, b'a'..=b'z' | b'2'..=b'7')),
            "{id}"
        );
        assert!(ids.insert(id));
    }
    let id = ids.iter().next().unwrap().clone();
    settle_over_http(&server, &id, &[]).await;
    let mut neighbour = id.clone().into_bytes();
    neighbour[0] = if neighbour[0] == b'a' { b'b' } else { b'a' };
    let neighbour = String::from_utf8(neighbour).unwrap();
    assert_unknown(&send(&server, "tasks/get", task(&neighbour), true, &[]).await);
}

// ─── The store ───────────────────────────────────────────────────────────────────────────────

struct Failing;

#[async_trait]
impl TaskStore for Failing {
    async fn create(&self, _record: TaskRecord) -> Result<(), TaskStoreError> {
        Err(TaskStoreError::Unavailable("disk full".into()))
    }
    async fn get(
        &self,
        _id: &str,
        _owner: &TaskOwner,
    ) -> Result<Option<TaskRecord>, TaskStoreError> {
        Err(TaskStoreError::Unavailable("disk full".into()))
    }
    async fn update(
        &self,
        _id: &str,
        _owner: &TaskOwner,
        _change: TaskChange,
    ) -> Result<(), TaskStoreError> {
        Err(TaskStoreError::Unavailable("disk full".into()))
    }
    async fn expire(&self, _now: i64) -> Result<u64, TaskStoreError> {
        Err(TaskStoreError::Unavailable("disk full".into()))
    }
}

#[tokio::test]
async fn a_store_that_cannot_record_the_task_fails_the_call_and_nothing_runs() {
    let fixture = fixture();
    let server = fixture
        .server(ToolStrategy::Individual)
        .with_task_store(Failing);
    for name in ["job-echo", "job-must"] {
        let answer = send(&server, "tools/call", call(name, json!({})), true, &[]).await;
        let result = &answer.body["result"];
        assert_eq!(result["resultType"], "complete", "{}", answer.text);
        assert_eq!(result["isError"], true);
        let error = &result["structuredContent"]["error"];
        assert_eq!(error["code"], error_codes::INTERNAL_ERROR);
        assert_eq!(error["retryable"], true);
        assert!(!answer.text.contains("disk full"));
    }
    assert_eq!(Runs::count(&fixture.runs.echo), 0);
    // A store that cannot read answers a generic internal error.
    let answer = send(&server, "tasks/get", task(&"c".repeat(26)), true, &[]).await;
    assert_eq!(
        answer.body["error"],
        json!({ "code": -32603, "message": "Internal error" })
    );
}

const LIMIT_MESSAGE: &str = "The task could not start: a task limit was reached, so nothing ran";

/// The `RATE_LIMITED` failure of a call refused by a task limit.
fn assert_limited(answer: &Answer) {
    let error = &answer.body["result"]["structuredContent"]["error"];
    assert_eq!(error["code"], error_codes::RATE_LIMITED, "{}", answer.text);
    assert_eq!(error["retryable"], true);
    assert_eq!(error["message"], LIMIT_MESSAGE);
}

#[tokio::test]
async fn the_in_memory_store_refuses_working_tasks_over_its_limits() {
    let fixture = fixture();
    let server = fixture
        .hooked()
        .with_task_store(InMemoryTaskStore::with_limits(2, 3));
    let start = |actor: &'static str| {
        let server = server.clone();
        async move {
            send(
                &server,
                "tools/call",
                call("job-wait", json!({})),
                true,
                &[("x-actor", actor)],
            )
            .await
        }
    };
    created(&start("ada").await);
    created(&start("ada").await);
    // The owner's limit, with both of the owner's tasks still working.
    assert_limited(&start("ada").await);
    created(&start("bo").await);
    // The total, with every task still working; the answer is the same and names no one.
    assert_limited(&start("cy").await);
    let runs = Arc::clone(&fixture.runs);
    eventually(|| Runs::count(&runs.started) == 3).await;
    // Expired tasks free their places.
    fixture.clock.advance(TTL_MS as i64);
    eventually(|| Runs::count(&runs.dropped) == 3).await;
    created(&start("ada").await);
    created(&start("ada").await);
}

#[tokio::test]
async fn finished_tasks_make_room_so_they_cannot_keep_others_out() {
    let fixture = fixture();
    let server = fixture
        .hooked()
        .with_task_store(InMemoryTaskStore::with_limits(2, 3));
    let start = |actor: &'static str, command: &'static str| {
        let server = server.clone();
        async move {
            send(
                &server,
                "tools/call",
                call(command, json!({})),
                true,
                &[("x-actor", actor)],
            )
            .await
        }
    };
    // Three finished tasks fill the store: two of ada's, one of bo's.
    let first = created(&start("ada", "job-echo").await);
    settle_over_http(&server, &first, &[("x-actor", "ada")]).await;
    fixture.clock.advance(1);
    let second = created(&start("ada", "job-echo").await);
    settle_over_http(&server, &second, &[("x-actor", "ada")]).await;
    fixture.clock.advance(1);
    let third = created(&start("bo", "job-echo").await);
    settle_over_http(&server, &third, &[("x-actor", "bo")]).await;
    // A newcomer gets a place: the oldest finished task of the largest holder makes room.
    created(&start("cy", "job-echo").await);
    assert_unknown(
        &send(
            &server,
            "tasks/get",
            task(&first),
            true,
            &[("x-actor", "ada")],
        )
        .await,
    );
    for (id, actor) in [(&second, "ada"), (&third, "bo")] {
        let kept = get_over_http(&server, id, &[("x-actor", actor)]).await;
        assert_eq!(kept["result"]["status"], "completed", "{kept}");
    }
    // An owner at its limit makes room with its own oldest finished task.
    fixture.clock.advance(1);
    created(&start("bo", "job-echo").await);
    created(&start("bo", "job-echo").await);
    assert_unknown(
        &send(
            &server,
            "tasks/get",
            task(&third),
            true,
            &[("x-actor", "bo")],
        )
        .await,
    );
}

#[tokio::test]
async fn one_process_runs_at_most_max_running_tasks() {
    let fixture = fixture();
    let server = fixture
        .hooked()
        .with_task_options(options().with_max_running(1));
    let first = created(
        &send(
            &server,
            "tools/call",
            call("job-wait", json!({})),
            true,
            &[("x-actor", "ada")],
        )
        .await,
    );
    let refused = send(
        &server,
        "tools/call",
        call("job-wait", json!({})),
        true,
        &[("x-actor", "bo")],
    )
    .await;
    assert_limited(&refused);
    let runs = Arc::clone(&fixture.runs);
    eventually(|| Runs::count(&runs.started) == 1).await;
    fixture.runs.release.notify_one();
    settle_over_http(&server, &first, &[("x-actor", "ada")]).await;
    // Its place is free once it finished.
    let mut answer = Answer {
        status: 0,
        body: Value::Null,
        text: String::new(),
    };
    for _ in 0..2000 {
        answer = send(
            &server,
            "tools/call",
            call("job-echo", json!({})),
            true,
            &[("x-actor", "bo")],
        )
        .await;
        if answer.body["result"]["resultType"] == "task" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
    created(&answer);
}

/// What a server that cannot tell its HTTP callers apart answers: no extension, `optional`
/// inline, `required` refused before anything runs, `tasks/*` as on a server with no task.
async fn assert_no_tasks(server: &McpServer, runs: &Arc<Runs>) {
    let discovered = send(server, "server/discover", json!({}), false, &[]).await;
    assert!(
        discovered.body["result"]["capabilities"]["extensions"]
            .get(TASKS_EXTENSION_ID)
            .is_none(),
        "{}",
        discovered.text
    );
    let echoes = Runs::count(&runs.echo);
    let inline = send(server, "tools/call", call("job-echo", json!({})), true, &[]).await;
    assert_eq!(
        inline.body["result"]["resultType"], "complete",
        "{}",
        inline.text
    );
    assert_eq!(
        inline.body["result"]["structuredContent"]["data"]["task"],
        false
    );
    for declared in [true, false] {
        let refused = send(
            server,
            "tools/call",
            call("job-must", json!({})),
            declared,
            &[],
        )
        .await;
        assert_eq!(refused.status, 200, "{}", refused.text);
        assert_eq!(refused.body["result"]["isError"], true, "{}", refused.text);
        let error = &refused.body["result"]["structuredContent"]["error"];
        assert_eq!(error["code"], "UNAUTHORIZED");
        assert_eq!(error["retryable"], false);
        let suggestion = error["suggestion"].as_str().unwrap();
        assert!(suggestion.contains("authorization") && suggestion.contains("context hook"));
    }
    // Only the inline `optional` call ran.
    assert_eq!(Runs::count(&runs.echo), echoes + 1);
    // An `optional` command that waits runs inline too: release it first, since the call
    // answers only when it returns.
    let runs_before = Runs::count(&runs.started);
    runs.release.notify_one();
    let inline = send(server, "tools/call", call("job-wait", json!({})), true, &[]).await;
    assert_eq!(
        inline.body["result"]["structuredContent"]["data"]["waited"],
        true
    );
    assert_eq!(Runs::count(&runs.started), runs_before + 1);
    for (method, declared) in [
        ("tasks/get", true),
        ("tasks/get", false),
        ("tasks/update", true),
        ("tasks/cancel", true),
    ] {
        let mut params = task(&"a".repeat(26));
        if method == "tasks/update" {
            params["inputResponses"] = json!({});
        }
        let answer = send(server, method, params, declared, &[]).await;
        assert_eq!(answer.status, 404, "{method}: {}", answer.text);
        assert_eq!(
            answer.body["error"],
            json!({ "code": -32601, "message": method })
        );
    }
}

#[tokio::test]
async fn over_http_without_identified_callers_there_are_no_tasks() {
    // No hook (the options' declaration does not count without one) and no authorization.
    let fixture = fixture();
    let server = fixture.bare(ToolStrategy::Individual);
    assert_no_tasks(&server, &fixture.runs).await;
    // A 2025 `initialize` declares no extension either.
    let initialize = json!({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {
            "protocolVersion": "2025-11-25",
            "capabilities": { "extensions": { TASKS_EXTENSION_ID: {} } },
            "clientInfo": { "name": "legacy", "version": "0" }
        }
    });
    let (status, body) = common::http_post(&server, initialize, &[]).await;
    assert_eq!(status, 200, "{body}");
    assert!(body["result"]["capabilities"]["extensions"]
        .get(TASKS_EXTENSION_ID)
        .is_none());
}

#[tokio::test]
async fn a_hook_without_the_declaration_does_not_identify_callers() {
    let fixture = fixture();
    let server = identifying(
        fixture
            .bare(ToolStrategy::Individual)
            .with_task_options(plain_options()),
        Arc::new(Mutex::new(Vec::new())),
    );
    assert_no_tasks(&server, &fixture.runs).await;
}

#[tokio::test]
async fn the_declaration_with_a_hook_identifies_callers() {
    let fixture = fixture();
    let server = fixture.server(ToolStrategy::Individual);
    let discovered = send(&server, "server/discover", json!({}), false, &[]).await;
    assert_eq!(
        discovered.body["result"]["capabilities"]["extensions"][TASKS_EXTENSION_ID],
        json!({}),
        "{}",
        discovered.text
    );
    let id = created(
        &send(
            &server,
            "tools/call",
            call("job-must", json!({})),
            true,
            &[],
        )
        .await,
    );
    assert_eq!(
        settle_over_http(&server, &id, &[]).await["result"]["status"],
        "completed"
    );
}

/// A host serving the server on its own Streamable HTTP stack, not through
/// `streamable_http_service`: the server decides per request, so the same rule holds.
#[tokio::test]
async fn the_rule_holds_on_a_host_s_own_http_stack() {
    use rmcp::transport::streamable_http_server::{
        session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
    };
    let fixture = fixture();
    let server = fixture.bare(ToolStrategy::Individual);
    let service = || {
        let server = server.clone();
        let config = StreamableHttpServerConfig::default()
            .with_legacy_session_mode(false)
            .with_json_response(true);
        StreamableHttpService::new(
            move || Ok(server.clone()),
            Arc::new(LocalSessionManager::default()),
            config,
        )
    };
    let discovered = answer_of(service(), request("server/discover", json!({}), false, &[])).await;
    assert!(
        discovered.body["result"]["capabilities"]["extensions"]
            .get(TASKS_EXTENSION_ID)
            .is_none(),
        "{}",
        discovered.text
    );
    let refused = answer_of(
        service(),
        request("tools/call", call("job-must", json!({})), true, &[]),
    )
    .await;
    assert_eq!(
        refused.body["result"]["structuredContent"]["error"]["code"], "UNAUTHORIZED",
        "{}",
        refused.text
    );
    let inline = answer_of(
        service(),
        request("tools/call", call("job-echo", json!({})), true, &[]),
    )
    .await;
    assert_eq!(
        inline.body["result"]["structuredContent"]["data"]["task"],
        false
    );
    let answer = answer_of(
        service(),
        request("tasks/get", task(&"a".repeat(26)), true, &[]),
    )
    .await;
    assert_eq!(answer.body["error"]["code"], -32601, "{}", answer.text);
    // A 2025 `initialize` there declares no extension either.
    let initialize = json!({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {
            "protocolVersion": "2025-11-25",
            "capabilities": {},
            "clientInfo": { "name": "legacy", "version": "0" }
        }
    });
    let request = http::Request::post("/mcp")
        .header("host", "localhost")
        .header("content-type", "application/json")
        .header("accept", "application/json, text/event-stream")
        .body(Full::new(bytes::Bytes::from(initialize.to_string())))
        .unwrap();
    let answer = answer_of(service(), request).await;
    assert_eq!(
        answer.body["result"]["protocolVersion"], "2025-11-25",
        "{}",
        answer.text
    );
    assert!(answer.body["result"]["capabilities"]["extensions"]
        .get(TASKS_EXTENSION_ID)
        .is_none());
}

/// A store that answers with the owner's other task, whatever id it is asked for: the server must
/// answer only for the id the caller named.
struct WrongId(InMemoryTaskStore);

#[async_trait]
impl TaskStore for WrongId {
    async fn create(&self, record: TaskRecord) -> Result<(), TaskStoreError> {
        self.0.create(record).await
    }
    async fn get(
        &self,
        _id: &str,
        owner: &TaskOwner,
    ) -> Result<Option<TaskRecord>, TaskStoreError> {
        let first = "a".repeat(26);
        self.0.get(&first, owner).await
    }
    async fn update(
        &self,
        id: &str,
        owner: &TaskOwner,
        change: TaskChange,
    ) -> Result<(), TaskStoreError> {
        self.0.update(id, owner, change).await
    }
    async fn expire(&self, now: i64) -> Result<u64, TaskStoreError> {
        self.0.expire(now).await
    }
}

#[tokio::test]
async fn the_server_answers_only_for_the_id_named() {
    let fixture = fixture();
    let store = WrongId(InMemoryTaskStore::new());
    let owner = TaskOwner::from_binding(
        afd::principal_binding(Some(&Actor::new(ActorKind::Agent)), None).unwrap(),
    );
    store
        .0
        .create(TaskRecord::new(
            "a".repeat(26),
            owner,
            "job-echo",
            NOW_MS,
            TTL_MS,
            250,
        ))
        .await
        .unwrap();
    let server = fixture
        .server(ToolStrategy::Individual)
        .with_task_store(store);
    assert_eq!(
        get_over_http(&server, &"a".repeat(26), &[]).await["result"]["status"],
        "working"
    );
    assert_unknown(&send(&server, "tasks/get", task(&"b".repeat(26)), true, &[]).await);
}

#[test]
fn the_in_memory_store_checks_the_owner_and_keeps_a_finished_task() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .build()
        .unwrap();
    runtime.block_on(async {
        let store = InMemoryTaskStore::new();
        let owner = TaskOwner::from_binding(r#"{"actor":null,"credentials":null}"#);
        let other = TaskOwner::from_binding(r#"{"actor":{"kind":"agent"},"credentials":null}"#);
        let record = TaskRecord::new("a".repeat(26), owner.clone(), "job-echo", 0, 10, 1);
        store.create(record.clone()).await.unwrap();
        assert!(
            store.create(record.clone()).await.is_err(),
            "an id is never replaced"
        );
        assert_eq!(store.get(&record.id, &other).await.unwrap(), None);
        store
            .update(&record.id, &other, TaskChange::Cancelled { at: 1 })
            .await
            .unwrap();
        let kept = store.get(&record.id, &owner).await.unwrap().unwrap();
        assert_eq!(kept.status, afd::server::TaskState::Working);
        store
            .update(&record.id, &owner, TaskChange::Cancelled { at: 2 })
            .await
            .unwrap();
        store
            .update(
                &record.id,
                &owner,
                TaskChange::Progress {
                    message: "late".into(),
                    at: 3,
                },
            )
            .await
            .unwrap();
        let kept = store.get(&record.id, &owner).await.unwrap().unwrap();
        assert_eq!(kept.status, afd::server::TaskState::Cancelled);
        assert_eq!(kept.status_message, None);
        assert_eq!(kept.last_updated_at, 2);
        assert_eq!(store.expire(9).await.unwrap(), 0);
        assert_eq!(store.expire(10).await.unwrap(), 1);
        assert_eq!(store.get(&record.id, &owner).await.unwrap(), None);
        assert!(!format!("{kept:?}").contains(&record.id));
        assert_eq!(format!("{owner:?}"), "TaskOwner([redacted])");
    });
}

// ─── Registration and surfaces ───────────────────────────────────────────────────────────────

#[test]
fn registration_refuses_a_task_that_would_ask_a_person() {
    let runs = Arc::new(Runs::default());
    let base = |task: TaskSupport| {
        exposed(
            CommandDefinition::new("job-gated", "Gated", vec![], Echo(Arc::clone(&runs)))
                .with_task(task),
        )
    };
    for task in [TaskSupport::Optional, TaskSupport::Required] {
        let gated = [
            ("confirm_prompt", base(task).with_confirm_prompt("Sure?")),
            (
                "an approval policy other than not-required",
                base(task).with_approval(ApprovalPolicy::Required),
            ),
            (
                "an approval policy other than not-required",
                base(task).with_approval(ApprovalPolicy::when(|_, _| {
                    afd::ApprovalDecision::NotRequired
                })),
            ),
            (
                "confirmation_mode",
                base(task).with_confirmation_mode(CommandConfirmationMode::HostVerified),
            ),
        ];
        for (gate, command) in gated {
            let error = CommandRegistry::new().register(command).unwrap_err();
            assert!(error.starts_with("Command 'job-gated': task"), "{error}");
            assert!(error.contains(gate), "{error}");
            assert!(error.contains(task.as_str()), "{error}");
        }
        let error = CommandRegistry::new()
            .register_with_schema(
                base(task).with_confirm_prompt("Sure?"),
                json!({ "type": "object" }),
            )
            .unwrap_err();
        assert!(error.contains("confirm_prompt"), "{error}");
        // Not required is no gate.
        CommandRegistry::new()
            .register(base(task).with_approval(ApprovalPolicy::NotRequired))
            .unwrap();
    }
    // A command that is never a task may ask a person.
    CommandRegistry::new()
        .register(
            base(TaskSupport::Never)
                .with_confirm_prompt("Sure?")
                .with_approval(ApprovalPolicy::Required)
                .with_confirmation_mode(CommandConfirmationMode::HostVerified),
        )
        .unwrap();
}

#[tokio::test]
async fn task_is_reported_in_meta_grouped_actions_and_afd_detail() {
    let fixture = fixture();
    let listed = send(
        &fixture.server(ToolStrategy::Individual),
        "tools/list",
        json!({}),
        false,
        &[],
    )
    .await;
    let tools = listed.body["result"]["tools"].as_array().unwrap();
    let meta = |name: &str| {
        tools
            .iter()
            .find(|tool| tool["name"] == name)
            .map(|tool| tool["_meta"].clone())
            .unwrap()
    };
    assert_eq!(meta("job-echo")["task"], "optional");
    assert_eq!(meta("job-must")["task"], "required");
    assert!(meta("todo-list").get("task").is_none());

    let grouped = send(
        &fixture.server(ToolStrategy::Grouped),
        "tools/list",
        json!({}),
        false,
        &[],
    )
    .await;
    let job = grouped.body["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|tool| tool["name"] == "job")
        .unwrap()
        .clone();
    let actions = job["_meta"]["actions"].as_array().unwrap();
    let must = actions
        .iter()
        .find(|action| action["action"] == "must")
        .unwrap();
    assert_eq!(must["task"], "required", "{must}");

    let detail = send(
        &fixture.server(ToolStrategy::Individual),
        "tools/call",
        call(
            "afd-detail",
            json!({ "command": ["job-echo", "todo-list"] }),
        ),
        false,
        &[],
    )
    .await;
    let data = &detail.body["result"]["structuredContent"]["data"];
    let entries = data
        .as_array()
        .cloned()
        .unwrap_or_else(|| vec![data.clone()]);
    let entry = |name: &str| {
        entries
            .iter()
            .find(|entry| entry["name"] == name)
            .unwrap()
            .clone()
    };
    assert_eq!(entry("job-echo")["task"], "optional", "{data}");
    assert!(entry("todo-list").get("task").is_none());
}

#[test]
fn an_explicit_never_is_reported() {
    let runs = Arc::new(Runs::default());
    let registry = CommandRegistry::new();
    registry
        .register(exposed(
            CommandDefinition::new("job-never", "Never", vec![], Echo(runs))
                .with_task(TaskSupport::Never),
        ))
        .unwrap();
    assert_eq!(
        registry.get_tool("job-never").unwrap()["_meta"]["task"],
        "never"
    );
}

// ─── stdio ───────────────────────────────────────────────────────────────────────────────────

fn stdio_params(params: Value, tasks: bool) -> Value {
    let mut params = params;
    params["_meta"] = meta(tasks);
    params
}

#[tokio::test]
async fn tasks_run_end_to_end_over_stdio() {
    let fixture = fixture();
    // No hook and no authorization: one client per connection identifies the caller.
    let mut client = Stdio::connect_modern(fixture.bare(ToolStrategy::Individual));
    let discovered = client
        .request("server/discover", stdio_params(json!({}), false))
        .await;
    assert_eq!(
        discovered["result"]["capabilities"]["extensions"][TASKS_EXTENSION_ID],
        json!({}),
        "{discovered}"
    );
    let answer = client
        .request(
            "tools/call",
            stdio_params(call("job-must", json!({})), false),
        )
        .await;
    assert_eq!(answer["error"]["code"], -32021, "{answer}");

    let answer = client
        .request(
            "tools/call",
            stdio_params(call("job-echo", json!({ "note": "s" })), true),
        )
        .await;
    assert_eq!(answer["result"]["resultType"], "task", "{answer}");
    let id = answer["result"]["taskId"].as_str().unwrap().to_owned();
    let mut done = Value::Null;
    for _ in 0..2000 {
        done = client
            .request("tasks/get", stdio_params(task(&id), true))
            .await;
        if done["result"]["status"] != "working" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
    assert_eq!(done["result"]["status"], "completed", "{done}");
    assert_eq!(task_command_result(&done)["data"]["input"]["note"], "s");

    let answer = client
        .request(
            "tools/call",
            stdio_params(call("job-wait", json!({})), true),
        )
        .await;
    let id = answer["result"]["taskId"].as_str().unwrap().to_owned();
    let runs = Arc::clone(&fixture.runs);
    eventually(|| Runs::count(&runs.started) == 1).await;
    let ack = client
        .request("tasks/cancel", stdio_params(task(&id), true))
        .await;
    assert_eq!(ack["result"], json!({ "resultType": "complete" }), "{ack}");
    let mut done = Value::Null;
    for _ in 0..2000 {
        done = client
            .request("tasks/get", stdio_params(task(&id), true))
            .await;
        if done["result"]["status"] != "working" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
    assert_eq!(done["result"]["status"], "cancelled", "{done}");
    let unknown = client
        .request("tasks/get", stdio_params(task(&"d".repeat(26)), true))
        .await;
    assert_eq!(
        unknown["error"],
        json!({ "code": -32602, "message": "Task not found" })
    );
}

// ─── Before dispatch ─────────────────────────────────────────────────────────────────────────

/// Counts the records a store is asked to create.
#[derive(Default)]
struct Recording(InMemoryTaskStore, Mutex<Vec<TaskRecord>>);

#[async_trait]
impl TaskStore for Recording {
    async fn create(&self, record: TaskRecord) -> Result<(), TaskStoreError> {
        self.1.lock().unwrap().push(record.clone());
        self.0.create(record).await
    }
    async fn get(&self, id: &str, owner: &TaskOwner) -> Result<Option<TaskRecord>, TaskStoreError> {
        self.0.get(id, owner).await
    }
    async fn update(
        &self,
        id: &str,
        owner: &TaskOwner,
        change: TaskChange,
    ) -> Result<(), TaskStoreError> {
        self.0.update(id, owner, change).await
    }
    async fn expire(&self, now: i64) -> Result<u64, TaskStoreError> {
        self.0.expire(now).await
    }
}

#[tokio::test]
async fn a_call_outside_its_context_creates_no_task() {
    let fixture = fixture();
    fixture
        .registry
        .register(exposed(
            CommandDefinition::new("ops-sync", "Sync", vec![], Echo(Arc::clone(&fixture.runs)))
                .with_task(TaskSupport::Optional)
                .with_contexts(["ops"]),
        ))
        .unwrap();
    let store = Arc::new(Recording::default());
    let server = fixture
        .server(ToolStrategy::Individual)
        .with_contexts(vec![
            ContextConfig::new("ops"),
            ContextConfig::new("review"),
        ])
        .unwrap()
        .with_task_store(Arc::clone(&store));
    let mut params = call("ops-sync", json!({}));
    params["_meta"] = meta(true);
    params["_meta"]["dev.afd/context"] = json!("review");
    let service = server.streamable_http_service(afd::server::HttpOptions::default());
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": params });
    let request = http::Request::post("/mcp")
        .header("host", "localhost")
        .header("content-type", "application/json")
        .header("accept", "application/json, text/event-stream")
        .header("mcp-protocol-version", "2026-07-28")
        .header("mcp-method", "tools/call")
        .header("mcp-name", "ops-sync")
        .body(Full::new(bytes::Bytes::from(body.to_string())))
        .unwrap();
    let answer = answer_of(service, request).await;
    assert_eq!(
        answer.body["result"]["structuredContent"]["error"]["code"],
        error_codes::COMMAND_NOT_IN_CONTEXT,
        "{}",
        answer.text
    );
    assert!(store.1.lock().unwrap().is_empty());
}

// ─── Authorized servers ──────────────────────────────────────────────────────────────────────

#[cfg(feature = "server-auth")]
mod authorized {
    use super::*;
    use afd::server::auth::{Authorization, ScopeDecision, ScopeResolver};
    use afd::Credentials;
    use common::auth::{
        authorization, claims, ec256, header, sign, token_with_scope, ISSUER, NOW, RESOURCE,
    };

    const OTHER_ISSUER: &str = "https://other.example.com";
    /// Seconds from [`NOW`] to the test credentials' `exp`: within the tasks' TTL.
    const EXPIRES_IN: i64 = 30;

    fn credentials(issuer: &str, subject: &str, client: &str) -> Credentials {
        // It expires before the tasks' TTL ends.
        Credentials::new(
            issuer,
            subject,
            client,
            RESOURCE,
            NOW - 60,
            NOW + EXPIRES_IN,
        )
        .with_scopes(["todo:read", "jobs:run"])
    }

    fn base() -> Credentials {
        credentials(ISSUER, "user-1", "todo-agent")
    }

    /// One request to `server`, with trusted host code admitting `credentials` for `auth`.
    async fn admitted(
        server: &McpServer,
        auth: &Authorization,
        credentials: Credentials,
        method: &str,
        params: Value,
    ) -> Answer {
        let inner = server.streamable_http_service(afd::server::HttpOptions::default());
        let auth = auth.clone();
        let service = tower::service_fn(move |mut request: http::Request<Full<bytes::Bytes>>| {
            auth.admit(request.extensions_mut(), credentials.clone());
            inner.clone().oneshot(request)
        });
        answer_of(service, request(method, params, true, &[])).await
    }

    async fn settle_admitted(
        server: &McpServer,
        auth: &Authorization,
        credentials: &Credentials,
        id: &str,
    ) -> Value {
        settled(|| async {
            admitted(server, auth, credentials.clone(), "tasks/get", task(id))
                .await
                .body
        })
        .await
    }

    fn authorized(fixture: &Fixture, auth: &Authorization) -> McpServer {
        fixture
            .bare(ToolStrategy::Individual)
            .with_authorization(auth.clone())
    }

    #[tokio::test]
    async fn verified_credentials_identify_callers_without_a_hook() {
        let fixture = fixture();
        let auth = authorization();
        let server = authorized(&fixture, &auth);
        let discovered = admitted(&server, &auth, base(), "server/discover", json!({})).await;
        assert_eq!(
            discovered.body["result"]["capabilities"]["extensions"][TASKS_EXTENSION_ID],
            json!({}),
            "{}",
            discovered.text
        );
        let id = created(
            &admitted(
                &server,
                &auth,
                base(),
                "tools/call",
                call("job-must", json!({})),
            )
            .await,
        );
        assert_eq!(
            settle_admitted(&server, &auth, &base(), &id).await["result"]["status"],
            "completed"
        );
    }

    #[tokio::test]
    async fn the_owner_is_the_issuer_subject_and_client() {
        let fixture = fixture();
        let auth = authorization();
        let server = authorized(&fixture, &auth);
        let answer = admitted(
            &server,
            &auth,
            base(),
            "tools/call",
            call("job-wait", json!({})),
        )
        .await;
        let id = created(&answer);
        let runs = Arc::clone(&fixture.runs);
        eventually(|| Runs::count(&runs.started) == 1).await;
        let unknown = admitted(&server, &auth, base(), "tasks/get", task(&"e".repeat(26))).await;
        assert_unknown(&unknown);
        for stranger in [
            credentials(ISSUER, "user-2", "todo-agent"),
            credentials(ISSUER, "user-1", "other-agent"),
            credentials(OTHER_ISSUER, "user-1", "todo-agent"),
        ] {
            let answer = admitted(&server, &auth, stranger.clone(), "tasks/get", task(&id)).await;
            assert_eq!(answer.text, unknown.text, "{stranger:?}");
            let cancel = admitted(&server, &auth, stranger, "tasks/cancel", task(&id)).await;
            assert_eq!(cancel.text, unknown.text);
        }
        // The same principal with another token (other scopes, times) is the owner.
        let again = Credentials::new(ISSUER, "user-1", "todo-agent", RESOURCE, NOW, NOW + 900)
            .with_scopes(["jobs:run", "todo:write"]);
        let mine = admitted(&server, &auth, again, "tasks/get", task(&id)).await;
        assert_eq!(mine.body["result"]["status"], "working", "{}", mine.text);
        assert_eq!(Runs::count(&runs.dropped), 0);
        fixture.runs.release.notify_one();
        assert_eq!(
            settle_admitted(&server, &auth, &base(), &id).await["result"]["status"],
            "completed"
        );
    }

    #[tokio::test]
    async fn a_task_stops_with_task_token_expired_when_its_token_expires() {
        let fixture = fixture();
        let auth = authorization();
        let server = authorized(&fixture, &auth);
        let answer = admitted(
            &server,
            &auth,
            base(),
            "tools/call",
            call("job-wait", json!({})),
        )
        .await;
        let id = created(&answer);
        let runs = Arc::clone(&fixture.runs);
        eventually(|| Runs::count(&runs.started) == 1).await;
        // One millisecond before `exp`, it still runs.
        fixture.clock.set((NOW + EXPIRES_IN) * 1000 - 1);
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert_eq!(Runs::count(&runs.dropped), 0);
        let working = admitted(&server, &auth, base(), "tasks/get", task(&id)).await;
        assert_eq!(working.body["result"]["status"], "working");
        fixture.clock.set((NOW + EXPIRES_IN) * 1000);
        let done = settle_admitted(&server, &auth, &base(), &id).await;
        assert_eq!(done["result"]["status"], "completed", "{done}");
        assert_eq!(done["result"]["result"]["isError"], true);
        let error = &task_command_result(&done)["error"];
        assert_eq!(error["code"], error_codes::TASK_TOKEN_EXPIRED);
        assert_eq!(error["retryable"], true);
        eventually(|| Runs::count(&runs.dropped) == 1).await;
        eventually(|| Runs::count(&runs.signalled) == 1).await;
    }

    #[tokio::test]
    async fn a_token_that_expired_first_never_starts_the_handler() {
        let fixture = fixture();
        let auth = authorization();
        let server = authorized(&fixture, &auth);
        fixture.clock.set((NOW + EXPIRES_IN) * 1000);
        let answer = admitted(
            &server,
            &auth,
            base(),
            "tools/call",
            call("job-wait", json!({})),
        )
        .await;
        let id = created(&answer);
        let done = settle_admitted(&server, &auth, &base(), &id).await;
        assert_eq!(
            task_command_result(&done)["error"]["code"],
            error_codes::TASK_TOKEN_EXPIRED
        );
        assert_eq!(Runs::count(&fixture.runs.started), 0);
    }

    #[tokio::test]
    async fn credentials_that_cannot_be_bound_get_no_task() {
        let fixture = fixture();
        let auth = authorization();
        let server = authorized(&fixture, &auth);
        let incomplete = credentials(ISSUER, "", "todo-agent");
        let answer = admitted(
            &server,
            &auth,
            incomplete.clone(),
            "tools/call",
            call("job-echo", json!({})),
        )
        .await;
        assert_eq!(
            answer.body["error"],
            json!({ "code": -32603, "message": "Internal error" })
        );
        let answer = admitted(
            &server,
            &auth,
            incomplete,
            "tasks/get",
            task(&"f".repeat(26)),
        )
        .await;
        assert_eq!(
            answer.body["error"],
            json!({ "code": -32603, "message": "Internal error" })
        );
        assert_eq!(Runs::count(&fixture.runs.echo), 0);
    }

    #[tokio::test]
    async fn the_scope_check_comes_before_the_task_and_holds_for_its_owner() {
        let fixture = fixture();
        let auth = authorization();
        let store = Arc::new(Recording::default());
        let server = authorized(&fixture, &auth).with_task_store(Arc::clone(&store));
        let narrow = Credentials::new(
            ISSUER,
            "user-1",
            "todo-agent",
            RESOURCE,
            NOW - 60,
            NOW + 600,
        )
        .with_scopes(["todo:read"]);
        let answer = admitted(
            &server,
            &auth,
            narrow.clone(),
            "tools/call",
            call("job-scoped", json!({})),
        )
        .await;
        assert_eq!(
            answer.body["result"]["structuredContent"]["error"]["code"],
            error_codes::INSUFFICIENT_SCOPE,
            "{}",
            answer.text
        );
        assert!(store.1.lock().unwrap().is_empty());

        // The owner, later holding a token without the command's scope.
        let id = created(
            &admitted(
                &server,
                &auth,
                base(),
                "tools/call",
                call("job-scoped", json!({})),
            )
            .await,
        );
        settle_admitted(&server, &auth, &base(), &id).await;
        let answer = admitted(&server, &auth, narrow, "tasks/get", task(&id)).await;
        assert_eq!(answer.body["error"]["code"], -32600, "{}", answer.text);
        assert_eq!(
            answer.body["error"]["data"]["code"],
            error_codes::INSUFFICIENT_SCOPE
        );
        assert_eq!(answer.body["error"]["data"]["scopes"], json!(["jobs:run"]));
        // No record holds a token or the credentials beyond the owner's binding.
        let records = store.1.lock().unwrap().clone();
        let text = serde_json::to_string(&records).unwrap();
        assert!(
            !text.contains("todo:read") && !text.contains("jobs:run"),
            "{text}"
        );
        assert!(!text.contains(RESOURCE), "{text}");
    }

    #[tokio::test]
    async fn tasks_methods_need_the_required_scopes() {
        let fixture = fixture();
        let auth = authorization().with_required_scopes(["todo:read"]).unwrap();
        let server = authorized(&fixture, &auth);
        let id = created(
            &admitted(
                &server,
                &auth,
                base(),
                "tools/call",
                call("job-echo", json!({})),
            )
            .await,
        );
        let lacking = Credentials::new(
            ISSUER,
            "user-1",
            "todo-agent",
            RESOURCE,
            NOW - 60,
            NOW + 600,
        )
        .with_scopes(["jobs:run"]);
        let known = admitted(&server, &auth, lacking.clone(), "tasks/get", task(&id)).await;
        let unknown = admitted(&server, &auth, lacking, "tasks/get", task(&"g".repeat(26))).await;
        assert_eq!(known.body["error"]["code"], -32600, "{}", known.text);
        assert_eq!(
            known.body["error"]["data"]["code"],
            error_codes::INSUFFICIENT_SCOPE
        );
        assert_eq!(known.body["error"]["data"]["scopes"], json!(["todo:read"]));
        // Decided before the task is looked up: the same answer for any id.
        assert_eq!(known.text, unknown.text);
    }

    struct Hidden;

    impl ScopeResolver for Hidden {
        fn resolve(
            &self,
            _command: &str,
            _input: &Value,
            _credentials: &Credentials,
        ) -> ScopeDecision {
            ScopeDecision::Allowed
        }
        fn visible(&self, command: &str, credentials: &Credentials) -> bool {
            command != "job-echo" || credentials.has_scope("jobs:run")
        }
    }

    #[tokio::test]
    async fn under_a_resolver_the_owner_must_still_see_the_command() {
        let fixture = fixture();
        let auth = authorization().with_resolver(Hidden);
        let server = authorized(&fixture, &auth);
        let id = created(
            &admitted(
                &server,
                &auth,
                base(),
                "tools/call",
                call("job-echo", json!({})),
            )
            .await,
        );
        assert_eq!(
            settle_admitted(&server, &auth, &base(), &id).await["result"]["status"],
            "completed"
        );
        let narrow = Credentials::new(
            ISSUER,
            "user-1",
            "todo-agent",
            RESOURCE,
            NOW - 60,
            NOW + 600,
        )
        .with_scopes(["todo:read"]);
        let answer = admitted(&server, &auth, narrow, "tasks/get", task(&id)).await;
        assert_eq!(
            answer.body["error"]["data"]["code"],
            error_codes::INSUFFICIENT_SCOPE,
            "{}",
            answer.text
        );
        assert_eq!(answer.body["error"]["data"]["scopes"], json!([]));
    }

    /// The runner checks only every ten minutes here, so a stop must come from the signal or the
    /// check when the handler returns, not from a tick.
    #[tokio::test]
    async fn a_result_that_arrives_after_the_token_expired_is_not_delivered() {
        let fixture = fixture();
        let auth = authorization();
        let server = authorized(&fixture, &auth)
            .with_task_options(options().with_check_interval_ms(600_000));
        let id = created(
            &admitted(
                &server,
                &auth,
                base(),
                "tools/call",
                call("job-wait", json!({})),
            )
            .await,
        );
        let runs = Arc::clone(&fixture.runs);
        eventually(|| Runs::count(&runs.started) == 1).await;
        fixture.clock.set((NOW + EXPIRES_IN) * 1000);
        fixture.runs.release.notify_one();
        let done = settle_admitted(&server, &auth, &base(), &id).await;
        assert_eq!(
            task_command_result(&done)["error"]["code"],
            error_codes::TASK_TOKEN_EXPIRED,
            "{done}"
        );
    }

    #[tokio::test]
    async fn a_mutation_stopped_by_token_expiry_is_not_retryable_as_it_is() {
        let fixture = fixture();
        let auth = authorization();
        let server = authorized(&fixture, &auth);
        let id = created(
            &admitted(
                &server,
                &auth,
                base(),
                "tools/call",
                call("job-write", json!({})),
            )
            .await,
        );
        let runs = Arc::clone(&fixture.runs);
        eventually(|| Runs::count(&runs.started) == 1).await;
        fixture.clock.set((NOW + EXPIRES_IN) * 1000);
        let done = settle_admitted(&server, &auth, &base(), &id).await;
        let error = &task_command_result(&done)["error"];
        assert_eq!(error["code"], error_codes::TASK_TOKEN_EXPIRED, "{done}");
        assert_eq!(error["retryable"], false);
        assert!(error["suggestion"]
            .as_str()
            .unwrap()
            .contains("may have made part of its change"));
    }

    #[tokio::test]
    async fn a_mutation_that_finished_after_its_token_expired_says_it_ran() {
        let fixture = fixture();
        let auth = authorization();
        let server = authorized(&fixture, &auth)
            .with_task_options(options().with_check_interval_ms(600_000));
        let id = created(
            &admitted(
                &server,
                &auth,
                base(),
                "tools/call",
                call("job-write", json!({})),
            )
            .await,
        );
        let runs = Arc::clone(&fixture.runs);
        eventually(|| Runs::count(&runs.started) == 1).await;
        fixture.clock.set((NOW + EXPIRES_IN) * 1000);
        fixture.runs.release.notify_one();
        let done = settle_admitted(&server, &auth, &base(), &id).await;
        let error = &task_command_result(&done)["error"];
        assert_eq!(error["code"], error_codes::TASK_TOKEN_EXPIRED, "{done}");
        assert_eq!(error["retryable"], false);
        assert!(error["suggestion"]
            .as_str()
            .unwrap()
            .contains("ran to the end"));
    }

    #[tokio::test]
    async fn a_mutation_whose_token_expired_before_it_started_is_retryable() {
        let fixture = fixture();
        let auth = authorization();
        let server = authorized(&fixture, &auth);
        fixture.clock.set((NOW + EXPIRES_IN) * 1000);
        let id = created(
            &admitted(
                &server,
                &auth,
                base(),
                "tools/call",
                call("job-write", json!({})),
            )
            .await,
        );
        let done = settle_admitted(&server, &auth, &base(), &id).await;
        let error = &task_command_result(&done)["error"];
        assert_eq!(error["code"], error_codes::TASK_TOKEN_EXPIRED, "{done}");
        assert_eq!(error["retryable"], true);
        assert!(error["suggestion"]
            .as_str()
            .unwrap()
            .starts_with("Nothing ran"));
        assert_eq!(Runs::count(&fixture.runs.started), 0);
    }

    #[tokio::test]
    async fn the_ttl_can_end_at_the_token_expiry_plus_a_grace() {
        let fixture = fixture();
        let auth = authorization();
        let server = authorized(&fixture, &auth)
            .with_task_options(options().with_ttl_capped_at_token_expiry(5_000));
        let answer = admitted(
            &server,
            &auth,
            base(),
            "tools/call",
            call("job-wait", json!({})),
        )
        .await;
        let id = created(&answer);
        // `exp` is 30 s away, the TTL option 60 s: the TTL ends 5 s after `exp`.
        assert_eq!(answer.body["result"]["ttlMs"], 35_000, "{}", answer.text);
        fixture.clock.set((NOW + EXPIRES_IN) * 1000);
        let done = settle_admitted(&server, &auth, &base(), &id).await;
        assert_eq!(
            task_command_result(&done)["error"]["code"],
            error_codes::TASK_TOKEN_EXPIRED
        );
        fixture.clock.set((NOW + EXPIRES_IN) * 1000 + 5_000);
        assert_unknown(&admitted(&server, &auth, base(), "tasks/get", task(&id)).await);
    }

    #[tokio::test]
    async fn tasks_methods_fail_closed_without_admitted_credentials() {
        let fixture = fixture();
        let auth = authorization();
        let server = authorized(&fixture, &auth);
        let id = created(
            &admitted(
                &server,
                &auth,
                base(),
                "tools/call",
                call("job-echo", json!({})),
            )
            .await,
        );
        // The plain service: no layer admitted any credentials.
        for method in ["tasks/get", "tasks/cancel"] {
            let answer = send(&server, method, task(&id), true, &[]).await;
            assert_eq!(
                answer.body["error"]["code"], -32600,
                "{method}: {}",
                answer.text
            );
            assert_eq!(answer.body["error"]["data"]["code"], "UNAUTHORIZED");
        }
    }

    #[tokio::test]
    async fn an_owner_whose_token_lost_the_scope_can_still_cancel() {
        let fixture = fixture();
        let auth = authorization();
        let server = authorized(&fixture, &auth);
        fixture
            .registry
            .register(exposed(
                CommandDefinition::new(
                    "job-guarded",
                    "Wait, scoped",
                    note(),
                    Wait(Arc::clone(&fixture.runs)),
                )
                .with_task(TaskSupport::Optional)
                .with_scopes(["jobs:run"]),
            ))
            .unwrap();
        let id = created(
            &admitted(
                &server,
                &auth,
                base(),
                "tools/call",
                call("job-guarded", json!({})),
            )
            .await,
        );
        let runs = Arc::clone(&fixture.runs);
        eventually(|| Runs::count(&runs.started) == 1).await;
        let narrow = Credentials::new(
            ISSUER,
            "user-1",
            "todo-agent",
            RESOURCE,
            NOW - 60,
            NOW + EXPIRES_IN,
        )
        .with_scopes(["todo:read"]);
        let read = admitted(&server, &auth, narrow.clone(), "tasks/get", task(&id)).await;
        assert_eq!(
            read.body["error"]["data"]["code"],
            error_codes::INSUFFICIENT_SCOPE
        );
        let ack = admitted(&server, &auth, narrow, "tasks/cancel", task(&id)).await;
        assert_eq!(
            ack.body["result"],
            json!({ "resultType": "complete" }),
            "{}",
            ack.text
        );
        let done = settle_admitted(&server, &auth, &base(), &id).await;
        assert_eq!(done["result"]["status"], "cancelled", "{done}");
    }

    /// Through the bearer layer, with real tokens.
    #[tokio::test]
    async fn over_the_bearer_layer_tokens_decide_the_owner() {
        let fixture = fixture();
        let auth = authorization();
        let server = authorized(&fixture, &auth);
        let service = || {
            server
                .authorized_http_service(afd::server::HttpOptions::default())
                .unwrap()
        };
        let token = token_with_scope(Some("todo:read jobs:run"));
        let bearer = format!("Bearer {token}");
        let with_token = |bearer: &str, method: &str, params: Value| {
            request(method, params, true, &[]).tap(bearer)
        };
        let answer = answer_of(
            service(),
            with_token(&bearer, "tools/call", call("job-echo", json!({}))),
        )
        .await;
        let id = created(&answer);
        // No token: 401 before anything.
        let answer = answer_of(service(), request("tasks/get", task(&id), true, &[])).await;
        assert_eq!(answer.status, 401);
        // Another subject's token.
        let mut other = claims();
        other["sub"] = json!("user-2");
        other["scope"] = json!("todo:read jobs:run");
        let other = format!(
            "Bearer {}",
            sign(&header("ES256", "ec256"), &other, ec256())
        );
        let answer = answer_of(service(), with_token(&other, "tasks/get", task(&id))).await;
        assert_unknown(&answer);
        // The same principal with another token (another `jti`).
        let mut again = claims();
        again["jti"] = json!("j-2");
        again["scope"] = json!("todo:read jobs:run");
        let again = format!(
            "Bearer {}",
            sign(&header("ES256", "ec256"), &again, ec256())
        );
        let done = settled(|| async {
            answer_of(service(), with_token(&again, "tasks/get", task(&id)))
                .await
                .body
        })
        .await;
        assert_eq!(done["result"]["status"], "completed", "{done}");
        // A missing command scope is a 403 before dispatch, and no task.
        let narrow = format!("Bearer {}", token_with_scope(Some("todo:read")));
        let answer = answer_of(
            service(),
            with_token(&narrow, "tools/call", call("job-scoped", json!({}))),
        )
        .await;
        assert_eq!(answer.status, 403);
    }

    trait Tap {
        fn tap(self, bearer: &str) -> Self;
    }

    impl Tap for http::Request<Full<bytes::Bytes>> {
        fn tap(mut self, bearer: &str) -> Self {
            self.headers_mut()
                .insert("authorization", bearer.parse().unwrap());
            self
        }
    }
}
