//! Changing another principal's shared record (phase 5 specification, section 8.3, owner decision
//! 10; step 10), end to end in a hosted workspace: only the record's principal (with the legacy
//! principals it stands for), or a person holding a token in the `memory_write` grant's `editors`
//! list. An editor at a terminal changes it; a person who is not one, an editor's agent over MCP
//! (no person page decides a change, so none is verified there) whatever `agents_may_share` and
//! `writers` say, the library's person other than the operator's, and a group naming `*` do not;
//! the owner through equivalents does. History keeps every version, and no refusal names the
//! record's text. The plugin refuses an agent itself before it asks the host.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod hosted_kit;
mod support;

use hosted_kit::{Hosted, agent_for, code, human, library, result};
use serde_json::{Value, json};

const NOTE: &str = "Deploys freeze on Fridays-3b9e.";

/// Bo's agent's note in `alpha`, shared with the space by the default: readable by everyone. The
/// clock then moves a second, so an invalidation may follow the note's `validFrom`.
async fn bos_note(fx: &Hosted) -> String {
    let id = hosted_kit::remember(
        &fx.host,
        agent_for("bo-bot", "bo"),
        "alpha",
        "Freeze",
        NOTE,
        None,
    )
    .await;
    fx.advance(1000).await;
    id
}

fn invalidate(id: &str) -> Value {
    json!({ "space": "alpha", "id": id, "reason": "outdated" })
}

/// Every version of `id`, as `reader` reads it through the library.
async fn history(host: &umbel::Host, reader: &str, id: &str) -> Vec<Value> {
    let shown = library(
        host,
        human(reader),
        "memory-show",
        json!({ "id": id, "history": true }),
    )
    .await;
    shown["data"]["history"]
        .as_array()
        .cloned()
        .unwrap_or_default()
}

#[tokio::test]
async fn an_editor_changes_anothers_record_as_a_person_at_a_terminal() {
    let fx = Hosted::start("editors = [\"group:curators\", \"principal:human:corp/ada\"]").await;
    let id = bos_note(&fx).await;
    // The operator, corp/ada, an editor, at a terminal.
    let done = fx
        .command_line(
            support::Shown::new(),
            &["call", "memory-invalidate", &invalidate(&id).to_string()],
        )
        .await;
    assert_eq!(done["success"], true, "{done}");
    assert_eq!(done["data"]["recordVersion"], 2);
    // History keeps both versions: the note as bo's agent wrote it, and its invalidation by ada.
    let versions = history(&fx.host, "corp/bo", &id).await;
    assert_eq!(versions.len(), 2, "{versions:?}");
    assert_eq!(versions[0]["text"], NOTE);
    assert!(versions[0]["invalidation"].is_null());
    assert_eq!(versions[1]["invalidation"]["by"], "human:corp/ada");
    assert_eq!(versions[1]["scope"]["principal"], "human:corp/bo");
}

#[tokio::test]
async fn a_person_who_is_not_an_editor_may_not() {
    let fx = Hosted::start("editors = [\"group:curators\"]").await;
    let id = bos_note(&fx).await;
    let refused = fx
        .command_line(
            support::Shown::new(),
            &["call", "memory-invalidate", &invalidate(&id).to_string()],
        )
        .await;
    assert_eq!(refused["error"]["code"], "MEMORY_NOT_OWNED", "{refused}");
    assert!(!refused.to_string().contains("Fridays-3b9e"), "{refused}");
    // A supersede is a change too.
    let superseding = json!({
        "space": "alpha", "class": "semantic", "subject": "Freeze",
        "text": "Deploys freeze on Thursdays.", "supersedes": [id],
    });
    let refused = fx
        .command_line(
            support::Shown::new(),
            &["call", "memory-remember", &superseding.to_string()],
        )
        .await;
    assert_eq!(refused["error"]["code"], "MEMORY_NOT_OWNED", "{refused}");
    assert_eq!(history(&fx.host, "corp/bo", &id).await.len(), 1);
}

