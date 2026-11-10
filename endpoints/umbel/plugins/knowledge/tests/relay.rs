//! `knowledge-approve` and `knowledge-reject` over MCP through the approval relay (phase 5 step 6;
//! sections 7.3 and 7.4, owner decision 7, D116): end to end with the kit, a person decides on the
//! person page, after a fresh login with user verification, what the preview shows, and the
//! client's retry runs the decision once. Proposal version 3 records `decision.channel =
//! "mcp-elicitation"` and the `verified` assurance.
//!
//! Every check of a terminal decision holds: an area must set `approve_over_mcp`; the person must
//! be one of its approvers and read the target; self-approval is refused through the person's
//! legacy principal (section 4.6); a decision is bound to its command, its input and its caller,
//! spent once across processes, and expires; a hidden space or proposal answers as a missing one
//! (section 5.4); and in mode `gateway` only a phishing-resistant login decides (step 5b).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod relay_kit;
mod support;

use relay_kit::{
    GatewayRelay, ORIGIN, RUNBOOK, Relay, UPDATED, accepted, agent_for, asked, asks, decide,
    hash_of, human, library, login, post, proposal_id, propose_input, result, run, stored,
};
use serde_json::{Value, json};
use support::records::assert_valid;
use umbel_store::DocumentStore;
use umbel_testkit_idp::ScriptedLogin;

fn approve(id: &str) -> Value {
    json!({ "space": "alpha", "proposal": id })
}

fn approve_in(space: &str, id: &str) -> Value {
    json!({ "space": space, "proposal": id })
}

fn reject(id: &str, reason: &str) -> Value {
    json!({ "space": "alpha", "proposal": id, "reason": reason })
}

/// The error code of a call's result, which must be a refusal, never a prompt.
fn refused(answer: &Value) -> String {
    assert!(!asks(answer), "a person was asked: {answer}");
    let result = result(answer);
    assert_eq!(result["success"], false, "{answer}");
    result["error"]["code"].as_str().unwrap().to_owned()
}

/// The page's text, HTML-unescaped enough to search it for the preview's lines.
fn unescaped(page: &str) -> String {
    page.replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

// ── The flow ───────────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn a_person_approves_over_mcp_on_the_page_and_the_proposal_is_applied_once() {
    let r = Relay::start("").await;
    let id = r.propose("bo", "bo-agent", "k1").await;
    let first = r
        .call(
            "ada",
            "ada-agent",
            "knowledge-approve",
            approve(&id),
            json!({}),
        )
        .await;
    let prompt = asked(&first);
    // URL mode, a link holding no identity, and a message of ids alone (7.4).
    assert!(
        prompt.url.starts_with("https://127.0.0.1/mcp/d/"),
        "{}",
        prompt.url
    );
    assert_eq!(
        prompt.message,
        format!("Open the link to review knowledge-approve (proposal {id}) in alpha")
    );
    // Retried while pending: asked again with the same link; nothing applied.
    let again = asked(
        &r.call(
            "ada",
            "ada-agent",
            "knowledge-approve",
            approve(&id),
            accepted(&prompt.state),
        )
        .await,
    );
    assert_eq!(again.url, prompt.url);
    assert_eq!(r.file("alpha/handbook/runbook.md"), RUNBOOK);

    // The page shows the preview, rendered now as the person: the proposal, its change hash and
    // the diff of what will be written.
    let (logged, decided) = r.decide(&prompt.path(), "ada", "approve").await;
    let page = unescaped(&logged.page.text);
    let pending = stored(r.dir(), "alpha", &id).body;
    let change_hash = pending["changeHash"].as_str().unwrap();
    assert!(
        page.contains(&format!("Proposal {id} (version 3), pending")),
        "{page}"
    );
    assert!(
        page.contains(&format!("change hash: {change_hash}")),
        "{page}"
    );
    assert!(
        page.contains("| +Roll back with the previous release tag, then verify."),
        "{page}"
    );
    assert!(page.contains("<code>knowledge-approve</code>"), "{page}");
    assert_eq!(decided.status, 200, "{}", decided.text);
    assert!(decided.text.contains("You approved"), "{}", decided.text);

    let ran = result(
        &r.call(
            "ada",
            "ada-agent",
            "knowledge-approve",
            approve(&id),
            accepted(&again.state),
        )
        .await,
    );
    assert_eq!(ran["success"], true, "{ran}");
    assert_eq!(ran["data"]["applied"], true, "{ran}");
    // What was applied is what the page showed: the proposal's own content, by its hash.
    assert_eq!(r.file("alpha/handbook/runbook.md"), UPDATED);

    // Proposal version 3: the person decided over MCP, verified on the person page.
    let record = stored(r.dir(), "alpha", &id);
    let body = &record.body;
    assert_valid("proposal.v3", body);
    assert_eq!(body["version"], 3);
    assert_eq!(body["state"], "applied");
    assert_eq!(body["changeHash"], change_hash);
    let decision = &body["decision"];
    assert_eq!(decision["channel"], "mcp-elicitation", "{body}");
    assert_eq!(decision["by"], json!({ "kind": "human", "id": "corp/ada" }));
    assert_eq!(decision["principal"], "human:corp/ada");
    assert_eq!(decision["proposerKind"], "agent");
    assert_eq!(decision["assurance"]["level"], "verified", "{decision}");
    assert_eq!(decision["assurance"]["method"], "person-page");
    assert_eq!(decision["assurance"]["namespace"], "corp");
    assert_eq!(decision["assurance"]["acr"], "phr");
    assert!(
        decision["assurance"]["authTime"]
            .as_str()
            .unwrap()
            .ends_with('Z')
    );
    assert_eq!(body["exception"], Value::Null);
    assert_eq!(body["policy"]["rule"], "person");
    // The record's envelope is version 3, its chain the deciding client's, which the host
    // filled; the body's provenance keeps the proposing client's.
    assert_eq!(record.envelope.version, 3);
    assert_eq!(
        serde_json::to_value(&record.envelope.delegation_chain).unwrap(),
        json!([{ "kind": "agent", "id": "corp/ada-agent" }])
    );
    assert_eq!(
        body["provenance"]["delegationChain"],
        json!([{ "kind": "agent", "id": "corp/bo-agent" }])
    );
    assert_eq!(body["proposer"]["principal"], "human:corp/bo");

    // The decision is journaled by itself, and the approve keeps ids alone.
    let decisions = r.journal("person-decide");
    assert_eq!(decisions.len(), 1, "{decisions:?}");
    assert_eq!(decisions[0]["input"]["decision"], "approved");
    // The host's check before begin is journaled under the trace of the call that began the
    // decision (the person-decide entry's), not a trace of its own.
    let begun = decisions[0]["traceId"].as_str().unwrap();
    assert!(
        r.journal("knowledge-proposal-preview")
            .iter()
            .any(|entry| entry["traceId"] == begun),
        "no check under {begun}"
    );
    let approvals = r.journal("knowledge-approve");
    let succeeded: Vec<&Value> = approvals
        .iter()
        .filter(|entry| entry["result"]["success"] == true)
        .collect();
    assert_eq!(succeeded.len(), 1, "{approvals:?}");
    assert_eq!(succeeded[0]["input"]["keep"], approve(&id));
    assert_eq!(succeeded[0]["input"]["dev.umbel/journal"], "digest");
}

