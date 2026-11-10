//! Proposal record versions 2 and 3 (phase 4 specification, section 2.1, D92; phase 5 sections
//! 2.4 and 7.3, D116): every new proposal is version 3 (from phase 5 step 6), with version 2's
//! `drafter`, `conflictSet`, `withdrawal` and `redacted`, `decision.channel` and, on a person's
//! decision, `decision.assurance`, and envelope version 3, each stored record valid against
//! `schemas/proposal.v3.json`; a version 1 record phase 2 stored, or a version 2 one phase 4
//! stored, is read, retried by key, decided, withdrawn and applied, and stays in its own version,
//! valid against its own schema. `knowledge-propose` never takes memory evidence, which needs a
//! drafter's attestation.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::{Actor, ActorKind};
use serde_json::{Value, json};
use support::records::{self, Draft, assert_valid};
use support::*;

const RUNBOOK: &str =
    "---\ntitle: Rolling back\ntype: runbook\n---\n# Rolling back\n\nUse the previous tag.\n";
const UPDATED: &str = "---\ntitle: Rolling back\ntype: runbook\n---\n# Rolling back\n\nUse the previous release tag, then verify.\n";
const NEW_DOC: &str =
    "---\ntitle: Canary checks\ntype: runbook\n---\n# Canary checks\n\nWatch the canary.\n";
const VERSION_2_KEYS: [&str; 4] = ["drafter", "conflictSet", "withdrawal", "redacted"];

const AREA: &str = r#"
[plugins.knowledge.config.areas.handbook]
space = "main"
collection = "handbook"
"#;

fn agent_of(id: &str) -> Actor {
    Actor::new(ActorKind::Agent)
        .with_id(id)
        .with_on_behalf_of(id)
}

