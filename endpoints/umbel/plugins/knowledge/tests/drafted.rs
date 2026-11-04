//! The drafted path of `knowledge-propose-batch` and `knowledge-proposal-feed` (phase 4
//! specification, sections 3.2, 7.1 and 11.2; D91): an attestation needed for a drafter, memory
//! evidence, a memory `derivedFrom`, a conflict set and withdrawals; `drafters`; what a listed
//! drafter's claims are refused with once step 3c verifies them (`verify_drafts.rs` holds each
//! check of section 3.2); `PROPOSAL_ALREADY_OPEN`; the batch caps; a retry that must repeat the
//! drafter's claims; the feed; drafted documents `agent-inferred`; approve's authorship from the
//! memory store (section 8.2); and no memory hash in a result's provenance.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::drafter::{
    self, deprecate, feed_as, item, item_code, memory_entry, submit, submit_as, verify,
};
use support::records::{self, Draft};
use support::*;

const RUNBOOK: &str =
    "---\ntitle: Rolling back\ntype: runbook\n---\n# Rolling back\n\nUse the previous tag.\n";
const GUIDE: &str = "---\ntitle: Deploying\ntype: guide\n---\n# Deploying\n\nShip it.\n";

async fn fixture(drafters: &[&str], local_id: &str) -> Fx {
    let fx = Fx::with_drafters(&drafter::config(drafters, local_id));
    fx.handbook("runbook.md", RUNBOOK);
    fx.handbook("guide.md", GUIDE);
    fx.refresh("main").await;
    fx
}

async fn hash_of(fx: &Fx, doc: &str) -> String {
    let listed = fx
        .as_actor(member(), "knowledge-list", json!({ "prefix": doc }))
        .await;
    data(&listed)["documents"][0]["contentHash"]
        .as_str()
        .unwrap()
        .to_owned()
}

/// Every stored proposal record's body in `main`.
fn stored(fx: &Fx) -> Vec<Value> {
    use umbel_store::{DocumentStore, ReaderFilter};
    records::store(fx, "main")
        .list_records(
            records::NS,
            records::KIND,
            None,
            500,
            &ReaderFilter::derivation(),
        )
        .unwrap()
        .items
        .into_iter()
        .map(|record| record.body)
        .collect()
}

// ── Without an attestation ──────────────────────────────────────────────────────────────────

#[tokio::test]
async fn an_unattested_batch_is_an_ordinary_batch_by_its_caller() {
    let fx = fixture(&["curator"], "local").await;
    let base = hash_of(&fx, "handbook/runbook").await;
    let result = fx
        .as_actor(
            agent("x"),
            "knowledge-propose-batch",
            json!({ "proposals": [
                verify("k1", "handbook/runbook", &base),
                verify("k2", "handbook/runbook", &format!("sha256:{}", "0".repeat(64))),
            ] }),
        )
        .await;
    let batch = data(&result);
    assert_eq!(batch["drafter"], Value::Null, "{result}");
    assert_eq!(item(batch, "results", 0)["ok"], true, "{result}");
    assert_eq!(item(batch, "results", 0)["created"], true);
    // Each item is knowledge-propose's: a stale base is that item's conflict, not the batch's.
    assert_eq!(item_code(item(batch, "results", 1)), "PROPOSAL_CONFLICT");
    assert_eq!(batch["counts"]["created"], 1);
    assert_eq!(batch["counts"]["refused"], 1);
    assert_eq!(batch["checkpoint"], Value::Null);

    let id = item(batch, "results", 0)["proposal"]["id"]
        .as_str()
        .unwrap();
    let body = records::read(&fx, id).body;
    records::assert_valid("proposal.v2", &body);
    assert_eq!(body["drafter"], Value::Null);
    assert_eq!(body["proposer"]["principal"], "agent:x");
    // An ordinary batch is not held to PROPOSAL_ALREADY_OPEN: a second open proposal for the
    // same document is stored, as phase 2 allows.
    let again = fx
        .as_actor(
            agent("x"),
            "knowledge-propose-batch",
            json!({ "proposals": [deprecate("k3", "handbook/runbook", &base)] }),
        )
        .await;
    assert_eq!(item(data(&again), "results", 0)["created"], true, "{again}");
}

