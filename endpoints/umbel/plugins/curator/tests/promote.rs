//! `curator-promote` (phase 4 specification, section 5.2; owner decision 5, D94), on
//! `memory-confirm`'s mechanisms (D88): `require-human` at a terminal, with `--yes`, `--approve`
//! and an agent's environment refused and nothing asked; not offered over MCP; own records only;
//! the content hash as proof of looking; only a `needs-promotion` candidate; sensitivity never
//! overridden; the consent record, the caller's alone, and the promoted draft it allows;
//! idempotent; journaled without the hash or any text.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::CommandInterface;
use serde_json::{Value, json};
use support::*;
use umbel_okf::draft;
use umbel_store::Sensitivity;

fn candidate(lowest: u64) -> String {
    draft::candidate_id("main", "human:local", &mem(lowest))
}

fn input(candidate: &str, hash: &str) -> Value {
    json!({ "candidate": candidate, "contentHash": hash })
}

/// Local's private fact `n`, observed in two sessions, settled at day 8: its content hash.
fn own_private(fx: &mut Fx, n: u64, subject: &str, text: &str) -> String {
    fx.remember_twice(
        fact(n, "human:local", &["principal:human:local"], subject, text),
        n + 1,
    );
    fx.at(day(8));
    fx.record(&mem(n)).content_hash.as_str().to_owned()
}

#[tokio::test]
async fn a_person_promotes_their_own_candidate_at_a_terminal() {
    let mut fx = Fx::new();
    let hash = own_private(&mut fx, 1, "My fact zebracanary", "Only mine zebracanary.");
    let id = candidate(1);
    let row = fx.only().await;
    assert_eq!(row["status"], "needs-promotion");
    assert_eq!(row["contentHash"], hash.as_str());
    // The first 16 hex digits suffice, as memory-show printed them.
    let short = &hash[..("sha256:".len() + 16)];
    let (result, asked) = fx
        .terminal("curator-promote", input(&id, short), true)
        .await;
    let d = data(&result);
    let consent = format!("n-{}", &id[2..]);
    assert_eq!(d["candidate"], id.as_str());
    assert_eq!(d["consent"], consent.as_str());
    assert_eq!(d["created"], true);
    assert_eq!(d["sources"], 1);
    assert_eq!(d["readers"], json!(["space"]));
    assert_eq!(d["doc"], format!("notes/learned/{id}"));
    assert_eq!(asked.len(), 1, "{asked:?}");
    assert!(
        asked[0].contains("readable by everyone who can read the target collection"),
        "{asked:?}"
    );
    // The consent record: the caller's alone, each source at its version and hash.
    let record = fx.curator_record("consent", &consent).unwrap();
    assert!(
        record_validator().is_valid(&record.body),
        "{:#}",
        record.body
    );
    assert_eq!(
        record.body,
        json!({
            "version": 1, "kind": "consent", "id": consent, "space": "main",
            "principal": "human:local", "access": ["principal:human:local"],
            "by": "human:local", "at": "2026-01-09T00:00:00.000Z",
            "sources": [{ "id": mem(1), "recordVersion": 1, "contentHash": hash }],
        })
    );
    assert_eq!(record.envelope.access, ["principal:human:local"]);
    assert!(record.envelope.content_hash.is_none() && record.envelope.derived_from.is_none());
    // The next run drafts it as a promotion.
    let row = fx.only().await;
    assert_eq!(row["status"], "ready");
    assert_eq!(row["mode"], "promoted");
    // Promoting again writes nothing.
    let (again, _) = fx
        .terminal("curator-promote", input(&id, &hash), true)
        .await;
    assert_eq!(data(&again)["created"], false);
    // The journal and the events keep the space, never the hash or the text.
    let hex = &hash["sha256:".len()..];
    never_mentions(&fx.journaled_text(), &[&hex[..16], "zebracanary"]);
}

