//! Verifying a listed drafter's claims (phase 4 specification, section 3.2; owner decision 10,
//! D91): every row of 3.2's table, one mismatch each, refused with `PROPOSAL_DRAFT_MISMATCH`,
//! its `details.check`, and nothing stored; the checks step 3c adds (amendments from step 3c); a
//! faithful draft accepted; widening by a caller who owns every source accepted and by any other
//! refused; a replayed batch with a tampered `authority` refused; the memory-source half of
//! `PROPOSAL_ALREADY_OPEN`; a withheld `memory` grant; and approve's repeat of the checks after a
//! source or the target changes (section 8.2).
//!
//! Memory records are `human:ada`'s, written through the store; the batch's caller is the person
//! at the command line, `human:local`, through the stand-in `curator` drafter.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::drafter::{self, item, item_code, notice, submit};
use support::memory::{
    self as mem, CALLER, NOW, Place, SETTLED, T0, drafted, promoted, rerendered,
};
use support::records;
use support::*;
use umbel_okf::draft::Rationale;
use umbel_store::memory::DAY_MS;
use umbel_store::{Authority, MemoryClass, MemoryFlag, MemoryRecord};

const SUBJECT: &str = "Staging uses blue-green";
const TEXT: &str = "Deploys to staging switch colours.";
const ADA: &str = "human:ada";

fn config() -> String {
    drafter::config(&["curator"], "local")
}

fn fixture() -> Fx {
    Fx::with_drafters(&config())
}

/// Write `human:ada`'s shared fact `n` and read it back.
fn shared(fx: &Fx, n: u64) -> MemoryRecord {
    mem::write(fx, vec![mem::entry(n, ADA, &["space"], SUBJECT, TEXT)]);
    mem::record(fx, &mem::id(n))
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

/// Submit `proposal` alone and return its result.
async fn one(fx: &Fx, proposal: Value) -> Value {
    let (result, _) = submit(fx, json!([proposal]), None).await;
    item(data(&result), "results", 0).clone()
}

/// `proposal` is refused with `PROPOSAL_DRAFT_MISMATCH` naming `check`, and nothing is stored.
async fn refused(fx: &Fx, proposal: Value, check: &str) {
    let before = stored(fx).len();
    let result = one(fx, proposal).await;
    assert_eq!(
        item_code(&result),
        "PROPOSAL_DRAFT_MISMATCH",
        "{check}: {result}"
    );
    assert_eq!(
        result["error"]["details"],
        json!({ "check": check }),
        "{result}"
    );
    assert_eq!(stored(fx).len(), before, "{check}: nothing is stored");
}

/// `proposal` with `evidence[0][field]` set to `value`.
fn with_entry(proposal: &Value, field: &str, value: Value) -> Value {
    let mut proposal = proposal.clone();
    proposal["evidence"][0][field] = value;
    proposal
}

// ── A faithful draft ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn a_faithful_draft_is_verified_and_stored_naming_its_sources() {
    let fx = fixture();
    let record = shared(&fx, 1);
    let proposal = drafted(std::slice::from_ref(&record), &Place::default());
    let result = one(&fx, proposal.clone()).await;
    assert_eq!(result["ok"], true, "{result}");
    assert_eq!(result["created"], true);
    let id = result["proposal"]["id"].as_str().unwrap();
    let body = records::read(&fx, id).body;
    records::assert_valid("proposal.v2", &body);
    assert_eq!(body["drafter"]["mode"], "scheduled");
    assert_eq!(
        body["drafter"]["candidate"],
        mem::candidate(std::slice::from_ref(&record))
    );
    assert_eq!(body["evidence"], proposal["evidence"]);
    assert_eq!(body["provenance"]["origin"], "agent-inferred");
    let derived =
        json!([{ "kind": "memory", "id": record.id, "contentHash": record.content_hash }]);
    assert_eq!(body["provenance"]["derivedFrom"], derived);
    let envelope = records::read(&fx, id).envelope;
    assert_eq!(
        serde_json::to_value(&envelope.derived_from).unwrap(),
        derived
    );
    // The preview labels what was verified apart from the drafter's policy (section 8.1).
    let preview = fx
        .cli("knowledge-proposal-preview", json!({ "proposal": id }))
        .await;
    let text = data(&preview)["preview"].as_str().unwrap();
    assert!(
        text.contains(
            "Drafter, verified against memory at submission:\n  mode scheduled, candidate c-"
        ),
        "{text}"
    );
    assert!(
        text.contains(&format!(
            "memory \"{}@1\", verified against memory at submission:",
            record.id
        )),
        "{text}"
    );
    assert!(
        text.contains("       authority person; origin user-stated\n"),
        "{text}"
    );
    assert!(
        text.contains("     drafter's policy: observed in 1 session by 1 principal\n"),
        "{text}"
    );
    assert!(
        text.contains("Drafter's policy, not verified: settled at \"2025-12-12T00:00:00.000Z\""),
        "{text}"
    );
    assert!(!text.contains("widens readers"), "{text}");
    // A rerun renders the same draft and gets it back.
    let again = one(&fx, proposal).await;
    assert_eq!(again["created"], false, "{again}");
    assert_eq!(stored(&fx).len(), 1);
}

