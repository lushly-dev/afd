//! The digest set of phase 4 section 11.2 (D92): every knowledge command whose input or result can
//! hold a drafted proposal's content, title, change hash or memory evidence is digest-journaled,
//! keeping only `space` and `proposal` (and a list's filters), so a canary in a drafted proposal
//! never reaches the journal or the events; results never carry a memory hash in
//! `dev.umbel/provenance`. `knowledge-propose` and `-verify` stay plain, and a canary in a plain
//! call does reach the journal, so the scan below is not blind.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::{Actor, ActorKind};
use serde_json::{Value, json};
use support::records::{self, Draft};
use support::*;

const CANARY: &str = "quokkacanary";
const REASON_CANARY: &str = "bilbyreason";
const PLAIN_CANARY: &str = "dingoplain";

/// The digest set and the input keys each keeps.
const DIGEST: [(&str, &[&str]); 8] = [
    // Phase 4 step 3b: the drafted path. The batch has no proposal input, and the feed's `after`
    // is a store revision.
    ("knowledge-propose-batch", &["space"]),
    ("knowledge-proposal-feed", &["space", "after"]),
    (
        "knowledge-proposal-list",
        &["space", "state", "area", "after", "limit"],
    ),
    ("knowledge-proposal-show", &["space", "proposal"]),
    ("knowledge-proposal-preview", &["space", "proposal"]),
    ("knowledge-approve", &["space", "proposal"]),
    ("knowledge-reject", &["space", "proposal"]),
    ("knowledge-withdraw", &["space", "proposal"]),
];

const AREA: &str = r#"
[plugins.knowledge.config.areas.handbook]
space = "main"
collection = "handbook"
"#;

fn manifest() -> toml::Table {
    umbel_plugin_knowledge::MANIFEST.parse().unwrap()
}

#[test]
fn the_manifest_declares_the_digest_set_and_nothing_else_changes_mode() {
    let manifest = manifest();
    for command in manifest["commands"].as_array().unwrap() {
        let name = command["name"].as_str().unwrap();
        let journal = command.get("journal");
        match DIGEST.iter().find(|(digest, _)| *digest == name) {
            Some((_, keep)) => {
                let journal = journal.unwrap_or_else(|| panic!("{name} declares no journal"));
                assert_eq!(journal["mode"].as_str(), Some("digest"), "{name}");
                let kept: Vec<&str> = journal["keep"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|key| key.as_str().unwrap())
                    .collect();
                assert_eq!(kept, *keep, "{name}");
            }
            // knowledge-propose and -verify never take a drafter attestation, and the read and
            // index commands never touch a proposal: plain, as before.
            None => assert!(journal.is_none(), "{name} changed its journal mode"),
        }
    }
}

async fn fixture() -> Fx {
    let fx = Fx::with(&format!(
        "{CONFIG}\n[principal]\nlocal_id = \"ada\"\n{AREA}"
    ));
    fx.handbook(
        "runbook.md",
        "---\ntitle: Rolling back\n---\n# Rolling back\n\nUse the previous tag.\n",
    );
    fx.refresh("main").await;
    fx
}

fn seed(fx: &Fx, candidate: &str) -> Value {
    let body = records::drafted(&Draft {
        candidate,
        canary: CANARY,
        promoted_by: None,
        conflict_set: None,
    });
    records::seed(fx, &body);
    body
}

/// `text` holds none of what a drafted proposal says.
fn holds_nothing_of(what: &str, text: &str, drafts: &[&Value]) {
    for needle in [CANARY, REASON_CANARY, records::SOURCE_HASH] {
        assert!(!text.contains(needle), "{needle} reached {what}");
    }
    for draft in drafts {
        let hash = draft["changeHash"].as_str().unwrap();
        assert!(!text.contains(hash), "a change hash reached {what}");
    }
}

