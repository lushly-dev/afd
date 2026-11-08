//! Host-verified confirmation and relay evidence over MCP (`spec/command-metadata.md`,
//! "Host-verified confirmation" and "Relay evidence"), end to end with a fake `HumanRelay`.
#![cfg(all(feature = "server", feature = "approval"))]

mod common;

use std::collections::VecDeque;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock, Weak};

use afd::server::{
    ConfirmationMode, HumanRelay, McpServer, RelayCall, RelayOutcome, RelayPrompt, ToolStrategy,
};
use afd::{
    create_approval_middleware, error_codes, success, ApprovalMiddlewareOptions,
    ApprovalNonceStore, ApprovalPolicy, ApprovalRelay, ApprovalReplay, CommandConfirmationMode,
    CommandContext, CommandDefinition, CommandError, CommandHandler, CommandParameter,
    CommandRegistry, CommandResult,
};
use async_trait::async_trait;
use common::{command_result, http_post, Stdio};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const SECRET: &str = "test-approval-secret-0123456789abcdef";
const URL: &str = "https://person.example.com/decide/d-1";

/// What the fake relay saw and will answer.
#[derive(Default)]
struct Fake {
    begins: AtomicUsize,
    resumes: AtomicUsize,
    calls: Mutex<Vec<RelayCall>>,
    states: Mutex<Vec<String>>,
    outcomes: Mutex<VecDeque<RelayOutcome>>,
    refusal: Mutex<Option<CommandError>>,
    prompt: Mutex<Option<RelayPrompt>>,
}

#[derive(Clone, Default)]
struct Relay(Arc<Fake>);

impl Relay {
    fn answer(&self, outcome: RelayOutcome) {
        self.0.outcomes.lock().unwrap().push_back(outcome);
    }
    fn begins(&self) -> usize {
        self.0.begins.load(Ordering::SeqCst)
    }
    fn resumes(&self) -> usize {
        self.0.resumes.load(Ordering::SeqCst)
    }
    fn last_call(&self) -> RelayCall {
        self.0.calls.lock().unwrap().last().cloned().unwrap()
    }
}

#[async_trait]
impl HumanRelay for Relay {
    async fn begin(&self, call: &RelayCall) -> Result<RelayPrompt, CommandError> {
        let count = self.0.begins.fetch_add(1, Ordering::SeqCst) + 1;
        self.0.calls.lock().unwrap().push(call.clone());
        if let Some(refusal) = self.0.refusal.lock().unwrap().clone() {
            return Err(refusal);
        }
        Ok(self.0.prompt.lock().unwrap().clone().unwrap_or_else(|| {
            RelayPrompt::new(
                URL,
                "Open the link to review memory-erase",
                format!("state-{count}"),
            )
        }))
    }

    async fn resume(&self, state: &str, call: &RelayCall) -> RelayOutcome {
        self.0.resumes.fetch_add(1, Ordering::SeqCst);
        self.0.calls.lock().unwrap().push(call.clone());
        self.0.states.lock().unwrap().push(state.to_owned());
        self.0
            .outcomes
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(RelayOutcome::Invalid)
    }
}

/// How many times each handler ran.
#[derive(Default)]
struct Runs {
    erase: AtomicUsize,
    purge: AtomicUsize,
    list: AtomicUsize,
}

struct Count(Arc<Runs>, fn(&Runs) -> &AtomicUsize);

#[async_trait]
impl CommandHandler for Count {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        (self.1)(&self.0).fetch_add(1, Ordering::SeqCst);
        success(json!({ "input": input, "actor": context.actor }))
    }
}

/// Runs `memory-purge` and itself again in process with its own context, and reports both.
struct Sweep(Arc<OnceLock<Weak<CommandRegistry>>>);

#[async_trait]
impl CommandHandler for Sweep {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let registry = self.0.get().and_then(Weak::upgrade).unwrap();
        let purge = registry
            .execute("memory-purge", json!({ "id": "42" }), Some(context.clone()))
            .await;
        let again = registry.execute("memory-sweep", input, Some(context)).await;
        success(json!({ "purge": purge, "again": again }))
    }
}

struct Options {
    relay: Option<Relay>,
    mode: ConfirmationMode,
    replay: ApprovalReplay,
    form_relay: bool,
    strategy: ToolStrategy,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            relay: Some(Relay::default()),
            mode: ConfirmationMode::Off,
            replay: ApprovalReplay::SingleUse,
            form_relay: false,
            strategy: ToolStrategy::Grouped,
        }
    }
}

struct Harness {
    server: McpServer,
    relay: Relay,
    runs: Arc<Runs>,
}

