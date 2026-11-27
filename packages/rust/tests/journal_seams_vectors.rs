//! The language-neutral vectors in `spec/vectors/journal-seams.json`: the dispatch id
//! (`spec/dispatch.md`, "The dispatch id") and the approval summary (`spec/command-metadata.md`,
//! "The approval summary").
//!
//! Every case runs. The approval summary needs the `approval` feature, and its relay and
//! elicitation cases the `server` feature too; without them those cases are skipped and say
//! which feature they need. A language listed in the file's `gaps` skips every case with its
//! issue as the reason; Rust is not listed.

use std::collections::{BTreeSet, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock, Weak};

use afd::{
    failure, success, BatchRequest, CommandContext, CommandDefinition, CommandError,
    CommandExecutor, CommandHandler, CommandMiddleware, CommandRegistry, CommandResult,
    JournalRecorder, MemoryJournalSink, PipelineRequest, RandomSource,
};
use async_trait::async_trait;
use serde_json::{json, Value};

fn load_vectors(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../spec/vectors")
        .join(name);
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()));
    serde_json::from_str(&text)
        .unwrap_or_else(|error| panic!("{} is not valid JSON: {error}", path.display()))
}

fn vectors() -> Value {
    load_vectors("journal-seams.json")
}

fn cases<'a>(vectors: &'a Value, section: &str) -> &'a Vec<Value> {
    vectors[section]["cases"]
        .as_array()
        .unwrap_or_else(|| panic!("{section}.cases"))
}

fn description(case: &Value) -> &str {
    case["description"].as_str().expect("description")
}

/// The issue Rust is listed under in the file's `gaps`, if it is: every case is then skipped
/// with it as the reason, as for any language that does not implement the file yet.
fn rust_gap(vectors: &Value) -> Option<&str> {
    vectors["gaps"]["rust"].as_str()
}

#[test]
fn rust_is_not_a_documented_gap() {
    assert_eq!(
        rust_gap(&vectors()),
        None,
        "Rust implements journal-seams.json"
    );
}

#[test]
fn the_id_format_is_stated() {
    let vectors = vectors();
    let format = &vectors["dispatchId"]["format"];
    assert_eq!(format["length"], 22);
    assert_eq!(format["pattern"], "^[A-Za-z0-9_-]{21}[AQgw]$");
}

/// The format's pattern, checked by hand: 21 base64url characters, then one of `AQgw`.
fn well_formed(id: &str) -> bool {
    let base64url = |c: char| c.is_ascii_alphanumeric() || c == '-' || c == '_';
    id.len() == 22 && id.chars().take(21).all(base64url) && id.ends_with(['A', 'Q', 'g', 'w'])
}

/// Whether `value` has a member named for the dispatch id, or holds one of `ids`, at any depth.
fn holds_id(value: &Value, ids: &BTreeSet<String>) -> bool {
    match value {
        Value::String(text) => ids.contains(text),
        Value::Array(items) => items.iter().any(|item| holds_id(item, ids)),
        Value::Object(members) => members.iter().any(|(name, member)| {
            name == "dispatchId" || name == "dispatch_id" || holds_id(member, ids)
        }),
        _ => false,
    }
}

// ─── The dispatch id ────────────────────────────────────────────────────────────────────────

/// What the readers noted in one case.
#[derive(Default)]
struct Notes {
    /// `(reader, dispatch id)`, in the order read.
    ids: Mutex<Vec<(&'static str, Option<String>)>>,
    handler_runs: AtomicUsize,
    flaky_runs: AtomicUsize,
    draws: Mutex<Vec<f64>>,
}

impl Notes {
    fn note(&self, reader: &'static str, context: &CommandContext) {
        // The id a reader reads is `context.dispatch_id()`; nothing a middleware put in `extra`
        // under its name reaches a later link either.
        assert!(
            !context.extra.contains_key("dispatch_id") && !context.extra.contains_key("dispatchId"),
            "{reader} saw a dispatch id in extra: {:?}",
            context.extra
        );
        self.ids
            .lock()
            .unwrap()
            .push((reader, context.dispatch_id().map(str::to_owned)));
    }
}

/// The handler of each setup command.
struct Handler {
    kind: &'static str,
    notes: Arc<Notes>,
    registry: Arc<OnceLock<Weak<CommandRegistry>>>,
}

#[async_trait]
impl CommandHandler for Handler {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        self.notes.handler_runs.fetch_add(1, Ordering::SeqCst);
        self.notes.note("handler", &context);
        match self.kind {
            "item-flaky" => {
                if self.notes.flaky_runs.fetch_add(1, Ordering::SeqCst) == 0 {
                    return failure(
                        CommandError::new("TRANSIENT_ERROR", "Try again").with_retryable(true),
                    );
                }
                success(input)
            }
            "item-outer" => {
                let registry = self.registry.get().and_then(Weak::upgrade).unwrap();
                let before = context.dispatch_id().map(str::to_owned);
                let inner = registry
                    .execute("item-echo", json!({}), Some(context.clone()))
                    .await;
                assert!(inner.success, "{inner:?}");
                // The nested call leaves this call's id as it was.
                assert_eq!(context.dispatch_id().map(str::to_owned), before);
                self.notes.note("handler", &context);
                success(json!({}))
            }
            "item-draw" => {
                let value = context.random().next();
                self.notes.draws.lock().unwrap().push(value);
                success(json!({}))
            }
            _ => success(input),
        }
    }
}