// ── 3.2: Source exists ──────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn source_exists_a_missing_dead_flagged_or_unsettling_source_is_refused() {
    // Records alike in owner, class, content, authority and access are one record (phase 3,
    // 8.2), so each has its own text.
    let fx = fixture();
    let mut flagged = mem::entry(3, ADA, &["space"], SUBJECT, &format!("{TEXT} 3"));
    flagged.flags = vec![MemoryFlag::InstructionLike];
    let mut episodic = mem::entry(4, ADA, &["space"], SUBJECT, &format!("{TEXT} 4"));
    episodic.class = MemoryClass::Episodic;
    let mut transcript = mem::entry(5, ADA, &["space"], SUBJECT, &format!("{TEXT} 5"));
    umbel_store::conformance::samples::set_authority(&mut transcript, Authority::Transcript);
    mem::write(
        &fx,
        vec![
            mem::entry(1, ADA, &["space"], SUBJECT, &format!("{TEXT} 1")),
            mem::entry(2, ADA, &["space"], SUBJECT, &format!("{TEXT} 2")),
            flagged,
            episodic,
            transcript,
            mem::entry(
                6,
                ADA,
                &["principal:human:ada"],
                SUBJECT,
                &format!("{TEXT} 6"),
            ),
        ],
    );
    let draft_of = |n: u64| drafted(&[mem::record(&fx, &mem::id(n))], &Place::default());
    let (live, dead) = (draft_of(1), draft_of(2));
    let (flagged, episodic, transcript, private) =
        (draft_of(3), draft_of(4), draft_of(5), draft_of(6));
    mem::invalidate(&fx, &mem::id(2), ADA);
    let mut fx = fx;
    fx.reopen(&config());

    // Never written, and another person's private record: absent alike.
    let mut absent = live.clone();
    let ghost = mem::id(99);
    absent["evidence"][0]["ref"] = json!(format!("{ghost}@1"));
    absent["derivedFrom"][0]["id"] = json!(ghost);
    refused(&fx, absent, "source-missing").await;
    refused(&fx, private, "source-missing").await;
    refused(&fx, dead, "source-not-live").await;
    refused(&fx, flagged, "source-flagged").await;
    // The input schema takes only the classes and authorities that settle, so these entries
    // claim them; the records are what the store says.
    refused(
        &fx,
        with_entry(&episodic, "class", json!("semantic")),
        "source-class",
    )
    .await;
    // Step 3c: a transcript never settles (owner decision 9).
    refused(
        &fx,
        with_entry(&transcript, "authority", json!("person")),
        "source-authority",
    )
    .await;
    assert_eq!(one(&fx, live).await["ok"], true);
}

// ── 3.2: Version ────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn version_a_source_cited_at_another_version_or_hash_is_refused() {
    let fx = fixture();
    let record = shared(&fx, 1);
    let proposal = drafted(&[record], &Place::default());
    let id = mem::id(1);
    refused(
        &fx,
        with_entry(&proposal, "ref", json!(format!("{id}@2"))),
        "source-version",
    )
    .await;
    let other = format!("sha256:{}", "ab".repeat(32));
    let mut both = with_entry(&proposal, "contentHash", json!(other));
    both["derivedFrom"][0]["contentHash"] = json!(other);
    refused(&fx, both, "source-hash").await;
    let mut derived = proposal.clone();
    derived["derivedFrom"][0]["contentHash"] = json!(other);
    refused(&fx, derived, "source-hash").await;
}

// ── 3.2: Copied fields and confidence ───────────────────────────────────────────────────────

