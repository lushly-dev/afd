//! The fakes answer what they are told: M0's unit test of `FakeRuntime`, moved out of `src/` with
//! it and extended to every method the harness relies on.
use std::collections::BTreeMap;
use std::time::Duration;

use loam_os_host::records::Records;
use loam_os_host::runtime::{ContainerSpec, Mount, Runtime, StepSpec};
use loam_os_host::source::Source;

use crate::support::fakes::{FakeRuntime, FakeSource, MemoryRecords, StepScript};

fn spec(name: &str, volume: &str) -> ContainerSpec {
    ContainerSpec {
        name: name.to_owned(),
        machine: "m-1".to_owned(),
        image: "session@sha256:abc".to_owned(),
        cpus: 2.0,
        memory_gb: 4.0,
        mounts: vec![Mount {
            volume: volume.to_owned(),
            target: "/work".to_owned(),
        }],
        user: None,
    }
}

fn step(timeout_ms: u64) -> StepSpec {
    StepSpec {
        args: vec!["pnpm".to_owned(), "verify".to_owned()],
        env: BTreeMap::new(),
        workdir: None,
        timeout: Duration::from_millis(timeout_ms),
    }
}

#[test]
fn the_fake_runtime_answers_what_it_is_told() {
    let fake = FakeRuntime::reachable("fake", "1.0");
    assert_eq!(fake.kind(), "fake");
    assert_eq!(fake.version().unwrap(), "1.0");
    fake.set_version(None);
    assert!(fake.version().is_err());
    assert!(fake.labelled().is_err());
    fake.set_version(Some("1.1"));
    assert_eq!(fake.version().unwrap(), "1.1");

    // A container needs its volumes; both carry the machine's label.
    assert!(fake.create_container(&spec("c", "v")).is_err());
    fake.create_volume("v", "m-1").unwrap();
    // Making it again keeps it, as Docker does.
    fake.create_volume("v", "m-1").unwrap();
    fake.create_container(&spec("c", "v")).unwrap();
    assert_eq!(fake.machine_of("c").as_deref(), Some("m-1"));
    assert_eq!(fake.machine_of("v").as_deref(), Some("m-1"));
    let labelled = fake.labelled().unwrap();
    assert_eq!(labelled.containers, ["c"]);
    assert_eq!(labelled.volumes, ["v"]);
    fake.set_labelled_error(Some("ps timed out"));
    assert_eq!(fake.labelled().unwrap_err().message, "ps timed out");
    fake.set_labelled_error(None);

    // Steps play their scripts in order, write their logs, and a hanging one is killed.
    fake.script(
        "c",
        [
            StepScript {
                code: Some(1),
                duration_ms: 187_000,
                log: vec!["FAIL parser.test.ts".to_owned()],
                memory_bytes: Some(3 << 30),
                ..StepScript::default()
            },
            StepScript {
                hangs: true,
                ..StepScript::default()
            },
        ],
    );
    let dir = tempfile::tempdir().unwrap();
    let log = dir.path().join("log");
    let failed = fake.run_step("c", &step(1000), &log).unwrap();
    assert_eq!(failed.code, Some(1));
    assert_eq!(failed.duration, Duration::from_millis(187_000));
    assert_eq!(fake.usage("c").unwrap().memory_bytes, 3 << 30);
    let hung = fake.run_step("c", &step(1000), &log).unwrap();
    assert!(hung.timed_out);
    assert_eq!(hung.duration, Duration::from_millis(1000));
    let passed = fake.run_step("c", &step(1000), &log).unwrap();
    assert_eq!(passed.code, Some(0));
    assert_eq!(
        std::fs::read_to_string(&log).unwrap(),
        "FAIL parser.test.ts\n"
    );
    fake.stop_steps("c").unwrap();
    assert_eq!(fake.stopped(), ["c", "c"]);
    assert!(fake.run_step("gone", &step(1000), &log).is_err());
    assert!(fake.stop_steps("gone").is_err());
    assert!(fake.usage("gone").is_err());

    // Disk counts what it holds; removing is true once and false after.
    fake.hold_volume("big", "m-2", 48_000_000_000);
    fake.hold_container("left", "m-2", 2_000_000_000);
    assert_eq!(fake.disk().unwrap().total(), 50_000_000_000);
    assert!(fake.remove_container("c").unwrap());
    assert!(!fake.remove_container("c").unwrap());
    assert!(fake.remove_volume("v").unwrap());
    assert!(!fake.remove_volume("v").unwrap());

    let down = FakeRuntime::unreachable("docker", "The container runtime is not running.");
    assert_eq!(
        down.version().unwrap_err().message,
        "The container runtime is not running."
    );
    assert!(down.create_volume("v", "m").is_err());
    assert!(down.disk().is_err());
}

#[test]
fn the_fake_source_and_records_answer_what_they_are_told() {
    let source = FakeSource::default();
    source.branch("repo", "main", "0f0f");
    source.commit("repo", "3f9a");
    assert_eq!(
        source.branch_head("repo", "main").unwrap().as_deref(),
        Some("0f0f")
    );
    assert_eq!(source.branch_head("repo", "fix/none").unwrap(), None);
    assert!(source.contains("repo", "3f9a").unwrap());
    assert!(!source.contains("repo", "ffff").unwrap());
    assert!(source.contains("other", "3f9a").is_err());

    let records = MemoryRecords::default();
    assert!(records.machines().unwrap().is_empty());
    assert_eq!(records.run("r-1").unwrap(), None);
    records.set_unreadable(Some("gone"));
    assert_eq!(records.runs().unwrap_err().message, "gone");
    records.set_unreadable(None);
    assert!(records.runs().unwrap().is_empty());
}
