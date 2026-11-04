//! Conflict sets (phase 4 specification, section 4.4): equal subject keys with different content
//! form one set, whose id derives from the lowest member and is fixed once a run recorded it;
//! every admitted member is drafted as an alternative on the set's path, the curator choosing
//! none; members past `max_alternatives` are skipped; a candidate that can never be drafted joins
//! no set; equal content is one candidate, not a conflict.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::*;
use umbel_okf::draft;
use umbel_store::Sensitivity;

fn candidate(lowest: u64) -> String {
    draft::candidate_id("main", "human:local", &mem(lowest))
}

fn row(rows: &[Value], lowest: u64) -> Value {
    rows.iter()
        .find(|r| r["candidate"] == candidate(lowest))
        .unwrap_or_else(|| panic!("no candidate of {lowest}: {rows:#?}"))
        .clone()
}

/// A shared fact `n` with `subject` and `text`, observed in two sessions.
fn remember(fx: &mut Fx, n: u64, subject: &str, text: &str) {
    fx.remember_twice(fact(n, "human:ada", &["space"], subject, text), n + 1);
}

#[tokio::test]
async fn equal_subjects_with_different_content_are_alternatives_on_one_path() {
    let mut fx = Fx::new();
    remember(&mut fx, 1, "Staging rollbacks", "Use the canary flag.");
    remember(
        &mut fx,
        3,
        "  staging, ROLLBACKS!",
        "Use the deploy script.",
    );
    remember(
        &mut fx,
        5,
        "Production rollbacks",
        "Ask the on-call person.",
    );
    fx.at(day(8));
    let rows = fx.rows().await;
    assert_eq!(rows.len(), 3);
    let set = draft::conflict_set_id("main", "human:local", &candidate(1).min(candidate(3)));
    for n in [1, 3] {
        let member = row(&rows, n);
        assert_eq!(member["conflictSet"], set.as_str(), "{member}");
        assert_eq!(member["doc"], format!("notes/learned/{set}"));
        // The curator never chooses: both are drafted, and a person decides.
        assert_eq!(member["status"], "ready");
        assert_eq!(member["mode"], "scheduled");
    }
    let alone = row(&rows, 5);
    assert!(alone["conflictSet"].is_null());
    assert_eq!(alone["doc"], format!("notes/learned/{}", candidate(5)));
    // Neither the id nor the path says anything about the subject.
    never_mentions(&set, &["staging", "rollback"]);
}

#[tokio::test]
async fn equal_content_is_one_candidate_not_a_conflict() {
    let mut fx = Fx::new();
    fx.remember(vec![
        fact(1, "human:ada", &["space"], "Same", "Same text."),
        fact(2, "human:bo", &["space"], "Same", "Same text."),
    ]);
    fx.at(day(8));
    let only = fx.only().await;
    assert_eq!(only["sources"], 2);
    assert!(only["conflictSet"].is_null());
    assert_eq!(only["status"], "ready");
}

#[tokio::test]
async fn members_past_the_alternatives_are_skipped_by_id_order() {
    let mut fx = Fx::new();
    for (n, text) in [
        (1, "One."),
        (3, "Two."),
        (5, "Three."),
        (7, "Four."),
        (9, "Five."),
    ] {
        remember(&mut fx, n, "Rollbacks", text);
    }
    fx.at(day(8));
    let rows = fx.rows().await;
    let mut ids: Vec<String> = [1, 3, 5, 7, 9].into_iter().map(candidate).collect();
    ids.sort();
    let set = draft::conflict_set_id("main", "human:local", &ids[0]);
    for (position, id) in ids.iter().enumerate() {
        let member = rows.iter().find(|r| r["candidate"] == id.as_str()).unwrap();
        assert_eq!(member["conflictSet"], set.as_str());
        if position < 4 {
            assert_eq!(member["status"], "ready", "{member}");
        } else {
            assert_eq!(member["status"], "skipped");
            assert_eq!(member["reason"], "conflict-too-large");
            assert!(member["mode"].is_null());
        }
    }
    let result = fx.candidates().await;
    assert_eq!(data(&result)["counts"]["skipped"], 1);
}

#[tokio::test]
async fn a_candidate_that_can_never_be_drafted_joins_no_set() {
    let mut fx = Fx::new();
    remember(&mut fx, 1, "Rollbacks", "Use the canary flag.");
    fx.remember_twice(
        sensitive(
            fact(
                3,
                "human:ada",
                &["space"],
                "Rollbacks",
                "Restricted detail.",
            ),
            Sensitivity::Restricted,
        ),
        4,
    );
    fx.at(day(8));
    let rows = fx.rows().await;
    let skipped = row(&rows, 3);
    assert_eq!(skipped["status"], "skipped");
    assert_eq!(skipped["reason"], "sensitivity-higher");
    assert!(skipped["conflictSet"].is_null());
    let drafted = row(&rows, 1);
    assert!(drafted["conflictSet"].is_null());
    assert_eq!(drafted["doc"], format!("notes/learned/{}", candidate(1)));
}

#[tokio::test]
async fn a_set_keeps_the_id_it_was_first_recorded_with() {
    let mut fx = Fx::new();
    remember(&mut fx, 1, "Rollbacks", "Use the canary flag.");
    remember(&mut fx, 3, "Rollbacks", "Use the deploy script.");
    fx.at(day(8));
    // A run (step 5) recorded the higher member with the set it formed with an earlier member,
    // since forgotten: the id stays fixed on every member.
    let (low, high) = {
        let (a, b) = (candidate(1), candidate(3));
        if a < b { (a, b) } else { (b, a) }
    };
    let earlier = draft::conflict_set_id("main", "human:local", "c-00000000000000000000");
    fx.put_curator_record(
        "candidate",
        &high,
        json!({
            "version": 1, "kind": "candidate", "id": high, "space": "main",
            "principal": "human:local", "access": ["principal:human:local", "space"],
            "class": "semantic", "snapshot": null, "sensitivity": "internal",
            "status": "settling", "drafts": 0, "firstSeenAt": "2026-01-02T00:00:00.000Z",
            "promotedTo": null, "conflictSet": earlier, "quietUntil": null,
            "contentHash": format!("sha256:{}", "0".repeat(64)),
            "subjectKey": format!("sha256:{}", "1".repeat(64)),
            "sources": [{ "id": mem(3), "recordVersion": 1 }], "reason": null,
        }),
        &["principal:human:local", "space"],
    );
    let rows = fx.rows().await;
    for id in [&low, &high] {
        let member = rows.iter().find(|r| r["candidate"] == id.as_str()).unwrap();
        assert_eq!(member["conflictSet"], earlier.as_str(), "{member}");
        assert_eq!(member["doc"], format!("notes/learned/{earlier}"));
    }
}