#[tokio::test]
async fn without_an_attestation_drafter_claims_and_withdrawals_are_refused() {
    let fx = fixture(&["curator"], "local").await;
    let base = hash_of(&fx, "handbook/runbook").await;
    let with = |key: &str, extra: (&str, Value)| {
        let mut proposal = verify(key, "handbook/runbook", &base);
        proposal[extra.0] = extra.1;
        proposal
    };
    let mut memory = verify("m1", "handbook/runbook", &base);
    memory["evidence"] = json!([memory_entry(1)]);
    let proposals = json!([
        memory,
        with(
            "m2",
            (
                "derivedFrom",
                json!([{ "kind": "memory", "id": format!("mem-{:024x}", 1), "contentHash": format!("sha256:{}", "5e".repeat(32)) }]),
            )
        ),
        with("m3", ("conflictSet", json!("k-0123456789abcdef0123"))),
        with("m4", ("drafter", json!({ "mode": "scheduled" }))),
    ]);
    for (actor, interface) in [
        (agent("x"), afd::CommandInterface::Mcp),
        (human("local"), afd::CommandInterface::Cli),
    ] {
        let result = json_of(
            fx.call(
                actor,
                interface,
                "knowledge-propose-batch",
                json!({
                    "proposals": proposals,
                    "withdraw": [{ "proposal": "p-0123456789abcdef0123", "reason": "source-changed" }],
                }),
            )
            .await,
        );
        let batch = data(&result);
        for index in 0..4 {
            assert_eq!(
                item_code(item(batch, "results", index)),
                "PROPOSAL_EVIDENCE_INVALID",
                "{index}: {result}"
            );
        }
        assert_eq!(
            item_code(item(batch, "withdrawals", 0)),
            "PROPOSAL_EVIDENCE_INVALID"
        );
    }
    assert!(stored(&fx).is_empty(), "nothing was stored");
}

// ── drafters ────────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn an_attestation_from_an_unlisted_instance_refuses_the_whole_call() {
    let fx = fixture(&["curator"], "local").await;
    let base = hash_of(&fx, "handbook/runbook").await;
    let proposals = json!([verify("v1", "handbook/runbook", &base)]);
    let (scribe, _) = submit_as(&fx, "scribe", proposals.clone(), None).await;
    assert_eq!(code(&scribe), "PROPOSAL_DRAFTER_NOT_ALLOWED", "{scribe}");
    assert!(
        scribe["error"]["message"]
            .as_str()
            .unwrap()
            .contains("`scribe`")
    );
    assert_eq!(
        code(&feed_as(&fx, "scribe", 0).await),
        "PROPOSAL_DRAFTER_NOT_ALLOWED"
    );
    assert!(stored(&fx).is_empty());

    // The default lists nobody: even the curator is refused.
    let fx = fixture(&[], "local").await;
    let (curator, _) = submit(&fx, proposals, None).await;
    assert_eq!(code(&curator), "PROPOSAL_DRAFTER_NOT_ALLOWED", "{curator}");
    assert!(stored(&fx).is_empty());
}

#[tokio::test]
async fn a_listed_drafters_proposal_carries_the_hosts_attestation() {
    let fx = fixture(&["curator"], "local").await;
    let base = hash_of(&fx, "handbook/runbook").await;
    let (result, run) = submit(&fx, json!([verify("v1", "handbook/runbook", &base)]), None).await;
    let batch = data(&result);
    assert_eq!(
        batch["drafter"],
        json!({ "plugin": "curator", "instance": "curator", "pipeline": "curator-submit", "run": run }),
        "{result}"
    );
    let created = item(batch, "results", 0);
    assert_eq!(created["created"], true, "{result}");
    let id = created["proposal"]["id"].as_str().unwrap();
    let body = records::read(&fx, id).body;
    records::assert_valid("proposal.v2", &body);
    assert_eq!(
        body["drafter"],
        json!({ "plugin": "curator", "instance": "curator", "pipeline": "curator-submit", "run": run, "mode": "scheduled" })
    );
    assert_eq!(body["provenance"]["origin"], "agent-inferred");
    assert_eq!(body["proposer"]["principal"], "human:local");
    assert_eq!(body["provenance"]["derivedFrom"], Value::Null);
    // No result carries derivedFrom in its provenance.
    assert!(!result.to_string().contains("derivedFrom"), "{result}");

    // The preview labels nothing as verified against memory: the draft cites no memory record.
    let preview = json_of(
        fx.call(
            human("local"),
            afd::CommandInterface::Cli,
            "knowledge-proposal-preview",
            json!({ "proposal": id }),
        )
        .await,
    );
    let text = data(&preview)["preview"].as_str().unwrap();
    assert!(!text.contains("verified against memory"), "{text}");
    assert!(
        text.lines().any(|line| line
            == "Drafter, checked at submission: it cites no memory record, so it widens no one's readers"),
        "{text}"
    );
    assert!(
        text.lines().any(|line| line == "  mode scheduled"),
        "{text}"
    );
}

