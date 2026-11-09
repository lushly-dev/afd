//! A command a resolver hides from a caller is unknown to it on every route, before validation
//! (`spec/authorization.md`, M6, "Hidden commands"; Umbel phase 5's follow-up of 2026-11-08).
//!
//! Each answer is compared with the answer of a twin server whose registry does not have the
//! hidden commands at all: the same HTTP status, challenge and JSON-RPC body (only times and
//! trace IDs blanked), and the same questions put to the resolver before dispatch. The hidden
//! commands each carry a check that would answer otherwise if reached: a required parameter
//! (validation), a confirmation prompt, a host-verified relay and a task, and a middleware counts
//! every execution.
#![cfg(feature = "server-auth")]

mod common;

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use afd::server::auth::{Authorization, Credentials, ScopeDecision, ScopeResolver};
use afd::server::{
    ConfirmationMode, HumanRelay, InMemoryTaskStore, McpServer, RelayCall, RelayOutcome,
    RelayPrompt, TaskChange, TaskOwner, TaskRecord, TaskStore, TaskStoreError, ToolStrategy,
    TASKS_EXTENSION_ID,
};
use afd::{
    register_bootstrap_commands, success, BoxFuture, CommandConfirmationMode, CommandContext,
    CommandDefinition, CommandError, CommandHandler, CommandMiddleware, CommandParameter,
    CommandRegistry, CommandResult, MiddlewareNext, TaskSupport,
};
use async_trait::async_trait;
use common::auth::*;
use common::{command_result, Stdio};
use serde_json::{json, Map, Value};

/// The commands the caller without `secret:see` must not learn of.
const HIDDEN: [&str; 4] = ["notes-read", "vault-open", "vault-seal", "vault-sync"];

/// What ran: handlers by name, and every name the middleware saw.
#[derive(Default)]
struct Seen {
    handled: Mutex<Vec<String>>,
    middleware: Mutex<Vec<String>>,
    relay_begins: AtomicUsize,
    /// The prefix of each call's trace ID, as the context hook saw it.
    traces: Mutex<Vec<String>>,
}

impl Seen {
    fn reached(&self, name: &str) -> bool {
        self.handled.lock().unwrap().iter().any(|seen| seen == name)
            || self
                .middleware
                .lock()
                .unwrap()
                .iter()
                .any(|seen| seen == name)
    }
}

struct Handle(Arc<Seen>, &'static str);

#[async_trait]
impl CommandHandler for Handle {
    async fn execute(&self, input: Value, _context: CommandContext) -> CommandResult<Value> {
        self.0.handled.lock().unwrap().push(self.1.to_owned());
        success(json!({ "ran": self.1, "input": input }))
    }
}

/// Calls `notes-read` in process with its own context, and answers with what it got.
struct Nested(Arc<OnceLock<Arc<CommandRegistry>>>);

#[async_trait]
impl CommandHandler for Nested {
    async fn execute(&self, _input: Value, context: CommandContext) -> CommandResult<Value> {
        let registry = self.0.get().unwrap();
        let inner = registry
            .execute("notes-read", json!({ "space": "a" }), Some(context))
            .await;
        success(json!({ "inner": inner }))
    }
}

/// A relay that counts how often it is asked.
#[derive(Clone)]
struct Relay(Arc<Seen>);

#[async_trait]
impl HumanRelay for Relay {
    async fn begin(&self, _call: &RelayCall) -> Result<RelayPrompt, CommandError> {
        self.0.relay_begins.fetch_add(1, Ordering::SeqCst);
        Ok(RelayPrompt::new(
            "https://todo.example.com/approve",
            "Open the link to approve",
            "state",
        ))
    }

    async fn resume(&self, _state: &str, _call: &RelayCall) -> RelayOutcome {
        RelayOutcome::Invalid
    }
}

/// The registry: `notes-list`, `notes-write` (known but listed only with `notes:write`) and
/// `notes-nested` always; with `hidden`, also `notes-read` (a required `space`), `vault-open`
/// (a confirmation prompt), `vault-seal` (host-verified) and `vault-sync` (only as a task).
fn registry(hidden: bool, seen: &Arc<Seen>) -> Arc<CommandRegistry> {
    let registry = Arc::new(CommandRegistry::new());
    let exposed = |mut command: CommandDefinition| {
        command.expose.mcp = true;
        command
    };
    let handle = |name: &'static str| Handle(Arc::clone(seen), name);
    let space = || vec![CommandParameter::required_string("space", "The space")];
    let reason = || vec![CommandParameter::required_string("reason", "Why")];
    let mut commands = vec![
        // Its `requires` names a hidden command, which only a caller who may see it reads.
        exposed(
            CommandDefinition::new("notes-list", "List notes", vec![], handle("notes-list"))
                .with_requires(["notes-read", "notes-write"]),
        ),
        // In the `notes` group with the action `read`, as `notes-read` is: an ambiguous action
        // for a caller who may see both.
        exposed(
            CommandDefinition::new("memo-read", "Read a memo", vec![], handle("memo-read"))
                .with_category("notes"),
        ),
        exposed(
            CommandDefinition::new(
                "notes-write",
                "Write a note",
                space(),
                handle("notes-write"),
            )
            .as_mutation(),
        ),
    ];
    let cell = Arc::new(OnceLock::new());
    commands.push(exposed(CommandDefinition::new(
        "notes-nested",
        "Read notes in process",
        vec![],
        Nested(Arc::clone(&cell)),
    )));
    if hidden {
        commands.push(exposed(CommandDefinition::new(
            "notes-read",
            "Read notes",
            space(),
            handle("notes-read"),
        )));
        commands.push(exposed(
            CommandDefinition::new(
                "vault-open",
                "Open the vault",
                reason(),
                handle("vault-open"),
            )
            .as_mutation()
            .with_confirm_prompt("Open the vault?"),
        ));
        commands.push(exposed(
            CommandDefinition::new(
                "vault-seal",
                "Seal the vault",
                reason(),
                handle("vault-seal"),
            )
            .as_mutation()
            .with_confirmation_mode(CommandConfirmationMode::HostVerified),
        ));
        commands.push(exposed(
            CommandDefinition::new(
                "vault-sync",
                "Sync the vault",
                reason(),
                handle("vault-sync"),
            )
            .with_task(TaskSupport::Required),
        ));
    }
    for command in commands {
        registry.register(command).unwrap();
    }
    register_bootstrap_commands(&registry).unwrap();
    let seen = Arc::clone(seen);
    let middleware: CommandMiddleware = Arc::new(
        move |name: String,
              _input: Value,
              _context: CommandContext,
              next: MiddlewareNext|
              -> BoxFuture<'static, CommandResult<Value>> {
            seen.middleware.lock().unwrap().push(name);
            next()
        },
    );
    registry.add_middleware(middleware);
    cell.set(Arc::clone(&registry)).ok();
    registry
}