#[tokio::test]
async fn a_canary_in_a_drafted_proposal_never_reaches_the_journal_or_the_events() {
    let fx = fixture().await;
    let approved = seed(&fx, "4a1b2c3d4e5f60718293");
    let rejected = seed(&fx, "5b2c3d4e5f6071829304");
    let withdrawn = seed(&fx, "6c3d4e5f607182930415");
    let id = |body: &Value| body["id"].as_str().unwrap().to_owned();

    // Every command of the digest set, over MCP and on the command line.
    let listed = fx
        .as_actor(
            member(),
            "knowledge-proposal-list",
            json!({ "state": "pending" }),
        )
        .await;
    assert_eq!(data(&listed)["count"], 3, "{listed}");
    let shown = fx
        .as_actor(
            member(),
            "knowledge-proposal-show",
            json!({ "proposal": id(&approved) }),
        )
        .await;
    assert!(
        shown.to_string().contains(CANARY),
        "show answers the caller"
    );
    let previewed = fx
        .cli(
            "knowledge-proposal-preview",
            json!({ "proposal": id(&approved) }),
        )
        .await;
    assert!(previewed.to_string().contains(CANARY), "{previewed}");
    let applied = fx
        .at_terminal("knowledge-approve", json!({ "proposal": id(&approved) }))
        .await;
    assert_eq!(data(&applied)["applied"], true, "{applied}");
    let refused = fx
        .at_terminal(
            "knowledge-reject",
            json!({ "proposal": id(&rejected), "reason": format!("Wrong: {REASON_CANARY}.") }),
        )
        .await;
    assert_eq!(data(&refused)["rejected"], true, "{refused}");
    let taken_back = fx
        .as_actor(
            Actor::new(ActorKind::Human).with_id("local"),
            "knowledge-withdraw",
            json!({ "proposal": id(&withdrawn) }),
        )
        .await;
    assert_eq!(data(&taken_back)["withdrawn"], true, "{taken_back}");

    // No result's provenance carries a memory hash or `derivedFrom`.
    for result in [&shown, &previewed, &applied, &refused, &taken_back] {
        let provenance = &result["metadata"]["dev.umbel/provenance"];
        assert!(provenance.get("derivedFrom").is_none(), "{provenance}");
        assert!(
            !provenance.to_string().contains(records::SOURCE_HASH),
            "{provenance}"
        );
    }

    // A plain call's text does reach the journal: the scan would see a leak.
    let plain = fx
        .as_actor(
            agent("x"),
            "knowledge-propose",
            json!({
                "idempotency_key": "plain",
                "change": { "op": "create", "doc": "handbook/plain", "content": "---\ntitle: Plain\n---\nBody.\n" },
                "rationale": format!("Plain {PLAIN_CANARY}."),
                "evidence": [{ "kind": "text", "ref": "notes" }],
            }),
        )
        .await;
    assert_eq!(data(&plain)["created"], true, "{plain}");

    // The batch and the feed (step 3b). A batch's proposals are digested whoever sends them; a
    // feed outside a drafter's pipeline is refused, and journaled as a digest all the same.
    let batched = fx
        .as_actor(
            agent("x"),
            "knowledge-propose-batch",
            json!({ "proposals": [{
                "idempotency_key": "batched",
                "change": { "op": "create", "doc": "handbook/batched", "content": format!("---\ntitle: Batched\n---\n{CANARY}\n") },
                "rationale": format!("Batched {CANARY}."),
                "evidence": [{ "kind": "text", "ref": "notes", "excerpt": CANARY }],
            }] }),
        )
        .await;
    assert_eq!(data(&batched)["results"][0]["created"], true, "{batched}");
    let fed = fx
        .cli("knowledge-proposal-feed", json!({ "after": 0 }))
        .await;
    assert_eq!(code(&fed), "PROPOSAL_DRAFTER_NOT_ALLOWED", "{fed}");

    let journal = records::journal(&fx);
    assert!(journal.contains(PLAIN_CANARY), "the control is journaled");
    let drafts = [&approved, &rejected, &withdrawn];
    holds_nothing_of("the journal", &journal, &drafts);
    holds_nothing_of("the events", &records::events(&fx), &drafts);

    // Each digest command was journaled as a digest, keeping the proposal id and nothing else.
    for (command, keep) in DIGEST {
        let entries = records::journal_entries(&fx, command);
        assert!(!entries.is_empty(), "{command} was journaled");
        for entry in entries {
            assert_eq!(entry["input"]["dev.umbel/journal"], "digest", "{entry}");
            assert!(entry["result"]["data"].is_null(), "{entry}");
            let kept = entry["input"]["keep"].as_object().unwrap();
            assert!(
                kept.keys().all(|key| keep.contains(&key.as_str())),
                "{command} kept {kept:?}"
            );
        }
    }
    // The first approve entry is AFD's approval request, which keeps no input value; the one
    // that ran keeps the proposal id and the host's keys, from which its event projects.
    let approvals = records::journal_entries(&fx, "knowledge-approve");
    let ran = approvals
        .iter()
        .find(|entry| entry["result"]["success"] == true)
        .unwrap();
    assert_eq!(ran["input"]["keep"]["proposal"], id(&approved).as_str());
    assert_eq!(
        ran["result"]["metadata"]["dev.umbel/record"]["id"],
        id(&approved).as_str(),
        "{ran}"
    );
    // The events of the decisions are there, with their record and access.
    let events = fx.cli("event-list", json!({})).await;
    let commands: Vec<&str> = data(&events)["events"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|event| event["command"].as_str())
        .collect();
    for wanted in [
        "knowledge-approve",
        "knowledge-reject",
        "knowledge-withdraw",
    ] {
        assert!(commands.contains(&wanted), "{wanted} in {commands:?}");
    }
}