#[tokio::test]
async fn only_a_person_at_a_terminal_may_promote() {
    let mut fx = Fx::new();
    let hash = own_private(&mut fx, 1, "Mine", "Private.");
    let body = input(&candidate(1), &hash);
    // Not offered over MCP or to an in-process agent.
    for interface in [CommandInterface::Mcp, CommandInterface::Agent] {
        let refused = fx
            .call(human("local"), interface, "curator-promote", body.clone())
            .await;
        assert_eq!(code(&refused), "COMMAND_NOT_EXPOSED", "{refused}");
    }
    let definition = fx.host.registry().get("curator-promote").unwrap();
    assert!(!definition.expose.mcp && !definition.expose.agent && definition.expose.cli);
    // Through the library there is no terminal answer behind it.
    let library = fx
        .call(
            human("local"),
            CommandInterface::Cli,
            "curator-promote",
            body.clone(),
        )
        .await;
    assert_eq!(code(&library), "CONFIRMATION_REQUIRED", "{library}");
    // `--yes` and `--approve` are refused even at a terminal, and nothing is asked.
    let text = body.to_string();
    for flag in ["--yes", "--approve"] {
        let console = Terminal::new(true, true);
        let (_, value) = fx
            .command_line(console.clone(), &["call", "curator-promote", &text, flag])
            .await;
        assert_eq!(code(&value), "CONFIRMATION_REQUIRED", "{flag}: {value}");
        assert!(console.asked().is_empty(), "{flag} must not ask");
    }
    // No terminal, a declined prompt, and an agent's environment: refused.
    let (_, value) = fx
        .command_line(
            Terminal::new(false, true),
            &["call", "curator-promote", &text],
        )
        .await;
    assert_eq!(value["success"], false, "{value}");
    let (declined, _) = fx.terminal("curator-promote", body.clone(), false).await;
    assert_eq!(code(&declined), "CONFIRMATION_DECLINED");
    for variable in ["CLAUDECODE", "AI_AGENT"] {
        let (_, value) = fx
            .command_line_with(
                Terminal::new(true, true),
                &["call", "curator-promote", &text],
                &[(variable, "1")],
            )
            .await;
        assert_eq!(
            code(&value),
            "CURATOR_PROMOTE_NOT_ALLOWED",
            "{variable}: {value}"
        );
        assert_eq!(value["error"]["details"]["reason"], "not-a-person");
    }
    let consent = format!("n-{}", &candidate(1)[2..]);
    assert!(fx.curator_record("consent", &consent).is_none());
    assert_eq!(fx.only().await["status"], "needs-promotion");
}

#[tokio::test]
async fn only_the_owner_of_every_source_may_promote() {
    let mut fx = Fx::with(&config_with(
        "[plugins.curator.config.spaces.main]\ncollection = \"team\"\nprefix = \"learned\"\n",
        "",
    ));
    // Ada's fact, shared with the space: Local reads it, but the team target's group token is
    // not in its access set, so it needs promotion, which only Ada may give.
    fx.remember_twice(fact(1, "human:ada", &["space"], "Ada's", "Shared."), 2);
    // The same text, Local's and Ada's: two owners in one candidate.
    let text = "Both of us.";
    fx.remember(vec![
        fact(3, "human:local", &["principal:human:local"], "Joint", text),
        fact(4, "human:ada", &["space"], "Joint", text),
    ]);
    fx.at(day(8));
    for n in [1, 3] {
        let hash = fx.record(&mem(n)).content_hash.as_str().to_owned();
        let row = fx
            .rows()
            .await
            .into_iter()
            .find(|r| r["candidate"] == candidate(n))
            .unwrap();
        assert_eq!(row["status"], "needs-promotion");
        assert_eq!(row["own"], false);
        let (refused, _) = fx
            .terminal("curator-promote", input(&candidate(n), &hash), true)
            .await;
        assert_eq!(code(&refused), "CURATOR_PROMOTE_NOT_ALLOWED", "{refused}");
        assert_eq!(refused["error"]["details"]["reason"], "not-own");
        never_mentions(&refused.to_string(), &[&hash[7..23], "Shared.", text]);
    }
}

