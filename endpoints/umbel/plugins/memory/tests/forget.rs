//! `memory-forget` (sections 6.3, 7.2 and 8.7): the selectors; `MEMORY_FORGET_HUMAN_REQUIRED`,
//! with `--yes` refused; other people's records counted in `notFound` like absent ones; a
//! `person` record refused below `person`; erased prefixes refusing a later tail, a closed window
//! and a session; an idempotency key not recreating a forgotten record; and the fixed suggestion.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::*;

fn window(idempotency: &str, capture_key: &str, session: &str) -> Value {
    json!({
        "version": 1,
        "harness": { "name": "claude-code", "version": "2.1.309" },
        "event": "stop",
        "session": session,
        "project": "afd",
        "idempotencyKey": idempotency,
        "captureKey": capture_key,
        "episodes": [{ "subject": "Window", "text": format!("Turns of {idempotency}.") }],
    })
}

async fn shown(fx: &Fx, id: &str) -> Value {
    fx.show(id).await
}

#[tokio::test]
async fn ids_forget_the_callers_records_and_count_the_rest_as_not_found() {
    let fx = Fx::new();
    let mine = fx.remember(fact("Mine", "Ada's record.", json!({}))).await;
    let shared = fx
        .as_actor(
            human("bo"),
            "memory-remember",
            fact("Bo's", "Bo shares this.", json!({ "share": "space" })),
        )
        .await;
    let shared = data(&shared)["id"].as_str().unwrap().to_owned();
    let private = fx
        .as_actor(
            human("bo"),
            "memory-remember",
            fact("Bo's own", "Bo keeps this.", json!({})),
        )
        .await;
    let private = data(&private)["id"].as_str().unwrap().to_owned();
    let absent = "mem-000000000000000000000000".to_owned();
    let result = fx
        .person(
            "memory-forget",
            json!({ "ids": [mine, shared, private, absent] }),
        )
        .await;
    let d = data(&result);
    assert_eq!(d["erased"], 1, "{result}");
    assert_eq!(d["ids"], json!([mine]));
    let mut not_found: Vec<String> = d["notFound"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_owned())
        .collect();
    not_found.sort();
    let mut expected = vec![shared.clone(), private.clone(), absent];
    expected.sort();
    assert_eq!(not_found, expected);
    assert_eq!(d["wal"], "clean");
    // The limits of section 5.4, as a fixed suggestion.
    let suggestion = result["suggestions"][0].as_str().unwrap();
    assert!(
        suggestion.contains("file-level") && suggestion.contains("journal"),
        "{suggestion}"
    );
    assert_eq!(code(&shown(&fx, &mine).await), "MEMORY_NOT_FOUND");
    // Bo's records are untouched.
    let bo = fx
        .as_actor(human("bo"), "memory-show", json!({ "id": private }))
        .await;
    assert_eq!(data(&bo)["record"]["id"], private.as_str());
    // Forgetting again finds nothing, and is not an error.
    let again = fx.person("memory-forget", json!({ "ids": [mine] })).await;
    assert_eq!(data(&again)["erased"], 0);
    assert_eq!(data(&again)["notFound"], json!([mine]));
}

#[tokio::test]
async fn an_agent_forgets_by_id_only_and_never_a_persons_record() {
    let fx = Fx::new();
    let persons = fx
        .remember(fact("Ada's word", "A person's fact.", json!({})))
        .await;
    let note = fx
        .agent(
            "memory-remember",
            fact("Note", "An agent's note.", json!({})),
        )
        .await;
    let note = data(&note)["id"].as_str().unwrap().to_owned();
    let refused = fx.agent("memory-forget", json!({ "ids": [persons] })).await;
    assert_eq!(code(&refused), "MEMORY_AUTHORITY_TOO_LOW", "{refused}");
    assert_eq!(
        data(&shown(&fx, &persons).await)["record"]["id"],
        persons.as_str()
    );
    for selector in [
        json!({ "session": "s-1" }),
        json!({ "project": "afd" }),
        json!({ "before": "2027-01-01T00:00:00Z" }),
    ] {
        let refused = fx.agent("memory-forget", selector.clone()).await;
        assert_eq!(
            code(&refused),
            "MEMORY_FORGET_HUMAN_REQUIRED",
            "{selector}: {refused}"
        );
    }
    let done = fx.agent("memory-forget", json!({ "ids": [note] })).await;
    assert_eq!(data(&done)["erased"], 1, "{done}");
}

