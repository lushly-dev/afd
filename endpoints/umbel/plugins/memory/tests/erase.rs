//! `memory-erase` (phase 5 specification, section 8.4, owner decision 9 and its two-person rule;
//! D85, D118; step 10), end to end in a hosted workspace with the kit over real sockets: a listed
//! eraser, verified on the person page for each call, erases another principal's records blind
//! (every access set, the legacy principal's too) after a dry run whose plan the erase presents.
//!
//! - One eraser: the dry run's count and plan, the page's preview of each, counts only, and after
//!   the erase nothing of the records in search, lists, counts, statistics or another reader's
//!   answers (byte for byte as before the records were written), their keys destroyed and their
//!   text in no file; the notice in the erased principal's own stream naming the eraser; the
//!   journal keeping ids and the plan, never text.
//! - Two erasers (`erase_approvals = 2`): the first erases nothing and records a request; the same
//!   person again (another client of theirs) is refused before anyone is asked; a second eraser,
//!   another person, erases, and the journal and the notice name both; the request is then gone.
//! - A changed plan and the window passing void the request; a plan gone stale, and a request
//!   expiring, between the decision and the run, erase nothing.
//! - A non-eraser, a space the eraser cannot read (5.4's one answer), the library, mode `none`.
//! - Over a gateway, through the person page's own listener.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod hosted_kit;
mod support;

use hosted_kit::{
    GatewayHosted, Hosted, accepted, agent_for, asked, asks, code, every_file, human, library,
    result,
};
use serde_json::{Value, json};
use umbel_store::MemoryStore;
use umbel_store_embedded::{SqliteMemoryStore, StoreOptions};

const ERASERS: &str = "erasers = [\"group:records-admins\"]";
/// Canaries in bo's records: none may survive the erase in any file.
const SHARED: &str = "shared-canary-4f1e rollbacks use the previous tag";
const PRIVATE: &str = "private-canary-8a2c rollbacks need a ticket";
const LEGACY: &str = "legacy-canary-61d7 rollbacks on weekends";

fn policy(approvals: u8) -> String {
    format!("{ERASERS}\nerase_approvals = {approvals}\nerase_approval_window_s = 600")
}

/// Bo's three records in `alpha`: shared with the space, private, and the legacy principal's.
async fn bos_records(host: &umbel::Host) -> Vec<String> {
    vec![
        hosted_kit::remember(
            host,
            agent_for("bo-bot", "bo"),
            "alpha",
            "Shared",
            SHARED,
            None,
        )
        .await,
        hosted_kit::remember(
            host,
            agent_for("bo-bot", "bo"),
            "alpha",
            "Private",
            PRIVATE,
            Some("private"),
        )
        .await,
        hosted_kit::remember(
            host,
            agent_for("old-bot", "bo").with_on_behalf_of("bo"),
            "alpha",
            "Legacy",
            LEGACY,
            Some("private"),
        )
        .await,
    ]
}

fn dry_run() -> Value {
    json!({ "space": "alpha", "principal": "human:corp/bo", "dryRun": true })
}

fn erase(plan: &str) -> Value {
    json!({ "space": "alpha", "principal": "human:corp/bo", "dryRun": false, "plan": plan })
}

fn approve(plan: &str, request: &str) -> Value {
    json!({ "space": "alpha", "principal": "human:corp/bo", "dryRun": false, "plan": plan,
            "request": request })
}

/// `input` as `subject`'s client `client`, decided on the page by `subject`: the final
/// `CommandResult` and the preview the person saw.
async fn decided(fx: &Hosted, subject: &str, client: &str, input: Value) -> (Value, String) {
    let (answer, page) = fx.decided(subject, client, "memory-erase", input).await;
    (result(&answer), page)
}

