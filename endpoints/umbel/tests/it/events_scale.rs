//! A cursor read near the end of an event stream at 1 000 and 1 000 000 events (#1771, D209).
//!
//! Ignored by default; run in release mode:
//! `cargo test --release --locked -p umbel --test it events_scale -- --ignored --nocapture`
//!
//! Writes a stream of `count` copies of one real event (renumbered), then times `event-list`
//! with `after` at event `count - 10` (ten events before the head, eleven once an append has
//! added one): first with no index beside the stream (the linear
//! scan, and what a host before D209 always does), then after one locked append has opened the
//! stream for writing, which builds the missing index (timed too), and again with the index; then
//! one more append, with the index current.
//! Prints timings with no thresholds.
use crate::support::*;
use serde_json::{Value, json};
use std::io::Write;
use std::time::{Duration, Instant};
use umbel::HostBuilder;

const READS: usize = 21;

fn median(mut samples: Vec<Duration>) -> Duration {
    samples.sort();
    samples[samples.len() / 2]
}

async fn time_reads(host: &umbel::Host, after: &str, expect: usize) -> Duration {
    let mut samples = Vec::with_capacity(READS);
    for _ in 0..READS {
        let started = Instant::now();
        let result = call(
            host,
            agent("reader"),
            "event-list",
            json!({"after": after, "limit": 10}),
        )
        .await;
        samples.push(started.elapsed());
        assert!(result.success, "{result:?}");
        assert_eq!(
            result.data.unwrap()["events"].as_array().unwrap().len(),
            expect
        );
    }
    median(samples)
}

async fn run(count: u64) {
    let dir = minimal();
    let host = HostBuilder::open(dir.path())
        .unwrap()
        .register(remember("note-remember"))
        .seal()
        .unwrap();
    let first = call(
        &host,
        agent("writer"),
        "note-remember",
        json!({"text": "r0"}),
    )
    .await;
    assert!(first.success);
    let template: Value = events(dir.path(), "main").remove(0);

    let path = events_path(dir.path(), "main");
    let started = Instant::now();
    {
        let mut out = std::io::BufWriter::new(std::fs::File::create(&path).unwrap());
        let mut event = template.clone();
        for seq in 1..=count {
            event["seq"] = json!(seq);
            event["journalSeq"] = json!(0);
            event["id"] = json!(format!("main:{seq}"));
            event["cursor"] = json!(format!("v0:main:{seq}"));
            serde_json::to_writer(&mut out, &event).unwrap();
            out.write_all(b"\n").unwrap();
        }
        out.flush().unwrap();
    }
    let bytes = std::fs::metadata(&path).unwrap().len();
    println!(
        "\n{count} events, {:.1} MB, written in {:.2?}",
        bytes as f64 / 1e6,
        started.elapsed()
    );
    let index = path.with_file_name("events.idx");
    let _ = std::fs::remove_file(&index);

    let after = format!("v0:main:{}", count - 10);
    let linear = time_reads(&host, &after, 10).await;
    println!("  event-list after head-10, no index (linear):   {linear:.2?}");

    // A locked append opens the stream for writing, which brings the index up, and appends its
    // event after the synthetic ones (their `journalSeq` is 0).
    let started = Instant::now();
    let append = call(
        &host,
        agent("writer"),
        "note-remember",
        json!({"text": "r1"}),
    )
    .await;
    assert!(append.success);
    println!(
        "  one append (builds the missing index):         {:.2?}",
        started.elapsed()
    );
    println!(
        "  index file: {}",
        std::fs::metadata(&index).map_or_else(
            |_| "none".to_owned(),
            |meta| format!("{} bytes", meta.len())
        )
    );

    let indexed = time_reads(&host, &after, 10).await;
    println!("  event-list after head-10, with the index:      {indexed:.2?}");

    let started = Instant::now();
    let append = call(
        &host,
        agent("writer"),
        "note-remember",
        json!({"text": "r2"}),
    )
    .await;
    assert!(append.success);
    println!(
        "  one append with the index current:             {:.2?}",
        started.elapsed()
    );
}

#[tokio::test]
#[ignore = "scale benchmark at 1 000 and 1 000 000 events; run in release with --ignored --nocapture"]
async fn events_scale_1k_and_1m() {
    run(1_000).await;
    run(1_000_000).await;
}
