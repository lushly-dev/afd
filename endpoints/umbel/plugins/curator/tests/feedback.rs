//! Rejection feedback (phase 4 specification, section 7.1, with 4.4's alternatives): the knowledge
//! feed's decisions on the caller's drafts, applied by `curator-finish`. A rejection quiets the
//! same content for `quiet_days` and keeps the approver's reason only in the caller's own record,
//! never shown; a changed record is a new candidate; an applied draft is never drafted again, and
//! the other alternatives of its conflict set are withdrawn as superseded.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::*;
use umbel_okf::draft;
use umbel_store::memory::format_instant;

fn candidate(lowest: u64) -> String {
    draft::candidate_id("main", "human:local", &mem(lowest))
}

fn shared(fx: &mut Fx, n: u64, subject: &str, text: &str) {
    fx.remember_twice(fact(n, "human:ada", &["space"], subject, text), n + 100);
}

/// The one stub of `candidate` that is in `state`.
fn stub_in(fx: &Fx, candidate: &str, state: &str) -> Value {
    let found: Vec<Value> = fx
        .stubs_of(candidate)
        .into_iter()
        .filter(|s| s["state"] == state)
        .collect();
    assert_eq!(found.len(), 1, "{found:#?}");
    found[0].clone()
}

#[tokio::test]
async fn a_rejected_draft_is_quiet_for_the_quiet_period_and_its_reason_is_never_shown() {
    let mut fx = Fx::new();
    shared(&mut fx, 1, "Rollbacks", "Use the canary flag.");
    fx.at(day(8));
    let id = candidate(1);
    data(&fx.run().await);
    let first = stub_in(&fx, &id, "pending");
    let reason = "Not true of production, said the approver";
    fx.decide(first["id"].as_str().unwrap(), "rejected", Some(reason))
        .await;

    let report = fx.report().await;
    assert_eq!(report["counts"]["rejected"], 1, "{report}");
    assert_eq!(report["counts"]["drafted"], 0);
    let body = fx.curator_body("candidate", &id).unwrap();
    assert!(record_validator().is_valid(&body), "{body:#}");
    assert_eq!(body["status"], "rejected");
    assert_eq!(body["proposal"], Value::Null);
    assert_eq!(body["quietUntil"], format_instant(day(8) + 90 * DAY));
    // The reason is the caller's own record's, and never in a result, journal or event.
    assert_eq!(body["reason"], reason);
    never_mentions(&report.to_string(), &[reason]);
    never_mentions(&fx.candidates().await.to_string(), &[reason]);
    never_mentions(&fx.status().await.to_string(), &[reason]);
    never_mentions(&fx.journaled_text(), &[reason]);
    assert_eq!(fx.only().await["status"], "rejected");

    // The same content is not drafted again inside the quiet period.
    fx.at(day(60));
    assert_eq!(fx.report().await["counts"]["drafted"], 0);
    assert_eq!(fx.stubs().len(), 1);
    // After it, it is drafted again under a new key.
    fx.at(day(8) + 91 * DAY);
    let report = fx.report().await;
    assert_eq!(report["counts"]["drafted"], 1, "{report}");
    let again = stub_in(&fx, &id, "pending");
    assert_eq!(again["key"], format!("curator/{id}/1"));
    assert_eq!(
        fx.curator_body("candidate", &id).unwrap()["reason"],
        Value::Null
    );
}

#[tokio::test]
async fn a_changed_record_is_a_new_candidate_whatever_the_rejection() {
    let mut fx = Fx::new();
    shared(&mut fx, 1, "Rollbacks", "Use the canary flag.");
    fx.at(day(8));
    data(&fx.run().await);
    let first = stub_in(&fx, &candidate(1), "pending");
    fx.decide(first["id"].as_str().unwrap(), "rejected", Some("no"))
        .await;
    data(&fx.run().await);
    // Ada restates it: a new record, which settles and is drafted inside the old quiet period.
    fx.invalidate(&mem(1), "human:ada", day(9));
    fx.remember_at(
        day(9),
        vec![fact(
            5,
            "human:ada",
            &["space"],
            "Rollbacks",
            "Use the deploy script.",
        )],
    );
    fx.remember_at(
        day(9) + 3_600_000,
        vec![again(
            &fact(
                5,
                "human:ada",
                &["space"],
                "Rollbacks",
                "Use the deploy script.",
            ),
            105,
            "s2",
        )],
    );
    fx.at(day(17));
    let report = fx.report().await;
    assert_eq!(report["counts"]["drafted"], 1, "{report}");
    assert_eq!(
        stub_in(&fx, &candidate(5), "pending")["key"],
        format!("curator/{}/0", candidate(5))
    );
}

