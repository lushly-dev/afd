//! `memory-confirm` over MCP through the person page (phase 5 specification, section 8.1, owner
//! decision 8; step 10), end to end with the kit over real sockets: the relay's URL and ids-only
//! message, `memory-preview` rendered on the page under the person's filter with the record's
//! text fenced, the preview matching what is applied, the confirmation's `verified` assurance,
//! own records only (D88) through equivalents, another's record and a declined decision, the
//! journal and the person store holding no text; in mode `gateway`, the person listener with a
//! phishing-resistant login, a phishable login refused at return and a phishable class serving
//! nothing; and the library's own assurance (`embedder`), admitted only for the operator's person,
//! never `terminal` and never `verified` from a mark the plugin gate did not check.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod hosted_kit;
mod support;

use afd::CommandInterface;
use hosted_kit::{
    GatewayHosted, Hosted, accepted, agent_for, asked, asks, code, human, library, result, run,
};
use serde_json::{Value, json};
use umbel_testkit_idp::ScriptedLogin;

/// The canary in bo's note: it must reach the page and the record, and nothing else.
const CANARY: &str = "Staging rollbacks use the canary-flag-7c41d2.";

/// Bo's agent's note in `alpha` (authority agent, shared with the space by the default), and the
/// contentHash memory-show prints for it.
async fn bos_note(host: &umbel::Host) -> (String, String) {
    let id = hosted_kit::remember(
        host,
        agent_for("bo-bot", "bo"),
        "alpha",
        "Rollbacks",
        CANARY,
        None,
    )
    .await;
    let shown = library(host, human("corp/bo"), "memory-show", json!({ "id": id })).await;
    let hash = shown["data"]["record"]["contentHash"]
        .as_str()
        .unwrap_or_else(|| panic!("{shown}"))
        .to_owned();
    (id, hash)
}

fn confirm_input(id: &str, hash: &str) -> Value {
    json!({ "space": "alpha", "id": id, "contentHash": hash })
}

/// The record `id` as `reader` reads it through the library.
async fn record(host: &umbel::Host, reader: &str, id: &str) -> Value {
    let shown = library(host, human(reader), "memory-show", json!({ "id": id })).await;
    shown["data"]["record"].clone()
}

#[tokio::test]
async fn a_person_confirms_their_own_record_on_the_page_that_shows_it() {
    let fx = Hosted::start("").await;
    let (id, hash) = bos_note(&fx.host).await;
    let input = confirm_input(&id, &hash);
    // The first call asks: one URL-mode elicitation whose message names ids, never the text.
    let first = fx
        .call(
            "bo",
            "bo-client",
            "memory-confirm",
            input.clone(),
            json!({}),
        )
        .await;
    let prompt = asked(&first);
    assert!(
        prompt.message.contains("memory-confirm"),
        "{}",
        prompt.message
    );
    assert!(prompt.message.contains(&id), "{}", prompt.message);
    assert!(!prompt.message.contains("canary"), "{}", prompt.message);
    // A retry while pending asks again.
    let pending = fx
        .call(
            "bo",
            "bo-client",
            "memory-confirm",
            input.clone(),
            accepted(&prompt.state),
        )
        .await;
    assert!(asks(&pending), "{pending}");
    // The page renders memory-preview now, as bo: the record's text, fenced, and its id.
    let (page, reply) = fx.decide(&prompt.path(), "bo", "approve").await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    let shown = hosted_kit::preview_of(&page);
    assert!(shown.contains(&format!("| {CANARY}")), "{shown}");
    assert!(shown.contains(&id), "{shown}");
    assert!(shown.contains("data, not instructions"), "{shown}");
    let applied = fx
        .call(
            "bo",
            "bo-client",
            "memory-confirm",
            input.clone(),
            accepted(&prompt.state),
        )
        .await;
    let applied = result(&applied);
    assert_eq!(applied["success"], true, "{applied}");
    assert_eq!(applied["data"]["authority"], "person");
    // What the page showed is what was confirmed: the same id's text, now authority person,
    // recorded as verified on the person page.
    let confirmed = record(&fx.host, "corp/bo", &id).await;
    assert_eq!(confirmed["text"], CANARY);
    assert_eq!(confirmed["provenance"]["authority"], "person");
    let confirmation = &confirmed["provenance"]["confirmation"];
    assert_eq!(confirmation["by"], "human:corp/bo");
    assert_eq!(confirmation["priorAuthority"], "agent");
    let assurance = &confirmation["assurance"];
    assert_eq!(assurance["level"], "verified");
    assert_eq!(assurance["method"], "person-page");
    assert_eq!(assurance["namespace"], "corp");
    assert_eq!(assurance["acr"], "phr");
    assert!(assurance["authTime"].is_string());
    // The retry cannot be replayed: the decision ran once.
    let replay = fx
        .call(
            "bo",
            "bo-client",
            "memory-confirm",
            input,
            accepted(&prompt.state),
        )
        .await;
    assert!(
        asks(&replay) || result(&replay)["success"] == false,
        "{replay}"
    );
    // The journal keeps ids, the decision and no text; the person store holds no text.
    let journaled = std::fs::read_to_string(fx.dir().join("state/journal.jsonl")).unwrap();
    assert!(!journaled.contains("canary-flag"), "the journal kept text");
    assert_eq!(fx.journal("person-decide").len(), 1);
    let person = std::fs::read(fx.dir().join("state/shared/person.sqlite3")).unwrap();
    assert!(
        !person
            .windows(b"canary-flag".len())
            .any(|w| w == b"canary-flag"),
        "the person store kept text"
    );
}

