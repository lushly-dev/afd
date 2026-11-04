//! Access and sensitivity (phase 4 specification, section 5.1; owner decision 5): a candidate is
//! drafted on a schedule only when the target's readers are within every source's and no source
//! is more sensitive; otherwise `needs-promotion` (wider) or `skipped` (`sensitivity-higher`), and
//! an existing document is `target-exists`. Curator records are per (space, principal) and carry
//! their access set: a candidate's is its sources' intersection with the caller's own token, and
//! nobody's records shape another caller's candidates.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::{Actor, ActorKind};
use serde_json::{Value, json};
use support::*;
use umbel_okf::draft;
use umbel_plugin_curator::evaluate::{Inputs, Status, evaluate};
use umbel_plugin_curator::pack::Settle;
use umbel_plugin_curator::records::candidate_body;
use umbel_plugin_curator::target::Target;
use umbel_store::Sensitivity;

fn candidate(principal: &str, lowest: u64) -> String {
    draft::candidate_id("main", principal, &mem(lowest))
}

fn row(rows: &[Value], principal: &str, lowest: u64) -> Value {
    let id = candidate(principal, lowest);
    rows.iter()
        .find(|r| r["candidate"] == id.as_str())
        .unwrap_or_else(|| panic!("no candidate of {lowest}: {rows:#?}"))
        .clone()
}

/// The workspace with the curator's target in `main` the collection `collection`.
fn targeting(collection: &str) -> String {
    config_with(
        &format!(
            "[plugins.curator.config.spaces.main]\ncollection = \"{collection}\"\nprefix = \"learned\"\n"
        ),
        "",
    )
}

#[tokio::test]
async fn a_target_within_every_sources_readers_is_drafted_on_a_schedule() {
    let mut fx = Fx::new();
    fx.remember_twice(
        fact(1, "human:ada", &["space"], "Shared", "With the space."),
        2,
    );
    fx.remember_twice(
        fact(
            3,
            "human:local",
            &["principal:human:local"],
            "Private",
            "Mine.",
        ),
        4,
    );
    fx.at(day(8));
    let result = fx.candidates().await;
    assert_eq!(data(&result)["target"]["access"], json!(["space"]));
    let rows = data(&result)["candidates"].as_array().unwrap().clone();
    let shared = row(&rows, "human:local", 1);
    assert_eq!(
        (shared["status"].clone(), shared["mode"].clone()),
        (json!("ready"), json!("scheduled"))
    );
    // Memory is private by default (D68): a person's own private fact needs their promotion.
    let private = row(&rows, "human:local", 3);
    assert_eq!(private["status"], "needs-promotion");
    assert!(private["mode"].is_null());
    assert_eq!(private["own"], true);
    let hash = fx.record(&mem(3)).content_hash.as_str().to_owned();
    assert_eq!(private["contentHash"], hash.as_str());
    assert_eq!(private["access"], json!(["principal:human:local"]));
}

#[tokio::test]
async fn readers_are_compared_token_by_token() {
    let mut fx = Fx::with(&targeting("team"));
    fx.remember_twice(fact(1, "human:ada", &["space"], "Space", "Space only."), 2);
    fx.remember_twice(
        fact(3, "human:ada", &["group:platform"], "Group", "The group."),
        4,
    );
    fx.remember_twice(
        fact(
            5,
            "human:ada",
            &["space", "group:platform"],
            "Both",
            "Either.",
        ),
        6,
    );
    fx.at(day(8));
    let rows = fx.rows().await;
    // `space` is not the token `group:platform`: the knowledge plugin compares the same way.
    assert_eq!(row(&rows, "human:local", 1)["status"], "needs-promotion");
    assert_eq!(row(&rows, "human:local", 3)["status"], "ready");
    assert_eq!(row(&rows, "human:local", 5)["status"], "ready");
    // Not Local's own: only Ada could promote the first.
    assert_eq!(row(&rows, "human:local", 1)["own"], false);
    assert!(row(&rows, "human:local", 1)["contentHash"].is_null());
}