#[tokio::test]
async fn copied_fields_each_field_must_be_the_records_exactly() {
    let fx = fixture();
    let record = shared(&fx, 1);
    let proposal = drafted(&[record], &Place::default());
    let cases = [
        ("principal", json!("human:bo"), "copied-principal"),
        ("class", json!("procedural"), "copied-class"),
        ("authority", json!("agent"), "copied-authority"),
        ("origin", json!("agent-inferred"), "copied-origin"),
        ("constraints", json!([]), "copied-constraints"),
        ("constraints", Value::Null, "copied-constraints"),
        (
            "access",
            json!(["space", "group:platform"]),
            "copied-access",
        ),
        ("sensitivity", json!("public"), "copied-sensitivity"),
        (
            "confirmation",
            json!({ "by": ADA, "at": "2025-12-01T00:00:00.000Z", "priorAuthority": "agent" }),
            "copied-confirmation",
        ),
    ];
    for (field, value, check) in cases {
        refused(&fx, with_entry(&proposal, field, value), check).await;
    }
    let mut confidence = proposal.clone();
    confidence["confidence"] = json!(0.5);
    refused(&fx, confidence, "confidence").await;
    let mut absent = proposal;
    absent.as_object_mut().unwrap().remove("confidence");
    refused(&fx, absent, "confidence").await;
}

#[tokio::test]
async fn a_replayed_batch_with_a_tampered_authority_is_refused_as_a_mismatch() {
    // Section 13's exit point 1: the same batch replayed with one copied field changed.
    let fx = fixture();
    let record = shared(&fx, 1);
    let proposal = drafted(&[record], &Place::default());
    let (first, _) = submit(&fx, json!([proposal.clone()]), None).await;
    assert_eq!(item(data(&first), "results", 0)["created"], true, "{first}");
    let stored_before = stored(&fx);
    let tampered = with_entry(&proposal, "authority", json!("agent"));
    let (replay, _) = submit(&fx, json!([tampered]), None).await;
    let result = item(data(&replay), "results", 0);
    assert_eq!(item_code(result), "PROPOSAL_DRAFT_MISMATCH", "{replay}");
    assert_eq!(result["error"]["details"]["check"], "copied-authority");
    assert_eq!(stored(&fx), stored_before, "the stored draft is unchanged");
}

// ── 3.2: Counts ─────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn counts_sessions_and_principals_are_bounded_by_the_store() {
    let fx = fixture();
    let record = shared(&fx, 1);
    let proposal = drafted(&[record], &Place::default());
    let sessions = proposal["evidence"][0]["observations"]["sessions"]
        .as_u64()
        .unwrap();
    refused(
        &fx,
        with_entry(
            &proposal,
            "observations",
            json!({ "sessions": sessions + 1, "principals": 1 }),
        ),
        "counts",
    )
    .await;
    refused(
        &fx,
        with_entry(
            &proposal,
            "observations",
            json!({ "sessions": sessions, "principals": 2 }),
        ),
        "counts",
    )
    .await;
    // Fewer sessions than the store counts are a bound, not a mismatch.
    let fewer = with_entry(
        &proposal,
        "observations",
        json!({ "sessions": 0, "principals": 1 }),
    );
    // The rationale's counts are bounded too.
    for (more_sessions, more_principals) in [(5, 0), (0, 1)] {
        let mut rationale = proposal.clone();
        let mut text = Rationale::parse(rationale["rationale"].as_str().unwrap()).unwrap();
        text.sessions += more_sessions;
        text.principals += more_principals;
        rationale["rationale"] = json!(text.render());
        refused(&fx, rationale, "counts").await;
    }
    assert_eq!(one(&fx, fewer).await["ok"], true);
}

// ── 3.2: One group ──────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn one_group_sources_share_a_content_hash_and_class_and_are_each_cited_once() {
    let fx = fixture();
    mem::write(
        &fx,
        vec![
            mem::entry(1, ADA, &["space"], SUBJECT, TEXT),
            mem::entry(2, ADA, &["space"], SUBJECT, "Another text."),
        ],
    );
    let (a, b) = (mem::record(&fx, &mem::id(1)), mem::record(&fx, &mem::id(2)));
    refused(&fx, drafted(&[a.clone(), b], &Place::default()), "group").await;
    let mut twice = drafted(std::slice::from_ref(&a), &Place::default());
    let entry = twice["evidence"][0].clone();
    twice["evidence"].as_array_mut().unwrap().push(entry);
    let derived = twice["derivedFrom"][0].clone();
    twice["derivedFrom"].as_array_mut().unwrap().push(derived);
    refused(&fx, twice, "group").await;
}

