//! Grants and host services (phase 1 specification, section 7): each grant of the catalog works
//! when declared and answers `NotGranted` when undeclared or denied, and the load refuses what a
//! required grant cannot be.
use crate::support;
use serde_json::{Value, json};
use support::plugins::{Probe, config, grants_toml, probe_manifest, seal};
use support::{agent, call};
use umbel::plugins::{Manifest, sdk};

const ALL: [&str; 5] = ["config", "packs", "events", "clock", "random"];

fn data(result: &afd::CommandResult<Value>) -> Value {
    assert!(result.success, "{result:?}");
    result.data.clone().unwrap()
}

async fn report(grants: &[&str], instance_body: &str) -> Value {
    let dir = support::workspace(&config(&[("probe", instance_body)], ""));
    let host = seal(dir.path(), |b| b.with_compiled(sdk(Probe::new(grants)))).unwrap();
    data(&call(&host, agent("a"), "probe-grants", json!({})).await)
}

#[tokio::test]
async fn each_grant_works_when_declared() {
    let report = report(&[ALL.as_slice(), &["log"]].concat(), "").await;
    for grant in ["config", "packs", "events", "clock", "random"] {
        assert_eq!(report[grant], "ok", "{grant}: {report}");
    }
}

#[tokio::test]
async fn each_grant_answers_not_granted_when_undeclared() {
    let report = report(&[], "").await;
    for grant in ["config", "packs", "events", "clock", "random"] {
        assert_eq!(report[grant], "not-granted", "{grant}: {report}");
    }
}

#[tokio::test]
async fn an_optional_grant_that_the_deployer_denies_is_withheld_not_failed() {
    let dir = support::workspace(&config(&[("probe", "deny = [\"events\", \"clock\"]")], ""));
    let probe = Probe::optional(&ALL);
    let host = seal(dir.path(), |b| b.with_compiled(sdk(probe))).unwrap();
    let report = data(&call(&host, agent("a"), "probe-grants", json!({})).await);
    assert_eq!(report["events"], "not-granted");
    assert_eq!(report["clock"], "not-granted");
    assert_eq!(report["config"], "ok");
    assert_eq!(report["packs"], "ok");

    // plugin-show says which were withheld, and why.
    let shown = data(&call(&host, agent("a"), "plugin-show", json!({"plugin": "probe"})).await);
    let items = shown["grants"]["items"].as_array().unwrap();
    let status = |name: &str| {
        items
            .iter()
            .find(|item| item["name"] == name)
            .map(|item| item["status"].as_str().unwrap().to_owned())
            .unwrap()
    };
    assert_eq!(status("events"), "withheld");
    assert_eq!(status("config"), "granted");
    assert!(
        items
            .iter()
            .all(|item| !item["reason"].as_str().unwrap().is_empty())
    );
}

#[test]
fn a_denied_required_grant_fails_the_load_with_plugin_grant_denied() {
    let dir = support::workspace(&config(&[("probe", "deny = [\"events\"]")], ""));
    let error = seal(dir.path(), |b| {
        b.with_compiled(sdk(Probe::new(&["events"])))
    })
    .err()
    .unwrap();
    assert_eq!(error.code(), "PLUGIN_GRANT_DENIED");
    assert!(error.message().contains("events"), "{error}");
    assert!(!error.suggestion().is_empty());
}

#[test]
fn each_reserved_grant_is_plugin_grant_unavailable() {
    // `memory` and `memory_write` are in the catalog and still unavailable: `manifest_v3.rs`.
    for grant in ["http", "secrets", "teleport"] {
        let dir = support::workspace(&config(&[("probe", "")], ""));
        let error = seal(dir.path(), |b| b.with_compiled(sdk(Probe::new(&[grant]))))
            .err()
            .unwrap();
        assert_eq!(error.code(), "PLUGIN_GRANT_UNAVAILABLE", "{grant}");
        assert!(error.message().contains(grant), "{error}");
    }
}

#[test]
fn allow_in_a_grants_entry_is_refused_as_reserved() {
    let manifest = probe_manifest(
        "[[grants]]\nname = \"config\"\nreason = \"r\"\nallow = [\"x\"]\n",
        "",
    );
    let error = Manifest::parse(&manifest, "umbel-plugin.toml").unwrap_err();
    assert_eq!(error.code(), "PLUGIN_MANIFEST_INVALID");
    assert!(error.message().contains("allow"), "{error}");
}