fn sees(credentials: &Credentials) -> bool {
    credentials.has_scope("secret:see")
}

/// Hides [`HIDDEN`] from a caller without `secret:see`, and keeps `notes-write` known but off
/// the listings without `notes:write`, which `resolve` names: a command the caller may step up
/// to.
struct Hiding;

impl ScopeResolver for Hiding {
    fn resolve(&self, command: &str, _input: &Value, credentials: &Credentials) -> ScopeDecision {
        if command == "notes-write" && !credentials.has_scope("notes:write") {
            return ScopeDecision::Missing(vec!["notes:write".to_owned()]);
        }
        ScopeDecision::Allowed
    }

    fn visible(&self, command: &str, credentials: &Credentials) -> bool {
        self.known(command, credentials)
            && (command != "notes-write" || credentials.has_scope("notes:write"))
    }

    fn known(&self, command: &str, credentials: &Credentials) -> bool {
        !HIDDEN.contains(&command) || sees(credentials)
    }
}

/// Hides [`HIDDEN`] through `visible` alone, so `known` takes its default.
struct ByDefault;

impl ScopeResolver for ByDefault {
    fn resolve(&self, _command: &str, _input: &Value, _credentials: &Credentials) -> ScopeDecision {
        ScopeDecision::Allowed
    }

    fn visible(&self, command: &str, credentials: &Credentials) -> bool {
        !HIDDEN.contains(&command) || sees(credentials)
    }
}

/// Lists every command (`visible` always holds) while [`HIDDEN`] is not known: a command that
/// does not exist for the caller is never listed, whatever `visible` says.
struct Contrary;

impl ScopeResolver for Contrary {
    fn resolve(&self, _command: &str, _input: &Value, _credentials: &Credentials) -> ScopeDecision {
        ScopeDecision::Allowed
    }

    fn visible(&self, _command: &str, _credentials: &Credentials) -> bool {
        true
    }

    fn known(&self, command: &str, credentials: &Credentials) -> bool {
        !HIDDEN.contains(&command) || sees(credentials)
    }
}

/// Records every question `resolve` is asked, then answers as `inner`.
struct Recording<R> {
    inner: R,
    asked: Arc<Mutex<Vec<(String, Value)>>>,
}

impl<R: ScopeResolver> ScopeResolver for Recording<R> {
    fn resolve(&self, command: &str, input: &Value, credentials: &Credentials) -> ScopeDecision {
        self.asked
            .lock()
            .unwrap()
            .push((command.to_owned(), input.clone()));
        self.inner.resolve(command, input, credentials)
    }