/// A random source that returns the case's values in order.
struct Sequence(Mutex<VecDeque<f64>>);

impl RandomSource for Sequence {
    fn next(&self) -> f64 {
        self.0.lock().unwrap().pop_front().expect("a value is left")
    }
}

fn observer(reader: &'static str, notes: &Arc<Notes>) -> CommandMiddleware {
    let notes = Arc::clone(notes);
    Arc::new(move |_name, _input, context, next| {
        notes.note(reader, &context);
        next(context)
    })
}

/// The outer layer a case asks for: an observer, or one that overwrites the id or retries once.
fn outer_layer(kind: &str, notes: &Arc<Notes>) -> CommandMiddleware {
    match kind {
        "overwrite" => Arc::new(|_name, _input, _context, next| {
            // A Rust middleware cannot set the id itself: the nearest it can come is a fresh
            // context with the value in `extra` under the id's name.
            let mut forged = CommandContext::new();
            forged
                .extra
                .insert("dispatch_id".to_owned(), json!("overwritten-by-mw1-0000"));
            forged
                .extra
                .insert("dispatchId".to_owned(), json!("overwritten-by-mw1-0000"));
            next(forged)
        }),
        "retry-once" => {
            let notes = Arc::clone(notes);
            Arc::new(move |_name, _input, context, next| {
                notes.note("mw1", &context);
                Box::pin(async move {
                    let first = next(context.clone()).await;
                    if first.success {
                        return first;
                    }
                    next(context).await
                })
            })
        }
        _ => observer("mw1", notes),
    }
}

struct DispatchHarness {
    registry: Arc<CommandRegistry>,
    notes: Arc<Notes>,
    journal: Option<Arc<MemoryJournalSink>>,
}

fn dispatch_harness(setup: &Value, run: &Value) -> DispatchHarness {
    let notes = Arc::new(Notes::default());
    let registry = Arc::new(CommandRegistry::new());
    let slot = Arc::new(OnceLock::new());
    for command in setup["commands"].as_array().unwrap() {
        let name = command["name"].as_str().unwrap();
        let kind: &'static str = match name {
            "item-flaky" => "item-flaky",
            "item-outer" => "item-outer",
            "item-draw" => "item-draw",
            _ => "item-echo",
        };
        // `item-echo` keeps an optional `id`; the others take no input.
        let schema = if name == "item-echo" {
            json!({ "type": "object", "properties": { "id": { "type": "number" } } })
        } else {
            json!({ "type": "object", "properties": {} })
        };
        let definition = CommandDefinition::new(
            name,
            command["description"].as_str().unwrap(),
            vec![],
            Handler {
                kind,
                notes: Arc::clone(&notes),
                registry: Arc::clone(&slot),
            },
        );
        registry.register_with_schema(definition, schema).unwrap();
    }
    slot.set(Arc::downgrade(&registry)).unwrap();
    registry.add_middleware(outer_layer(
        run["middleware"].as_str().unwrap_or_default(),
        &notes,
    ));
    registry.add_middleware(observer("mw2", &notes));
    let journal = (run["journal"] == true).then(|| {
        let sink = Arc::new(MemoryJournalSink::new());
        registry.set_journal(JournalRecorder::new(
            Arc::clone(&sink) as Arc<dyn afd::JournalSink>
        ));
        sink
    });
    DispatchHarness {
        registry,
        notes,
        journal,
    }
}

/// The context a case's call starts from: its trace id, its `context` values under the Rust
/// spelling, and its random values.
fn case_context(run: &Value) -> CommandContext {
    let mut context = CommandContext::new();
    if let Some(trace) = run["traceId"].as_str() {
        context = context.with_trace_id(trace);
    }
    if let Some(values) = run["context"].as_object() {
        for (name, value) in values {
            let name = if name == "dispatchId" {
                "dispatch_id"
            } else {
                name
            };
            context.extra.insert(name.to_owned(), value.clone());
        }
    }
    if let Some(values) = run["random"].as_array() {
        let values = values.iter().map(|value| value.as_f64().unwrap()).collect();
        context.random = Some(Arc::new(Sequence(Mutex::new(values))));
    }
    context
}