// ── What stays refused ──────────────────────────────────────────────────────────────────────

/// What a listed drafter cannot have verified is still refused (step 3b, amendment 1, as step 3c
/// leaves it): content that renders no memory record, and memory evidence on anything but a
/// create; a claim that cites no memory record is false on its face, so a mismatch. Nothing is
/// stored, and nothing stored reads "verified against memory at submission".
#[tokio::test]
async fn what_a_listed_drafter_cannot_have_verified_is_still_refused() {
    let fx = fixture(&["curator"], "local").await;
    let base = hash_of(&fx, "handbook/runbook").await;
    let doc = || verify("x", "handbook/runbook", &base);
    let with = |key: &str, field: &str, value: Value| {
        let mut proposal = doc();
        proposal["idempotency_key"] = json!(key);
        proposal[field] = value;
        proposal
    };
    let mut memory = with("m1", "rationale", json!("From memory."));
    memory["evidence"] = json!([memory_entry(1)]);
    let mut mixed = with("m2", "rationale", json!("From memory and a file."));
    mixed["evidence"] = json!([
        { "kind": "document", "ref": "handbook/runbook", "contentHash": base },
        memory_entry(2),
    ]);
    let derived = with(
        "m3",
        "derivedFrom",
        json!([{ "kind": "memory", "id": format!("mem-{:024x}", 3), "contentHash": format!("sha256:{}", "5e".repeat(32)) }]),
    );
    let candidate = with(
        "m4",
        "drafter",
        json!({ "mode": "scheduled", "candidate": "c-0123456789abcdef0123" }),
    );
    let promoted = with(
        "m5",
        "drafter",
        json!({ "mode": "promoted", "promotedBy": "human:local" }),
    );
    let promoted_by = with("m6", "drafter", json!({ "promotedBy": "human:local" }));
    let conflict = with("m7", "conflictSet", json!("k-0123456789abcdef0123"));
    let create = json!({
        "idempotency_key": "m8",
        "change": { "op": "create", "doc": "handbook/learned/c-0123456789abcdef0123", "content": "---\ntitle: \"A fact\"\n---\nA fact.\n" },
        "rationale": "A settled fact.",
        "evidence": [{ "kind": "text", "ref": "the drafter's word" }],
    });
    let update = json!({
        "idempotency_key": "m9",
        "change": { "op": "update", "doc": "handbook/runbook", "baseHash": base, "content": "---\ntitle: Rolling back\n---\nNew.\n" },
        "rationale": "An edit.",
        "evidence": [{ "kind": "document", "ref": "handbook/runbook", "contentHash": base }],
    });
    let (result, _) = submit(
        &fx,
        json!([
            memory,
            mixed,
            derived,
            candidate,
            promoted,
            promoted_by,
            conflict,
            create,
            update
        ]),
        None,
    )
    .await;
    let batch = data(&result);
    let expected = [
        (
            "PROPOSAL_DRAFT_UNVERIFIABLE",
            json!({ "claim": "memory-evidence" }),
        ),
        (
            "PROPOSAL_DRAFT_UNVERIFIABLE",
            json!({ "claim": "memory-evidence" }),
        ),
        (
            "PROPOSAL_DRAFT_MISMATCH",
            json!({ "check": "derived-from" }),
        ),
        ("PROPOSAL_DRAFT_MISMATCH", json!({ "check": "candidate" })),
        ("PROPOSAL_DRAFT_MISMATCH", json!({ "check": "mode" })),
        ("PROPOSAL_DRAFT_MISMATCH", json!({ "check": "promoted-by" })),
        (
            "PROPOSAL_DRAFT_MISMATCH",
            json!({ "check": "conflict-set" }),
        ),
        ("PROPOSAL_DRAFT_UNVERIFIABLE", json!({ "claim": "content" })),
        ("PROPOSAL_DRAFT_UNVERIFIABLE", json!({ "claim": "content" })),
    ];
    for (index, (code, details)) in expected.iter().enumerate() {
        let refused = item(batch, "results", index);
        assert_eq!(item_code(refused), *code, "{index}: {result}");
        assert_eq!(refused["error"]["details"], *details, "{index}");
    }
    assert_eq!(batch["counts"]["refused"], 9);
    assert!(stored(&fx).is_empty(), "nothing was stored");

    // The same drafter's memory-free draft is accepted beside them, and nothing stored cites
    // memory or reads "verified against memory".
    let (ok, _) = submit(&fx, json!([verify("v1", "handbook/runbook", &base)]), None).await;
    assert_eq!(item(data(&ok), "results", 0)["created"], true, "{ok}");
    for body in stored(&fx) {
        assert!(!body.to_string().contains("\"memory\""), "{body}");
        assert_eq!(body["provenance"]["derivedFrom"], Value::Null);
        let id = body["id"].as_str().unwrap();
        let preview = fx
            .cli("knowledge-proposal-preview", json!({ "proposal": id }))
            .await;
        let text = data(&preview)["preview"].as_str().unwrap();
        assert!(!text.contains("verified against memory"), "{text}");
        assert!(
            text.contains("checked at submission: it cites no memory record"),
            "{text}"
        );
    }
}

