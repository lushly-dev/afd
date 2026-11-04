//! Drafting (phase 4 specification, section 4.5, with step 3c's amendment 1): a ready candidate as
//! a `knowledge-propose-batch` item through `umbel_okf::draft`, checked here against every row of
//! the knowledge plugin's verification (section 3.2) re-derived from the memory store's records,
//! byte for byte; content-free ids, paths and keys; a stable rerun; constraints in the document
//! and every evidence entry; a promotion's claims; the instance in `generated.by` and the key.
//!
//! `first-party/tests/curator_drafts.rs` submits the same drafts through the real knowledge
//! plugin's `knowledge-propose-batch` under the host's pipeline attestation.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::collections::BTreeSet;

use serde_json::{Value, json};
use support::*;
use umbel_okf::draft::{self, Draft, Rationale};
use umbel_plugin_curator::draft::{Drafter, item};
use umbel_plugin_curator::evaluate::{Candidate, Inputs, Status, evaluate};
use umbel_plugin_curator::pack::Settle;
use umbel_plugin_curator::records::{Consent, Consented, consent_id};
use umbel_plugin_curator::target::Target;
use umbel_store::{MemoryRecord, Sensitivity};

const CURATOR: Drafter<'static> = Drafter {
    plugin: "curator",
    instance: "curator",
};

fn target() -> Target {
    Target {
        collection: "notes".into(),
        prefix: Some("learned".into()),
        access: vec!["space".into()],
        sensitivity: Sensitivity::Internal,
    }
}

/// The candidates of `records` for `human:local` at `now`, with `consents`, and no document
/// existing.
fn candidates(records: Vec<MemoryRecord>, now: i64, consents: &[Consent]) -> Vec<Candidate> {
    let settle = Settle::default();
    let target = target();
    let inputs = Inputs {
        space: "main",
        principal: "human:local",
        now,
        settle: &settle,
        target: &target,
        records,
        stored: &[],
        consents,
    };
    evaluate(inputs, |_| Ok::<_, ()>(false)).unwrap().candidates
}

/// Section 3.2's checks, as the knowledge plugin makes them, of `item` drafted by `drafter` for
/// `human:local` in `main` from `records` (the store's current versions) into `target`.
fn verify(item: &Value, records: &[MemoryRecord], drafter: Drafter<'_>, now: i64) {
    let first = &records[0];
    // Evidence: memory only, one entry per source, each copied exactly.
    let owners: BTreeSet<&str> = records.iter().map(|r| r.scope.principal.as_str()).collect();
    let evidence = item["evidence"].as_array().unwrap();
    assert_eq!(evidence.len(), records.len());
    for (entry, record) in evidence.iter().zip(records) {
        assert_eq!(
            entry,
            &json!({
                "kind": "memory",
                "ref": format!("{}@{}", record.id, record.record_version),
                "principal": record.scope.principal,
                "contentHash": record.content_hash,
                "class": record.class.as_str(),
                "authority": record.provenance.authority,
                "origin": record.provenance.origin,
                "constraints": record.provenance.constraints,
                "access": record.access.tokens(),
                "sensitivity": record.sensitivity,
                "confirmation": record.provenance.confirmation,
                "observations": {
                    "sessions": record.observations.sessions,
                    "principals": owners.len(),
                },
                "excerpt": draft::excerpt(&record.text),
            })
        );
    }
    // `derivedFrom` names each source once, with its hash.
    let derived: Vec<Value> = records
        .iter()
        .map(|r| json!({ "kind": "memory", "id": r.id, "contentHash": r.content_hash }))
        .collect();
    assert_eq!(item["derivedFrom"], json!(derived));
    // One group.
    assert!(
        records
            .iter()
            .all(|r| r.content_hash == first.content_hash && r.class == first.class)
    );
    // Confidence: the highest asserted.
    let highest = records
        .iter()
        .filter_map(|r| r.provenance.confidence)
        .reduce(f64::max);
    assert_eq!(item["confidence"], json!(highest));
    // Content: byte-equal to the fixed rendering at the instant it carries.
    let content = item["change"]["content"].as_str().unwrap();
    let settled = draft::settled_at(content).unwrap();
    assert!(records.iter().all(|r| settled >= r.recorded_at) && settled <= now);
    let rendered = draft::render(&Draft {
        class: first.class,
        subject: &first.subject,
        text: &first.text,
        tags: records.iter().flat_map(|r| r.tags.clone()).collect(),
        constraints: records
            .iter()
            .flat_map(|r| r.provenance.constraints.clone().unwrap_or_default())
            .collect(),
        plugin: drafter.plugin,
        instance: drafter.instance,
        settled_at: settled,
    });
    assert_eq!(content, rendered);
    // Rationale: the fixed text, of the group's class and at most its counts and authority.
    let rationale = Rationale::parse(item["rationale"].as_str().unwrap()).unwrap();
    assert_eq!(rationale.class, first.class);
    assert_eq!(rationale.settled_at, settled);
    let authority = records
        .iter()
        .filter_map(MemoryRecord::authority)
        .min()
        .unwrap();
    assert!(rationale.authority >= authority);
    let sessions: u64 = records.iter().map(|r| r.observations.sessions).sum();
    assert!(rationale.sessions <= sessions && rationale.principals <= owners.len() as u64);
    // Candidate, key and document, from ids alone.
    let lowest = records.iter().map(|r| r.id.as_str()).min().unwrap();
    let candidate = draft::candidate_id("main", "human:local", lowest);
    assert_eq!(item["drafter"]["candidate"], candidate.as_str());
    let key = item["idempotency_key"].as_str().unwrap();
    assert!(
        draft::is_idempotency_key(key, drafter.instance, &candidate),
        "{key}"
    );
    let id = item["conflictSet"].as_str().unwrap_or(&candidate);
    assert_eq!(
        item["change"],
        json!({
            "op": "create",
            "doc": draft::document_id("notes", Some("learned"), id),
            "content": content,
        })
    );
    // Nothing else is claimed.
    let keys: BTreeSet<&str> = item
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    let mut expected: BTreeSet<&str> = [
        "idempotency_key",
        "change",
        "rationale",
        "evidence",
        "confidence",
        "drafter",
        "derivedFrom",
    ]
    .into();
    if item.get("conflictSet").is_some() {
        expected.insert("conflictSet");
    }
    assert_eq!(keys, expected);
}