fn harness_with(options: Options) -> Harness {
    let runs = Arc::new(Runs::default());
    let registry = Arc::new(CommandRegistry::new());
    let id = || CommandParameter::required_string("id", "Memory ID");
    let mode =
        CommandParameter::optional_string("mode", "How to erase").with_default(json!("soft"));
    let mut erase = CommandDefinition::new(
        "memory-erase",
        "Erase a memory",
        vec![id(), mode],
        Count(Arc::clone(&runs), |runs| &runs.erase),
    )
    .as_mutation()
    .with_confirm_prompt("Erase this memory?")
    .with_approval(ApprovalPolicy::Required)
    .with_confirmation_mode(CommandConfirmationMode::HostVerified);
    let mut show = CommandDefinition::new(
        "memory-show",
        "Show a memory",
        vec![id()],
        Count(Arc::clone(&runs), |runs| &runs.list),
    )
    .with_confirmation_mode(CommandConfirmationMode::HostVerified);
    let mut purge = CommandDefinition::new(
        "memory-purge",
        "Purge a memory",
        vec![id()],
        Count(Arc::clone(&runs), |runs| &runs.purge),
    )
    .as_mutation()
    .with_approval(ApprovalPolicy::Required);
    let slot = Arc::new(OnceLock::new());
    let mut sweep = CommandDefinition::new(
        "memory-sweep",
        "Sweep memories",
        vec![],
        Sweep(Arc::clone(&slot)),
    )
    .with_approval(ApprovalPolicy::Required)
    .with_confirmation_mode(CommandConfirmationMode::HostVerified);
    let mut list = CommandDefinition::new(
        "todo-list",
        "List todos",
        vec![],
        Count(Arc::clone(&runs), |runs| &runs.list),
    );
    for command in [&mut erase, &mut show, &mut purge, &mut sweep, &mut list] {
        command.expose.mcp = true;
    }
    for command in [erase, show, purge, sweep, list] {
        registry.register(command).unwrap();
    }
    slot.set(Arc::downgrade(&registry)).unwrap();
    let mut approval = ApprovalMiddlewareOptions::new(SECRET, registry.list())
        .with_include_token(false)
        .with_replay(options.replay);
    if options.form_relay {
        approval = approval.with_relay(ApprovalRelay::McpElicitation);
    }
    registry.add_middleware(create_approval_middleware(approval).unwrap());
    let relay = options.relay.clone().unwrap_or_default();
    let mut server = McpServer::new(registry, "relay", "1.0.0")
        .with_confirmations(options.mode)
        .with_tool_strategy(options.strategy);
    if options.strategy == ToolStrategy::Hybrid {
        server = server.with_first_class_tools(["memory-erase"]);
    }
    if let Some(relay) = options.relay {
        server = server.with_human_relay(relay);
    }
    Harness {
        server,
        relay,
        runs,
    }
}

fn harness() -> Harness {
    harness_with(Options::default())
}

fn url_capabilities() -> Value {
    json!({ "elicitation": { "url": {} } })
}

/// A 2026-07-28 `tools/call` of `name` with these arguments, client capabilities and extra
/// params (`inputResponses`, `requestState`, `_meta` entries under `_meta`).
fn call(name: &str, arguments: Value, capabilities: Value, extra: Value) -> Value {
    let mut params = json!({
        "name": name,
        "arguments": arguments,
        "_meta": {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": capabilities,
        },
    });
    if let Value::Object(extra) = extra {
        for (key, value) in extra {
            if key == "_meta" {
                for (meta_key, meta_value) in value.as_object().unwrap() {
                    params["_meta"][meta_key] = meta_value.clone();
                }
            } else {
                params[key] = value;
            }
        }
    }
    json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": params })
}

async fn post(server: &McpServer, body: Value) -> Value {
    let name = body["params"]["name"].as_str().unwrap().to_owned();
    let (status, response) = http_post(
        server,
        body,
        &[
            ("mcp-protocol-version", "2026-07-28"),
            ("mcp-method", "tools/call"),
            ("mcp-name", &name),
        ],
    )
    .await;
    assert_eq!(status, 200, "{response}");
    response
}

async fn erase(server: &McpServer, arguments: Value, extra: Value) -> Value {
    post(
        server,
        call("memory-erase", arguments, url_capabilities(), extra),
    )
    .await
}

fn retry(action: &str, state: &str) -> Value {
    json!({ "inputResponses": { "relay": { "action": action } }, "requestState": state })
}

fn base64url(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let group = chunk.iter().enumerate().fold(0u32, |group, (index, byte)| {
            group | u32::from(*byte) << (16 - 8 * index)
        });
        for index in 0..=chunk.len() {
            out.push(char::from(
                ALPHABET[((group >> (18 - 6 * index)) & 63) as usize],
            ));
        }
    }
    out
}

/// The URL elicitation of an `input_required` answer, checked to be the only request.
fn url_elicitation(response: &Value) -> (Value, String) {
    let result = &response["result"];
    assert_eq!(result["resultType"], "input_required", "{response}");
    let requests = result["inputRequests"].as_object().unwrap();
    assert_eq!(requests.len(), 1, "{response}");
    let request = &requests["relay"];
    assert_eq!(request["method"], "elicitation/create");
    (
        request["params"].clone(),
        result["requestState"].as_str().unwrap().to_owned(),
    )
}

fn error_code(response: &Value) -> Value {
    command_result(response)["error"]["code"].clone()
}

