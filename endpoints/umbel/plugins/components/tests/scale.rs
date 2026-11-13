//! A synthetic 990-component library served by a 20-tag brief (specification, sections 3.1 and 11).
//! Every call reads and checks the whole library; this prints how long that takes, with no
//! threshold, for the follow-up on a cache keyed by the catalog's digest to judge.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::io::Write;
use std::time::Instant;

use serde_json::json;
use support::*;

#[tokio::test]
async fn a_990_component_library_is_briefed_whole_on_every_call() {
    let mut pack = Pack::default();
    pack.add_rich("large", 990);
    let bytes: usize = pack.files.values().map(Vec::len).sum();
    let fx = pack.host();
    let tags: Vec<String> = (0..990)
        .step_by(50)
        .map(|index| format!("large-item-{index:04}"))
        .collect();
    assert_eq!(tags.len(), 20);

    let mut times = Vec::new();
    for _ in 0..3 {
        let start = Instant::now();
        let result = fx.brief(json!({ "tags": tags })).await;
        times.push(start.elapsed());
        assert_eq!(support::tags(&result), tags);
        assert!(measured(&result).0 <= 40_000);
    }
    let start = Instant::now();
    let list = fx.list(json!({ "prefix": "large-item-09" })).await;
    let list_time = start.elapsed();
    assert!(
        !data(&list)["content"]["components"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    // Written to stderr directly, past the test harness's capture, so a passing run in CI shows it.
    let line = format!(
        "scale: 990 records, {} files, {bytes} bytes; components-brief of 20 tags: {}; components-list: {:.1?} ({} build)",
        pack.files.len(),
        times
            .iter()
            .map(|time| format!("{time:.1?}"))
            .collect::<Vec<_>>()
            .join(", "),
        list_time,
        if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        },
    );
    std::io::stderr()
        .write_all(format!("{line}\n").as_bytes())
        .unwrap();
}
