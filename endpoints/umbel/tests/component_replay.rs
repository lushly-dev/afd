//! Time and randomness in a component come only from the command context (phase 1
//! specification, section 4), so the journal's tape holds every read and a replay restores them.
#![cfg(feature = "component")]
#![allow(clippy::unwrap_used, clippy::expect_used)]

#[path = "support/components.rs"]
mod components;
mod support;

use afd::{ReplayJournalOptions, replay_journal};
use components::{behaviors_dir, hello_dir};
use serde_json::{Value, json};
use support::journal_entries;
use umbel::testkit::TestHost;

fn probe(clock: i64) -> (tempfile::TempDir, TestHost) {
    let dir = tempfile::tempdir().unwrap();
    let plugin = behaviors_dir(dir.path(), &["clock", "random"]);
    let host = TestHost::directory(&plugin).clock(clock).boot().unwrap();
    (dir, host)
}

#[tokio::test(flavor = "multi_thread")]
async fn the_tape_holds_the_clock_and_random_reads_and_replay_reports_same() {
    let (_dir, host) = probe(1_700_000_000_000);
    let clock = host.call("probe-clock", json!({})).await;
    assert!(clock.success, "{clock:?}");
    let random = host.call("probe-random", json!({})).await;
    assert!(random.success, "{random:?}");

    let entries = journal_entries(host.workspace_dir());
    assert_eq!(entries.len(), 2);
    let clock_tape = entries[0]
        .tape
        .as_ref()
        .expect("the clock reads are on the tape");
    // wall time, the monotonic clock's start and its elapsed read: all the context's clock.
    assert!(clock_tape.clock.len() >= 2, "{clock_tape:?}");
    assert!(
        clock_tape
            .clock
            .iter()
            .all(|read| *read == 1_700_000_000_000.0)
    );
    assert!(!clock_tape.truncated);
    let random_tape = entries[1]
        .tape
        .as_ref()
        .expect("the random reads are on the tape");
    // The insecure seed (four words) and the hash map's own keys.
    assert!(random_tape.random.len() >= 4, "{random_tape:?}");
    assert!(
        random_tape
            .random
            .iter()
            .all(|read| (0.0..1.0).contains(read))
    );

    let replay = host.replay().await.unwrap();
    assert_eq!(replay.report.entries.len(), 2);
    assert_eq!(replay.report.same, 2, "{:?}", replay.report);
    assert!(!replay.report.diverged);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_replay_on_another_clock_restores_the_recorded_values() {
    let (_first_dir, first) = probe(1_700_000_000_000);
    let recorded = first.call("probe-clock", json!({})).await;
    let random = first.call("probe-random", json!({})).await;
    assert!(random.success, "{random:?}");
    let entries = journal_entries(first.workspace_dir());

    // A second host whose clock says another time: run live, it reports that time.
    let (_second_dir, second) = probe(1_800_000_000_000);
    let live = second.call("probe-clock", json!({})).await;
    assert_ne!(live.data, recorded.data);
    assert_eq!(
        live.data.as_ref().unwrap()["wall_ms"],
        1_800_000_000_000_i64
    );

    // Replaying the first host's journal on the second restores what the first one read: the
    // clock and the random numbers come from the tape, not from the second host.
    let report = replay_journal(
        &second.host().registry(),
        &entries,
        ReplayJournalOptions::default(),
    )
    .await;
    assert_eq!(report.same, 2, "{report:?}");
    assert!(!report.diverged);
}

#[tokio::test(flavor = "multi_thread")]
async fn hellos_tape_stays_under_sixteen_reads_a_call() {
    let dir = tempfile::tempdir().unwrap();
    let host = TestHost::directory(hello_dir(dir.path())).boot().unwrap();
    for name in ["Ada", "Grace", "Edsger"] {
        let result = host
            .call("hello-greet", json!({ "name": name, "space": "main" }))
            .await;
        assert!(result.success, "{result:?}");
    }
    let entries = journal_entries(host.workspace_dir());
    assert_eq!(entries.len(), 3);
    for entry in &entries {
        let tape = entry.tape.as_ref().unwrap();
        let reads = tape.clock.len() + tape.random.len();
        assert!((1..16).contains(&reads), "{reads} reads: {tape:?}");
        assert!(!tape.truncated);
    }
    let replay = host.replay().await.unwrap();
    assert_eq!(replay.report.same, 3, "{:?}", replay.report);
}

#[tokio::test(flavor = "multi_thread")]
async fn reads_past_the_tape_cap_mark_the_tape_truncated() {
    let (_dir, host) = probe(1_700_000_000_000);
    let result = host
        .call("probe-clock-loop", json!({ "reads": 2000 }))
        .await;
    assert!(result.success, "{result:?}");
    assert_eq!(result.data.unwrap()["last"], 1_700_000_000_000_i64);
    let entries = journal_entries(host.workspace_dir());
    let tape = entries[0].tape.as_ref().unwrap();
    assert!(
        tape.truncated,
        "{} clock reads on the tape",
        tape.clock.len()
    );
    assert_eq!(tape.clock.len(), 1000);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_replay_records_each_call_as_the_journal_did() {
    // Two calls, the same input: each one's tape is its own, and each replays.
    let (_dir, host) = probe(1_700_000_000_000);
    for _ in 0..2 {
        let result = host.call("probe-random", json!({})).await;
        assert!(result.success, "{result:?}");
    }
    let hashes: Vec<Value> = journal_entries(host.workspace_dir())
        .iter()
        .map(|entry| entry.result.data.clone().unwrap()["hash"].clone())
        .collect();
    assert_eq!(hashes.len(), 2);
    let replay = host.replay().await.unwrap();
    assert_eq!(replay.report.same, 2, "{:?}", replay.report);
}