#[tokio::test]
async fn begin_answers_with_one_url_elicitation_after_validation() {
    let Harness {
        server,
        relay,
        runs,
    } = harness();
    let asked = erase(&server, json!({ "id": "42" }), json!({})).await;
    let (params, state) = url_elicitation(&asked);
    assert_eq!(
        params,
        json!({
            "mode": "url",
            "message": "Open the link to review memory-erase",
            "url": URL,
            "elicitationId": base64url(&Sha256::digest(URL.as_bytes())),
        })
    );
    assert_eq!(state, "state-1");
    assert_eq!(relay.begins(), 1);
    assert_eq!(runs.erase.load(Ordering::SeqCst), 0);

    // The relay decides on the validated input, its default applied.
    let call = relay.last_call();
    assert_eq!(call.command, "memory-erase");
    assert_eq!(
        call.input_digest,
        afd::input_digest(&json!({ "id": "42", "mode": "soft" })).unwrap()
    );
    assert_ne!(
        call.input_digest,
        afd::input_digest(&json!({ "id": "42" })).unwrap()
    );
    assert_eq!(
        call.actor.as_ref().map(|actor| actor.kind),
        Some(afd::ActorKind::Agent)
    );
    assert!(call.credentials.is_none());
    assert!(call.supports_url_elicitation());
    assert_eq!(
        call.principal_binding().unwrap(),
        r#"{"actor":{"kind":"agent"},"credentials":null}"#
    );
}

