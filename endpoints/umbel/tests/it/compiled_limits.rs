//! The bound and the deadline of compiled-plugin calls (decision D204): at most
//! `limits.compiled_calls` run at once, a call past the bound waits up to
//! `limits.compiled_timeout_ms` and answers `HOST_UMBEL_PLUGIN_BUSY` without running, and a call that runs
//! past the deadline answers `OUTCOME_UNKNOWN`. An SDK call keeps its turn until the plugin
//! returns, gets no host service after it, and has its late result dropped, never journaled as
//! its result; an async handler past it is cancelled and frees its turn. The bound and the
//! deadline cover every form a compiled plugin registers, and spare the host's own command line; `store.max_connections` caps a host call's store work. Also the three keys'
//! configuration: version 7 only, with their defaults and ranges. The boundary cases (a turn or a
//! result at the deadline, a cancel while waiting, a caller's shorter `timeout_ms`) are the unit
//! tests of `src/plugins/compiled_gate.rs`; the task exemption and the MCP path are in `tasks.rs`.
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use crate::support;
use serde_json::{Value, json};
use support::plugins::{grants_toml, leak, seal};
use support::{agent, call};
use umbel::plugins::{PluginCommand, sdk};
use umbel::workspace::{
    DEFAULT_COMPILED_CALLS, DEFAULT_COMPILED_TIMEOUT_MS, DEFAULT_STORE_MAX_CONNECTIONS, Workspace,
};
use umbel_sdk::{Cx, HostError, Outcome, Plugin};

const INPUT: &str = "{ type = \"object\", properties = {}, additionalProperties = false }";
const SLEEP_INPUT: &str = "{ type = \"object\", properties = { ms = { type = \"integer\" } }, additionalProperties = false }";

/// What the slow plugin's calls did, shared with the test.
#[derive(Default)]
struct Seen {
    /// `slow-hold` calls that entered the plugin.
    entered: usize,
    /// `slow-hold` calls that returned.
    returned: usize,
    /// `slow-quick` calls that ran.
    quick: usize,
    /// What each released `slow-hold` call's host service answered: `ok` or `refused`.
    late: Vec<String>,
    /// Whether the held calls may return.
    released: bool,
}

#[derive(Clone, Default)]
struct Shared(Arc<(Mutex<Seen>, Condvar)>);

impl Shared {
    fn with<T>(&self, f: impl FnOnce(&mut Seen) -> T) -> T {
        let (seen, changed) = &*self.0;
        let out = f(&mut seen.lock().unwrap());
        changed.notify_all();
        out
    }

    /// Wait until `ready` holds, at most five seconds.
    fn until(&self, what: &str, ready: impl Fn(&Seen) -> bool) {
        let (seen, changed) = &*self.0;
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut guard = seen.lock().unwrap();
        while !ready(&guard) {
            let left = deadline.saturating_duration_since(Instant::now());
            assert!(!left.is_zero(), "timed out waiting for {what}");
            guard = changed.wait_timeout(guard, left).unwrap().0;
        }
    }

    fn release(&self) {
        self.with(|seen| seen.released = true);
    }
}

/// Releases the held calls when a test ends, passing or failing, so a blocked plugin thread
/// never keeps the test's runtime from shutting down.
struct ReleaseOnDrop(Shared);

impl Drop for ReleaseOnDrop {
    fn drop(&mut self) {
        let (seen, changed) = &*(self.0).0;
        seen.lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .released = true;
        changed.notify_all();
    }
}

/// A compiled SDK plugin: `slow-hold` blocks until the test releases it, then asks for a host
/// service and returns a result; `slow-quick` returns at once.
struct Slow {
    shared: Shared,
}