#[test]
fn any_grant_on_a_mounted_manifest_is_refused() {
    let manifest = format!(
        r#"manifest_version = 1
protocol = 1
[plugin]
id = "m"
title = "m"
version = "1.0.0"
description = "d"
kind = "mounted"
domains = ["m"]
[mount]
prefix = "m"
transport = "stdio"
command = ["bin/server"]
{}"#,
        grants_toml(&["config"], true)
    );
    let error = Manifest::parse(&manifest, "umbel-plugin.toml").unwrap_err();
    assert_eq!(error.code(), "PLUGIN_MANIFEST_INVALID");
}

#[tokio::test]
async fn events_outside_the_instances_spaces_are_not_granted() {
    let dir = support::workspace(&config(&[("probe", "spaces = [\"main\"]")], ""));
    let host = seal(dir.path(), |b| {
        b.with_compiled(sdk(Probe::new(&["events"])))
    })
    .unwrap();
    // The instance's own space reads.
    let own = call(
        &host,
        agent("a"),
        "probe-events",
        json!({"events_space": "main"}),
    )
    .await;
    assert!(own.success, "{own:?}");
    // Another declared space is not-granted; an undeclared one is invalid.
    let other = call(
        &host,
        agent("a"),
        "probe-events",
        json!({"events_space": "second"}),
    )
    .await;
    assert!(!other.success);
    let extra = &other.metadata.as_ref().unwrap().extra;
    assert_eq!(extra["error_kind"], "not-granted", "{other:?}");
    let nowhere = call(
        &host,
        agent("a"),
        "probe-events",
        json!({"events_space": "nowhere"}),
    )
    .await;
    assert!(!nowhere.success);
    assert_ne!(
        nowhere.metadata.as_ref().unwrap().extra["error_kind"],
        "not-granted"
    );
}

#[tokio::test]
async fn events_read_under_the_callers_principal_and_with_no_space_the_calls_space() {
    let dir = support::workspace(&config(&[("probe", "")], ""));
    let host = seal(dir.path(), |b| {
        b.with_compiled(sdk(Probe::new(&["events"])))
    })
    .unwrap();
    for text in ["one", "two"] {
        let noted = call(&host, agent("writer"), "probe-note", json!({"text": text})).await;
        assert!(noted.success, "{noted:?}");
    }
    let note_in_second = call(
        &host,
        agent("writer"),
        "probe-note",
        json!({"text": "other", "space": "second"}),
    )
    .await;
    assert!(note_in_second.success);

    // Agent `a` acknowledged the first event; its read starts after it. Agent `b` has not.
    let acked = call(
        &host,
        agent("a"),
        "event-ack",
        json!({"cursor": "v0:main:1"}),
    )
    .await;
    assert!(acked.success, "{acked:?}");
    let seen_by = |who: &'static str, input: Value| {
        let host = &host;
        async move {
            let result = call(host, agent(who), "probe-events", input).await;
            data(&result)
        }
    };
    let a = seen_by("a", json!({})).await;
    let b = seen_by("b", json!({})).await;
    assert_eq!(a["events"].as_array().unwrap().len(), 1, "{a}");
    assert_eq!(b["events"].as_array().unwrap().len(), 2, "{b}");
    assert_eq!(a["space"], "main");

    // With no space, the call's resolved space: a call in `second` reads `second`.
    let second = seen_by("b", json!({"space": "second"})).await;
    assert_eq!(second["space"], "second");
    assert_eq!(second["events"].as_array().unwrap().len(), 1, "{second}");

    // The read did not acknowledge anything: `a`'s cursor is where it was.
    let again = seen_by("a", json!({})).await;
    assert_eq!(again["acknowledged"], "v0:main:1");
}