    fn visible(&self, command: &str, credentials: &Credentials) -> bool {
        self.inner.visible(command, credentials)
    }

    fn known(&self, command: &str, credentials: &Credentials) -> bool {
        self.inner.known(command, credentials)
    }
}

/// One server under test, with what it saw.
struct Served {
    server: McpServer,
    seen: Arc<Seen>,
    asked: Arc<Mutex<Vec<(String, Value)>>>,
}

impl Served {
    fn new(hidden: bool, strategy: ToolStrategy, resolver: impl ScopeResolver + 'static) -> Self {
        Self::with(hidden, strategy, |auth| auth.with_resolver(resolver))
    }

    fn with(
        hidden: bool,
        strategy: ToolStrategy,
        configure: impl FnOnce(Authorization) -> Authorization,
    ) -> Self {
        let seen = Arc::new(Seen::default());
        let traced = Arc::clone(&seen);
        // The tokens' clock, so a task does not outlive its token before it starts.
        let mut server = McpServer::new(registry(hidden, &seen), "notes", "1.0.0")
            .with_clock(afd::fixed_clock(NOW * 1000))
            .with_tool_strategy(strategy)
            .with_confirmations(ConfirmationMode::Enforce)
            .with_human_relay(Relay(Arc::clone(&seen)))
            .with_context_hook(move |_request, context: CommandContext| {
                let prefix = context
                    .trace_id
                    .as_deref()
                    .and_then(|trace| trace.split('-').next())
                    .unwrap_or_default()
                    .to_owned();
                traced.traces.lock().unwrap().push(prefix);
                async move { Ok(context) }
            });
        if strategy == ToolStrategy::Hybrid {
            let mut first: Vec<&str> = vec!["notes-list", "notes-write"];
            if hidden {
                first.extend(["notes-read", "vault-open"]);
            }
            server = server.with_first_class_tools(first);
        }
        Self {
            server: server.with_authorization(configure(authorization())),
            seen,
            asked: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// The server and its twin without the hidden commands, both deciding with `make()`'s
    /// resolver behind a recorder, with filtered listings.
    fn pair<R: ScopeResolver + 'static>(strategy: ToolStrategy, make: fn() -> R) -> (Self, Self) {
        let build = |hidden| {
            let asked = Arc::new(Mutex::new(Vec::new()));
            let recording = Recording {
                inner: make(),
                asked: Arc::clone(&asked),
            };
            let mut served = Self::with(hidden, strategy, |auth| {
                auth.with_resolver(recording)
                    .with_filter_tools_by_scope(true)
            });
            served.asked = asked;
            served
        };
        (build(true), build(false))
    }

    async fn send(&self, method: &str, params: Value, meta: &Value, token: &str) -> Answer {
        self.asked.lock().unwrap().clear();
        self.seen.traces.lock().unwrap().clear();
        send(&self.server, post_with(method, params, meta, token)).await
    }

    fn traces(&self) -> Vec<String> {
        self.seen.traces.lock().unwrap().clone()
    }

    fn asked(&self) -> Vec<(String, Value)> {
        self.asked.lock().unwrap().clone()
    }
}

/// [`post`] with `meta` as the request's `_meta`.
fn post_with(
    method: &str,
    params: Value,
    meta: &Value,
    token: &str,
) -> http::Request<http_body_util::Full<bytes::Bytes>> {
    let mut request = post(method, params.clone(), Some(token));
    // A `tasks/*` request names its task in `Mcp-Name`.
    if let Some(id) = params["taskId"].as_str() {
        request
            .headers_mut()
            .insert("mcp-name", http::HeaderValue::from_str(id).unwrap());
    }
    let mut body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
    body["params"]["_meta"] = meta.clone();
    *request.body_mut() = http_body_util::Full::new(bytes::Bytes::from(body.to_string()));
    request
}

/// Plain 2026-07-28 `_meta`, and one declaring form and URL elicitation and the Tasks extension,
/// so a confirmation, a relay or a task could be started.
fn metas() -> [Value; 2] {
    let plain: Value = serde_json::from_str(common::META).unwrap();
    let mut capable = plain.clone();
    capable["io.modelcontextprotocol/clientCapabilities"] = json!({
        "elicitation": { "form": {}, "url": {} },
        "extensions": { TASKS_EXTENSION_ID: {} },
    });
    [plain, capable]
}

/// `value` with every time and trace ID blanked: the only parts of two answers allowed to differ.
fn steady(value: &Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(key, value)| {
                    let volatile = key.ends_with("At")
                        || key.ends_with("Ms")
                        || key == "traceId"
                        || key == "timestamp";
                    let value = if volatile { Value::Null } else { steady(value) };
                    (key.clone(), value)
                })
                .collect::<Map<_, _>>(),
        ),
        Value::Array(items) => Value::Array(items.iter().map(steady).collect()),
        Value::String(text) => match serde_json::from_str::<Value>(text) {
            // A tool result's text content is the result as JSON.
            Ok(parsed @ Value::Object(_)) => Value::String(steady(&parsed).to_string()),
            _ => value.clone(),
        },
        _ => value.clone(),
    }
}

