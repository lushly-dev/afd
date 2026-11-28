//! The embedder's journal policies (D208 as amended by D221, D224): a required call's intent is
//! durable before its handler runs and is reported unsettled when the call never returned; a
//! required call is refused with `JOURNAL_UNAVAILABLE` when its intent cannot be written; a
//! buffered stop's entry waits while the journal is down and is written first, in order, when it
//! returns; a full buffer and a droppable entry are counted; an approval is filed beside its
//! intent; a plugin may say that a call changed nothing; and a host with no policies journals as
//! before.
use crate::support;
use afd::{
    Actor, ActorKind, CommandContext, CommandDefinition, CommandHandler, CommandResult,
    ExposeOptions, success,
};
use async_trait::async_trait;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use support::plugins::{Raw, closure, echo_manifest};
use umbel::{HostBuilder, JOURNAL_UNAVAILABLE, JournalPolicies, JournalPolicy, JournalStorage};

const MAKE: &str = "machine-make";
const STOP: &str = "machine-stop";
const LOOK: &str = "machine-look";

fn ada() -> Actor {
    Actor::new(ActorKind::Human).with_id("ada")
}

fn ahead_path(dir: &Path) -> PathBuf {
    dir.join("state").join("journal.ahead.jsonl")
}

fn everywhere() -> ExposeOptions {
    ExposeOptions::new()
        .with_mcp(true)
        .with_agent(true)
        .with_cli(true)
}

/// What a handler waits on before it runs.
type Wait = std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>>;
type Before = Arc<dyn Fn() -> Wait + Send + Sync>;

/// A handler that counts its runs and answers `{ ran: n }`, after `before` (which may wait).
struct Counted {
    runs: Arc<AtomicUsize>,
    before: Before,
}

#[async_trait]
impl CommandHandler for Counted {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        (self.before)().await;
        let n = self.runs.fetch_add(1, Ordering::SeqCst) + 1;
        success(json!({ "ran": n }))
    }
}

fn counted(name: &str, mutation: bool, runs: &Arc<AtomicUsize>) -> CommandDefinition {
    counted_with(name, mutation, runs, Arc::new(|| Box::pin(async {})))
}

fn counted_with(
    name: &str,
    mutation: bool,
    runs: &Arc<AtomicUsize>,
    before: Before,
) -> CommandDefinition {
    let mut command = CommandDefinition::new(
        name,
        "A journal-policy fixture",
        vec![afd::CommandParameter::optional_string("id", "An id")],
        Counted {
            runs: Arc::clone(runs),
            before,
        },
    )
    .with_expose(everywhere());
    command.mutation = mutation;
    command
}

/// The three fixture commands, counted together, each with its policy.
fn builder(dir: &Path, runs: &Arc<AtomicUsize>, policies: JournalPolicies) -> HostBuilder {
    HostBuilder::open(dir)
        .unwrap()
        .register(counted(MAKE, true, runs))
        .register(counted(STOP, true, runs))
        .register(counted(LOOK, false, runs))
        .with_journal_policies(policies)
}

fn policies() -> JournalPolicies {
    JournalPolicies::new()
        .with(MAKE, JournalPolicy::Required)
        .with(STOP, JournalPolicy::Buffered)
        .with(LOOK, JournalPolicy::Droppable)
}

/// A storage that fails its writes on demand, over a write-ahead file in memory.
#[derive(Clone, Default)]
struct Faulty {
    lines: Arc<Mutex<Vec<u8>>>,
    ahead_down: Arc<AtomicBool>,
    journal_down: Arc<AtomicBool>,
}

impl Faulty {
    fn records(&self) -> Vec<Value> {
        String::from_utf8(self.lines.lock().unwrap().clone())
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }
}

fn down(error: &str) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::StorageFull, error.to_owned())
}

impl JournalStorage for Faulty {
    fn append_ahead(&self, line: &[u8]) -> std::io::Result<()> {
        if self.ahead_down.load(Ordering::SeqCst) {
            return Err(down("the disk is full"));
        }
        self.lines.lock().unwrap().extend_from_slice(line);
        Ok(())
    }

    fn read_ahead(&self) -> std::io::Result<Vec<u8>> {
        Ok(self.lines.lock().unwrap().clone())
    }