// ── PROPOSAL_ALREADY_OPEN ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn a_draft_for_a_document_with_an_open_proposal_is_already_open() {
    let fx = fixture(&["curator"], "local").await;
    let base = hash_of(&fx, "handbook/runbook").await;
    let guide = hash_of(&fx, "handbook/guide").await;
    // Someone's own open proposal blocks a draft for its document.
    let own = fx
        .as_actor(
            agent("x"),
            "knowledge-propose",
            deprecate("own", "handbook/guide", &guide),
        )
        .await;
    assert_eq!(data(&own)["created"], true, "{own}");

    let (result, _) = submit(
        &fx,
        json!([
            verify("v1", "handbook/runbook", &base),
            deprecate("d1", "handbook/runbook", &base),
            verify("v2", "handbook/guide", &guide),
        ]),
        None,
    )
    .await;
    let batch = data(&result);
    assert_eq!(item(batch, "results", 0)["created"], true, "{result}");
    // The first draft of the batch is open for the second.
    assert_eq!(
        item_code(item(batch, "results", 1)),
        "PROPOSAL_ALREADY_OPEN"
    );
    assert_eq!(
        item_code(item(batch, "results", 2)),
        "PROPOSAL_ALREADY_OPEN"
    );
    let first = item(batch, "results", 0)["proposal"]["id"]
        .as_str()
        .unwrap()
        .to_owned();

    // A later run renders the same draft: the existing proposal comes back, not a refusal.
    let (rerun, rerun_trace) =
        submit(&fx, json!([verify("v1", "handbook/runbook", &base)]), None).await;
    let again = item(data(&rerun), "results", 0);
    assert_eq!(again["created"], false, "{rerun}");
    assert_eq!(again["proposal"]["id"], first.as_str());
    assert_ne!(data(&rerun)["drafter"]["run"], json!(null));
    assert_eq!(data(&rerun)["drafter"]["run"], json!(rerun_trace));

    // Withdrawals run first: withdrawing the open draft lets its replacement in, in one batch.
    let (replaced, _) = submit(
        &fx,
        json!([deprecate("d2", "handbook/runbook", &base)]),
        Some(json!([{ "proposal": first, "reason": "source-changed" }])),
    )
    .await;
    let batch = data(&replaced);
    assert_eq!(
        item(batch, "withdrawals", 0)["withdrawn"],
        true,
        "{replaced}"
    );
    assert_eq!(item(batch, "results", 0)["created"], true, "{replaced}");
}

