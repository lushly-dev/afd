//! Commands that declare `secret` in the journal (`spec/journal.md`, "Inputs and results are
//! recorded as they are"), mirroring `packages/server/src/journal.test.ts`.

use super::*;
use crate::clock::{Clock, RandomSource};
use crate::commands::{CommandDefinition, CommandHandler, CommandParameter, CommandRegistry};
use crate::direct::DirectClient;
use crate::result::success;
use serde_json::json;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, OnceLock, Weak};

/// `vault-unlock` takes a passphrase and returns a key; `dice-roll` reads nothing secret.
struct Vault;

#[async_trait]
impl CommandHandler for Vault {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        success(json!({"key": "SECRET-VAULT-KEY"}))
    }
}

struct Roll;

#[async_trait]
impl CommandHandler for Roll {
    async fn execute(&self, _input: Value, context: CommandContext) -> CommandResult<Value> {
        success(json!({"rolled": context.random().next()}))
    }
}

fn vault_unlock() -> CommandDefinition {
    CommandDefinition::new(
        "vault-unlock",
        "Unlock the vault",
        vec![CommandParameter::required_string(
            "passphrase",
            "The passphrase",
        )],
        Vault,
    )
    .as_secret()
}

fn dice_roll() -> CommandDefinition {
    CommandDefinition::new("dice-roll", "Roll a die", vec![], Roll)
}

fn vault() -> Arc<CommandRegistry> {
    let registry = Arc::new(CommandRegistry::new());
    registry.register(vault_unlock()).unwrap();
    registry.register(dice_roll()).unwrap();
    registry
}

fn with_journal(
    registry: &CommandRegistry,
    configure: impl FnOnce(JournalRecorder) -> JournalRecorder,
) -> Arc<MemoryJournalSink> {
    let sink = Arc::new(MemoryJournalSink::new());
    registry.set_journal(configure(JournalRecorder::new(sink.clone())));
    sink
}

async fn unlock_then_roll(registry: &CommandRegistry) {
    let unlocked = registry
        .execute("vault-unlock", json!({"passphrase": "hunter2"}), None)
        .await;
    assert!(unlocked.success, "{unlocked:?}");
    registry.execute("dice-roll", json!({}), None).await;
}

fn commands(sink: &MemoryJournalSink) -> Vec<String> {
    sink.entries().into_iter().map(|e| e.command).collect()
}

fn holds_no_secret(sink: &MemoryJournalSink) {
    let text = serialize_journal(&sink.entries());
    assert!(
        !text.contains("hunter2") && !text.contains("SECRET"),
        "{text}"
    );
}

#[test]
fn a_command_is_not_secret_unless_declared() {
    assert!(!dice_roll().secret);
    assert!(vault_unlock().secret);
}

#[tokio::test]
async fn never_records_a_command_that_declares_secret_without_redact_whatever_its_name_or_filter() {
    let registry = vault();
    for configure in [
        |recorder: JournalRecorder| recorder,
        |recorder: JournalRecorder| recorder.with_filter(|_| true),
        |recorder: JournalRecorder| recorder.with_record_failures(true).with_filter(|_| true),
    ] {
        let sink = with_journal(&registry, configure);
        unlock_then_roll(&registry).await;
        assert_eq!(commands(&sink), ["dice-roll"]);
        holds_no_secret(&sink);
    }

    // With redact, the host removes the secret, and the call is recorded.
    let sink = with_journal(&registry, |recorder| {
        recorder.with_filter(|_| true).with_redact(|mut record| {
            record.input = json!({});
            record.result.data = None;
            Some(record)
        })
    });
    unlock_then_roll(&registry).await;
    assert_eq!(commands(&sink), ["vault-unlock", "dice-roll"]);
    holds_no_secret(&sink);

    // A DirectClient runs the same registry, so the same rule holds there.
    let sink = with_journal(&registry, |recorder| recorder.with_filter(|_| true));
    DirectClient::new(Arc::clone(&registry))
        .call("vault-unlock", json!({"passphrase": "hunter2"}), None)
        .await;
    assert!(sink.entries().is_empty());
}