/// Run the case's call, calls, batch or pipeline and return the results.
async fn run_dispatch(harness: &DispatchHarness, run: &Value) -> Vec<CommandResult<Value>> {
    let registry = &harness.registry;
    let command = run["command"].as_str().unwrap_or_default();
    match run["kind"].as_str().unwrap() {
        "call" => vec![
            registry
                .execute(command, run["input"].clone(), Some(case_context(run)))
                .await,
        ],
        "calls" => {
            let mut results = Vec::new();
            for _ in 0..run["count"].as_u64().unwrap() {
                results.push(
                    registry
                        .execute(command, run["input"].clone(), Some(case_context(run)))
                        .await,
                );
            }
            results
        }
        "batch" => {
            let request: BatchRequest =
                serde_json::from_value(json!({ "commands": run["commands"] })).unwrap();
            let batch = registry
                .execute_batch_with_context(request, case_context(run))
                .await;
            assert!(batch.success, "{batch:?}");
            batch.results.into_iter().map(|item| item.result).collect()
        }
        "pipeline" => {
            let request: PipelineRequest =
                serde_json::from_value(json!({ "steps": run["steps"] })).unwrap();
            let registry = Arc::clone(registry);
            let trace = run["traceId"].as_str().map(str::to_owned);
            let executor: CommandExecutor = Arc::new(move |name, input, _pipeline| {
                let registry = Arc::clone(&registry);
                let mut context = CommandContext::new();
                if let Some(trace) = &trace {
                    context = context.with_trace_id(trace.clone());
                }
                Box::pin(async move { registry.execute(&name, input, Some(context)).await })
            });
            let result = afd::execute_pipeline(&request, &executor, None).await;
            result
                .steps
                .into_iter()
                .map(|step| {
                    assert_eq!(step.status, afd::StepStatus::Success, "{step:?}");
                    success(step.data.unwrap_or(Value::Null))
                })
                .collect()
        }
        other => panic!("unknown kind {other}"),
    }
}

/// The context digest's hash computed from `spec/journal.md`'s formula for a call with no actor,
/// interface or trace id whose context holds only the defaults the registry fills (a clock and a
/// random source), so `keys` holds their names and not the id's.
fn expected_digest_hash() -> String {
    use sha2::{Digest, Sha256};
    let canonical = r#"{"actor":null,"interface":null,"keys":["clock","random"],"traceId":null}"#;
    let digest = Sha256::digest(canonical.as_bytes());
    let hex: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
    format!("sha256:{hex}")
}

/// Check one dispatch id case's `expect`; the failures, by description.
async fn check_dispatch_case(setup: &Value, case: &Value) -> Vec<String> {
    let run = &case["run"];
    let expect = &case["expect"];
    let harness = dispatch_harness(setup, run);
    let results = run_dispatch(&harness, run).await;
    let notes = harness.notes.ids.lock().unwrap().clone();
    let mut failures = Vec::new();
    let mut fail = |what: String| failures.push(format!("{}: {what}", description(case)));

    let readers: Option<Vec<&str>> = expect["readers"]
        .as_array()
        .map(|readers| readers.iter().map(|r| r.as_str().unwrap()).collect());
    let read: Vec<Option<String>> = notes
        .iter()
        .filter(|(reader, _)| readers.as_ref().is_none_or(|only| only.contains(reader)))
        .map(|(_, id)| id.clone())
        .collect();
    if let Some(readers) = &readers {
        for reader in readers {
            if !notes.iter().any(|(noted, _)| noted == reader) {
                fail(format!("{reader} noted nothing"));
            }
        }
    }
    if read.iter().any(Option::is_none) {
        fail(format!("a reader read no id: {notes:?}"));
    }
    let ids: BTreeSet<String> = read.iter().flatten().cloned().collect();
    let all_ids: BTreeSet<String> = notes.iter().filter_map(|(_, id)| id.clone()).collect();

    if let Some(runs) = expect["handlerRuns"].as_u64() {
        let ran = harness.notes.handler_runs.load(Ordering::SeqCst) as u64;
        if ran != runs {
            fail(format!("handler ran {ran} times, not {runs}"));
        }
    }
    if let Some(distinct) = expect["distinctIds"].as_u64() {
        if ids.len() as u64 != distinct {
            fail(format!(
                "{} distinct ids, not {distinct}: {notes:?}",
                ids.len()
            ));
        }
    }
    if expect["wellFormed"] == true {
        for id in &ids {
            if !well_formed(id) {
                fail(format!("{id} is not well formed"));
            }
        }
    }
    for never in expect["never"].as_array().into_iter().flatten() {
        if ids.contains(never.as_str().unwrap()) {
            fail(format!("a reader noted {never}"));
        }
    }
    if let Some(succeeded) = expect["success"].as_bool() {
        if results.iter().any(|result| result.success != succeeded) {
            fail(format!("results {results:?}"));
        }
    }
    if !expect["data"].is_null() {
        let data = results[0].data.clone().unwrap_or(Value::Null);
        if data != expect["data"] {
            fail(format!("data {data}"));
        }
    }
    if expect["resultHasId"] == false {
        for result in &results {
            let value = serde_json::to_value(result).unwrap();
            if holds_id(&value, &all_ids) {
                fail(format!("the result carries the id: {value}"));
            }
        }
    }
    if let Some(sink) = &harness.journal {
        let entries = sink.entries();
        if let Some(count) = expect["entries"].as_u64() {
            if entries.len() as u64 != count {
                fail(format!("{} entries", entries.len()));
            }
        }
        for entry in &entries {
            let value = serde_json::to_value(entry).unwrap();
            if expect["entryHasId"] == false && holds_id(&value, &all_ids) {
                fail(format!("the entry carries the id: {value}"));
            }
            if expect["digestHashOmitsId"] == true
                && entry.context_digest.hash != expected_digest_hash()
            {
                fail(format!(
                    "digest hash {} is not {}",
                    entry.context_digest.hash,
                    expected_digest_hash()
                ));
            }
        }
    }
    if let Some(draws) = expect["handlerDraws"].as_array() {
        let drawn = harness.notes.draws.lock().unwrap().clone();
        let expected: Vec<f64> = draws.iter().map(|v| v.as_f64().unwrap()).collect();
        if drawn != expected {
            fail(format!("the handler drew {drawn:?}"));
        }
    }
    failures
}