// ── 3.2: Excerpt ────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn excerpt_is_the_records_text_cut_at_a_thousand_characters() {
    let fx = fixture();
    let record = shared(&fx, 1);
    let proposal = drafted(&[record], &Place::default());
    refused(
        &fx,
        with_entry(&proposal, "excerpt", json!("Deploys to prod.")),
        "excerpt",
    )
    .await;
    // An entry without an excerpt claims none.
    let mut none = proposal;
    none["evidence"][0]
        .as_object_mut()
        .unwrap()
        .remove("excerpt");
    assert_eq!(one(&fx, none).await["ok"], true);
}

// ── 3.2: Content ────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn content_is_byte_equal_to_the_fixed_rendering() {
    let fx = fixture();
    let record = shared(&fx, 1);
    let proposal = drafted(&[record], &Place::default());
    let content = proposal["change"]["content"].as_str().unwrap().to_owned();
    let mut changed = proposal.clone();
    changed["change"]["content"] = json!(content.replace("switch colours", "switch colors"));
    refused(&fx, changed, "content").await;
    let mut dropped = proposal.clone();
    dropped["change"]["content"] =
        json!(content.replace("\n## Holds only\n\n- \"staging only\"\n", ""));
    refused(&fx, dropped, "content").await;
    let mut bare = proposal;
    bare["change"]["content"] = json!(format!("{TEXT}\n"));
    refused(&fx, bare, "content").await;
}

// ── 3.2: Candidate and document id ──────────────────────────────────────────────────────────

#[tokio::test]
async fn candidate_and_document_are_the_derivations_of_the_lowest_source() {
    let fx = fixture();
    let record = shared(&fx, 1);
    let proposal = drafted(&[record], &Place::default());
    let mut wrong = proposal.clone();
    wrong["drafter"]["candidate"] = json!("c-0123456789abcdef0123");
    refused(&fx, wrong, "candidate").await;
    let mut absent = proposal.clone();
    absent["drafter"]
        .as_object_mut()
        .unwrap()
        .remove("candidate");
    refused(&fx, absent, "candidate").await;
    let mut elsewhere = proposal;
    elsewhere["change"]["doc"] = json!("handbook/learned/c-0123456789abcdef0123");
    refused(&fx, elsewhere, "document").await;
}

// ── 3.2: Conflict set ───────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn conflict_set_members_share_the_document_and_subject_and_differ_in_content() {
    let fx = fixture();
    mem::write(
        &fx,
        vec![
            mem::entry(1, ADA, &["space"], SUBJECT, TEXT),
            mem::entry(
                2,
                ADA,
                &["space"],
                "staging: uses BLUE green.",
                "Staging is red-black now.",
            ),
            mem::entry(
                3,
                ADA,
                &["space"],
                "Production uses canaries",
                "Canary first.",
            ),
            mem::entry(4, ADA, &["space", "group:platform"], SUBJECT, TEXT),
            mem::entry(
                5,
                ADA,
                &["space"],
                "Staging uses Blue Green",
                "Staging uses rainbows.",
            ),
        ],
    );
    let read = |n: u64| vec![mem::record(&fx, &mem::id(n))];
    let candidates = [mem::candidate(&read(1)), mem::candidate(&read(2))];
    let set = umbel_okf::draft::conflict_set_id("main", CALLER, candidates.iter().min().unwrap());
    let place = Place {
        conflict_set: Some(&set),
        ..Place::default()
    };
    // Two alternatives on the set's document are both stored.
    assert_eq!(one(&fx, drafted(&read(1), &place)).await["ok"], true);
    assert_eq!(one(&fx, drafted(&read(2), &place)).await["ok"], true);
    // Another subject, the same content as a member, or another document: refused.
    refused(&fx, drafted(&read(3), &place), "conflict-set").await;
    refused(&fx, drafted(&read(4), &place), "conflict-set").await;
    let other = Place {
        prefix: "other/",
        conflict_set: Some(&set),
        ..Place::default()
    };
    refused(&fx, drafted(&read(5), &other), "conflict-set").await;
    // A conflict set not of the form k-<20 hex>.
    let malformed = Place {
        conflict_set: Some("k-STAGINGUSESBLUEGREEN"),
        ..Place::default()
    };
    refused(&fx, drafted(&read(5), &malformed), "conflict-set").await;
}