#[tokio::test]
async fn a_person_rejects_over_mcp_and_a_declined_rejection_changes_nothing() {
    let r = Relay::start("").await;
    let id = r.propose("bo", "bo-agent", "k1").await;
    let input = reject(&id, "The tag procedure did not change.");
    let prompt = asked(
        &r.call(
            "ada",
            "ada-agent",
            "knowledge-reject",
            input.clone(),
            json!({}),
        )
        .await,
    );
    assert_eq!(
        prompt.message,
        format!("Open the link to review knowledge-reject (proposal {id}) in alpha")
    );
    // Declined on the page: the call fails, the proposal stays pending.
    let (_, declined) = r.decide(&prompt.path(), "ada", "decline").await;
    assert_eq!(declined.status, 200, "{}", declined.text);
    assert_eq!(
        refused(
            &r.call(
                "ada",
                "ada-agent",
                "knowledge-reject",
                input.clone(),
                accepted(&prompt.state)
            )
            .await
        ),
        "CONFIRMATION_DECLINED"
    );
    assert_eq!(stored(r.dir(), "alpha", &id).body["state"], "pending");

    let prompt = asked(
        &r.call(
            "ada",
            "ada-agent",
            "knowledge-reject",
            input.clone(),
            json!({}),
        )
        .await,
    );
    let (logged, decided) = r.decide(&prompt.path(), "ada", "approve").await;
    // The person reads the reason they confirm, labelled as the client's words, before the
    // proposal (step 6).
    let page = unescaped(&logged.page.text);
    let labelled = page
        .find("Reason, as written by the requesting client")
        .unwrap_or_else(|| panic!("{page}"));
    let quoted = page
        .find("| The tag procedure did not change.")
        .unwrap_or_else(|| panic!("{page}"));
    let proposal = page.find(&format!("Proposal {id}")).unwrap();
    assert!(labelled < quoted && quoted < proposal, "{page}");
    assert_eq!(decided.status, 200, "{}", decided.text);
    let ran = result(
        &r.call(
            "ada",
            "ada-agent",
            "knowledge-reject",
            input,
            accepted(&prompt.state),
        )
        .await,
    );
    assert_eq!(ran["data"]["rejected"], true, "{ran}");
    let body = stored(r.dir(), "alpha", &id).body;
    assert_valid("proposal.v3", &body);
    assert_eq!(body["state"], "rejected");
    assert_eq!(body["decision"]["channel"], "mcp-elicitation");
    assert_eq!(body["decision"]["by"]["id"], "corp/ada");
    assert_eq!(
        body["decision"]["reason"],
        "The tag procedure did not change."
    );
    assert_eq!(body["decision"]["assurance"]["level"], "verified");
    // Recorded as the client's words, which the person confirmed, never as the person's own.
    assert_eq!(body["decision"]["reasonSource"], "client", "{body}");
    assert_eq!(r.file("alpha/handbook/runbook.md"), RUNBOOK);
    // The reason is never journaled: the decision held it for the page alone.
    let journal = std::fs::read_to_string(r.dir().join("state/journal.jsonl")).unwrap();
    assert!(!journal.contains("The tag procedure did not change."));

    // A reason the page could not show as written is refused before anyone is asked.
    let other = r.propose("bo", "bo-agent", "k2").await;
    let answer = r
        .call(
            "ada",
            "ada-agent",
            "knowledge-reject",
            reject(&other, "Bell \u{7} rings."),
            json!({}),
        )
        .await;
    assert_eq!(refused(&answer), "VALIDATION_ERROR");
}

// ── Refused before anyone is asked ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn an_area_without_approve_over_mcp_is_refused_before_anyone_is_asked() {
    let r = Relay::start("").await;
    let base = hash_of(r.host(), "corp/ada", "alpha", "notes/meeting").await;
    let notes = proposal_id(&result(
        &r.call(
            "bo",
            "bo-agent",
            "knowledge-propose",
            propose_input("alpha", "n1", "notes/meeting", &base, UPDATED),
            json!({}),
        )
        .await,
    ));
    for (tool, input) in [
        ("knowledge-approve", approve(&notes)),
        ("knowledge-reject", reject(&notes, "No.")),
    ] {
        let answer = r.call("ada", "ada-agent", tool, input, json!({})).await;
        assert_eq!(refused(&answer), "APPROVAL_RELAY_DISABLED", "{tool}");
        let error = &result(&answer)["error"];
        assert_eq!(error["details"]["area"], "notes", "{error}");
        assert_eq!(error["retryable"], false, "{error}");
    }
    // A person who is no approver of the area learns nothing of its opt-in: refused as such.
    let answer = r
        .call(
            "bo",
            "bo-agent",
            "knowledge-approve",
            approve(&notes),
            json!({}),
        )
        .await;
    assert_eq!(refused(&answer), "PROPOSAL_APPROVER_NOT_ALLOWED");
    // The same person in an area that opts in is asked.
    let handbook = r.propose("bo", "bo-agent", "h1").await;
    asked(
        &r.call(
            "ada",
            "ada-agent",
            "knowledge-approve",
            approve(&handbook),
            json!({}),
        )
        .await,
    );
    assert_eq!(stored(r.dir(), "alpha", &notes).body["state"], "pending");
}

