//! Withdrawal and redaction of a drafted proposal (phase 4 specification, section 9.1; D103):
//! the redacted record section 9.1 and step 1's amendments describe, checked against
//! `proposal.v2.json`; its canaries and source hash gone from the raw bytes of `store.sqlite3` and
//! its write-ahead log after the checkpoint, from the journal, the events and every result; the
//! checkpoint's `pending` answer carried to the batch's result while a reader holds the log, and a
//! later checkpoint finishing it; idempotent; applied proposals untouched; only the drafter of its
//! own proposals withdraws or redacts. Every draft that was not applied is redacted when its source
//! is erased, by name or by the `erased` notice, keeping its decision or withdrawal, and no earlier
//! hash of its body is left in the change log, the files, the journal or the events (step 3b,
//! amendments 12 and 13).
//!
//! Most memory-derived drafts are written straight into the store, as 3a's test support does, and
//! cite a record the memory store never held; one is a draft the batch verified against a real
//! record, which is then forgotten. Since step 3c the drafter's word that a source was erased is
//! checked: a draft citing no memory record is not redacted as if one were.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::path::PathBuf;

use serde_json::{Value, json};
use support::drafter::{self, feed_as, item, item_code, notice, submit, submit_as, verify};
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

/// `body` redacted at [`NOW`] in its own state: a pending one withdrawn by the drafter; any other
/// keeping its state, withdrawal and decision, but not a decision's reason.
fn expected_kept(body: &Value) -> Value {
    let mut wanted = expected(body);
    if body["state"] != "pending" {
        wanted["state"] = body["state"].clone();
        wanted["withdrawal"] = body["withdrawal"].clone();
    }
    if let Some(decision) = wanted["decision"].as_object_mut() {
        decision.remove("reason");
    }
    wanted
}

/// A person's decision at a terminal, with or without a reason.
fn decision(reason: Option<&str>) -> Value {
    let mut decision = json!({
        "by": { "kind": "human", "id": "bo" }, "principal": "human:bo", "at": NOW,
        "traceId": "0a1b2c3d4e5f60718293a4b5c6d7e8f9", "proposerKind": "human",
        "channel": "terminal",
    });
    if let Some(reason) = reason {
        decision["reason"] = json!(reason);
    }
    decision
}

/// `draft(candidate, canary)` in `state`: decided by `human:bo`, or withdrawn by its drafter or
/// its proposer.
fn in_state(candidate: &str, canary: &str, state: &str) -> Value {
    let mut body = draft(candidate, canary);
    let withdrawal = |by: &str, reason: &str| json!({ "by": by, "reason": reason, "at": NOW });
    match state {
        "pending" => {}
        "drafter-withdrawn" => {
            body["state"] = json!("withdrawn");
            body["withdrawal"] = withdrawal("drafter", "source-changed");
        }
        "proposer-withdrawn" => {
            body["state"] = json!("withdrawn");
            body["withdrawal"] = withdrawal("proposer", "retracted");
        }
        "rejected" => {
            body["state"] = json!("rejected");
            body["decision"] = decision(Some(&format!("Wrong: {canary}.")));
        }
        "approved" => {
            body["state"] = json!("approved");
            body["decision"] = decision(None);
            body["result"] = json!({ "error": "the file changed while the proposal was applied" });
        }
        "applied" => {
            body["state"] = json!("applied");
            body["decision"] = decision(None);
            body["result"] = json!({ "rev": 7, "contentHash": format!("sha256:{}", "7a".repeat(32)), "path": "learned/x.md" });
        }
        other => panic!("no state {other}"),
    }
    records::assert_valid("proposal.v2", &body);
    body
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
    let earlier = seeded.content_hash.to_string();
    for needle in [canary, records::SOURCE_HASH, earlier.as_str()] {
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

    // The next run's feed shows it erased: redacted in place, its withdrawal kept as it was.
    let (erased, _) = submit(&fx, json!([]), Some(erase(id))).await;
    let done = item(data(&erased), "withdrawals", 0);
    assert_eq!(done["withdrawn"], false, "{erased}");
    assert_eq!(done["redacted"], true);
    let record = records::read(&fx, id).body;
    records::assert_valid("proposal.v2", &record);
    assert_eq!(record, expected_kept(&withdrawn));
    assert_eq!(files_holding(&fx, canary), Vec::<PathBuf>::new());
}

#[tokio::test]
async fn an_applied_proposal_is_never_retracted() {
    let fx = fixture().await;
    let canary = "potoroocanary";
    let body = in_state("4c2d3e4f5061728394a5", canary, "applied");
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
            "{result}"
        );
    }
    // Nor by the notice naming its source.
    let noticed = notice(&fx, json!([records::SOURCE_ID])).await;
    assert_eq!(data(&noticed)["erased"]["redacted"], json!([]), "{noticed}");
    let after = records::read(&fx, id);
    assert_eq!(after.content_hash, seeded.content_hash, "untouched");
    assert_eq!(after.body, body);
    assert!(
        !files_holding(&fx, canary).is_empty(),
        "D85's disclosed residue"
    );
}