// ── Batch caps ──────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn a_batch_is_capped_at_fifty_proposals_fifty_withdrawals_and_four_hundred_sources() {
    let fx = fixture(&["curator"], "local").await;
    let invalid = |n: usize| {
        json!({
            "idempotency_key": format!("k{n}"),
            "change": { "op": "verify", "doc": "handbook/runbook", "baseHash": format!("sha256:{}", "0".repeat(64)) },
            "rationale": "x",
            "evidence": [{ "kind": "text", "ref": "t" }],
        })
    };
    let call = |input: Value| {
        let fx = &fx;
        async move {
            fx.as_actor(agent("x"), "knowledge-propose-batch", input)
                .await
        }
    };
    let fifty: Vec<Value> = (0..50).map(invalid).collect();
    let at_cap = call(json!({ "proposals": fifty })).await;
    assert_eq!(data(&at_cap)["results"].as_array().unwrap().len(), 50);
    let fifty_one: Vec<Value> = (0..51).map(invalid).collect();
    assert_eq!(
        code(&call(json!({ "proposals": fifty_one })).await),
        "PROPOSAL_BATCH_TOO_LARGE"
    );
    let withdrawals: Vec<Value> = (0..51)
        .map(|n| json!({ "proposal": format!("p-{n:020x}"), "reason": "source-changed" }))
        .collect();
    assert_eq!(
        code(&call(json!({ "proposals": [], "withdraw": withdrawals })).await),
        "PROPOSAL_BATCH_TOO_LARGE"
    );

    // Distinct memory sources across the batch: 400 is the cap, 416 is over it. The cap is the
    // whole call's, so it holds before any item is looked at.
    let citing = |from: usize, count: usize, key: usize| {
        let mut proposal = invalid(key);
        proposal["evidence"] = Value::Array((from..from + count).map(memory_entry).collect());
        proposal
    };
    let four_hundred: Vec<Value> = (0..12)
        .map(|n| citing(n * 32, 32, n))
        .chain(std::iter::once(citing(384, 16, 12)))
        .collect();
    let under = call(json!({ "proposals": four_hundred })).await;
    assert_eq!(
        item_code(item(data(&under), "results", 0)),
        "PROPOSAL_EVIDENCE_INVALID",
        "{under}"
    );
    let over: Vec<Value> = (0..13).map(|n| citing(n * 32, 32, n)).collect();
    let refused = call(json!({ "proposals": over })).await;
    assert_eq!(code(&refused), "PROPOSAL_BATCH_TOO_LARGE");
    // The same source cited twice counts once.
    let repeated: Vec<Value> = (0..13).map(|n| citing(0, 32, n)).collect();
    assert_eq!(
        data(&call(json!({ "proposals": repeated })).await)["results"]
            .as_array()
            .unwrap()
            .len(),
        13
    );
    assert!(stored(&fx).is_empty());
}

// ── Retries ─────────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn a_retry_must_repeat_the_drafters_claims_as_well_as_the_change() {
    let fx = fixture(&["curator"], "local").await;
    let base = hash_of(&fx, "handbook/runbook").await;
    let guide = hash_of(&fx, "handbook/guide").await;
    // The person's own proposal under a key, then a draft of the same change under it.
    let own = fx
        .cli(
            "knowledge-propose",
            verify("same", "handbook/runbook", &base),
        )
        .await;
    assert_eq!(data(&own)["created"], true, "{own}");
    let (drafted, _) = submit(
        &fx,
        json!([verify("same", "handbook/runbook", &base)]),
        None,
    )
    .await;
    assert_eq!(
        item_code(item(data(&drafted), "results", 0)),
        "PROPOSAL_KEY_REUSED",
        "{drafted}"
    );
    // A draft first, then the person's own proposal of the same change under its key.
    let (first, _) = submit(
        &fx,
        json!([verify("draft", "handbook/guide", &guide)]),
        None,
    )
    .await;
    assert_eq!(item(data(&first), "results", 0)["created"], true, "{first}");
    let plain = fx
        .cli(
            "knowledge-propose",
            verify("draft", "handbook/guide", &guide),
        )
        .await;
    assert_eq!(code(&plain), "PROPOSAL_KEY_REUSED", "{plain}");
}

// ── The feed ────────────────────────────────────────────────────────────────────────────────

