//! Withdrawal and redaction of a drafted proposal (phase 4 specification, section 9.1; D103):
//! the redacted record section 9.1 and step 1's amendments describe, checked against
//! `proposal.v2.json`; its canaries and source hash gone from the raw bytes of `store.sqlite3` and
//! its write-ahead log after the checkpoint, from the journal, the events and every result; the
//! checkpoint's `pending` answer carried to the batch's result while a reader holds the log, and a
//! later checkpoint finishing it; idempotent; applied proposals untouched; only the drafter of its
//! own proposals withdraws or redacts.
//!
//! The memory-derived drafts are written straight into the store, as 3a's test support does,
//! since no command stores memory evidence before step 3c; the batch's own drafts, which cite
//! documents, are redacted too.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::path::PathBuf;

use serde_json::{Value, json};
use support::drafter::{self, item, item_code, submit, submit_as, verify};
use support::records::{self, Draft};
use support::*;
use umbel_store::{ContentHash, canonical_json};

const RUNBOOK: &str =
    "---\ntitle: Rolling back\ntype: runbook\n---\n# Rolling back\n\nUse the previous tag.\n";
/// The batch's clock: `fixed_clock(1_767_225_600_000)`.
const NOW: &str = "2026-01-01T00:00:00.000Z";

async fn fixture() -> Fx {
    let fx = Fx::with_drafters(&drafter::config(&["curator"], "local"));
    fx.handbook("runbook.md", RUNBOOK);
    fx.refresh("main").await;
    fx
}

fn draft(candidate: &str, canary: &str) -> Value {
    records::drafted(&Draft {
        candidate,
        canary,
        promoted_by: None,
        conflict_set: None,
    })
}

fn erase(id: &str) -> Value {
    json!([{ "proposal": id, "reason": "source-erased", "redact": true }])
}

/// Every file of `main`'s store directory whose raw bytes hold `needle`.
fn files_holding(fx: &Fx, needle: &str) -> Vec<PathBuf> {
    let dir = fx.state_dir("main").join("store");
    std::fs::read_dir(&dir)
        .unwrap()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_file())
        .filter(|path| {
            std::fs::read(path)
                .unwrap()
                .windows(needle.len())
                .any(|window| window == needle.as_bytes())
        })
        .collect()
}

/// `body` as the batch leaves it at [`NOW`]: section 9.1's redaction, its instants the clock's.
fn expected(body: &Value) -> Value {
    let mut redacted = records::redacted(body.clone());
    redacted["withdrawal"]["at"] = json!(NOW);
    redacted["redacted"]["at"] = json!(NOW);
    redacted["updatedAt"] = json!(NOW);
    redacted
}

#[tokio::test]
async fn a_forgotten_source_withdraws_and_redacts_the_draft() {
    let fx = fixture().await;
    let canary = "wombatcanary";
    let body = draft("1c2d3e4f5061728394a5", canary);
    records::assert_valid("proposal.v2", &body);
    let seeded = records::seed(&fx, &body);
    let id = body["id"].as_str().unwrap();
    assert!(!files_holding(&fx, canary).is_empty(), "the scan sees it");

    let (result, _) = submit(&fx, json!([]), Some(erase(id))).await;
    let batch = data(&result);
    let done = item(batch, "withdrawals", 0);
    assert_eq!(done["ok"], true, "{result}");
    assert_eq!(done["withdrawn"], true);
    assert_eq!(done["redacted"], true);
    assert_eq!(batch["counts"]["redacted"], 1);
    assert_eq!(batch["checkpoint"], "clean", "{result}");
    assert!(warning(&result, "PROPOSAL_REDACTION_PENDING").is_none());

    // The record: section 9.1's redaction, valid as version 2, its id and document unchanged.
    let record = records::read(&fx, id);
    records::assert_valid("proposal.v2", &record.body);
    assert_eq!(record.body, expected(&body));
    assert_eq!(record.body["id"], body["id"]);
    assert_eq!(record.body["change"]["doc"], body["change"]["doc"]);
    let hash = ContentHash::of(canonical_json(&json!({ "redacted": id })).as_bytes()).to_string();
    assert_eq!(record.body["changeHash"], hash.as_str());
    assert_eq!(record.body["provenance"]["contentHash"], hash.as_str());
    // The stored envelope too: no derivedFrom, and its hash the redacted body's.
    assert_eq!(record.envelope.derived_from, None);
    assert_eq!(
        record.envelope.content_hash.as_deref(),
        Some(record.content_hash.as_str())
    );
    assert_ne!(record.content_hash, seeded.content_hash);

    // After the checkpoint, nothing of the source remains: not in the database file or its
    // write-ahead log, the journal, the events or the result.
    for needle in [canary, records::SOURCE_HASH] {
        assert_eq!(
            files_holding(&fx, needle),
            Vec::<PathBuf>::new(),
            "{needle}"
        );
        assert!(
            !records::journal(&fx).contains(needle),
            "{needle} in the journal"
        );
        assert!(
            !records::events(&fx).contains(needle),
            "{needle} in the events"
        );
    }
    never_mentions(&result, &[canary, records::SOURCE_HASH, "derivedFrom"]);
}