#[tokio::test]
async fn a_more_sensitive_source_is_never_drafted_and_no_promotion_overrides_it() {
    let mut fx = Fx::new();
    fx.remember_twice(
        sensitive(
            fact(1, "human:local", &["space"], "Confidential", "Detail."),
            Sensitivity::Confidential,
        ),
        2,
    );
    fx.remember_twice(
        sensitive(
            fact(
                3,
                "human:local",
                &["principal:human:local"],
                "Private and restricted",
                "X.",
            ),
            Sensitivity::Restricted,
        ),
        4,
    );
    fx.remember_twice(
        sensitive(
            fact(5, "human:ada", &["space"], "Public", "Open."),
            Sensitivity::Public,
        ),
        6,
    );
    fx.at(day(8));
    let rows = fx.rows().await;
    for n in [1, 3] {
        let skipped = row(&rows, "human:local", n);
        assert_eq!(skipped["status"], "skipped");
        assert_eq!(skipped["reason"], "sensitivity-higher");
    }
    assert_eq!(row(&rows, "human:local", 5)["status"], "ready");
    // An internal record into a public collection is more sensitive too.
    fx.reconfigure(&targeting("open"));
    fx.remember_twice(fact(7, "human:ada", &["space"], "Internal", "Inside."), 8);
    fx.at(day(8));
    let rows = fx.rows().await;
    assert_eq!(row(&rows, "human:local", 7)["reason"], "sensitivity-higher");
    assert_eq!(row(&rows, "human:local", 5)["status"], "ready");
    // Skipped even while it settles: its sensitivity will not change. Into the public
    // collection, everything but the public record is more sensitive.
    fx.at(day(3));
    let rows = fx.rows().await;
    assert_eq!(rows.iter().filter(|r| r["status"] == "skipped").count(), 3);
    assert_eq!(row(&rows, "human:local", 5)["status"], "settling");
}

#[tokio::test]
async fn an_existing_document_is_target_exists() {
    let mut fx = Fx::new();
    fx.remember_twice(fact(1, "human:ada", &["space"], "Shared", "Text."), 2);
    fx.at(day(8));
    let doc = format!("notes/learned/{}", candidate("human:local", 1));
    fx.document(&doc);
    let only = fx.only().await;
    assert_eq!(only["status"], "skipped");
    assert_eq!(only["reason"], "target-exists");
    assert_eq!(only["doc"], doc.as_str());
}

#[tokio::test]
async fn a_candidates_access_is_its_sources_intersection_and_the_caller() {
    let mut fx = Fx::new();
    let text = "Shared differently.";
    fx.remember(vec![
        fact(1, "human:ada", &["space", "group:platform"], "Mixed", text),
        fact(2, "human:bo", &["space"], "Mixed", text),
    ]);
    fx.at(day(8));
    let only = fx.only().await;
    assert_eq!(only["access"], json!(["principal:human:local", "space"]));
    // Every candidate record the run of step 5 writes from these is valid and never wider.
    let settle = Settle::default();
    let target = Target {
        collection: "notes".into(),
        prefix: Some("learned".into()),
        access: vec!["space".into()],
        sensitivity: Sensitivity::Internal,
    };
    let validator = record_validator();
    for now in [day(3), day(8)] {
        let found = evaluate(
            Inputs {
                space: "main",
                principal: "human:local",
                now,
                settle: &settle,
                target: &target,
                records: vec![fx.record(&mem(1)), fx.record(&mem(2))],
                stored: &[],
                consents: &[],
            },
            |_| Ok::<_, ()>(false),
        )
        .unwrap();
        let candidate = &found.candidates[0];
        let body = candidate_body(candidate, "main", "human:local", day(3));
        assert!(validator.is_valid(&body), "{body:#}");
        assert_eq!(body["access"], json!(["principal:human:local", "space"]));
        assert_eq!(body["principal"], "human:local");
        // No memory text: the subject key is a digest, and there is no subject, text or tag.
        assert_eq!(body["subjectKey"], draft::subject_key_digest("Mixed"));
        never_mentions(&body.to_string(), &["Mixed", text, "deploy"]);
        assert_eq!(
            body["status"],
            if now == day(3) { "settling" } else { "ready" }
        );
    }
}

/// A candidate record of `principal` with `status` and `extra` fields, readable by `access`.
fn stored(id: &str, principal: &str, status: &str, extra: Value) -> Value {
    let mut body = json!({
        "version": 1, "kind": "candidate", "id": id, "space": "main",
        "principal": principal, "access": [format!("principal:{principal}"), "space"],
        "class": "semantic", "sensitivity": "internal", "status": status, "drafts": 1,
        "firstSeenAt": "2026-01-02T00:00:00.000Z",
        "snapshot": {
            "sessions": 2, "principals": 1, "authority": "person",
            "settledAt": "2026-01-08T00:00:00.000Z",
        },
        "promotedTo": null, "conflictSet": null, "quietUntil": null,
        "contentHash": format!("sha256:{}", "0".repeat(64)),
        "subjectKey": format!("sha256:{}", "1".repeat(64)),
        "sources": [{ "id": mem(1), "recordVersion": 1 }], "reason": null,
    });
    for (key, value) in extra.as_object().unwrap() {
        body[key] = value.clone();
    }
    body
}