// ── 3.2: Widening and mode ──────────────────────────────────────────────────────────────────

#[tokio::test]
async fn widening_only_a_promotion_of_the_callers_own_records_and_never_more_sensitive() {
    let fx = fixture();
    let mut secret = mem::entry(4, ADA, &["space"], SUBJECT, "A confidential fact.");
    secret.sensitivity = umbel_store::Sensitivity::Confidential;
    umbel_store::conformance::samples::agree(&mut secret);
    mem::write(
        &fx,
        vec![
            mem::entry(1, ADA, &["space"], SUBJECT, TEXT),
            mem::entry(
                2,
                CALLER,
                &["principal:human:local"],
                SUBJECT,
                "Local's own note.",
            ),
            mem::entry(
                3,
                ADA,
                &["principal:human:ada", "principal:human:local"],
                SUBJECT,
                "Shared with local only.",
            ),
            secret,
        ],
    );
    let read = |n: u64| vec![mem::record(&fx, &mem::id(n))];
    // Not wider: scheduled only, with no promotedBy.
    refused(&fx, promoted(&read(1)), "mode").await;
    let mut by = drafted(&read(1), &Place::default());
    by["drafter"]["promotedBy"] = json!(CALLER);
    refused(&fx, by, "promoted-by").await;
    // Wider: a promotion, by the caller, of the caller's own records.
    refused(&fx, drafted(&read(2), &Place::default()), "mode").await;
    let mut someone = promoted(&read(2));
    someone["drafter"]["promotedBy"] = json!(ADA);
    refused(&fx, someone, "promoted-by").await;
    // Another principal's record the caller can read: the caller may not widen it.
    refused(&fx, promoted(&read(3)), "promoted-by").await;
    // More sensitive than the target: always refused.
    refused(&fx, drafted(&read(4), &Place::default()), "sensitivity").await;
    // The owner widening their own record is accepted, labelled as widening.
    let accepted = one(&fx, promoted(&read(2))).await;
    assert_eq!(accepted["ok"], true, "{accepted}");
    let id = accepted["proposal"]["id"].as_str().unwrap();
    let body = records::read(&fx, id).body;
    assert_eq!(body["drafter"]["mode"], "promoted");
    assert_eq!(body["drafter"]["promotedBy"], CALLER);
    let preview = fx
        .cli("knowledge-proposal-preview", json!({ "proposal": id }))
        .await;
    let text = data(&preview)["preview"].as_str().unwrap();
    assert!(
        text.contains("widens readers: sources private to `human:local`"),
        "{text}"
    );
}

// ── 3.2: generated.at ───────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn generated_at_lies_between_the_sources_recording_and_now() {
    let fx = fixture();
    let record = shared(&fx, 1);
    let records = [record];
    let proposal = drafted(&records, &Place::default());
    refused(
        &fx,
        rerendered(&proposal, &records, T0 - DAY_MS),
        "generated-at",
    )
    .await;
    refused(
        &fx,
        rerendered(&proposal, &records, NOW + DAY_MS),
        "generated-at",
    )
    .await;
    // Within the bounds the exact instant is the drafter's, and is accepted.
    let within = rerendered(&proposal, &records, SETTLED + DAY_MS);
    assert_eq!(one(&fx, within).await["ok"], true);
}