/// A dry run by `subject`: its plan, after checking the count.
async fn plan_of(fx: &Hosted, subject: &str, count: u64) -> String {
    let (planned, page) = decided(fx, subject, &format!("{subject}-client"), dry_run()).await;
    assert!(page.contains("A dry run"), "{page}");
    assert_eq!(planned["success"], true, "{planned}");
    assert_eq!(planned["data"]["count"], count, "{planned}");
    planned["data"]["plan"].as_str().unwrap().to_owned()
}

/// What `reader` reads of `alpha`'s memory through the library: a recall, a list and the status,
/// their data only.
async fn reads(host: &umbel::Host, reader: &str) -> Value {
    let recall = library(
        host,
        human(reader),
        "memory-recall",
        json!({ "space": "alpha", "query": "rollbacks" }),
    )
    .await;
    let list = library(
        host,
        human(reader),
        "memory-list",
        json!({ "space": "alpha" }),
    )
    .await;
    let status = library(
        host,
        human(reader),
        "memory-status",
        json!({ "space": "alpha" }),
    )
    .await;
    json!({ "recall": recall["data"], "list": list["data"], "status": status["data"] })
}

/// The memory store of `alpha`, opened as the operator would, for its keys and targets.
fn store(fx: &Hosted) -> SqliteMemoryStore {
    SqliteMemoryStore::open(
        &fx.dir().join("state/spaces/alpha"),
        "alpha",
        StoreOptions::default(),
    )
    .unwrap()
}

fn owners() -> Vec<String> {
    vec!["human:corp/bo".to_owned(), "human:bo".to_owned()]
}

#[tokio::test]
async fn one_eraser_erases_blind_after_a_dry_run_and_nothing_remains() {
    let fx = Hosted::start(&policy(1)).await;
    // Cy's own record, and what cy reads before bo writes anything.
    hosted_kit::remember(
        &fx.host,
        agent_for("cy-bot", "cy"),
        "alpha",
        "Cy",
        "cy's note on rollbacks and tags",
        None,
    )
    .await;
    let before = reads(&fx.host, "corp/cy").await;
    let ids = bos_records(&fx.host).await;
    assert_ne!(
        reads(&fx.host, "corp/cy").await,
        before,
        "cy reads bo's shared record"
    );
    // The dry run: every record bo owns (the legacy principal's included), whoever may read it.
    let plan = plan_of(&fx, "ada", 3).await;
    // The erase: the page shows the count and the plan; the answer is counts only.
    let (erased, page) = decided(&fx, "ada", "ada-client", erase(&plan)).await;
    assert!(
        page.contains("Erase 3 memory records of human:corp/bo"),
        "{page}"
    );
    assert!(page.contains(&plan), "{page}");
    assert_eq!(erased["success"], true, "{erased}");
    assert_eq!(erased["data"]["erased"], 3);
    assert_eq!(erased["data"]["status"], "erased");
    let text = erased.to_string();
    for id in &ids {
        assert!(
            !text.contains(id.as_str()),
            "the answer named a record: {text}"
        );
    }
    // Nothing remains to read: another reader's answers are byte for byte what they were before
    // bo wrote, and bo finds nothing.
    assert_eq!(reads(&fx.host, "corp/cy").await, before);
    let bos = reads(&fx.host, "corp/bo").await.to_string();
    for id in &ids {
        assert!(!bos.contains(id.as_str()), "bo still reads {id}: {bos}");
    }
    for id in &ids {
        let shown = library(
            &fx.host,
            human("corp/bo"),
            "memory-show",
            json!({ "id": id }),
        )
        .await;
        assert_eq!(shown["error"]["code"], "MEMORY_NOT_FOUND", "{shown}");
    }
    // The keys are gone and no file holds the text.
    let memory = store(&fx);
    assert!(memory.erase_targets(&owners(), None).unwrap().is_empty());
    let keys = memory.key_status().unwrap();
    assert_eq!(keys.unsettled, 0, "{keys:?}");
    assert!(keys.destroyed >= 3, "{keys:?}");
    for (path, bytes) in every_file(fx.dir()) {
        for canary in [
            "shared-canary-4f1e",
            "private-canary-8a2c",
            "legacy-canary-61d7",
        ] {
            assert!(
                !bytes.windows(canary.len()).any(|w| w == canary.as_bytes()),
                "{canary} survives in {}",
                path.display()
            );
        }
    }
    // The notice: one event in alpha's stream, for bo alone, naming the eraser and the count.
    let notices: Vec<Value> = hosted_kit::events(fx.dir(), "alpha")
        .into_iter()
        .filter(|event| event["command"] == "memory-erase")
        .collect();
    assert_eq!(notices.len(), 1, "{notices:?}");
    let notice = &notices[0]["provenance"];
    assert_eq!(notice["access"], json!(["principal:human:corp/bo"]));
    assert_eq!(notice["erasure"]["erasers"], json!(["human:corp/ada"]));
    assert_eq!(notice["erasure"]["count"], 3);
    assert_eq!(notice["erasure"]["request"], Value::Null);
    assert_eq!(notice["erasure"]["plan"], plan);
    let seen = |reader: &str| {
        let host = &fx.host;
        let reader = reader.to_owned();
        async move {
            let listed = library(
                host,
                human(&reader),
                "event-list",
                json!({ "space": "alpha" }),
            )
            .await;
            listed.to_string().contains("memory-erase")
        }
    };
    assert!(seen("corp/bo").await);
    assert!(!seen("corp/cy").await);
    // The journal keeps the kept input (ids and the plan), never text.
    let journaled = std::fs::read_to_string(fx.dir().join("state/journal.jsonl")).unwrap();
    assert!(!journaled.contains("canary"), "the journal kept text");
    let entries = fx.journal("memory-erase");
    assert_eq!(entries.len(), 2, "the dry run and the erase");
    assert_eq!(entries[1]["input"]["keep"]["plan"], plan);
    assert_eq!(entries[1]["input"]["keep"]["principal"], "human:corp/bo");
    assert_eq!(
        entries[1]["result"]["metadata"]["dev.umbel/authority"]["erasure"]["erasers"],
        json!(["human:corp/ada"])
    );
}

