//! Proposals (specification section 9, decisions D62 and D17): the record as a decision trace,
//! areas and their approvers, idempotency, conflicts, who may decide (a person at a terminal,
//! who can read the target, and not the proposing actor unless the area allows it), the apply
//! sequence and its resume, CLI-only exposure, and the events.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::{Actor, ActorKind, CommandInterface};
use serde_json::{Value, json};
use support::*;

const RUNBOOK: &str = "---\ntitle: Rolling back\n# keep this comment\ntype: runbook\n---\n# Rolling back\n\nUse the previous tag.\n";
const UPDATED: &str = "---\ntitle: Rolling back\n# keep this comment\ntype: runbook\n---\n# Rolling back\n\nUse the previous release tag, then verify.\n";
const NEW_DOC: &str = "---\ntitle: Canary checks\ntype: runbook\n---\n# Canary checks\n\nWatch the canary for ten minutes.\n";

const AREA: &str = r#"
[plugins.knowledge.config.areas.handbook]
space = "main"
collection = "handbook"
"#;

/// The configuration with the CLI's person set to `local_id` and some areas.
fn config(local_id: &str, areas: &str) -> String {
    format!("{CONFIG}\n[principal]\nlocal_id = \"{local_id}\"\n{areas}")
}

/// A person's agent: `agent:<id>` acting for `human:<id>`.
fn agent_of(id: &str) -> Actor {
    Actor::new(ActorKind::Agent)
        .with_id(id)
        .with_on_behalf_of(id)
}

