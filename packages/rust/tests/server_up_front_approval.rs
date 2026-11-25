//! One up-front approval for `afd-batch` and `afd-pipe` over the form-mode approval relay (#459;
//! `spec/command-metadata.md`, "Asking the human over MCP"): every gated step is asked about once,
//! before any step runs, or nothing runs.
#![cfg(all(feature = "server", feature = "approval"))]

use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};

use afd::server::{ConfirmationMode, HttpOptions, McpServer};
use afd::{
    create_approval_middleware, success, ApprovalMiddlewareOptions, ApprovalPolicy, ApprovalRelay,
    Clock, CommandContext, CommandDefinition, CommandHandler, CommandParameter, CommandRegistry,
    CommandResult,
};
use async_trait::async_trait;
use http_body_util::{BodyExt, Full};
use serde_json::{json, Value};
use tower::ServiceExt;

const SECRET: &str = "test-approval-secret-0123456789abcdef";
const TTL_MS: u64 = 60_000;

/// Records `<command>:<input id>` for each run.
struct Record(&'static str, Arc<Mutex<Vec<String>>>);

#[async_trait]
impl CommandHandler for Record {
    async fn execute(&self, input: Value, _context: CommandContext) -> CommandResult<Value> {
        let entry = match input.get("id") {
            Some(id) => format!("{}:{id}", self.0),
            None => self.0.to_owned(),
        };
        self.1.lock().unwrap().push(entry);
        success(json!({ "id": 5 }))
    }
}

/// A clock the tests move: approvals expire on the middleware's clock.
#[derive(Clone)]
struct Movable(Arc<AtomicI64>);

impl Clock for Movable {
    fn now(&self) -> i64 {
        self.0.load(Ordering::SeqCst)
    }
}

struct Setup {
    server: McpServer,
    calls: Arc<Mutex<Vec<String>>>,
    clock: Arc<AtomicI64>,
}

fn setup(mode: ConfirmationMode) -> Setup {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let registry = CommandRegistry::new();
    let id = || vec![CommandParameter::required_number("id", "Todo ID")];
    let mut delete = CommandDefinition::new(
        "todo-delete",
        "Delete a todo",
        id(),
        Record("delete", Arc::clone(&calls)),
    )
    .with_approval(ApprovalPolicy::Required);
    let mut archive = CommandDefinition::new(
        "todo-archive",
        "Archive a todo",
        id(),
        Record("archive", Arc::clone(&calls)),
    )
    .with_approval(ApprovalPolicy::Required);
    let mut clear = CommandDefinition::new(
        "todo-clear",
        "Clear",
        vec![],
        Record("clear", Arc::clone(&calls)),
    )
    .with_confirm_prompt("Delete every todo?")
    .with_approval(ApprovalPolicy::Required);
    let mut list = CommandDefinition::new(
        "todo-list",
        "List",
        vec![],
        Record("list", Arc::clone(&calls)),
    );
    for command in [&mut delete, &mut archive, &mut clear, &mut list] {
        command.expose.mcp = true;
    }
    // Gated, but not exposed over MCP: a caller there must not learn it exists.
    let hidden = CommandDefinition::new(
        "secret-wipe",
        "Wipe",
        vec![],
        Record("wipe", Arc::clone(&calls)),
    )
    .with_approval(ApprovalPolicy::Required);
    for command in [delete, archive, clear, list, hidden] {
        registry.register(command).unwrap();
    }
    let clock = Arc::new(AtomicI64::new(1_790_000_000_000));
    let options = ApprovalMiddlewareOptions::new(SECRET, registry.list())
        .with_include_token(false)
        .with_ttl_ms(TTL_MS)
        .with_clock(Movable(Arc::clone(&clock)))
        .with_relay(ApprovalRelay::McpElicitation);
    registry.add_middleware(create_approval_middleware(options).unwrap());
    let server = McpServer::new(Arc::new(registry), "up-front", "1.0.0")
        .with_confirmations_key(mode, vec![9u8; 32])
        .unwrap();
    Setup {
        server,
        calls,
        clock,
    }
}

impl Setup {
    fn calls(&self) -> Vec<String> {
        self.calls.lock().unwrap().clone()
    }

    /// A modern `tools/call` of `tool`, from a client that declares form elicitation or not.
    async fn call(&self, tool: &str, args: Value, elicitation: bool, extra: Value) -> Value {
        let capabilities = if elicitation {
            json!({ "elicitation": {} })
        } else {
            json!({})
        };
        let mut params = json!({
            "name": tool,
            "arguments": args,
            "_meta": {
                "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                "io.modelcontextprotocol/clientCapabilities": capabilities,
            },
        });
        if let Value::Object(extra) = extra {
            for (key, value) in extra {
                params[key] = value;
            }
        }
        let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": params });
        let service = self.server.streamable_http_service(HttpOptions::default());
        let request = http::Request::post("/mcp")
            .header("host", "localhost")
            .header("content-type", "application/json")
            .header("accept", "application/json, text/event-stream")
            .header("mcp-protocol-version", "2026-07-28")
            .header("mcp-method", "tools/call")
            .header("mcp-name", tool)
            .body(Full::new(bytes::Bytes::from(body.to_string())))
            .unwrap();
        let response = service.oneshot(request).await.unwrap();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let text = String::from_utf8_lossy(&bytes).to_string();
        serde_json::from_str(&text).unwrap_or_else(|_| {
            text.lines()
                .find_map(|line| line.strip_prefix("data: "))
                .and_then(|data| serde_json::from_str(data).ok())
                .unwrap_or(Value::Null)
        })
    }
}

fn body(response: &Value) -> Value {
    serde_json::from_str(
        response["result"]["content"][0]["text"]
            .as_str()
            .unwrap_or("null"),
    )
    .unwrap_or(Value::Null)
}

fn state_of(response: &Value) -> String {
    response["result"]["requestState"]
        .as_str()
        .unwrap_or_else(|| panic!("no state: {response}"))
        .to_owned()
}

fn question(response: &Value) -> String {
    response["result"]["inputRequests"]["approval"]["params"]["message"]
        .as_str()
        .unwrap_or_else(|| panic!("no question: {response}"))
        .to_owned()
}

fn answer(state: &str, action: &str, approve: bool) -> Value {
    json!({
        "inputResponses": { "approval": { "action": action, "content": { "approve": approve } } },
        "requestState": state,
    })
}

/// The error of a batch or pipeline refused before any step ran.
fn refusal(response: &Value) -> Value {
    let body = body(response);
    if body.get("error").is_some_and(|error| !error.is_null()) {
        return body["error"].clone();
    }
    body["steps"][0]["error"].clone()
}

fn batch() -> Value {
    json!({ "commands": [
        { "command": "todo-list", "input": {} },
        { "command": "todo-delete", "input": { "id": 1 } },
        { "command": "todo-archive", "input": { "id": 2 } },
    ]})
}

const BATCH_QUESTION: &str = "This batch includes 2 steps that need your approval. Approving lets each run once, exactly as shown; if you do not approve, nothing in the batch runs.\n\nStep 2: Run todo-delete\nCommand: todo-delete\nInput: {\"id\":1}\n\nStep 3: Run todo-archive\nCommand: todo-archive\nInput: {\"id\":2}";

#[tokio::test]
async fn a_batch_is_asked_about_once_and_runs_on_acceptance() {
    let setup = setup(ConfirmationMode::Off);
    let asked = setup.call("afd-batch", batch(), true, json!({})).await;
    assert_eq!(asked["result"]["resultType"], "input_required", "{asked}");
    assert_eq!(question(&asked), BATCH_QUESTION);
    assert!(setup.calls().is_empty());
    let ran = setup
        .call(
            "afd-batch",
            batch(),
            true,
            answer(&state_of(&asked), "accept", true),
        )
        .await;
    assert_eq!(body(&ran)["success"], true, "{ran}");
    assert_eq!(setup.calls(), ["list", "delete:1", "archive:2"]);
    assert!(!ran.to_string().contains("afdap1"));
}

/// The refusal of a gated step whose input has no canonical JSON (2^53 + 1): nothing ran and
/// nobody was asked.
fn assert_not_canonical(setup: &Setup, response: &Value) {
    assert!(
        response["result"]["inputRequests"].is_null(),
        "not asked: {response}"
    );
    let error = refusal(response);
    assert_eq!(error["code"], "APPROVAL_UNAVAILABLE", "{response}");
    assert_eq!(
        error["details"]["reason"], "input-not-canonical",
        "{response}"
    );
    // The caller sends the input in another form: no recovery (`spec/recovery.md`).
    assert!(error.get("recovery").is_none(), "{response}");
    assert_eq!(
        error["message"],
        "todo-delete needs a person's approval, and this input cannot be bound to one"
    );
    assert!(setup.calls().is_empty());
}

#[tokio::test]
async fn a_batch_step_whose_input_has_no_canonical_json_is_refused_up_front() {
    let setup = setup(ConfirmationMode::Off);
    let request = json!({ "commands": [
        { "command": "todo-list", "input": {} },
        { "command": "todo-delete", "input": { "id": 9_007_199_254_740_993_u64 } },
    ]});
    let response = setup.call("afd-batch", request, true, json!({})).await;
    assert_not_canonical(&setup, &response);
}

#[tokio::test]
async fn a_pipe_step_whose_input_has_no_canonical_json_is_refused_up_front() {
    let setup = setup(ConfirmationMode::Off);
    let pipe = json!({
        "input": { "target": 9_007_199_254_740_993_u64 },
        "steps": [
            { "command": "todo-list" },
            { "command": "todo-delete", "input": { "id": "$input.target" } },
        ],
    });
    let response = setup.call("afd-pipe", pipe, true, json!({})).await;
    assert_not_canonical(&setup, &response);
}

#[tokio::test]
async fn a_pipeline_whose_gated_steps_read_only_input_is_asked_about_once() {
    let setup = setup(ConfirmationMode::Off);
    let pipe = json!({
        "input": { "target": 4 },
        "steps": [
            { "command": "todo-list" },
            { "command": "todo-delete", "input": { "id": "$input.target" } },
        ],
    });
    let asked = setup.call("afd-pipe", pipe.clone(), true, json!({})).await;
    assert_eq!(
        question(&asked),
        "This pipeline includes a step that needs your approval. Approving lets each run once, exactly as shown; if you do not approve, nothing in the pipeline runs.\n\nStep 2: Run todo-delete\nCommand: todo-delete\nInput: {\"id\":4}"
    );
    let ran = setup
        .call(
            "afd-pipe",
            pipe,
            true,
            answer(&state_of(&asked), "accept", true),
        )
        .await;
    let statuses: Vec<Value> = body(&ran)["steps"]
        .as_array()
        .unwrap()
        .iter()
        .map(|step| step["status"].clone())
        .collect();
    assert_eq!(statuses, [json!("success"), json!("success")], "{ran}");
    assert_eq!(setup.calls(), ["list", "delete:4"]);
}

#[tokio::test]
async fn two_identical_gated_steps_each_take_their_own_approval() {
    let setup = setup(ConfirmationMode::Off);
    let twice = json!({ "commands": [
        { "command": "todo-delete", "input": { "id": 1 } },
        { "command": "todo-delete", "input": { "id": 1 } },
    ]});
    let asked = setup
        .call("afd-batch", twice.clone(), true, json!({}))
        .await;
    assert!(question(&asked).starts_with("This batch includes 2 steps"));
    let ran = setup
        .call(
            "afd-batch",
            twice,
            true,
            answer(&state_of(&asked), "accept", true),
        )
        .await;
    assert_eq!(body(&ran)["success"], true, "{ran}");
    assert_eq!(setup.calls(), ["delete:1", "delete:1"]);
}

#[tokio::test]
async fn a_decline_or_cancel_runs_nothing() {
    for (action, approve) in [("decline", false), ("cancel", false), ("accept", false)] {
        let setup = setup(ConfirmationMode::Off);
        let asked = setup.call("afd-batch", batch(), true, json!({})).await;
        let refused = setup
            .call(
                "afd-batch",
                batch(),
                true,
                answer(&state_of(&asked), action, approve),
            )
            .await;
        let error = refusal(&refused);
        assert_eq!(error["code"], "APPROVAL_REQUIRED", "{refused}");
        assert_eq!(error["retryable"], false);
        assert_eq!(error["details"]["reason"], "declined");
        assert_eq!(error["recovery"], json!({ "kind": "stop" }));
        assert_eq!(
            error["details"]["summary"],
            "Run todo-delete; Run todo-archive"
        );
        assert_eq!(body(&refused)["results"], json!([]));
        assert!(setup.calls().is_empty(), "{action}");
    }
}

#[tokio::test]
async fn an_approval_that_expired_before_the_answer_is_asked_again() {
    let setup = setup(ConfirmationMode::Off);
    let asked = setup.call("afd-batch", batch(), true, json!({})).await;
    setup.clock.fetch_add(TTL_MS as i64, Ordering::SeqCst);
    let late = setup
        .call(
            "afd-batch",
            batch(),
            true,
            answer(&state_of(&asked), "accept", true),
        )
        .await;
    assert_eq!(late["result"]["resultType"], "input_required", "{late}");
    assert_eq!(
        question(&late),
        format!("The earlier approval expired, was already used or no longer matches; approve again to run it.\n{BATCH_QUESTION}")
    );
    assert!(setup.calls().is_empty());
    let on_time = setup
        .call(
            "afd-batch",
            batch(),
            true,
            answer(&state_of(&late), "accept", true),
        )
        .await;
    assert_eq!(body(&on_time)["success"], true, "{on_time}");
    assert_eq!(setup.calls(), ["list", "delete:1", "archive:2"]);
}

#[tokio::test]
async fn a_client_without_elicitation_keeps_the_fallback() {
    let setup = setup(ConfirmationMode::Off);
    let ran = setup.call("afd-batch", batch(), false, json!({})).await;
    assert_ne!(ran["result"]["resultType"], "input_required", "{ran}");
    let results = body(&ran)["results"].clone();
    let error = &results[1]["result"]["error"];
    assert_eq!(error["code"], "APPROVAL_REQUIRED", "{ran}");
    assert!(error["details"].get("approvalToken").is_none());
    assert!(error["suggestion"]
        .as_str()
        .unwrap()
        .contains("supports form elicitation"));
    assert_eq!(error["recovery"], json!({ "kind": "external" }));
    assert_eq!(setup.calls(), ["list"]);
}

#[tokio::test]
async fn a_gated_step_reading_an_earlier_step_refuses_the_pipeline_up_front() {
    let setup = setup(ConfirmationMode::Off);
    for id in ["$prev.id", "$first", "$steps[0].id", "$steps.listed.id"] {
        let pipe = json!({ "steps": [
            { "command": "todo-list", "as": "listed" },
            { "command": "todo-delete", "input": { "id": 1 } },
            { "command": "todo-delete", "input": { "id": id } },
        ]});
        let refused = setup.call("afd-pipe", pipe, true, json!({})).await;
        assert_ne!(
            refused["result"]["resultType"], "input_required",
            "{refused}"
        );
        let error = refusal(&refused);
        assert_eq!(error["code"], "APPROVAL_REQUIRED", "{refused}");
        assert_eq!(error["details"]["reason"], "input-not-known");
        // The caller splits the pipeline: no command does it (`spec/recovery.md`).
        assert!(error.get("recovery").is_none(), "{refused}");
        assert_eq!(error["details"]["step"], 2);
        assert_eq!(error["details"]["command"], "todo-delete");
        assert!(error["suggestion"]
            .as_str()
            .unwrap()
            .contains("Split the pipeline before the step at index 2"));
    }
    // A step that reads an earlier one but needs no approval does not stop the pipeline.
    let fine = json!({ "steps": [
        { "command": "todo-list" },
        { "command": "todo-list", "input": { "from": "$prev" } },
    ]});
    let ran = setup.call("afd-pipe", fine, true, json!({})).await;
    assert_eq!(body(&ran)["steps"].as_array().unwrap().len(), 2, "{ran}");
    assert_eq!(setup.calls(), ["list", "list"]);
}

#[tokio::test]
async fn an_approved_state_is_not_replayed() {
    let setup = setup(ConfirmationMode::Off);
    let asked = setup.call("afd-batch", batch(), true, json!({})).await;
    let retry = answer(&state_of(&asked), "accept", true);
    let ran = setup.call("afd-batch", batch(), true, retry.clone()).await;
    assert_eq!(body(&ran)["success"], true, "{ran}");
    let replay = setup.call("afd-batch", batch(), true, retry).await;
    assert_eq!(replay["result"]["resultType"], "input_required", "{replay}");
    assert_eq!(setup.calls(), ["list", "delete:1", "archive:2"]);
}

#[tokio::test]
async fn a_changed_input_another_command_or_an_extra_step_is_not_approved() {
    let setup = setup(ConfirmationMode::Off);
    let asked = setup.call("afd-batch", batch(), true, json!({})).await;
    let retry = answer(&state_of(&asked), "accept", true);
    let commands = batch()["commands"].clone();
    let changes = [
        json!([commands[0], { "command": "todo-delete", "input": { "id": 9 } }, commands[2]]),
        json!([commands[0], { "command": "todo-archive", "input": { "id": 1 } }, commands[2]]),
        json!([commands[0], commands[1], commands[2], commands[1]]),
    ];
    for changed in changes {
        let response = setup
            .call(
                "afd-batch",
                json!({ "commands": changed }),
                true,
                retry.clone(),
            )
            .await;
        assert_eq!(
            response["result"]["resultType"], "input_required",
            "{response}"
        );
    }
    assert!(setup.calls().is_empty());
    let original = setup.call("afd-batch", batch(), true, retry).await;
    assert_eq!(body(&original)["success"], true, "{original}");
    assert_eq!(setup.calls(), ["list", "delete:1", "archive:2"]);
}

#[tokio::test]
async fn an_approval_covers_its_own_request_and_no_other() {
    let setup = setup(ConfirmationMode::Off);
    let asked = setup.call("afd-batch", batch(), true, json!({})).await;
    let retry = answer(&state_of(&asked), "accept", true);
    let mut reversed = batch();
    reversed["commands"].as_array_mut().unwrap().reverse();
    let mut stopping = batch();
    stopping["options"] = json!({ "stopOnError": true });
    let elsewhere = [
        (
            "afd-pipe",
            json!({ "steps": [{ "command": "todo-archive", "input": { "id": 2 } }] }),
        ),
        ("todo-delete", json!({ "id": 1 })),
        ("afd-batch", reversed),
        ("afd-batch", stopping),
    ];
    for (tool, args) in elsewhere {
        let response = setup.call(tool, args, true, retry.clone()).await;
        assert_eq!(
            response["result"]["resultType"], "input_required",
            "{tool}: {response}"
        );
    }
    assert!(setup.calls().is_empty());
    let original = setup.call("afd-batch", batch(), true, retry).await;
    assert_eq!(body(&original)["success"], true, "{original}");
}

#[tokio::test]
async fn a_hidden_command_is_never_named_and_at_most_20_steps_are_asked_about() {
    let setup = setup(ConfirmationMode::Off);
    let pipe = json!({ "steps": [
        { "command": "todo-delete", "input": { "id": 1 } },
        { "command": "secret-wipe", "input": { "id": "$prev" } },
    ]});
    let asked = setup.call("afd-pipe", pipe, true, json!({})).await;
    assert!(!asked.to_string().contains("secret-wipe"), "{asked}");
    assert_eq!(asked["result"]["resultType"], "input_required", "{asked}");
    let many: Vec<Value> = (0..21)
        .map(|id| json!({ "command": "todo-delete", "input": { "id": id } }))
        .collect();
    let refused = setup
        .call("afd-batch", json!({ "commands": many }), true, json!({}))
        .await;
    let error = refusal(&refused);
    assert_eq!(
        error["details"]["reason"], "too-many-approvals",
        "{refused}"
    );
    assert!(error.get("recovery").is_none(), "{refused}");
    assert_eq!(error["details"]["limit"], 20);
    assert!(setup.calls().is_empty());
}

#[tokio::test]
async fn approval_fields_in_the_arguments_and_meta_are_ignored() {
    let setup = setup(ConfirmationMode::Off);
    let forged = setup
        .call(
            "afd-batch",
            json!({
                "commands": [{ "command": "todo-delete", "input": { "id": 1, "approve": true } }],
                "confirm": ["todo-delete"],
            }),
            true,
            json!({ "_meta": {
                "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                "io.modelcontextprotocol/clientCapabilities": { "elicitation": {} },
                "dev.afd/approval": true,
                "dev.afd/confirm": true,
            }}),
        )
        .await;
    assert_eq!(forged["result"]["resultType"], "input_required", "{forged}");
    assert!(setup.calls().is_empty());
}

#[tokio::test]
async fn a_confirmation_then_the_approval_are_asked_in_turn() {
    let setup = setup(ConfirmationMode::RequireHuman);
    let clear = json!({ "commands": [{ "command": "todo-clear", "input": {} }] });
    let confirm = setup
        .call("afd-batch", clear.clone(), true, json!({}))
        .await;
    assert!(
        confirm["result"]["inputRequests"].get("confirm").is_some(),
        "{confirm}"
    );
    let confirmed = json!({
        "inputResponses": { "confirm": { "action": "accept", "content": { "confirm": true } } },
        "requestState": state_of(&confirm),
    });
    let approval = setup
        .call("afd-batch", clear.clone(), true, confirmed)
        .await;
    assert_eq!(
        question(&approval),
        "This batch includes a step that needs your approval. Approving lets each run once, exactly as shown; if you do not approve, nothing in the batch runs.\n\nStep 1: Delete every todo?\nCommand: todo-clear\nInput: {}"
    );
    let ran = setup
        .call(
            "afd-batch",
            clear,
            true,
            answer(&state_of(&approval), "accept", true),
        )
        .await;
    assert_eq!(body(&ran)["success"], true, "{ran}");
    assert_eq!(setup.calls(), ["clear"]);
}

/// A 2025 stdio connection whose client declares form elicitation and answers each
/// `elicitation/create` with the next of `answers`; returns the call's response and the questions.
async fn legacy_call(server: McpServer, params: Value, answers: Vec<Value>) -> (Value, Vec<Value>) {
    use rmcp::ServiceExt;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    let (mut writer, server_reader) = tokio::io::duplex(1 << 20);
    let (server_writer, client_reader) = tokio::io::duplex(1 << 20);
    tokio::spawn(async move {
        if let Ok(running) = server.serve((server_reader, server_writer)).await {
            let _ = running.waiting().await;
        }
    });
    let mut reader = BufReader::new(client_reader);
    let send = |message: Value| format!("{message}\n");
    let mut answers = answers.into_iter();
    let mut asked = Vec::new();
    let initialize = json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
        "protocolVersion": "2025-11-25",
        "capabilities": { "elicitation": { "form": {} } },
        "clientInfo": { "name": "legacy", "version": "0" },
    }});
    writer.write_all(send(initialize).as_bytes()).await.unwrap();
    let initialized = json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
    writer
        .write_all(send(initialized).as_bytes())
        .await
        .unwrap();
    let call = json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": params });
    writer.write_all(send(call).as_bytes()).await.unwrap();
    loop {
        let mut line = String::new();
        assert!(reader.read_line(&mut line).await.unwrap() > 0);
        let message: Value = serde_json::from_str(&line).unwrap();
        if message["method"] == "elicitation/create" {
            asked.push(message["params"].clone());
            let answer = answers.next().unwrap_or(json!({ "action": "cancel" }));
            let reply = json!({ "jsonrpc": "2.0", "id": message["id"], "result": answer });
            writer.write_all(send(reply).as_bytes()).await.unwrap();
        } else if message["id"] == 2 {
            return (message, asked);
        }
    }
}