#[tokio::test]
async fn self_approval_is_refused_through_the_person_and_their_legacy_principal() {
    let r = Relay::start("").await;
    // ada's own proposal, as their namespaced principal and as their legacy one.
    let own = r
        .propose_as(
            human("corp/ada"),
            "alpha",
            "handbook/runbook",
            "corp/ada",
            "own",
        )
        .await;
    let legacy = r
        .propose_as(
            human("ada"),
            "alpha",
            "handbook/runbook",
            "corp/ada",
            "legacy",
        )
        .await;
    for id in [&own, &legacy] {
        let answer = r
            .call(
                "ada",
                "ada-agent",
                "knowledge-approve",
                approve(id),
                json!({}),
            )
            .await;
        assert_eq!(refused(&answer), "PROPOSAL_SELF_APPROVAL", "{id}");
    }
    // Another approver is asked about the same proposals: the refusal is ada's alone.
    for id in [&own, &legacy] {
        asked(
            &r.call(
                "cy",
                "cy-agent",
                "knowledge-approve",
                approve(id),
                json!({}),
            )
            .await,
        );
    }
    // A person approving their own agent's proposal is not self-approval (D62): the approving
    // actor is the person, not the client.
    let agents = r.propose("ada", "ada-agent", "agents").await;
    let prompt = asked(
        &r.call(
            "ada",
            "ada-agent",
            "knowledge-approve",
            approve(&agents),
            json!({}),
        )
        .await,
    );
    let (_, decided) = r.decide(&prompt.path(), "ada", "approve").await;
    assert_eq!(decided.status, 200, "{}", decided.text);
    let ran = result(
        &r.call(
            "ada",
            "ada-agent",
            "knowledge-approve",
            approve(&agents),
            accepted(&prompt.state),
        )
        .await,
    );
    assert_eq!(ran["data"]["applied"], true, "{ran}");
    let body = stored(r.dir(), "alpha", &agents).body;
    assert_eq!(body["exception"], Value::Null);
    assert_eq!(body["decision"]["proposerKind"], "agent");
}

#[tokio::test]
async fn an_area_that_allows_self_approval_records_it_over_mcp_too() {
    let r = Relay::start("allow_self_approval = true").await;
    let legacy = r
        .propose_as(
            human("ada"),
            "alpha",
            "handbook/runbook",
            "corp/ada",
            "legacy",
        )
        .await;
    let prompt = asked(
        &r.call(
            "ada",
            "ada-agent",
            "knowledge-approve",
            approve(&legacy),
            json!({}),
        )
        .await,
    );
    r.decide(&prompt.path(), "ada", "approve").await;
    let ran = result(
        &r.call(
            "ada",
            "ada-agent",
            "knowledge-approve",
            approve(&legacy),
            accepted(&prompt.state),
        )
        .await,
    );
    assert_eq!(ran["data"]["applied"], true, "{ran}");
    let body = stored(r.dir(), "alpha", &legacy).body;
    assert_valid("proposal.v3", &body);
    assert_eq!(body["exception"], "self-approval");
    assert_eq!(body["decision"]["channel"], "mcp-elicitation");
}

#[tokio::test]
async fn a_person_who_is_not_an_approver_or_not_the_caller_decides_nothing() {
    let r = Relay::start("").await;
    let id = r.propose("bo", "bo-agent", "k1").await;
    // bo is no approver of the area: refused before anyone is asked.
    let answer = r
        .call(
            "bo",
            "bo-agent",
            "knowledge-approve",
            approve(&id),
            json!({}),
        )
        .await;
    assert_eq!(refused(&answer), "PROPOSAL_APPROVER_NOT_ALLOWED");

    // ada's link opened by bo: "another person", nothing decided.
    let prompt = asked(
        &r.call(
            "ada",
            "ada-agent",
            "knowledge-approve",
            approve(&id),
            json!({}),
        )
        .await,
    );
    let logged = login(
        &r.kit,
        &r.client,
        &prompt.path(),
        ORIGIN,
        ScriptedLogin::user("bo"),
    )
    .await;
    assert_eq!(logged.page.status, 403, "{}", logged.page.text);
    assert!(logged.form.is_none());
    let pending = asked(
        &r.call(
            "ada",
            "ada-agent",
            "knowledge-approve",
            approve(&id),
            accepted(&prompt.state),
        )
        .await,
    );
    assert_eq!(pending.url, prompt.url);

    // ada decides; cy (another approver), or ada through another client, cannot borrow the
    // decision: each is asked anew, for a decision of their own.
    let (_, decided) = r.decide(&prompt.path(), "ada", "approve").await;
    assert_eq!(decided.status, 200, "{}", decided.text);
    for (who, client) in [("cy", "cy-agent"), ("ada", "other-agent")] {
        let borrowed = asked(
            &r.call(
                who,
                client,
                "knowledge-approve",
                approve(&id),
                accepted(&prompt.state),
            )
            .await,
        );
        assert_ne!(borrowed.url, prompt.url, "{who} through {client}");
    }
    assert_eq!(r.file("alpha/handbook/runbook.md"), RUNBOOK);
    // The caller it was for runs it.
    let ran = result(
        &r.call(
            "ada",
            "ada-agent",
            "knowledge-approve",
            approve(&id),
            accepted(&prompt.state),
        )
        .await,
    );
    assert_eq!(ran["data"]["applied"], true, "{ran}");
}