#[tokio::test]
async fn plugin_show_prints_trusted_not_sandboxed_for_a_compiled_instance_only() {
    let dir = support::workspace(&config(&[("probe", ""), ("guide", "")], ""));
    write_pack_plugin(dir.path(), "guide");
    let host = seal(dir.path(), |b| {
        b.with_compiled(sdk(Probe::new(&["config", "clock"])))
    })
    .unwrap();

    let compiled = data(&call(&host, agent("a"), "plugin-show", json!({"plugin": "probe"})).await);
    assert_eq!(compiled["grants"]["trust"], "trusted, not sandboxed");
    assert!(compiled.to_string().contains("trusted, not sandboxed"));
    assert!(!compiled["grants"]["items"].as_array().unwrap().is_empty());

    let pack = data(&call(&host, agent("a"), "plugin-show", json!({"plugin": "guide"})).await);
    assert_eq!(pack["plugin"]["kind"], "pack");
    assert!(
        !pack.to_string().contains("trusted, not sandboxed"),
        "{pack}"
    );
    assert!(pack["grants"].get("trust").is_none());

    let list = data(&call(&host, agent("a"), "plugin-list", json!({})).await);
    let trust: Vec<_> = list["plugins"]
        .as_array()
        .unwrap()
        .iter()
        .map(|plugin| {
            (
                plugin["id"].as_str().unwrap(),
                plugin.get("trust").is_some(),
            )
        })
        .collect();
    assert_eq!(trust, [("probe", true), ("guide", false)]);
}

fn write_pack_plugin(root: &std::path::Path, id: &str) {
    let dir = root.join("plugins").join(id);
    std::fs::create_dir_all(dir.join("packs/voice/data")).unwrap();
    std::fs::write(
        dir.join("umbel-plugin.toml"),
        format!(
            "manifest_version = 1\nprotocol = 1\n[plugin]\nid = \"{id}\"\ntitle = \"{id}\"\nversion = \"1.0.0\"\ndescription = \"d\"\nkind = \"pack\"\n[[packs]]\nid = \"voice\"\npath = \"packs/voice\"\n"
        ),
    )
    .unwrap();
    std::fs::write(
        dir.join("packs/voice/pack.toml"),
        format!("pack_version = 1\nid = \"voice\"\nplugin = \"{id}\"\nversion = \"1.0.0\"\ntitle = \"V\"\ndescription = \"d\"\n"),
    )
    .unwrap();
    std::fs::write(dir.join("packs/voice/data/words.txt"), "hello").unwrap();
}

const STOPPER_MANIFEST: &str = r#"manifest_version = 2
protocol = 1

[plugin]
id = "stopper"
title = "Stopper"
version = "0.1.0"
description = "Test plugin verifying non-task inline cancellation stops host services."
kind = "compiled"
domains = ["stopper"]

[[grants]]
name = "config"
reason = "Reads plugin config after cancellation."

[[grants]]
name = "clock"
reason = "Reads the clock before and after cancellation."

[[grants]]
name = "index"
reason = "Reads index applied revision after cancellation."

[[grants]]
name = "index_write"
reason = "Opens an index writer before cancellation and tests post-cancel steps."

[[commands]]
name = "stopper-work"
description = "Open an index writer, wait on a gate, then attempt further host services."
effects = ["store-write"]
input_schema = { type = "object", properties = {}, additionalProperties = false }
"#;

#[derive(Debug)]
struct CancelReport {
    before_ok: bool,
    config: Result<(), String>,
    now_ms: Result<(), String>,
    derive_head: Result<(), String>,
    checkpoint: Result<(), String>,
    index_applied: Result<(), String>,
    writer_applied: Result<(), String>,
    writer_replace: Result<(), String>,
    writer_clear: Result<(), String>,
    writer_commit: Result<(), String>,
}

struct Stopper {
    entered: std::sync::Mutex<Option<tokio::sync::oneshot::Sender<Result<(), String>>>>,
    release: std::sync::Mutex<Option<std::sync::mpsc::Receiver<()>>>,
    done: std::sync::Mutex<Option<tokio::sync::oneshot::Sender<CancelReport>>>,
}