/// `body` decided by `human:bo`: rejected with `reason`, or applied.
fn decide(mut body: Value, reason: Option<&str>) -> Value {
    body["state"] = json!(if reason.is_some() {
        "rejected"
    } else {
        "applied"
    });
    let mut decision = json!({
        "by": { "kind": "human", "id": "bo" }, "principal": "human:bo",
        "at": "2026-01-01T00:00:00.000Z", "traceId": "0a1b2c3d4e5f60718293a4b5c6d7e8f9",
        "proposerKind": "human", "channel": "terminal",
    });
    if let Some(reason) = reason {
        decision["reason"] = json!(reason);
    } else {
        body["result"] = json!({ "rev": 7, "contentHash": format!("sha256:{}", "7a".repeat(32)), "path": "learned/x.md" });
    }
    body["decision"] = decision;
    body
}

fn draft_of(candidate: &str) -> Value {
    records::drafted(&Draft {
        candidate,
        canary: "feedcanary",
        promoted_by: None,
        conflict_set: None,
    })
}

#[tokio::test]
async fn the_feed_reports_decisions_on_the_drafters_own_proposals_after_a_revision() {
    let fx = fixture(&["curator"], "local").await;
    // A direct call has no attestation.
    let direct = fx
        .cli("knowledge-proposal-feed", json!({ "after": 0 }))
        .await;
    assert_eq!(code(&direct), "PROPOSAL_DRAFTER_NOT_ALLOWED", "{direct}");

    let rejected = decide(draft_of("0000000000000000000a"), Some("Not true any more."));
    let applied = decide(draft_of("0000000000000000000b"), None);
    let pending = draft_of("0000000000000000000c");
    let mut others = decide(draft_of("0000000000000000000d"), Some("Someone else's."));
    others["proposer"] =
        json!({ "actor": { "kind": "human", "id": "zed" }, "principal": "human:zed" });
    let mut scribes = decide(draft_of("0000000000000000000e"), Some("The scribe's."));
    scribes["drafter"]["instance"] = json!("scribe");
    scribes["drafter"]["plugin"] = json!("scribe");
    for body in [&rejected, &applied, &pending, &others, &scribes] {
        records::assert_valid("proposal.v2", body);
        records::seed(&fx, body);
    }
    let feed = feed_as(&fx, "curator", 0).await;
    let answer = data(&feed);
    // The pipeline's own result is `last`'s data; the feed marks it as content in it.
    assert_eq!(answer["trust"], "content", "{feed}");
    let decisions = answer["decisions"].as_array().unwrap();
    let ids: Vec<&str> = decisions
        .iter()
        .map(|d| d["proposal"].as_str().unwrap())
        .collect();
    assert_eq!(
        ids.len(),
        2,
        "only the curator's decided proposals of human:local: {feed}"
    );
    let by_id = |body: &Value| {
        decisions
            .iter()
            .find(|d| d["proposal"] == body["id"])
            .unwrap_or_else(|| panic!("{} missing: {feed}", body["id"]))
            .clone()
    };
    let reject = by_id(&rejected);
    assert_eq!(reject["state"], "rejected");
    assert_eq!(reject["reason"], "Not true any more.");
    assert_eq!(reject["candidate"], "c-0000000000000000000a");
    assert_eq!(reject["decidedBy"], "human:bo");
    assert_eq!(reject["channel"], "terminal");
    let apply = by_id(&applied);
    assert_eq!(apply["state"], "applied");
    assert_eq!(apply["contentHash"], applied["result"]["contentHash"]);
    assert_eq!(apply["doc"], applied["change"]["doc"]);
    // Nothing of the drafts' text or their memory hashes.
    never_mentions(&feed, &["feedcanary", records::SOURCE_HASH]);

    // After `next`, nothing new.
    let next = answer["next"].as_u64().unwrap();
    assert!(next >= reject["rev"].as_u64().unwrap());
    assert_eq!(answer["more"], false);
    let later = feed_as(&fx, "curator", next).await;
    assert_eq!(data(&later)["count"], 0, "{later}");
    assert_eq!(data(&later)["next"], next);
}