impl Plugin for Slow {
    fn manifest(&self) -> &'static str {
        leak(format!(
            r#"manifest_version = 1
protocol = 1

[plugin]
id = "slow"
title = "Slow"
version = "0.1.0"
description = "A plugin whose calls wait for the test."
kind = "compiled"
domains = ["slow"]

{grants}
[[commands]]
name = "slow-hold"
description = "Wait for the test, then use a host service."
effects = ["plugin-state"]
input_schema = {INPUT}

[[commands]]
name = "slow-quick"
description = "Return at once."
effects = ["inspect"]
input_schema = {INPUT}

[[commands]]
name = "slow-sleep"
description = "Sleep `ms` milliseconds, then return."
effects = ["inspect"]
input_schema = {SLEEP_INPUT}
"#,
            grants = grants_toml(&["config"], true)
        ))
    }

    fn handle(&self, name: &str, input: Value, cx: &mut Cx) -> Outcome {
        match name {
            "slow-hold" => {
                self.shared.with(|seen| seen.entered += 1);
                let (seen, changed) = &*self.shared.0;
                drop(
                    changed
                        .wait_while(seen.lock().unwrap(), |seen| !seen.released)
                        .unwrap(),
                );
                let late = match cx.config() {
                    Ok(_) => "ok",
                    Err(HostError::NotGranted(_)) => "refused",
                    Err(_) => "other",
                };
                self.shared.with(|seen| {
                    seen.late.push(late.to_owned());
                    seen.returned += 1;
                });
                umbel_sdk::success(json!({ "wrote": true }))
            }
            "slow-quick" => {
                self.shared.with(|seen| seen.quick += 1);
                umbel_sdk::success(json!({ "quick": true }))
            }
            "slow-sleep" => {
                let ms = input["ms"].as_u64().unwrap_or(0);
                std::thread::sleep(Duration::from_millis(ms));
                umbel_sdk::success(json!({ "slept": ms }))
            }
            other => umbel_sdk::failure("NOT_FOUND", other, "Call a slow command."),
        }
    }
}

fn workspace(limits: &str) -> tempfile::TempDir {
    workspace_with(&["slow"], limits, "")
}

/// A version 7 workspace enabling `enabled`, with `limits` in `[limits]` and `store` in `[store]`.
fn workspace_with(enabled: &[&str], limits: &str, store: &str) -> tempfile::TempDir {
    let enabled: Vec<String> = enabled.iter().map(|id| format!("\"{id}\"")).collect();
    support::workspace(&format!(
        "config_version = 7\ndefault_space = \"main\"\n\n[spaces.main]\n\n[plugins]\nenabled = [{}]\n\n[journal]\nrecord_failures = true\n\n[limits]\n{limits}\n\n[store]\n{store}\n",
        enabled.join(", ")
    ))
}

fn host(dir: &std::path::Path, shared: &Shared) -> Arc<umbel::Host> {
    let plugin = Slow {
        shared: shared.clone(),
    };
    Arc::new(seal(dir, |b| b.with_compiled(sdk(plugin))).unwrap())
}

fn spawn_call(
    host: &Arc<umbel::Host>,
    command: &'static str,
) -> tokio::task::JoinHandle<afd::CommandResult<Value>> {
    let host = Arc::clone(host);
    tokio::spawn(async move { call(&host, agent("a"), command, json!({})).await })
}