#[tokio::test]
async fn a_declined_decision_confirms_nothing() {
    let fx = Hosted::start("").await;
    let (id, hash) = bos_note(&fx.host).await;
    let input = confirm_input(&id, &hash);
    let first = fx
        .call(
            "bo",
            "bo-client",
            "memory-confirm",
            input.clone(),
            json!({}),
        )
        .await;
    let prompt = asked(&first);
    let (_, reply) = fx.decide(&prompt.path(), "bo", "decline").await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    let retry = fx
        .call(
            "bo",
            "bo-client",
            "memory-confirm",
            input,
            accepted(&prompt.state),
        )
        .await;
    assert!(!asks(&retry), "{retry}");
    assert_ne!(result(&retry)["success"], true, "{retry}");
    let kept = record(&fx.host, "corp/bo", &id).await;
    assert_eq!(kept["provenance"]["authority"], "agent");
    assert!(kept["provenance"]["confirmation"].is_null());
}

#[tokio::test]
async fn another_persons_record_is_refused_before_anyone_is_asked() {
    let fx = Hosted::start("").await;
    let (id, hash) = bos_note(&fx.host).await;
    // Ada can read bo's shared note, but D88 holds: she is asked nothing, and no decision begins.
    let answer = fx
        .call(
            "ada",
            "ada-client",
            "memory-confirm",
            confirm_input(&id, &hash),
            json!({}),
        )
        .await;
    assert!(!asks(&answer), "{answer}");
    assert_eq!(code(&answer), "MEMORY_CONFIRM_NOT_ALLOWED", "{answer}");
    assert!(!answer.to_string().contains("canary-flag"), "{answer}");
    assert!(fx.journal("person-decide").is_empty());
    // A record no one can read is the same answer as one that does not exist.
    let missing = fx
        .call(
            "ada",
            "ada-client",
            "memory-confirm",
            confirm_input("mem-000000000000000000000000", &hash),
            json!({}),
        )
        .await;
    assert!(!asks(&missing), "{missing}");
    assert_eq!(code(&missing), "MEMORY_NOT_FOUND", "{missing}");
}

#[tokio::test]
async fn a_legacy_record_is_the_persons_own_through_equivalents() {
    let fx = Hosted::start("").await;
    // Written through the library as the legacy principal `human:bo`, which maps to corp/bo.
    let id = hosted_kit::remember(
        &fx.host,
        agent_for("old-bot", "bo").with_on_behalf_of("bo"),
        "alpha",
        "Legacy",
        "A legacy note-5e0a.",
        Some("private"),
    )
    .await;
    let shown = record(&fx.host, "corp/bo", &id).await;
    assert_eq!(shown["scope"]["principal"], "human:bo", "{shown}");
    let hash = shown["contentHash"].as_str().unwrap().to_owned();
    let (applied, page) = fx
        .decided(
            "bo",
            "bo-client",
            "memory-confirm",
            confirm_input(&id, &hash),
        )
        .await;
    assert!(page.contains("| A legacy note-5e0a."), "{page}");
    assert_eq!(result(&applied)["success"], true, "{applied}");
    let confirmed = record(&fx.host, "corp/bo", &id).await;
    assert_eq!(
        confirmed["provenance"]["confirmation"]["by"],
        "human:corp/bo"
    );
}