#[tokio::test]
async fn a_client_without_url_elicitation_is_refused() {
    let r = Relay::start("").await;
    let id = r.propose("bo", "bo-agent", "k1").await;
    let answer = relay_kit::call(
        &r.client,
        &r.token("ada", "ada-agent"),
        "knowledge-approve",
        approve(&id),
        json!({}),
        false,
    )
    .await;
    assert_eq!(refused(&answer), "APPROVAL_REQUIRED");
    assert_eq!(
        result(&answer)["error"]["details"]["reason"],
        "url-elicitation-required"
    );
}

// ── Bound to its call, once, and not for long ──────────────────────────────────────────────────

#[tokio::test]
async fn a_decision_runs_only_its_own_input_once_across_processes() {
    let r = Relay::start("").await;
    let first = r.propose("bo", "bo-agent", "k1").await;
    let second = r.propose("bo", "bo-agent", "k2").await;
    let prompt = asked(
        &r.call(
            "ada",
            "ada-agent",
            "knowledge-approve",
            approve(&first),
            json!({}),
        )
        .await,
    );
    let (_, decided) = r.decide(&prompt.path(), "ada", "approve").await;
    assert_eq!(decided.status, 200, "{}", decided.text);
    // Another proposal under the decision's state: its digest is not the one decided, so the
    // relay begins again for it, and nothing runs.
    let other = asked(
        &r.call(
            "ada",
            "ada-agent",
            "knowledge-approve",
            approve(&second),
            accepted(&prompt.state),
        )
        .await,
    );
    assert_ne!(other.url, prompt.url);
    assert!(other.message.contains(&second));
    // Another command under it: the same.
    asked(
        &r.call(
            "ada",
            "ada-agent",
            "knowledge-reject",
            reject(&first, "No."),
            accepted(&prompt.state),
        )
        .await,
    );
    for id in [&first, &second] {
        assert_eq!(stored(r.dir(), "alpha", id).body["state"], "pending");
    }
    // The decided call runs once; replayed through a second process, nothing runs again (the
    // proposal is applied, so the relay's new begin is refused before anyone is asked).
    let ran = result(
        &r.call(
            "ada",
            "ada-agent",
            "knowledge-approve",
            approve(&first),
            accepted(&prompt.state),
        )
        .await,
    );
    assert_eq!(ran["data"]["applied"], true, "{ran}");
    let (_host, _served, client) = r.second().await;
    let replay = relay_kit::call(
        &client,
        &r.token("ada", "ada-agent"),
        "knowledge-approve",
        approve(&first),
        accepted(&prompt.state),
        true,
    )
    .await;
    assert_eq!(refused(&replay), "PROPOSAL_STATE_INVALID");
    let applied: Vec<Value> = r
        .journal("knowledge-approve")
        .into_iter()
        .filter(|entry| entry["result"]["success"] == true)
        .collect();
    assert_eq!(applied.len(), 1, "{applied:?}");
}

#[tokio::test]
async fn a_rejections_reason_is_bound_by_the_input_digest() {
    let r = Relay::start("").await;
    let id = r.propose("bo", "bo-agent", "k1").await;
    let prompt = asked(
        &r.call(
            "ada",
            "ada-agent",
            "knowledge-reject",
            reject(&id, "Superseded"),
            json!({}),
        )
        .await,
    );
    // A one-word reason is id-shaped, yet it is text the page shows (journal.show): never named
    // in the message.
    assert_eq!(
        prompt.message,
        format!("Open the link to review knowledge-reject (proposal {id}) in alpha")
    );
    r.decide(&prompt.path(), "ada", "approve").await;
    // Another reason than the one decided on: asked anew, nothing rejected.
    asked(
        &r.call(
            "ada",
            "ada-agent",
            "knowledge-reject",
            reject(&id, "Wrong"),
            accepted(&prompt.state),
        )
        .await,
    );
    assert_eq!(stored(r.dir(), "alpha", &id).body["state"], "pending");
    let ran = result(
        &r.call(
            "ada",
            "ada-agent",
            "knowledge-reject",
            reject(&id, "Superseded"),
            accepted(&prompt.state),
        )
        .await,
    );
    assert_eq!(ran["data"]["rejected"], true, "{ran}");
    assert_eq!(
        stored(r.dir(), "alpha", &id).body["decision"]["reason"],
        "Superseded"
    );
}

#[tokio::test]
async fn a_proposal_or_file_that_changed_after_the_decision_is_refused_and_nothing_is_written() {
    let r = Relay::start("").await;
    // Withdrawn by its proposer while the person decides.
    let withdrawn = r.propose("bo", "bo-agent", "k1").await;
    let prompt = asked(
        &r.call(
            "ada",
            "ada-agent",
            "knowledge-approve",
            approve(&withdrawn),
            json!({}),
        )
        .await,
    );
    let answer = result(
        &r.call(
            "bo",
            "bo-agent",
            "knowledge-withdraw",
            json!({ "space": "alpha", "proposal": withdrawn }),
            json!({}),
        )
        .await,
    );
    assert_eq!(answer["data"]["withdrawn"], true, "{answer}");
    r.decide(&prompt.path(), "ada", "approve").await;
    let ran = r
        .call(
            "ada",
            "ada-agent",
            "knowledge-approve",
            approve(&withdrawn),
            accepted(&prompt.state),
        )
        .await;
    assert_eq!(refused(&ran), "PROPOSAL_STATE_INVALID");
    assert_eq!(r.file("alpha/handbook/runbook.md"), RUNBOOK);

    // The file changed after the person decided: the apply compares hashes and writes nothing.
    let changed = r.propose("bo", "bo-agent", "k2").await;
    let prompt = asked(
        &r.call(
            "ada",
            "ada-agent",
            "knowledge-approve",
            approve(&changed),
            json!({}),
        )
        .await,
    );
    r.decide(&prompt.path(), "ada", "approve").await;
    let edited = format!("{RUNBOOK}Edited outside Umbel.\n");
    std::fs::write(r.dir().join("spaces/alpha/handbook/runbook.md"), &edited).unwrap();
    let ran = r
        .call(
            "ada",
            "ada-agent",
            "knowledge-approve",
            approve(&changed),
            accepted(&prompt.state),
        )
        .await;
    assert_eq!(refused(&ran), "PROPOSAL_CONFLICT");
    assert_eq!(r.file("alpha/handbook/runbook.md"), edited);
}

