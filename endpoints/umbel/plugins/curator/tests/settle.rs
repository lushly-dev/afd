//! Settling (phase 4 specification, sections 4.1 to 4.3): the window by class, the sessions, the
//! authorities (person by default, a pack widening it, never transcript), flags, liveness and the
//! confidence gate; groups by content hash and class with their counts; a confirmation restarting
//! the window; memory read only under the caller's reader filter; the per-call bounds counted.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::json;
use support::*;
use umbel_store::memory::format_instant;
use umbel_store::{Authority, MemoryClass, MemoryFlag};

/// The candidate id of `lowest` for `principal` in `main`.
fn candidate(principal: &str, lowest: u64) -> String {
    umbel_okf::draft::candidate_id("main", principal, &mem(lowest))
}

/// Override `main`'s settle pack with the shipped one edited by `edit`.
fn pack(fx: &mut Fx, edit: impl FnOnce(String) -> String) {
    let dir = fx.path("spaces/main/packs/curator/settle");
    std::fs::create_dir_all(dir.join("data")).unwrap();
    std::fs::write(
        dir.join("pack.toml"),
        include_str!("../packs/settle/pack.toml"),
    )
    .unwrap();
    let text = edit(include_str!("../packs/settle/data/settle.toml").to_owned());
    std::fs::write(dir.join("data/settle.toml"), text).unwrap();
    fx.at(fx.clock);
}

#[tokio::test]
async fn a_shared_fact_settles_after_seven_days_in_two_sessions() {
    let mut fx = Fx::new();
    fx.remember_twice(
        fact(
            1,
            "human:ada",
            &["space"],
            "Staging rollbacks",
            "Use the canary flag.",
        ),
        2,
    );
    fx.at(day(3));
    let row = fx.only().await;
    assert_eq!(row["candidate"], candidate("human:local", 1));
    assert_eq!(row["status"], "settling");
    assert_eq!(row["stableAt"], format_instant(day(7)));
    assert!(row["settledAt"].is_null());
    assert_eq!(row["sessions"], 2);
    fx.at(day(7) - 1);
    assert_eq!(fx.only().await["status"], "settling");
    fx.at(day(8));
    let row = fx.only().await;
    assert_eq!(row["status"], "ready", "{row}");
    assert_eq!(row["mode"], "scheduled");
    assert_eq!(row["settledAt"], format_instant(day(7)));
    assert_eq!(row["class"], "semantic");
    assert_eq!(row["authority"], "person");
    assert_eq!(
        (row["sources"].clone(), row["principals"].clone()),
        (json!(1), json!(1))
    );
    assert_eq!(
        row["doc"],
        format!("notes/learned/{}", candidate("human:local", 1))
    );
    // Ada's record, not the caller's: no content hash is shown.
    assert_eq!(row["own"], false);
    assert!(row["contentHash"].is_null());
    let result = fx.candidates().await;
    let counts = &data(&result)["counts"];
    assert_eq!(counts["ready"], 1);
    assert_eq!(counts["candidates"], 1);
    // One record, listed and read once (the observation is the same record).
    assert_eq!(
        (counts["listed"].clone(), counts["read"].clone()),
        (json!(1), json!(1))
    );
}

#[tokio::test]
async fn one_session_never_settles_and_procedures_wait_fourteen_days() {
    let mut fx = Fx::new();
    fx.remember(vec![fact(
        1,
        "human:ada",
        &["space"],
        "One session",
        "Seen once.",
    )]);
    fx.remember_twice(
        procedure(fact(
            3,
            "human:ada",
            &["space"],
            "Deploy steps",
            "Run the script.",
        )),
        4,
    );
    fx.at(day(30));
    let rows = fx.rows().await;
    let status = |n: u64| {
        rows.iter()
            .find(|r| r["candidate"] == candidate("human:local", n))
            .unwrap()["status"]
            .clone()
    };
    assert_eq!(status(1), "settling");
    assert_eq!(status(3), "ready");
    fx.at(day(10));
    let row = fx
        .rows()
        .await
        .into_iter()
        .find(|r| r["candidate"] == candidate("human:local", 3))
        .unwrap();
    assert_eq!(row["status"], "settling");
    assert_eq!(row["class"], "procedural");
    assert_eq!(row["stableAt"], format_instant(day(14)));
}

