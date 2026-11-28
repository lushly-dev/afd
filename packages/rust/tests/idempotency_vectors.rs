//! The language-neutral vectors in `spec/vectors/idempotency.json`: idempotency keys
//! (`spec/idempotency.md`).
//!
//! Every case runs but the S7 cases of the other engines (`continues`, `waits`, `cancels`):
//! Rust's engine drops a call at its deadline, so its S7 case is `drops`. The cases that go
//! through the MCP server (the `_meta` key, the meta-tools' `meta` argument, batches and
//! pipelines over MCP, S3's HTTP and stdio surfaces, task runs) need the `server` feature, and the
//! approval case the `approval` feature; without them those cases are skipped and say which
//! feature they need, as do the cases with a deadline (`native`). S3's unbindable credentials run
//! in process: the registry refuses them whatever the transport.

#[cfg(feature = "server")]
mod common;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::time::Duration;

use afd::context_fields::ContextField;
use afd::middleware::{create_retry_middleware, RetryOptions};
use afd::{
    check_idempotency_options, derive_idempotency_key, error_codes, failure, is_idempotency_key,
    success, Actor, ActorKind, BatchCommand, BatchRequest, CancellationSignal, CommandContext,
    CommandDefinition, CommandError, CommandHandler, CommandRegistry, CommandResult, Credentials,
    IdempotencyOptions, IdempotencyRequestKind, IdempotencyReservation, IdempotencyReserveOutcome,
    IdempotencySettlement, IdempotencyStore, IdempotencySupport, InMemoryIdempotencyStore,
    JournalRecorder, ManualClock, MemoryJournalSink, ResultMetadata, AFD_IDEMPOTENCY_KEY_META_KEY,
};
use async_trait::async_trait;
use serde_json::{json, Value};
use tokio::sync::Notify;

/// The S7 cases of the other engines: Rust's engine drops the call (`drops`).
/// A failure the vectors' handlers return as retryable.
const TRANSIENT_ERROR: &str = "TRANSIENT_ERROR";

/// The S7 cases of the other engines.
const OTHER_ENGINES: [&str; 3] = ["continues", "waits", "cancels"];

fn vectors() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../spec/vectors")
        .join("idempotency.json");
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()));
    serde_json::from_str(&text)
        .unwrap_or_else(|error| panic!("{} is not valid JSON: {error}", path.display()))
}

fn section(vectors: &Value, path: &[&str]) -> Vec<Value> {
    let mut section = vectors;
    for key in path {
        section = &section[*key];
    }
    let cases = section
        .as_array()
        .unwrap_or_else(|| panic!("{} is not an array", path.join(".")))
        .clone();
    assert!(!cases.is_empty(), "{} has no cases", path.join("."));
    cases
}

fn title(case: &Value) -> String {
    case["description"]
        .as_str()
        .or_else(|| case["expected"].as_str())
        .unwrap_or("untitled")
        .to_owned()
}

fn skip(section: &str, case: &Value, reason: &str) {
    eprintln!("skipped: {section}: {} ({reason})", title(case));
}

#[test]
fn rust_is_not_a_documented_gap() {
    let vectors = vectors();
    assert!(vectors["gaps"].get("rust").is_none(), "{}", vectors["gaps"]);
    assert_eq!(vectors["metaKey"], AFD_IDEMPOTENCY_KEY_META_KEY);
}

// ═══════════════════════════════════════════════════════════════════════════════
// THE HARNESS: the setup's commands, a case's state and the step's clock
// ═══════════════════════════════════════════════════════════════════════════════

/// A handler's hold: it says it entered, then waits to be released.
#[derive(Default)]
struct Gate {
    entered: Notify,
    release: Notify,
}

/// What one case's handlers share.
#[derive(Default)]
struct CaseState {
    /// The handlers that have started in the case.
    started: AtomicUsize,
    /// Set once `order-flaky` (or a retry case's handler) failed its first run.
    failed_once: AtomicBool,
    /// The key each handler saw, in the order they started.
    seen: Mutex<Vec<Option<String>>>,
    /// The next handler to start waits here (`heldInHandler`).
    hold: Mutex<Option<Arc<Gate>>>,
    /// Handlers outlive their call's deadline (`outlivesDeadline`).
    outlive: AtomicBool,
    /// The registry, for a handler that makes a nested call (K6).
    registry: OnceLock<Weak<CommandRegistry>>,
}

impl CaseState {
    fn runs(&self) -> usize {
        self.started.load(Ordering::SeqCst)
    }

    fn seen(&self) -> Vec<Option<String>> {
        self.seen.lock().unwrap().clone()
    }