#[tokio::test]
async fn a_draft_is_the_shared_fixed_rendering_byte_for_byte() {
    let mut fx = Fx::new();
    fx.remember_twice(
        constrained(
            fact(
                1,
                "human:ada",
                &["space"],
                "Staging \"rollbacks\"",
                "Use the canary flag.",
            ),
            &["staging only", "ask first"],
        ),
        2,
    );
    fx.at(day(8));
    let record = fx.record(&mem(1));
    let found = candidates(vec![record.clone()], day(8), &[]);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].status, Status::Ready);
    let item = item(&found[0], CURATOR).unwrap();
    verify(&item, std::slice::from_ref(&record), CURATOR, day(8));
    // The exact bytes of section 4.5, with the settling instant and both constraints sorted.
    let candidate = draft::candidate_id("main", "human:local", &mem(1));
    assert_eq!(
        item["change"]["content"],
        "---\ntitle: \"Staging \\\"rollbacks\\\"\"\ntype: \"fact\"\ntags: [\"deploy\"]\ngenerated:\n  by: \"umbel:curator/curator\"\n  at: \"2026-01-08T00:00:00.000Z\"\n---\nUse the canary flag.\n\n## Holds only\n\n- \"ask first\"\n- \"staging only\"\n"
    );
    assert_eq!(
        item["rationale"],
        "Drafted from semantic memory of authority person, observed in 2 sessions by 1 principal, settled at 2026-01-08T00:00:00.000Z."
    );
    assert_eq!(item["idempotency_key"], format!("curator/{candidate}/0"));
    assert_eq!(
        item["drafter"],
        json!({ "mode": "scheduled", "candidate": candidate })
    );
    assert_eq!(item["confidence"], 0.8);
}

#[tokio::test]
async fn ids_paths_and_keys_are_content_free() {
    let mut fx = Fx::new();
    let canary = "zebracanary";
    let mut entry = fact(
        1,
        "human:ada",
        &["space"],
        &format!("Subject {canary}"),
        &format!("Text {canary}"),
    );
    entry.tags = vec![canary.to_owned()];
    fx.remember_twice(entry, 2);
    fx.at(day(8));
    let record = fx.record(&mem(1));
    let item = item(&candidates(vec![record.clone()], day(8), &[])[0], CURATOR).unwrap();
    let hash = record
        .content_hash
        .as_str()
        .strip_prefix("sha256:")
        .unwrap();
    for free in [
        &item["drafter"]["candidate"],
        &item["change"]["doc"],
        &item["idempotency_key"],
    ] {
        let text = free.as_str().unwrap();
        never_mentions(&text.to_lowercase(), &[canary, &hash[..12], "subject"]);
    }
    // And `curator-candidates` shows none of it either, nor does the journal keep it.
    let result = fx.candidates().await;
    never_mentions(&result.to_string(), &[canary, &hash[..12]]);
    never_mentions(&fx.journaled_text(), &[canary, &hash[..12]]);
}