#[tokio::test]
async fn only_person_settles_by_default_and_a_pack_may_widen_it_but_never_to_transcript() {
    let mut fx = Fx::new();
    let base = |n, subject: &str| fact(n, "human:ada", &["space"], subject, subject);
    fx.remember_twice(base(1, "A person's fact"), 2);
    fx.remember_twice(
        with_authority(base(3, "An agent's note"), Authority::Agent),
        4,
    );
    fx.remember_twice(with_authority(base(5, "A tool's note"), Authority::Tool), 6);
    fx.remember_twice(with_authority(base(7, "An import"), Authority::Import), 8);
    fx.remember_twice(
        with_authority(base(9, "A transcript window"), Authority::Transcript),
        10,
    );
    let mut episode = base(11, "An episode");
    episode.class = MemoryClass::Episodic;
    fx.remember_twice(episode, 12);
    let mut flagged = base(13, "A flagged fact");
    flagged.flags = vec![MemoryFlag::InstructionLike];
    fx.remember_twice(flagged, 14);
    fx.at(day(8));
    let ids = |rows: Vec<serde_json::Value>| -> Vec<String> {
        rows.iter()
            .map(|r| r["candidate"].as_str().unwrap().to_owned())
            .collect()
    };
    assert_eq!(ids(fx.rows().await), [candidate("human:local", 1)]);

    pack(&mut fx, |text| {
        text.replace(
            "authorities = [\"person\"]",
            "authorities = [\"person\", \"agent\", \"tool\", \"import\"]",
        )
    });
    let mut wider = ids(fx.rows().await);
    wider.sort();
    let mut expected: Vec<String> = [1, 3, 5, 7]
        .into_iter()
        .map(|n| candidate("human:local", n))
        .collect();
    expected.sort();
    assert_eq!(wider, expected, "never transcript, episodic or flagged");
    let rows = fx.rows().await;
    let authority = |n: u64| {
        rows.iter()
            .find(|r| r["candidate"] == candidate("human:local", n))
            .unwrap()["authority"]
            .clone()
    };
    assert_eq!(authority(3), "agent");
    assert_eq!(authority(7), "import");

    pack(&mut fx, |text| {
        text.replace(
            "authorities = [\"person\"]",
            "authorities = [\"person\", \"transcript\"]",
        )
    });
    let refused = fx.candidates().await;
    assert_eq!(code(&refused), "CURATOR_PACK_INVALID");
    assert!(
        refused["error"]["message"]
            .as_str()
            .unwrap()
            .contains("transcript")
    );
}

#[tokio::test]
async fn only_live_records_settle() {
    let mut fx = Fx::new();
    fx.remember_twice(fact(1, "human:ada", &["space"], "Invalidated", "Old."), 2);
    let mut expiring = fact(3, "human:ada", &["space"], "Expiring", "Soon gone.");
    expiring.expires_at = day(9);
    fx.remember_twice(expiring, 4);
    let mut later = fact(5, "human:ada", &["space"], "Not yet valid", "Later.");
    later.valid_from = day(100);
    umbel_store::conformance::samples::agree(&mut later);
    fx.remember_twice(later, 6);
    fx.remember_twice(fact(7, "human:ada", &["space"], "Live", "Here."), 8);
    fx.invalidate(&mem(1), "human:ada", day(2));
    fx.at(day(8));
    assert_eq!(
        fx.rows().await.len(),
        2,
        "the invalidated and the future record are not read"
    );
    fx.at(day(10));
    let rows = fx.rows().await;
    assert_eq!(rows.len(), 1, "{rows:#?}");
    assert_eq!(rows[0]["candidate"], candidate("human:local", 7));
}

#[tokio::test]
async fn a_group_sums_sessions_counts_owners_and_keeps_the_highest_authority() {
    let mut fx = Fx::with(&config(""));
    // The same fact by Ada (a person) and by Local's agent, each in one session.
    let adas = fact(1, "human:ada", &["space"], "Shared fact", "The same text.");
    let mut locals = with_authority(
        fact(
            2,
            "human:local",
            &["space"],
            "Shared fact",
            "The same text.",
        ),
        Authority::Agent,
    );
    locals.scope.session = Some("s9".to_owned());
    umbel_store::conformance::samples::agree(&mut locals);
    locals.envelope.constraints = Some(vec!["only on weekdays".to_owned()]);
    fx.remember(vec![adas, locals]);
    fx.at(day(8));
    // By default the agent's note is not a source, and one session is too few.
    assert_eq!(fx.only().await["status"], "settling");
    assert_eq!(fx.only().await["sources"], 1);
    pack(&mut fx, |text| {
        text.replace(
            "authorities = [\"person\"]",
            "authorities = [\"person\", \"agent\"]",
        )
    });
    let row = fx.only().await;
    assert_eq!(row["status"], "ready", "{row}");
    assert_eq!(row["candidate"], candidate("human:local", 1));
    assert_eq!(row["sources"], 2);
    assert_eq!(row["sessions"], 2);
    assert_eq!(row["principals"], 2);
    assert_eq!(row["authority"], "person");
    assert_eq!(row["own"], false);
}