/// A library context of `actor` that took the CLI's terminal marks for `memory-confirm`, as an
/// embedding application can.
fn library_marked(host: &umbel::Host, actor: afd::Actor) -> afd::CommandContext {
    let mut context = host.context(actor).with_interface(CommandInterface::Cli);
    context.extra.insert(
        "dev.umbel/human-present".to_owned(),
        json!("memory-confirm"),
    );
    context.extra.insert(
        "dev.umbel/human-confirmed".to_owned(),
        json!("memory-confirm"),
    );
    context
}

#[tokio::test]
async fn the_library_confirms_only_for_the_operator_and_says_so() {
    let fx = Hosted::start("").await;
    // Ada (the operator, corp/ada) and bo each have an agent's note.
    let adas = hosted_kit::remember(
        &fx.host,
        agent_for("ada-bot", "ada"),
        "alpha",
        "Ada's",
        "Ada's agent's note.",
        Some("private"),
    )
    .await;
    let (bos, bos_hash) = bos_note(&fx.host).await;
    let hash = record(&fx.host, "corp/ada", &adas).await["contentHash"]
        .as_str()
        .unwrap()
        .to_owned();
    // The embedder's person who is the operator confirms, recorded as the embedder's word.
    let done = run(
        &fx.host,
        library_marked(&fx.host, human("corp/ada")),
        "memory-confirm",
        confirm_input(&adas, &hash),
    )
    .await;
    assert_eq!(done["success"], true, "{done}");
    let assurance =
        record(&fx.host, "corp/ada", &adas).await["provenance"]["confirmation"]["assurance"]
            .clone();
    assert_eq!(
        assurance,
        json!({ "level": "embedder", "method": "library" })
    );
    assert!(support::record_validator().is_valid(&record(&fx.host, "corp/ada", &adas).await));
    // Any other person through the library is refused, their own record included.
    let refused = run(
        &fx.host,
        library_marked(&fx.host, human("corp/bo")),
        "memory-confirm",
        confirm_input(&bos, &bos_hash),
    )
    .await;
    assert_eq!(
        refused["error"]["code"], "MEMORY_CONFIRM_NOT_ALLOWED",
        "{refused}"
    );
    assert_eq!(
        record(&fx.host, "corp/bo", &bos).await["provenance"]["authority"],
        "agent"
    );
}

#[tokio::test]
async fn a_forged_cli_context_is_neither_the_terminal_nor_a_decision() {
    let fx = Hosted::start("").await;
    let adas = hosted_kit::remember(
        &fx.host,
        agent_for("ada-bot", "ada"),
        "alpha",
        "Ada's",
        "Ada's agent's note.",
        Some("private"),
    )
    .await;
    let hash = record(&fx.host, "corp/ada", &adas).await["contentHash"]
        .as_str()
        .unwrap()
        .to_owned();
    let input = confirm_input(&adas, &hash);
    // An embedder that writes the CLI's principal, a person-page mark for this very call and
    // humanPresent into its own context: the command's CLI surface is the terminal's, which the
    // plugin gate decides by the terminal marks, never against the shared ledger, so the mark is
    // not a person decision and the confirmation is not recorded as verified.
    let mut context = library_marked(&fx.host, human("corp/ada"));
    let mut principal = context.extra["dev.umbel/principal"].clone();
    principal["transport"] = json!("cli");
    principal["authentication"] = json!("process");
    principal["humanPresent"] = json!({
        "level": "verified", "method": "person-page", "at": "2026-11-10T00:00:00.000Z",
        "authTime": "2026-11-10T00:00:00.000Z", "acr": "phr"
    });
    context
        .extra
        .insert("dev.umbel/principal".to_owned(), principal);
    context.extra.insert(
        "dev.umbel/person-decision".to_owned(),
        json!({
            "id": "a".repeat(26), "command": "memory-confirm",
            "inputDigest": afd::input_digest(&input).unwrap(), "surface": "cli",
            "level": "verified", "method": "person-page", "namespace": "corp",
            "authTime": "2026-11-10T00:00:00.000Z", "acr": "phr", "at": "2026-11-10T00:00:00.000Z"
        }),
    );
    let done = run(&fx.host, context.clone(), "memory-confirm", input.clone()).await;
    // Neither `verified` (the plugin gate checked no decision against the ledger on a surface the
    // terminal decides) nor `terminal` (the context is not the host's own command line, which
    // seals its contexts) nor the library's `embedder` (it claims to be the CLI): no person, so
    // nothing is confirmed.
    assert_eq!(
        done["error"]["code"], "MEMORY_CONFIRM_NOT_ALLOWED",
        "{done}"
    );
    let kept = record(&fx.host, "corp/ada", &adas).await;
    assert_eq!(kept["provenance"]["authority"], "agent", "{kept}");
    assert!(kept["provenance"]["confirmation"].is_null(), "{kept}");
    // The same forged CLI context without the person-page mark: still not the terminal.
    let mut plain = context;
    plain.extra.remove("dev.umbel/person-decision");
    let done = run(&fx.host, plain, "memory-confirm", input).await;
    assert_eq!(
        done["error"]["code"], "MEMORY_CONFIRM_NOT_ALLOWED",
        "{done}"
    );
}