#[tokio::test]
async fn two_erasers_erase_only_together_and_the_same_person_never_twice() {
    let fx = Hosted::start(&policy(2)).await;
    let ids = bos_records(&fx.host).await;
    let plan = plan_of(&fx, "ada", 3).await;
    // Ada's erase records a request and erases nothing.
    let (first, page) = decided(&fx, "ada", "ada-client", erase(&plan)).await;
    assert!(page.contains("two erasers"), "{page}");
    assert_eq!(first["success"], true, "{first}");
    assert_eq!(first["data"]["status"], "awaiting-second-eraser");
    let request = first["data"]["request"].as_str().unwrap().to_owned();
    assert!(first["data"]["expiresAt"].is_string());
    assert_eq!(store(&fx).erase_targets(&owners(), None).unwrap().len(), 3);
    for id in &ids {
        let shown = library(
            &fx.host,
            human("corp/bo"),
            "memory-show",
            json!({ "id": id }),
        )
        .await;
        assert_eq!(shown["success"], true, "{shown}");
    }
    // Ada again, through another client of hers: refused before anyone is asked.
    let again = fx
        .call(
            "ada",
            "ada-laptop",
            "memory-erase",
            approve(&plan, &request),
            json!({}),
        )
        .await;
    assert!(!asks(&again), "{again}");
    assert_eq!(
        code(&again),
        "MEMORY_ERASE_SECOND_ERASER_REQUIRED",
        "{again}"
    );
    assert_eq!(
        result(&again)["error"]["details"]["request"],
        request,
        "{again}"
    );
    // Cy, another eraser, runs their own dry run (the same plan) and approves.
    assert_eq!(plan_of(&fx, "cy", 3).await, plan);
    let (second, page) = decided(&fx, "cy", "cy-client", approve(&plan, &request)).await;
    assert!(
        page.contains(&format!(
            "You approve erase request {request} of human:corp/ada"
        )),
        "{page}"
    );
    assert_eq!(second["success"], true, "{second}");
    assert_eq!(second["data"]["erased"], 3);
    assert_eq!(second["data"]["erasers"], 2);
    assert!(
        store(&fx)
            .erase_targets(&owners(), None)
            .unwrap()
            .is_empty()
    );
    // The notice and the journal name both.
    let notice = hosted_kit::events(fx.dir(), "alpha")
        .into_iter()
        .find(|event| event["command"] == "memory-erase")
        .unwrap();
    assert_eq!(
        notice["provenance"]["erasure"]["erasers"],
        json!(["human:corp/ada", "human:corp/cy"])
    );
    assert_eq!(notice["provenance"]["erasure"]["request"], request);
    let last = fx.journal("memory-erase").pop().unwrap();
    assert_eq!(last["input"]["keep"]["request"], request, "{last}");
    assert_eq!(last["input"]["keep"]["plan"], plan);
    assert_eq!(
        last["result"]["metadata"]["dev.umbel/authority"]["erasure"]["erasers"],
        json!(["human:corp/ada", "human:corp/cy"])
    );
    // The request ran: it is gone.
    let gone = fx
        .call(
            "cy",
            "cy-client",
            "memory-erase",
            approve(&plan, &request),
            json!({}),
        )
        .await;
    assert_eq!(code(&gone), "MEMORY_ERASE_REQUEST_EXPIRED", "{gone}");
    assert_eq!(result(&gone)["error"]["details"]["request"], request);
}

