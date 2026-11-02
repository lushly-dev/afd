//! The verification lifecycle (specification section 9.3, decisions D63 and D15): tiers derived
//! from `verified`, staleness, `knowledge-verify` by a person, deprecation, and rewrites that
//! change the frontmatter keys they name and no other byte.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::*;

const AREA: &str = r#"
[plugins.knowledge.config.areas.handbook]
space = "main"
collection = "handbook"
"#;

/// A file with a comment, odd spacing and a body the rewrites must leave alone.
const RUNBOOK: &str = "---\ntitle:   Rolling back\n# keep this comment\ntype: runbook\ntags: [a,   b]\n---\n# Rolling back\n\nUse the previous tag.\n";

fn config(local_id: &str, areas: &str) -> String {
    format!("{CONFIG}\n[principal]\nlocal_id = \"{local_id}\"\n{areas}")
}

async fn fixture(local_id: &str, areas: &str) -> Fx {
    let fx = Fx::with(&config(local_id, areas));
    fx.handbook("runbook.md", RUNBOOK);
    fx.refresh("main").await;
    fx
}

fn file(fx: &Fx, relative: &str) -> String {
    std::fs::read_to_string(fx.path(&format!("spaces/main/handbook/{relative}"))).unwrap()
}

async fn describe(fx: &Fx, doc: &str) -> Value {
    let described = fx
        .as_actor(member(), "knowledge-describe", json!({ "doc": doc }))
        .await;
    data(&described).clone()
}

async fn base_of(fx: &Fx, doc: &str) -> String {
    describe(fx, doc).await["contentHash"]
        .as_str()
        .unwrap()
        .to_owned()
}

#[tokio::test]
async fn tiers_come_from_who_verified_and_owners_are_the_top_tier() {
    let fx = Fx::new();
    let verified = |by: &str| format!("verified:\n  - by: {by}\n    at: 2025-12-01T00:00:00Z\n");
    fx.handbook("none.md", "---\ntitle: None\n---\nx\n");
    fx.handbook(
        "machine.md",
        &format!("---\ntitle: Machine\n{}---\nx\n", verified("curator/1.0")),
    );
    fx.handbook(
        "human.md",
        &format!("---\ntitle: Human\n{}---\nx\n", verified("human:bo")),
    );
    fx.handbook(
        "owner.md",
        &format!(
            "---\ntitle: Owner\nowners: [\"human:ada\"]\n{}---\nx\n",
            verified("human:ada")
        ),
    );
    fx.handbook(
        "single.md",
        "---\ntitle: Single\nverified: { by: \"human:bo\", at: 2025-12-01T00:00:00Z }\n---\nx\n",
    );
    fx.refresh("main").await;
    for (doc, tier) in [
        ("handbook/none", "unverified"),
        ("handbook/machine", "machine"),
        ("handbook/human", "human"),
        ("handbook/owner", "owner"),
        ("handbook/single", "human"),
    ] {
        assert_eq!(
            describe(&fx, doc).await["verification"]["tier"],
            tier,
            "{doc}"
        );
    }
}

#[tokio::test]
async fn a_hit_is_stale_from_its_stale_after_date_by_the_command_clock() {
    let fx = Fx::new();
    // The test clock is 2026-01-01T00:00:00Z.
    fx.handbook(
        "old.md",
        "---\ntitle: Old zulu\nstale_after: 2025-12-31T00:00:00Z\n---\nzulu\n",
    );
    fx.handbook(
        "fresh.md",
        "---\ntitle: Fresh zulu\nstale_after: 2026-06-01T00:00:00Z\n---\nzulu\n",
    );
    fx.refresh("main").await;
    let found = fx.search(member(), json!({ "query": "zulu" })).await;
    let stale = warning(&found, "STALE_CONTENT").unwrap();
    assert_eq!(
        stale["details"]["ids"],
        json!(["main:handbook/old"]),
        "{found}"
    );
}