/// Assert two answers are the same to the caller.
fn assert_same(hidden: &Answer, absent: &Answer, label: &str) {
    assert_eq!(hidden.status, absent.status, "{label}: {}", hidden.text);
    assert_eq!(hidden.challenge(), absent.challenge(), "{label}");
    assert_eq!(
        hidden.headers.get("content-type"),
        absent.headers.get("content-type"),
        "{label}"
    );
    assert_eq!(steady(&hidden.body), steady(&absent.body), "{label}");
}

fn reader() -> String {
    token_with_scope(Some("todo:read"))
}

fn seer() -> String {
    token_with_scope(Some("todo:read secret:see notes:write"))
}

fn call(name: &str, arguments: Option<Value>) -> Value {
    match arguments {
        Some(arguments) => json!({ "name": name, "arguments": arguments }),
        None => json!({ "name": name }),
    }
}

/// The inputs each hidden command is sent: valid, invalid and none.
fn inputs(command: &str) -> [Option<Value>; 3] {
    match command {
        "notes-read" => [
            Some(json!({ "space": "a" })),
            Some(json!({ "space": 5 })),
            None,
        ],
        _ => [
            Some(json!({ "reason": "x" })),
            Some(json!({ "reason": 5, "confirm": true })),
            None,
        ],
    }
}

/// `input` as a meta-tool's `input` member: left out for none.
fn with_input(mut object: Value, key: &str, input: &Option<Value>) -> Value {
    if let Some(input) = input {
        object[key] = input.clone();
    }
    object
}

/// Every request naming `command` with `input`, on every route `strategy` serves.
fn requests(strategy: ToolStrategy, command: &str, input: &Option<Value>) -> Vec<(String, Value)> {
    let mut requests = vec![
        ("direct".to_owned(), call(command, input.clone())),
        (
            "afd-call".to_owned(),
            call(
                "afd-call",
                Some(with_input(json!({ "command": command }), "input", input)),
            ),
        ),
        (
            "afd-batch".to_owned(),
            call(
                "afd-batch",
                Some(json!({ "commands": [
                    { "command": "notes-list" },
                    with_input(json!({ "command": command }), "input", input),
                ] })),
            ),
        ),
        (
            "afd-batch confirm".to_owned(),
            call(
                "afd-batch",
                Some(json!({
                    "commands": [with_input(json!({ "command": command }), "input", input)],
                    "confirm": [command],
                })),
            ),
        ),
        (
            "afd-pipe".to_owned(),
            call(
                "afd-pipe",
                Some(json!({ "steps": [
                    { "command": "notes-list" },
                    with_input(json!({ "command": command }), "input", input),
                ] })),
            ),
        ),
        (
            "afd-detail".to_owned(),
            call("afd-detail", Some(json!({ "command": command }))),
        ),
        (
            "afd-schema".to_owned(),
            call("afd-schema", Some(json!({ "command": command }))),
        ),
        (
            "afd-docs".to_owned(),
            call("afd-docs", Some(json!({ "command": command }))),
        ),
    ];
    if strategy == ToolStrategy::Grouped {
        let (group, action) = command.split_once('-').unwrap();
        requests.push((
            "grouped action".to_owned(),
            call(
                group,
                Some(with_input(json!({ "action": action }), "params", input)),
            ),
        ));
        requests.push(("grouped, no action".to_owned(), call(group, input.clone())));
    }
    requests
}

const STRATEGIES: [ToolStrategy; 4] = [
    ToolStrategy::Individual,
    ToolStrategy::Grouped,
    ToolStrategy::Lazy,
    ToolStrategy::Hybrid,
];