#[tokio::test]
async fn the_hash_must_match_and_only_a_candidate_needing_promotion_is_promoted() {
    let mut fx = Fx::new();
    let hash = own_private(&mut fx, 1, "Mine", "Private.");
    // A wrong hash: the records may have changed since the person read them.
    let wrong = format!("sha256:{}", "a".repeat(64));
    let (refused, _) = fx
        .terminal("curator-promote", input(&candidate(1), &wrong), true)
        .await;
    assert_eq!(code(&refused), "CURATOR_PROMOTE_NOT_ALLOWED");
    assert_eq!(refused["error"]["details"]["reason"], "content-hash");
    // A malformed hash or id is refused before anything is read.
    for bad in [
        input(&candidate(1), "sha256:abc"),
        input("c-zz", &hash),
        input(&candidate(1), "SHA256:ABCDEF0123456789"),
    ] {
        let (refused, _) = fx.terminal("curator-promote", bad.clone(), true).await;
        assert_eq!(refused["success"], false, "{bad}");
    }
    // Someone else's candidate id, or none: not found, alike.
    let others = draft::candidate_id("main", "human:ada", &mem(1));
    let (missing, _) = fx
        .terminal("curator-promote", input(&others, &hash), true)
        .await;
    assert_eq!(code(&missing), "CURATOR_CANDIDATE_NOT_FOUND");
    // A shared fact of Local's needs no promotion; one still settling cannot be promoted yet.
    fx.remember_twice(
        fact(3, "human:local", &["space"], "Shared", "Already shared."),
        4,
    );
    fx.remember(vec![fact(
        5,
        "human:local",
        &["principal:human:local"],
        "Young",
        "New.",
    )]);
    fx.at(day(8));
    for (n, status) in [(3, "ready"), (5, "settling")] {
        let hash = fx.record(&mem(n)).content_hash.as_str().to_owned();
        let (refused, _) = fx
            .terminal("curator-promote", input(&candidate(n), &hash), true)
            .await;
        assert_eq!(code(&refused), "CURATOR_PROMOTE_NOT_ALLOWED", "{refused}");
        assert_eq!(refused["error"]["details"]["reason"], "status");
        assert_eq!(refused["error"]["details"]["status"], status);
    }
}

#[tokio::test]
async fn sensitivity_is_never_overridden() {
    let mut fx = Fx::new();
    fx.remember_twice(
        sensitive(
            fact(
                1,
                "human:local",
                &["principal:human:local"],
                "Secret",
                "Restricted.",
            ),
            Sensitivity::Restricted,
        ),
        2,
    );
    fx.at(day(8));
    let hash = fx.record(&mem(1)).content_hash.as_str().to_owned();
    assert_eq!(fx.only().await["reason"], "sensitivity-higher");
    let (refused, _) = fx
        .terminal("curator-promote", input(&candidate(1), &hash), true)
        .await;
    assert_eq!(code(&refused), "CURATOR_PROMOTE_NOT_ALLOWED");
    assert_eq!(refused["error"]["details"]["status"], "skipped");
}

#[tokio::test]
async fn a_consent_covers_the_versions_the_person_looked_at() {
    let mut fx = Fx::new();
    // An agent's note of Local's, confirmed by Local (authority person on version 2).
    fx.remember_twice(
        with_authority(
            fact(
                1,
                "human:local",
                &["principal:human:local"],
                "Note",
                "Noted.",
            ),
            umbel_store::Authority::Agent,
        ),
        2,
    );
    fx.confirm(&mem(1), "human:local", day(1));
    fx.at(day(9));
    let hash = fx.record(&mem(1)).content_hash.as_str().to_owned();
    let (promoted, _) = fx
        .terminal("curator-promote", input(&candidate(1), &hash), true)
        .await;
    assert_eq!(data(&promoted)["created"], true);
    assert_eq!(fx.only().await["mode"], "promoted");
    let consent = format!("n-{}", &candidate(1)[2..]);
    let body = fx.curator_record("consent", &consent).unwrap().body;
    assert_eq!(body["sources"][0]["recordVersion"], 2);
}