#[tokio::test]
async fn a_verification_by_an_approver_applies_in_one_call_and_rewrites_only_its_keys() {
    let fx = fixture("ada", AREA).await;
    let done = fx
        .at_terminal(
            "knowledge-verify",
            json!({ "doc": "handbook/runbook", "note": "Checked against the release.", "stale_after": "2027-01-01T00:00:00Z" }),
        )
        .await;
    assert_eq!(data(&done)["applied"], true, "{done}");
    assert_eq!(data(&done)["indexed"], false);
    // Every other byte is as it was: the odd spacing, the comment, the body.
    let expected = RUNBOOK.replace(
        "tags: [a,   b]\n---\n",
        "tags: [a,   b]\nverified:\n  - by: \"human:ada\"\n    at: \"2026-01-01T00:00:00.000Z\"\nstale_after: \"2027-01-01T00:00:00Z\"\n---\n",
    );
    assert_eq!(file(&fx, "runbook.md"), expected);

    // One proposal records the attestation and the decision, with no self-approval exception.
    let id = data(&done)["proposal"]["id"].as_str().unwrap().to_owned();
    let shown = fx
        .as_actor(
            member(),
            "knowledge-proposal-show",
            json!({ "proposal": id }),
        )
        .await;
    let proposal = &data(&shown)["proposal"];
    assert_eq!(proposal["state"], "applied");
    assert_eq!(proposal["change"]["op"], "verify");
    assert_eq!(proposal["proposer"]["principal"], "human:ada");
    assert_eq!(proposal["decision"]["principal"], "human:ada");
    assert_eq!(proposal["exception"], Value::Null);
    assert_eq!(
        proposal["change"]["verification"]["note"],
        "Checked against the release."
    );

    // After the next refresh the document is human-verified and carries its stale_after.
    fx.refresh("main").await;
    let after = describe(&fx, "handbook/runbook").await;
    assert_eq!(after["verification"]["tier"], "human");
    assert_eq!(after["verification"]["count"], 1);
    assert_eq!(after["staleAfter"], "2027-01-01T00:00:00Z");
    let verified_only = fx
        .search(
            member(),
            json!({ "query": "previous tag", "filters": { "verified": ["human"] } }),
        )
        .await;
    assert_eq!(
        hit_ids(&verified_only),
        ["handbook/runbook"],
        "{verified_only}"
    );
}

#[tokio::test]
async fn a_second_verification_appends_and_a_single_mapping_becomes_a_list() {
    let fx = Fx::new();
    fx.handbook(
        "single.md",
        "---\ntitle: Single\nverified: { by: \"curator/1.0\", at: 2025-12-01T00:00:00Z }\n---\nbody\n",
    );
    let mut cfg = config("ada", AREA);
    cfg.push('\n');
    let mut fx = fx;
    fx.reopen(&cfg);
    fx.refresh("main").await;
    let done = fx
        .at_terminal("knowledge-verify", json!({ "doc": "handbook/single" }))
        .await;
    assert_eq!(data(&done)["applied"], true, "{done}");
    let text = file(&fx, "single.md");
    assert!(
        text.starts_with("---\ntitle: Single\nverified:\n  - by: \"curator/1.0\"\n    at: \"2025-12-01T00:00:00Z\"\n  - by: \"human:ada\"\n"),
        "{text}"
    );
    assert!(text.ends_with("---\nbody\n"));
    fx.refresh("main").await;
    assert_eq!(
        describe(&fx, "handbook/single").await["verification"]["count"],
        2
    );
}

#[tokio::test]
async fn a_verification_by_someone_who_is_not_an_approver_waits_for_one() {
    let areas = r#"
[plugins.knowledge.config.areas.handbook]
space = "main"
collection = "handbook"
approvers = ["principal:human:bo"]
"#;
    let mut fx = fixture("ada", areas).await;
    let pending = fx
        .at_terminal("knowledge-verify", json!({ "doc": "handbook/runbook" }))
        .await;
    assert_eq!(data(&pending)["created"], true, "{pending}");
    assert_eq!(data(&pending)["proposal"]["state"], "pending");
    assert_eq!(file(&fx, "runbook.md"), RUNBOOK);
    let id = data(&pending)["proposal"]["id"]
        .as_str()
        .unwrap()
        .to_owned();

    // The approver bo applies it: the attestation is the approver's.
    fx.reopen(&config("bo", areas));
    let done = fx
        .at_terminal("knowledge-approve", json!({ "proposal": id }))
        .await;
    assert_eq!(data(&done)["applied"], true, "{done}");
    assert!(file(&fx, "runbook.md").contains("by: \"human:bo\""));
    let shown = fx
        .as_actor(
            member(),
            "knowledge-proposal-show",
            json!({ "proposal": id }),
        )
        .await;
    assert_eq!(
        data(&shown)["proposal"]["proposer"]["principal"],
        "human:ada"
    );
    assert_eq!(
        data(&shown)["proposal"]["decision"]["principal"],
        "human:bo"
    );
    assert_eq!(data(&shown)["proposal"]["exception"], Value::Null);
}