    fn check_ahead(&self) -> std::io::Result<()> {
        if self.ahead_down.load(Ordering::SeqCst) {
            Err(down("the disk is full"))
        } else {
            Ok(())
        }
    }

    fn check_journal(&self) -> std::io::Result<()> {
        if self.journal_down.load(Ordering::SeqCst) {
            Err(down("the disk is full"))
        } else {
            Ok(())
        }
    }
}

fn journaled(dir: &Path) -> Vec<(String, Value)> {
    match std::fs::read_to_string(support::journal_path(dir)) {
        Ok(text) => afd::parse_journal(&text)
            .unwrap()
            .into_iter()
            .map(|entry| (entry.command, entry.input))
            .collect(),
        Err(_) => Vec::new(),
    }
}

#[tokio::test]
async fn an_intent_is_durable_before_the_handler_and_unsettled_after_a_crash() {
    let dir = support::minimal();
    let runs = Arc::new(AtomicUsize::new(0));
    // The handler reads the write-ahead file as it starts, then never returns: the process
    // "crashes" between the intent and the effect.
    let seen = Arc::new(Mutex::new(String::new()));
    let before: Before = {
        let seen = Arc::clone(&seen);
        let path = ahead_path(dir.path());
        Arc::new(move || {
            *seen.lock().unwrap() = std::fs::read_to_string(&path).unwrap_or_default();
            Box::pin(std::future::pending())
        })
    };
    let host = HostBuilder::open(dir.path())
        .unwrap()
        .register(counted_with(MAKE, true, &runs, before))
        .with_journal_policies(JournalPolicies::new().with(MAKE, JournalPolicy::Required))
        .seal()
        .unwrap();
    let health = host.journal_health().unwrap();
    assert!(health.writable());
    assert!(health.unsettled().is_empty());
    assert!(
        !ahead_path(dir.path()).exists(),
        "opening makes no file, so a fresh workspace stays empty for a restore"
    );
    let context = host.context(ada());
    let trace = context.trace_id.clone().unwrap();
    let registry = host.registry();
    let call = registry.execute(MAKE, json!({ "id": "m-01" }), Some(context));
    let timed_out = tokio::time::timeout(std::time::Duration::from_millis(300), call).await;
    assert!(timed_out.is_err(), "the handler never returns");
    let at_start = seen.lock().unwrap().clone();
    let intent: Value = serde_json::from_str(at_start.lines().next().unwrap()).unwrap();
    assert_eq!(intent["kind"], "intent", "{at_start}");
    assert_eq!(intent["command"], MAKE);
    assert_eq!(intent["traceId"], trace.as_str());
    assert_eq!(intent["actor"]["id"], "ada");
    assert!(
        intent.get("input").is_none(),
        "a command with no digest mode keeps no input: {intent}"
    );
    let dispatch = intent["dispatchId"].as_str().unwrap().to_owned();
    assert_eq!(
        dispatch.len(),
        22,
        "a dispatch id is 22 base64url characters"
    );
    assert_ne!(dispatch, trace);
    drop(registry);
    drop(host);
    let file = std::fs::read_to_string(ahead_path(dir.path())).unwrap();
    assert_eq!(file.lines().count(), 1, "no outcome was written: {file}");
    assert_eq!(runs.load(Ordering::SeqCst), 0);

    // Reopened, the host reports the intent as unsettled.
    let reopened = HostBuilder::open(dir.path())
        .unwrap()
        .register(counted(MAKE, true, &runs))
        .with_journal_policies(JournalPolicies::new().with(MAKE, JournalPolicy::Required))
        .seal()
        .unwrap();
    let health = reopened.journal_health().unwrap();
    let unsettled = health.unsettled();
    assert_eq!(unsettled.len(), 1, "{unsettled:?}");
    assert_eq!(unsettled[0].dispatch_id, dispatch);
    assert_eq!(unsettled[0].command, MAKE);
    assert_eq!(unsettled[0].attempt, 1);
    assert_eq!(unsettled[0].trace_id.as_deref(), Some(trace.as_str()));
    assert_eq!(health.unreadable(), 0);
    assert!(health.report_error().is_none());

    // A call that returns settles its own intent, so it is not reported on the next open.
    let settled = support::call(&reopened, ada(), MAKE, json!({ "id": "m-02" })).await;
    assert!(settled.success, "{settled:?}");
    drop(reopened);
    let again = HostBuilder::open(dir.path())
        .unwrap()
        .register(counted(MAKE, true, &runs))
        .with_journal_policies(JournalPolicies::new().with(MAKE, JournalPolicy::Required))
        .seal()
        .unwrap();
    let unsettled = again.journal_health().unwrap().unsettled().to_vec();
    assert_eq!(unsettled.len(), 1, "only the crashed call: {unsettled:?}");
    assert_eq!(unsettled[0].dispatch_id, dispatch);
}