impl umbel_sdk::Plugin for Stopper {
    fn manifest(&self) -> &'static str {
        STOPPER_MANIFEST
    }

    fn handle(&self, name: &str, _input: Value, cx: &mut umbel_sdk::Cx) -> umbel_sdk::Outcome {
        assert_eq!(name, "stopper-work");
        let before_ok = cx.now_ms().is_ok();
        let mut writer = match cx.index_writer("main") {
            Ok(writer) => writer,
            Err(error) => {
                let message = error.to_string();
                if let Some(tx) = self.entered.lock().unwrap().take() {
                    let _ = tx.send(Err(message.clone()));
                }
                return umbel_sdk::failure("STOPPER_WRITER", &message, "-");
            }
        };
        if let Some(tx) = self.entered.lock().unwrap().take() {
            let _ = tx.send(Ok(()));
        }
        if let Some(rx) = self.release.lock().unwrap().take() {
            let _ = rx.recv_timeout(std::time::Duration::from_secs(10));
        }
        let doc: umbel_sdk::umbel_store::DocId = "doc-1".to_owned();
        let map_host = |res: Result<_, umbel_sdk::HostError>| match res {
            Ok(_) => Ok(()),
            Err(umbel_sdk::HostError::NotGranted(message)) => Err(message),
            Err(other) => Err(format!("UNEXPECTED_VARIANT:{other}")),
        };
        let map_store = |res: umbel_sdk::umbel_store::Result<()>| match res {
            Ok(()) => Ok(()),
            Err(umbel_sdk::umbel_store::StoreError::Invalid(message)) => Err(message),
            Err(other) => Err(format!("UNEXPECTED_STORE_VARIANT:{other}")),
        };
        let report = CancelReport {
            before_ok,
            config: map_host(cx.config().map(|_| ())),
            now_ms: map_host(cx.now_ms().map(|_| ())),
            derive_head: map_host(cx.derive_head("main").map(|_| ())),
            checkpoint: map_host(cx.checkpoint("main")),
            index_applied: map_host(cx.index_applied("main").map(|_| ())),
            writer_applied: map_store(writer.applied().map(|_| ())),
            writer_replace: map_store(writer.replace(&doc, Vec::new())),
            writer_clear: map_store(writer.clear()),
            writer_commit: map_store(writer.commit(1)),
        };
        writer.abort();
        let refused_config = report.config.clone().err().unwrap_or_default();
        if let Some(tx) = self.done.lock().unwrap().take() {
            let _ = tx.send(report);
        }
        umbel_sdk::success(json!({ "refused_config": refused_config }))
    }
}

fn assert_cancelled_report(report: &CancelReport) {
    assert!(
        report.before_ok,
        "host service before cancellation must succeed"
    );
    let checks: [(&str, &Result<(), String>); 9] = [
        ("config", &report.config),
        ("now_ms", &report.now_ms),
        ("derive_head", &report.derive_head),
        ("checkpoint", &report.checkpoint),
        ("index_applied", &report.index_applied),
        ("writer_applied", &report.writer_applied),
        ("writer_replace", &report.writer_replace),
        ("writer_clear", &report.writer_clear),
        ("writer_commit", &report.writer_commit),
    ];
    for (label, outcome) in checks {
        let Err(message) = outcome else {
            panic!("{label} should be refused after cancellation");
        };
        assert!(
            message.starts_with("COMMAND_CANCELLED:"),
            "{label}: expected COMMAND_CANCELLED refusal, got `{message}`"
        );
        assert!(
            !message.contains("TASK_STOPPED") && !message.contains("TASK_SPACE_UNREADABLE"),
            "{label}: non-task refusal must not carry task error text: `{message}`"
        );
    }
}