#[track_caller]
fn code(result: &afd::CommandResult<Value>) -> &str {
    assert!(!result.success, "{result:?}");
    result
        .error
        .as_ref()
        .map(|error| error.code.as_str())
        .unwrap()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_call_past_its_deadline_answers_outcome_unknown_and_its_late_result_is_dropped() {
    let dir = workspace("compiled_calls = 1\ncompiled_timeout_ms = 300");
    let shared = Shared::default();
    let _release = ReleaseOnDrop(shared.clone());
    let host = host(dir.path(), &shared);

    let started = Instant::now();
    let held = spawn_call(&host, "slow-hold");
    let result = tokio::time::timeout(Duration::from_secs(5), held)
        .await
        .expect("the host answers by the call's deadline, the plugin still running")
        .unwrap();
    assert!(started.elapsed() >= Duration::from_millis(300));
    assert_eq!(code(&result), "OUTCOME_UNKNOWN", "{result:?}");
    let error = result.error.as_ref().unwrap();
    assert_eq!(
        error.retryable,
        Some(false),
        "never retried: it may have run"
    );
    assert!(
        error
            .suggestion
            .as_deref()
            .is_some_and(|text| text.contains("Check the command's effect")),
        "{error:?}"
    );
    assert!(result.data.is_none(), "the plugin's result is not reported");

    // The plugin still holds its turn: another call cannot run until it returns.
    let busy = call(&host, agent("a"), "slow-quick", json!({})).await;
    assert_eq!(code(&busy), "HOST_UMBEL_PLUGIN_BUSY", "{busy:?}");
    assert_eq!(shared.with(|seen| seen.quick), 0);

    // Released, the plugin finds every host service refused, and its result goes nowhere.
    shared.release();
    shared.until("the late call to return", |seen| seen.returned == 1);
    assert_eq!(shared.with(|seen| seen.late.clone()), ["refused"]);
    let entries: Vec<Value> = support::journal_entries(dir.path())
        .iter()
        .map(|entry| serde_json::to_value(entry).unwrap())
        .filter(|entry| entry["command"] == "slow-hold")
        .collect();
    assert_eq!(entries.len(), 1, "{entries:?}");
    assert_eq!(entries[0]["result"]["success"], false, "{entries:?}");
    assert_eq!(entries[0]["result"]["error"]["code"], "OUTCOME_UNKNOWN");
    assert!(
        !entries[0].to_string().contains("wrote"),
        "the late result is not journaled: {entries:?}"
    );

    // Its turn given back, the next call runs.
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let quick = call(&host, agent("a"), "slow-quick", json!({})).await;
        if quick.success {
            assert_eq!(quick.data, Some(json!({ "quick": true })));
            break;
        }
        assert_eq!(code(&quick), "HOST_UMBEL_PLUGIN_BUSY");
        assert!(Instant::now() < deadline, "the turn came back");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn with_n_calls_held_the_next_waits_its_deadline_then_answers_busy_without_running() {
    let dir = workspace("compiled_calls = 2\ncompiled_timeout_ms = 400");
    let shared = Shared::default();
    let _release = ReleaseOnDrop(shared.clone());
    let host = host(dir.path(), &shared);

    let first = spawn_call(&host, "slow-hold");
    let second = spawn_call(&host, "slow-hold");
    shared.until("both held calls to enter the plugin", |seen| {
        seen.entered == 2
    });

    let started = Instant::now();
    let third = call(&host, agent("a"), "slow-quick", json!({})).await;
    assert!(
        started.elapsed() >= Duration::from_millis(300),
        "the call waited for a turn first"
    );
    assert_eq!(code(&third), "HOST_UMBEL_PLUGIN_BUSY", "{third:?}");
    let error = third.error.as_ref().unwrap();
    assert_eq!(
        error.retryable,
        Some(true),
        "it never ran, so a retry is safe"
    );
    assert!(error.message.contains("limits.compiled_calls"), "{error:?}");
    assert_eq!(
        shared.with(|seen| seen.quick),
        0,
        "the refused call never ran"
    );

    shared.release();
    for held in [first, second] {
        assert_eq!(code(&held.await.unwrap()), "OUTCOME_UNKNOWN");
    }
    shared.until("both held calls to return", |seen| seen.returned == 2);
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let quick = call(&host, agent("a"), "slow-quick", json!({})).await;
        if quick.success {
            break;
        }
        assert_eq!(code(&quick), "HOST_UMBEL_PLUGIN_BUSY");
        assert!(Instant::now() < deadline, "the turns came back");
    }
    assert_eq!(shared.with(|seen| seen.quick), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_call_within_its_deadline_answers_as_before() {
    let dir = workspace("compiled_calls = 1\ncompiled_timeout_ms = 5000");
    let shared = Shared::default();
    let _release = ReleaseOnDrop(shared.clone());
    let host = host(dir.path(), &shared);
    shared.release();
    let held = call(&host, agent("a"), "slow-hold", json!({})).await;
    assert!(held.success, "{held:?}");
    assert_eq!(held.data, Some(json!({ "wrote": true })));
    assert_eq!(shared.with(|seen| seen.late.clone()), ["ok"]);
}

fn open(text: &str) -> Result<Workspace, umbel::workspace::WorkspaceError> {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("umbel.toml"), text).unwrap();
    Workspace::open(dir.path())
}

#[test]
fn the_limits_have_their_defaults_ranges_and_version() {
    let config = open("config_version = 7\n").unwrap();
    let config = config.call_limits();
    assert_eq!(config.compiled_calls, DEFAULT_COMPILED_CALLS);
    assert_eq!(config.compiled_timeout_ms, DEFAULT_COMPILED_TIMEOUT_MS);
    assert_eq!(config.max_connections, DEFAULT_STORE_MAX_CONNECTIONS);
    assert_eq!(
        (DEFAULT_COMPILED_CALLS, DEFAULT_COMPILED_TIMEOUT_MS),
        (16, 25_000)
    );
    assert_eq!(DEFAULT_STORE_MAX_CONNECTIONS, 32);

    let set = open(
        "config_version = 7\n\n[limits]\ncompiled_calls = 4\ncompiled_timeout_ms = 1000\n\n[store]\nmax_connections = 8\n",
    )
    .unwrap();
    assert_eq!(set.call_limits().compiled_calls, 4);
    assert_eq!(set.call_limits().compiled_timeout_ms, 1_000);
    assert_eq!(set.call_limits().max_connections, 8);

    for (text, key) in [
        ("[limits]\ncompiled_calls = 0", "limits.compiled_calls"),
        ("[limits]\ncompiled_calls = 1025", "limits.compiled_calls"),
        // At or past AFD's MCP deadline, AFD's retryable TIMEOUT would answer first.
        (
            "[limits]\ncompiled_timeout_ms = 29001",
            "limits.compiled_timeout_ms",
        ),
        (
            "[limits]\ncompiled_timeout_ms = 30000",
            "limits.compiled_timeout_ms",
        ),
        ("[store]\nmax_connections = 0", "store.max_connections"),
        ("[store]\nmax_connections = 1025", "store.max_connections"),
    ] {
        let error = open(&format!("config_version = 7\n\n{text}\n")).expect_err(text);
        assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID", "{text}: {error}");
        assert_eq!(error.key(), Some(key), "{text}: {error}");
    }

    // The keys are version 7's (D188): a version 6 file that sets one is refused.
    for (text, key) in [
        ("[limits]\ncompiled_calls = 4", "limits.compiled_calls"),
        ("[store]\nmax_connections = 4", "store.max_connections"),
    ] {
        let error = open(&format!("config_version = 6\n\n{text}\n")).expect_err(text);
        assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID", "{text}: {error}");
        assert_eq!(error.key(), Some(key), "{text}: {error}");
    }
    let v6 = open("config_version = 6\n").unwrap();
    assert_eq!(v6.call_limits().compiled_calls, DEFAULT_COMPILED_CALLS);
    assert_eq!(
        v6.call_limits().max_connections,
        DEFAULT_STORE_MAX_CONNECTIONS
    );
}

#[test]
fn the_deadline_may_be_set_up_to_a_second_under_afds_mcp_deadline() {
    let set = open("config_version = 7\n\n[limits]\ncompiled_timeout_ms = 29000\n").unwrap();
    assert_eq!(set.call_limits().compiled_timeout_ms, 29_000);
    assert_eq!(
        umbel::workspace::MAX_COMPILED_TIMEOUT_MS,
        afd::DEFAULT_COMMAND_TIMEOUT_MS - 1_000
    );
}

/// A handler a compiled plugin registers itself: it waits on `release`, counting its calls.
struct Direct {
    calls: Arc<AtomicUsize>,
    release: Arc<tokio::sync::Notify>,
}

#[async_trait::async_trait]
impl afd::CommandHandler for Direct {
    async fn execute(
        &self,
        _input: Value,
        _context: afd::CommandContext,
    ) -> afd::CommandResult<Value> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.release.notified().await;
        afd::success(json!({ "direct": true }))
    }
}

fn direct_manifest() -> String {
    format!(
        r#"manifest_version = 1
protocol = 1

[plugin]
id = "direct"
title = "Direct"
version = "0.1.0"
description = "A plugin that registers a handler and a finished definition."
kind = "compiled"
domains = ["direct"]

[[commands]]
name = "direct-handler"
description = "Wait for the test."
effects = ["inspect"]
input_schema = {INPUT}

[[commands]]
name = "direct-definition"
description = "Wait for the test, as a definition."
effects = ["inspect"]
input_schema = {INPUT}
"#
    )
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_handler_and_a_finished_definition_share_the_bound_and_the_deadline_with_sdk_commands() {
    let dir = workspace_with(
        &["slow", "direct"],
        "compiled_calls = 1\ncompiled_timeout_ms = 300",
        "",
    );
    let shared = Shared::default();
    let _release = ReleaseOnDrop(shared.clone());
    let calls = Arc::new(AtomicUsize::new(0));
    let release = Arc::new(tokio::sync::Notify::new());
    let (built_calls, built_release) = (Arc::clone(&calls), Arc::clone(&release));
    let direct = support::plugins::Raw::new(direct_manifest(), move |_| {
        let handler = || Direct {
            calls: Arc::clone(&built_calls),
            release: Arc::clone(&built_release),
        };
        let definition = afd::CommandDefinition::new(
            "direct-definition",
            "Wait for the test, as a definition.",
            vec![],
            handler(),
        );
        let schema = json!({ "type": "object", "properties": {}, "additionalProperties": false });
        Ok(vec![
            PluginCommand::handler("direct-handler", handler()),
            PluginCommand::definition(definition, schema),
        ])
    });
    let plugin = Slow {
        shared: shared.clone(),
    };
    let host = Arc::new(
        seal(dir.path(), |b| {
            b.with_compiled(sdk(plugin)).with_compiled(direct)
        })
        .unwrap(),
    );

    for command in ["direct-handler", "direct-definition"] {
        let before = calls.load(Ordering::SeqCst);
        let held = spawn_call(&host, command);
        let result = tokio::time::timeout(Duration::from_secs(5), held)
            .await
            .expect("the host answers by the deadline")
            .unwrap();
        assert_eq!(code(&result), "OUTCOME_UNKNOWN", "{command}: {result:?}");
        assert_eq!(calls.load(Ordering::SeqCst), before + 1);
        // The direct handler never returns (nothing releases it), but an async handler is
        // cancelled at its deadline and gives its one turn back: the next call is admitted.
        let quick = call(&host, agent("a"), "slow-quick", json!({})).await;
        assert!(quick.success, "{command}: {quick:?}");
    }
    assert_eq!(shared.with(|seen| seen.quick), 2);
    drop(release);

    // And an SDK call holding the turn keeps a direct one out.
    let held = spawn_call(&host, "slow-hold");
    shared.until("the SDK call to enter", |seen| seen.entered == 1);
    let busy = call(&host, agent("a"), "direct-definition", json!({})).await;
    assert_eq!(code(&busy), "HOST_UMBEL_PLUGIN_BUSY", "{busy:?}");
    assert_eq!(
        calls.load(Ordering::SeqCst),
        2,
        "the refused direct call never ran"
    );
    shared.release();
    assert_eq!(code(&held.await.unwrap()), "OUTCOME_UNKNOWN");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_hosts_own_command_line_has_no_deadline() {
    let dir = workspace("compiled_calls = 1\ncompiled_timeout_ms = 100");
    let shared = Shared::default();
    let run = support::cli_with(
        dir.path(),
        &["slow", "sleep", "ms=400"],
        support::Scripted::no_terminal(),
        |b| {
            b.with_compiled(sdk(Slow {
                shared: shared.clone(),
            }))
        },
    )
    .await;
    assert_eq!(run.code, 0, "{}", run.stdout);
    assert_eq!(run.json()["data"], json!({ "slept": 400 }));
    // The same call in a library context has the deadline.
    let host = host(dir.path(), &shared);
    let library = call(&host, agent("a"), "slow-sleep", json!({ "ms": 400 })).await;
    assert_eq!(code(&library), "OUTCOME_UNKNOWN", "{library:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn store_max_connections_caps_a_host_calls_store_work() {
    let dir = workspace_with(&[], "", "max_connections = 1\nlock_timeout_ms = 100");
    let host = seal(dir.path(), |b| b).unwrap();
    let human = afd::Actor::new(afd::ActorKind::Human).with_id("local");
    assert_eq!(host.workspace().call_limits().max_connections, 1);
    let shown = call(&host, human.clone(), "store-show", json!({})).await;
    assert!(shown.success, "{shown:?}");

    let hold = host.workspace().hold_store_turn();
    let busy = call(&host, human.clone(), "store-show", json!({})).await;
    assert_eq!(code(&busy), "STORE_BUSY", "{busy:?}");
    let error = busy.error.as_ref().unwrap();
    assert_eq!(error.retryable, Some(true));
    assert!(
        error
            .suggestion
            .as_deref()
            .is_some_and(|text| text.contains("store.max_connections")),
        "{error:?}"
    );
    drop(hold);
    let shown = call(&host, human, "store-show", json!({})).await;
    assert!(shown.success, "{shown:?}");
}