    fn hold_next(&self) -> Arc<Gate> {
        let gate = Arc::new(Gate::default());
        *self.hold.lock().unwrap() = Some(Arc::clone(&gate));
        gate
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Behaviour {
    Place,
    Refuse,
    Flaky,
    Timeout,
    Throw,
    ClaimsReplay,
    /// Calls `order-nested` through the registry on its own context (K6).
    Nests,
}

struct Order {
    behaviour: Behaviour,
    state: Arc<CaseState>,
}

fn placed(count: usize) -> CommandResult<Value> {
    success(json!({ "placed": count }))
}

#[async_trait]
impl CommandHandler for Order {
    async fn execute(&self, _input: Value, context: CommandContext) -> CommandResult<Value> {
        let count = self.state.started.fetch_add(1, Ordering::SeqCst) + 1;
        self.state
            .seen
            .lock()
            .unwrap()
            .push(context.idempotency_key.clone());
        let gate = self.state.hold.lock().unwrap().take();
        if let Some(gate) = gate {
            gate.entered.notify_one();
            gate.release.notified().await;
        }
        if self.state.outlive.load(Ordering::SeqCst) {
            tokio::time::sleep(Duration::from_millis(300)).await;
        }
        match self.behaviour {
            Behaviour::Place => placed(count),
            Behaviour::Refuse => {
                failure(CommandError::new(error_codes::CONFLICT, "Refused").with_retryable(false))
            }
            Behaviour::Flaky => {
                if self.state.failed_once.swap(true, Ordering::SeqCst) {
                    placed(count)
                } else {
                    failure(CommandError::new(TRANSIENT_ERROR, "Flaky").with_retryable(true))
                }
            }
            Behaviour::Timeout => failure(
                CommandError::new(error_codes::TIMEOUT, "Timed out downstream")
                    .with_retryable(true),
            ),
            Behaviour::Throw => panic!("order-throw"),
            Behaviour::ClaimsReplay => {
                let mut result = placed(count);
                let mut metadata = ResultMetadata::new();
                metadata
                    .extra
                    .insert("idempotentReplay".into(), Value::Bool(true));
                metadata.extra.insert("note".into(), json!("kept"));
                result.metadata = Some(metadata);
                result
            }
            Behaviour::Nests => {
                let registry = self
                    .state
                    .registry
                    .get()
                    .and_then(Weak::upgrade)
                    .expect("the case's registry");
                let nested = registry
                    .execute("order-nested", json!({ "sku": "n" }), Some(context.clone()))
                    .await;
                assert!(nested.success, "{nested:?}");
                placed(count)
            }
        }
    }
}

fn schema() -> Value {
    json!({
        "type": "object",
        "properties": { "sku": { "type": "string" }, "count": { "type": "integer" } },
        "required": ["sku"],
    })
}

/// One command of the setup, or a test's own declaration.
struct Spec<'a> {
    name: &'a str,
    mutation: bool,
    idempotency: Option<IdempotencySupport>,
    approval: bool,
    task: bool,
    behaviour: Behaviour,
}

fn idempotency_of(value: &Value) -> Option<IdempotencySupport> {
    match value.as_str() {
        Some("natural") => Some(IdempotencySupport::Natural),
        Some("keyed") => Some(IdempotencySupport::Keyed),
        None => None,
        Some(other) => panic!("unknown idempotency {other}"),
    }
}

fn define(spec: &Spec<'_>, state: &Arc<CaseState>) -> CommandDefinition {
    let mut command = CommandDefinition::new(
        spec.name,
        "A vector command",
        Vec::new(),
        Order {
            behaviour: spec.behaviour,
            state: Arc::clone(state),
        },
    )
    .with_expose(afd::ExposeOptions::new().with_mcp(true));
    if spec.mutation {
        command = command.as_mutation();
    }
    if let Some(idempotency) = spec.idempotency {
        command = command.with_idempotency(idempotency);
    }
    if spec.approval {
        command = command.with_approval(afd::ApprovalPolicy::Required);
    }
    if spec.task {
        command = command.with_task(afd::TaskSupport::Optional);
    }
    command
}

fn behaviour_of(name: &str) -> Behaviour {
    match name {
        "order-refuse" => Behaviour::Refuse,
        "order-flaky" => Behaviour::Flaky,
        "order-timeout" => Behaviour::Timeout,
        "order-throw" => Behaviour::Throw,
        "order-claims-replay" => Behaviour::ClaimsReplay,
        _ => Behaviour::Place,
    }
}

/// A store that cancels a call's signal while it reserves (`cancelledDuringReserve`), over the
/// default store.
#[derive(Default)]
struct HarnessStore {
    inner: InMemoryIdempotencyStore,
    cancel_on_reserve: Mutex<Option<CancellationSignal>>,
}

#[async_trait]
impl IdempotencyStore for HarnessStore {
    async fn reserve(
        &self,
        scope: &str,
        request: IdempotencyReservation,
        now: i64,
    ) -> Result<IdempotencyReserveOutcome, String> {
        let cancel = self.cancel_on_reserve.lock().unwrap().take();
        if let Some(signal) = cancel {
            signal.cancel();
        }
        self.inner.reserve(scope, request, now).await
    }

    async fn complete(
        &self,
        scope: &str,
        reservation: &str,
        settlement: IdempotencySettlement,
    ) -> Result<(), String> {
        self.inner.complete(scope, reservation, settlement).await
    }

    async fn release(&self, scope: &str, reservation: &str) -> Result<(), String> {
        self.inner.release(scope, reservation).await
    }