#[tokio::test]
async fn a_redaction_is_idempotent() {
    let fx = fixture().await;
    let body = draft("2c2d3e4f5061728394a5", "quollcanary");
    records::seed(&fx, &body);
    let id = body["id"].as_str().unwrap();
    let (first, _) = submit(&fx, json!([]), Some(erase(id))).await;
    assert_eq!(item(data(&first), "withdrawals", 0)["redacted"], true);
    let before = records::read(&fx, id);

    let (second, _) = submit(&fx, json!([]), Some(erase(id))).await;
    let batch = data(&second);
    let again = item(batch, "withdrawals", 0);
    assert_eq!(again["ok"], true, "{second}");
    assert_eq!(again["withdrawn"], false);
    assert_eq!(again["redacted"], false);
    // Nothing was written, so no checkpoint ran.
    assert_eq!(batch["checkpoint"], Value::Null);
    let after = records::read(&fx, id);
    assert_eq!(after.rev, before.rev);
    assert_eq!(after.content_hash, before.content_hash);
}

#[tokio::test]
async fn a_draft_withdrawn_for_another_reason_is_redacted_when_its_source_is_erased() {
    let fx = fixture().await;
    let canary = "bandicootcanary";
    let body = draft("3c2d3e4f5061728394a5", canary);
    records::seed(&fx, &body);
    let id = body["id"].as_str().unwrap();
    // A source absent at the re-check: withdrawn, not redacted.
    let (changed, _) = submit(
        &fx,
        json!([]),
        Some(json!([{ "proposal": id, "reason": "source-changed" }])),
    )
    .await;
    let done = item(data(&changed), "withdrawals", 0);
    assert_eq!(done["withdrawn"], true, "{changed}");
    assert_eq!(done["redacted"], false);
    assert_eq!(data(&changed)["checkpoint"], Value::Null);
    let withdrawn = records::read(&fx, id).body;
    records::assert_valid("proposal.v2", &withdrawn);
    assert_eq!(
        withdrawn["withdrawal"],
        json!({ "by": "drafter", "reason": "source-changed", "at": NOW })
    );
    assert_eq!(withdrawn["redacted"], Value::Null);
    assert!(withdrawn.to_string().contains(canary), "kept until erased");

    // The next run's feed shows it erased: redacted in place.
    let (erased, _) = submit(&fx, json!([]), Some(erase(id))).await;
    let done = item(data(&erased), "withdrawals", 0);
    assert_eq!(done["withdrawn"], false, "{erased}");
    assert_eq!(done["redacted"], true);
    let record = records::read(&fx, id).body;
    records::assert_valid("proposal.v2", &record);
    assert_eq!(record, expected(&body));
    assert_eq!(files_holding(&fx, canary), Vec::<PathBuf>::new());
}