// ── Approval of a draft ─────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn a_drafted_document_is_agent_inferred_and_its_runner_is_not_its_author() {
    // The runner, human:local, approving at the terminal a drafted deprecate: its authors are its
    // sources' principals and `promotedBy`, and it has neither (section 8.2), so no exception.
    let fx = fixture(&["curator"], "local").await;
    let base = hash_of(&fx, "handbook/runbook").await;
    let (result, _) = submit(
        &fx,
        json!([deprecate("d1", "handbook/runbook", &base)]),
        None,
    )
    .await;
    let id = item(data(&result), "results", 0)["proposal"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let approved = fx
        .at_terminal("knowledge-approve", json!({ "proposal": id }))
        .await;
    assert_eq!(data(&approved)["applied"], true, "{approved}");
    let body = records::read(&fx, &id).body;
    records::assert_valid("proposal.v2", &body);
    assert_eq!(body["exception"], Value::Null);
    assert_eq!(body["decision"]["channel"], "terminal");
    assert_eq!(body["decision"]["principal"], "human:local");
    use umbel_store::{DocumentStore, ReaderFilter};
    let document = records::store(&fx, "main")
        .get_document("handbook/runbook", &ReaderFilter::derivation())
        .unwrap()
        .unwrap();
    assert_eq!(
        serde_json::to_value(document.write.envelope.origin).unwrap(),
        "agent-inferred"
    );
    assert!(
        !approved
            .to_string()
            .contains("derivedFrom\":[{\"kind\":\"memory")
    );
}

/// `drafter::config` with the handbook area allowing self-approval.
fn self_approving(local_id: &str) -> String {
    drafter::config(&["curator"], local_id).replace(
        "space = \"main\"\ncollection = \"handbook\"\n",
        "space = \"main\"\ncollection = \"handbook\"\nallow_self_approval = true\n",
    )
}

#[tokio::test]
async fn approving_a_draft_of_ones_own_memory_is_self_approval_read_from_the_store() {
    use support::memory::{self as mem, Place, drafted, promoted};
    let mut fx = fixture(&["curator"], "local").await;
    mem::write(
        &fx,
        vec![
            mem::entry(
                1,
                "human:ada",
                &["space"],
                "Staging uses blue-green",
                "Ada's fact.",
            ),
            mem::entry(
                2,
                "human:local",
                &["principal:human:local"],
                "Rollbacks",
                "Local's own.",
            ),
        ],
    );
    let shared = mem::record(&fx, &mem::id(1));
    let own = mem::record(&fx, &mem::id(2));
    let (result, _) = submit(
        &fx,
        json!([drafted(&[shared], &Place::default()), promoted(&[own])]),
        None,
    )
    .await;
    let ids: Vec<String> = (0..2)
        .map(|i| {
            let one = item(data(&result), "results", i);
            assert_eq!(one["ok"], true, "{result}");
            one["proposal"]["id"].as_str().unwrap().to_owned()
        })
        .collect();

    // The promoted draft: the approver is its source's principal and its promotedBy.
    let refused = fx
        .at_terminal("knowledge-approve", json!({ "proposal": ids[1] }))
        .await;
    assert_eq!(code(&refused), "PROPOSAL_SELF_APPROVAL", "{refused}");

    // Ada, whose memory the scheduled draft is, approving it: self-approval, not the runner's.
    fx.reopen(&drafter::config(&["curator"], "ada"));
    let refused = fx
        .at_terminal("knowledge-approve", json!({ "proposal": ids[0] }))
        .await;
    assert_eq!(code(&refused), "PROPOSAL_SELF_APPROVAL", "{refused}");
    fx.reopen(&self_approving("ada"));
    let approved = fx
        .at_terminal("knowledge-approve", json!({ "proposal": ids[0] }))
        .await;
    assert_eq!(data(&approved)["applied"], true, "{approved}");
    assert_eq!(
        records::read(&fx, &ids[0]).body["exception"],
        "self-approval"
    );

    // The owner promoting and approving their own record, where the area allows it.
    fx.reopen(&self_approving("local"));
    let approved = fx
        .at_terminal("knowledge-approve", json!({ "proposal": ids[1] }))
        .await;
    assert_eq!(data(&approved)["applied"], true, "{approved}");
    let body = records::read(&fx, &ids[1]).body;
    assert_eq!(body["exception"], "self-approval");
    assert_eq!(body["drafter"]["promotedBy"], "human:local");
}
