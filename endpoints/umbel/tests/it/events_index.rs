//! The sparse index beside each event stream, `events.idx` (D209, #1771): kept by every append,
//! rewritten by `event-rebuild`, checked by the doctor, and never needed for a right answer.
use crate::support;
use serde_json::{Value, json};
use std::fs;
use support::*;
use umbel::HostBuilder;

/// Events between two index records in a release or integration build.
const STRIDE: u64 = 256;
const EVENTS: u64 = 600;

fn index_path(dir: &std::path::Path) -> std::path::PathBuf {
    events_path(dir, "main").with_file_name("events.idx")
}

async fn host_with_events(dir: &std::path::Path) -> umbel::Host {
    let host = HostBuilder::open(dir)
        .unwrap()
        .register(remember("note-remember"))
        .seal()
        .unwrap();
    for index in 0..EVENTS {
        let result = call(
            &host,
            agent("writer"),
            "note-remember",
            json!({"text": format!("r{index}")}),
        )
        .await;
        assert!(result.success);
    }
    host
}

async fn page(host: &umbel::Host, after: u64) -> (Vec<u64>, Value) {
    let result = call(
        host,
        agent("reader"),
        "event-list",
        json!({"after": format!("v0:main:{after}"), "limit": 5}),
    )
    .await;
    assert!(result.success, "{result:?}");
    let data = result.data.unwrap();
    let seqs = data["events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|event| event["seq"].as_u64().unwrap())
        .collect();
    (seqs, data)
}

/// Every page of interest, as a host reads it now.
async fn pages(host: &umbel::Host) -> Vec<(Vec<u64>, Value)> {
    let mut all = Vec::new();
    for after in [0, 1, 254, 255, 256, 257, 511, 512, 513, 590, 599, 600] {
        all.push(page(host, after).await);
    }
    all
}

/// The offset of every `STRIDE`th event's line, from the stream's own bytes.
fn expected_index(dir: &std::path::Path) -> Vec<u8> {
    let bytes = stream_bytes(dir, "main");
    let mut index = b"UMBELIDX".to_vec();
    index.extend_from_slice(&0u32.to_le_bytes());
    index.extend_from_slice(&u32::try_from(STRIDE).unwrap().to_le_bytes());
    let (mut offset, mut seq) = (0u64, 0u64);
    for line in bytes.split_inclusive(|byte| *byte == b'\n') {
        seq += 1;
        if seq.is_multiple_of(STRIDE) {
            index.extend_from_slice(&seq.to_le_bytes());
            index.extend_from_slice(&offset.to_le_bytes());
        }
        offset += line.len() as u64;
    }
    index
}

#[tokio::test]
async fn cursor_reads_are_the_same_with_a_kept_missing_or_wrong_index() {
    let dir = minimal();
    let host = host_with_events(dir.path()).await;
    assert_eq!(
        fs::read(index_path(dir.path())).unwrap(),
        expected_index(dir.path())
    );
    let indexed = pages(&host).await;
    assert_eq!(indexed[0].0, [1, 2, 3, 4, 5]);
    assert_eq!(indexed[4].0, [257, 258, 259, 260, 261]);
    assert_eq!(indexed[7].0, [513, 514, 515, 516, 517]);
    assert_eq!(indexed[10].0, [600]);
    assert_eq!(indexed[11].0, Vec::<u64>::new());
    assert_eq!(indexed[10].1["hasMore"], false);
    assert_eq!(indexed[9].1["hasMore"], true);

    // No index: the linear scan answers the same, and the next append builds it again.
    fs::remove_file(index_path(dir.path())).unwrap();
    assert_eq!(pages(&host).await, indexed);

    // A record that names the wrong line is read around.
    let mut wrong = expected_index(dir.path());
    wrong[24..32].copy_from_slice(&17u64.to_le_bytes());
    fs::write(index_path(dir.path()), &wrong).unwrap();
    assert_eq!(pages(&host).await, indexed);

    fs::remove_file(index_path(dir.path())).unwrap();
    let more = call(
        &host,
        agent("writer"),
        "note-remember",
        json!({"text": "one more"}),
    )
    .await;
    assert!(more.success);
    assert_eq!(
        fs::read(index_path(dir.path())).unwrap(),
        expected_index(dir.path())
    );
    assert_eq!(page(&host, 600).await.0, [601]);
}

#[tokio::test]
async fn event_rebuild_writes_the_index_the_appends_kept_and_the_doctor_checks_it() {
    let dir = minimal();
    let host = host_with_events(dir.path()).await;
    let live = (
        stream_bytes(dir.path(), "main"),
        fs::read(index_path(dir.path())).unwrap(),
    );
    let doctor = |host: &umbel::Host| {
        let host = host.cli_client();
        async move {
            let report = host.call("workspace-doctor", json!({}), None).await;
            report.data.unwrap()["checks"]
                .as_array()
                .unwrap()
                .iter()
                .find(|check| check["id"] == "events.consistent")
                .unwrap()
                .clone()
        }
    };
    assert_eq!(doctor(&host).await["status"], "pass");

    // A wrong record within the stream is a warning that names the rebuild.
    let mut wrong = live.1.clone();
    wrong[24..32].copy_from_slice(&17u64.to_le_bytes());
    fs::write(index_path(dir.path()), &wrong).unwrap();
    let check = doctor(&host).await;
    assert_eq!(check["status"], "warn", "{check}");
    assert!(
        check["message"].as_str().unwrap().contains("index"),
        "{check}"
    );
    assert!(
        check["suggestion"]
            .as_str()
            .unwrap()
            .contains("event rebuild"),
        "{check}"
    );

    let rebuilt = host
        .cli_client()
        .call("event-rebuild", json!({}), None)
        .await;
    assert!(rebuilt.success, "{rebuilt:?}");
    assert_eq!(stream_bytes(dir.path(), "main"), live.0);
    assert_eq!(fs::read(index_path(dir.path())).unwrap(), live.1);
    assert_eq!(doctor(&host).await["status"], "pass");
    let leftovers: Vec<String> = fs::read_dir(events_path(dir.path(), "main").parent().unwrap())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|name| name.ends_with(".tmp"))
        .collect();
    assert!(leftovers.is_empty(), "{leftovers:?}");
}

#[tokio::test]
async fn a_torn_stream_tail_is_cut_and_the_index_follows() {
    let dir = minimal();
    let host = host_with_events(dir.path()).await;
    let mut bytes = stream_bytes(dir.path(), "main");
    bytes.extend_from_slice(b"{\"version\":3,\"seq\":601,");
    fs::write(events_path(dir.path(), "main"), &bytes).unwrap();
    assert_eq!(page(&host, 598).await.0, [599, 600]);
    let more = call(
        &host,
        agent("writer"),
        "note-remember",
        json!({"text": "x"}),
    )
    .await;
    assert!(more.success);
    assert_eq!(page(&host, 599).await.0, [600, 601]);
    assert_eq!(
        fs::read(index_path(dir.path())).unwrap(),
        expected_index(dir.path())
    );
}