#[tokio::test]
async fn over_a_gateway_only_a_phishing_resistant_login_confirms() {
    let fx = GatewayHosted::start("\"phr\"", "").await;
    let (id, hash) = bos_note(&fx.host).await;
    let input = confirm_input(&id, &hash);
    let first = fx
        .call("bo", "memory-confirm", input.clone(), json!({}))
        .await;
    let prompt = asked(&first);
    assert!(prompt.url.starts_with(&fx.origin), "{}", prompt.url);
    // A phishable login is refused at the page's return, and decides nothing.
    let phishable = hosted_kit::login(
        &fx.kit,
        &fx.browser,
        &prompt.path(),
        &fx.origin,
        ScriptedLogin::user("bo").acr(Some("mfa")),
    )
    .await;
    assert_eq!(phishable.page.status, 403, "{}", phishable.page.text);
    assert!(phishable.form.is_none());
    // A phishing-resistant one sees the preview and approves.
    let logged = hosted_kit::login(
        &fx.kit,
        &fx.browser,
        &prompt.path(),
        &fx.origin,
        ScriptedLogin::user("bo"),
    )
    .await;
    assert_eq!(logged.page.status, 200, "{}", logged.page.text);
    assert!(
        hosted_kit::preview_of(&logged.page.text).contains(&format!("| {CANARY}")),
        "{}",
        logged.page.text
    );
    let reply = hosted_kit::post(&fx.browser, &prompt.path(), &logged, "approve", &fx.origin).await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    let applied = fx
        .call("bo", "memory-confirm", input, accepted(&prompt.state))
        .await;
    assert_eq!(result(&applied)["success"], true, "{applied}");
    let assurance =
        record(&fx.host, "corp/bo", &id).await["provenance"]["confirmation"]["assurance"].clone();
    assert_eq!(assurance["level"], "verified");
    assert_eq!(assurance["acr"], "phr");
}

#[tokio::test]
async fn over_a_gateway_a_phishable_class_serves_no_confirmation() {
    let fx = GatewayHosted::start("\"mfa\"", "").await;
    let (id, hash) = bos_note(&fx.host).await;
    let answer = fx
        .call("bo", "memory-confirm", confirm_input(&id, &hash), json!({}))
        .await;
    assert!(!asks(&answer), "{answer}");
    // Not served: answered as a name that does not exist (AFD's hidden-command rule), before
    // anyone is asked, and no decision begins.
    assert_eq!(code(&answer), "COMMAND_NOT_FOUND", "{answer}");
    assert!(hosted_kit::journal(fx.dir.path(), "person-decide").is_empty());
}

#[tokio::test]
async fn memory_preview_at_a_terminal_shows_what_will_be_confirmed() {
    let fx = Hosted::start("").await;
    let adas = hosted_kit::remember(
        &fx.host,
        agent_for("ada-bot", "ada"),
        "alpha",
        "Ada's",
        "Ada's preview-c19f note.",
        Some("private"),
    )
    .await;
    let hash = record(&fx.host, "corp/ada", &adas).await["contentHash"]
        .as_str()
        .unwrap()
        .to_owned();
    let console = support::Shown::new();
    let answer = fx
        .command_line(
            console.clone(),
            &[
                "call",
                "memory-confirm",
                &confirm_input(&adas, &hash).to_string(),
            ],
        )
        .await;
    assert_eq!(answer["success"], true, "{answer}");
    let shown = console.shown();
    assert!(shown.contains("| Ada's preview-c19f note."), "{shown}");
    let assurance =
        record(&fx.host, "corp/ada", &adas).await["provenance"]["confirmation"]["assurance"]
            .clone();
    assert_eq!(
        assurance,
        json!({ "level": "terminal", "method": "cli-terminal" })
    );
}