// ── Step 3c's checks ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn the_rationale_key_run_evidence_and_derived_from_are_checked_too() {
    let fx = fixture();
    let mut agents = mem::entry(2, ADA, &["space"], SUBJECT, "An agent's note.");
    agents.envelope.origin = umbel_store::Origin::AgentInferred;
    umbel_store::conformance::samples::set_authority(&mut agents, Authority::Agent);
    mem::write(
        &fx,
        vec![mem::entry(1, ADA, &["space"], SUBJECT, TEXT), agents],
    );
    let proposal = drafted(&[mem::record(&fx, &mem::id(1))], &Place::default());
    // Not the fixed text; another class; another settling instant than the content's.
    let mut rationale = proposal.clone();
    rationale["rationale"] = json!("A settled fact, trust me.");
    refused(&fx, rationale, "rationale").await;
    let parsed = Rationale::parse(proposal["rationale"].as_str().unwrap()).unwrap();
    for changed in [
        Rationale {
            class: MemoryClass::Procedural,
            ..parsed
        },
        Rationale {
            settled_at: SETTLED - DAY_MS,
            ..parsed
        },
    ] {
        let mut wrong = proposal.clone();
        wrong["rationale"] = json!(changed.render());
        refused(&fx, wrong, "rationale").await;
    }
    // A higher authority than any source has.
    let agent_draft = drafted(&[mem::record(&fx, &mem::id(2))], &Place::default());
    let mut higher = agent_draft.clone();
    let claimed = Rationale {
        authority: Authority::Person,
        ..Rationale::parse(agent_draft["rationale"].as_str().unwrap()).unwrap()
    };
    higher["rationale"] = json!(claimed.render());
    refused(&fx, higher, "rationale").await;
    let mut key = proposal.clone();
    key["idempotency_key"] = json!("staging-uses-blue-green");
    refused(&fx, key, "key").await;
    let mut run = proposal.clone();
    run["run"] = json!("Staging uses blue-green");
    refused(&fx, run, "run").await;
    let mut evidence = proposal.clone();
    evidence["evidence"]
        .as_array_mut()
        .unwrap()
        .push(json!({ "kind": "text", "ref": "Staging uses blue-green" }));
    refused(&fx, evidence, "evidence").await;
    let mut derived = proposal.clone();
    derived.as_object_mut().unwrap().remove("derivedFrom");
    refused(&fx, derived, "derived-from").await;
    let mut extra = proposal;
    extra["derivedFrom"]
        .as_array_mut()
        .unwrap()
        .push(json!({ "kind": "memory", "id": mem::id(2), "contentHash": format!("sha256:{}", "ab".repeat(32)) }));
    refused(&fx, extra, "derived-from").await;
}

// ── PROPOSAL_ALREADY_OPEN's memory-source half ──────────────────────────────────────────────

#[tokio::test]
async fn a_draft_citing_a_source_of_an_open_proposal_is_already_open() {
    let fx = fixture();
    mem::write(
        &fx,
        vec![
            mem::entry(4, ADA, &["space", "group:platform"], SUBJECT, TEXT),
            mem::entry(5, ADA, &["space"], SUBJECT, TEXT),
        ],
    );
    let (lower, higher) = (mem::record(&fx, &mem::id(4)), mem::record(&fx, &mem::id(5)));
    assert_eq!(
        one(
            &fx,
            drafted(std::slice::from_ref(&higher), &Place::default())
        )
        .await["ok"],
        true
    );
    // Its candidate, and so its document, is the lower source's: only the shared source blocks it.
    let both = drafted(&[lower, higher], &Place::default());
    let result = one(&fx, both).await;
    assert_eq!(item_code(&result), "PROPOSAL_ALREADY_OPEN", "{result}");
    assert_eq!(stored(&fx).len(), 1);
}

// ── A withheld memory grant ─────────────────────────────────────────────────────────────────

#[tokio::test]
async fn without_the_memory_grant_memory_claims_are_unverifiable_and_never_accepted() {
    let mut fx = fixture();
    let record = shared(&fx, 1);
    let proposal = drafted(&[record], &Place::default());
    // Stored while the grant is held, then the grant is denied.
    let stored_draft = one(&fx, proposal.clone()).await;
    let id = stored_draft["proposal"]["id"].as_str().unwrap().to_owned();
    let denied = config().replace(
        "[plugins.knowledge]\nsource = \"compiled:knowledge\"\n",
        "[plugins.knowledge]\nsource = \"compiled:knowledge\"\ndeny = [\"memory\"]\n",
    );
    assert_ne!(denied, config());
    fx.reopen(&denied);
    let mut again = proposal;
    again["idempotency_key"] = json!(umbel_okf::draft::idempotency_key(
        "curator",
        again["drafter"]["candidate"].as_str().unwrap(),
        1
    ));
    let result = one(&fx, again).await;
    assert_eq!(
        item_code(&result),
        "PROPOSAL_DRAFT_UNVERIFIABLE",
        "{result}"
    );
    assert_eq!(
        result["error"]["details"],
        json!({ "claim": "memory-evidence" })
    );
    // Approve cannot re-check the sources either, so nothing is applied.
    let approve = fx
        .at_terminal("knowledge-approve", json!({ "proposal": id }))
        .await;
    assert_eq!(code(&approve), "PROPOSAL_DRAFT_UNVERIFIABLE", "{approve}");
    assert_eq!(records::read(&fx, &id).body["state"], "pending");
}