#[tokio::test]
async fn a_rerun_renders_byte_equal_input() {
    let mut fx = Fx::new();
    fx.remember_twice(
        fact(1, "human:ada", &["space"], "Stable", "Same each run."),
        2,
    );
    fx.at(day(8));
    let record = fx.record(&mem(1));
    let first = item(&candidates(vec![record.clone()], day(8), &[])[0], CURATOR).unwrap();
    let later = item(&candidates(vec![record], day(40), &[])[0], CURATOR).unwrap();
    assert_eq!(first, later);
    assert_eq!(first.to_string(), later.to_string());
}

#[tokio::test]
async fn constraints_survive_into_the_document_and_every_evidence_entry() {
    let mut fx = Fx::new();
    let text = "Roll back with the canary flag.";
    fx.remember(vec![
        constrained(
            fact(1, "human:ada", &["space"], "Rollbacks", text),
            &["staging only"],
        ),
        constrained(
            fact(2, "human:bo", &["space"], "Rollbacks", text),
            &["weekdays", "staging only"],
        ),
    ]);
    fx.at(day(8));
    let records = vec![fx.record(&mem(1)), fx.record(&mem(2))];
    let found = candidates(records.clone(), day(8), &[]);
    assert_eq!(found.len(), 1);
    let item = item(&found[0], CURATOR).unwrap();
    verify(&item, &records, CURATOR, day(8));
    let content = item["change"]["content"].as_str().unwrap();
    assert!(
        content.ends_with("## Holds only\n\n- \"staging only\"\n- \"weekdays\"\n"),
        "{content}"
    );
    let evidence = item["evidence"].as_array().unwrap();
    assert_eq!(evidence[0]["constraints"], json!(["staging only"]));
    assert_eq!(
        evidence[1]["constraints"],
        json!(["weekdays", "staging only"])
    );
    assert_eq!(evidence[0]["observations"]["principals"], 2);
}

#[tokio::test]
async fn a_promotion_claims_its_owner_and_the_instance_names_itself() {
    let mut fx = Fx::new();
    fx.remember_twice(
        fact(
            1,
            "human:local",
            &["principal:human:local"],
            "Mine",
            "Private.",
        ),
        2,
    );
    fx.at(day(8));
    let record = fx.record(&mem(1));
    let found = candidates(vec![record.clone()], day(8), &[]);
    assert_eq!(found[0].status, Status::NeedsPromotion);
    assert!(item(&found[0], CURATOR).is_none(), "not ready, no draft");
    let consent = Consent {
        id: consent_id(&found[0].id),
        by: "human:local".into(),
        at: day(8),
        sources: vec![Consented {
            id: record.id.clone(),
            record_version: record.record_version,
            content_hash: record.content_hash.as_str().to_owned(),
        }],
    };
    let found = candidates(vec![record.clone()], day(8), std::slice::from_ref(&consent));
    assert_eq!(found[0].status, Status::Ready);
    let mine = Drafter {
        plugin: "curator",
        instance: "learner",
    };
    let item = item(&found[0], mine).unwrap();
    verify(&item, std::slice::from_ref(&record), mine, day(8));
    assert_eq!(
        item["drafter"],
        json!({ "mode": "promoted", "candidate": found[0].id, "promotedBy": "human:local" })
    );
    assert!(
        item["change"]["content"]
            .as_str()
            .unwrap()
            .contains("by: \"umbel:curator/learner\"")
    );
    assert_eq!(
        item["idempotency_key"],
        format!("learner/{}/0", found[0].id)
    );
    // A consent to another version covers nothing.
    let mut stale = consent;
    stale.sources[0].record_version += 1;
    let found = candidates(vec![record], day(8), &[stale]);
    assert_eq!(found[0].status, Status::NeedsPromotion);
}

#[tokio::test]
async fn an_alternative_is_drafted_on_its_sets_path_with_the_set() {
    let mut fx = Fx::new();
    fx.remember_twice(fact(1, "human:ada", &["space"], "Rollbacks", "Canary."), 2);
    fx.remember_twice(fact(3, "human:ada", &["space"], "rollbacks.", "Script."), 4);
    fx.at(day(8));
    let records = vec![fx.record(&mem(1)), fx.record(&mem(3))];
    let found = candidates(records.clone(), day(8), &[]);
    assert_eq!(found.len(), 2);
    for candidate in &found {
        let item = item(candidate, CURATOR).unwrap();
        let source = records
            .iter()
            .find(|r| draft::candidate_id("main", "human:local", &r.id) == candidate.id)
            .unwrap();
        verify(&item, std::slice::from_ref(source), CURATOR, day(8));
        let set = item["conflictSet"].as_str().unwrap();
        assert!(draft::is_conflict_set_id(set));
        assert_eq!(item["change"]["doc"], format!("notes/learned/{set}"));
    }
}