#[tokio::test]
async fn tells_redact_which_calls_are_secret_and_uses_the_redact_it_was_built_with() {
    let registry = vault();
    let seen: Arc<Mutex<Vec<(String, bool)>>> = Arc::default();
    let log = Arc::clone(&seen);
    let sink = with_journal(&registry, |recorder| {
        recorder
            .with_filter(|_| true)
            .with_redact_info(move |record, info| {
                log.lock()
                    .unwrap()
                    .push((record.command.clone(), info.secret));
                (!info.secret).then_some(record)
            })
    });
    unlock_then_roll(&registry).await;
    // Through a DirectClient too: the recorder runs inside the registry, so it always knows.
    DirectClient::new(Arc::clone(&registry))
        .call("dice-roll", json!({}), None)
        .await;
    assert_eq!(
        *seen.lock().unwrap(),
        [
            ("vault-unlock".to_string(), true),
            ("dice-roll".to_string(), false),
            ("dice-roll".to_string(), false),
        ]
    );
    assert_eq!(commands(&sink), ["dice-roll", "dice-roll"]);

    // A later `with_redact` replaces the redactor: the one that decides is the one applied.
    let sink = with_journal(&registry, |recorder| {
        recorder
            .with_filter(|_| true)
            .with_redact_info(|_, _| None)
            .with_redact(Some)
    });
    unlock_then_roll(&registry).await;
    assert_eq!(commands(&sink), ["vault-unlock", "dice-roll"]);
}

/// Replaces the registry's journal with one that has no redactor, then returns.
struct Swap(Arc<OnceLock<Weak<CommandRegistry>>>, Arc<MemoryJournalSink>);

#[async_trait]
impl CommandHandler for Swap {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        if let Some(registry) = self.0.get().and_then(Weak::upgrade) {
            registry.set_journal(JournalRecorder::new(self.1.clone()).with_filter(|_| true));
        }
        success(json!({"key": "SECRET-SWAPPED"}))
    }
}

#[tokio::test]
async fn the_recorder_that_admits_a_secret_call_is_the_one_that_redacts_it() {
    let slot: Arc<OnceLock<Weak<CommandRegistry>>> = Arc::default();
    let unredacted = Arc::new(MemoryJournalSink::new());
    let registry = Arc::new(CommandRegistry::new());
    slot.set(Arc::downgrade(&registry)).unwrap();
    registry
        .register(
            CommandDefinition::new(
                "vault-swap",
                "Swap the journal",
                vec![],
                Swap(slot, unredacted.clone()),
            )
            .as_secret(),
        )
        .unwrap();
    let sink = with_journal(&registry, |recorder| {
        recorder.with_redact_info(|mut record, info| {
            assert!(info.secret);
            record.result.data = None;
            Some(record)
        })
    });
    registry.execute("vault-swap", json!({}), None).await;
    assert_eq!(commands(&sink), ["vault-swap"]);
    holds_no_secret(&sink);
    assert!(unredacted.entries().is_empty());
}