async fn assert_unknown_everywhere<R: ScopeResolver + 'static>(make: fn() -> R) {
    let token = reader();
    for strategy in STRATEGIES {
        let (main, twin) = Served::pair(strategy, make);
        for meta in metas() {
            for command in HIDDEN {
                for input in inputs(command) {
                    for (route, params) in requests(strategy, command, &input) {
                        let label = format!("{strategy:?} {route} {command} {input:?}");
                        let hidden = main.send("tools/call", params.clone(), &meta, &token).await;
                        let (hidden_asked, hidden_traces) = (main.asked(), main.traces());
                        let absent = twin.send("tools/call", params, &meta, &token).await;
                        assert_same(&hidden, &absent, &label);
                        // The resolver is asked the same questions: a grouped action naming a
                        // hidden command is decided as an unknown action is.
                        assert_eq!(hidden_asked, twin.asked(), "{label}");
                        // And never about the hidden command (nor the twin about its missing
                        // name): a name that does not exist for the caller needs only the
                        // required scopes.
                        assert!(
                            hidden_asked.iter().all(|(asked, _)| asked != command),
                            "{label}: {hidden_asked:?}"
                        );
                        // And the host's hook sees the same trace: a group of hidden commands is
                        // a tool that does not exist.
                        assert_eq!(hidden_traces, twin.traces(), "{label}");
                    }
                }
            }
            // The listings and the describing tools without a name.
            for (method, params) in [
                ("tools/list", json!({})),
                ("tools/call", call("afd-discover", Some(json!({})))),
                (
                    "tools/call",
                    call("afd-help", Some(json!({ "format": "full" }))),
                ),
                ("tools/call", call("afd-docs", Some(json!({})))),
                ("tools/call", call("afd-schema", Some(json!({})))),
                ("tools/call", call("vault", Some(json!({})))),
            ] {
                let label = format!("{strategy:?} {method} {params}");
                let hidden = main.send(method, params.clone(), &meta, &token).await;
                let hidden_traces = main.traces();
                let absent = twin.send(method, params, &meta, &token).await;
                assert_same(&hidden, &absent, &label);
                assert_eq!(hidden_traces, twin.traces(), "{label}");
            }
        }
        for command in HIDDEN {
            assert!(!main.seen.reached(command), "{strategy:?}: {command} ran");
        }
        assert_eq!(main.seen.relay_begins.load(Ordering::SeqCst), 0);
    }
}

#[tokio::test]
async fn a_hidden_command_answers_as_one_that_does_not_exist_on_every_route() {
    assert_unknown_everywhere(|| Hiding).await;
}

#[tokio::test]
async fn known_defaults_to_visible() {
    assert_unknown_everywhere(|| ByDefault).await;
}

#[tokio::test]
async fn a_command_that_is_not_known_is_never_listed_even_when_visible() {
    assert_unknown_everywhere(|| Contrary).await;
}

#[tokio::test]
async fn a_caller_who_may_see_the_command_keeps_every_check() {
    let token = seer();
    let [_, capable] = metas();
    for strategy in STRATEGIES {
        let (main, _) = Served::pair(strategy, || Hiding);
        let result = |answer: &Answer| command_result(&answer.body);
        // Validation runs: invalid and missing input.
        for input in [Some(json!({ "space": 5 })), None] {
            let answer = main
                .send("tools/call", call("notes-read", input), &capable, &token)
                .await;
            assert_eq!(
                result(&answer)["error"]["code"],
                "VALIDATION_ERROR",
                "{strategy:?}: {}",
                answer.text
            );
        }
        let answer = main
            .send(
                "tools/call",
                call("notes-read", Some(json!({ "space": "a" }))),
                &capable,
                &token,
            )
            .await;
        assert_eq!(
            result(&answer)["data"]["ran"],
            "notes-read",
            "{}",
            answer.text
        );
        // The confirmation is asked, the relay is begun, and a task is created.
        let asked = main
            .send(
                "tools/call",
                call("vault-open", Some(json!({ "reason": "x" }))),
                &capable,
                &token,
            )
            .await;
        assert_eq!(
            asked.body["result"]["resultType"], "input_required",
            "{strategy:?}: {}",
            asked.text
        );
        main.send(
            "tools/call",
            call("vault-seal", Some(json!({ "reason": "x" }))),
            &capable,
            &token,
        )
        .await;
        assert_eq!(
            main.seen.relay_begins.load(Ordering::SeqCst),
            1,
            "{strategy:?}"
        );
        let task = main
            .send(
                "tools/call",
                call("vault-sync", Some(json!({ "reason": "x" }))),
                &capable,
                &token,
            )
            .await;
        assert_eq!(
            task.body["result"]["resultType"], "task",
            "{strategy:?}: {}",
            task.text
        );
        // `memo-read` and `notes-read` share the grouped action `read`.
        if strategy == ToolStrategy::Grouped {
            let ambiguous = main
                .send(
                    "tools/call",
                    call("notes", Some(json!({ "action": "read" }))),
                    &capable,
                    &token,
                )
                .await;
            assert_eq!(
                result(&ambiguous)["error"]["code"],
                "AMBIGUOUS_ACTION",
                "{}",
                ambiguous.text
            );
        }
        // The listings show them.
        let listed = main
            .send(
                "tools/call",
                call("afd-discover", Some(json!({}))),
                &capable,
                &token,
            )
            .await;
        assert!(listed.text.contains("notes-read"), "{}", listed.text);
    }
}