#[tokio::test]
async fn an_expired_decision_is_asked_again_and_an_approved_one_does_not_run_late() {
    let r = Relay::start("").await;
    let id = r.propose("bo", "bo-agent", "k1").await;
    let prompt = asked(
        &r.call(
            "ada",
            "ada-agent",
            "knowledge-approve",
            approve(&id),
            json!({}),
        )
        .await,
    );
    let (_, decided) = r.decide(&prompt.path(), "ada", "approve").await;
    assert_eq!(decided.status, 200, "{}", decided.text);
    r.clock.advance(601_000);
    r.host().check_person_logins().await;
    let late = asked(
        &r.call(
            "ada",
            "ada-agent",
            "knowledge-approve",
            approve(&id),
            accepted(&prompt.state),
        )
        .await,
    );
    assert_ne!(late.url, prompt.url);
    assert_eq!(r.client.get(&prompt.path(), &[]).await.status, 404);
    assert_eq!(stored(r.dir(), "alpha", &id).body["state"], "pending");
    assert_eq!(r.file("alpha/handbook/runbook.md"), RUNBOOK);
}

// ── One answer for what the caller may not read (5.4) ───────────────────────────────────────────

#[tokio::test]
async fn a_hidden_space_or_proposal_answers_as_a_missing_one() {
    let r = Relay::start("").await;
    // beta is bo's alone; ghost was never declared.
    let unreadable = r
        .call(
            "ada",
            "ada-agent",
            "knowledge-approve",
            json!({ "space": "beta", "proposal": "p-00000000000000000000" }),
            json!({}),
        )
        .await;
    let undeclared = r
        .call(
            "ada",
            "ada-agent",
            "knowledge-approve",
            json!({ "space": "ghost", "proposal": "p-00000000000000000000" }),
            json!({}),
        )
        .await;
    assert_eq!(refused(&unreadable), "SPACE_NOT_READABLE");
    assert_eq!(result(&unreadable)["error"], result(&undeclared)["error"]);
    assert!(!asks(&undeclared));

    // A proposal of bo's private collection, which ada may not read, answers as one that does
    // not exist.
    let private = r
        .propose_as(
            agent_for("bo-agent", "bo"),
            "alpha",
            "private/salaries",
            "corp/bo",
            "p1",
        )
        .await;
    let hidden = r
        .call(
            "ada",
            "ada-agent",
            "knowledge-approve",
            approve(&private),
            json!({}),
        )
        .await;
    let missing = r
        .call(
            "ada",
            "ada-agent",
            "knowledge-approve",
            approve("p-00000000000000000000"),
            json!({}),
        )
        .await;
    assert_eq!(refused(&hidden), "PROPOSAL_NOT_FOUND");
    assert_eq!(result(&hidden)["error"], result(&missing)["error"]);
    assert!(!asks(&missing));
    // An id of no proposal's shape, a URL say, names no proposal: refused before anyone is
    // asked, and never echoed in a message.
    let urlish = r
        .call(
            "ada",
            "ada-agent",
            "knowledge-approve",
            approve("https:evil.example/x"),
            json!({}),
        )
        .await;
    assert_eq!(result(&urlish)["error"], result(&missing)["error"]);
    assert!(!asks(&urlish));
}

// ── Older proposals ─────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn a_version_2_proposal_is_decided_only_at_a_terminal() {
    let r = Relay::start("").await;
    let base = hash_of(r.host(), "corp/ada", "alpha", "handbook/runbook").await;
    // A version 2 proposal phase 4 stored, read as before.
    let mut body = support::records::version_1("old-agent", "v2", &base, UPDATED);
    let id = support::records::proposal_id("alpha", "agent:old-agent", "v2");
    body["id"] = json!(id);
    body["space"] = json!("alpha");
    body["version"] = json!(2);
    for key in ["drafter", "conflictSet", "withdrawal", "redacted"] {
        body[key] = Value::Null;
    }
    body["provenance"]["version"] = json!(2);
    body["provenance"]["space"] = json!("alpha");
    for key in ["redactions", "constraints", "confirmation"] {
        body["provenance"][key] = Value::Null;
    }
    assert_valid("proposal.v2", &body);
    let mut envelope = umbel_store::Envelope::from_value(body["provenance"].clone()).unwrap();
    envelope.content_hash = Some(
        umbel_store::ContentHash::of(umbel_store::canonical_json(&body).as_bytes()).to_string(),
    );
    umbel_store_embedded::SqliteStore::open(
        &r.dir().join("state/spaces/alpha"),
        "alpha",
        umbel_store_embedded::StoreOptions::default(),
    )
    .unwrap()
    .put_record(
        "knowledge",
        "proposal",
        &id,
        body.clone(),
        envelope,
        umbel_store::Expect::Absent,
    )
    .unwrap();
    let answer = r
        .call(
            "ada",
            "ada-agent",
            "knowledge-approve",
            approve(&id),
            json!({}),
        )
        .await;
    assert_eq!(refused(&answer), "PROPOSAL_STATE_INVALID");
    assert_eq!(
        result(&answer)["error"]["details"]["reason"],
        "proposal-version"
    );
    assert!(
        result(&answer)["error"]["message"]
            .as_str()
            .unwrap()
            .contains("version 1 or 2"),
        "{answer}"
    );
    assert_eq!(stored(r.dir(), "alpha", &id).body["version"], 2);

    // A record stored under an id of no proposal's shape is no proposal to any command: the
    // shape is checked before the store is read.
    let odd = "P-0123456789ABCDEF012";
    let mut stray = body.clone();
    stray["id"] = json!(odd);
    let mut envelope = umbel_store::Envelope::from_value(stray["provenance"].clone()).unwrap();
    envelope.content_hash = Some(
        umbel_store::ContentHash::of(umbel_store::canonical_json(&stray).as_bytes()).to_string(),
    );
    umbel_store_embedded::SqliteStore::open(
        &r.dir().join("state/spaces/alpha"),
        "alpha",
        umbel_store_embedded::StoreOptions::default(),
    )
    .unwrap()
    .put_record(
        "knowledge",
        "proposal",
        odd,
        stray,
        envelope,
        umbel_store::Expect::Absent,
    )
    .unwrap();
    let (_host, _served, client) = r.second().await;
    let answer = relay_kit::call(
        &client,
        &r.token("ada", "ada-agent"),
        "knowledge-approve",
        approve(odd),
        json!({}),
        true,
    )
    .await;
    assert_eq!(refused(&answer), "PROPOSAL_NOT_FOUND");
}