#[tokio::test]
async fn a_confirmation_writes_a_new_version_and_restarts_the_window() {
    let mut fx = Fx::new();
    // An agent's note of Local's, private, observed in two sessions: not person, so not a
    // candidate, until Local confirms it (D84).
    fx.remember_twice(
        with_authority(
            fact(
                1,
                "human:local",
                &["principal:human:local"],
                "A note",
                "Noted.",
            ),
            Authority::Agent,
        ),
        2,
    );
    fx.at(day(20));
    assert!(fx.rows().await.is_empty());
    fx.confirm(&mem(1), "human:local", day(20));
    let row = fx.only().await;
    assert_eq!(row["status"], "settling");
    assert_eq!(row["authority"], "person");
    assert_eq!(row["stableAt"], format_instant(day(27)));
    fx.at(day(28));
    assert_eq!(fx.only().await["status"], "needs-promotion");
}

#[tokio::test]
async fn memory_is_read_only_under_the_callers_reader_filter() {
    let mut fx = Fx::new();
    fx.remember_twice(
        fact(1, "human:bo", &["principal:human:bo"], "Bo's", "Private."),
        2,
    );
    fx.remember_twice(
        fact(
            3,
            "human:ada",
            &["principal:human:ada"],
            "Ada's",
            "Private.",
        ),
        4,
    );
    fx.remember_twice(
        fact(
            5,
            "human:local",
            &["principal:human:local"],
            "Local's",
            "Private.",
        ),
        6,
    );
    fx.remember_twice(fact(7, "human:bo", &["space"], "Bo shared", "Shared."), 8);
    fx.at(day(8));
    let result = fx.candidates().await;
    let rows = data(&result)["candidates"].as_array().unwrap();
    let mut seen: Vec<&str> = rows
        .iter()
        .map(|r| r["candidate"].as_str().unwrap())
        .collect();
    seen.sort_unstable();
    let mut expected = [candidate("human:local", 5), candidate("human:local", 7)];
    expected.sort();
    assert_eq!(seen, expected);
    // What the caller cannot read is not even counted.
    assert_eq!(data(&result)["counts"]["listed"], 2);
    // Bo sees his own two, under his principal's ids, and nothing of Local's.
    let bos = fx.rows_as(human("bo")).await;
    let mut seen: Vec<String> = bos
        .iter()
        .map(|r| r["candidate"].as_str().unwrap().to_owned())
        .collect();
    seen.sort();
    let mut expected = [candidate("human:bo", 1), candidate("human:bo", 7)];
    expected.sort();
    assert_eq!(seen, expected);
}

#[tokio::test]
async fn the_confidence_gate_and_the_bounds_are_the_packs() {
    let mut fx = Fx::new();
    for n in [1, 3, 5] {
        fx.remember_twice(
            fact(n, "human:ada", &["space"], &format!("Fact {n}"), "Text."),
            n + 1,
        );
    }
    fx.at(day(8));
    assert_eq!(fx.rows().await.len(), 3);
    pack(&mut fx, |text| {
        text.replace("# min_confidence = 0.7", "min_confidence = 0.9")
    });
    assert!(fx.rows().await.is_empty(), "0.8 is under the gate");
    pack(&mut fx, |text| {
        text.replace("max_gets = 500", "max_gets = 1")
    });
    let result = fx.candidates().await;
    let counts = &data(&result)["counts"];
    assert_eq!(counts["eligible"], 3);
    assert_eq!(counts["read"], 1);
    assert_eq!(counts["unread"], 2);
    assert_eq!(data(&result)["more"], false);
    pack(&mut fx, |text| {
        text.replace("max_records = 5000", "max_records = 2")
    });
    let result = fx.candidates().await;
    assert_eq!(data(&result)["counts"]["listed"], 2);
    assert_eq!(data(&result)["more"], true);
}