#[tokio::test]
async fn a_known_command_off_the_listings_still_names_its_missing_scope() {
    let token = reader();
    let [plain, _] = metas();
    for strategy in STRATEGIES {
        let (main, _) = Served::pair(strategy, || Hiding);
        for params in [
            call("notes-write", Some(json!({ "space": "a" }))),
            call(
                "afd-call",
                Some(json!({ "command": "notes-write", "input": { "space": "a" } })),
            ),
        ] {
            let answer = main.send("tools/call", params, &plain, &token).await;
            assert_eq!(answer.status, 403, "{strategy:?}: {}", answer.text);
            assert!(
                answer.challenge().contains("scope=\"notes:write\""),
                "{}",
                answer.challenge()
            );
        }
        // Off the list: its own tool is not listed (grouped and lazy list no command tools).
        let listed = main.send("tools/list", json!({}), &plain, &token).await;
        let names: Vec<&str> = listed.body["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|tool| tool["name"].as_str())
            .collect();
        assert!(!names.contains(&"notes-write"), "{names:?}");
    }
}

#[tokio::test]
async fn a_nested_call_passing_the_context_on_cannot_reach_a_hidden_command() {
    let token = reader();
    let [plain, _] = metas();
    for strategy in STRATEGIES {
        let (main, twin) = Served::pair(strategy, || Hiding);
        for params in [
            call("notes-nested", Some(json!({}))),
            call("afd-call", Some(json!({ "command": "notes-nested" }))),
            call(
                "afd-batch",
                Some(json!({ "commands": [{ "command": "notes-nested" }] })),
            ),
        ] {
            let hidden = main
                .send("tools/call", params.clone(), &plain, &token)
                .await;
            let absent = twin
                .send("tools/call", params.clone(), &plain, &token)
                .await;
            assert!(
                hidden.text.contains("COMMAND_NOT_FOUND"),
                "{strategy:?} {params}: {}",
                hidden.text
            );
            assert_same(&hidden, &absent, &format!("{strategy:?} nested {params}"));
        }
        assert!(!main.seen.reached("notes-read"), "{strategy:?}");
    }
}

/// Names a scope for every hidden command, under the default `known`: AFD never asks it about a
/// command the caller does not know, so it cannot answer one otherwise than a missing name.
struct Naming;

impl ScopeResolver for Naming {
    fn resolve(&self, command: &str, _input: &Value, credentials: &Credentials) -> ScopeDecision {
        if HIDDEN.contains(&command) && !sees(credentials) {
            return ScopeDecision::Missing(vec![format!("secret:{command}")]);
        }
        ScopeDecision::Allowed
    }

    fn visible(&self, command: &str, credentials: &Credentials) -> bool {
        !HIDDEN.contains(&command) || sees(credentials)
    }
}

#[tokio::test]
async fn a_resolver_is_never_asked_about_a_command_the_caller_does_not_know() {
    assert_unknown_everywhere(|| Naming).await;
}

/// `requires` names only commands that exist for the caller: in `afd-help`, `afd-docs` and a
/// grouped tool's `_meta.actions`.
#[tokio::test]
async fn requires_names_only_commands_that_exist_for_the_caller() {
    let [plain, _] = metas();
    let (main, _) = Served::pair(ToolStrategy::Grouped, || Hiding);
    for (token, expected) in [
        (reader(), json!(["notes-write"])),
        (seer(), json!(["notes-read", "notes-write"])),
    ] {
        let help = main
            .send(
                "tools/call",
                call("afd-help", Some(json!({}))),
                &plain,
                &token,
            )
            .await;
        let commands = command_result(&help.body)["data"]["commands"].clone();
        let list = commands
            .as_array()
            .unwrap()
            .iter()
            .find(|command| command["name"] == "notes-list")
            .unwrap()
            .clone();
        assert_eq!(list["requires"], expected, "{list}");
        let listed = main.send("tools/list", json!({}), &plain, &token).await;
        let notes = listed.body["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .find(|tool| tool["name"] == "notes")
            .unwrap()
            .clone();
        let action = notes["_meta"]["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|action| action["command"] == "notes-list")
            .unwrap()
            .clone();
        assert_eq!(action["requires"], expected, "{action}");
        let docs = main
            .send(
                "tools/call",
                call("afd-docs", Some(json!({ "command": "notes-list" }))),
                &plain,
                &token,
            )
            .await;
        let markdown = command_result(&docs.body)["data"]["markdown"].to_string();
        assert_eq!(
            markdown.contains("`notes-read`"),
            expected.to_string().contains("notes-read"),
            "{markdown}"
        );
    }
}

/// Servers that do not hide: no resolver, unfiltered listings, or no credentials. The hidden
/// command validates its input there as before.
#[tokio::test]
async fn servers_that_do_not_hide_are_unchanged() {
    let token = reader();
    let [plain, _] = metas();
    let invalid = call("notes-read", Some(json!({ "space": 5 })));
    let code = |answer: &Answer| command_result(&answer.body)["error"]["code"].clone();
    // A resolver, but unfiltered listings.
    let unfiltered = Served::new(true, ToolStrategy::Individual, Hiding);
    let answer = unfiltered
        .send("tools/call", invalid.clone(), &plain, &token)
        .await;
    assert_eq!(code(&answer), "VALIDATION_ERROR", "{}", answer.text);
    // Filtered listings under the static rule.
    let static_rule = Served::with(true, ToolStrategy::Individual, |auth| {
        auth.with_filter_tools_by_scope(true)
    });
    let answer = static_rule
        .send("tools/call", invalid.clone(), &plain, &token)
        .await;
    assert_eq!(code(&answer), "VALIDATION_ERROR", "{}", answer.text);
    // No credentials: a trusted transport.
    let (main, _) = Served::pair(ToolStrategy::Individual, || Hiding);
    let mut client = Stdio::connect_modern(main.server.with_trusted_transport());
    let mut params = invalid;
    params["_meta"] = plain;
    let response = client.request("tools/call", params).await;
    let result: Value =
        serde_json::from_str(response["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(result["error"]["code"], "VALIDATION_ERROR", "{response}");
}

/// `afd-help` on a hybrid server names only the first-class tools the caller's list shows.
#[tokio::test]
async fn afd_help_names_only_first_class_tools_the_caller_sees() {
    let [plain, _] = metas();
    let (main, _) = Served::pair(ToolStrategy::Hybrid, || Hiding);
    let help = |token: String| {
        let main = &main;
        let plain = &plain;
        async move {
            let answer = main
                .send(
                    "tools/call",
                    call("afd-help", Some(json!({}))),
                    plain,
                    &token,
                )
                .await;
            command_result(&answer.body)["data"]["firstClassTools"].clone()
        }
    };
    assert_eq!(help(reader()).await, json!(["notes-list"]));
    assert_eq!(
        help(seer()).await,
        json!(["notes-list", "notes-write", "notes-read", "vault-open"])
    );
}

/// Knows nothing of the context tools without `secret:see`.
struct NoContextTools;

impl ScopeResolver for NoContextTools {
    fn resolve(&self, _command: &str, _input: &Value, _credentials: &Credentials) -> ScopeDecision {
        ScopeDecision::Allowed
    }

    fn visible(&self, command: &str, credentials: &Credentials) -> bool {
        !command.starts_with("afd-context-") || sees(credentials)
    }
}

/// `COMMAND_NOT_IN_CONTEXT` points to the context tools only when they exist for the caller, on
/// the router's routes and the registry's (a batch step).
#[tokio::test]
async fn a_context_refusal_names_context_tools_only_when_they_exist_for_the_caller() {
    let seen = Arc::new(Seen::default());
    let registry = Arc::new(CommandRegistry::new());
    let mut plan = CommandDefinition::new(
        "plan-create",
        "Plan",
        vec![],
        Handle(Arc::clone(&seen), "plan-create"),
    )
    .with_contexts(["planning"]);
    plan.expose.mcp = true;
    registry.register(plan).unwrap();
    let server = McpServer::new(registry, "plans", "1.0.0")
        .with_contexts(vec![
            afd::ContextConfig::new("planning"),
            afd::ContextConfig::new("review"),
        ])
        .unwrap()
        .with_authorization(
            authorization()
                .with_resolver(NoContextTools)
                .with_filter_tools_by_scope(true),
        );
    let mut meta: Value = serde_json::from_str(common::META).unwrap();
    meta["dev.afd/context"] = json!("review");
    for (token, named) in [(reader(), false), (seer(), true)] {
        for params in [
            call("plan-create", Some(json!({}))),
            call("afd-call", Some(json!({ "command": "plan-create" }))),
            call(
                "afd-batch",
                Some(json!({ "commands": [{ "command": "plan-create" }] })),
            ),
        ] {
            let answer = send(
                &server,
                post_with("tools/call", params.clone(), &meta, &token),
            )
            .await;
            let text = command_result(&answer.body).to_string();
            assert!(text.contains("COMMAND_NOT_IN_CONTEXT"), "{params}: {text}");
            assert_eq!(text.contains("afd-context-list"), named, "{params}: {text}");
        }
    }
    assert!(!seen.reached("plan-create"));
}

/// The task a caller who may see `vault-sync` creates, with its id.
async fn sync_task(main: &Served) -> String {
    let [_, capable] = metas();
    let task = main
        .send(
            "tools/call",
            call("vault-sync", Some(json!({ "reason": "x" }))),
            &capable,
            &seer(),
        )
        .await;
    assert_eq!(task.body["result"]["resultType"], "task", "{}", task.text);
    task.body["result"]["taskId"].as_str().unwrap().to_owned()
}

/// `tasks/*` on a task whose command its owner no longer knows (the same issuer, subject and
/// client, now with a token that does not see it) answers exactly as on a task that does not
/// exist, `tasks/cancel` included.
#[tokio::test]
async fn a_task_whose_command_the_owner_no_longer_knows_is_an_unknown_task() {
    let [_, plain] = metas();
    let (main, _) = Served::pair(ToolStrategy::Individual, || Hiding);
    let id = sync_task(&main).await;
    let missing = "q".repeat(26);
    for method in ["tasks/get", "tasks/update", "tasks/cancel"] {
        let params = |id: &str| {
            let mut params = json!({ "taskId": id });
            if method == "tasks/update" {
                params["inputResponses"] = json!({});
            }
            params
        };
        let hidden = main.send(method, params(&id), &plain, &reader()).await;
        let absent = main.send(method, params(&missing), &plain, &reader()).await;
        assert_eq!(
            hidden.body["error"]["code"], -32602,
            "{method}: {}",
            hidden.text
        );
        assert_eq!(hidden.status, absent.status, "{method}");
        assert_eq!(hidden.text, absent.text, "{method}");
    }
    // Its owner, while it may see the command, still finds it.
    let found = main
        .send("tasks/get", json!({ "taskId": id }), &plain, &seer())
        .await;
    assert_eq!(
        found.body["result"]["taskId"],
        id.as_str(),
        "{}",
        found.text
    );
}

/// Flags each task it creates: by then the request that asked for the task may be answered,
/// and anything the host kept only while it was in flight gone.
struct Flagging {
    store: InMemoryTaskStore,
    gone: Arc<AtomicBool>,
}

#[async_trait]
impl TaskStore for Flagging {
    async fn create(&self, record: TaskRecord) -> Result<(), TaskStoreError> {
        self.gone.store(true, Ordering::SeqCst);
        self.store.create(record).await
    }

    async fn get(&self, id: &str, owner: &TaskOwner) -> Result<Option<TaskRecord>, TaskStoreError> {
        self.store.get(id, owner).await
    }

    async fn update(
        &self,
        id: &str,
        owner: &TaskOwner,
        change: TaskChange,
    ) -> Result<(), TaskStoreError> {
        self.store.update(id, owner, change).await
    }

    async fn expire(&self, now: i64) -> Result<u64, TaskStoreError> {
        self.store.expire(now).await
    }
}

/// Knows the hidden commands to a caller with `secret:see` only while `gone` is unset, as a host
/// that looks its caller up among the requests in flight would.
struct InFlight(Arc<AtomicBool>);

impl ScopeResolver for InFlight {
    fn resolve(&self, _command: &str, _input: &Value, _credentials: &Credentials) -> ScopeDecision {
        ScopeDecision::Allowed
    }

    fn visible(&self, command: &str, credentials: &Credentials) -> bool {
        !HIDDEN.contains(&command) || (sees(credentials) && !self.0.load(Ordering::SeqCst))
    }
}

/// A task's runner, which starts once the task is created, runs the command with the answer
/// `known` gave while the request was in flight: it never asks again.
#[tokio::test]
async fn a_task_runs_with_what_existed_when_it_was_created() {
    let gone = Arc::new(AtomicBool::new(false));
    let seen = Arc::new(Seen::default());
    let server = McpServer::new(registry(true, &seen), "notes", "1.0.0")
        .with_clock(afd::fixed_clock(NOW * 1000))
        .with_task_store(Flagging {
            store: InMemoryTaskStore::new(),
            gone: Arc::clone(&gone),
        })
        .with_authorization(
            authorization()
                .with_resolver(InFlight(Arc::clone(&gone)))
                .with_filter_tools_by_scope(true),
        );
    let main = Served {
        server,
        seen: Arc::clone(&seen),
        asked: Arc::new(Mutex::new(Vec::new())),
    };
    sync_task(&main).await;
    assert!(gone.load(Ordering::SeqCst));
    for _ in 0..2000 {
        if seen.reached("vault-sync") {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(2)).await;
    }
    panic!("the task's command never ran");
}