// ── Mode gateway ────────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn through_a_gateway_the_person_decides_on_the_direct_listener_with_a_phishing_resistant_login()
 {
    let g = GatewayRelay::start("\"phr\"").await;
    let base = hash_of(&g.host, "corp/ada", "alpha", "handbook/runbook").await;
    let id = proposal_id(&result(
        &g.call(
            "bo",
            "knowledge-propose",
            propose_input("alpha", "k1", "handbook/runbook", &base, UPDATED),
            json!({}),
        )
        .await,
    ));
    let prompt = asked(
        &g.call("ada", "knowledge-approve", approve(&id), json!({}))
            .await,
    );
    // The link names the page's own origin, which the gateway never carries.
    assert!(
        prompt.url.starts_with(&format!("{}/d/", g.origin)),
        "{}",
        prompt.url
    );
    // A phishable login (`acr` `mfa`) is refused on the page in mode gateway: nothing decided.
    let phishable = login(
        &g.kit,
        &g.browser,
        &prompt.path(),
        &g.origin,
        ScriptedLogin::user("ada").acr(Some("mfa")),
    )
    .await;
    assert_eq!(phishable.page.status, 403, "{}", phishable.page.text);
    assert!(
        phishable
            .page
            .text
            .contains("PERSON_VERIFICATION_INSUFFICIENT"),
        "{}",
        phishable.page.text
    );
    asked(
        &g.call(
            "ada",
            "knowledge-approve",
            approve(&id),
            accepted(&prompt.state),
        )
        .await,
    );
    // A phishing-resistant one decides.
    let (_, decided) = decide(
        &g.kit,
        &g.browser,
        &prompt.path(),
        &g.origin,
        "ada",
        "approve",
    )
    .await;
    assert_eq!(decided.status, 200, "{}", decided.text);
    let ran = result(
        &g.call(
            "ada",
            "knowledge-approve",
            approve(&id),
            accepted(&prompt.state),
        )
        .await,
    );
    assert_eq!(ran["data"]["applied"], true, "{ran}");
    let body = stored(g.dir.path(), "alpha", &id).body;
    assert_valid("proposal.v3", &body);
    assert_eq!(body["decision"]["channel"], "mcp-elicitation");
    assert_eq!(body["decision"]["by"]["id"], "corp/ada");
    assert_eq!(body["decision"]["assurance"]["acr"], "phr");
    assert_eq!(body["decision"]["assurance"]["namespace"], "corp");
}

#[tokio::test]
async fn through_a_gateway_a_login_allowing_a_phishable_class_serves_no_relay() {
    let g = GatewayRelay::start("\"phr\", \"mfa\"").await;
    let base = hash_of(&g.host, "corp/ada", "alpha", "handbook/runbook").await;
    let id = r_propose_through(&g, &base).await;
    // The namespace's login fails auth.person in mode gateway, so its verified commands are names
    // that do not exist to its callers, and no person is asked.
    let answer = g
        .call("ada", "knowledge-approve", approve(&id), json!({}))
        .await;
    assert_eq!(refused(&answer), "COMMAND_NOT_FOUND");
    assert_eq!(stored(g.dir.path(), "alpha", &id).body["state"], "pending");
}

async fn r_propose_through(g: &GatewayRelay, base: &str) -> String {
    proposal_id(&result(
        &g.call(
            "bo",
            "knowledge-propose",
            propose_input("alpha", "k1", "handbook/runbook", base, UPDATED),
            json!({}),
        )
        .await,
    ))
}

// ── Mode none and the terminal ──────────────────────────────────────────────────────────────────

#[tokio::test]
async fn the_library_cannot_decide_and_the_preview_stays_off_mcp() {
    let r = Relay::start("").await;
    let id = r.propose("bo", "bo-agent", "k1").await;
    // An embedder's person through the library: no terminal and no person page, so nothing is
    // decided (the plugin gate refuses before the handler).
    let answer = run(
        r.host(),
        library(r.host(), human("corp/ada")),
        "knowledge-approve",
        approve(&id),
    )
    .await;
    assert_eq!(answer["success"], false, "{answer}");
    assert_eq!(answer["error"]["code"], "CONFIRMATION_REQUIRED", "{answer}");
    // The preview is the host's to run: not a tool.
    let preview = r
        .call(
            "ada",
            "ada-agent",
            "knowledge-proposal-preview",
            approve(&id),
            json!({}),
        )
        .await;
    assert_eq!(refused(&preview), "COMMAND_NOT_FOUND", "{preview}");
    // Posting the page's form without its login does nothing either.
    let prompt = asked(
        &r.call(
            "ada",
            "ada-agent",
            "knowledge-approve",
            approve(&id),
            json!({}),
        )
        .await,
    );
    let logged = login(
        &r.kit,
        &r.client,
        &prompt.path(),
        ORIGIN,
        ScriptedLogin::user("ada"),
    )
    .await;
    let forged = relay_kit::LoggedIn {
        opened: logged.opened,
        page: logged.page,
        form: Some(("a".repeat(26), "forged".to_owned())),
    };
    let reply = post(&r.client, &prompt.path(), &forged, "approve", ORIGIN).await;
    assert_eq!(reply.status, 403, "{}", reply.text);
    asked(
        &r.call(
            "ada",
            "ada-agent",
            "knowledge-approve",
            approve(&id),
            accepted(&prompt.state),
        )
        .await,
    );
}