#[tokio::test]
async fn dispatch_id_cases() {
    let vectors = vectors();
    let cases = cases(&vectors, "dispatchId");
    assert!(!cases.is_empty());
    if let Some(gap) = rust_gap(&vectors) {
        for case in cases {
            eprintln!(
                "skipped: {} (documented Rust gap, {gap})",
                description(case)
            );
        }
        return;
    }
    let setup = &vectors["dispatchId"]["setup"];
    let mut failures = Vec::new();
    for case in cases {
        failures.extend(check_dispatch_case(setup, case).await);
    }
    assert!(failures.is_empty(), "{failures:#?}");
}

#[tokio::test]
async fn a_declared_context_field_cannot_take_the_dispatch_ids_name() {
    for name in ["dispatchId", "dispatch_id"] {
        let registry = CommandRegistry::new();
        let field = afd::context_fields::ContextField::new(
            name,
            "dev.example/run",
            json!({ "type": "string" }),
        );
        assert!(
            registry.set_context_fields(vec![field]).is_err(),
            "{name} was accepted"
        );
    }
}

// ─── The approval summary ───────────────────────────────────────────────────────────────────

#[cfg(feature = "approval")]
mod summary {
    use super::*;
    use afd::CommandParameter;
    use afd::{
        approval_id, create_approval_middleware, fixed_clock, Actor, ApprovalMiddlewareOptions,
        ApprovalNonceStore, ApprovalPolicy, ApprovalReplay, ApprovalRequest, ApprovalSummary,
        DirectClient,
    };

    pub const TTL_MS: i64 = 300_000;

    /// What one case observed.
    #[derive(Default)]
    pub struct Seen {
        /// `hook` and `handler`, in the order they ran.
        pub order: Mutex<Vec<&'static str>>,
        pub summaries: Mutex<Vec<(ApprovalSummary, Option<String>)>>,
        pub handler_ids: Mutex<Vec<Option<String>>>,
        /// Every key the nonce store was asked to consume.
        pub spent: Mutex<Vec<String>>,
        /// The `approvalId` of each held call's request.
        pub requested: Mutex<Vec<String>>,
        pub tokens: Mutex<Vec<String>>,
    }

    impl Seen {
        pub fn handler_runs(&self) -> usize {
            self.handler_ids.lock().unwrap().len()
        }
    }

    /// A nonce store that keeps every key, and notes each it is asked to consume.
    pub struct Noting(pub Arc<Seen>, pub Mutex<BTreeSet<String>>);

    #[async_trait]
    impl ApprovalNonceStore for Noting {
        async fn consume(&self, nonce: &str, _expires_at: i64) -> bool {
            self.0.spent.lock().unwrap().push(nonce.to_owned());
            self.1.lock().unwrap().insert(nonce.to_owned())
        }
    }

    pub struct Run(pub Arc<Seen>);

