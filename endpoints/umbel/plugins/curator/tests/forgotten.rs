//! Changed and forgotten evidence (phase 4 specification, section 9.1; owner decision 7, D103),
//! for each source state, with expiry by the clock: an erased source's draft is withdrawn and
//! redacted through the batch's `erased` notice and the curator's records keep nothing of it; an
//! invalidated, expired, confirmed or unreadable source withdraws the draft without redaction.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::*;
use umbel_okf::draft;
use umbel_plugin_curator::state::state_id;
use umbel_store::Authority;
use umbel_store_embedded::{SqliteStore, StoreOptions};

const SUBJECT: &str = "Payroll zebracanary";
const TEXT: &str = "The payroll key rotates, zebracanary.";

fn candidate(lowest: u64) -> String {
    draft::candidate_id("main", "human:local", &mem(lowest))
}

/// A run that drafts Ada's shared fact `n` with canaries: the stub's id.
async fn drafted(fx: &mut Fx, n: u64) -> String {
    fx.remember_twice(fact(n, "human:ada", &["space"], SUBJECT, TEXT), n + 100);
    fx.at(day(8));
    let report = fx.report().await;
    assert_eq!(report["counts"]["drafted"], 1, "{report}");
    fx.stubs_of(&candidate(n))[0]["id"]
        .as_str()
        .unwrap()
        .to_owned()
}

fn stub(fx: &Fx, id: &str) -> Value {
    fx.stubs().into_iter().find(|s| s["id"] == id).unwrap()
}

#[tokio::test]
async fn an_erased_source_withdraws_and_redacts_and_the_curator_keeps_nothing_of_it() {
    let mut fx = Fx::new();
    let proposal = drafted(&mut fx, 1).await;
    let id = candidate(1);
    let hash = fx.record(&mem(1)).content_hash.as_str().to_owned();
    assert!(
        fx.store_bytes().contains(&hash),
        "the candidate record held it"
    );

    fx.forget(&mem(1), "human:ada");
    let (code, out) = fx.run_cli().await;
    assert_eq!(code, 0, "{out}");
    let report = &out["data"];
    assert_eq!(report["counts"]["withdrawn"], 1, "{report}");
    assert_eq!(report["checkpoint"], "clean");
    let redacted = stub(&fx, &proposal);
    assert_eq!(redacted["state"], "withdrawn");
    assert_eq!(redacted["redacted"], true);
    assert_eq!(redacted["withdrawal"]["reason"], "source-erased");

    // The candidate keeps no content hash, subject key, reason or sources, and is never drafted.
    let body = fx.curator_body("candidate", &id).unwrap();
    assert!(record_validator().is_valid(&body), "{body:#}");
    assert_eq!(body["status"], "erased");
    for key in ["contentHash", "subjectKey", "sources", "reason"] {
        assert!(body.get(key).is_none(), "{key}: {body:#}");
    }
    // Nothing of the source in the curator's records, the store's bytes after the checkpoint,
    // the journal, the events or the run's stdout.
    let gone = [SUBJECT, TEXT, "zebracanary", hash.as_str()];
    for kind in ["candidate", "consent", "run", "state"] {
        for record in fx.curator_records(kind) {
            never_mentions(&record.body.to_string(), &gone);
        }
    }
    never_mentions(&fx.store_bytes(), &gone);
    never_mentions(&fx.journaled_text(), &gone);
    never_mentions(&out.to_string(), &gone);
    // The id and the path are unchanged and content-free.
    assert_eq!(redacted["doc"], format!("notes/learned/{id}"));
    assert_eq!(fx.only().await["status"], "erased");
    let later = fx.report().await;
    assert_eq!(later["counts"]["drafted"], 0, "{later}");
}

#[tokio::test]
async fn a_forgotten_promotion_keeps_no_sources_in_its_consent() {
    let mut fx = Fx::new();
    fx.remember_twice(
        fact(1, "human:local", &["principal:human:local"], SUBJECT, TEXT),
        101,
    );
    fx.at(day(8));
    let id = candidate(1);
    let hash = fx.record(&mem(1)).content_hash.as_str().to_owned();
    let (promoted, _) = fx
        .terminal(
            "curator-promote",
            json!({ "candidate": id, "contentHash": hash }),
            true,
        )
        .await;
    data(&promoted);
    let report = fx.report().await;
    assert_eq!(report["counts"]["drafted"], 1, "{report}");
    assert_eq!(fx.stubs_of(&id)[0]["drafter"]["mode"], "promoted");

    fx.forget(&mem(1), "human:local");
    let report = fx.report().await;
    assert_eq!(report["counts"]["withdrawn"], 1, "{report}");
    let consent = fx
        .curator_body("consent", &format!("n-{}", &id[2..]))
        .unwrap();
    assert!(record_validator().is_valid(&consent), "{consent:#}");
    assert_eq!(consent["erased"], true);
    assert!(consent.get("sources").is_none());
    never_mentions(&fx.store_bytes(), &[hash.as_str(), SUBJECT, TEXT]);
}