#[tokio::test]
async fn a_2025_stdio_connection_is_asked_once_in_band() {
    let params = json!({ "name": "afd-batch", "arguments": batch() });
    let accept = json!({ "action": "accept", "content": { "approve": true } });
    let setup_accept = setup(ConfirmationMode::Off);
    let calls = Arc::clone(&setup_accept.calls);
    let (ran, asked) = legacy_call(setup_accept.server, params.clone(), vec![accept]).await;
    assert_eq!(body(&ran)["success"], true, "{ran}");
    assert_eq!(asked.len(), 1);
    assert_eq!(asked[0]["message"], BATCH_QUESTION);
    assert_eq!(*calls.lock().unwrap(), ["list", "delete:1", "archive:2"]);

    let setup_decline = setup(ConfirmationMode::Off);
    let calls = Arc::clone(&setup_decline.calls);
    let decline = json!({ "action": "decline" });
    let (refused, _) = legacy_call(setup_decline.server, params, vec![decline]).await;
    assert_eq!(
        refusal(&refused)["details"]["reason"],
        "declined",
        "{refused}"
    );
    assert_eq!(refusal(&refused)["recovery"], json!({ "kind": "stop" }));
    assert!(calls.lock().unwrap().is_empty());
}

/// A server whose `todo-wipe` declares no approval policy: only the approval middleware's
/// commands list gates it (#1886).
fn list_only_setup() -> Setup {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let registry = CommandRegistry::new();
    let wipe = || {
        let mut wipe = CommandDefinition::new(
            "todo-wipe",
            "Wipe a todo",
            vec![CommandParameter::required_number("id", "Todo ID")],
            Record("wipe", Arc::clone(&calls)),
        );
        wipe.expose.mcp = true;
        wipe
    };
    let mut list = CommandDefinition::new(
        "todo-list",
        "List",
        vec![],
        Record("list", Arc::clone(&calls)),
    );
    list.expose.mcp = true;
    registry.register(list).unwrap();
    registry.register(wipe()).unwrap();
    let clock = Arc::new(AtomicI64::new(1_790_000_000_000));
    let listed = wipe().with_approval(ApprovalPolicy::Required);
    let options = ApprovalMiddlewareOptions::new(SECRET, [listed])
        .with_include_token(false)
        .with_ttl_ms(TTL_MS)
        .with_clock(Movable(Arc::clone(&clock)))
        .with_relay(ApprovalRelay::McpElicitation);
    registry.add_middleware(create_approval_middleware(options).unwrap());
    let server = McpServer::new(Arc::new(registry), "up-front", "1.0.0")
        .with_confirmations_key(ConfirmationMode::Off, vec![9u8; 32])
        .unwrap();
    Setup {
        server,
        calls,
        clock,
    }
}