#[tokio::test]
async fn a_selector_needs_a_person_at_a_terminal_and_yes_is_refused() {
    let fx = Fx::new();
    let one = fx
        .remember(fact("One", "In session one.", json!({ "session": "s-1" })))
        .await;
    let two = fx
        .remember(fact(
            "Two",
            "Also session one.",
            json!({ "session": "s-1", "project": "afd" }),
        ))
        .await;
    let other = fx
        .remember(fact(
            "Three",
            "Another session.",
            json!({ "session": "s-2" }),
        ))
        .await;
    let selector = json!({ "session": "s-1" });
    // `--yes` clears the person at the terminal, so a selector is refused.
    let refused = fx
        .at_terminal("memory-forget", selector.clone(), &["--yes"])
        .await;
    assert_eq!(code(&refused), "MEMORY_FORGET_HUMAN_REQUIRED", "{refused}");
    // With no terminal, the confirmation itself cannot be answered.
    let script = fx.script("memory-forget", selector.clone()).await;
    assert_eq!(script["success"], false, "{script}");
    // At a terminal, the person answers the prompt and the session's records go.
    let (result, asked) = fx.terminal("memory-forget", selector, true).await;
    assert_eq!(data(&result)["erased"], 2, "{result}");
    assert!(
        asked
            .iter()
            .any(|a| a.contains("Forget these memory records?")),
        "{asked:?}"
    );
    for id in [&one, &two] {
        assert_eq!(code(&shown(&fx, id).await), "MEMORY_NOT_FOUND");
    }
    assert_eq!(
        data(&shown(&fx, &other).await)["record"]["id"],
        other.as_str()
    );
}

#[tokio::test]
async fn the_project_and_before_selectors() {
    let mut fx = Fx::new();
    let old = fx
        .remember(fact("Old", "Written first.", json!({ "project": "afd" })))
        .await;
    fx.at(NOW + 10 * DAY);
    let newer = fx
        .remember(fact(
            "Newer",
            "Written later.",
            json!({ "project": "other" }),
        ))
        .await;
    let kept = fx
        .remember(fact(
            "Kept",
            "Another project.",
            json!({ "project": "kept" }),
        ))
        .await;
    let before = fx
        .cli_person(
            "memory-forget",
            json!({ "before": umbel_store::memory::format_instant(NOW + DAY) }),
        )
        .await;
    assert_eq!(data(&before)["ids"], json!([old]), "{before}");
    let project = fx
        .person("memory-forget", json!({ "project": "other" }))
        .await;
    assert_eq!(data(&project)["ids"], json!([newer]), "{project}");
    assert_eq!(
        data(&shown(&fx, &kept).await)["record"]["id"],
        kept.as_str()
    );
    let empty = fx.person("memory-forget", json!({ "ids": [] })).await;
    assert_eq!(empty["success"], false, "{empty}");
    for bad in [
        json!({}),
        json!({ "ids": ["x"] }),
        json!({ "session": "s", "project": "p" }),
        json!({ "before": "tomorrow" }),
        json!({ "project": "../etc" }),
    ] {
        let refused = fx.person("memory-forget", bad.clone()).await;
        assert_eq!(code(&refused), "MEMORY_INVALID", "{bad}: {refused}");
    }
}

#[tokio::test]
async fn erased_prefixes_refuse_a_later_tail_a_closed_window_and_a_session() {
    let fx = Fx::new();
    let first = fx
        .person(
            "memory-capture",
            window("k-tail-1", "claude-code:s-9:w1", "s-9"),
        )
        .await;
    let ids = data(&first)["records"].clone();
    let forgotten = fx.person("memory-forget", json!({ "ids": ids })).await;
    assert_eq!(data(&forgotten)["erased"], 1, "{forgotten}");
    // A later tail and the closed window of the same window are refused, however late.
    for key in ["k-tail-2", "k-closed"] {
        let refused = fx
            .person("memory-capture", window(key, "claude-code:s-9:w1", "s-9"))
            .await;
        let d = data(&refused);
        assert_eq!(
            (d["refused"].as_u64(), d["created"].as_u64()),
            (Some(1), Some(0)),
            "{refused}"
        );
    }
    // w1 does not cover w10.
    let w10 = fx
        .person(
            "memory-capture",
            window("k-w10", "claude-code:s-9:w10", "s-9"),
        )
        .await;
    assert_eq!(data(&w10)["created"], 1, "{w10}");
    // A forget by session erases the session's prefix: every later window is refused.
    let session = fx
        .cli_person("memory-forget", json!({ "session": "s-9" }))
        .await;
    assert_eq!(data(&session)["erased"], 1, "{session}");
    let w2 = fx
        .person(
            "memory-capture",
            window("k-w2", "claude-code:s-9:w2", "s-9"),
        )
        .await;
    assert_eq!(data(&w2)["refused"], 1, "{w2}");
    // Another session is not.
    let other = fx
        .person(
            "memory-capture",
            window("k-other", "claude-code:s-8:w1", "s-8"),
        )
        .await;
    assert_eq!(data(&other)["created"], 1, "{other}");
}

#[tokio::test]
async fn an_idempotency_key_does_not_recreate_a_forgotten_record() {
    let fx = Fx::new();
    let input = fact(
        "Once",
        "Remembered once.",
        json!({ "idempotencyKey": "run-1:step-2" }),
    );
    let first = fx.person("memory-remember", input.clone()).await;
    let id = data(&first)["id"].as_str().unwrap().to_owned();
    fx.person("memory-forget", json!({ "ids": [id] })).await;
    // The retry replays the receipt and writes nothing: the record stays forgotten.
    let retry = fx.person("memory-remember", input).await;
    assert_eq!(data(&retry)["state"], "replayed", "{retry}");
    assert_eq!(data(&retry)["id"], id.as_str());
    assert_eq!(code(&shown(&fx, &id).await), "MEMORY_NOT_FOUND");
    let status = fx.person("memory-status", json!({})).await;
    assert_eq!(data(&status)["counts"]["total"], 0, "{status}");
}