// ── The "erased" claim ──────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn a_source_named_erased_is_redacted_only_once_the_store_no_longer_holds_it() {
    let mut fx = fixture();
    let record = shared(&fx, 1);
    let stored_draft = one(&fx, drafted(&[record], &Place::default())).await;
    let id = stored_draft["proposal"]["id"].as_str().unwrap().to_owned();
    let early = notice(&fx, json!([mem::id(1)])).await;
    let refused = &data(&early)["erased"]["refused"][0];
    assert_eq!(refused["proposal"], id.as_str(), "{early}");
    assert_eq!(refused["error"]["code"], "PROPOSAL_DRAFT_MISMATCH");
    assert_eq!(refused["error"]["details"]["check"], "source-erased");
    let by_id = drafter::submit(
        &fx,
        json!([]),
        Some(json!([{ "proposal": id, "reason": "source-erased", "redact": true }])),
    )
    .await
    .0;
    let withdrawal = item(data(&by_id), "withdrawals", 0);
    assert_eq!(
        withdrawal["error"]["details"]["check"], "source-erased",
        "{by_id}"
    );
    assert_eq!(records::read(&fx, &id).body["redacted"], Value::Null);

    mem::forget(&fx, &mem::id(1), ADA);
    fx.reopen(&config());
    let later = notice(&fx, json!([mem::id(1)])).await;
    assert_eq!(data(&later)["erased"]["redacted"], json!([id]), "{later}");
    assert!(records::read(&fx, &id).body["redacted"].is_object());
}

// ── Approve repeats the checks (8.2) ────────────────────────────────────────────────────────

/// `config()` with the handbook collection's `access` or `sensitivity` set.
fn handbook_with(key: &str, value: &str) -> String {
    config().replace(
        "root = \"spaces/main/handbook\"\n",
        &format!("root = \"spaces/main/handbook\"\n{key} = {value}\n"),
    )
}

#[tokio::test]
async fn approve_refuses_a_draft_whose_source_or_target_changed_since_submission() {
    let mut fx = fixture();
    mem::write(
        &fx,
        (1..=5)
            .map(|n| mem::entry(n, ADA, &["space"], SUBJECT, &format!("Fact number {n}.")))
            .collect(),
    );
    let mut ids = Vec::new();
    for n in 1..=5 {
        let result = one(
            &fx,
            drafted(&[mem::record(&fx, &mem::id(n))], &Place::default()),
        )
        .await;
        assert_eq!(result["ok"], true, "{result}");
        ids.push(result["proposal"]["id"].as_str().unwrap().to_owned());
    }
    mem::invalidate(&fx, &mem::id(1), ADA);
    mem::forget(&fx, &mem::id(2), ADA);
    fx.reopen(&config());
    let approve = async |fx: &Fx, id: &str| {
        fx.at_terminal("knowledge-approve", json!({ "proposal": id }))
            .await
    };
    assert_eq!(code(&approve(&fx, &ids[0]).await), "PROPOSAL_SOURCE_GONE");
    assert_eq!(code(&approve(&fx, &ids[1]).await), "PROPOSAL_SOURCE_GONE");

    // The target collection less sensitive, or readable by a token a source does not hold.
    fx.reopen(&handbook_with("sensitivity", "\"public\""));
    assert_eq!(
        code(&approve(&fx, &ids[2]).await),
        "PROPOSAL_ACCESS_WIDENED"
    );
    fx.reopen(&handbook_with("access", "[\"space\", \"group:platform\"]"));
    assert_eq!(
        code(&approve(&fx, &ids[2]).await),
        "PROPOSAL_ACCESS_WIDENED"
    );
    for id in &ids[..3] {
        assert_eq!(
            records::read(&fx, id).body["state"],
            "pending",
            "nothing applied"
        );
    }

    // Unchanged: the runner approves another person's shared memory with no exception, and the
    // record keeps naming its source.
    fx.reopen(&config());
    let applied = approve(&fx, &ids[3]).await;
    assert_eq!(data(&applied)["applied"], true, "{applied}");
    let record = records::read(&fx, &ids[3]);
    assert_eq!(record.body["exception"], Value::Null);
    assert_eq!(record.body["decision"]["channel"], "terminal");
    assert_eq!(record.envelope.derived_from.unwrap()[0].id, mem::id(4));
}