// ── The doctor ──────────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn the_doctor_names_the_relays_areas_a_namespace_without_a_person_login_cannot_use() {
    let r = Relay::start("").await;
    let (status, message) =
        relay_kit::check(&relay_kit::doctor(r.dir(), &r.kit).await, "auth.person");
    assert_eq!(status, "pass", "{message}");
    // A second namespace whose token callers have no person login: they cannot approve or reject
    // over MCP in the areas that opt in, and the doctor says which.
    let text = std::fs::read_to_string(r.dir().join("umbel.toml")).unwrap();
    let text = text.replace(
        "[auth.issuers.as]",
        "[auth.namespaces.ext]\n\n[auth.issuers.ext]\nissuer = \"https://127.0.0.1:9/ext\"\nnamespace = \"ext\"\nalgorithms = [\"ES256\"]\n\n[auth.issuers.as]",
    );
    std::fs::write(r.dir().join("umbel.toml"), text).unwrap();
    let (status, message) =
        relay_kit::check(&relay_kit::doctor(r.dir(), &r.kit).await, "auth.person");
    assert_eq!(status, "warn", "{message}");
    assert!(
        message.contains(
            "namespace ext has token callers and no person login, so they cannot approve or reject over MCP in the approve_over_mcp areas plugins.knowledge.config.areas.beta, plugins.knowledge.config.areas.handbook, plugins.knowledge.config.areas.private"
        ),
        "{message}"
    );
    // The area that does not opt in is not named.
    assert!(!message.contains("areas.notes"), "{message}");
}

#[tokio::test]
async fn an_area_cannot_open_the_relay_without_listed_approvers() {
    // Over MCP approvers must be listed (7.3): an empty list, which admits any human at a
    // terminal, would admit every verified person who reads the target, so the configuration is
    // refused when the host loads the plugin.
    for approvers in ["approvers = []\n", ""] {
        let dir = tempfile::tempdir().unwrap();
        let rest = relay_kit::spaces_and_plugins("").replacen(
            "approvers = [\"group:kb-owners\"]\napprove_over_mcp = true\n",
            &format!("{approvers}approve_over_mcp = true\n"),
            1,
        );
        std::fs::write(
            dir.path().join("umbel.toml"),
            format!("config_version = 5\ndefault_space = \"alpha\"\n\n{rest}"),
        )
        .unwrap();
        relay_kit::write_files(dir.path());
        let sealed = umbel::HostBuilder::open(dir.path())
            .unwrap()
            .with_compiled(std::sync::Arc::new(umbel::plugins::sdk(
                umbel_plugin_sources_filesystem::plugin(),
            )))
            .with_compiled(std::sync::Arc::new(umbel::plugins::sdk(
                umbel_plugin_knowledge::plugin(),
            )))
            .seal();
        let error = sealed.err().expect("the configuration is refused");
        let text = error.to_string();
        assert!(text.contains("areas"), "{approvers:?}: {text}");
        assert!(text.contains("approvers"), "{approvers:?}: {text}");
    }
}

// ── Once, and only while the area still allows it ───────────────────────────────────────────────

#[tokio::test]
async fn a_spent_decision_never_runs_again_even_when_nothing_else_would_refuse_it() {
    let r = Relay::start("").await;
    let id = r.propose("bo", "bo-agent", "k1").await;
    let prompt = asked(
        &r.call(
            "ada",
            "ada-agent",
            "knowledge-approve",
            approve(&id),
            json!({}),
        )
        .await,
    );
    r.decide(&prompt.path(), "ada", "approve").await;
    // The run is spent, and refused by the apply's own check (the file changed), so the proposal
    // stays pending and nothing is written.
    let runbook = r.dir().join("spaces/alpha/handbook/runbook.md");
    std::fs::write(&runbook, format!("{RUNBOOK}Edited.\n")).unwrap();
    let first = r
        .call(
            "ada",
            "ada-agent",
            "knowledge-approve",
            approve(&id),
            accepted(&prompt.state),
        )
        .await;
    assert_eq!(refused(&first), "PROPOSAL_CONFLICT");
    // Put back as it was, every other check would pass now: only the spent decision refuses the
    // replay, through another process, which begins a new decision instead.
    std::fs::write(&runbook, RUNBOOK).unwrap();
    let (_host, _served, client) = r.second().await;
    let replay = relay_kit::call(
        &client,
        &r.token("ada", "ada-agent"),
        "knowledge-approve",
        approve(&id),
        accepted(&prompt.state),
        true,
    )
    .await;
    assert_ne!(asked(&replay).url, prompt.url);
    assert_eq!(stored(r.dir(), "alpha", &id).body["state"], "pending");
    assert_eq!(r.file("alpha/handbook/runbook.md"), RUNBOOK);
}

#[tokio::test]
async fn an_area_that_stops_relaying_or_an_approver_removed_after_the_decision_refuses_the_run() {
    let r = Relay::start("").await;
    let first = r.propose("bo", "bo-agent", "k1").await;
    let second = r.propose("bo", "bo-agent", "k2").await;
    let mut states = Vec::new();
    for id in [&first, &second] {
        let prompt = asked(
            &r.call(
                "ada",
                "ada-agent",
                "knowledge-approve",
                approve(id),
                json!({}),
            )
            .await,
        );
        r.decide(&prompt.path(), "ada", "approve").await;
        states.push(prompt.state);
    }
    // The handbook area no longer opts in (its table names approve_over_mcp first).
    let config = relay_kit::oauth_config(&r.kit, "");
    r.rewrite(&config.replacen("approve_over_mcp = true\n", "", 1));
    let (_host, _served, client) = r.second().await;
    let ran = relay_kit::call(
        &client,
        &r.token("ada", "ada-agent"),
        "knowledge-approve",
        approve(&first),
        accepted(&states[0]),
        true,
    )
    .await;
    assert_eq!(refused(&ran), "APPROVAL_RELAY_DISABLED");
    // It opts in again, but ada is no longer among its approvers.
    r.rewrite(&config.replacen(
        "approvers = [\"group:kb-owners\"]\napprove_over_mcp = true\n",
        "approvers = [\"principal:human:corp/cy\"]\napprove_over_mcp = true\n",
        1,
    ));
    let (_host, _served, client) = r.second().await;
    let ran = relay_kit::call(
        &client,
        &r.token("ada", "ada-agent"),
        "knowledge-approve",
        approve(&second),
        accepted(&states[1]),
        true,
    )
    .await;
    assert_eq!(refused(&ran), "PROPOSAL_APPROVER_NOT_ALLOWED");
    for id in [&first, &second] {
        assert_eq!(stored(r.dir(), "alpha", id).body["state"], "pending");
    }
    assert_eq!(r.file("alpha/handbook/runbook.md"), RUNBOOK);
}