#[tokio::test]
async fn a_changed_plan_voids_the_request() {
    let fx = Hosted::start(&policy(2)).await;
    bos_records(&fx.host).await;
    let plan = plan_of(&fx, "ada", 3).await;
    let (first, _) = decided(&fx, "ada", "ada-client", erase(&plan)).await;
    let request = first["data"]["request"].as_str().unwrap().to_owned();
    // Bo writes another record: the plan no longer names bo's records.
    hosted_kit::remember(
        &fx.host,
        agent_for("bo-bot", "bo"),
        "alpha",
        "New",
        "a new note",
        None,
    )
    .await;
    let new_plan = plan_of(&fx, "cy", 4).await;
    assert_ne!(new_plan, plan);
    let stale = fx
        .call(
            "cy",
            "cy-client",
            "memory-erase",
            approve(&plan, &request),
            json!({}),
        )
        .await;
    assert!(!asks(&stale), "{stale}");
    assert_eq!(code(&stale), "MEMORY_ERASE_PLAN_STALE", "{stale}");
    // The request was voided with it: the new plan cannot ride on it.
    let voided = fx
        .call(
            "cy",
            "cy-client",
            "memory-erase",
            approve(&new_plan, &request),
            json!({}),
        )
        .await;
    assert_eq!(code(&voided), "MEMORY_ERASE_REQUEST_EXPIRED", "{voided}");
    assert_eq!(store(&fx).erase_targets(&owners(), None).unwrap().len(), 4);
}

#[tokio::test]
async fn the_window_passing_voids_the_request() {
    let fx = Hosted::start(&policy(2)).await;
    bos_records(&fx.host).await;
    let plan = plan_of(&fx, "ada", 3).await;
    let (first, _) = decided(&fx, "ada", "ada-client", erase(&plan)).await;
    let request = first["data"]["request"].as_str().unwrap().to_owned();
    // Exactly at the window's end it has expired.
    fx.advance(600_000).await;
    let expired = fx
        .call(
            "cy",
            "cy-client",
            "memory-erase",
            approve(&plan, &request),
            json!({}),
        )
        .await;
    assert!(!asks(&expired), "{expired}");
    assert_eq!(code(&expired), "MEMORY_ERASE_REQUEST_EXPIRED", "{expired}");
    assert_eq!(store(&fx).erase_targets(&owners(), None).unwrap().len(), 3);
}