#[tokio::test]
async fn every_draft_that_was_not_applied_is_redacted_when_its_source_is_erased() {
    let fx = fixture().await;
    let (canary, kept) = ("numbatcanary", "quendacanary");
    let states = [
        "pending",
        "drafter-withdrawn",
        "proposer-withdrawn",
        "rejected",
        "approved",
    ];
    let redactable: Vec<Value> = states
        .iter()
        .enumerate()
        .map(|(n, state)| in_state(&format!("a{n}000000000000000000"), canary, state))
        .collect();
    let applied = in_state("b000000000000000000a", kept, "applied");
    // Not this drafter's, not this caller's, or citing another source: untouched.
    let mut scribes = in_state("b100000000000000000a", kept, "rejected");
    scribes["drafter"]["plugin"] = json!("scribe");
    scribes["drafter"]["instance"] = json!("scribe");
    let mut zeds = in_state("b200000000000000000a", kept, "pending");
    zeds["proposer"] =
        json!({ "actor": { "kind": "human", "id": "zed" }, "principal": "human:zed" });
    let mut elsewhere = in_state("b300000000000000000a", kept, "rejected");
    let other = "mem-000000000000000000000abc";
    elsewhere["evidence"][0]["ref"] = json!(format!("{other}@1"));
    elsewhere["provenance"]["derivedFrom"][0]["id"] = json!(other);
    let untouched = [&applied, &scribes, &zeds, &elsewhere];
    let mut seeded = Vec::new();
    for body in redactable.iter().chain(untouched) {
        records::assert_valid("proposal.v2", body);
        seeded.push(records::seed(&fx, body).content_hash.to_string());
    }

    let result = notice(&fx, json!([records::SOURCE_ID])).await;
    let batch = data(&result);
    let swept = &batch["erased"];
    assert_eq!(swept["sources"], 1, "{result}");
    let mut ids: Vec<&str> = swept["redacted"]
        .as_array()
        .unwrap()
        .iter()
        .map(|id| id.as_str().unwrap())
        .collect();
    ids.sort_unstable();
    let mut wanted: Vec<&str> = redactable
        .iter()
        .map(|body| body["id"].as_str().unwrap())
        .collect();
    wanted.sort_unstable();
    assert_eq!(ids, wanted, "{result}");
    assert_eq!(swept["withdrawn"], json!([redactable[0]["id"]]));
    assert_eq!(swept["refused"], json!([]));
    assert_eq!(batch["counts"]["redacted"], 5);
    assert_eq!(batch["checkpoint"], "clean");

    for (state, body) in states.iter().zip(&redactable) {
        let record = records::read(&fx, body["id"].as_str().unwrap()).body;
        records::assert_valid("proposal.v2", &record);
        assert_eq!(record, expected_kept(body), "{state}");
    }
    for body in untouched {
        assert_eq!(records::read(&fx, body["id"].as_str().unwrap()).body, *body);
    }
    // Nothing of the forgotten source's drafts remains in the files; the others' text does.
    assert_eq!(files_holding(&fx, canary), Vec::<PathBuf>::new());
    for hash in &seeded[..redactable.len()] {
        assert_eq!(files_holding(&fx, hash), Vec::<PathBuf>::new(), "{hash}");
    }
    assert!(!files_holding(&fx, kept).is_empty());

    // The approved draft has nothing left to apply.
    let approved = redactable[4]["id"].as_str().unwrap();
    let refused = fx
        .at_terminal("knowledge-approve", json!({ "proposal": approved }))
        .await;
    assert_eq!(code(&refused), "PROPOSAL_SOURCE_GONE", "{refused}");
    // The feed reports the redacted rejection again, with no reason, marked redacted.
    let feed = feed_as(&fx, "curator", 0).await;
    let rejection = data(&feed)["decisions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|decision| decision["proposal"] == redactable[3]["id"])
        .cloned()
        .unwrap();
    assert_eq!(rejection["redacted"], true, "{feed}");
    assert_eq!(rejection["reason"], Value::Null);
    never_mentions(&feed, &[canary]);
    // A second notice does nothing.
    let again = notice(&fx, json!([records::SOURCE_ID])).await;
    assert_eq!(data(&again)["erased"]["redacted"], json!([]), "{again}");
    assert_eq!(data(&again)["checkpoint"], Value::Null);
}

#[tokio::test]
async fn a_named_redaction_reaches_every_draft_that_was_not_applied() {
    let fx = fixture().await;
    let canary = "mulgaracanary";
    let states = [
        "drafter-withdrawn",
        "proposer-withdrawn",
        "rejected",
        "approved",
    ];
    for (n, state) in states.iter().enumerate() {
        let body = in_state(&format!("c{n}000000000000000000"), canary, state);
        records::seed(&fx, &body);
        let id = body["id"].as_str().unwrap();
        if matches!(*state, "rejected" | "approved") {
            // A decided draft is not withdrawn: it is only redacted.
            let (changed, _) = submit(
                &fx,
                json!([]),
                Some(json!([{ "proposal": id, "reason": "source-changed" }])),
            )
            .await;
            assert_eq!(
                item_code(item(data(&changed), "withdrawals", 0)),
                "PROPOSAL_STATE_INVALID",
                "{state}"
            );
        }
        let (result, _) = submit(&fx, json!([]), Some(erase(id))).await;
        let done = item(data(&result), "withdrawals", 0);
        assert_eq!(done["ok"], true, "{state}: {result}");
        assert_eq!(done["withdrawn"], false);
        assert_eq!(done["redacted"], true);
        let record = records::read(&fx, id).body;
        records::assert_valid("proposal.v2", &record);
        assert_eq!(record, expected_kept(&body), "{state}");
    }
    assert_eq!(files_holding(&fx, canary), Vec::<PathBuf>::new());
}

#[tokio::test]
async fn an_erased_notice_needs_an_attestation_and_memory_record_ids() {
    let fx = fixture().await;
    let body = draft("d000000000000000000a", "kultarrcanary");
    records::seed(&fx, &body);
    let unattested = fx
        .as_actor(
            agent("x"),
            "knowledge-propose-batch",
            json!({ "proposals": [], "erased": [records::SOURCE_ID] }),
        )
        .await;
    assert_eq!(
        code(&unattested),
        "PROPOSAL_EVIDENCE_INVALID",
        "{unattested}"
    );
    let malformed = notice(&fx, json!(["mem-zzzzzzzzzzzzzzzzzzzzzzzz"])).await;
    assert_eq!(code(&malformed), "PROPOSAL_INVALID", "{malformed}");
    let many: Vec<String> = (0..401).map(|n| format!("mem-{n:024x}")).collect();
    assert_eq!(
        code(&notice(&fx, json!(many)).await),
        "PROPOSAL_BATCH_TOO_LARGE"
    );
    assert_eq!(records::read(&fx, body["id"].as_str().unwrap()).body, body);
}

#[tokio::test]
async fn no_earlier_body_hash_of_a_redacted_draft_remains() {
    // A draft the batch verified and stored, rejected by a person at a terminal, then redacted
    // once its source is forgotten: none of its record's earlier hashes is left in the change log,
    // the files, the journal or the events.
    use support::memory as mem;
    let mut fx = fixture().await;
    let canary = "ningauicanary";
    mem::write(
        &fx,
        vec![mem::entry(
            1,
            "human:ada",
            &["space"],
            &format!("Staging uses {canary}"),
            &format!("Rollbacks in staging use {canary}."),
        )],
    );
    let source = mem::record(&fx, &mem::id(1));
    let (created, _) = submit(
        &fx,
        json!([mem::drafted(&[source], &mem::Place::default())]),
        None,
    )
    .await;
    let id = item(data(&created), "results", 0)["proposal"]["id"]
        .as_str()
        .unwrap_or_else(|| panic!("{created}"))
        .to_owned();
    let mut earlier = vec![records::read(&fx, &id).content_hash.to_string()];
    fx.reopen(&drafter::config(&["curator"], "bo"));
    let rejected = fx
        .at_terminal(
            "knowledge-reject",
            json!({ "proposal": id, "reason": format!("Not {canary}.") }),
        )
        .await;
    assert_eq!(data(&rejected)["rejected"], true, "{rejected}");
    earlier.push(records::read(&fx, &id).content_hash.to_string());
    for hash in &earlier {
        assert!(!files_holding(&fx, hash).is_empty(), "the scan sees {hash}");
    }

    // The source is forgotten; the drafter redacts its draft.
    mem::forget(&fx, &mem::id(1), "human:ada");
    let (result, _) = submit(&fx, json!([]), Some(erase(&id))).await;
    assert_eq!(
        item(data(&result), "withdrawals", 0)["redacted"],
        true,
        "{result}"
    );
    assert_eq!(data(&result)["checkpoint"], "clean");
    let record = records::read(&fx, &id);
    assert_eq!(record.body["state"], "rejected");
    assert_eq!(record.body["decision"]["principal"], "human:bo");
    assert!(record.body["decision"].get("reason").is_none());
    let target = format!("knowledge/proposal/{id}");
    let hashes: Vec<Option<String>> = {
        use umbel_store::{DocumentStore, ReaderFilter};
        records::store(&fx, "main")
            .changes(0, 1000, &ReaderFilter::derivation(), None)
            .unwrap()
            .into_iter()
            .filter(|change| change.target == target)
            .map(|change| change.content_hash)
            .collect()
    };
    assert_eq!(
        hashes,
        [None, None, Some(record.content_hash.to_string())],
        "only the redacted version keeps its hash"
    );
    for needle in earlier.iter().map(String::as_str).chain([canary]) {
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
    // A draft its proposer took back with knowledge-withdraw: still the drafter's to redact
    // (amendment 12), keeping the proposer's withdrawal.
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
    let codes: Vec<&str> = [0, 1, 3, 4, 5]
        .into_iter()
        .map(|index| item_code(item(batch, "withdrawals", index)))
        .collect();
    assert_eq!(
        codes,
        [
            "PROPOSAL_NOT_PROPOSER",
            "PROPOSAL_NOT_PROPOSER",
            "PROPOSAL_INVALID",
            "PROPOSAL_INVALID",
            "PROPOSAL_NOT_FOUND",
        ],
        "{result}"
    );
    assert_eq!(item(batch, "withdrawals", 0)["proposal"], zeds["id"]);
    assert_eq!(item(batch, "withdrawals", 2)["redacted"], true, "{result}");
    let taken_back = records::read(&fx, retracted["id"].as_str().unwrap()).body;
    records::assert_valid("proposal.v2", &taken_back);
    assert_eq!(taken_back["withdrawal"]["by"], "proposer");
    assert_eq!(taken_back["withdrawal"]["reason"], "retracted");
    assert_eq!(batch["checkpoint"], "clean");
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
async fn a_draft_citing_no_memory_record_is_not_redacted_as_if_a_source_were_erased() {
    // Step 3c checks the drafter's word that a source was erased: a draft that cites no memory
    // record has no source to have lost, so naming it erased is a mismatch and it is left as it
    // was.
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
    let (created, _) = submit(&fx, json!([proposal]), None).await;
    let id = item(data(&created), "results", 0)["proposal"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let before = records::read(&fx, &id).body;
    let (result, _) = submit(&fx, json!([]), Some(erase(&id))).await;
    let refused = item(data(&result), "withdrawals", 0);
    assert_eq!(item_code(refused), "PROPOSAL_DRAFT_MISMATCH", "{result}");
    assert_eq!(
        refused["error"]["details"],
        json!({ "check": "source-erased" })
    );
    assert_eq!(records::read(&fx, &id).body, before);

    // A draft a library wrote citing a record the store does not hold, beside other evidence
    // with an excerpt and a verify's note, loses every excerpt and the note (step 3b,
    // amendment 6).
    let seeded_canary = "kowariseed";
    let mut body = draft("7d4e5f60718293041526", seeded_canary);
    body["change"] = json!({
        "op": "verify", "doc": "handbook/runbook", "baseHash": base,
        "verification": { "note": format!("Checked {seeded_canary}.") },
    });
    body["evidence"]
        .as_array_mut()
        .unwrap()
        .push(json!({ "kind": "text", "ref": "check:links-resolve", "excerpt": format!("pass {seeded_canary}") }));
    records::seed(&fx, &body);
    let seeded = body["id"].as_str().unwrap();
    let (result, _) = submit(&fx, json!([]), Some(erase(seeded))).await;
    assert_eq!(data(&result)["checkpoint"], "clean", "{result}");
    let record = records::read(&fx, seeded).body;
    records::assert_valid("proposal.v2", &record);
    assert_eq!(record["state"], "withdrawn");
    assert_eq!(record["diff"], "");
    assert_eq!(record["rationale"], records::REDACTED_RATIONALE);
    assert_eq!(record["change"]["verification"], json!({}));
    assert_eq!(
        record["evidence"],
        json!([
            { "kind": "memory", "ref": format!("{}@2", records::SOURCE_ID), "erased": true },
            { "kind": "text", "ref": "check:links-resolve" },
        ])
    );
    assert_eq!(
        record["redacted"],
        json!({ "at": NOW, "reason": "source-erased" })
    );
    assert_eq!(files_holding(&fx, seeded_canary), Vec::<PathBuf>::new());
    assert!(
        !records::journal(&fx).contains(seeded_canary),
        "the batch is digest-journaled"
    );
    assert!(!records::events(&fx).contains(seeded_canary));
}