fn stopper_workspace() -> tempfile::TempDir {
    support::workspace(
        r#"config_version = 3
default_space = "main"

[spaces.main]

[plugins]
enabled = ["stopper"]

[plugins.stopper.grants.index_write]
allow = ["main"]
"#,
    )
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn timed_out_inline_plugin_call_is_refused_subsequent_host_services_and_writer_steps() {
    let dir = stopper_workspace();
    let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
    let (done_tx, done_rx) = tokio::sync::oneshot::channel();
    let stopper = Stopper {
        entered: std::sync::Mutex::new(Some(entered_tx)),
        release: std::sync::Mutex::new(Some(release_rx)),
        done: std::sync::Mutex::new(Some(done_tx)),
    };
    let host = std::sync::Arc::new(seal(dir.path(), |b| b.with_compiled(sdk(stopper))).unwrap());
    // Pre-warm the `main` space stores (SQLite + Tantivy) before arming the command deadline so
    // cold disk initialization cannot race `cx.index_writer("main")` under heavy parallel test load.
    let warm = call(&host, agent("a"), "store-show", json!({"space": "main"})).await;
    assert!(warm.success, "store pre-warm must succeed: {warm:?}");

    let before_counts = umbel::testkit::task_services("stopper-work");

    let run_host = std::sync::Arc::clone(&host);
    let handle = tokio::spawn(async move {
        let ctx = run_host.context(agent("a")).with_timeout(250);
        run_host
            .registry()
            .execute("stopper-work", json!({}), Some(ctx))
            .await
    });

    // Ensure the plugin has entered `handle` and opened its index writer before timing out.
    tokio::time::timeout(std::time::Duration::from_secs(5), entered_rx)
        .await
        .expect("plugin should enter handle")
        .expect("entered channel closed")
        .expect("plugin should open index writer before timeout");

    let result = handle.await.unwrap();
    assert!(!result.success, "timed-out call must fail: {result:?}");
    // The host answers before AFD's own timer for the caller's `timeout_ms` (D204): the plugin
    // started and may still make its change, so the answer is `OUTCOME_UNKNOWN`, not a
    // retryable `TIMEOUT`.
    assert_eq!(
        result.error.as_ref().map(|e| e.code.as_str()),
        Some("OUTCOME_UNKNOWN"),
        "{result:?}"
    );
    assert_eq!(result.error.as_ref().and_then(|e| e.retryable), Some(false));

    // Release the still-running blocking thread and verify every subsequent host service and
    // writer step is refused with COMMAND_CANCELLED.
    release_tx.send(()).unwrap();
    let report = tokio::time::timeout(std::time::Duration::from_secs(5), done_rx)
        .await
        .expect("blocking thread should finish after release")
        .expect("done channel closed");
    assert_cancelled_report(&report);

    // Non-task inline calls must never increment `testkit::task_services`.
    assert_eq!(umbel::testkit::task_services("stopper-work"), before_counts);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn externally_cancelled_inline_plugin_call_refuses_host_services_and_preserves_result() {
    let dir = stopper_workspace();
    let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
    let (done_tx, done_rx) = tokio::sync::oneshot::channel();
    let stopper = Stopper {
        entered: std::sync::Mutex::new(Some(entered_tx)),
        release: std::sync::Mutex::new(Some(release_rx)),
        done: std::sync::Mutex::new(Some(done_tx)),
    };
    let host = std::sync::Arc::new(seal(dir.path(), |b| b.with_compiled(sdk(stopper))).unwrap());
    let before_counts = umbel::testkit::task_services("stopper-work");

    let signal = afd::CancellationSignal::new();
    let run_host = std::sync::Arc::clone(&host);
    let run_signal = signal.clone();
    let handle = tokio::spawn(async move {
        let ctx = run_host.context(agent("a")).with_cancellation(run_signal);
        run_host
            .registry()
            .execute("stopper-work", json!({}), Some(ctx))
            .await
    });

    tokio::time::timeout(std::time::Duration::from_secs(5), entered_rx)
        .await
        .expect("plugin should enter handle")
        .expect("entered channel closed")
        .expect("plugin should open index writer before cancel");

    signal.cancel();
    release_tx.send(()).unwrap();

    let result = handle.await.unwrap();
    // Per spec/execution-controls.md ("In-flight preservation"), an externally cancelled inline
    // call that finishes before any deadline preserves the handler's own CommandResult.
    assert!(
        result.success,
        "in-flight result must be preserved: {result:?}"
    );
    let refused = result
        .data
        .as_ref()
        .and_then(|d| d["refused_config"].as_str())
        .unwrap_or_default();
    assert!(
        refused.starts_with("COMMAND_CANCELLED:"),
        "expected COMMAND_CANCELLED refusal, got `{refused}`"
    );

    let report = tokio::time::timeout(std::time::Duration::from_secs(5), done_rx)
        .await
        .expect("report should arrive")
        .expect("done channel closed");
    assert_cancelled_report(&report);

    assert_eq!(umbel::testkit::task_services("stopper-work"), before_counts);
}