#[tokio::test]
async fn a_batch_step_gated_only_by_the_list_is_asked_about_before_any_step_runs() {
    let setup = list_only_setup();
    let request = json!({ "commands": [
        { "command": "todo-list", "input": {} },
        { "command": "todo-wipe", "input": { "id": 1 } },
    ]});
    let asked = setup
        .call("afd-batch", request.clone(), true, json!({}))
        .await;
    assert_eq!(asked["result"]["resultType"], "input_required", "{asked}");
    assert!(
        question(&asked).contains("Step 2: Run todo-wipe"),
        "{asked}"
    );
    assert!(setup.calls().is_empty(), "the earlier step did not run");
    let ran = setup
        .call(
            "afd-batch",
            request,
            true,
            answer(&state_of(&asked), "accept", true),
        )
        .await;
    assert_eq!(body(&ran)["success"], true, "{ran}");
    assert_eq!(setup.calls(), ["list", "wipe:1"]);
}

#[tokio::test]
async fn a_pipe_step_gated_only_by_the_list_is_asked_about_before_any_step_runs() {
    let setup = list_only_setup();
    let pipe = json!({
        "input": { "target": 4 },
        "steps": [
            { "command": "todo-list" },
            { "command": "todo-wipe", "input": { "id": "$input.target" } },
        ],
    });
    let asked = setup.call("afd-pipe", pipe.clone(), true, json!({})).await;
    assert_eq!(asked["result"]["resultType"], "input_required", "{asked}");
    assert!(
        question(&asked).contains("Step 2: Run todo-wipe"),
        "{asked}"
    );
    assert!(setup.calls().is_empty(), "the earlier step did not run");
    let ran = setup
        .call(
            "afd-pipe",
            pipe,
            true,
            answer(&state_of(&asked), "accept", true),
        )
        .await;
    let statuses: Vec<Value> = body(&ran)["steps"]
        .as_array()
        .unwrap()
        .iter()
        .map(|step| step["status"].clone())
        .collect();
    assert_eq!(statuses, [json!("success"), json!("success")], "{ran}");
    assert_eq!(setup.calls(), ["list", "wipe:4"]);
}