// ── Drafts of memory (D102, D103) ───────────────────────────────────────────────────────────────

const ADA: &str = "human:ada";
const SUBJECT: &str = "Staging uses blue-green";

/// ada's shared memory facts `ns`, drafted by the stand-in curator; the drafts' proposal ids.
async fn drafts_of_adas_memory(r: &Relay, ns: &[u64]) -> Vec<String> {
    use support::memory as mem;
    mem::write(
        &r.fx,
        ns.iter()
            .map(|n| mem::entry(*n, ADA, &["space"], SUBJECT, &format!("Fact number {n}.")))
            .collect(),
    );
    let mut ids = Vec::new();
    for n in ns {
        let record = mem::record(&r.fx, &mem::id(*n));
        let (result, _) = support::drafter::submit(
            &r.fx,
            json!([mem::drafted(&[record], &mem::Place::default())]),
            None,
        )
        .await;
        let created = &result["data"]["results"][0];
        assert_eq!(created["ok"], true, "{result}");
        ids.push(created["proposal"]["id"].as_str().unwrap().to_owned());
    }
    ids
}

#[tokio::test]
async fn a_draft_of_the_persons_legacy_memory_is_self_approval_over_mcp() {
    let r = Relay::start_drafted().await;
    let ids = drafts_of_adas_memory(&r, &[1]).await;
    // ada's legacy principal wrote the source: approving it is ada's own (D102, 4.6), refused
    // before anyone is asked.
    let answer = r
        .call(
            "ada",
            "ada-agent",
            "knowledge-approve",
            approve_in("main", &ids[0]),
            json!({}),
        )
        .await;
    assert_eq!(refused(&answer), "PROPOSAL_SELF_APPROVAL");
    // Another approver is asked, and the draft is applied with no exception.
    let prompt = asked(
        &r.call(
            "cy",
            "cy-agent",
            "knowledge-approve",
            approve_in("main", &ids[0]),
            json!({}),
        )
        .await,
    );
    r.decide(&prompt.path(), "cy", "approve").await;
    let ran = result(
        &r.call(
            "cy",
            "cy-agent",
            "knowledge-approve",
            approve_in("main", &ids[0]),
            accepted(&prompt.state),
        )
        .await,
    );
    assert_eq!(ran["data"]["applied"], true, "{ran}");
    let body = stored(r.dir(), "main", &ids[0]).body;
    assert_valid("proposal.v3", &body);
    assert_eq!(body["exception"], Value::Null);
    assert_eq!(body["decision"]["by"]["id"], "corp/cy");
}

#[tokio::test]
async fn a_drafts_rechecks_at_the_run_refuse_what_changed_after_the_decision() {
    use support::memory as mem;
    let r = Relay::start_drafted().await;
    let ids = drafts_of_adas_memory(&r, &[1, 2]).await;
    let mut states = Vec::new();
    for id in &ids {
        let prompt = asked(
            &r.call(
                "cy",
                "cy-agent",
                "knowledge-approve",
                approve_in("main", id),
                json!({}),
            )
            .await,
        );
        r.decide(&prompt.path(), "cy", "approve").await;
        states.push(prompt.state);
    }
    let run = async |client: &relay_kit::Client, id: &str, state: &str| {
        relay_kit::call(
            client,
            &r.token("cy", "cy-agent"),
            "knowledge-approve",
            approve_in("main", id),
            accepted(state),
            true,
        )
        .await
    };
    // The first draft's source forgotten after the decision: gone at the run (D103).
    mem::forget(&r.fx, &mem::id(1), ADA);
    let (_host, _served, client) = r.second().await;
    assert_eq!(
        refused(&run(&client, &ids[0], &states[0]).await),
        "PROPOSAL_SOURCE_GONE"
    );
    // The target made less sensitive than the second draft's source: widened at the run.
    r.rewrite(&relay_kit::drafted_config(
        &r.kit,
        "sensitivity = \"public\"\n",
    ));
    let (_host, _served, client) = r.second().await;
    assert_eq!(
        refused(&run(&client, &ids[1], &states[1]).await),
        "PROPOSAL_ACCESS_WIDENED"
    );
    for id in &ids {
        assert_eq!(stored(r.dir(), "main", id).body["state"], "pending");
    }
}

#[tokio::test]
async fn the_check_before_a_decision_counts_under_the_hourly_limit() {
    let r = Relay::start("").await;
    let config = relay_kit::oauth_config(&r.kit, "");
    r.rewrite(&format!("{config}\n[limits]\nperson_pages_per_hour = 1\n"));
    let (_host, _served, client) = r.second().await;
    let base = hash_of(r.host(), "corp/ada", "alpha", "notes/meeting").await;
    let notes = proposal_id(&result(
        &r.call(
            "bo",
            "bo-agent",
            "knowledge-propose",
            propose_input("alpha", "n1", "notes/meeting", &base, UPDATED),
            json!({}),
        )
        .await,
    ));
    let token = r.token("ada", "ada-agent");
    let call = async |id: &str| {
        relay_kit::call(
            &client,
            &token,
            "knowledge-approve",
            approve(id),
            json!({}),
            true,
        )
        .await
    };
    // The first begin's check refuses it, and is counted; the second begin is over the limit
    // before its check runs.
    assert_eq!(refused(&call(&notes).await), "APPROVAL_RELAY_DISABLED");
    assert_eq!(refused(&call(&notes).await), "RATE_LIMITED");
}