#[tokio::test]
async fn a_reader_holding_the_log_makes_the_runs_checkpoint_pending() {
    let mut fx = Fx::new();
    drafted(&mut fx, 1).await;
    fx.forget(&mem(1), "human:ada");
    let store = SqliteStore::open(&fx.space_dir("main"), "main", StoreOptions::default()).unwrap();
    let hold = store.hold_reader().unwrap();
    let report = fx.report().await;
    assert_eq!(report["checkpoint"], "pending", "{report}");
    drop(hold);
    // The batch's own checkpoint state reaches the report too.
    let mut fx = Fx::new();
    drafted(&mut fx, 2).await;
    fx.controls(json!({ "held": true })).await;
    fx.forget(&mem(2), "human:ada");
    assert_eq!(fx.report().await["checkpoint"], "pending");
}

#[tokio::test]
async fn an_invalidated_source_withdraws_without_redaction() {
    let mut fx = Fx::new();
    let proposal = drafted(&mut fx, 1).await;
    fx.invalidate(&mem(1), "human:ada", day(9));
    fx.at(day(9));
    let report = fx.report().await;
    assert_eq!(report["counts"]["withdrawn"], 1, "{report}");
    assert_eq!(report["checkpoint"], Value::Null);
    let stub = stub(&fx, &proposal);
    assert_eq!(stub["state"], "withdrawn");
    assert_eq!(stub["redacted"], false);
    assert_eq!(stub["withdrawal"]["reason"], "source-changed");
    let body = fx.curator_body("candidate", &candidate(1)).unwrap();
    assert!(record_validator().is_valid(&body), "{body:#}");
    assert_eq!(body["proposal"], Value::Null);
    assert!(body.get("contentHash").is_some(), "not erased");
}

#[tokio::test]
async fn expiry_is_read_against_the_clock() {
    let mut fx = Fx::new();
    let mut entry = fact(1, "human:ada", &["space"], SUBJECT, TEXT);
    entry.expires_at = day(10);
    umbel_store::conformance::samples::agree(&mut entry);
    fx.remember_twice(entry, 101);
    fx.at(day(8));
    data(&fx.run().await);
    let proposal = fx.stubs_of(&candidate(1))[0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    // No change marks an expiry: the re-check reads the source at the run's now.
    fx.at(day(11));
    let report = fx.report().await;
    assert_eq!(report["counts"]["withdrawn"], 1, "{report}");
    assert_eq!(
        stub(&fx, &proposal)["withdrawal"]["reason"],
        "source-changed"
    );
}

#[tokio::test]
async fn a_confirmation_withdraws_the_draft_of_the_version_it_replaced() {
    let mut fx = Fx::new();
    fx.pack(|pack| {
        pack.replace(
            "authorities = [\"person\"]",
            "authorities = [\"person\", \"agent\"]",
        )
    });
    fx.remember_twice(
        with_authority(
            fact(1, "human:ada", &["space"], SUBJECT, TEXT),
            Authority::Agent,
        ),
        101,
    );
    fx.at(day(8));
    data(&fx.run().await);
    let proposal = fx.stubs_of(&candidate(1))[0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    fx.confirm(&mem(1), "human:ada", day(9));
    fx.at(day(9));
    let report = fx.report().await;
    assert_eq!(report["counts"]["withdrawn"], 1, "{report}");
    assert_eq!(stub(&fx, &proposal)["redacted"], false);
    // It re-settles at the raised authority and is drafted under a new key.
    fx.at(day(17));
    let report = fx.report().await;
    assert_eq!(report["counts"]["drafted"], 1, "{report}");
    assert_eq!(fx.only().await["authority"], "person");
}

#[tokio::test]
async fn a_source_the_caller_no_longer_reads_withdraws_without_redaction() {
    let mut fx = Fx::new();
    let proposal = drafted(&mut fx, 1).await;
    fx.forget(&mem(1), "human:ada");
    // The caller's view of the changes feed shows no erasure (as for a record whose readers no
    // longer include them): the re-check alone finds it gone.
    let state = state_id("main", "human:local");
    let mut body = fx.curator_body("state", &state).unwrap();
    body["memoryAfter"] = json!(1_000_000);
    fx.put_curator_record("state", &state, body, &["principal:human:local"]);
    let report = fx.report().await;
    assert_eq!(report["counts"]["withdrawn"], 1, "{report}");
    let stub = stub(&fx, &proposal);
    assert_eq!(stub["withdrawal"]["reason"], "source-changed");
    assert_eq!(
        stub["redacted"], false,
        "an absent record may not be erased"
    );
}