#[tokio::test]
async fn an_applied_or_decided_proposal_is_never_retracted() {
    let fx = fixture().await;
    for (candidate, state) in [
        ("4c2d3e4f5061728394a5", "applied"),
        ("5c2d3e4f5061728394a5", "rejected"),
    ] {
        let mut body = draft(candidate, "potoroocanary");
        body["state"] = json!(state);
        body["decision"] = json!({
            "by": { "kind": "human", "id": "bo" }, "principal": "human:bo", "at": NOW,
            "traceId": "0a1b2c3d4e5f60718293a4b5c6d7e8f9", "proposerKind": "human",
            "channel": "terminal",
        });
        if state == "applied" {
            body["result"] = json!({ "rev": 7, "contentHash": format!("sha256:{}", "7a".repeat(32)), "path": "learned/x.md" });
        } else {
            body["decision"]["reason"] = json!("No.");
        }
        records::assert_valid("proposal.v2", &body);
        let seeded = records::seed(&fx, &body);
        let id = body["id"].as_str().unwrap();
        for withdraw in [
            erase(id),
            json!([{ "proposal": id, "reason": "source-changed" }]),
        ] {
            let (result, _) = submit(&fx, json!([]), Some(withdraw)).await;
            assert_eq!(
                item_code(item(data(&result), "withdrawals", 0)),
                "PROPOSAL_STATE_INVALID",
                "{state}: {result}"
            );
        }
        let after = records::read(&fx, id);
        assert_eq!(after.content_hash, seeded.content_hash, "{state} untouched");
        assert_eq!(after.body, body);
    }
}

#[tokio::test]
async fn only_the_drafter_of_its_callers_own_proposal_withdraws_or_redacts_it() {
    let fx = fixture().await;
    let base = data(
        &fx.as_actor(
            member(),
            "knowledge-list",
            json!({ "prefix": "handbook/runbook" }),
        )
        .await,
    )["documents"][0]["contentHash"]
        .as_str()
        .unwrap()
        .to_owned();
    let mine = draft("6c2d3e4f5061728394a5", "dibblercanary");
    records::seed(&fx, &mine);
    let id = mine["id"].as_str().unwrap();

    // An unlisted drafter is refused whole.
    let (scribe, _) = submit_as(&fx, "scribe", json!([]), Some(erase(id))).await;
    assert_eq!(code(&scribe), "PROPOSAL_DRAFTER_NOT_ALLOWED", "{scribe}");

    // Another proposer's draft, and an undrafted proposal: not the drafter's to withdraw.
    let mut zeds = draft("7c2d3e4f5061728394a5", "dibblercanary");
    zeds["proposer"] =
        json!({ "actor": { "kind": "human", "id": "zed" }, "principal": "human:zed" });
    records::seed(&fx, &zeds);
    let own = fx
        .cli(
            "knowledge-propose",
            verify("plain", "handbook/runbook", &base),
        )
        .await;
    let plain = data(&own)["proposal"]["id"].as_str().unwrap().to_owned();
    // A draft its proposer took back with knowledge-withdraw: withdrawn, but not by the drafter,
    // so version 2 cannot record a redaction of it.
    let retracted = draft("8c2d3e4f5061728394a5", "dibblercanary");
    records::seed(&fx, &retracted);
    let took_back = fx
        .cli("knowledge-withdraw", json!({ "proposal": retracted["id"] }))
        .await;
    assert_eq!(data(&took_back)["withdrawn"], true, "{took_back}");

    let (result, _) = submit(
        &fx,
        json!([]),
        Some(json!([
            { "proposal": zeds["id"], "reason": "source-erased", "redact": true },
            { "proposal": plain, "reason": "source-changed" },
            { "proposal": retracted["id"], "reason": "source-erased", "redact": true },
            { "proposal": id, "reason": "source-changed", "redact": true },
            { "proposal": id, "reason": "source-erased" },
            { "proposal": "p-0123456789abcdef0123", "reason": "source-changed" },
        ])),
    )
    .await;
    let batch = data(&result);
    let codes: Vec<&str> = (0..6)
        .map(|index| item_code(item(batch, "withdrawals", index)))
        .collect();
    assert_eq!(
        codes,
        [
            "PROPOSAL_NOT_PROPOSER",
            "PROPOSAL_NOT_PROPOSER",
            "PROPOSAL_STATE_INVALID",
            "PROPOSAL_INVALID",
            "PROPOSAL_INVALID",
            "PROPOSAL_NOT_FOUND",
        ],
        "{result}"
    );
    assert_eq!(item(batch, "withdrawals", 0)["proposal"], zeds["id"]);
    assert_eq!(batch["checkpoint"], Value::Null);
    // `retracted` is a proposer's reason: the input schema refuses it.
    let (proposer_reason, _) = submit(
        &fx,
        json!([]),
        Some(json!([{ "proposal": id, "reason": "retracted" }])),
    )
    .await;
    assert_eq!(
        code(&proposer_reason),
        "VALIDATION_ERROR",
        "{proposer_reason}"
    );
    // The drafter's own pending draft is untouched by all of it.
    assert_eq!(records::read(&fx, id).body, mine);
}