    async fn get(&self, scope: &str, now: i64) -> Result<Option<afd::IdempotencyRecord>, String> {
        self.inner.get(scope, now).await
    }
}

/// One case's world: the registry with the setup's commands, the step on the harness's clock,
/// and what the handlers share.
struct World {
    registry: Arc<CommandRegistry>,
    state: Arc<CaseState>,
    clock: ManualClock,
    store: Arc<HarnessStore>,
}

#[cfg(feature = "approval")]
const APPROVAL_SECRET: &str = "a-test-secret-of-at-least-32-bytes-long!";

fn step_world(vectors: &Value, with_step: bool) -> World {
    let setup = &vectors["step"]["setup"];
    let state = Arc::new(CaseState::default());
    let registry = Arc::new(CommandRegistry::new());
    for command in setup["commands"].as_array().unwrap() {
        let name = command["name"].as_str().unwrap();
        let spec = Spec {
            name,
            mutation: command["mutation"] == true,
            idempotency: idempotency_of(&command["idempotency"]),
            approval: command["approval"] == "required",
            task: command["task"] == "optional",
            behaviour: behaviour_of(name),
        };
        registry
            .register_with_schema(define(&spec, &state), schema())
            .unwrap();
    }
    for spec in [
        Spec {
            name: "order-nests",
            mutation: true,
            idempotency: None,
            approval: false,
            task: false,
            behaviour: Behaviour::Nests,
        },
        Spec {
            name: "order-nested",
            mutation: true,
            idempotency: Some(IdempotencySupport::Keyed),
            approval: false,
            task: false,
            behaviour: Behaviour::Place,
        },
    ] {
        registry
            .register_with_schema(define(&spec, &state), schema())
            .unwrap();
    }
    registry
        .set_context_fields(vec![ContextField::new(
            "project",
            "dev.example/project",
            json!({ "type": "string" }),
        )])
        .unwrap();
    #[cfg(feature = "approval")]
    registry.add_middleware(
        afd::create_approval_middleware(afd::ApprovalMiddlewareOptions::from_secret(
            APPROVAL_SECRET,
        ))
        .unwrap(),
    );
    let clock = ManualClock::default();
    let store = Arc::new(HarnessStore::default());
    if with_step {
        let options = &setup["options"];
        registry
            .set_idempotency(
                IdempotencyOptions::new()
                    .with_ttl_ms(options["ttlMs"].as_u64().unwrap())
                    .with_lease_ms(options["leaseMs"].as_u64().unwrap())
                    .with_clock(Arc::new(clock.clone()))
                    .with_store(Arc::clone(&store) as Arc<dyn IdempotencyStore>),
            )
            .unwrap();
    }
    state.registry.set(Arc::downgrade(&registry)).ok();
    World {
        registry,
        state,
        clock,
        store,
    }
}

fn actor(vectors: &Value, name: &Value) -> Option<Actor> {
    let name = match name {
        Value::Null => return None,
        Value::String(name) => name.as_str(),
        _ => "agent",
    };
    let actor = &vectors["step"]["setup"]["actors"][name];
    Some(Actor::new(ActorKind::Agent).with_id(actor["id"].as_str().unwrap()))
}

/// The context of one in-process call of a case.
fn call_context(vectors: &Value, call: &Value) -> CommandContext {
    let mut context = CommandContext::new();
    // A call without an `actor` member is the setup's `agent`.
    let actor_name = call.get("actor").cloned().unwrap_or(json!("agent"));
    context.actor = actor(vectors, &actor_name);
    if let Some(key) = call["key"].as_str() {
        context = context.with_idempotency_key(key);
    }
    if let Some(fields) = call["context"].as_object() {
        for (name, value) in fields {
            context.extra.insert(name.clone(), value.clone());
        }
    }
    if let Some(timeout) = call["timeoutMs"].as_u64() {
        context = context.with_timeout(timeout);
    }
    context
}

fn input_of(call: &Value) -> Value {
    if call["inputNotCanonical"] == true {
        // An integer beyond 2^53, which a 64-bit float cannot hold: no canonical form.
        return json!({ "sku": "a", "count": 9_007_199_254_740_993_u64 });
    }
    call["input"].clone()
}

fn as_json(result: &CommandResult<Value>) -> Value {
    serde_json::to_value(result).unwrap()
}

/// Check one call's result against its `expect`.
fn check(result: &Value, expect: &Value, at: &str) {
    if let Some(success) = expect.get("success") {
        assert_eq!(&result["success"], success, "{at}: success: {result}");
    }
    if let Some(data) = expect.get("data") {
        assert_eq!(&result["data"], data, "{at}: data: {result}");
    }
    if let Some(replay) = expect.get("replay") {
        let replayed = result["metadata"]["idempotentReplay"] == true;
        assert_eq!(replayed, replay == true, "{at}: replay: {result}");
        if replay == false {
            assert!(
                result["metadata"].get("idempotentReplay").is_none(),
                "{at}: a first result carries no marker: {result}"
            );
        }
    }
    if let Some(code) = expect.get("code") {
        assert_eq!(&result["error"]["code"], code, "{at}: code: {result}");
    }
    if let Some(retryable) = expect.get("retryable") {
        assert_eq!(
            &result["error"]["retryable"], retryable,
            "{at}: retryable: {result}"
        );
    }
    if let Some(recovery) = expect.get("recovery") {
        match recovery {
            Value::Null => assert!(
                result["error"].get("recovery").is_none(),
                "{at}: no recovery: {result}"
            ),
            _ => assert_eq!(
                &result["error"]["recovery"], recovery,
                "{at}: recovery: {result}"
            ),
        }
    }
    if let Some(metadata) = expect.get("metadata").and_then(Value::as_object) {
        for (key, value) in metadata {
            assert_eq!(
                &result["metadata"][key], value,
                "{at}: metadata.{key}: {result}"
            );
        }
    }
    if let Some(meta) = expect.get("detailsMeta") {
        assert_eq!(
            &result["error"]["details"]["meta"], meta,
            "{at}: details.meta: {result}"
        );
    }
    if let Some(reason) = expect.get("detailsReason") {
        assert_eq!(
            &result["error"]["details"]["reason"], reason,
            "{at}: details.reason: {result}"
        );
    }
    if expect["internalError"] == true {
        assert_eq!(
            result["error"]["code"],
            error_codes::INTERNAL_ERROR,
            "{at}: internal error: {result}"
        );
        assert_eq!(
            result["error"]["message"], "Internal error",
            "{at}: {result}"
        );
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DECLARATION (D1, D2) AND THE KEY (K1 TO K6)
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn declaration() {
    let vectors = vectors();
    for case in section(&vectors, &["declaration", "cases"]) {
        let state = Arc::new(CaseState::default());
        let registry = CommandRegistry::new();
        let spec = Spec {
            name: "order-declared",
            mutation: case["command"]["mutation"] == true,
            idempotency: idempotency_of(&case["command"]["idempotency"]),
            approval: false,
            task: false,
            behaviour: Behaviour::Place,
        };
        registry.register(define(&spec, &state)).unwrap();
        let tool = registry.get_tool("order-declared").unwrap();
        let at = title(&case);
        let expect = &case["expect"];
        let meta = tool["_meta"]
            .get("idempotency")
            .cloned()
            .unwrap_or(Value::Null);
        assert_eq!(meta, expect["metaIdempotency"], "{at}: {tool}");
        let hint = tool["annotations"]
            .get("idempotentHint")
            .cloned()
            .unwrap_or(Value::Null);
        assert_eq!(hint, expect["idempotentHint"], "{at}: {tool}");
    }
}

#[test]
fn key_form() {
    let vectors = vectors();
    for case in section(&vectors, &["key", "form"]) {
        let key = match case["repeat"].as_str() {
            Some(repeat) => json!(repeat.repeat(case["times"].as_u64().unwrap() as usize)),
            None => case["key"].clone(),
        };
        // A key that is not a string is no key of K2's form.
        let valid = key.as_str().is_some_and(is_idempotency_key);
        assert_eq!(json!(valid), case["valid"], "{}", title(&case));
    }
}

#[test]
fn key_derived() {
    let vectors = vectors();
    for case in section(&vectors, &["key", "derived"]) {
        let kind = match case["kind"].as_str().unwrap() {
            "batch" => IdempotencyRequestKind::Batch,
            "pipeline" => IdempotencyRequestKind::Pipeline,
            other => panic!("unknown kind {other}"),
        };
        let derived = derive_idempotency_key(
            case["base"].as_str().unwrap(),
            kind,
            case["index"].as_u64().unwrap() as usize,
        );
        assert_eq!(json!(derived), case["expected"]);
    }
}

#[tokio::test]
async fn key_delivery() {
    let vectors = vectors();
    for case in section(&vectors, &["key", "delivery"]) {
        let world = step_world(&vectors, false);
        let at = title(&case);
        let expect = &case["expect"];
        let via = case["via"].as_str().unwrap();
        let in_process = via == "context" || via == "input";
        if !in_process && !cfg!(feature = "server") {
            skip("key.delivery", &case, "needs the server feature");
            continue;
        }
        let command = if case["nested"] == true {
            "order-nests"
        } else {
            "order-place"
        };
        let result = if in_process {
            let mut context = CommandContext::new();
            let mut input = json!({ "sku": "a" });
            if via == "context" {
                context = context.with_idempotency_key(case["key"].as_str().unwrap());
            } else {
                // An input member with the key's name: the schema drops it, and it is no key.
                input["idempotencyKey"] = case["key"].clone();
            }
            as_json(&world.registry.execute(command, input, Some(context)).await)
        } else {
            #[cfg(feature = "server")]
            {
                server::deliver(&world, &case, command).await
            }
            #[cfg(not(feature = "server"))]
            unreachable!()
        };
        if let Some(keys) = expect.get("handlerSeesKeys") {
            let seen: Vec<Value> = world
                .state
                .seen()
                .into_iter()
                .map(|key| json!(key))
                .collect();
            assert_eq!(&json!(seen), keys, "{at}: {result}");
            continue;
        }
        check(&result, expect, &at);
        if let Some(runs) = expect.get("handlerRuns") {
            assert_eq!(json!(world.state.runs()), *runs, "{at}");
        }
        let seen = world.state.seen();
        if let Some(key) = expect.get("handlerSeesKey") {
            assert_eq!(json!(seen.first().cloned().flatten()), *key, "{at}");
        }
        if let Some(key) = expect.get("nestedHandlerSeesKey") {
            assert_eq!(seen.len(), 2, "{at}: {seen:?}");
            assert_eq!(json!(seen[1]), *key, "{at}");
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// THE ENGINE'S STEP (S1 TO S13)
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn step_options() {
    let vectors = vectors();
    for case in section(&vectors, &["step", "options"]) {
        let checked = check_idempotency_options(
            case["ttlMs"].as_u64().unwrap(),
            case["leaseMs"].as_u64().unwrap(),
            case["defaultTimeoutMs"].as_u64(),
        );
        assert_eq!(
            json!(checked.is_ok()),
            case["valid"],
            "{}: {checked:?}",
            title(&case)
        );
        // The registry refuses the same configurations.
        let registry = CommandRegistry::new();
        registry.set_default_timeout_ms(case["defaultTimeoutMs"].as_u64());
        let set = registry.set_idempotency(
            IdempotencyOptions::new()
                .with_ttl_ms(case["ttlMs"].as_u64().unwrap())
                .with_lease_ms(case["leaseMs"].as_u64().unwrap()),
        );
        assert_eq!(json!(set.is_ok()), case["valid"], "{}", title(&case));
    }
}

/// One in-process call of a step case.
async fn step_call(vectors: &Value, world: &World, call: &Value) -> Value {
    if call["kind"] == "batch" {
        let commands = call["commands"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| BatchCommand::new(item["command"].as_str().unwrap(), item["input"].clone()))
            .collect();
        let batch = world
            .registry
            .execute_batch_with_context(BatchRequest::new(commands), call_context(vectors, call))
            .await;
        return serde_json::to_value(&batch).unwrap();
    }
    let name = call["command"].as_str().unwrap();
    let mut context = call_context(vectors, call);
    if call["cancelledDuringReserve"] == true {
        let signal = CancellationSignal::new();
        *world.store.cancel_on_reserve.lock().unwrap() = Some(signal.clone());
        context = context.with_cancellation(signal);
    }
    if let Some(approved) = call["approved"].as_bool() {
        #[cfg(feature = "approval")]
        {
            let hook: afd::DirectApprovalHook =
                Arc::new(move |_request| Box::pin(async move { Ok(approved) }));
            let client =
                afd::DirectClient::new(Arc::clone(&world.registry)).with_on_approval_needed(hook);
            return as_json(&client.call(name, input_of(call), Some(context)).await);
        }
        #[cfg(not(feature = "approval"))]
        unreachable!("{approved}");
    }
    as_json(
        &world
            .registry
            .execute(name, input_of(call), Some(context))
            .await,
    )
}

fn check_step_call(result: &Value, call: &Value, at: &str) {
    let expect = &call["expect"];
    if let Some(items) = expect["items"].as_array() {
        let results = result["results"].as_array().unwrap();
        assert_eq!(results.len(), items.len(), "{at}: {result}");
        for (index, (item, expect)) in results.iter().zip(items).enumerate() {
            check(&item["result"], expect, &format!("{at}, item {index}"));
        }
        return;
    }
    check(result, expect, at);
}

/// Make the reservation of `seed` and leave it unsettled: its call starts the handler, which
/// waits, and is then dropped. The handler's run is not the case's.
async fn seed(vectors: &Value, world: &World, seed: &Value) {
    world.clock.set(seed["madeAt"].as_i64().unwrap());
    let gate = world.state.hold_next();
    let call = json!({ "key": seed["key"], "actor": seed["actor"] });
    let execution = world.registry.execute(
        seed["command"].as_str().unwrap(),
        seed["input"].clone(),
        Some(call_context(vectors, &call)),
    );
    tokio::select! {
        result = execution => panic!("the seeded call returned: {result:?}"),
        () = gate.entered.notified() => {}
    }
    world.state.started.store(0, Ordering::SeqCst);
    world.state.seen.lock().unwrap().clear();
}

#[tokio::test]
async fn step() {
    let vectors = vectors();
    for case in section(&vectors, &["step", "cases"]) {
        let at = title(&case);
        if let Some(engine) = case["engine"].as_str() {
            if OTHER_ENGINES.contains(&engine) {
                skip("step", &case, &format!("S7 for an engine that {engine}"));
                continue;
            }
            assert_eq!(engine, "drops", "{at}");
        }
        let needs_server = case
            .get("surface")
            .is_some_and(|surface| surface != "http-with-unbindable-credentials")
            || case["calls"]
                .as_array()
                .unwrap()
                .iter()
                .any(|call| call["asTask"] == true);
        if needs_server && !cfg!(feature = "server") {
            skip("step", &case, "needs the server feature");
            continue;
        }
        let needs_deadline = case["calls"]
            .as_array()
            .unwrap()
            .iter()
            .any(|call| call.get("timeoutMs").is_some());
        if needs_deadline && !cfg!(feature = "native") {
            skip("step", &case, "a deadline needs the native feature");
            continue;
        }
        let needs_approval = case["calls"]
            .as_array()
            .unwrap()
            .iter()
            .any(|call| call.get("approved").is_some());
        if needs_approval && !cfg!(feature = "approval") {
            skip("step", &case, "needs the approval feature");
            continue;
        }
        let world = step_world(&vectors, true);
        if needs_server {
            #[cfg(feature = "server")]
            server::step_case(&vectors, &world, &case).await;
        } else {
            run_step_case(&vectors, &world, &case).await;
        }
        assert_eq!(
            json!(world.state.runs()),
            case["handlerRuns"],
            "{at}: handler runs"
        );
    }
}

async fn run_step_case(vectors: &Value, world: &World, case: &Value) {
    let at = title(case);
    if let Some(reservation) = case["seed"].get("reservation") {
        seed(vectors, world, reservation).await;
    }
    if case["surface"] == "http-with-unbindable-credentials" {
        // Credentials M8 cannot bind (an empty subject): the registry refuses them on any
        // transport, as an internal error whose message names no one.
        for (index, call) in case["calls"].as_array().unwrap().iter().enumerate() {
            let context = call_context(vectors, call).with_credentials(Credentials::new(
                "https://auth.example.com",
                "",
                "client",
                "https://api.example.com",
                1,
                4_102_444_800,
            ));
            let result = as_json(
                &world
                    .registry
                    .execute(
                        call["command"].as_str().unwrap(),
                        input_of(call),
                        Some(context),
                    )
                    .await,
            );
            check_step_call(&result, call, &format!("{at}, call {index}"));
        }
        return;
    }
    let calls = case["calls"].as_array().unwrap();
    let mut held: Option<(Arc<Gate>, tokio::task::JoinHandle<Value>, usize)> = None;
    for (index, call) in calls.iter().enumerate() {
        if held.is_some() && call["whileFirstIsHeld"] != true {
            let (gate, first, first_index) = held.take().unwrap();
            gate.release.notify_one();
            let result = first.await.unwrap();
            check_step_call(
                &result,
                &calls[first_index],
                &format!("{at}, call {first_index}"),
            );
        }
        if let Some(time) = call["at"].as_i64() {
            world.clock.set(time);
        }
        world
            .state
            .outlive
            .store(call["outlivesDeadline"] == true, Ordering::SeqCst);
        if call["heldInHandler"] == true {
            let gate = world.state.hold_next();
            let (vectors, registry, call_owned) =
                (vectors.clone(), Arc::clone(&world.registry), call.clone());
            let name = call["command"].as_str().unwrap().to_owned();
            let task = tokio::spawn(async move {
                let context = call_context(&vectors, &call_owned);
                as_json(
                    &registry
                        .execute(&name, input_of(&call_owned), Some(context))
                        .await,
                )
            });
            gate.entered.notified().await;
            held = Some((gate, task, index));
            continue;
        }
        let result = step_call(vectors, world, call).await;
        check_step_call(&result, call, &format!("{at}, call {index}"));
    }
    if let Some((gate, first, first_index)) = held.take() {
        gate.release.notify_one();
        let result = first.await.unwrap();
        check_step_call(
            &result,
            &calls[first_index],
            &format!("{at}, call {first_index}"),
        );
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RETRYING (R1 TO R3)
// ═══════════════════════════════════════════════════════════════════════════════

/// A handler that returns a failure the first time it runs and success after that.
struct FailsOnce {
    code: &'static str,
    state: Arc<CaseState>,
}

#[async_trait]
impl CommandHandler for FailsOnce {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        let count = self.state.started.fetch_add(1, Ordering::SeqCst) + 1;
        if self.state.failed_once.swap(true, Ordering::SeqCst) {
            placed(count)
        } else {
            failure(CommandError::new(self.code, "Failed once").with_retryable(true))
        }
    }
}

fn retry_options(retry_mutations: bool) -> RetryOptions {
    RetryOptions {
        retry_mutations,
        sleep: Some(Arc::new(|_| Box::pin(async {}))),
        ..RetryOptions::default()
    }
}

fn retry_command(case: &Value, state: &Arc<CaseState>) -> CommandDefinition {
    let code = match case["handlerFailsWith"].as_str() {
        Some("TIMEOUT") => error_codes::TIMEOUT,
        _ => TRANSIENT_ERROR,
    };
    let mut command = CommandDefinition::new(
        "order-retry",
        "Fails once",
        Vec::new(),
        FailsOnce {
            code,
            state: Arc::clone(state),
        },
    )
    .with_expose(afd::ExposeOptions::new().with_mcp(true));
    if case["command"]["mutation"] == true {
        command = command.as_mutation();
    }
    if let Some(idempotency) = idempotency_of(&case["command"]["idempotency"]) {
        command = command.with_idempotency(idempotency);
    }
    if case["command"]["task"] == "optional" {
        command = command.with_task(afd::TaskSupport::Optional);
    }
    command
}

#[tokio::test]
async fn retry() {
    let vectors = vectors();
    for case in section(&vectors, &["retry", "cases"]) {
        let at = title(&case);
        if case["asTask"] == true && !cfg!(feature = "server") {
            skip("retry", &case, "needs the server feature");
            continue;
        }
        let state = Arc::new(CaseState::default());
        let registry = Arc::new(CommandRegistry::new());
        registry
            .register_with_schema(retry_command(&case, &state), schema())
            .unwrap();
        let middleware =
            create_retry_middleware(retry_options(case["retryMutations"] == true)).unwrap();
        if case["withStep"] == true {
            registry.set_idempotency(IdempotencyOptions::new()).unwrap();
        }
        let expect = &case["expect"];
        let result = if case["declarationUnreadable"] == true {
            // Outside the registry's call, the middleware cannot read the declaration.
            let handler = Arc::new(retry_command(&case, &state));
            let next: afd::MiddlewareNext = Arc::new(move |context| {
                let handler = Arc::clone(&handler);
                Box::pin(async move { handler.execute(json!({ "sku": "a" }), context).await })
            });
            as_json(
                &middleware(
                    "order-retry".into(),
                    Arc::new(json!({ "sku": "a" })),
                    CommandContext::new(),
                    next,
                )
                .await,
            )
        } else if case["asTask"] == true {
            registry.add_middleware(middleware);
            #[cfg(feature = "server")]
            {
                server::task_call(&registry, "order-retry", "k1").await
            }
            #[cfg(not(feature = "server"))]
            unreachable!()
        } else {
            registry.add_middleware(middleware);
            let mut context = CommandContext::new().with_actor(ActorKind::Agent);
            if case["key"] == true {
                context = context.with_idempotency_key("k1");
            }
            as_json(
                &registry
                    .execute("order-retry", json!({ "sku": "a" }), Some(context))
                    .await,
            )
        };
        check(&result, expect, &at);
        assert_eq!(json!(state.runs()), expect["handlerRuns"], "{at}: {result}");
    }
}

/// A handler that outlives its call's deadline.
struct Outlives;

#[async_trait]
impl CommandHandler for Outlives {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        tokio::time::sleep(Duration::from_millis(300)).await;
        success(json!({ "placed": 1 }))
    }
}

#[tokio::test]
async fn timeout_recovery() {
    let vectors = vectors();
    for case in section(&vectors, &["timeoutRecovery", "cases"]) {
        let at = title(&case);
        if !cfg!(feature = "native") {
            skip(
                "timeoutRecovery",
                &case,
                "a deadline needs the native feature",
            );
            continue;
        }
        let registry = CommandRegistry::new();
        let mut command = CommandDefinition::new("order-slow", "Outlives", Vec::new(), Outlives);
        if case["command"]["mutation"] == true {
            command = command.as_mutation();
        }
        if let Some(idempotency) = idempotency_of(&case["command"]["idempotency"]) {
            command = command.with_idempotency(idempotency);
        }
        registry.register_with_schema(command, schema()).unwrap();
        if case["withStep"] != false {
            registry.set_idempotency(IdempotencyOptions::new()).unwrap();
        }
        let mut context = CommandContext::new()
            .with_actor(ActorKind::Agent)
            .with_timeout(20);
        if case["key"] == true {
            context = context.with_idempotency_key("k1");
        }
        let result = as_json(
            &registry
                .execute("order-slow", json!({ "sku": "a" }), Some(context))
                .await,
        );
        check(&result, &case["expect"], &at);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// THE JOURNAL
// ═══════════════════════════════════════════════════════════════════════════════

/// The context digest's hash of a call with only an actor, the registry's clock and random
/// source and, when given, an idempotency key: `spec/journal.md`'s formula, with
/// `"idempotencyKey": <key>` as a member and its name left out of `keys`.
fn digest_hash(actor: &Value, key: Option<&str>) -> String {
    use sha2::Digest;
    let mut hashed = json!({
        "actor": actor,
        "interface": null,
        "keys": ["clock", "random"],
        "traceId": null,
    });
    if let Some(key) = key {
        hashed["idempotencyKey"] = json!(key);
    }
    let text = serde_json::to_string(&hashed).unwrap();
    let digest = sha2::Sha256::digest(text.as_bytes());
    let hex: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
    format!("sha256:{hex}")
}

#[tokio::test]
async fn journal() {
    let vectors = vectors();
    for case in section(&vectors, &["journal", "cases"]) {
        let at = title(&case);
        let expect = &case["expect"];
        let world = step_world(&vectors, false);
        let sink = Arc::new(MemoryJournalSink::new());
        world
            .registry
            .set_journal(JournalRecorder::new(Arc::clone(&sink) as _));
        let mut context = CommandContext::new().with_actor(ActorKind::Agent);
        if let Some(key) = case["key"].as_str() {
            context = context.with_idempotency_key(key);
        }
        if case["kind"] == "batch" {
            let items = case["items"].as_u64().unwrap() as usize;
            let commands = (0..items)
                .map(|index| {
                    BatchCommand::new("order-place", json!({ "sku": format!("s{index}") }))
                })
                .collect();
            world
                .registry
                .execute_batch_with_context(BatchRequest::new(commands), context)
                .await;
        } else {
            let result = world
                .registry
                .execute("order-place", json!({ "sku": "a" }), Some(context))
                .await;
            assert!(result.success, "{at}: {result:?}");
        }
        let entries = sink.entries();
        if let Some(key) = expect.get("entryIdempotencyKey") {
            assert_eq!(entries.len(), 1, "{at}");
            let entry = serde_json::to_value(&entries[0]).unwrap();
            assert_eq!(
                entry.get("idempotencyKey").cloned().unwrap_or(Value::Null),
                *key,
                "{at}: {entry}"
            );
            if expect["digestHashHasMember"] == true {
                let actor = json!({ "kind": "agent" });
                assert_eq!(
                    entries[0].context_digest.hash,
                    digest_hash(&actor, key.as_str()),
                    "{at}"
                );
                assert_ne!(entries[0].context_digest.hash, digest_hash(&actor, None));
            }
        }
        if let Some(keys) = expect.get("entryIdempotencyKeys") {
            let recorded: Vec<Value> = entries
                .iter()
                .map(|entry| json!(entry.idempotency_key))
                .collect();
            assert_eq!(&json!(recorded), keys, "{at}");
        }
        if case["replay"] == true {
            let replayed = step_world(&vectors, false);
            let report = afd::replay_journal(
                &replayed.registry,
                &entries,
                afd::ReplayJournalOptions::default(),
            )
            .await;
            let seen: Vec<Value> = replayed
                .state
                .seen()
                .into_iter()
                .map(|key| json!(key))
                .collect();
            if let Some(key) = expect.get("handlerSeesKey") {
                assert_eq!(seen, vec![key.clone()], "{at}");
            }
            if let Some(keys) = expect.get("handlerSeesKeys") {
                assert_eq!(&json!(seen), keys, "{at}");
            }
            if let Some(status) = expect["status"].as_str() {
                let report = serde_json::to_value(&report).unwrap();
                assert_eq!(report["entries"][0]["status"], status, "{at}: {report}");
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// THE MCP SERVER'S SURFACES
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(feature = "server")]
mod server {
    use super::*;
    use afd::server::{McpServer, ToolStrategy, TASKS_EXTENSION_ID};
    use common::Stdio;

    fn meta(key: Option<&Value>, tasks: bool) -> Value {
        let mut meta: Value = serde_json::from_str(common::META).unwrap();
        if let Some(key) = key {
            meta[AFD_IDEMPOTENCY_KEY_META_KEY] = key.clone();
        }
        if tasks {
            meta["io.modelcontextprotocol/clientCapabilities"] =
                json!({ "extensions": { TASKS_EXTENSION_ID: {} } });
        }
        meta
    }

    fn server(registry: &Arc<CommandRegistry>) -> McpServer {
        McpServer::new(Arc::clone(registry), "idempotency-vectors", "0.0.0")
            .with_tool_strategy(ToolStrategy::Individual)
    }

    fn tool_call(name: &str, arguments: Value, meta: Value) -> Value {
        json!({ "name": name, "arguments": arguments, "_meta": meta })
    }

    /// K1 and K4 over MCP: `_meta`, the `meta` argument, `afd-batch` and `afd-pipe`.
    pub(super) async fn deliver(world: &World, case: &Value, command: &str) -> Value {
        let key = case.get("key");
        let mut client = Stdio::connect_modern(server(&world.registry));
        let params = match (case["via"].as_str().unwrap(), case["kind"].as_str()) {
            ("meta", Some("batch")) => {
                let items = case["items"].as_u64().unwrap();
                let commands: Vec<Value> = (0..items)
                    .map(|index| json!({ "command": command, "input": { "sku": format!("s{index}") } }))
                    .collect();
                tool_call(
                    "afd-batch",
                    json!({ "commands": commands }),
                    meta(key, false),
                )
            }
            ("meta", Some("pipeline")) => {
                let items = case["items"].as_u64().unwrap();
                let steps: Vec<Value> = (0..items)
                    .map(|index| json!({ "command": command, "input": { "sku": format!("s{index}") } }))
                    .collect();
                tool_call("afd-pipe", json!({ "steps": steps }), meta(key, false))
            }
            ("meta", _) => tool_call(command, json!({ "sku": "a" }), meta(key, false)),
            ("meta-argument", _) => tool_call(
                "afd-call",
                json!({
                    "command": command,
                    "input": { "sku": "a" },
                    "meta": { AFD_IDEMPOTENCY_KEY_META_KEY: key },
                }),
                meta(None, false),
            ),
            (via, _) => panic!("unknown via {via}"),
        };
        let response = client.request("tools/call", params).await;
        common::command_result(&response)
    }

    /// The step cases that need the server: S3's surfaces and task runs (S11).
    pub(super) async fn step_case(vectors: &Value, world: &World, case: &Value) {
        let at = title(case);
        let calls = case["calls"].as_array().unwrap();
        match case["surface"].as_str() {
            Some("http-without-credentials") => {
                let server = server(&world.registry);
                for (index, call) in calls.iter().enumerate() {
                    let response = common::modern_post_with_meta(
                        &server,
                        "tools/call",
                        json!({ "name": call["command"], "arguments": call["input"] }),
                        json!({ AFD_IDEMPOTENCY_KEY_META_KEY: call["key"] }),
                        &[],
                    )
                    .await;
                    check_step_call(
                        &common::command_result(&response),
                        call,
                        &format!("{at}, call {index}"),
                    );
                }
            }
            Some("two-stdio-connections") => {
                // Two servers over one registry, so one step and one store: each serves its own
                // connection, as `serve_stdio` does.
                let mut connections = [
                    Stdio::connect_modern(server(&world.registry)),
                    Stdio::connect_modern(server(&world.registry)),
                ];
                for (index, call) in calls.iter().enumerate() {
                    assert!(call["actor"].is_null(), "{at}: an anonymous caller");
                    let connection = call["connection"].as_u64().unwrap() as usize - 1;
                    let response = connections[connection]
                        .request(
                            "tools/call",
                            tool_call(
                                call["command"].as_str().unwrap(),
                                call["input"].clone(),
                                meta(call.get("key"), false),
                            ),
                        )
                        .await;
                    check_step_call(
                        &common::command_result(&response),
                        call,
                        &format!("{at}, call {index}"),
                    );
                }
            }
            None => {
                for (index, call) in calls.iter().enumerate() {
                    assert_eq!(call["asTask"], true, "{at}");
                    let result = task_call(
                        &world.registry,
                        call["command"].as_str().unwrap(),
                        call["key"].as_str().unwrap(),
                    )
                    .await;
                    check_step_call(&result, call, &format!("{at}, call {index}"));
                }
            }
            Some(surface) => panic!("{at}: unknown surface {surface}"),
        }
        let _ = vectors;
    }

    /// S3 and K5 on stdio: an actor an auth middleware sets, after the server saw the call,
    /// scopes the key; two connections with that actor share it.
    #[tokio::test]
    async fn an_actor_a_middleware_sets_scopes_the_key_not_the_connection() {
        let state = Arc::new(CaseState::default());
        let registry = Arc::new(CommandRegistry::new());
        let spec = Spec {
            name: "order-place",
            mutation: true,
            idempotency: Some(IdempotencySupport::Keyed),
            approval: false,
            task: false,
            behaviour: Behaviour::Place,
        };
        registry
            .register_with_schema(define(&spec, &state), schema())
            .unwrap();
        registry.set_idempotency(IdempotencyOptions::new()).unwrap();
        registry.add_middleware(Arc::new(|_name, _input, context, next| {
            Box::pin(async move {
                next(context.with_actor(Actor::new(ActorKind::Agent).with_id("advisor"))).await
            })
        }));
        let call = || {
            tool_call(
                "order-place",
                json!({ "sku": "a" }),
                meta(Some(&json!("k1")), false),
            )
        };
        let mut first = Stdio::connect_modern(server(&registry));
        let placed = common::command_result(&first.request("tools/call", call()).await);
        assert_eq!(placed["data"], json!({ "placed": 1 }), "{placed}");
        let mut second = Stdio::connect_modern(server(&registry));
        let again = common::command_result(&second.request("tools/call", call()).await);
        assert_eq!(
            again["metadata"]["idempotentReplay"],
            json!(true),
            "{again}"
        );
        assert_eq!(state.runs(), 1);
    }

    /// S3 on stdio: an actor with only a label names no one (M8 binds no label), so two
    /// connections whose middleware sets one keep their keys apart.
    #[tokio::test]
    async fn a_label_alone_does_not_share_a_key_across_connections() {
        let state = Arc::new(CaseState::default());
        let registry = Arc::new(CommandRegistry::new());
        let spec = Spec {
            name: "order-place",
            mutation: true,
            idempotency: Some(IdempotencySupport::Keyed),
            approval: false,
            task: false,
            behaviour: Behaviour::Place,
        };
        registry
            .register_with_schema(define(&spec, &state), schema())
            .unwrap();
        registry.set_idempotency(IdempotencyOptions::new()).unwrap();
        registry.add_middleware(Arc::new(|_name, _input, context, next| {
            Box::pin(async move {
                next(context.with_actor(Actor::new(ActorKind::Agent).with_label("helper"))).await
            })
        }));
        let call = || {
            tool_call(
                "order-place",
                json!({ "sku": "a" }),
                meta(Some(&json!("k1")), false),
            )
        };
        let mut first = Stdio::connect_modern(server(&registry));
        common::command_result(&first.request("tools/call", call()).await);
        let mut second = Stdio::connect_modern(server(&registry));
        let theirs = common::command_result(&second.request("tools/call", call()).await);
        assert!(
            theirs["metadata"].get("idempotentReplay").is_none(),
            "{theirs}"
        );
        assert_eq!(state.runs(), 2);
    }

    /// S8 against the server's default deadline (30 s): a `ttl_ms` the registry accepts, with no
    /// default deadline of its own, is refused by every way of serving it.
    #[test]
    fn the_server_refuses_a_ttl_its_default_deadline_breaks() {
        let registry = Arc::new(CommandRegistry::new());
        registry
            .set_idempotency(
                IdempotencyOptions::new()
                    .with_ttl_ms(40_000)
                    .with_lease_ms(20_000),
            )
            .unwrap();
        let server = server(&registry);
        assert!(server.validate().is_err());
        assert!(server
            .try_streamable_http_service(afd::server::HttpOptions::default())
            .is_err());
        // With the default deadline off, the same options pass.
        assert!(server.with_default_timeout_ms(None).validate().is_ok());
    }

    /// A hook declared to identify HTTP callers for tasks, but not for the step: an `optional`
    /// keyed call with a key and the Tasks extension starts a task, on which the step does not act
    /// (S11). The same call without the extension runs inline, so the step refuses it (S3).
    #[tokio::test]
    async fn a_caller_the_step_cannot_tell_apart_may_still_start_a_task() {
        let world = step_world(&vectors(), true);
        let server = server(&world.registry)
            .with_task_options(afd::server::TaskOptions::new().with_callers_identified_by_hook())
            .with_context_hook(|_request, context| async move {
                Ok(context.with_actor(Actor::new(ActorKind::Agent).with_id("advisor")))
            });
        let call = json!({ "name": "order-task", "arguments": { "sku": "a" } });
        let with_tasks = json!({
            AFD_IDEMPOTENCY_KEY_META_KEY: "k1",
            "io.modelcontextprotocol/clientCapabilities": { "extensions": { TASKS_EXTENSION_ID: {} } },
        });
        let answer =
            common::modern_post_with_meta(&server, "tools/call", call.clone(), with_tasks, &[])
                .await;
        assert_eq!(answer["result"]["resultType"], "task", "{answer}");
        let inline = common::modern_post_with_meta(
            &server,
            "tools/call",
            call,
            json!({ AFD_IDEMPOTENCY_KEY_META_KEY: "k1" }),
            &[],
        )
        .await;
        assert_eq!(
            common::command_result(&inline)["error"]["code"],
            "UNAUTHORIZED",
            "{inline}"
        );
    }

    /// A call that runs as an MCP task over stdio, carrying `key`, and the task's result.
    pub(super) async fn task_call(registry: &Arc<CommandRegistry>, name: &str, key: &str) -> Value {
        let mut client = Stdio::connect_modern(server(registry));
        let key = json!(key);
        let answer = client
            .request(
                "tools/call",
                tool_call(name, json!({ "sku": "a" }), meta(Some(&key), true)),
            )
            .await;
        assert_eq!(answer["result"]["resultType"], "task", "{answer}");
        let id = answer["result"]["taskId"].as_str().unwrap().to_owned();
        for _ in 0..2000 {
            let done = client
                .request(
                    "tasks/get",
                    json!({ "taskId": id, "_meta": meta(None, true) }),
                )
                .await;
            if done["result"]["status"] != "working" {
                return done["result"]["result"]["structuredContent"].clone();
            }
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
        panic!("the task did not finish");
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// THE PROPOSAL'S EXIT CRITERIA AND CONCURRENT CALLS
// ═══════════════════════════════════════════════════════════════════════════════

/// A handler that applies its effect, then outlives its deadline or reports `TIMEOUT` itself.
struct Applies {
    applied: Arc<AtomicUsize>,
    outlives: bool,
}

#[async_trait]
impl CommandHandler for Applies {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        let applied = self.applied.fetch_add(1, Ordering::SeqCst) + 1;
        if self.outlives {
            tokio::time::sleep(Duration::from_millis(300)).await;
            return success(json!({ "applied": applied }));
        }
        failure(
            CommandError::new(error_codes::TIMEOUT, "Timed out downstream").with_retryable(true),
        )
    }
}

fn applies(
    registry: &CommandRegistry,
    idempotency: Option<IdempotencySupport>,
    outlives: bool,
) -> Arc<AtomicUsize> {
    let applied = Arc::new(AtomicUsize::new(0));
    let mut command = CommandDefinition::new(
        "order-apply",
        "Applies its effect",
        Vec::new(),
        Applies {
            applied: Arc::clone(&applied),
            outlives,
        },
    )
    .as_mutation();
    if let Some(idempotency) = idempotency {
        command = command.with_idempotency(idempotency);
    }
    registry.register_with_schema(command, schema()).unwrap();
    applied
}

/// A handler that applies its effect and outlives the deadline is not applied again by a repeat
/// with the same key: the repeat is told the call is in progress within the lease, and that the
/// outcome is unknown after it.
#[cfg(feature = "native")]
#[tokio::test]
async fn a_handler_that_outlives_its_deadline_is_applied_once() {
    let clock = ManualClock::default();
    let registry = CommandRegistry::new();
    let applied = applies(&registry, Some(IdempotencySupport::Keyed), true);
    registry
        .set_idempotency(IdempotencyOptions::new().with_clock(Arc::new(clock.clone())))
        .unwrap();
    let call = || {
        CommandContext::new()
            .with_actor(ActorKind::Agent)
            .with_idempotency_key("k1")
            .with_timeout(20)
    };
    let first = registry
        .execute("order-apply", json!({ "sku": "a" }), Some(call()))
        .await;
    let error = first.error.unwrap();
    assert_eq!(error.code, error_codes::TIMEOUT);
    assert_eq!(
        serde_json::to_value(&error.recovery).unwrap()["kind"],
        "retry"
    );
    for (at, code) in [
        (0, "IDEMPOTENCY_IN_PROGRESS"),
        (60_020, "IDEMPOTENCY_IN_PROGRESS"),
        (60_021, "OUTCOME_UNKNOWN"),
    ] {
        clock.set(at);
        let repeat = registry
            .execute("order-apply", json!({ "sku": "a" }), Some(call()))
            .await;
        assert_eq!(repeat.error.unwrap().code, code, "at {at}");
    }
    assert_eq!(applied.load(Ordering::SeqCst), 1);
}

/// With the retry middleware installed, a `keyed` or undeclared mutation whose handler returns
/// `TIMEOUT` after its effect is applied once, with a key and without; a `natural` one is
/// repeated by design.
#[tokio::test]
async fn the_retry_middleware_does_not_repeat_a_timed_out_mutation() {
    for (idempotency, key, applied_times) in [
        (Some(IdempotencySupport::Keyed), true, 1),
        (Some(IdempotencySupport::Keyed), false, 1),
        (None, true, 1),
        (None, false, 1),
        (Some(IdempotencySupport::Natural), false, 4),
    ] {
        let registry = CommandRegistry::new();
        let applied = applies(&registry, idempotency, false);
        registry.set_idempotency(IdempotencyOptions::new()).unwrap();
        registry.add_middleware(create_retry_middleware(retry_options(false)).unwrap());
        let mut context = CommandContext::new().with_actor(ActorKind::Agent);
        if key {
            context = context.with_idempotency_key("k1");
        }
        let result = registry
            .execute("order-apply", json!({ "sku": "a" }), Some(context))
            .await;
        assert!(!result.success);
        assert_eq!(
            applied.load(Ordering::SeqCst),
            applied_times,
            "{idempotency:?}, key {key}: {result:?}"
        );
    }
}

/// Of many concurrent calls with one key on a multi-threaded runtime, exactly one runs the
/// handler; the others are told it is in progress, or get its result once it is stored.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_calls_with_one_key_run_the_handler_once() {
    let state = Arc::new(CaseState::default());
    let registry = Arc::new(CommandRegistry::new());
    let spec = Spec {
        name: "order-place",
        mutation: true,
        idempotency: Some(IdempotencySupport::Keyed),
        approval: false,
        task: false,
        behaviour: Behaviour::Place,
    };
    registry
        .register_with_schema(define(&spec, &state), schema())
        .unwrap();
    registry.set_idempotency(IdempotencyOptions::new()).unwrap();
    let calls: Vec<_> = (0..64)
        .map(|_| {
            let registry = Arc::clone(&registry);
            tokio::spawn(async move {
                let context = CommandContext::new()
                    .with_actor(ActorKind::Agent)
                    .with_idempotency_key("k1");
                registry
                    .execute("order-place", json!({ "sku": "a" }), Some(context))
                    .await
            })
        })
        .collect();
    for call in calls {
        let result = call.await.unwrap();
        match &result.error {
            None => assert_eq!(result.data, Some(json!({ "placed": 1 }))),
            Some(error) => assert_eq!(error.code, "IDEMPOTENCY_IN_PROGRESS"),
        }
    }
    assert_eq!(state.runs(), 1);
}
