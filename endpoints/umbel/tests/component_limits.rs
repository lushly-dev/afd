//! A runaway component stops with a clean error (phase 1 specification, section 6.2): fuel,
//! wall time (the epoch while it computes, a deadline while it waits in the host), memory and
//! the size of input and result; and what it writes to stdout and stderr is capped.
#![cfg(feature = "component")]
#![allow(clippy::unwrap_used, clippy::expect_used)]

#[path = "support/components.rs"]
mod components;
#[path = "support/logs.rs"]
mod logs;
mod support;

use components::behaviors_dir;
use serde_json::{Value, json};
use std::time::{Duration, Instant};
use umbel::testkit::TestHost;

fn host(limits: &str) -> (tempfile::TempDir, TestHost) {
    let dir = tempfile::tempdir().unwrap();
    let plugin = behaviors_dir(dir.path(), &["clock", "random"]);
    let mut builder = TestHost::directory(&plugin);
    if !limits.is_empty() {
        builder = builder.instance_keys(format!("limits = {{ {limits} }}").parse().unwrap());
    }
    (dir, builder.boot().unwrap())
}

fn error(result: &afd::CommandResult<Value>) -> &afd::CommandError {
    assert!(!result.success, "{result:?}");
    result.error.as_ref().unwrap()
}

fn limit(result: &afd::CommandResult<Value>) -> String {
    let error = error(result);
    assert_eq!(error.code, "PLUGIN_LIMIT_EXCEEDED", "{error:?}");
    assert_eq!(error.retryable, Some(false));
    assert!(
        error.suggestion.as_deref().unwrap().contains("limits."),
        "{error:?}"
    );
    error.details.as_ref().unwrap()["limit"]
        .as_str()
        .unwrap()
        .to_owned()
}

async fn still_works(host: &TestHost) {
    let echo = host.call("probe-echo", json!({ "n": 7 })).await;
    assert!(echo.success, "{echo:?}");
    assert_eq!(echo.data.unwrap()["input"], json!({ "n": 7 }));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_loop_runs_out_of_fuel() {
    let (_dir, host) = host("fuel = 2000000, timeout_ms = 30000");
    let started = Instant::now();
    let result = host.call("probe-loop", json!({})).await;
    assert_eq!(limit(&result), "fuel");
    assert!(
        started.elapsed() < Duration::from_secs(10),
        "{:?}",
        started.elapsed()
    );
    // A fresh store: the next call has all its fuel again.
    still_works(&host).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_loop_past_the_wall_time_is_interrupted_by_the_epoch() {
    // Plenty of fuel (the host cap), a short deadline.
    let (_dir, host) = host("fuel = 20000000000, timeout_ms = 150");
    let started = Instant::now();
    let result = host.call("probe-loop", json!({})).await;
    assert_eq!(limit(&result), "timeout");
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "{:?}",
        started.elapsed()
    );
    still_works(&host).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_component_waiting_in_the_host_is_stopped_by_the_deadline_too() {
    // The epoch cannot reach a component that is blocked in a host call; the deadline can.
    let (_dir, host) = host("timeout_ms = 200");
    let started = Instant::now();
    let result = host.call("probe-sleep", json!({ "secs": 60 })).await;
    assert_eq!(limit(&result), "timeout");
    assert!(
        started.elapsed() < Duration::from_secs(10),
        "{:?}",
        started.elapsed()
    );
    still_works(&host).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_component_that_allocates_past_the_memory_limit_is_stopped() {
    let (_dir, host) = host("memory_bytes = 33554432");
    let ok = host.call("probe-alloc", json!({ "mib": 4 })).await;
    assert_eq!(ok.data.unwrap()["held_mib"], 4);
    let result = host.call("probe-alloc", json!({ "mib": 200 })).await;
    assert_eq!(limit(&result), "memory");
    still_works(&host).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn the_default_limits_let_ordinary_work_through() {
    let (_dir, host) = host("");
    let result = host.call("probe-alloc", json!({ "mib": 8 })).await;
    assert_eq!(result.data.unwrap()["held_mib"], 8);
    // 64 MiB is the default: asking for far more is refused.
    let result = host.call("probe-alloc", json!({ "mib": 400 })).await;
    assert_eq!(limit(&result), "memory");
}

#[tokio::test(flavor = "multi_thread")]
async fn input_and_result_json_are_each_capped_at_four_mebibytes() {
    let (_dir, host) = host("");
    let big_input = "x".repeat(5 * 1024 * 1024);
    let result = host.call("probe-echo", json!({ "pad": big_input })).await;
    assert_eq!(limit(&result), "io");
    assert!(
        error(&result).message.contains("the input is"),
        "{result:?}"
    );

    let result = host
        .call("probe-big", json!({ "bytes": 5 * 1024 * 1024 }))
        .await;
    assert_eq!(limit(&result), "io");
    assert!(
        error(&result).message.contains("the result is"),
        "{result:?}"
    );

    // Just under the cap goes through.
    let result = host
        .call("probe-big", json!({ "bytes": 3 * 1024 * 1024 }))
        .await;
    assert!(result.success, "{result:?}");
    still_works(&host).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn stdout_and_stderr_are_capped_at_64_kib_per_call_and_tagged() {
    logs::install();
    let (_dir, host) = host("");
    let result = host.call("probe-output", json!({ "bytes": 400_000 })).await;
    assert!(result.success, "{result:?}");
    let lines = logs::lines(&"y".repeat(127));
    // 64 KiB of 127-byte lines, both streams together, and every one tagged.
    assert!(
        (400..=517).contains(&lines.len()),
        "{} lines were logged",
        lines.len()
    );
    assert!(
        lines.iter().all(|line| line.contains("plugin=probe")),
        "{lines:?}"
    );
    assert!(lines.iter().all(|line| line.contains("wasi")), "{lines:?}");
    assert!(lines.iter().any(|line| line.contains("INFO")));
    assert!(lines.iter().any(|line| line.contains("WARN")));
    // Once, the host says it started dropping lines.
    let notice = logs::lines("further lines are dropped");
    assert_eq!(notice.len(), 1, "{notice:?}");

    // The budget is per call: the next call logs again.
    let before = logs::lines(&"y".repeat(127)).len();
    let result = host.call("probe-output", json!({ "bytes": 1024 })).await;
    assert!(result.success);
    assert!(logs::lines(&"y".repeat(127)).len() > before);
}