#[tokio::test]
async fn apply_false_leaves_the_verification_pending_even_for_an_approver() {
    let fx = fixture("ada", AREA).await;
    let pending = fx
        .at_terminal(
            "knowledge-verify",
            json!({ "doc": "handbook/runbook", "apply": false }),
        )
        .await;
    assert_eq!(data(&pending)["proposal"]["state"], "pending", "{pending}");
    assert_eq!(file(&fx, "runbook.md"), RUNBOOK);
    // The same call again is the same proposal.
    let again = fx
        .at_terminal(
            "knowledge-verify",
            json!({ "doc": "handbook/runbook", "apply": false }),
        )
        .await;
    assert_eq!(data(&again)["created"], false);
    // The same person approves it later: their own verification is not self-approval.
    let id = data(&pending)["proposal"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let done = fx
        .at_terminal("knowledge-approve", json!({ "proposal": id }))
        .await;
    assert_eq!(data(&done)["applied"], true, "{done}");
    let shown = fx
        .as_actor(
            member(),
            "knowledge-proposal-show",
            json!({ "proposal": id }),
        )
        .await;
    assert_eq!(data(&shown)["proposal"]["exception"], Value::Null);
}

#[tokio::test]
async fn a_deprecation_rewrites_status_and_superseded_by_and_search_hides_it() {
    let fx = fixture("ada", AREA).await;
    fx.handbook("canary.md", "---\ntitle: Canary\n---\nNew way.\n");
    fx.refresh("main").await;
    let base = base_of(&fx, "handbook/runbook").await;
    let proposed = fx
        .as_actor(
            agent("curator"),
            "knowledge-propose",
            json!({
                "idempotency_key": "dep-1",
                "change": { "op": "deprecate", "doc": "handbook/runbook", "baseHash": base, "supersededBy": "handbook/canary" },
                "rationale": "Replaced by the canary runbook.",
                "evidence": [{ "kind": "text", "ref": "decision log" }],
            }),
        )
        .await;
    let id = data(&proposed)["proposal"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let done = fx
        .at_terminal("knowledge-approve", json!({ "proposal": id }))
        .await;
    assert_eq!(data(&done)["applied"], true, "{done}");
    let expected = RUNBOOK.replace(
        "tags: [a,   b]\n---\n",
        "tags: [a,   b]\nstatus: \"deprecated\"\nsuperseded_by: \"handbook/canary\"\n---\n",
    );
    assert_eq!(file(&fx, "runbook.md"), expected);
    fx.refresh("main").await;
    let after = describe(&fx, "handbook/runbook").await;
    assert_eq!(after["status"], "deprecated");
    assert_eq!(after["supersededBy"], "handbook/canary");
    let hidden = fx
        .search(member(), json!({ "query": "previous tag" }))
        .await;
    assert!(hit_ids(&hidden).is_empty(), "{hidden}");
    let shown = fx
        .search(
            member(),
            json!({ "query": "previous tag", "filters": { "include_deprecated": true } }),
        )
        .await;
    assert_eq!(hit_ids(&shown), ["handbook/runbook"]);
}

#[tokio::test]
async fn an_update_sets_status_stable_unless_the_content_says_otherwise() {
    let fx = fixture("ada", AREA).await;
    let base = base_of(&fx, "handbook/runbook").await;
    let content = "---\ntitle: Rolling back\nstatus: draft\n---\nDraft text.\n";
    let proposed = fx
        .as_actor(
            agent("x"),
            "knowledge-propose",
            json!({
                "idempotency_key": "k1",
                "change": { "op": "update", "doc": "handbook/runbook", "baseHash": base, "content": content },
                "rationale": "A draft.",
                "evidence": [{ "kind": "text", "ref": "x" }],
            }),
        )
        .await;
    let id = data(&proposed)["proposal"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    fx.at_terminal("knowledge-approve", json!({ "proposal": id }))
        .await;
    assert_eq!(describe(&fx, "handbook/runbook").await["status"], "draft");
    // The content without a status is stable.
    let base = base_of(&fx, "handbook/runbook").await;
    let proposed = fx
        .as_actor(
            agent("x"),
            "knowledge-propose",
            json!({
                "idempotency_key": "k2",
                "change": { "op": "update", "doc": "handbook/runbook", "baseHash": base, "content": "---\ntitle: Rolling back\n---\nFinal.\n" },
                "rationale": "Done.",
                "evidence": [{ "kind": "text", "ref": "x" }],
            }),
        )
        .await;
    let id = data(&proposed)["proposal"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    fx.at_terminal("knowledge-approve", json!({ "proposal": id }))
        .await;
    assert_eq!(describe(&fx, "handbook/runbook").await["status"], "stable");
}

#[tokio::test]
async fn verify_needs_a_readable_document_and_a_valid_stale_after() {
    let fx = fixture("ada", AREA).await;
    let missing = fx
        .at_terminal("knowledge-verify", json!({ "doc": "handbook/nope" }))
        .await;
    assert_eq!(code(&missing), "DOCUMENT_NOT_FOUND", "{missing}");
    let bad = fx
        .at_terminal(
            "knowledge-verify",
            json!({ "doc": "handbook/runbook", "stale_after": "next year" }),
        )
        .await;
    assert_eq!(code(&bad), "PROPOSAL_INVALID", "{bad}");
    assert_eq!(file(&fx, "runbook.md"), RUNBOOK);
}