#[tokio::test]
async fn curator_records_are_each_principals_own() {
    let mut fx = Fx::new();
    fx.remember_twice(
        fact(1, "human:ada", &["space"], "Shared", "Everyone reads it."),
        2,
    );
    fx.at(day(8));
    let locals = candidate("human:local", 1);
    // A run recorded Local's candidate as applied.
    let validator = record_validator();
    let applied = stored(
        &locals,
        "human:local",
        "applied",
        json!({ "promotedTo": format!("notes/learned/{locals}") }),
    );
    assert!(validator.is_valid(&applied), "{applied:#}");
    fx.put_curator_record(
        "candidate",
        &locals,
        applied,
        &["principal:human:local", "space"],
    );
    let row = fx.only().await;
    assert_eq!(row["status"], "applied");
    assert_eq!(row["promotedTo"], format!("notes/learned/{locals}"));
    assert_eq!(row["drafts"], 1);
    // Bo's candidate of the same record has his own id and none of Local's state.
    let bos = fx.rows_as(Actor::new(ActorKind::Human).with_id("bo")).await;
    assert_eq!(bos.len(), 1);
    assert_eq!(bos[0]["candidate"], candidate("human:bo", 1));
    assert_eq!(bos[0]["status"], "ready");
    assert_eq!(bos[0]["drafts"], 0);
    // A record of Ada's own candidate of the same memory, which Local can read through `space`,
    // is not Local's and shapes nothing of Local's.
    fx.put_curator_record(
        "candidate",
        &candidate("human:ada", 1),
        stored(
            &candidate("human:ada", 1),
            "human:ada",
            "rejected",
            json!({
                "reason": "no", "quietUntil": "2027-01-01T00:00:00.000Z",
            }),
        ),
        &["principal:human:ada", "space"],
    );
    assert_eq!(fx.only().await["status"], "applied");
    // An agent acting for Local is Local.
    let agent = Actor::new(ActorKind::Agent)
        .with_id("helper")
        .with_on_behalf_of("local");
    let theirs = fx.rows_as(agent).await;
    assert_eq!(theirs[0]["candidate"], locals.as_str());
    assert_eq!(theirs[0]["status"], "applied");
}

#[tokio::test]
async fn a_rejection_is_quiet_until_its_period_ends_and_outcomes_stay_listed() {
    let mut fx = Fx::new();
    fx.remember_twice(fact(1, "human:ada", &["space"], "Shared", "Text."), 2);
    fx.at(day(8));
    let locals = candidate("human:local", 1);
    let rejected = stored(
        &locals,
        "human:local",
        "rejected",
        json!({ "reason": "an approver's words", "quietUntil": "2026-04-01T00:00:00.000Z" }),
    );
    assert!(record_validator().is_valid(&rejected));
    fx.put_curator_record(
        "candidate",
        &locals,
        rejected,
        &["principal:human:local", "space"],
    );
    let row = fx.only().await;
    assert_eq!(row["status"], "rejected");
    assert_eq!(row["quietUntil"], "2026-04-01T00:00:00.000Z");
    // The approver's reason is content and never shown.
    never_mentions(&fx.candidates().await.to_string(), &["an approver's words"]);
    fx.at(day(100));
    assert_eq!(fx.only().await["status"], "ready");
    // An outcome whose sources are gone stays listed from the record alone.
    fx.invalidate(&mem(1), "human:ada", day(100));
    let result = fx.candidates().await;
    let rows = data(&result)["candidates"].as_array().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["status"], "rejected");
    assert!(rows[0]["doc"].is_null());
    assert_eq!(data(&result)["counts"]["rejected"], 1);
    let only_rejected = fx
        .candidates_as(human("local"), json!({ "status": ["ready"] }))
        .await;
    assert!(
        data(&only_rejected)["candidates"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        Status::parse("needs-promotion"),
        Some(Status::NeedsPromotion)
    );
}