    #[async_trait]
    impl CommandHandler for Run {
        async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
            self.0.order.lock().unwrap().push("handler");
            self.0
                .handler_ids
                .lock()
                .unwrap()
                .push(context.dispatch_id().map(str::to_owned));
            success(input)
        }
    }

    /// The approval middleware's options as every case sets them: the hook (refusing when
    /// `fail`), the noting store, and `on_approval_required` noting each request.
    pub fn options(
        secret: &str,
        seen: &Arc<Seen>,
        fail: bool,
        replay: ApprovalReplay,
    ) -> ApprovalMiddlewareOptions {
        let hook_seen = Arc::clone(seen);
        let required_seen = Arc::clone(seen);
        ApprovalMiddlewareOptions::from_secret(secret)
            .with_include_token(true)
            .with_replay(replay)
            .with_nonce_store(Noting(Arc::clone(seen), Mutex::default()))
            .with_on_approval_required(move |request: ApprovalRequest| {
                required_seen
                    .requested
                    .lock()
                    .unwrap()
                    .push(request.approval_id.clone());
                required_seen
                    .tokens
                    .lock()
                    .unwrap()
                    .push(request.approval_token);
                Box::pin(async {})
            })
            .with_on_approval_accepted(move |summary, dispatch_id| {
                let seen = Arc::clone(&hook_seen);
                Box::pin(async move {
                    seen.order.lock().unwrap().push("hook");
                    seen.summaries.lock().unwrap().push((summary, dispatch_id));
                    if fail {
                        Err("the host could not record the approval".to_owned())
                    } else {
                        Ok(())
                    }
                })
            })
    }

    /// The registry for an in-process case: the commands of `approval-tokens.json`, gated, and
    /// `item-echo`, ungated.
    pub fn registry(tokens: &Value, case: &Value, seen: &Arc<Seen>) -> Arc<CommandRegistry> {
        let run = &case["run"];
        let registry = Arc::new(CommandRegistry::new());
        let id = || vec![CommandParameter::required_number("id", "ID")];
        for name in tokens["commands"].as_array().unwrap() {
            let name = name.as_str().unwrap();
            registry
                .register(
                    CommandDefinition::new(name, name, id(), Run(Arc::clone(seen)))
                        .with_approval(ApprovalPolicy::Required),
                )
                .unwrap();
        }
        registry
            .register(CommandDefinition::new(
                "item-echo",
                "Echo",
                id(),
                Run(Arc::clone(seen)),
            ))
            .unwrap();
        let replay = if run["replay"] == "within-ttl" {
            ApprovalReplay::WithinTtl
        } else {
            ApprovalReplay::SingleUse
        };
        let options = options(
            tokens["secrets"]["current"].as_str().unwrap(),
            seen,
            run["hook"] == "fail",
            replay,
        )
        .with_clock(fixed_clock(tokens["now"].as_i64().unwrap()));
        registry.add_middleware(create_approval_middleware(options).unwrap());
        registry
    }

    fn binding<'a>(tokens: &'a Value, name: &str) -> &'a Value {
        tokens["bindings"]
            .as_array()
            .unwrap()
            .iter()
            .find(|binding| binding["description"] == name)
            .unwrap_or_else(|| panic!("no binding {name}"))
    }

    /// The token a case carries: its binding's, tampered when it says so.
    fn token(binding: &Value, run: &Value) -> String {
        let token = binding["token"].as_str().unwrap().to_owned();
        if run["tamper"] != "signature" {
            return token;
        }
        let last = token.chars().last().unwrap();
        let other = if last == 'A' { 'B' } else { 'A' };
        format!("{}{other}", &token[..token.len() - 1])
    }

    pub fn actor(tokens: &Value, name: &str) -> Actor {
        serde_json::from_value(tokens["actors"][name].clone()).unwrap()
    }

    /// What one in-process case returned: the results of its calls, in order.
    pub async fn run_in_process(tokens: &Value, case: &Value, seen: &Arc<Seen>) -> Vec<Value> {
        let run = &case["run"];
        let registry = registry(tokens, case, seen);
        let (command, input, actor, token) = match run["binding"].as_str() {
            Some(name) => {
                let binding = binding(tokens, name);
                (
                    binding["command"].as_str().unwrap().to_owned(),
                    binding["input"].clone(),
                    actor(tokens, binding["actor"].as_str().unwrap()),
                    Some(token(binding, run)),
                )
            }
            None => (
                run["command"].as_str().unwrap().to_owned(),
                run["input"].clone(),
                actor(tokens, "agent"),
                None,
            ),
        };
        let context = |token: Option<String>| {
            let context = CommandContext::new().with_actor(actor.clone());
            match token {
                Some(token) => context.with_approval(token),
                None => context,
            }
        };
        let mut results = Vec::new();
        match run["via"].as_str().unwrap() {
            "direct" => {
                let asked = Arc::clone(seen);
                let client = DirectClient::new(Arc::clone(&registry)).with_on_approval_needed(
                    Arc::new(move |request| {
                        asked.requested.lock().unwrap().push(request.approval_id);
                        Box::pin(async { Ok(true) })
                    }),
                );
                results.push(client.call(&command, input, Some(context(None))).await);
            }
            _ if run["holdFirst"] == true => {
                let held = registry
                    .execute(&command, input.clone(), Some(context(None)))
                    .await;
                assert!(!held.success, "{held:?}");
                let issued = seen.tokens.lock().unwrap().last().cloned().unwrap();
                results.push(
                    registry
                        .execute(&command, input, Some(context(Some(issued))))
                        .await,
                );
            }
            _ => {
                let count = run["count"].as_u64().unwrap_or(1);
                for _ in 0..count {
                    results.push(
                        registry
                            .execute(&command, input.clone(), Some(context(token.clone())))
                            .await,
                    );
                }
                if run["thenRetry"] == true {
                    results.push(
                        registry
                            .execute(&command, input.clone(), Some(context(token.clone())))
                            .await,
                    );
                }
            }
        }
        results
            .into_iter()
            .map(|result| serde_json::to_value(result).unwrap())
            .collect()
    }

    /// Check a case's `expect` against what it saw; the failures.
    pub fn check(tokens: &Value, case: &Value, seen: &Seen, results: &[Value]) -> Vec<String> {
        let run = &case["run"];
        let expect = &case["expect"];
        let mut failures = Vec::new();
        let mut fail = |what: String| failures.push(format!("{}: {what}", description(case)));
        let summaries = seen.summaries.lock().unwrap().clone();
        let first = &results[0];

        if let Some(succeeded) = expect["success"].as_bool() {
            if first["success"] != succeeded {
                fail(format!("result {first}"));
            }
        }
        if let Some(code) = expect["code"].as_str() {
            if first["error"]["code"] != code {
                fail(format!("code of {first}"));
            }
        }
        if let Some(calls) = expect["hookCalls"].as_u64() {
            if summaries.len() as u64 != calls {
                fail(format!("{} hook calls", summaries.len()));
            }
        }
        if let Some(runs) = expect["handlerRuns"].as_u64() {
            if seen.handler_runs() as u64 != runs {
                fail(format!("handler ran {} times", seen.handler_runs()));
            }
        }
        if let Some(order) = expect["order"].as_array() {
            let ran = seen.order.lock().unwrap().clone();
            let expected: Vec<&str> = order.iter().map(|step| step.as_str().unwrap()).collect();
            if ran != expected {
                fail(format!("order {ran:?}"));
            }
        }
        if let Some(retry) = expect["retry"].as_object() {
            let last = results.last().unwrap();
            if last["error"]["code"] != retry["code"]
                || last["error"]["details"]["reason"] != retry["reason"]
            {
                fail(format!("retry {last}"));
            }
            if seen.handler_runs() as u64 != retry["handlerRuns"].as_u64().unwrap() {
                fail(format!("handler ran {} times", seen.handler_runs()));
            }
        }
        let serialized: Vec<Value> = summaries
            .iter()
            .map(|(summary, _)| serde_json::to_value(summary).unwrap())
            .collect();
        if let Some(members) = expect["members"].as_array() {
            for summary in &serialized {
                let mut names: Vec<&str> = summary
                    .as_object()
                    .unwrap()
                    .keys()
                    .map(String::as_str)
                    .collect();
                names.sort_unstable();
                let expected: Vec<&str> = members.iter().map(|m| m.as_str().unwrap()).collect();
                if names != expected {
                    fail(format!("members {names:?}"));
                }
            }
        }
        if let Some(via) = expect["via"].as_str() {
            for summary in &serialized {
                if summary["via"] != via {
                    fail(format!("via {}", summary["via"]));
                }
            }
        }
        let bound = run["binding"].as_str().map(|name| binding(tokens, name));
        for member in expect["fromBinding"].as_array().into_iter().flatten() {
            let member = member.as_str().unwrap();
            let binding = bound.expect("a binding");
            for summary in &serialized {
                if summary[member] != binding[member] {
                    fail(format!(
                        "{member} {} is not {}",
                        summary[member], binding[member]
                    ));
                }
            }
        }
        let now = tokens["now"].as_i64().unwrap();
        let time = |text: &str| match text {
            "now" => now,
            "now + ttlMs" => now + tokens["ttlMs"].as_i64().unwrap_or(TTL_MS),
            other => panic!("unknown time {other}"),
        };
        for member in ["issuedAt", "expiresAt"] {
            if let Some(text) = expect[member].as_str() {
                for summary in &serialized {
                    if summary[member] != time(text) {
                        fail(format!("{member} {}", summary[member]));
                    }
                }
            }
        }
        if expect["dispatchIdIsHandlers"] == true {
            let handler = seen.handler_ids.lock().unwrap().clone();
            let given: Vec<Option<String>> = summaries.iter().map(|(_, id)| id.clone()).collect();
            if given != handler || given.iter().any(Option::is_none) {
                fail(format!("hook ids {given:?}, handler ids {handler:?}"));
            }
        }
        for held in expect["summaryNeverHolds"].as_array().into_iter().flatten() {
            let held = held.as_str().unwrap();
            let value = match bound.map(|binding| &binding[held]) {
                Some(Value::String(value)) => value.as_str(),
                _ => held,
            };
            for summary in &serialized {
                if summary.to_string().contains(value) {
                    fail(format!("the summary holds {held}: {summary}"));
                }
            }
        }
        if let Some(description) = expect["approvalIdIs"].as_str() {
            let entry = tokens["approvalIds"]
                .as_array()
                .unwrap()
                .iter()
                .find(|entry| entry["description"] == description)
                .unwrap();
            for summary in &serialized {
                if summary["approvalId"] != entry["approvalId"] {
                    fail(format!("approvalId {}", summary["approvalId"]));
                }
            }
        }
        if expect["approvalIdFromSpentKey"] == true {
            let spent: BTreeSet<String> = seen
                .spent
                .lock()
                .unwrap()
                .iter()
                .map(|key| approval_id(key))
                .collect();
            for (summary, _) in &summaries {
                if !spent.contains(&summary.approval_id) {
                    fail(format!("{} is no spent key's id", summary.approval_id));
                }
            }
        }
        let distinct = |ids: Vec<Option<String>>| ids.into_iter().collect::<BTreeSet<_>>().len();
        if let Some(count) = expect["distinctApprovalIds"].as_u64() {
            let ids = summaries
                .iter()
                .map(|(summary, _)| Some(summary.approval_id.clone()))
                .collect();
            if distinct(ids) as u64 != count {
                fail("distinct approval ids".to_owned());
            }
        }
        if let Some(count) = expect["distinctDispatchIds"].as_u64() {
            let ids: Vec<Option<String>> = summaries.iter().map(|(_, id)| id.clone()).collect();
            if ids.iter().any(Option::is_none) || distinct(ids) as u64 != count {
                fail("distinct dispatch ids".to_owned());
            }
        }
        if expect["requestApprovalIdIsSummarys"] == true {
            let requested = seen.requested.lock().unwrap().clone();
            let given: Vec<String> = summaries
                .iter()
                .map(|(summary, _)| summary.approval_id.clone())
                .collect();
            if requested.is_empty() || requested.last() != given.last() {
                fail(format!("requested {requested:?}, summaries {given:?}"));
            }
        }
        failures
    }
}