#[tokio::test]
async fn a_request_expiring_between_the_decision_and_the_run_erases_nothing() {
    let fx = Hosted::start(&policy(2)).await;
    bos_records(&fx.host).await;
    let plan = plan_of(&fx, "ada", 3).await;
    let (first, _) = decided(&fx, "ada", "ada-client", erase(&plan)).await;
    let request = first["data"]["request"].as_str().unwrap().to_owned();
    fx.advance(500_000).await;
    // Cy begins while the request is pending, and approves on the page.
    let input = approve(&plan, &request);
    let begun = fx
        .call("cy", "cy-client", "memory-erase", input.clone(), json!({}))
        .await;
    let prompt = asked(&begun);
    let (_, reply) = fx.decide(&prompt.path(), "cy", "approve").await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    // The window ends before the retry (the decision itself lasts ten minutes from its begin).
    fx.advance(200_000).await;
    let run = fx
        .call(
            "cy",
            "cy-client",
            "memory-erase",
            input,
            accepted(&prompt.state),
        )
        .await;
    assert_eq!(code(&run), "MEMORY_ERASE_REQUEST_EXPIRED", "{run}");
    assert_eq!(store(&fx).erase_targets(&owners(), None).unwrap().len(), 3);
}

#[tokio::test]
async fn a_plan_gone_stale_between_the_decision_and_the_run_erases_nothing() {
    let fx = Hosted::start(&policy(1)).await;
    bos_records(&fx.host).await;
    let plan = plan_of(&fx, "ada", 3).await;
    let input = erase(&plan);
    let begun = fx
        .call(
            "ada",
            "ada-client",
            "memory-erase",
            input.clone(),
            json!({}),
        )
        .await;
    let prompt = asked(&begun);
    let (page, reply) = fx.decide(&prompt.path(), "ada", "approve").await;
    assert!(page.contains("Erase 3 memory records"), "{page}");
    assert_eq!(reply.status, 200, "{}", reply.text);
    // Bo's agent observes one of them again (a new version): the plan the person approved no
    // longer names the records.
    hosted_kit::remember(
        &fx.host,
        agent_for("bo-bot", "bo"),
        "alpha",
        "New",
        "written after the decision",
        None,
    )
    .await;
    let run = fx
        .call(
            "ada",
            "ada-client",
            "memory-erase",
            input,
            accepted(&prompt.state),
        )
        .await;
    assert_eq!(code(&run), "MEMORY_ERASE_PLAN_STALE", "{run}");
    assert_eq!(store(&fx).erase_targets(&owners(), None).unwrap().len(), 4);
}

#[tokio::test]
async fn a_non_eraser_is_refused_before_anyone_is_asked() {
    let fx = Hosted::start(&policy(1)).await;
    bos_records(&fx.host).await;
    for subject in ["bo", "ed"] {
        let answer = fx
            .call(
                subject,
                &format!("{subject}-client"),
                "memory-erase",
                dry_run(),
                json!({}),
            )
            .await;
        assert!(!asks(&answer), "{answer}");
        assert_eq!(code(&answer), "MEMORY_ERASE_NOT_ALLOWED", "{answer}");
    }
    assert!(fx.journal("person-decide").is_empty());
    // An eraser without the erase scope gets the 403 before dispatch, naming the scope.
    let bearer = format!(
        "Bearer {}",
        fx.token_with(
            "ada",
            "ada-client",
            &["umbel:read", "umbel:write", "umbel:approve"]
        )
    );
    let mut meta = umbel::testkit::mcp::modern_meta();
    meta["io.modelcontextprotocol/clientCapabilities"] = json!({ "elicitation": { "url": {} } });
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": { "name": "memory-erase", "arguments": dry_run(), "_meta": meta } });
    let reply = fx
        .client
        .send(fx.client.request(
            "POST",
            "/mcp",
            &[
                ("content-type", "application/json"),
                ("accept", "application/json, text/event-stream"),
                ("mcp-protocol-version", "2026-07-28"),
                ("mcp-method", "tools/call"),
                ("mcp-name", "memory-erase"),
                ("authorization", bearer.as_str()),
            ],
            body.to_string(),
        ))
        .await;
    assert_eq!(reply.status, 403, "{}", reply.text);
}