#[tokio::test]
async fn an_unresolvable_step_does_not_mask_a_later_step_of_the_same_gated_command() {
    let calls = Arc::new(Mutex::new(Vec::<String>::new()));
    let registry = CommandRegistry::new();
    let mut list = CommandDefinition::new(
        "todo-list",
        "List",
        vec![],
        Record("list", Arc::clone(&calls)),
    );
    list.expose.mcp = true;
    registry.register(list).unwrap();
    let mut delete = CommandDefinition::new(
        "todo-delete",
        "Delete",
        vec![CommandParameter::required_number("id", "Todo ID")],
        Record("delete", Arc::clone(&calls)),
    )
    .with_approval(ApprovalPolicy::Required);
    delete.expose.mcp = true;
    registry.register(delete).unwrap();
    let clock = Arc::new(AtomicI64::new(1_790_000_000_000));
    let options = ApprovalMiddlewareOptions::from_secret(SECRET)
        .with_ttl_ms(TTL_MS)
        .with_clock(Movable(Arc::clone(&clock)))
        .with_relay(ApprovalRelay::McpElicitation);
    registry.add_middleware(create_approval_middleware(options).unwrap());
    let server = McpServer::new(Arc::new(registry), "up-front", "1.0.0")
        .with_confirmations_key(ConfirmationMode::Off, vec![9u8; 32])
        .unwrap();
    let setup = Setup {
        server,
        calls,
        clock,
    };

    // Each half stays under the 64-level request limit, while expanding `$input.deep` inside
    // `nested` exceeds 64 levels so `try_resolve_variables` fails for step 2; step 3 calls the
    // same gated command with a valid static input. Step 1 must not run before approval.
    let mut deep = json!(1);
    for _ in 0..40 {
        deep = json!([deep]);
    }
    let mut nested = json!("$input.deep");
    for _ in 0..30 {
        nested = json!([nested]);
    }
    let pipe = json!({
        "input": { "deep": deep },
        "steps": [
            { "command": "todo-list" },
            { "command": "todo-delete", "input": { "id": nested } },
            { "command": "todo-delete", "input": { "id": 7 } },
        ],
    });
    let asked = setup.call("afd-pipe", pipe, true, json!({})).await;
    assert_eq!(asked["result"]["resultType"], "input_required", "{asked}");
    assert!(
        question(&asked).contains("Step 3: Run todo-delete"),
        "{asked}"
    );
    assert!(
        setup.calls().is_empty(),
        "step 1 must not run before step 3 is approved"
    );
}