#[tokio::test]
async fn a_required_call_is_refused_when_the_write_ahead_file_cannot_be_written() {
    let dir = support::minimal();
    // A directory where the file should be: the host's own storage can neither open nor read it.
    std::fs::create_dir_all(ahead_path(dir.path())).unwrap();
    let runs = Arc::new(AtomicUsize::new(0));
    let host = builder(dir.path(), &runs, policies()).seal().unwrap();
    let health = host.journal_health().unwrap();
    assert!(!health.writable(), "the open saw it cannot be appended to");
    assert!(health.report_error().is_some());
    let refused = support::call(&host, ada(), MAKE, json!({ "id": "m-01" })).await;
    let error = refused.error.clone().unwrap();
    assert_eq!(error.code, JOURNAL_UNAVAILABLE, "{refused:?}");
    assert_eq!(error.retryable, Some(true));
    assert!(error.suggestion.is_some());
    assert_eq!(runs.load(Ordering::SeqCst), 0, "the handler never ran");
    // Stops and reads still run.
    assert!(support::call(&host, ada(), STOP, json!({})).await.success);
    assert!(support::call(&host, ada(), LOOK, json!({})).await.success);
    assert_eq!(runs.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn the_embedders_suggestion_and_the_live_state_follow_the_storage() {
    let dir = support::minimal();
    let storage = Faulty::default();
    storage.ahead_down.store(true, Ordering::SeqCst);
    storage.journal_down.store(true, Ordering::SeqCst);
    let runs = Arc::new(AtomicUsize::new(0));
    let policies = policies()
        .with_storage(storage.clone())
        .with_unavailable_suggestion("Run host-status to see why.");
    let health = policies.health();
    let host = builder(dir.path(), &runs, policies).seal().unwrap();
    assert!(!health.writable());
    let refused = support::call(&host, ada(), MAKE, json!({})).await;
    let error = refused.error.unwrap();
    assert_eq!(error.code, JOURNAL_UNAVAILABLE);
    assert!(error.suggestion.unwrap().contains("host-status"));
    assert_eq!(runs.load(Ordering::SeqCst), 0);
    // The disk comes back: a flush sees the file, and the next required call runs.
    storage.ahead_down.store(false, Ordering::SeqCst);
    storage.journal_down.store(false, Ordering::SeqCst);
    assert_eq!(health.flush().await, 0);
    let ran = support::call(&host, ada(), MAKE, json!({})).await;
    assert!(ran.success, "{ran:?}");
    assert!(health.writable());
    let kinds: Vec<Value> = storage
        .records()
        .iter()
        .map(|r| r["kind"].clone())
        .collect();
    assert_eq!(kinds, vec![json!("intent"), json!("outcome")]);
    let records = storage.records();
    assert_eq!(records[0]["dispatchId"], records[1]["dispatchId"]);
    assert_eq!(records[0]["seq"], records[1]["seq"]);
    assert_eq!(records[1]["success"], true);
}

#[tokio::test]
async fn buffered_entries_wait_and_are_written_first_in_order_when_the_journal_returns() {
    let dir = support::minimal();
    let storage = Faulty::default();
    let runs = Arc::new(AtomicUsize::new(0));
    let policies = policies().with_storage(storage.clone());
    let health = policies.health();
    let host = builder(dir.path(), &runs, policies).seal().unwrap();
    storage.journal_down.store(true, Ordering::SeqCst);
    for id in ["a", "b"] {
        let stopped = support::call(&host, ada(), STOP, json!({ "id": id })).await;
        assert!(stopped.success, "a stop is never refused: {stopped:?}");
    }
    assert_eq!(health.pending(), 2);
    assert_eq!(health.dropped(), 0);
    assert!(!health.writable());
    // A read while the journal is down is dropped and counted.
    assert!(
        support::call(&host, ada(), LOOK, json!({ "id": "r1" }))
            .await
            .success
    );
    assert_eq!(health.dropped(), 1);
    assert!(journaled(dir.path()).is_empty());
    // The journal returns: the next entry waits behind the held ones.
    storage.journal_down.store(false, Ordering::SeqCst);
    assert!(
        support::call(&host, ada(), LOOK, json!({ "id": "r2" }))
            .await
            .success
    );
    assert_eq!(health.pending(), 0);
    assert!(health.writable());
    assert_eq!(
        journaled(dir.path()),
        vec![
            (STOP.to_owned(), json!({ "id": "a" })),
            (STOP.to_owned(), json!({ "id": "b" })),
            (LOOK.to_owned(), json!({ "id": "r2" })),
        ]
    );
    // The held stops still became events, in order.
    let events = support::events(dir.path(), "main");
    let commands: Vec<&str> = events
        .iter()
        .map(|event| event["command"].as_str().unwrap())
        .collect();
    assert_eq!(commands, vec![STOP, STOP]);
}

#[tokio::test]
async fn a_full_buffer_drops_and_counts_and_a_flush_writes_what_waits() {
    let dir = support::minimal();
    let storage = Faulty::default();
    let runs = Arc::new(AtomicUsize::new(0));
    let policies = policies().with_storage(storage.clone()).with_buffer(1);
    let health = policies.health();
    let host = builder(dir.path(), &runs, policies).seal().unwrap();
    storage.journal_down.store(true, Ordering::SeqCst);
    for id in ["a", "b", "c"] {
        assert!(
            support::call(&host, ada(), STOP, json!({ "id": id }))
                .await
                .success
        );
    }
    assert_eq!(runs.load(Ordering::SeqCst), 3, "every stop ran");
    assert_eq!(health.pending(), 1);
    assert_eq!(health.dropped(), 2);
    assert_eq!(health.flush().await, 1, "still down");
    storage.journal_down.store(false, Ordering::SeqCst);
    assert_eq!(health.flush().await, 0);
    assert_eq!(
        journaled(dir.path()),
        vec![(STOP.to_owned(), json!({ "id": "a" }))]
    );
}

#[tokio::test]
async fn refusals_and_reads_are_droppable_and_counted() {
    let dir = support::minimal();
    let storage = Faulty::default();
    let runs = Arc::new(AtomicUsize::new(0));
    let policies = policies()
        .with("machine-halt", JournalPolicy::Buffered)
        .with_storage(storage.clone());
    let health = policies.health();
    let host = builder(dir.path(), &runs, policies)
        .register(support::failing_mutation("machine-halt"))
        .seal()
        .unwrap();
    storage.journal_down.store(true, Ordering::SeqCst);
    storage.ahead_down.store(true, Ordering::SeqCst);
    // A refused required call: its entry (journaled failures are on by default) is dropped.
    let refused = support::call(&host, ada(), MAKE, json!({})).await;
    assert_eq!(refused.error.unwrap().code, JOURNAL_UNAVAILABLE);
    // A buffered command that failed was not carried out: its entry is dropped, never held.
    let failed = support::call(&host, ada(), "machine-halt", json!({})).await;
    assert!(!failed.success);
    assert!(support::call(&host, ada(), LOOK, json!({})).await.success);
    assert_eq!(health.pending(), 0);
    assert_eq!(health.dropped(), 3);
}

#[tokio::test]
async fn two_calls_are_two_dispatches_each_with_its_own_intent() {
    let dir = support::minimal();
    let storage = Faulty::default();
    let runs = Arc::new(AtomicUsize::new(0));
    let host = builder(dir.path(), &runs, policies().with_storage(storage.clone()))
        .seal()
        .unwrap();
    // Two calls under one context, so one trace id, are two dispatches with two ids. A retry is
    // one id twice, which only a middleware outside the policy's makes; the module's unit tests
    // drive that through a registry.
    let context = host.context(ada());
    let registry = host.registry();
    let first = registry
        .execute(MAKE, json!({}), Some(context.clone()))
        .await;
    let second = registry.execute(MAKE, json!({}), Some(context)).await;
    assert!(first.success && second.success);
    let intents: Vec<Value> = storage
        .records()
        .into_iter()
        .filter(|record| record["kind"] == "intent")
        .collect();
    assert_eq!(intents.len(), 2);
    assert_eq!(intents[0]["traceId"], intents[1]["traceId"]);
    assert_ne!(intents[0]["dispatchId"], intents[1]["dispatchId"]);
    assert_ne!(intents[0]["seq"], intents[1]["seq"]);
}

#[tokio::test]
async fn an_approval_that_admitted_a_required_call_is_filed_beside_its_intent() {
    let dir = support::minimal();
    let storage = Faulty::default();
    let runs = Arc::new(AtomicUsize::new(0));
    let tokens: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let host = {
        let tokens = Arc::clone(&tokens);
        HostBuilder::open(dir.path())
            .unwrap()
            .register(support::needs_approval(MAKE, Arc::clone(&runs)))
            .with_approval_observer(move |request| {
                tokens.lock().unwrap().push(request.approval_token);
            })
            .with_journal_policies(
                JournalPolicies::new()
                    .with(MAKE, JournalPolicy::Required)
                    .with_storage(storage.clone()),
            )
            .seal()
            .unwrap()
    };
    let held = support::call(&host, ada(), MAKE, json!({})).await;
    assert_eq!(held.error.unwrap().code, "APPROVAL_REQUIRED");
    assert!(storage.records().is_empty(), "a held call writes no intent");
    let mut context = host.context(ada());
    context.approval = tokens.lock().unwrap().pop();
    let ran = host
        .registry()
        .execute(MAKE, json!({}), Some(context))
        .await;
    assert!(ran.success, "{ran:?}");
    let records = storage.records();
    let kinds: Vec<&str> = records
        .iter()
        .map(|record| record["kind"].as_str().unwrap())
        .collect();
    assert_eq!(kinds, vec!["approval", "intent", "outcome"]);
    assert_eq!(records[0]["dispatchId"], records[1]["dispatchId"]);
    assert_eq!(records[0]["approval"]["via"], "token");
    assert_eq!(records[0]["approval"]["command"], MAKE);
    assert!(records[0]["approval"].get("inputDigest").is_none());
}

#[tokio::test]
async fn an_intent_keeps_the_input_keys_of_the_commands_digest_mode() {
    let manifest = echo_manifest(
        "rig",
        "journal = { mode = \"digest\", keep = [\"text\"] }\n",
    )
    .replace("manifest_version = 1", "manifest_version = 3")
    .replace("effects = [\"inspect\"]", "effects = [\"plugin-state\"]");
    let plugin = Raw::new(manifest, |_| {
        Ok(vec![closure("rig-echo", |input, _| success(input))])
    });
    let dir = support::workspace(&support::plugins::config(&[("rig", "")], ""));
    let storage = Faulty::default();
    let host = HostBuilder::open(dir.path())
        .unwrap()
        .with_compiled(plugin)
        .with_journal_policies(
            JournalPolicies::new()
                .with("rig-echo", JournalPolicy::Required)
                .with_storage(storage.clone()),
        )
        .seal()
        .unwrap();
    let ran = support::call(&host, ada(), "rig-echo", json!({ "text": "m-01" })).await;
    assert!(ran.success, "{ran:?}");
    assert_eq!(storage.records()[0]["input"], json!({ "text": "m-01" }));
    // With none of its kept keys in the input, an intent keeps no input at all.
    let bare = support::call(&host, ada(), "rig-echo", json!({})).await;
    assert!(bare.success, "{bare:?}");
    let intents: Vec<Value> = storage
        .records()
        .into_iter()
        .filter(|record| record["kind"] == "intent")
        .collect();
    assert!(intents[1].get("input").is_none(), "{}", intents[1]);
}

#[tokio::test]
async fn a_plugin_that_says_a_call_changed_nothing_projects_no_event() {
    let manifest =
        echo_manifest("rig", "").replace("effects = [\"inspect\"]", "effects = [\"plugin-state\"]");
    let plugin = Raw::new(manifest, |_| {
        Ok(vec![closure("rig-echo", |input, _| {
            let repeat = input.get("text").and_then(Value::as_str) == Some("again");
            let outcome = umbel_sdk::success(json!({ "created": !repeat }));
            let outcome = if repeat {
                outcome.with_no_change()
            } else {
                outcome
            };
            serde_json::from_value(outcome.into_value()).unwrap()
        })])
    });
    let dir = support::workspace(&support::plugins::config(&[("rig", "")], ""));
    let host = support::plugins::seal(dir.path(), |b| b.with_compiled(plugin)).unwrap();
    let made = support::call(&host, ada(), "rig-echo", json!({ "text": "first" })).await;
    assert!(made.success, "{made:?}");
    let repeated = support::call(&host, ada(), "rig-echo", json!({ "text": "again" })).await;
    assert!(repeated.success, "{repeated:?}");
    let events = support::events(dir.path(), "main");
    assert_eq!(events.len(), 1, "the repeat made no event: {events:?}");
    // Both calls are journaled; only the first became an event.
    assert_eq!(journaled(dir.path()).len(), 2);
}

#[tokio::test]
async fn an_instance_that_may_write_a_store_cannot_say_it_changed_nothing() {
    let manifest = echo_manifest("rig", "")
        .replace("manifest_version = 1", "manifest_version = 2")
        .replace("effects = [\"inspect\"]", "effects = [\"store-write\"]")
        .replace(
            "[[commands]]",
            "[[grants]]\nname = \"documents_write\"\nreason = \"Writes documents.\"\n\n[[commands]]",
        );
    let plugin = Raw::new(manifest, |_| {
        Ok(vec![closure("rig-echo", |_, _| {
            let outcome = umbel_sdk::success(json!({})).with_no_change();
            serde_json::from_value(outcome.into_value()).unwrap()
        })])
    });
    let config = support::plugins::config(
        &[("rig", "")],
        "[plugins.rig.grants.documents_write]
allow = [\"main/*\"]
",
    )
    .replace("config_version = 2", "config_version = 3");
    let dir = support::workspace(&config);
    let host = support::plugins::seal(dir.path(), |b| b.with_compiled(plugin)).unwrap();
    let ran = support::call(&host, ada(), "rig-echo", json!({})).await;
    assert!(ran.success, "{ran:?}");
    let metadata = support::plugins::metadata(&ran);
    assert!(metadata.get("dev.umbel/no-change").is_none(), "{metadata}");
    assert_eq!(support::events(dir.path(), "main").len(), 1, "projected");
}

#[tokio::test]
async fn a_failure_that_says_it_changed_nothing_keeps_no_marker() {
    // A plugin that says "no change" on a failure is not believed: a failure makes no event
    // anyway, and the key is gone from the result.
    let manifest =
        echo_manifest("rig", "").replace("effects = [\"inspect\"]", "effects = [\"plugin-state\"]");
    let plugin = Raw::new(manifest, |_| {
        Ok(vec![closure("rig-echo", |_, _| {
            let outcome =
                umbel_sdk::failure("RIG_FAILED", "It failed", "Do not retry.").with_no_change();
            serde_json::from_value(outcome.into_value()).unwrap()
        })])
    });
    let dir = support::workspace(&support::plugins::config(&[("rig", "")], ""));
    let host = support::plugins::seal(dir.path(), |b| b.with_compiled(plugin)).unwrap();
    let failed = support::call(&host, ada(), "rig-echo", json!({})).await;
    assert!(!failed.success);
    let metadata = support::plugins::metadata(&failed);
    assert!(metadata.get("dev.umbel/no-change").is_none(), "{metadata}");
}

#[tokio::test]
async fn a_host_with_no_policies_journals_as_before() {
    let dir = support::minimal();
    let runs = Arc::new(AtomicUsize::new(0));
    let host = HostBuilder::open(dir.path())
        .unwrap()
        .register(counted(MAKE, true, &runs))
        .with_journal_policies(JournalPolicies::new())
        .seal()
        .unwrap();
    assert!(host.journal_health().is_none(), "empty policies are none");
    assert!(support::call(&host, ada(), MAKE, json!({})).await.success);
    assert!(!ahead_path(dir.path()).exists(), "no write-ahead file");
    assert_eq!(journaled(dir.path()).len(), 1);
    assert_eq!(support::events(dir.path(), "main").len(), 1);
}

#[tokio::test]
async fn a_policy_for_a_command_the_host_does_not_register_is_refused() {
    let dir = support::minimal();
    let error = HostBuilder::open(dir.path())
        .unwrap()
        .with_journal_policies(JournalPolicies::new().with("machine-nope", JournalPolicy::Required))
        .seal()
        .err()
        .unwrap();
    assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID");
    assert!(
        error.message().contains("machine-nope"),
        "{}",
        error.message()
    );
}