async fn fixture(local_id: &str, areas: &str) -> Fx {
    let fx = Fx::with(&config(local_id, areas));
    fx.handbook("runbook.md", RUNBOOK);
    fx.handbook(
        "secret.md",
        "---\ntitle: Secret\naccess: [group:platform]\n---\nSecret body.\n",
    );
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

fn update(base: &str) -> Value {
    json!({ "op": "update", "doc": "handbook/runbook", "baseHash": base, "content": UPDATED })
}

async fn propose(fx: &Fx, actor: Actor, key: &str, change: Value) -> Value {
    fx.as_actor(
        actor,
        "knowledge-propose",
        json!({
            "idempotency_key": key,
            "change": change,
            "rationale": "The procedure changed in October.",
            "evidence": [{ "kind": "text", "ref": "release notes" }],
            "confidence": 0.7,
            "run": "run-17",
        }),
    )
    .await
}

fn proposal_id(result: &Value) -> String {
    data(result)["proposal"]["id"].as_str().unwrap().to_owned()
}

async fn show(fx: &Fx, actor: Actor, id: &str) -> Value {
    fx.as_actor(actor, "knowledge-proposal-show", json!({ "proposal": id }))
        .await
}

async fn approve(fx: &Fx, id: &str) -> Value {
    fx.at_terminal("knowledge-approve", json!({ "proposal": id }))
        .await
}

fn file(fx: &Fx, relative: &str) -> String {
    std::fs::read_to_string(fx.path(&format!("spaces/main/handbook/{relative}"))).unwrap()
}

#[tokio::test]
async fn a_proposal_is_a_pending_decision_trace_that_changes_nothing() {
    let fx = fixture("ada", AREA).await;
    let base = hash_of(&fx, "handbook/runbook").await;
    let result = propose(&fx, agent_of("ada"), "run-17/step-2", update(&base)).await;
    assert_eq!(data(&result)["created"], true, "{result}");
    let id = proposal_id(&result);
    assert!(id.starts_with("p-") && id.len() == 22, "{id}");

    // Nothing changed: not the file, not the document.
    assert_eq!(file(&fx, "runbook.md"), RUNBOOK);
    assert_eq!(hash_of(&fx, "handbook/runbook").await, base);

    let shown = show(&fx, member(), &id).await;
    let proposal = &data(&shown)["proposal"];
    assert_eq!(proposal["state"], "pending");
    assert_eq!(proposal["area"], "handbook");
    assert_eq!(proposal["policy"]["rule"], "person");
    assert!(
        proposal["policy"]["version"]
            .as_str()
            .unwrap()
            .starts_with("sha256:")
    );
    assert_eq!(proposal["proposer"]["actor"]["kind"], "agent");
    assert_eq!(proposal["proposer"]["principal"], "human:ada");
    assert_eq!(proposal["proposer"]["run"], "run-17");
    assert_eq!(proposal["confidence"], 0.7);
    assert_eq!(proposal["exception"], Value::Null);
    assert_eq!(proposal["decision"], Value::Null);
    assert_eq!(proposal["result"], Value::Null);
    assert_eq!(proposal["provenance"]["origin"], "agent-inferred");
    let diff = proposal["diff"].as_str().unwrap();
    assert!(diff.contains("--- a/runbook.md"), "{diff}");
    assert!(
        diff.contains("+Use the previous release tag, then verify."),
        "{diff}"
    );
    // The diff holds the change; the stored content is not repeated.
    assert!(proposal["change"].get("content").is_none(), "{proposal}");
    assert_eq!(data(&shown)["trust"], "content");
    assert_eq!(shown["metadata"]["dev.umbel/trust"], "content");
}

#[tokio::test]
async fn every_op_is_accepted_and_shaped() {
    let fx = fixture("ada", AREA).await;
    let base = hash_of(&fx, "handbook/runbook").await;
    let create = propose(
        &fx,
        agent_of("ada"),
        "k-create",
        json!({ "op": "create", "doc": "handbook/canary", "content": NEW_DOC }),
    )
    .await;
    assert_eq!(data(&create)["proposal"]["op"], "create", "{create}");
    let id = proposal_id(&create);
    let shown = show(&fx, member(), &id).await;
    assert!(
        data(&shown)["proposal"]["diff"]
            .as_str()
            .unwrap()
            .contains("--- /dev/null")
    );
    assert_eq!(data(&shown)["proposal"]["change"]["baseHash"], Value::Null);

    let deprecate = propose(
        &fx,
        agent_of("ada"),
        "k-deprecate",
        json!({ "op": "deprecate", "doc": "handbook/runbook", "baseHash": base, "supersededBy": "handbook/canary" }),
    )
    .await;
    let shown = show(&fx, member(), &proposal_id(&deprecate)).await;
    let diff = data(&shown)["proposal"]["diff"].as_str().unwrap();
    assert!(diff.contains("+status: \"deprecated\""), "{diff}");
    assert!(
        diff.contains("+superseded_by: \"handbook/canary\""),
        "{diff}"
    );

    let verify = propose(
        &fx,
        agent_of("ada"),
        "k-verify",
        json!({ "op": "verify", "doc": "handbook/runbook", "baseHash": base, "verification": { "note": "checked", "staleAfter": "2027-01-01T00:00:00Z" } }),
    )
    .await;
    let shown = show(&fx, member(), &proposal_id(&verify)).await;
    let diff = data(&shown)["proposal"]["diff"].as_str().unwrap();
    assert!(diff.contains("+verified:"), "{diff}");
    assert!(
        diff.contains("+stale_after: \"2027-01-01T00:00:00Z\""),
        "{diff}"
    );
}

#[tokio::test]
async fn the_same_key_and_change_returns_the_proposal_and_another_change_is_refused() {
    let fx = fixture("ada", AREA).await;
    let base = hash_of(&fx, "handbook/runbook").await;
    let first = propose(&fx, agent_of("ada"), "run-17/step-2", update(&base)).await;
    let id = proposal_id(&first);
    let again = propose(&fx, agent_of("ada"), "run-17/step-2", update(&base)).await;
    assert_eq!(data(&again)["created"], false, "{again}");
    assert_eq!(proposal_id(&again), id);
    // A retry wrote nothing: no event for it carries a record revision.
    assert!(
        again["metadata"].get("dev.umbel/record").is_none(),
        "{again}"
    );

    let other = propose(
        &fx,
        agent_of("ada"),
        "run-17/step-2",
        json!({ "op": "update", "doc": "handbook/runbook", "baseHash": base, "content": NEW_DOC }),
    )
    .await;
    assert_eq!(code(&other), "PROPOSAL_KEY_REUSED", "{other}");
    // The first proposal is untouched.
    let shown = show(&fx, member(), &id).await;
    assert!(
        data(&shown)["proposal"]["diff"]
            .as_str()
            .unwrap()
            .contains("verify")
    );
    // Another actor with the same key is another proposal.
    let theirs = propose(&fx, agent("bo"), "run-17/step-2", update(&base)).await;
    assert_ne!(proposal_id(&theirs), id);
}

#[tokio::test]
async fn conflicts_and_missing_areas_are_refused_at_submission() {
    let fx = fixture("ada", AREA).await;
    let stale = format!("sha256:{}", "0".repeat(64));
    let wrong = propose(&fx, agent_of("ada"), "k1", update(&stale)).await;
    assert_eq!(code(&wrong), "PROPOSAL_CONFLICT", "{wrong}");
    let exists = propose(
        &fx,
        agent_of("ada"),
        "k2",
        json!({ "op": "create", "doc": "handbook/runbook", "content": NEW_DOC }),
    )
    .await;
    assert_eq!(code(&exists), "PROPOSAL_CONFLICT");
    let missing = propose(
        &fx,
        agent_of("ada"),
        "k3",
        json!({ "op": "update", "doc": "handbook/nope", "baseHash": stale, "content": NEW_DOC }),
    )
    .await;
    assert_eq!(code(&missing), "DOCUMENT_NOT_FOUND");
    // beta has no area.
    let no_area = fx
        .as_actor(
            agent_of("ada"),
            "knowledge-propose",
            json!({
                "space": "beta",
                "idempotency_key": "k4",
                "change": { "op": "create", "doc": "notes/a", "content": NEW_DOC },
                "rationale": "r",
                "evidence": [{ "kind": "text", "ref": "x" }],
            }),
        )
        .await;
    assert_eq!(code(&no_area), "PROPOSAL_NO_AREA", "{no_area}");
    // Content must read, ids must be valid, reserved files are refused.
    let unreadable = propose(
        &fx,
        agent_of("ada"),
        "k5",
        json!({ "op": "create", "doc": "handbook/bad", "content": "---\n- a\n---\n" }),
    )
    .await;
    assert_eq!(code(&unreadable), "FRONTMATTER_INVALID", "{unreadable}");
    for (n, doc) in [
        "handbook/../x",
        "handbook/.hidden",
        "handbook/index",
        "handbook/a/log",
    ]
    .iter()
    .enumerate()
    {
        let refused = propose(
            &fx,
            agent_of("ada"),
            &format!("bad-{n}"),
            json!({ "op": "create", "doc": doc, "content": NEW_DOC }),
        )
        .await;
        assert_eq!(code(&refused), "PROPOSAL_INVALID", "{doc}: {refused}");
    }
}

#[tokio::test]
async fn the_most_specific_area_governs() {
    let areas = format!(
        "{AREA}\n[plugins.knowledge.config.areas.deploy]\nspace = \"main\"\ncollection = \"handbook\"\nprefix = \"deploy/\"\napprovers = [\"principal:human:bo\"]\n"
    );
    let fx = fixture("ada", &areas).await;
    let result = propose(
        &fx,
        agent_of("ada"),
        "k1",
        json!({ "op": "create", "doc": "handbook/deploy/canary", "content": NEW_DOC }),
    )
    .await;
    assert_eq!(data(&result)["proposal"]["area"], "deploy", "{result}");
    let other = propose(
        &fx,
        agent_of("ada"),
        "k2",
        json!({ "op": "create", "doc": "handbook/canary", "content": NEW_DOC }),
    )
    .await;
    assert_eq!(data(&other)["proposal"]["area"], "handbook");
}

#[tokio::test]
async fn approving_applies_the_file_and_the_document_with_the_proposal_as_lineage() {
    let fx = fixture("ada", AREA).await;
    let base = hash_of(&fx, "handbook/runbook").await;
    let result = propose(&fx, agent_of("ada"), "k1", update(&base)).await;
    let id = proposal_id(&result);

    let approved = approve(&fx, &id).await;
    let report = data(&approved);
    assert_eq!(report["applied"], true, "{approved}");
    assert_eq!(report["indexed"], false);
    assert_eq!(report["nextStep"], "knowledge-refresh");
    assert_eq!(file(&fx, "runbook.md"), UPDATED);

    // The document: the new bytes, the proposal as lineage, the proposer's confidence.
    let described = fx
        .as_actor(
            member(),
            "knowledge-describe",
            json!({ "doc": "handbook/runbook" }),
        )
        .await;
    let stored = data(&described);
    assert_eq!(
        stored["contentHash"], report["document"]["contentHash"],
        "{described}"
    );
    let envelope = &stored["envelope"];
    assert_eq!(envelope["origin"], "agent-inferred", "{described}");
    assert_eq!(envelope["confidence"], 0.7);
    assert_eq!(envelope["derivedFrom"][0]["kind"], "proposal");
    assert_eq!(envelope["derivedFrom"][0]["id"], id.as_str());
    assert!(
        envelope["derivedFrom"][0]["contentHash"]
            .as_str()
            .unwrap()
            .starts_with("sha256:")
    );

    // The record: applied, with who decided and the result.
    let shown = show(&fx, member(), &id).await;
    let proposal = &data(&shown)["proposal"];
    assert_eq!(proposal["state"], "applied");
    assert_eq!(proposal["decision"]["principal"], "human:ada");
    assert_eq!(proposal["decision"]["by"]["kind"], "human");
    assert_eq!(proposal["decision"]["proposerKind"], "agent");
    assert_eq!(proposal["exception"], Value::Null);
    assert_eq!(proposal["result"]["path"], "runbook.md");
    assert_eq!(
        proposal["result"]["contentHash"],
        report["document"]["contentHash"]
    );

    // Search reports the index is behind until the next refresh.
    let stale = fx.search(member(), json!({ "query": "verify" })).await;
    assert!(warning(&stale, "INDEX_STALE").is_some(), "{stale}");
    fx.refresh("main").await;
    let found = fx.search(member(), json!({ "query": "verify" })).await;
    assert_eq!(hit_ids(&found), ["handbook/runbook"], "{found}");
    assert!(warning(&found, "INDEX_STALE").is_none());
}

#[tokio::test]
async fn a_created_document_gets_the_collections_access_and_a_human_proposal_is_user_stated() {
    let fx = fixture("ada", AREA).await;
    let result = propose(
        &fx,
        human("bo"),
        "k1",
        json!({ "op": "create", "doc": "handbook/canary", "content": NEW_DOC }),
    )
    .await;
    let id = proposal_id(&result);
    let approved = approve(&fx, &id).await;
    assert_eq!(data(&approved)["applied"], true, "{approved}");
    assert_eq!(file(&fx, "canary.md"), NEW_DOC);
    let described = fx
        .as_actor(
            member(),
            "knowledge-describe",
            json!({ "doc": "handbook/canary" }),
        )
        .await;
    assert_eq!(
        data(&described)["envelope"]["origin"],
        "user-stated",
        "{described}"
    );
}

#[tokio::test]
async fn approval_is_refused_when_the_file_changed_since_the_proposal() {
    let fx = fixture("ada", AREA).await;
    let base = hash_of(&fx, "handbook/runbook").await;
    let id = proposal_id(&propose(&fx, agent_of("ada"), "k1", update(&base)).await);
    fx.handbook(
        "runbook.md",
        "---\ntitle: Edited elsewhere\n---\nChanged under us.\n",
    );
    let refused = approve(&fx, &id).await;
    assert_eq!(code(&refused), "PROPOSAL_CONFLICT", "{refused}");
    // Nothing changed: the proposal is still pending and the file is the other writer's.
    let shown = show(&fx, member(), &id).await;
    assert_eq!(data(&shown)["proposal"]["state"], "pending");
    assert!(file(&fx, "runbook.md").contains("Changed under us"));
}

#[tokio::test]
async fn self_approval_is_refused_only_for_the_same_actor_where_the_area_forbids_it() {
    let fx = fixture("ada", AREA).await;
    let base = hash_of(&fx, "handbook/runbook").await;
    // The CLI person is human:ada; a proposal from human:ada is the same actor.
    let own = propose(&fx, human("ada"), "k1", update(&base)).await;
    let id = proposal_id(&own);
    let refused = approve(&fx, &id).await;
    assert_eq!(code(&refused), "PROPOSAL_SELF_APPROVAL", "{refused}");
    assert_eq!(file(&fx, "runbook.md"), RUNBOOK);

    let allowed = format!("{AREA}allow_self_approval = true\n");
    let fx = fixture("ada", &allowed).await;
    let base = hash_of(&fx, "handbook/runbook").await;
    let id = proposal_id(&propose(&fx, human("ada"), "k1", update(&base)).await);
    let approved = approve(&fx, &id).await;
    assert_eq!(data(&approved)["applied"], true, "{approved}");
    let shown = show(&fx, member(), &id).await;
    assert_eq!(data(&shown)["proposal"]["exception"], "self-approval");
}

#[tokio::test]
async fn a_person_may_approve_their_own_agents_proposal() {
    let fx = fixture("ada", AREA).await;
    let base = hash_of(&fx, "handbook/runbook").await;
    // agent:ada acting for human:ada proposes; the CLI person human:ada approves.
    let id = proposal_id(&propose(&fx, agent_of("ada"), "k1", update(&base)).await);
    let approved = approve(&fx, &id).await;
    assert_eq!(data(&approved)["applied"], true, "{approved}");
    let shown = show(&fx, member(), &id).await;
    let proposal = &data(&shown)["proposal"];
    assert_eq!(proposal["exception"], Value::Null);
    assert_eq!(proposal["proposer"]["actor"]["kind"], "agent");
    assert_eq!(proposal["proposer"]["principal"], "human:ada");
    assert_eq!(proposal["decision"]["by"]["kind"], "human");
    assert_eq!(proposal["decision"]["proposerKind"], "agent");
}

#[tokio::test]
async fn only_listed_approvers_decide() {
    let areas = r#"
[plugins.knowledge.config.areas.handbook]
space = "main"
collection = "handbook"
approvers = ["group:platform", "principal:human:bo"]
"#;
    // human:ada is in the group platform (CONFIG); human:cy is nobody.
    let fx = fixture("cy", areas).await;
    let base = hash_of(&fx, "handbook/runbook").await;
    let id = proposal_id(&propose(&fx, agent("x"), "k1", update(&base)).await);
    let refused = approve(&fx, &id).await;
    assert_eq!(code(&refused), "PROPOSAL_APPROVER_NOT_ALLOWED", "{refused}");
    assert_eq!(file(&fx, "runbook.md"), RUNBOOK);

    for person in ["ada", "bo"] {
        let fx = fixture(person, areas).await;
        let base = hash_of(&fx, "handbook/runbook").await;
        let id = proposal_id(&propose(&fx, agent("x"), "k1", update(&base)).await);
        let approved = approve(&fx, &id).await;
        assert_eq!(data(&approved)["applied"], true, "{person}: {approved}");
    }
}

#[tokio::test]
async fn an_approver_who_cannot_read_the_target_gets_not_found_and_sees_nothing() {
    // human:cy cannot read secret.md (group platform only), so the proposal for it is not theirs
    // to read, show or decide: one answer for "absent" and "not yours".
    let fx = fixture("cy", AREA).await;
    let secret = fx
        .as_actor(
            member(),
            "knowledge-list",
            json!({ "prefix": "handbook/secret" }),
        )
        .await;
    let base = data(&secret)["documents"][0]["contentHash"]
        .as_str()
        .unwrap()
        .to_owned();
    let result = propose(
        &fx,
        agent_of("ada"),
        "k1",
        json!({ "op": "update", "doc": "handbook/secret", "baseHash": base, "content": "---\ntitle: Secret\naccess: [group:platform]\n---\nNew secret body xylophone.\n" }),
    )
    .await;
    let id = proposal_id(&result);

    let approved = approve(&fx, &id).await;
    assert_eq!(code(&approved), "PROPOSAL_NOT_FOUND", "{approved}");
    never_mentions(&approved, &["xylophone", "Secret"]);
    let shown = show(&fx, human("cy"), &id).await;
    assert_eq!(code(&shown), "PROPOSAL_NOT_FOUND");
    let listed = fx
        .as_actor(human("cy"), "knowledge-proposal-list", json!({}))
        .await;
    assert_eq!(data(&listed)["count"], 0, "{listed}");
    // The outsider cannot propose against it either.
    let theirs = propose(
        &fx,
        human("cy"),
        "k2",
        json!({ "op": "update", "doc": "handbook/secret", "baseHash": base, "content": "---\ntitle: x\n---\n" }),
    )
    .await;
    assert_eq!(code(&theirs), "DOCUMENT_NOT_FOUND");
    // A member sees and lists it.
    let listed = fx
        .as_actor(member(), "knowledge-proposal-list", json!({}))
        .await;
    assert_eq!(data(&listed)["count"], 1);
    // Its events carry the target's access set, so the outsider's event-list skips them.
    let outsider_events = fx.as_actor(human("cy"), "event-list", json!({})).await;
    never_mentions(&outsider_events, &["knowledge-propose"]);
    let member_events = fx.as_actor(member(), "event-list", json!({})).await;
    assert!(member_events.to_string().contains("knowledge-propose"));
}

#[tokio::test]
async fn an_approve_that_stopped_part_way_resumes_and_skips_what_is_done() {
    // `documents_write` is not allowed at first: the file is written and the decision recorded,
    // then the document step is refused.
    let without = CONFIG.replace(
        "[plugins.knowledge.grants.documents_write]\nallow = [\"main/*\", \"beta/*\"]\n",
        "",
    );
    assert_ne!(without, CONFIG);
    let areas = format!("\n[principal]\nlocal_id = \"ada\"\n{AREA}");
    let mut fx = Fx::with(&format!("{without}{areas}"));
    fx.handbook("runbook.md", RUNBOOK);
    fx.refresh("main").await;
    let base = hash_of(&fx, "handbook/runbook").await;
    let id = proposal_id(&propose(&fx, agent_of("ada"), "k1", update(&base)).await);
    let stopped = approve(&fx, &id).await;
    assert_eq!(code(&stopped), "PROPOSAL_APPLY_UNAVAILABLE", "{stopped}");
    assert_eq!(file(&fx, "runbook.md"), UPDATED, "the file step ran");
    let shown = show(&fx, member(), &id).await;
    assert_eq!(data(&shown)["proposal"]["state"], "approved");

    // Allow the grant and run it again: the file is not written twice, the document and the
    // `applied` state follow.
    fx.reopen(&format!("{CONFIG}{areas}"));
    let resumed = approve(&fx, &id).await;
    assert_eq!(data(&resumed)["applied"], true, "{resumed}");
    assert_eq!(file(&fx, "runbook.md"), UPDATED);
    let shown = show(&fx, member(), &id).await;
    assert_eq!(data(&shown)["proposal"]["state"], "applied");
    // The decision is the first one.
    assert_eq!(
        data(&shown)["proposal"]["decision"]["principal"],
        "human:ada"
    );
}

#[tokio::test]
async fn a_file_written_before_the_decision_is_recognised_and_not_written_again() {
    let fx = fixture("ada", AREA).await;
    let base = hash_of(&fx, "handbook/runbook").await;
    let id = proposal_id(&propose(&fx, agent_of("ada"), "k1", update(&base)).await);
    // As if a crash left the file written but nothing recorded.
    fx.handbook("runbook.md", UPDATED);
    let approved = approve(&fx, &id).await;
    assert_eq!(data(&approved)["applied"], true, "{approved}");
    assert_eq!(file(&fx, "runbook.md"), UPDATED);
}

#[tokio::test]
async fn reject_needs_a_reason_and_a_pending_proposal() {
    let fx = fixture("ada", AREA).await;
    let base = hash_of(&fx, "handbook/runbook").await;
    let id = proposal_id(&propose(&fx, agent("x"), "k1", update(&base)).await);
    let blank = fx
        .at_terminal(
            "knowledge-reject",
            json!({ "proposal": id, "reason": "   " }),
        )
        .await;
    assert_eq!(code(&blank), "PROPOSAL_REASON_REQUIRED", "{blank}");
    let rejected = fx
        .at_terminal(
            "knowledge-reject",
            json!({ "proposal": id, "reason": "The tag name is wrong." }),
        )
        .await;
    assert_eq!(data(&rejected)["rejected"], true, "{rejected}");
    let shown = show(&fx, member(), &id).await;
    let proposal = &data(&shown)["proposal"];
    assert_eq!(proposal["state"], "rejected");
    assert_eq!(proposal["decision"]["reason"], "The tag name is wrong.");
    assert_eq!(proposal["decision"]["principal"], "human:ada");
    assert_eq!(file(&fx, "runbook.md"), RUNBOOK);
    let again = fx
        .at_terminal(
            "knowledge-reject",
            json!({ "proposal": id, "reason": "again" }),
        )
        .await;
    assert_eq!(code(&again), "PROPOSAL_STATE_INVALID");
    let approve_it = approve(&fx, &id).await;
    assert_eq!(code(&approve_it), "PROPOSAL_STATE_INVALID");
}

#[tokio::test]
async fn only_the_proposer_withdraws_and_only_while_pending() {
    let fx = fixture("ada", AREA).await;
    let base = hash_of(&fx, "handbook/runbook").await;
    let id = proposal_id(&propose(&fx, agent("x"), "k1", update(&base)).await);
    let other = fx
        .as_actor(agent("y"), "knowledge-withdraw", json!({ "proposal": id }))
        .await;
    assert_eq!(code(&other), "PROPOSAL_NOT_PROPOSER", "{other}");
    let withdrawn = fx
        .as_actor(agent("x"), "knowledge-withdraw", json!({ "proposal": id }))
        .await;
    assert_eq!(data(&withdrawn)["withdrawn"], true, "{withdrawn}");
    let shown = show(&fx, member(), &id).await;
    assert_eq!(data(&shown)["proposal"]["state"], "withdrawn");
    let again = fx
        .as_actor(agent("x"), "knowledge-withdraw", json!({ "proposal": id }))
        .await;
    assert_eq!(code(&again), "PROPOSAL_STATE_INVALID");
    // A withdrawn proposal is retried by key and stays withdrawn.
    let retry = propose(&fx, agent("x"), "k1", update(&base)).await;
    assert_eq!(data(&retry)["created"], false);
    assert_eq!(data(&retry)["proposal"]["state"], "withdrawn");
}

#[tokio::test]
async fn approve_reject_and_verify_are_cli_only_and_need_a_terminal_that_answers() {
    let fx = fixture("ada", AREA).await;
    let base = hash_of(&fx, "handbook/runbook").await;
    let id = proposal_id(&propose(&fx, agent("x"), "k1", update(&base)).await);

    // Over MCP and to an in-process agent the command is not exposed; through the library, or as
    // a batch, it has no terminal answer behind it: refused before the handler.
    for command in ["knowledge-approve", "knowledge-reject", "knowledge-verify"] {
        let input = match command {
            "knowledge-verify" => json!({ "doc": "handbook/runbook" }),
            "knowledge-reject" => json!({ "proposal": id, "reason": "no" }),
            _ => json!({ "proposal": id }),
        };
        for interface in [CommandInterface::Mcp, CommandInterface::Agent] {
            let refused = json_of(
                fx.call(human("ada"), interface, command, input.clone())
                    .await,
            );
            assert_eq!(
                code(&refused),
                "COMMAND_NOT_EXPOSED",
                "{command}: {refused}"
            );
        }
        let library = json_of(
            fx.call(human("ada"), CommandInterface::Cli, command, input)
                .await,
        );
        assert_eq!(
            code(&library),
            "CONFIRMATION_REQUIRED",
            "{command}: {library}"
        );
    }
    assert_eq!(file(&fx, "runbook.md"), RUNBOOK);

    // On the command line: `--yes` and `--approve` are refused even at a terminal, and so is a
    // call with no terminal.
    let input = json!({ "proposal": id }).to_string();
    for flag in ["--yes", "--approve"] {
        let console = Terminal::new(true, true);
        let (_, value) = fx
            .command_line(
                console.clone(),
                &["call", "knowledge-approve", &input, flag],
            )
            .await;
        assert_eq!(code(&value), "CONFIRMATION_REQUIRED", "{flag}: {value}");
        assert!(console.asked().is_empty(), "{flag} must not even ask");
    }
    let (_, value) = fx
        .command_line(
            Terminal::new(false, false),
            &["call", "knowledge-approve", &input],
        )
        .await;
    assert_eq!(code(&value), "CONFIRMATION_REQUIRED", "{value}");
    // A terminal that says no declines.
    let (_, value) = fx
        .command_line(
            Terminal::new(true, false),
            &["call", "knowledge-approve", &input],
        )
        .await;
    assert_ne!(value["success"], true, "{value}");
    assert_eq!(file(&fx, "runbook.md"), RUNBOOK);
    let shown = show(&fx, member(), &id).await;
    assert_eq!(data(&shown)["proposal"]["state"], "pending");
}

#[tokio::test]
async fn every_state_change_is_journaled_and_evented_with_the_targets_access() {
    let fx = fixture("ada", AREA).await;
    let base = hash_of(&fx, "handbook/runbook").await;
    let first = proposal_id(&propose(&fx, agent("x"), "k1", update(&base)).await);
    let second = proposal_id(
        &propose(
            &fx,
            agent("x"),
            "k2",
            json!({ "op": "create", "doc": "handbook/canary", "content": NEW_DOC }),
        )
        .await,
    );
    fx.as_actor(
        agent("x"),
        "knowledge-withdraw",
        json!({ "proposal": second }),
    )
    .await;
    approve(&fx, &first).await;
    let events = fx.cli("event-list", json!({})).await;
    let list = data(&events)["events"].as_array().unwrap().clone();
    let commands: Vec<&str> = list.iter().filter_map(|e| e["command"].as_str()).collect();
    for wanted in [
        "knowledge-propose",
        "knowledge-withdraw",
        "knowledge-approve",
    ] {
        assert!(commands.contains(&wanted), "{wanted} in {commands:?}");
    }
    let approve_event = list
        .iter()
        .find(|e| e["command"] == "knowledge-approve")
        .unwrap();
    assert_eq!(approve_event["version"], 1, "{approve_event}");
    assert_eq!(approve_event["record"]["kind"], "proposal");
    assert_eq!(approve_event["record"]["id"], first.as_str());
    assert_eq!(
        approve_event["provenance"]["access"],
        json!(["space"]),
        "{approve_event}"
    );
    assert_eq!(approve_event["provenance"]["principal"], "human:ada");
    assert_eq!(
        approve_event["provenance"]["sources"][0]["resource"],
        "/handbook/runbook"
    );
    assert!(
        approve_event["provenance"]["contentHash"]
            .as_str()
            .unwrap()
            .starts_with("sha256:")
    );
}