#[tokio::test]
async fn invalid_input_fails_before_anyone_is_asked() {
    let Harness {
        server,
        relay,
        runs,
    } = harness();
    let refused = erase(&server, json!({ "mode": "hard" }), json!({})).await;
    assert_eq!(error_code(&refused), error_codes::VALIDATION_ERROR);
    assert_eq!(relay.begins(), 0);
    assert_eq!(runs.erase.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn an_approved_decision_runs_the_command_once() {
    let Harness {
        server,
        relay,
        runs,
    } = harness();
    let (_, state) = url_elicitation(&erase(&server, json!({ "id": "42" }), json!({})).await);

    relay.answer(RelayOutcome::Approved {
        decision_id: "d-1".into(),
    });
    let ran = command_result(&erase(&server, json!({ "id": "42" }), retry("accept", &state)).await);
    assert_eq!(ran["success"], true, "{ran}");
    assert_eq!(ran["data"]["input"], json!({ "id": "42", "mode": "soft" }));
    assert_eq!(runs.erase.load(Ordering::SeqCst), 1);
    assert_eq!(relay.resumes(), 1);
    assert_eq!(relay.0.states.lock().unwrap()[0], "state-1");
    assert_eq!(
        relay.last_call().input_digest,
        afd::input_digest(&json!({ "id": "42", "mode": "soft" })).unwrap()
    );

    // A relay that answered the same decision twice gets nothing more: the evidence is spent.
    relay.answer(RelayOutcome::Approved {
        decision_id: "d-1".into(),
    });
    let spent =
        command_result(&erase(&server, json!({ "id": "42" }), retry("accept", &state)).await);
    assert_eq!(
        spent["error"]["code"],
        error_codes::APPROVAL_REQUIRED,
        "{spent}"
    );
    assert_eq!(spent["error"]["details"]["reason"], "already-used");
    // Approval tokens stay off MCP.
    assert!(
        spent["error"]["details"].get("approvalToken").is_none(),
        "{spent}"
    );
    assert_eq!(runs.erase.load(Ordering::SeqCst), 1);

    // Another decision runs it again.
    relay.answer(RelayOutcome::Approved {
        decision_id: "d-2".into(),
    });
    let again =
        command_result(&erase(&server, json!({ "id": "42" }), retry("accept", &state)).await);
    assert_eq!(again["success"], true, "{again}");
    assert_eq!(runs.erase.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn a_decision_is_single_use_whatever_the_replay_setting() {
    let Harness {
        server,
        relay,
        runs,
    } = harness_with(Options {
        replay: ApprovalReplay::WithinTtl,
        ..Options::default()
    });
    for _ in 0..2 {
        relay.answer(RelayOutcome::Approved {
            decision_id: "d-1".into(),
        });
        erase(&server, json!({ "id": "42" }), retry("accept", "state-1")).await;
    }
    assert_eq!(runs.erase.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn decline_or_cancel_ends_the_call_without_asking_the_relay() {
    let Harness {
        server,
        relay,
        runs,
    } = harness();
    for action in ["decline", "cancel"] {
        let refused =
            command_result(&erase(&server, json!({ "id": "42" }), retry(action, "state-1")).await);
        assert_eq!(refused["error"]["code"], error_codes::CONFIRMATION_DECLINED);
        assert_eq!(refused["error"]["retryable"], false);
    }
    assert_eq!(relay.resumes(), 0);
    assert_eq!(relay.begins(), 0);
    assert_eq!(runs.erase.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn resume_outcomes_decline_ask_again_or_begin_again() {
    let Harness {
        server,
        relay,
        runs,
    } = harness();
    relay.answer(RelayOutcome::Declined);
    let declined =
        command_result(&erase(&server, json!({ "id": "42" }), retry("accept", "state-1")).await);
    assert_eq!(
        declined["error"]["code"],
        error_codes::CONFIRMATION_DECLINED
    );
    assert_eq!(declined["error"]["retryable"], false);

    // Pending: asked again with the same URL, so the same id, and the relay's fresh state.
    relay.answer(RelayOutcome::Pending(RelayPrompt::new(
        URL,
        "Still waiting",
        "state-fresh",
    )));
    let (params, state) =
        url_elicitation(&erase(&server, json!({ "id": "42" }), retry("accept", "state-1")).await);
    assert_eq!(
        params["elicitationId"],
        base64url(&Sha256::digest(URL.as_bytes()))
    );
    assert_eq!(params["message"], "Still waiting");
    assert_eq!(state, "state-fresh");
    assert_eq!(relay.begins(), 0);

    // Invalid: the state is no answer, so the relay begins again.
    relay.answer(RelayOutcome::Invalid);
    let (_, state) =
        url_elicitation(&erase(&server, json!({ "id": "42" }), retry("accept", "forged")).await);
    assert_eq!(state, "state-1");
    assert_eq!(relay.begins(), 1);
    assert_eq!(relay.resumes(), 3);
    assert_eq!(runs.erase.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn an_answer_without_a_state_or_action_begins_again() {
    let Harness {
        server,
        relay,
        runs,
    } = harness();
    for extra in [
        json!({ "inputResponses": { "relay": { "action": "accept" } } }),
        json!({ "inputResponses": { "relay": { "action": "maybe" } }, "requestState": "state-1" }),
        json!({ "inputResponses": { "relay": {} }, "requestState": "state-1" }),
        json!({ "requestState": "state-1" }),
    ] {
        url_elicitation(&erase(&server, json!({ "id": "42" }), extra).await);
    }
    assert_eq!(relay.begins(), 4);
    assert_eq!(relay.resumes(), 0);
    assert_eq!(runs.erase.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a_client_without_url_elicitation_never_gets_the_prompt() {
    let Harness {
        server,
        relay,
        runs,
    } = harness();
    for capabilities in [
        json!({}),
        json!({ "elicitation": {} }),
        json!({ "elicitation": { "form": {} } }),
    ] {
        let response = post(
            &server,
            call(
                "memory-erase",
                json!({ "id": "42" }),
                capabilities.clone(),
                json!({}),
            ),
        )
        .await;
        assert_ne!(
            response["result"]["resultType"], "input_required",
            "{response}"
        );
        let refused = command_result(&response);
        assert_eq!(
            refused["error"]["code"],
            error_codes::CONFIRMATION_REQUIRED,
            "{capabilities}"
        );
        assert!(refused["error"]["suggestion"]
            .as_str()
            .unwrap()
            .contains("URL-mode elicitation"));
        assert!(!relay.last_call().supports_url_elicitation());
    }
    // A pending prompt is held to the same rule.
    relay.answer(RelayOutcome::Pending(RelayPrompt::new(URL, "Waiting", "s")));
    let pending = post(
        &server,
        call(
            "memory-erase",
            json!({ "id": "42" }),
            json!({ "elicitation": { "form": {} } }),
            retry("accept", "state-1"),
        ),
    )
    .await;
    assert_eq!(error_code(&pending), error_codes::CONFIRMATION_REQUIRED);
    assert_eq!(runs.erase.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a_relay_refusal_is_the_result() {
    let Harness {
        server,
        relay,
        runs,
    } = harness();
    *relay.0.refusal.lock().unwrap() = Some(
        CommandError::new(
            error_codes::APPROVAL_REQUIRED,
            "Open the link from a client that can",
        )
        .with_details(std::collections::HashMap::from([(
            "reason".to_owned(),
            json!("url-elicitation-required"),
        )])),
    );
    let refused = command_result(&erase(&server, json!({ "id": "42" }), json!({})).await);
    assert_eq!(refused["error"]["code"], error_codes::APPROVAL_REQUIRED);
    assert_eq!(
        refused["error"]["details"]["reason"],
        "url-elicitation-required"
    );
    assert_eq!(runs.erase.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a_relay_prompt_must_be_https_without_identity() {
    for url in [
        "http://person.example.com/decide",
        "https://alice@person.example.com/decide",
        "person.example.com/decide",
    ] {
        let Harness {
            server,
            relay,
            runs,
        } = harness();
        *relay.0.prompt.lock().unwrap() = Some(RelayPrompt::new(url, "Open", "s"));
        let response = erase(&server, json!({ "id": "42" }), json!({})).await;
        assert_eq!(response["error"]["code"], -32603, "{url}: {response}");
        assert_eq!(response["error"]["message"], "Internal error");
        assert_eq!(runs.erase.load(Ordering::SeqCst), 0);
    }
    // An empty state cannot name a decision either.
    let Harness { server, relay, .. } = harness();
    *relay.0.prompt.lock().unwrap() = Some(RelayPrompt::new(URL, "Open", ""));
    let response = erase(&server, json!({ "id": "42" }), json!({})).await;
    assert_eq!(response["error"]["code"], -32603, "{response}");
}

#[tokio::test]
async fn an_approval_without_a_decision_id_runs_nothing() {
    let Harness {
        server,
        relay,
        runs,
    } = harness();
    relay.answer(RelayOutcome::Approved {
        decision_id: String::new(),
    });
    let response = erase(&server, json!({ "id": "42" }), retry("accept", "state-1")).await;
    assert_eq!(response["error"]["code"], -32603, "{response}");
    assert_eq!(runs.erase.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn batch_and_pipe_steps_are_refused_before_any_step_runs() {
    let Harness {
        server,
        relay,
        runs,
    } = harness_with(Options {
        mode: ConfirmationMode::Enforce,
        ..Options::default()
    });
    let steps = json!([
        { "command": "todo-list", "input": {} },
        { "command": "memory-erase", "input": { "id": "42" } },
    ]);
    // Even acknowledged, and even with a relay answer.
    let batch = post(
        &server,
        call(
            "afd-batch",
            json!({ "commands": steps, "confirm": ["memory-erase"] }),
            url_capabilities(),
            retry("accept", "state-1"),
        ),
    )
    .await;
    let batch = command_result(&batch);
    assert_eq!(batch["success"], false, "{batch}");
    assert_eq!(batch["error"]["code"], error_codes::CONFIRMATION_REQUIRED);
    assert!(batch["error"]["suggestion"]
        .as_str()
        .unwrap()
        .contains("on its own"));
    let pipe = post(
        &server,
        call(
            "afd-pipe",
            json!({ "steps": steps, "confirm": ["memory-erase"] }),
            url_capabilities(),
            json!({}),
        ),
    )
    .await;
    let pipe = command_result(&pipe);
    assert_eq!(pipe["steps"][0]["index"], -1, "{pipe}");
    assert_eq!(
        pipe["steps"][0]["error"]["code"],
        error_codes::CONFIRMATION_REQUIRED
    );
    assert_eq!(runs.list.load(Ordering::SeqCst), 0);
    assert_eq!(runs.erase.load(Ordering::SeqCst), 0);
    assert_eq!((relay.begins(), relay.resumes()), (0, 0));
}

#[tokio::test]
async fn a_2025_request_is_refused_over_http_and_stdio() {
    let Harness {
        server,
        relay,
        runs,
    } = harness();
    let body = json!({
        "jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": { "name": "memory-erase", "arguments": { "id": "42" } },
    });
    let (_, over_http) = http_post(
        &server,
        body,
        &[
            ("mcp-protocol-version", "2025-11-25"),
            ("mcp-name", "memory-erase"),
        ],
    )
    .await;
    let mut stdio = Stdio::connect(server.clone()).await;
    let over_stdio = stdio
        .request(
            "tools/call",
            json!({ "name": "memory-erase", "arguments": { "id": "42" } }),
        )
        .await;
    for response in [over_http, over_stdio] {
        let refused = command_result(&response);
        assert_eq!(
            refused["error"]["code"],
            error_codes::CONFIRMATION_REQUIRED,
            "{response}"
        );
        assert!(refused["error"]["suggestion"]
            .as_str()
            .unwrap()
            .contains("2026-07-28"));
    }
    assert_eq!((relay.begins(), relay.resumes()), (0, 0));
    assert_eq!(runs.erase.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn without_a_relay_every_call_is_refused() {
    let Harness { server, runs, .. } = harness_with(Options {
        relay: None,
        ..Options::default()
    });
    for name in ["memory-erase", "memory-show"] {
        let refused = command_result(
            &post(
                &server,
                call(name, json!({ "id": "42" }), url_capabilities(), json!({})),
            )
            .await,
        );
        assert_eq!(
            refused["error"]["code"],
            error_codes::CONFIRMATION_REQUIRED,
            "{refused}"
        );
        let suggestion = refused["error"]["suggestion"].as_str().unwrap();
        assert!(suggestion.contains("cannot confirm") && suggestion.contains("over MCP"));
    }
    assert_eq!(runs.erase.load(Ordering::SeqCst), 0);
    assert_eq!(runs.list.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn confirmations_off_still_gates_a_command_without_a_prompt() {
    let Harness {
        server,
        relay,
        runs,
    } = harness();
    let asked = post(
        &server,
        call(
            "memory-show",
            json!({ "id": "42" }),
            url_capabilities(),
            json!({}),
        ),
    )
    .await;
    url_elicitation(&asked);
    relay.answer(RelayOutcome::Approved {
        decision_id: "d-show".into(),
    });
    let ran = post(
        &server,
        call(
            "memory-show",
            json!({ "id": "42" }),
            url_capabilities(),
            retry("accept", "state-1"),
        ),
    )
    .await;
    // No approval policy: the decision alone runs it.
    assert_eq!(command_result(&ran)["success"], true, "{ran}");
    assert_eq!(runs.list.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn neither_an_acknowledgement_nor_a_form_answer_confirms() {
    for mode in [ConfirmationMode::Enforce, ConfirmationMode::RequireHuman] {
        let Harness {
            server,
            relay,
            runs,
        } = harness_with(Options {
            mode,
            ..Options::default()
        });
        let form_answer =
            json!({ "confirm": { "action": "accept", "content": { "confirm": true } } });
        for (arguments, extra) in [
            (json!({ "id": "42", "confirm": true }), json!({})),
            (
                json!({ "id": "42" }),
                json!({ "_meta": { "dev.afd/confirm": true } }),
            ),
            (
                json!({ "id": "42" }),
                json!({ "inputResponses": form_answer, "requestState": "state-1" }),
            ),
        ] {
            let response = post(
                &server,
                call(
                    "memory-erase",
                    arguments,
                    json!({ "elicitation": { "form": {}, "url": {} } }),
                    extra,
                ),
            )
            .await;
            // Never run, never a form: the relay is asked instead.
            url_elicitation(&response);
        }
        // `confirm` is input like any other for it, never an acknowledgement: validation drops it
        // as it drops any argument the command does not declare, so the person decides on exactly
        // what runs.
        let digests: Vec<String> = relay
            .0
            .calls
            .lock()
            .unwrap()
            .iter()
            .map(|call| call.input_digest.clone())
            .collect();
        assert_eq!(
            digests[0],
            afd::input_digest(&json!({ "id": "42", "mode": "soft" })).unwrap()
        );
        assert_eq!(relay.begins(), 3);
        assert_eq!(runs.erase.load(Ordering::SeqCst), 0);
    }
}

#[tokio::test]
async fn host_verified_tools_advertise_no_confirm_and_report_the_mode() {
    for strategy in [ToolStrategy::Individual, ToolStrategy::Grouped] {
        let Harness { server, .. } = harness_with(Options {
            mode: ConfirmationMode::Enforce,
            strategy,
            ..Options::default()
        });
        let tools = server.tools();
        if strategy == ToolStrategy::Individual {
            let erase = tools
                .iter()
                .find(|tool| tool["name"] == "memory-erase")
                .unwrap();
            assert!(
                erase["inputSchema"]["properties"].get("confirm").is_none(),
                "{erase}"
            );
            assert_eq!(erase["_meta"]["confirmationMode"], "host-verified");
            let purge = tools
                .iter()
                .find(|tool| tool["name"] == "memory-purge")
                .unwrap();
            assert!(purge["_meta"].get("confirmationMode").is_none(), "{purge}");
        } else {
            let group = tools.iter().find(|tool| tool["name"] == "memory").unwrap();
            assert!(
                group["inputSchema"]["properties"].get("confirm").is_none(),
                "{group}"
            );
            let actions = group["_meta"]["actions"].as_array().unwrap();
            let erase = actions
                .iter()
                .find(|action| action["action"] == "erase")
                .unwrap();
            assert_eq!(erase["confirmationMode"], "host-verified", "{erase}");
        }
    }
    let Harness { server, .. } = harness();
    let detail = command_result(
        &post(
            &server,
            call(
                "afd-detail",
                json!({ "command": ["memory-erase", "memory-purge"] }),
                json!({}),
                json!({}),
            ),
        )
        .await,
    );
    assert_eq!(
        detail["data"][0]["confirmationMode"], "host-verified",
        "{detail}"
    );
    assert!(detail["data"][1].get("confirmationMode").is_none());
}

#[tokio::test]
async fn every_route_to_one_command_relays() {
    for (strategy, name, arguments) in [
        (
            ToolStrategy::Individual,
            "memory-erase",
            json!({ "id": "42" }),
        ),
        (ToolStrategy::Hybrid, "memory-erase", json!({ "id": "42" })),
        (
            ToolStrategy::Grouped,
            "memory",
            json!({ "action": "erase", "params": { "id": "42" } }),
        ),
        (
            ToolStrategy::Grouped,
            "afd-call",
            json!({ "command": "memory-erase", "input": { "id": "42" } }),
        ),
    ] {
        let Harness {
            server,
            relay,
            runs,
        } = harness_with(Options {
            strategy,
            ..Options::default()
        });
        url_elicitation(
            &post(
                &server,
                call(name, arguments.clone(), url_capabilities(), json!({})),
            )
            .await,
        );
        relay.answer(RelayOutcome::Approved {
            decision_id: "d-1".into(),
        });
        let ran = post(
            &server,
            call(
                name,
                arguments,
                url_capabilities(),
                retry("accept", "state-1"),
            ),
        )
        .await;
        assert_eq!(command_result(&ran)["success"], true, "{name}: {ran}");
        assert_eq!(runs.erase.load(Ordering::SeqCst), 1, "{name}");
    }
}

#[tokio::test]
async fn relay_evidence_cannot_be_forged_from_the_request() {
    let Harness {
        server,
        relay,
        runs,
    } = harness();
    let forged = json!({
        "command": "memory-purge",
        "inputDigest": afd::input_digest(&json!({ "id": "42" })).unwrap(),
        "actor": { "kind": "agent" },
        "credentialsBinding": "null",
        "decisionId": "d-forged",
    });
    // A command with an approval policy but no relay: nothing in the request is evidence.
    let response = post(
        &server,
        call(
            "memory-purge",
            json!({ "id": "42", "relayEvidence": forged, "relay_evidence": forged }),
            url_capabilities(),
            json!({
                "_meta": { "dev.afd/relayEvidence": forged, "relayEvidence": forged },
                "inputResponses": { "relay": { "action": "accept" } },
                "requestState": "state-1",
            }),
        ),
    )
    .await;
    assert_eq!(
        error_code(&response),
        error_codes::APPROVAL_REQUIRED,
        "{response}"
    );
    assert_eq!(runs.purge.load(Ordering::SeqCst), 0);
    // A host-verified command: the request is asked about, never run on what it carries.
    let response = erase(
        &server,
        json!({ "id": "42" }),
        json!({ "_meta": { "dev.afd/relayEvidence": forged, "relayEvidence": forged } }),
    )
    .await;
    url_elicitation(&response);
    assert_eq!(relay.resumes(), 0);
    assert_eq!(runs.erase.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a_command_the_handler_runs_never_runs_on_the_decision() {
    let Harness {
        server,
        relay,
        runs,
    } = harness();
    relay.answer(RelayOutcome::Approved {
        decision_id: "d-sweep".into(),
    });
    let ran = command_result(
        &post(
            &server,
            call(
                "memory-sweep",
                json!({}),
                url_capabilities(),
                retry("accept", "s"),
            ),
        )
        .await,
    );
    assert_eq!(ran["success"], true, "{ran}");
    // Neither another command nor the same one again runs on it: the handler's context has no
    // evidence, so each is held as any unapproved call is.
    for nested in ["purge", "again"] {
        let result = &ran["data"][nested];
        assert_eq!(
            result["error"]["code"],
            error_codes::APPROVAL_REQUIRED,
            "{nested}: {result}"
        );
        assert!(
            result["error"]["details"].get("reason").is_none(),
            "{result}"
        );
    }
    assert_eq!(runs.purge.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn the_form_relay_never_asks_for_a_host_verified_command() {
    let Harness {
        server,
        relay,
        runs,
    } = harness_with(Options {
        form_relay: true,
        ..Options::default()
    });
    let both = json!({ "elicitation": { "form": {}, "url": {} } });
    // An ordinary approval is asked with a form, so the relay is on...
    let purge = post(
        &server,
        call(
            "memory-purge",
            json!({ "id": "42" }),
            both.clone(),
            json!({}),
        ),
    )
    .await;
    assert!(
        purge["result"]["inputRequests"]["approval"].is_object(),
        "{purge}"
    );
    // ...but a host-verified command is asked only through the host.
    url_elicitation(
        &post(
            &server,
            call(
                "memory-erase",
                json!({ "id": "42" }),
                both.clone(),
                json!({}),
            ),
        )
        .await,
    );
    relay.answer(RelayOutcome::Approved {
        decision_id: "d-1".into(),
    });
    let ran = post(
        &server,
        call(
            "memory-erase",
            json!({ "id": "42" }),
            both,
            retry("accept", "state-1"),
        ),
    )
    .await;
    assert_eq!(command_result(&ran)["success"], true, "{ran}");
    assert_eq!(runs.erase.load(Ordering::SeqCst), 1);
}

/// A nonce store shared with "the relay", which spends its own key for the same decision.
#[derive(Clone, Default)]
struct SharedStore(Arc<Mutex<Vec<String>>>);

#[async_trait]
impl ApprovalNonceStore for SharedStore {
    async fn consume(&self, nonce: &str, _expires_at: i64) -> bool {
        let mut spent = self.0.lock().unwrap();
        if spent.iter().any(|key| key == nonce) {
            return false;
        }
        spent.push(nonce.to_owned());
        true
    }
}

#[tokio::test]
async fn the_decision_is_spent_under_its_own_prefix_in_a_shared_store() {
    let runs = Arc::new(Runs::default());
    let registry = Arc::new(CommandRegistry::new());
    let mut erase = CommandDefinition::new(
        "memory-erase",
        "Erase a memory",
        vec![CommandParameter::required_string("id", "Memory ID")],
        Count(Arc::clone(&runs), |runs| &runs.erase),
    )
    .with_approval(ApprovalPolicy::Required)
    .with_confirmation_mode(CommandConfirmationMode::HostVerified);
    erase.expose.mcp = true;
    registry.register(erase).unwrap();
    let store = SharedStore::default();
    // The relay already spent the decision under its own key.
    store.0.lock().unwrap().push("d-1".into());
    registry.add_middleware(
        create_approval_middleware(
            ApprovalMiddlewareOptions::new(SECRET, registry.list())
                .with_include_token(false)
                .with_nonce_store(store.clone()),
        )
        .unwrap(),
    );
    let relay = Relay::default();
    let server = McpServer::new(registry, "relay", "1.0.0").with_human_relay(relay.clone());
    relay.answer(RelayOutcome::Approved {
        decision_id: "d-1".into(),
    });
    let ran = post(
        &server,
        call(
            "memory-erase",
            json!({ "id": "42" }),
            url_capabilities(),
            retry("accept", "s"),
        ),
    )
    .await;
    assert_eq!(command_result(&ran)["success"], true, "{ran}");
    assert_eq!(
        *store.0.lock().unwrap(),
        vec!["d-1".to_owned(), "relay:d-1".to_owned()]
    );
}

/// With `server-auth`: the relay sees the verified credentials, and credentials that cannot be
/// bound never reach it.
#[cfg(feature = "server-auth")]
mod with_credentials {
    use super::*;
    use afd::server::auth::{
        AuthRefusal, Authorization, Credentials, ProtectedResource, RuleCode, ScopeDecision,
        ScopeResolver, TokenVerifier,
    };
    use afd::server::HttpOptions;
    use http_body_util::{BodyExt, Full};
    use tower::ServiceExt;

    const RESOURCE: &str = "https://todo.example.com/mcp";

    /// Admits a token `<issuer host>.<subject>.<clientId>` (`-` for an empty issuer).
    struct ByToken;

    #[async_trait]
    impl TokenVerifier for ByToken {
        async fn verify(
            &self,
            token: &str,
            _request: &http::request::Parts,
        ) -> Result<Credentials, AuthRefusal> {
            let mut parts = token.split('.');
            match (parts.next(), parts.next(), parts.next()) {
                (Some(issuer), Some(subject), Some(client)) => Ok(Credentials::new(
                    if issuer == "-" {
                        String::new()
                    } else {
                        format!("https://{issuer}.example.com")
                    },
                    subject,
                    client,
                    RESOURCE,
                    1_700_000_000,
                    4_000_000_000,
                )),
                _ => Err(AuthRefusal::new(RuleCode::UnknownIssuer)),
            }
        }
    }

    async fn post_with(server: &McpServer, body: Value, token: &str) -> Value {
        let service = server
            .authorized_http_service(HttpOptions::default())
            .unwrap();
        let request = http::Request::post("/mcp")
            .header("host", "localhost")
            .header("content-type", "application/json")
            .header("accept", "application/json, text/event-stream")
            .header("mcp-protocol-version", "2026-07-28")
            .header("mcp-method", "tools/call")
            .header("mcp-name", "memory-erase")
            .header("authorization", format!("Bearer {token}"))
            .body(Full::new(bytes::Bytes::from(body.to_string())))
            .unwrap();
        let response = service.oneshot(request).await.unwrap();
        assert_eq!(response.status(), 200);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let text = String::from_utf8_lossy(&bytes).to_string();
        serde_json::from_str(&text).unwrap_or_else(|_| {
            text.lines()
                .find_map(|line| line.strip_prefix("data: "))
                .and_then(|data| serde_json::from_str(data).ok())
                .unwrap()
        })
    }

    fn authorized() -> Harness {
        let Harness {
            server,
            relay,
            runs,
        } = harness();
        let authorization = Authorization::new(
            ProtectedResource::new(RESOURCE, ["https://auth.example.com"]).unwrap(),
            ByToken,
        )
        .unwrap();
        Harness {
            server: server.with_authorization(authorization),
            relay,
            runs,
        }
    }

    #[tokio::test]
    async fn the_relay_sees_the_verified_credentials() {
        let Harness {
            server,
            relay,
            runs,
        } = authorized();
        let body = call(
            "memory-erase",
            json!({ "id": "42" }),
            url_capabilities(),
            json!({}),
        );
        url_elicitation(&post_with(&server, body, "auth.user-1.todo-agent").await);
        let seen = relay.last_call();
        let credentials = seen.credentials.as_ref().unwrap();
        assert_eq!(credentials.subject, "user-1");
        assert_eq!(credentials.client_id, "todo-agent");
        assert_eq!(
            seen.principal_binding().unwrap(),
            r#"{"actor":{"id":"todo-agent","kind":"agent","onBehalfOf":"user-1"},"credentials":{"clientId":"todo-agent","issuer":"https://auth.example.com","subject":"user-1"}}"#
        );
        relay.answer(RelayOutcome::Approved {
            decision_id: "d-1".into(),
        });
        let body = call(
            "memory-erase",
            json!({ "id": "42" }),
            url_capabilities(),
            retry("accept", "state-1"),
        );
        let ran = post_with(&server, body, "auth.user-1.todo-agent").await;
        assert_eq!(command_result(&ran)["success"], true, "{ran}");
        assert_eq!(runs.erase.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn incomplete_credentials_never_reach_the_relay() {
        let Harness {
            server,
            relay,
            runs,
        } = authorized();
        for token in ["-.user-1.todo-agent", "auth..todo-agent", "auth.user-1."] {
            for extra in [json!({}), retry("accept", "state-1")] {
                relay.answer(RelayOutcome::Approved {
                    decision_id: "d-1".into(),
                });
                let body = call(
                    "memory-erase",
                    json!({ "id": "42" }),
                    url_capabilities(),
                    extra,
                );
                let response = post_with(&server, body, token).await;
                assert_eq!(response["error"]["code"], -32603, "{token}: {response}");
                assert_eq!(response["error"]["message"], "Internal error");
            }
        }
        assert_eq!((relay.begins(), relay.resumes()), (0, 0));
        assert_eq!(runs.erase.load(Ordering::SeqCst), 0);
    }

    /// A soft erase needs `memory:soft`, which no test token holds; `mode` defaults to `soft`.
    struct SoftNeedsScope;

    impl ScopeResolver for SoftNeedsScope {
        fn resolve(&self, command: &str, input: &Value, _: &Credentials) -> ScopeDecision {
            if command == "memory-erase" && input["mode"] == "soft" {
                return ScopeDecision::Missing(vec!["memory:soft".to_owned()]);
            }
            ScopeDecision::Allowed
        }

        fn visible(&self, _command: &str, _credentials: &Credentials) -> bool {
            true
        }
    }

    #[tokio::test]
    async fn a_missing_scope_on_the_validated_input_never_reaches_the_relay() {
        let Harness {
            server,
            relay,
            runs,
        } = harness();
        let authorization = Authorization::new(
            ProtectedResource::new(RESOURCE, ["https://auth.example.com"]).unwrap(),
            ByToken,
        )
        .unwrap()
        .with_resolver(SoftNeedsScope);
        let server = server.with_authorization(authorization);
        // The input as sent names no mode, so it passes before dispatch; its default needs the
        // scope, so the call is refused before anyone is asked.
        for extra in [json!({}), retry("accept", "state-1")] {
            relay.answer(RelayOutcome::Approved {
                decision_id: "d-1".into(),
            });
            let body = call(
                "memory-erase",
                json!({ "id": "42" }),
                url_capabilities(),
                extra,
            );
            let refused = command_result(&post_with(&server, body, "auth.user-1.todo-agent").await);
            assert_eq!(
                refused["error"]["code"],
                error_codes::INSUFFICIENT_SCOPE,
                "{refused}"
            );
            assert_eq!(
                refused["error"]["details"]["scopes"],
                json!(["memory:soft"])
            );
        }
        assert_eq!((relay.begins(), relay.resumes()), (0, 0));
        assert_eq!(runs.erase.load(Ordering::SeqCst), 0);
        // A hard erase needs no such scope and is asked about.
        let body = call(
            "memory-erase",
            json!({ "id": "42", "mode": "hard" }),
            url_capabilities(),
            json!({}),
        );
        url_elicitation(&post_with(&server, body, "auth.user-1.todo-agent").await);
        assert_eq!(relay.begins(), 1);
    }
}