#[tokio::test]
async fn an_applied_draft_is_never_drafted_again() {
    let mut fx = Fx::new();
    shared(&mut fx, 1, "Rollbacks", "Use the canary flag.");
    fx.at(day(8));
    let id = candidate(1);
    data(&fx.run().await);
    let stub = stub_in(&fx, &id, "pending");
    fx.decide(stub["id"].as_str().unwrap(), "applied", None)
        .await;
    let report = fx.report().await;
    assert_eq!(report["counts"]["applied"], 1, "{report}");
    let body = fx.curator_body("candidate", &id).unwrap();
    assert!(record_validator().is_valid(&body), "{body:#}");
    assert_eq!(body["status"], "applied");
    assert_eq!(body["promotedTo"], format!("notes/learned/{id}"));
    assert_eq!(body["proposal"], Value::Null);
    for at in [day(9), day(400)] {
        fx.at(at);
        let report = fx.report().await;
        assert_eq!(report["counts"]["drafted"], 0, "{report}");
    }
    assert_eq!(fx.stubs().len(), 1);
    assert_eq!(fx.only().await["status"], "applied");
    // The owner may close the applied record now (section 9.2); the curator never does.
    let status = fx
        .call(
            human("ada"),
            afd::CommandInterface::Cli,
            "curator-status",
            json!({}),
        )
        .await;
    assert_eq!(
        data(&status)["invalidatable"],
        json!([]),
        "Ada ran no curator"
    );
}

#[tokio::test]
async fn applying_one_alternative_withdraws_the_others_as_superseded() {
    let mut fx = Fx::new();
    shared(&mut fx, 1, "Release", "Tag from main.");
    shared(&mut fx, 3, "release!", "Tag from a branch.");
    fx.at(day(8));
    let report = fx.report().await;
    assert_eq!(report["counts"]["drafted"], 2, "{report}");
    let (a, b) = (candidate(1), candidate(3));
    let (sa, sb) = (stub_in(&fx, &a, "pending"), stub_in(&fx, &b, "pending"));
    assert!(sa["conflictSet"].is_string() && sa["conflictSet"] == sb["conflictSet"]);
    assert_eq!(
        sa["doc"], sb["doc"],
        "alternatives share the set's document"
    );
    fx.decide(sa["id"].as_str().unwrap(), "applied", None).await;
    // The run that learns of the apply records it; the next withdraws the other alternative.
    let learned = fx.report().await;
    assert_eq!(learned["counts"]["applied"], 1, "{learned}");
    let report = fx.report().await;
    assert_eq!(report["counts"]["withdrawn"], 1, "{report}");
    assert_eq!(
        stub_in(&fx, &b, "withdrawn")["withdrawal"]["reason"],
        "superseded-alternative"
    );
    let other = fx.curator_body("candidate", &b).unwrap();
    assert_eq!(other["proposal"], Value::Null);
    // The applied document now exists at the set's path, so the other is never drafted again.
    fx.document(sa["doc"].as_str().unwrap());
    let after = fx.report().await;
    assert_eq!(after["counts"]["drafted"], 0, "{after}");
    assert!(
        after["skipped"]
            .as_array()
            .unwrap()
            .contains(&json!({ "candidate": b, "reason": "target-exists" })),
        "{after}"
    );
}

#[tokio::test]
async fn only_the_callers_own_drafts_are_fed_back() {
    let mut fx = Fx::new();
    shared(&mut fx, 1, "Rollbacks", "Use the canary flag.");
    fx.at(day(8));
    // Bo drafts first; Local's draft of the same record is refused while Bo's is open.
    data(&fx.run_as(human("bo"), "main").await);
    let bos = draft::candidate_id("main", "human:bo", &mem(1));
    let stub = stub_in(&fx, &bos, "pending");
    fx.decide(stub["id"].as_str().unwrap(), "rejected", Some("no"))
        .await;
    // Local's run hears nothing of Bo's rejection, and is not quieted by it.
    let report = fx.report().await;
    assert_eq!(report["counts"]["rejected"], 0, "{report}");
    assert_eq!(report["counts"]["drafted"], 1);
    assert_eq!(fx.only().await["status"], "drafted");
}

#[tokio::test]
async fn a_confirmation_inside_the_quiet_period_does_not_end_it() {
    let mut fx = Fx::new();
    fx.pack(|pack| {
        pack.replace(
            "authorities = [\"person\"]",
            "authorities = [\"person\", \"agent\"]",
        )
    });
    fx.remember_twice(
        with_authority(
            fact(
                1,
                "human:ada",
                &["space"],
                "Rollbacks",
                "Use the canary flag.",
            ),
            umbel_store::Authority::Agent,
        ),
        101,
    );
    fx.at(day(8));
    let id = candidate(1);
    data(&fx.run().await);
    let first = stub_in(&fx, &id, "pending");
    fx.decide(first["id"].as_str().unwrap(), "rejected", Some("no"))
        .await;
    data(&fx.run().await);
    // Confirmed the next day, it re-settles a week later, still inside the quiet period.
    fx.confirm(&mem(1), "human:ada", day(9));
    for at in [day(10), day(20), day(97)] {
        fx.at(at);
        let report = fx.report().await;
        assert_eq!(report["counts"]["drafted"], 0, "{at}: {report}");
    }
    assert_eq!(
        fx.curator_body("candidate", &id).unwrap()["status"],
        "rejected"
    );
    fx.at(day(99));
    let report = fx.report().await;
    assert_eq!(report["counts"]["drafted"], 1, "{report}");
    assert_eq!(
        stub_in(&fx, &id, "pending")["key"],
        format!("curator/{id}/1")
    );
}