#[tokio::test]
async fn a_space_the_eraser_cannot_read_is_the_one_answer() {
    let fx = Hosted::start(&policy(1)).await;
    let hidden = fx
        .call(
            "ada",
            "ada-client",
            "memory-erase",
            json!({ "space": "beta", "principal": "human:corp/bo", "dryRun": true }),
            json!({}),
        )
        .await;
    let undeclared = fx
        .call(
            "ada",
            "ada-client",
            "memory-erase",
            json!({ "space": "gamma", "principal": "human:corp/bo", "dryRun": true }),
            json!({}),
        )
        .await;
    assert!(!asks(&hidden), "{hidden}");
    assert_eq!(code(&hidden), "SPACE_NOT_READABLE", "{hidden}");
    assert_eq!(result(&hidden), result(&undeclared));
}

#[tokio::test]
async fn the_library_and_a_terminal_never_erase() {
    let fx = Hosted::start(&policy(1)).await;
    bos_records(&fx.host).await;
    // An embedder's person, an eraser: no decision on the person page, no erase.
    let library_call = library(&fx.host, human("corp/ada"), "memory-erase", dry_run()).await;
    assert_ne!(library_call["success"], true, "{library_call}");
    let mut marked = fx
        .host
        .context(human("corp/ada"))
        .with_interface(afd::CommandInterface::Cli);
    marked
        .extra
        .insert("dev.umbel/human-present".to_owned(), json!("memory-erase"));
    marked.extra.insert(
        "dev.umbel/human-confirmed".to_owned(),
        json!("memory-erase"),
    );
    let marked = hosted_kit::run(&fx.host, marked, "memory-erase", dry_run()).await;
    assert_ne!(marked["success"], true, "{marked}");
    assert_eq!(store(&fx).erase_targets(&owners(), None).unwrap().len(), 3);
}

#[tokio::test]
async fn mode_none_serves_no_erase() {
    let fx = support::Fx::with(&support::config(""));
    let over_mcp = fx
        .agent(
            "memory-erase",
            json!({ "principal": "human:bo", "dryRun": true }),
        )
        .await;
    assert_ne!(over_mcp["success"], true, "{over_mcp}");
    let (at_terminal, _) = fx
        .terminal(
            "memory-erase",
            json!({ "principal": "human:bo", "dryRun": true }),
            true,
        )
        .await;
    assert_eq!(
        at_terminal["error"]["code"], "PERSON_VERIFICATION_UNAVAILABLE",
        "{at_terminal}"
    );
}

#[tokio::test]
async fn over_a_gateway_the_eraser_decides_on_the_page_listener() {
    let fx = GatewayHosted::start("\"phr\"", &policy(1)).await;
    bos_records(&fx.host).await;
    let first = fx.call("ada", "memory-erase", dry_run(), json!({})).await;
    let prompt = asked(&first);
    assert!(prompt.url.starts_with(&fx.origin), "{}", prompt.url);
    let logged = hosted_kit::login(
        &fx.kit,
        &fx.browser,
        &prompt.path(),
        &fx.origin,
        umbel_testkit_idp::ScriptedLogin::user("ada"),
    )
    .await;
    assert_eq!(logged.page.status, 200, "{}", logged.page.text);
    let reply = hosted_kit::post(&fx.browser, &prompt.path(), &logged, "approve", &fx.origin).await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    let planned = fx
        .call("ada", "memory-erase", dry_run(), accepted(&prompt.state))
        .await;
    assert_eq!(result(&planned)["data"]["count"], 3, "{planned}");
}