#[tokio::test]
async fn over_mcp_an_editors_agent_is_refused_whatever_sharing_allows() {
    let fx = Hosted::start(
        "editors = [\"group:curators\"]\nwriters = [\"group:curators\"]\nagents_may_share = true",
    )
    .await;
    let id = bos_note(&fx).await;
    // Ed is an editor, a sharing writer, and agents may share: ed's client is still an agent,
    // and no person page decides a change, so it is refused, by the plugin itself before the host.
    let answer = fx
        .call(
            "ed",
            "ed-client",
            "memory-invalidate",
            invalidate(&id),
            json!({}),
        )
        .await;
    assert_eq!(code(&answer), "MEMORY_NOT_OWNED", "{answer}");
    assert_eq!(
        result(&answer)["error"]["message"],
        "the record is another principal's",
        "the plugin's own check answered: {answer}"
    );
    let supersede = fx
        .call(
            "ed",
            "ed-client",
            "memory-remember",
            json!({ "space": "alpha", "class": "semantic", "subject": "Freeze",
                    "text": "Deploys freeze on Thursdays.", "supersedes": [id] }),
            json!({}),
        )
        .await;
    assert_eq!(code(&supersede), "MEMORY_NOT_OWNED", "{supersede}");
    // A non-editor's agent, likewise.
    let answer = fx
        .call(
            "cy",
            "cy-client",
            "memory-invalidate",
            invalidate(&id),
            json!({}),
        )
        .await;
    assert_eq!(code(&answer), "MEMORY_NOT_OWNED", "{answer}");
    assert_eq!(history(&fx.host, "corp/bo", &id).await.len(), 1);
}

#[tokio::test]
async fn the_owner_changes_their_own_through_equivalents() {
    let fx = Hosted::start("").await;
    // A note of the legacy principal human:bo, which maps to corp/bo.
    let id = hosted_kit::remember(
        &fx.host,
        agent_for("old-bot", "bo").with_on_behalf_of("bo"),
        "alpha",
        "Legacy",
        "A legacy note-9d02.",
        None,
    )
    .await;
    fx.advance(1000).await;
    let answer = fx
        .call(
            "bo",
            "bo-client",
            "memory-invalidate",
            invalidate(&id),
            json!({}),
        )
        .await;
    assert_eq!(result(&answer)["success"], true, "{answer}");
    let other = hosted_kit::remember(
        &fx.host,
        agent_for("old-bot", "bo").with_on_behalf_of("bo"),
        "alpha",
        "Legacy",
        "Another legacy note-9d02.",
        None,
    )
    .await;
    let superseded = fx
        .call(
            "bo",
            "bo-client",
            "memory-remember",
            json!({ "space": "alpha", "class": "semantic", "subject": "Legacy",
                    "text": "The note, restated.", "supersedes": [other] }),
            json!({}),
        )
        .await;
    assert_eq!(result(&superseded)["success"], true, "{superseded}");
}

#[tokio::test]
async fn the_library_edits_only_as_the_operators_person() {
    let fx = Hosted::start("editors = [\"principal:human:corp/ed\", \"principal:human:corp/ada\"]")
        .await;
    let id = bos_note(&fx).await;
    // Ed is an editor, but through the library only the operator's person's word counts.
    let refused = library(
        &fx.host,
        human("corp/ed"),
        "memory-invalidate",
        invalidate(&id),
    )
    .await;
    assert_eq!(refused["error"]["code"], "MEMORY_NOT_OWNED", "{refused}");
    let done = library(
        &fx.host,
        human("corp/ada"),
        "memory-invalidate",
        invalidate(&id),
    )
    .await;
    assert_eq!(done["success"], true, "{done}");
    assert_eq!(history(&fx.host, "corp/bo", &id).await.len(), 2);
}

#[tokio::test]
async fn a_group_naming_everyone_names_no_editor() {
    let fx = Hosted::start(
        "editors = [\"group:everyone\"]\n\n[access.groups.everyone]\nmembers = [\"*\"]",
    )
    .await;
    let id = bos_note(&fx).await;
    let refused = library(
        &fx.host,
        human("corp/ada"),
        "memory-invalidate",
        invalidate(&id),
    )
    .await;
    assert_eq!(refused["error"]["code"], "MEMORY_NOT_OWNED", "{refused}");
}