async fn fixture() -> Fx {
    let fx = Fx::with(&format!(
        "{CONFIG}\n[principal]\nlocal_id = \"ada\"\n{AREA}"
    ));
    fx.handbook("runbook.md", RUNBOOK);
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

async fn propose(fx: &Fx, actor: Actor, key: &str, change: Value) -> String {
    let result = fx
        .as_actor(
            actor,
            "knowledge-propose",
            json!({
                "idempotency_key": key,
                "change": change,
                "rationale": "The procedure changed in October.",
                "evidence": [{ "kind": "text", "ref": "release notes" }],
            }),
        )
        .await;
    data(&result)["proposal"]["id"].as_str().unwrap().to_owned()
}

/// The stored body, checked against the schema of its own version.
fn stored(fx: &Fx, id: &str) -> Value {
    let record = records::read(fx, id);
    let version = record.body["version"].as_u64().unwrap();
    assert_valid(&format!("proposal.v{version}"), &record.body);
    record.body
}

#[tokio::test]
async fn a_new_proposal_is_version_3_with_its_fields_null() {
    let fx = fixture().await;
    let base = hash_of(&fx, "handbook/runbook").await;
    let ops = [
        json!({ "op": "update", "doc": "handbook/runbook", "baseHash": base, "content": UPDATED }),
        json!({ "op": "create", "doc": "handbook/canary", "content": NEW_DOC }),
        json!({ "op": "deprecate", "doc": "handbook/runbook", "baseHash": base }),
        json!({ "op": "verify", "doc": "handbook/runbook", "baseHash": base }),
    ];
    for (n, change) in ops.into_iter().enumerate() {
        let id = propose(&fx, agent_of("ada"), &format!("k{n}"), change).await;
        let body = stored(&fx, &id);
        // Version 3 from phase 5 step 6: version 2's fields, envelope version 3.
        assert_eq!(body["version"], 3, "{body}");
        for key in VERSION_2_KEYS {
            assert_eq!(body[key], Value::Null, "{key}: {body}");
        }
        let provenance = &body["provenance"];
        assert_eq!(provenance["version"], 3);
        // No token, so no chain: the library's caller is not delegated.
        assert_eq!(provenance["delegationChain"], json!([]), "{provenance}");
        for key in [
            "authority",
            "derivedFrom",
            "redactions",
            "constraints",
            "confirmation",
        ] {
            assert!(
                provenance.get(key).is_some_and(Value::is_null),
                "{key}: {provenance}"
            );
        }
        // The provenance's contentHash is the change hash, as in version 1.
        assert_eq!(provenance["contentHash"], body["changeHash"]);
        assert_eq!(body["policy"]["rule"], "person");
        // The store's envelope is the version the body nests (D36), its chain the host's.
        let envelope = records::read(&fx, &id).envelope;
        assert_eq!(envelope.version, 3);
        assert_eq!(envelope.delegation_chain, Some(Vec::new()));
        // knowledge-proposal-show reads it in its version.
        let shown = fx
            .as_actor(
                member(),
                "knowledge-proposal-show",
                json!({ "proposal": id }),
            )
            .await;
        assert_eq!(data(&shown)["proposal"]["version"], 3, "{shown}");
        assert_eq!(data(&shown)["proposal"]["drafter"], Value::Null);
    }
}

#[tokio::test]
async fn decisions_name_their_channel_and_a_withdrawal_who_withdrew() {
    let fx = fixture().await;
    let base = hash_of(&fx, "handbook/runbook").await;
    let applied = propose(
        &fx,
        agent("x"),
        "k1",
        json!({ "op": "update", "doc": "handbook/runbook", "baseHash": base, "content": UPDATED }),
    )
    .await;
    let rejected = propose(
        &fx,
        agent("x"),
        "k2",
        json!({ "op": "create", "doc": "handbook/canary", "content": NEW_DOC }),
    )
    .await;
    let withdrawn = propose(
        &fx,
        agent("x"),
        "k3",
        json!({ "op": "create", "doc": "handbook/other", "content": NEW_DOC }),
    )
    .await;

    let result = fx
        .at_terminal("knowledge-approve", json!({ "proposal": applied }))
        .await;
    assert_eq!(data(&result)["applied"], true, "{result}");
    let body = stored(&fx, &applied);
    assert_eq!(body["state"], "applied");
    assert_eq!(body["decision"]["channel"], "terminal", "{body}");
    assert_eq!(body["decision"]["by"]["kind"], "human");
    // Version 3 records how the person was proven: the terminal's check (phase 5 section 7.3).
    assert_eq!(
        body["decision"]["assurance"],
        json!({ "level": "terminal", "method": "cli-terminal" }),
        "{body}"
    );
    assert_eq!(body["withdrawal"], Value::Null);
    assert_eq!(body["result"]["path"], "runbook.md");
    // Each later save keeps the record's envelope version.
    assert_eq!(records::read(&fx, &applied).envelope.version, 3);

    let result = fx
        .at_terminal(
            "knowledge-reject",
            json!({ "proposal": rejected, "reason": "Not needed." }),
        )
        .await;
    assert_eq!(data(&result)["rejected"], true, "{result}");
    let body = stored(&fx, &rejected);
    assert_eq!(body["decision"]["channel"], "terminal");
    assert_eq!(body["decision"]["assurance"]["level"], "terminal");
    assert_eq!(body["decision"]["reason"], "Not needed.");

    let result = fx
        .as_actor(
            agent("x"),
            "knowledge-withdraw",
            json!({ "proposal": withdrawn }),
        )
        .await;
    assert_eq!(data(&result)["withdrawn"], true, "{result}");
    let body = stored(&fx, &withdrawn);
    assert_eq!(body["state"], "withdrawn");
    assert_eq!(
        body["withdrawal"],
        json!({ "by": "proposer", "reason": "retracted", "at": body["updatedAt"] }),
        "{body}"
    );
    assert_eq!(body["redacted"], Value::Null);
    assert_eq!(body["decision"], Value::Null);
}

#[tokio::test]
async fn a_version_1_proposal_stays_version_1_through_every_decision() {
    let fx = fixture().await;
    let base = hash_of(&fx, "handbook/runbook").await;
    let approve_me = records::version_1("x", "v1-approve", &base, UPDATED);
    let reject_me = records::version_1("x", "v1-reject", &base, UPDATED);
    let withdraw_me = records::version_1("x", "v1-withdraw", &base, UPDATED);
    for body in [&approve_me, &reject_me, &withdraw_me] {
        assert_valid("proposal.v1", body);
        records::seed(&fx, body);
    }
    let id = |body: &Value| body["id"].as_str().unwrap().to_owned();

    // Read, listed and retried by key: the same change returns it, another is refused.
    let shown = fx
        .as_actor(
            member(),
            "knowledge-proposal-show",
            json!({ "proposal": id(&approve_me) }),
        )
        .await;
    assert_eq!(data(&shown)["proposal"]["version"], 1, "{shown}");
    assert!(data(&shown)["proposal"].get("drafter").is_none(), "{shown}");
    let listed = fx
        .as_actor(member(), "knowledge-proposal-list", json!({}))
        .await;
    assert_eq!(data(&listed)["count"], 3, "{listed}");
    let retry = fx
        .as_actor(
            agent("x"),
            "knowledge-propose",
            json!({
                "idempotency_key": "v1-approve",
                "change": approve_me["change"],
                "rationale": approve_me["rationale"],
                "evidence": approve_me["evidence"],
            }),
        )
        .await;
    assert_eq!(data(&retry)["created"], false, "{retry}");
    assert_eq!(data(&retry)["proposal"]["id"], approve_me["id"]);
    let reused = fx
        .as_actor(
            agent("x"),
            "knowledge-propose",
            json!({
                "idempotency_key": "v1-approve",
                "change": { "op": "update", "doc": "handbook/runbook", "baseHash": base, "content": RUNBOOK },
                "rationale": "Another change.",
                "evidence": [{ "kind": "text", "ref": "elsewhere" }],
            }),
        )
        .await;
    assert_eq!(code(&reused), "PROPOSAL_KEY_REUSED");

    // Approved and applied at a terminal, through the preview.
    let result = fx
        .at_terminal("knowledge-approve", json!({ "proposal": id(&approve_me) }))
        .await;
    assert_eq!(data(&result)["applied"], true, "{result}");
    assert_eq!(
        std::fs::read_to_string(fx.path("spaces/main/handbook/runbook.md")).unwrap(),
        UPDATED
    );
    // Rejected, and withdrawn by its proposer.
    let result = fx
        .at_terminal(
            "knowledge-reject",
            json!({ "proposal": id(&reject_me), "reason": "No." }),
        )
        .await;
    assert_eq!(data(&result)["rejected"], true, "{result}");
    let result = fx
        .as_actor(
            agent("x"),
            "knowledge-withdraw",
            json!({ "proposal": id(&withdraw_me) }),
        )
        .await;
    assert_eq!(data(&result)["withdrawn"], true, "{result}");

    for (body, state) in [
        (&approve_me, "applied"),
        (&reject_me, "rejected"),
        (&withdraw_me, "withdrawn"),
    ] {
        let now = stored(&fx, &id(body));
        assert_eq!(now["version"], 1, "{now}");
        assert_eq!(now["state"], state);
        for key in VERSION_2_KEYS {
            assert!(now.get(key).is_none(), "{key} in a version 1 record: {now}");
        }
        if state != "withdrawn" {
            assert!(now["decision"].get("channel").is_none(), "{now}");
        }
        assert_eq!(
            now["provenance"], body["provenance"],
            "the body's provenance is kept"
        );
        assert_eq!(records::read(&fx, &id(body)).envelope.version, 1);
    }
}

#[tokio::test]
async fn a_version_2_proposal_stays_version_2_when_a_person_decides_it_at_a_terminal() {
    let fx = fixture().await;
    let drafted = records::drafted(&Draft {
        candidate: "7d4e5f60718293041526",
        canary: "bilby",
        promoted_by: None,
        conflict_set: None,
    });
    assert_valid("proposal.v2", &drafted);
    records::seed(&fx, &drafted);
    let id = drafted["id"].as_str().unwrap();
    let result = fx
        .at_terminal(
            "knowledge-reject",
            json!({ "proposal": id, "reason": "Not now." }),
        )
        .await;
    assert_eq!(data(&result)["rejected"], true, "{result}");
    // Version 2 cannot hold an assurance: the record keeps its version, a terminal channel and
    // no assurance (proposal.v2.json refuses one).
    let now = stored(&fx, id);
    assert_eq!(now["version"], 2, "{now}");
    assert_eq!(now["decision"]["channel"], "terminal", "{now}");
    assert!(now["decision"].get("assurance").is_none(), "{now}");
    assert_eq!(records::read(&fx, id).envelope.version, 2);
    assert_eq!(records::read(&fx, id).envelope.delegation_chain, None);
}

#[tokio::test]
async fn memory_evidence_needs_a_drafter_and_an_unknown_version_is_not_read() {
    let fx = fixture().await;
    let base = hash_of(&fx, "handbook/runbook").await;
    let refused = fx
        .as_actor(
            agent_of("ada"),
            "knowledge-propose",
            json!({
                "idempotency_key": "k-memory",
                "change": { "op": "update", "doc": "handbook/runbook", "baseHash": base, "content": UPDATED },
                "rationale": "From memory.",
                "evidence": [{ "kind": "memory", "ref": format!("{}@1", records::SOURCE_ID) }],
            }),
        )
        .await;
    assert!(
        matches!(
            code(&refused),
            "VALIDATION_ERROR" | "PROPOSAL_EVIDENCE_INVALID"
        ),
        "{refused}"
    );
    let listed = fx
        .as_actor(member(), "knowledge-proposal-list", json!({}))
        .await;
    assert_eq!(data(&listed)["count"], 0, "nothing stored: {listed}");

    // A drafted version 2 record, as step 3b's batch will store, reads with its drafter; a
    // record of a version this plugin does not read is reported as absent.
    let drafted = records::drafted(&Draft {
        candidate: "4a1b2c3d4e5f60718293",
        canary: "quokka",
        promoted_by: None,
        conflict_set: Some("0123456789abcdef0123"),
    });
    assert_valid("proposal.v2", &drafted);
    records::seed(&fx, &drafted);
    let shown = fx
        .as_actor(
            member(),
            "knowledge-proposal-show",
            json!({ "proposal": drafted["id"] }),
        )
        .await;
    let proposal = &data(&shown)["proposal"];
    assert_eq!(proposal["drafter"], drafted["drafter"], "{shown}");
    assert_eq!(proposal["conflictSet"], "k-0123456789abcdef0123");
    assert_eq!(proposal["evidence"], drafted["evidence"]);

    let mut future = records::drafted(&Draft {
        candidate: "ffffffffffffffffffff",
        canary: "quokka",
        promoted_by: None,
        conflict_set: None,
    });
    future["version"] = json!(4);
    future["id"] = json!("p-ffffffffffffffffffff");
    records::seed(&fx, &future);
    let shown = fx
        .as_actor(
            member(),
            "knowledge-proposal-show",
            json!({ "proposal": "p-ffffffffffffffffffff" }),
        )
        .await;
    assert_eq!(code(&shown), "PROPOSAL_NOT_FOUND", "{shown}");
}