#[tokio::test]
async fn a_reader_holding_the_log_leaves_the_redaction_pending_until_a_later_checkpoint() {
    let fx = fixture().await;
    let canary = "antechinuscanary";
    let body = draft("9c2d3e4f5061728394a5", canary);
    records::seed(&fx, &body);
    let id = body["id"].as_str().unwrap();

    let store = records::store(&fx, "main");
    let hold = store.hold_reader().unwrap();
    let (result, _) = submit(&fx, json!([]), Some(erase(id))).await;
    let batch = data(&result);
    assert_eq!(item(batch, "withdrawals", 0)["redacted"], true, "{result}");
    assert_eq!(batch["checkpoint"], "pending", "{result}");
    // The batch's own result warns; the pipeline's result is `last`'s data, which says so in
    // `checkpoint`. The step's journal entry, a digest, keeps the warning's code.
    let entries = records::journal_entries(&fx, "knowledge-propose-batch");
    let warned: Vec<&Value> = entries
        .iter()
        .flat_map(|entry| entry["result"]["warnings"].as_array().into_iter().flatten())
        .collect();
    assert!(
        warned
            .iter()
            .any(|warning| warning["code"] == "PROPOSAL_REDACTION_PENDING"),
        "{entries:?}"
    );
    // The record is redacted; the reader's snapshot keeps the earlier bytes on disk.
    assert_eq!(records::read(&fx, id).body, expected(&body));
    assert!(!files_holding(&fx, canary).is_empty());

    drop(hold);
    // A later checkpoint finishes it: store-check's, run once no reader holds the store.
    let check = fx.cli("store-check", json!({})).await;
    assert!(check.get("success").is_some(), "{check}");
    assert_eq!(files_holding(&fx, canary), Vec::<PathBuf>::new());
    assert_eq!(
        files_holding(&fx, records::SOURCE_HASH),
        Vec::<PathBuf>::new()
    );
}

#[tokio::test]
async fn the_batchs_own_draft_citing_a_document_is_redacted_too() {
    let fx = fixture().await;
    let canary = "kowaricanary";
    let base = data(
        &fx.as_actor(
            member(),
            "knowledge-list",
            json!({ "prefix": "handbook/runbook" }),
        )
        .await,
    )["documents"][0]["contentHash"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut proposal = verify("v1", "handbook/runbook", &base);
    proposal["rationale"] = json!(format!("Due: {canary}."));
    proposal["change"]["verification"] = json!({ "note": format!("Checked {canary}.") });
    proposal["evidence"][1]["excerpt"] = json!(format!("pass {canary}"));
    let (created, _) = submit(&fx, json!([proposal]), None).await;
    let id = item(data(&created), "results", 0)["proposal"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(records::read(&fx, &id).body.to_string().contains(canary));

    let (result, _) = submit(&fx, json!([]), Some(erase(&id))).await;
    assert_eq!(data(&result)["checkpoint"], "clean", "{result}");
    let record = records::read(&fx, &id).body;
    records::assert_valid("proposal.v2", &record);
    assert_eq!(record["state"], "withdrawn");
    assert_eq!(record["diff"], "");
    assert_eq!(record["rationale"], records::REDACTED_RATIONALE);
    assert_eq!(record["change"]["verification"], json!({}));
    assert_eq!(
        record["evidence"],
        json!([
            { "kind": "document", "ref": "handbook/runbook", "contentHash": base },
            { "kind": "text", "ref": "check:links-resolve" },
        ])
    );
    assert_eq!(
        record["redacted"],
        json!({ "at": NOW, "reason": "source-erased" })
    );
    assert_eq!(files_holding(&fx, canary), Vec::<PathBuf>::new());
    assert!(
        !records::journal(&fx).contains(canary),
        "the batch is digest-journaled"
    );
    assert!(!records::events(&fx).contains(canary));
}