#[cfg(all(feature = "server", feature = "approval"))]
mod common;

/// The cases that run over the MCP server: the form-mode relay and relay evidence.
#[cfg(all(feature = "server", feature = "approval"))]
mod over_mcp {
    use super::summary::{options, Run, Seen};
    use super::*;
    use afd::server::{
        ConfirmationMode, HumanRelay, McpServer, RelayCall, RelayOutcome, RelayPrompt,
    };
    use afd::CommandParameter;
    use afd::{
        create_approval_middleware, ApprovalPolicy, ApprovalRelay, ApprovalReplay,
        CommandConfirmationMode,
    };

    const SECRET: &str = "afd-journal-seams-vectors-secret-0123456789";

    /// A relay that approves every call with the case's decision id.
    struct Approving(String);

    #[async_trait]
    impl HumanRelay for Approving {
        async fn begin(&self, _call: &RelayCall) -> Result<RelayPrompt, CommandError> {
            Ok(RelayPrompt::new(
                "https://person.example.com/decide/d-1",
                "Open the link to review todo-delete",
                "state-1",
            ))
        }

        async fn resume(&self, _state: &str, _call: &RelayCall) -> RelayOutcome {
            RelayOutcome::Approved {
                decision_id: self.0.clone(),
            }
        }
    }