/// `token-mint` (secret) reads the clock once and draws `draws` random values; `session-open`
/// calls it with its context, `session-fresh` with a fresh context holding only its clock and
/// random source, `session-host` with both wrapped in a host's own sources that forward nothing,
/// and `session-direct` through `CommandDefinition::execute`; `session-wrap` calls
/// `session-open`.
struct Nested(&'static str, usize, Arc<OnceLock<Weak<CommandRegistry>>>);

#[async_trait]
impl CommandHandler for Nested {
    async fn execute(&self, _input: Value, context: CommandContext) -> CommandResult<Value> {
        let registry = self.2.get().and_then(Weak::upgrade).expect("the registry");
        match self.0 {
            "token-mint" => {
                context.clock().now();
                let token: Vec<String> = (0..self.1)
                    .map(|_| context.random().next().to_string())
                    .collect();
                success(json!({"token": format!("T-{}", token.join("-"))}))
            }
            "session-direct" => {
                let mint = CommandDefinition::new(
                    "token-mint",
                    "token-mint",
                    vec![],
                    Nested("token-mint", self.1, Arc::clone(&self.2)),
                )
                .as_secret();
                assert!(mint.execute(json!({}), context).await.success);
                success(json!({"opened": true}))
            }
            "session-open" | "session-fresh" | "session-host" => {
                let context = match self.0 {
                    // A fresh context that carries only the recording sources, none of the
                    // journal state the registry put on this call's context.
                    "session-fresh" => {
                        let mut fresh = CommandContext::new();
                        fresh.clock.clone_from(&context.clock);
                        fresh.random.clone_from(&context.random);
                        fresh
                    }
                    "session-host" => {
                        let mut hosted = context.clone();
                        hosted.clock = context
                            .clock
                            .clone()
                            .map(|clock| Arc::new(HostClock(clock)) as Arc<dyn Clock>);
                        hosted.random = context
                            .random
                            .clone()
                            .map(|random| Arc::new(HostRandom(random)) as Arc<dyn RandomSource>);
                        hosted
                    }
                    _ => context,
                };
                let minted = registry
                    .execute("token-mint", json!({}), Some(context))
                    .await;
                assert!(minted.success, "{minted:?}");
                success(json!({"opened": true}))
            }
            _ => {
                let opened = registry
                    .execute("session-open", json!({}), Some(context))
                    .await;
                assert!(opened.success, "{opened:?}");
                success(json!({"wrapped": true}))
            }
        }
    }
}

/// A host's own clock around another, forwarding nothing but readings.
struct HostClock(Arc<dyn Clock>);

impl Clock for HostClock {
    fn now(&self) -> i64 {
        self.0.now()
    }
}

/// A host's own random source around another, forwarding nothing but values.
struct HostRandom(Arc<dyn RandomSource>);

impl RandomSource for HostRandom {
    fn next(&self) -> f64 {
        self.0.next()
    }
}

/// A random source that counts its draws: 0.26, 0.27, ...
struct Counting(Arc<AtomicU32>);

impl RandomSource for Counting {
    fn next(&self) -> f64 {
        let n = self.0.fetch_add(1, Ordering::SeqCst) + 1;
        (25.0 + f64::from(n)) / 100.0
    }
}

fn sessions(mint_draws: usize) -> Arc<CommandRegistry> {
    let slot: Arc<OnceLock<Weak<CommandRegistry>>> = Arc::default();
    let registry = Arc::new(CommandRegistry::new());
    slot.set(Arc::downgrade(&registry)).unwrap();
    for name in [
        "token-mint",
        "session-open",
        "session-fresh",
        "session-host",
        "session-direct",
        "session-wrap",
    ] {
        let command = CommandDefinition::new(
            name,
            name,
            vec![],
            Nested(name, mint_draws, Arc::clone(&slot)),
        );
        let command = if name == "token-mint" {
            command.as_secret()
        } else {
            command
        };
        registry.register(command).unwrap();
    }
    registry
}

fn counting(draws: &Arc<AtomicU32>) -> CommandContext {
    CommandContext::new().with_random(Counting(Arc::clone(draws)))
}

#[tokio::test]
async fn keeps_a_secret_nested_call_off_its_recorded_parents_tape_and_marks_that_tape() {
    let registry = sessions(2);
    let draws = Arc::new(AtomicU32::new(0));
    let sink = with_journal(&registry, |recorder| recorder);
    let result = registry
        .execute("session-open", json!({}), Some(counting(&draws)))
        .await;
    assert!(result.success, "{result:?}");
    let entries = sink.entries();
    assert_eq!(commands(&sink), ["session-open"]);
    let tape = entries[0].tape.as_ref().expect("a truncated tape");
    assert!(tape.random.is_empty());
    assert!(tape.truncated);
    assert_eq!(draws.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn keeps_a_recorded_secret_nested_calls_reads_on_its_own_entry_never_its_parents() {
    let registry = sessions(1);
    let draws = Arc::new(AtomicU32::new(0));
    // A redact that keeps every record: the secret call is recorded, its secret left to redact.
    let sink = with_journal(&registry, |recorder| recorder.with_redact(Some));
    registry
        .execute("session-open", json!({}), Some(counting(&draws)))
        .await;
    let entries = sink.entries();
    assert_eq!(commands(&sink), ["token-mint", "session-open"]);
    assert_eq!(entries[0].tape.as_ref().unwrap().random, [0.26]);
    let parent = entries[1].tape.as_ref().expect("a truncated tape");
    assert!(parent.random.is_empty());
    assert!(parent.truncated);
}

#[tokio::test]
async fn every_recording_ancestors_tape_is_marked_not_only_the_nearest() {
    let registry = sessions(1);
    let draws = Arc::new(AtomicU32::new(0));
    let sink = with_journal(&registry, |recorder| recorder);
    registry
        .execute("session-wrap", json!({}), Some(counting(&draws)))
        .await;
    let entries = sink.entries();
    assert_eq!(commands(&sink), ["session-open", "session-wrap"]);
    for entry in &entries {
        let tape = entry.tape.as_ref().expect("a truncated tape");
        assert!(tape.random.is_empty(), "{}", entry.command);
        assert!(tape.truncated, "{}", entry.command);
    }
}

#[tokio::test]
async fn a_secret_call_with_no_recording_parent_leaves_its_sources_alone() {
    let registry = sessions(1);
    let draws = Arc::new(AtomicU32::new(0));
    let sink = with_journal(&registry, |recorder| recorder.with_redact(Some));
    registry
        .execute("token-mint", json!({}), Some(counting(&draws)))
        .await;
    let entries = sink.entries();
    assert_eq!(commands(&sink), ["token-mint"]);
    let tape = entries[0].tape.as_ref().unwrap();
    assert_eq!(tape.random, [0.26]);
    assert!(!tape.truncated);
}

#[tokio::test]
async fn a_fresh_context_holding_the_parents_recording_sources_still_reads_off_its_tape() {
    let registry = sessions(2);
    let draws = Arc::new(AtomicU32::new(0));
    let sink = with_journal(&registry, |recorder| recorder);
    let result = registry
        .execute("session-fresh", json!({}), Some(counting(&draws)))
        .await;
    assert!(result.success, "{result:?}");
    let entries = sink.entries();
    assert_eq!(commands(&sink), ["session-fresh"]);
    let tape = entries[0].tape.as_ref().expect("a truncated tape");
    assert!(tape.random.is_empty());
    assert!(tape.truncated);
    assert_eq!(draws.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn a_context_saved_from_a_finished_call_carries_no_declaration_into_the_next() {
    // A middleware passes `next` the context it kept from an earlier, non-secret call: the
    // declaration is read from the command running now, never from the context.
    let registry = vault();
    let kept: Arc<Mutex<Option<CommandContext>>> = Arc::default();
    let slot = Arc::clone(&kept);
    registry.add_middleware(Arc::new(move |_, _, context, next| {
        let mut slot = slot.lock().unwrap();
        let passed = slot.clone().unwrap_or_else(|| context.clone());
        slot.get_or_insert(context);
        next(passed)
    }));
    let sink = with_journal(&registry, |recorder| recorder.with_filter(|_| true));
    registry.execute("dice-roll", json!({}), None).await;
    let saved = kept.lock().unwrap().clone();
    unlock_then_roll(&registry).await;
    // The saved context itself, given back by the caller.
    registry
        .execute("vault-unlock", json!({"passphrase": "hunter2"}), saved)
        .await;
    assert_eq!(commands(&sink), ["dice-roll", "dice-roll"]);
    holds_no_secret(&sink);

    let seen: Arc<Mutex<Vec<bool>>> = Arc::default();
    let log = Arc::clone(&seen);
    with_journal(&registry, |recorder| {
        recorder.with_redact_info(move |record, info| {
            log.lock().unwrap().push(info.secret);
            Some(record)
        })
    });
    unlock_then_roll(&registry).await;
    assert_eq!(*seen.lock().unwrap(), [true, false]);
}

/// Runs `target` on `next`'s registry with its own context, as a host's separate chain would:
/// `relay-secret` (secret) runs `dice-roll`, `relay-plain` runs `vault-unlock` (secret).
struct Relay(Arc<CommandRegistry>, &'static str);

#[async_trait]
impl CommandHandler for Relay {
    async fn execute(&self, _input: Value, context: CommandContext) -> CommandResult<Value> {
        let input = if self.1 == "vault-unlock" {
            json!({"passphrase": "hunter2"})
        } else {
            json!({})
        };
        let result = self.0.execute(self.1, input, Some(context)).await;
        assert!(result.success, "{result:?}");
        success(json!({"relayed": self.1}))
    }
}

#[tokio::test]
async fn another_registry_handed_the_context_reads_its_own_commands_declaration() {
    let inner = vault();
    let inner_sink = with_journal(&inner, |recorder| recorder.with_filter(|_| true));
    let outer = CommandRegistry::new();
    let relay = |name, target| {
        CommandDefinition::new(name, name, vec![], Relay(Arc::clone(&inner), target))
    };
    outer
        .register(relay("relay-secret", "dice-roll").as_secret())
        .unwrap();
    outer
        .register(relay("relay-plain", "vault-unlock"))
        .unwrap();
    let outer_sink = with_journal(&outer, |recorder| recorder.with_filter(|_| true));

    outer.execute("relay-secret", json!({}), None).await;
    outer.execute("relay-plain", json!({}), None).await;
    // The secret relay's context does not make the inner `dice-roll` secret, and the plain
    // relay's does not make the inner `vault-unlock` recordable.
    assert_eq!(commands(&inner_sink), ["dice-roll"]);
    assert_eq!(commands(&outer_sink), ["relay-plain"]);
    holds_no_secret(&inner_sink);
}

#[tokio::test]
async fn a_middleware_that_runs_the_rest_of_the_chain_on_another_task_changes_nothing() {
    let registry = vault();
    registry.add_middleware(Arc::new(|_, _, context, next| {
        Box::pin(async move { tokio::spawn(next(context)).await.expect("the chain") })
    }));
    let sink = with_journal(&registry, |recorder| recorder.with_filter(|_| true));
    unlock_then_roll(&registry).await;
    assert_eq!(commands(&sink), ["dice-roll"]);

    let seen: Arc<Mutex<Vec<bool>>> = Arc::default();
    let log = Arc::clone(&seen);
    let sink = with_journal(&registry, |recorder| {
        recorder.with_redact_info(move |record, info| {
            log.lock().unwrap().push(info.secret);
            Some(record)
        })
    });
    unlock_then_roll(&registry).await;
    assert_eq!(*seen.lock().unwrap(), [true, false]);
    assert_eq!(commands(&sink), ["vault-unlock", "dice-roll"]);
}

type Spawned = Arc<Mutex<Option<tokio::task::JoinHandle<CommandResult<Value>>>>>;

/// A secret command whose handler spawns a task that, once released, runs `dice-roll` with the
/// handler's context, after the secret call has returned.
struct Outliving(
    Arc<OnceLock<Weak<CommandRegistry>>>,
    Arc<tokio::sync::Notify>,
    Spawned,
);

#[async_trait]
impl CommandHandler for Outliving {
    async fn execute(&self, _input: Value, context: CommandContext) -> CommandResult<Value> {
        let registry = self.0.get().and_then(Weak::upgrade).expect("the registry");
        let release = Arc::clone(&self.1);
        let task = tokio::spawn(async move {
            release.notified().await;
            registry
                .execute("dice-roll", json!({}), Some(context))
                .await
        });
        *self.2.lock().unwrap() = Some(task);
        success(json!({"key": "SECRET-LATER"}))
    }
}

#[tokio::test]
async fn a_task_that_outlives_a_secret_call_reads_its_own_commands_declaration() {
    let slot: Arc<OnceLock<Weak<CommandRegistry>>> = Arc::default();
    let release = Arc::new(tokio::sync::Notify::new());
    let spawned: Spawned = Arc::default();
    let registry = vault();
    slot.set(Arc::downgrade(&registry)).unwrap();
    registry
        .register(
            CommandDefinition::new(
                "vault-later",
                "Unlock later",
                vec![],
                Outliving(slot, Arc::clone(&release), Arc::clone(&spawned)),
            )
            .as_secret(),
        )
        .unwrap();
    let seen: Arc<Mutex<Vec<(String, bool)>>> = Arc::default();
    let log = Arc::clone(&seen);
    let sink = with_journal(&registry, |recorder| {
        recorder.with_redact_info(move |record, info| {
            log.lock()
                .unwrap()
                .push((record.command.clone(), info.secret));
            (!info.secret).then_some(record)
        })
    });
    assert!(
        registry
            .execute("vault-later", json!({}), None)
            .await
            .success
    );
    release.notify_one();
    let task = spawned.lock().unwrap().take().expect("the spawned task");
    assert!(task.await.unwrap().success);
    assert_eq!(
        *seen.lock().unwrap(),
        [
            ("vault-later".to_string(), true),
            ("dice-roll".to_string(), false),
        ]
    );
    assert_eq!(commands(&sink), ["dice-roll"]);
    holds_no_secret(&sink);
}

/// Run `parent` on a fresh recorder (redacting, when `redact`) and return the entries.
async fn sessions_entry(parent: &str, redact: bool) -> (Vec<JournalEntry>, u32) {
    let registry = sessions(2);
    let draws = Arc::new(AtomicU32::new(0));
    let sink = with_journal(&registry, |recorder| {
        if redact {
            recorder.with_redact(Some)
        } else {
            recorder
        }
    });
    let result = registry
        .execute(parent, json!({}), Some(counting(&draws)))
        .await;
    assert!(result.success, "{result:?}");
    (sink.entries(), draws.load(Ordering::SeqCst))
}

fn assert_off_tape(entry: &JournalEntry) {
    let tape = entry.tape.as_ref().expect("a truncated tape");
    assert!(tape.clock.is_empty(), "{}: {tape:?}", entry.command);
    assert!(tape.random.is_empty(), "{}: {tape:?}", entry.command);
    assert!(tape.truncated, "{}", entry.command);
}

#[tokio::test]
async fn a_hosts_wrapped_clock_and_random_source_leak_nothing_onto_the_parents_tape() {
    let (entries, draws) = sessions_entry("session-host", false).await;
    assert_eq!(draws, 2);
    assert_eq!(entries.len(), 1);
    assert_off_tape(&entries[0]);

    // Recorded too, the secret call keeps its own reads, through the host's wrappers.
    let (entries, _) = sessions_entry("session-host", true).await;
    let names: Vec<&str> = entries.iter().map(|e| e.command.as_str()).collect();
    assert_eq!(names, ["token-mint", "session-host"]);
    let own = entries[0].tape.as_ref().expect("the child's own tape");
    assert_eq!(own.random, [0.26, 0.27]);
    assert_eq!(own.clock.len(), 1);
    assert!(!own.truncated);
    assert_off_tape(&entries[1]);
}

#[tokio::test]
async fn calling_a_secret_definition_directly_still_reads_off_the_parents_tape() {
    let (entries, draws) = sessions_entry("session-direct", false).await;
    assert_eq!(draws, 2);
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].command, "session-direct");
    assert_off_tape(&entries[0]);
}

#[tokio::test]
async fn a_registry_recorded_secret_call_keeps_its_clock_and_random_reads() {
    let (entries, _) = sessions_entry("session-open", true).await;
    let own = entries[0].tape.as_ref().expect("the child's own tape");
    assert_eq!(entries[0].command, "token-mint");
    assert_eq!(own.random, [0.26, 0.27]);
    assert_eq!(own.clock.len(), 1);
    assert!(!own.truncated);
    assert_off_tape(&entries[1]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_middleware_that_moves_the_chain_to_another_task_keeps_the_handler_in_its_scope() {
    // The secret call's handler runs on a task the middleware spawned and reads through a
    // host's wrappers: its reads still never reach the parent's tape.
    let registry = sessions(2);
    registry.add_middleware(Arc::new(|_, _, context, next| {
        Box::pin(async move { tokio::spawn(next(context)).await.expect("the chain") })
    }));
    let draws = Arc::new(AtomicU32::new(0));
    let sink = with_journal(&registry, |recorder| recorder);
    let result = registry
        .execute("session-host", json!({}), Some(counting(&draws)))
        .await;
    assert!(result.success, "{result:?}");
    assert_eq!(draws.load(Ordering::SeqCst), 2);
    let entries = sink.entries();
    assert_eq!(commands(&sink), ["session-host"]);
    assert_off_tape(&entries[0]);
}

/// A secret command whose handler hands its context to the test and waits to be released.
struct Hold(
    Arc<Mutex<Option<CommandContext>>>,
    Arc<tokio::sync::Notify>,
    Arc<tokio::sync::Notify>,
);

#[async_trait]
impl CommandHandler for Hold {
    async fn execute(&self, _input: Value, context: CommandContext) -> CommandResult<Value> {
        *self.0.lock().unwrap() = Some(context);
        self.1.notify_one();
        self.2.notified().await;
        success(json!({"held": true}))
    }
}

#[tokio::test]
async fn a_sibling_secret_call_reading_through_a_wrapper_never_reaches_another_calls_tape() {
    let registry = sessions(2);
    let handed: Arc<Mutex<Option<CommandContext>>> = Arc::default();
    let ready = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    registry
        .register(
            CommandDefinition::new(
                "vault-hold",
                "Hold",
                vec![],
                Hold(
                    Arc::clone(&handed),
                    Arc::clone(&ready),
                    Arc::clone(&release),
                ),
            )
            .as_secret(),
        )
        .unwrap();
    // Both secret calls are recorded, so each has a tape of its own.
    let sink = with_journal(&registry, |recorder| recorder.with_redact(Some));
    let draws = Arc::new(AtomicU32::new(0));
    let held = {
        let registry = Arc::clone(&registry);
        let context = counting(&draws);
        tokio::spawn(async move {
            registry
                .execute("vault-hold", json!({}), Some(context))
                .await
        })
    };
    ready.notified().await;
    // A second, sibling secret call, given the held call's recording sources inside a host's
    // own wrappers.
    let given = handed.lock().unwrap().take().expect("the held context");
    let mut hosted = CommandContext::new();
    hosted.clock = given
        .clock
        .clone()
        .map(|clock| Arc::new(HostClock(clock)) as Arc<dyn Clock>);
    hosted.random = given
        .random
        .clone()
        .map(|random| Arc::new(HostRandom(random)) as Arc<dyn RandomSource>);
    let minted = registry
        .execute("token-mint", json!({}), Some(hosted))
        .await;
    assert!(minted.success, "{minted:?}");
    release.notify_one();
    assert!(held.await.unwrap().success);

    let entries = sink.entries();
    assert_eq!(commands(&sink), ["token-mint", "vault-hold"]);
    assert_eq!(entries[0].tape.as_ref().unwrap().random, [0.26, 0.27]);
    assert_off_tape(&entries[1]);
}