    fn server(case: &Value, seen: &Arc<Seen>) -> McpServer {
        let run = &case["run"];
        let relay = run["via"] == "relay";
        let registry = Arc::new(CommandRegistry::new());
        let mut delete = CommandDefinition::new(
            "todo-delete",
            "Delete a todo",
            vec![CommandParameter::required_number("id", "ID")],
            Run(Arc::clone(seen)),
        )
        .with_approval(ApprovalPolicy::Required);
        if relay {
            delete = delete.with_confirmation_mode(CommandConfirmationMode::HostVerified);
        }
        delete.expose.mcp = true;
        registry.register(delete).unwrap();
        let mut options = options(SECRET, seen, false, ApprovalReplay::SingleUse);
        if !relay {
            options = options.with_relay(ApprovalRelay::McpElicitation);
        }
        registry.add_middleware(create_approval_middleware(options).unwrap());
        let server = McpServer::new(registry, "journal-seams", "1.0.0")
            .with_confirmations_key(ConfirmationMode::Off, vec![9u8; 32])
            .unwrap();
        if relay {
            server.with_human_relay(Approving(run["decisionId"].as_str().unwrap().to_owned()))
        } else {
            server
        }
    }

    async fn post(server: &McpServer, tool: &str, arguments: Value, extra: Value) -> Value {
        // A client that can be asked with a form (the MCP relay) or a URL (a host's relay).
        let capabilities = json!({ "elicitation": { "form": {}, "url": {} } });
        let mut params = json!({
            "name": tool,
            "arguments": arguments,
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
        let (status, response) = common::http_post(
            server,
            body,
            &[
                ("mcp-protocol-version", "2026-07-28"),
                ("mcp-method", "tools/call"),
                ("mcp-name", tool),
            ],
        )
        .await;
        assert_eq!(status, 200, "{response}");
        response
    }

    /// The answer that accepts the question `asked` put.
    fn accept(asked: &Value) -> Value {
        let result = &asked["result"];
        assert_eq!(result["resultType"], "input_required", "{asked}");
        let state = result["requestState"].as_str().unwrap();
        let requests = result["inputRequests"].as_object().unwrap();
        let (key, _) = requests.iter().next().unwrap();
        let response = if key == "approval" {
            json!({ "action": "accept", "content": { "approve": true } })
        } else {
            json!({ "action": "accept" })
        };
        json!({ "inputResponses": { key.clone(): response }, "requestState": state })
    }

    /// Ask, accept and run one case; its results, as the in-process cases give them.
    pub async fn run_over_mcp(case: &Value, seen: &Arc<Seen>) -> Vec<Value> {
        let run = &case["run"];
        let server = server(case, seen);
        let (tool, arguments) = if run["kind"] == "batch" {
            ("afd-batch", json!({ "commands": run["commands"] }))
        } else {
            (run["command"].as_str().unwrap(), run["input"].clone())
        };
        let asked = post(&server, tool, arguments.clone(), Value::Null).await;
        let ran = post(&server, tool, arguments, accept(&asked)).await;
        let body = common::command_result(&ran);
        vec![body]
    }
}

#[cfg(feature = "approval")]
#[tokio::test]
async fn approval_summary_cases() {
    let vectors = vectors();
    let cases = cases(&vectors, "approvalSummary");
    assert!(!cases.is_empty());
    if let Some(gap) = rust_gap(&vectors) {
        for case in cases {
            eprintln!(
                "skipped: {} (documented Rust gap, {gap})",
                description(case)
            );
        }
        return;
    }
    let tokens = load_vectors("approval-tokens.json");
    let mut failures = Vec::new();
    let mut ran = 0;
    for case in cases {
        let seen = Arc::new(summary::Seen::default());
        let over_mcp = matches!(case["run"]["via"].as_str(), Some("relay" | "elicitation"));
        let results = if over_mcp {
            #[cfg(feature = "server")]
            {
                over_mcp::run_over_mcp(case, &seen).await
            }
            #[cfg(not(feature = "server"))]
            {
                eprintln!(
                    "skipped: {} (needs the `server` feature: the MCP relay and HumanRelay)",
                    description(case)
                );
                continue;
            }
        } else {
            summary::run_in_process(&tokens, case, &seen).await
        };
        ran += 1;
        failures.extend(summary::check(&tokens, case, &seen, &results));
    }
    assert!(ran > 0);
    assert!(failures.is_empty(), "{failures:#?}");
}

#[cfg(not(feature = "approval"))]
#[test]
fn approval_summary_cases_need_the_approval_feature() {
    let vectors = vectors();
    for case in cases(&vectors, "approvalSummary") {
        eprintln!(
            "skipped: {} (needs the `approval` feature: the approval middleware)",
            description(case)
        );
    }
}

// ─── Beyond the vectors ─────────────────────────────────────────────────────────────────────

/// A handler that calls another command's definition directly, as a host may, and notes the
/// dispatch id the direct handler reads.
struct CallsDirectly {
    inner: Arc<CommandDefinition>,
    seen: Arc<Mutex<Vec<Option<String>>>>,
}

struct NotesId(Arc<Mutex<Vec<Option<String>>>>);

#[async_trait]
impl CommandHandler for NotesId {
    async fn execute(&self, _input: Value, context: CommandContext) -> CommandResult<Value> {
        self.0
            .lock()
            .unwrap()
            .push(context.dispatch_id().map(str::to_owned));
        success(json!({}))
    }
}

#[async_trait]
impl CommandHandler for CallsDirectly {
    async fn execute(&self, _input: Value, context: CommandContext) -> CommandResult<Value> {
        self.seen
            .lock()
            .unwrap()
            .push(context.dispatch_id().map(str::to_owned));
        self.inner.execute(json!({}), context).await
    }
}

#[tokio::test]
async fn a_definition_called_directly_reads_no_dispatch_id() {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let inner = Arc::new(CommandDefinition::new(
        "item-inner",
        "Inner",
        vec![],
        NotesId(Arc::clone(&seen)),
    ));
    let registry = CommandRegistry::new();
    registry
        .register(CommandDefinition::new(
            "item-outer",
            "Outer",
            vec![],
            CallsDirectly {
                inner,
                seen: Arc::clone(&seen),
            },
        ))
        .unwrap();
    let result = registry.execute("item-outer", json!({}), None).await;
    assert!(result.success, "{result:?}");
    let seen = seen.lock().unwrap();
    assert_eq!(seen.len(), 2);
    assert!(seen[0].as_deref().is_some_and(well_formed), "{seen:?}");
    assert_eq!(
        seen[1], None,
        "the direct call read the outer dispatch's id"
    );
}

#[cfg(feature = "approval")]
mod refusal {
    use super::summary::{options, Run, Seen};
    use super::*;
    use afd::middleware::{create_logging_middleware, LoggingOptions};
    use afd::{
        create_approval_middleware, fixed_clock, Actor, ApprovalPolicy, ApprovalReplay,
        CommandParameter,
    };

    /// Rule 2: a refusing hook is the approval middleware's exception, so a link outside it sees
    /// an error, not a result (the logging middleware's `Error` line, never `Completed`).
    #[cfg(panic = "unwind")]
    #[tokio::test]
    async fn a_refusing_hook_is_an_error_to_the_links_outside_it() {
        let tokens = load_vectors("approval-tokens.json");
        let binding = &tokens["bindings"][0];
        let seen = Arc::new(Seen::default());
        let lines = Arc::new(Mutex::new(Vec::<String>::new()));
        let registry = CommandRegistry::new();
        registry
            .register(
                CommandDefinition::new(
                    "todo-delete",
                    "todo-delete",
                    vec![CommandParameter::required_number("id", "ID")],
                    Run(Arc::clone(&seen)),
                )
                .with_approval(ApprovalPolicy::Required),
            )
            .unwrap();
        let log_lines = Arc::clone(&lines);
        registry.add_middleware(create_logging_middleware(LoggingOptions {
            log: Some(Arc::new(move |line: &str, _: Option<&Value>| {
                log_lines.lock().unwrap().push(line.to_owned());
            })),
            ..LoggingOptions::default()
        }));
        let secret = tokens["secrets"]["current"].as_str().unwrap();
        let options = options(secret, &seen, true, ApprovalReplay::SingleUse)
            .with_clock(fixed_clock(tokens["now"].as_i64().unwrap()));
        registry.add_middleware(create_approval_middleware(options).unwrap());
        let actor: Actor = serde_json::from_value(tokens["actors"]["agent"].clone()).unwrap();
        let context = CommandContext::new()
            .with_actor(actor)
            .with_approval(binding["token"].as_str().unwrap().to_owned());
        let result = registry
            .execute("todo-delete", binding["input"].clone(), Some(context))
            .await;
        assert_eq!(
            result.error.as_ref().map(|error| error.code.as_str()),
            Some("COMMAND_EXECUTION_ERROR")
        );
        assert_eq!(*seen.order.lock().unwrap(), vec!["hook"]);
        let lines = lines.lock().unwrap();
        assert!(
            lines.iter().any(|line| line.contains("Error: todo-delete")),
            "{lines:?}"
        );
        assert!(
            !lines.iter().any(|line| line.contains("Completed")),
            "{lines:?}"
        );
    }
}
