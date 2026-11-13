//! The leak probes of section 12, through library actors (exact until phase 5): `human:ada`,
//! `human:bo`, an agent for ada, and the space `beta`, which bo may not read. They write their
//! own records, with terms no other test uses, into whatever workspace they are given, so
//! `exit_memory.rs` runs them on the exit's stores and `leak_probes.rs` on a fresh one. The
//! workspace's `umbel.toml` must be [`super::config`]'s; it is restored at the end.

use serde_json::{Value, json};

use super::{Ws, agent_for, bundled, code, data, fact, human, ids, omitted_count, seen};
use afd::Actor;

pub const ABSENT: &str = "mem-000000000000000000000000";
const SHARED: &str = "prbsharedq";
const PRIVATE: &str = "prbprivateq";
const AGENT_NOTE: &str = "prbagentq";
const BETA: &str = "prbbetaq";
const GROUP: &str = "prbgroupq";
const CAPTURED: &str = "prbcapturedq";
const AGENT_SHARED: &str = "prbagentsharedq";
const TRANSCRIPT: &str = "prbtranscriptq";
const ABSENT_TERM: &str = "prbabsentq";
const ALL_SECTIONS: [&str; 4] = ["knowledge", "semantic", "procedural", "episodic"];

fn ada() -> Actor {
    human("ada")
}

fn bo() -> Actor {
    human("bo")
}

fn bos_agent() -> Actor {
    agent_for("prb-bo-bot", "bo")
}

fn adas_agent() -> Actor {
    agent_for("prb-bot", "ada")
}

fn capture(session: &str, key: &str, text: &str) -> Value {
    json!({
        "version": 1,
        "harness": { "name": "claude-code" },
        "event": "stop",
        "session": session,
        "project": "probe",
        "idempotencyKey": key,
        "captureKey": format!("claude-code:{session}:w1"),
        "window": 1,
        "episodes": [{ "subject": format!("Session {session} window 1"), "text": text, "part": 0, "turns": [0, 1] }],
    })
}

/// Everything bo can read in `alpha`, as bo sees it. `event-list` keeps only its events: its
/// cursor and head are the stream's sequence numbers, phase 2's accepted hidden count (section 11).
async fn bo_views(ws: &Ws) -> Vec<(String, Value)> {
    let mut views = Vec::new();
    for (name, command, input, cli) in [
        (
            "recall planted",
            "memory-recall",
            json!({ "query": PRIVATE, "format": "detailed" }),
            false,
        ),
        (
            "recall agent note",
            "memory-recall",
            json!({ "query": AGENT_NOTE, "includeExpired": true }),
            false,
        ),
        (
            "recall captured",
            "memory-recall",
            json!({ "query": CAPTURED }),
            false,
        ),
        ("list", "memory-list", json!({ "limit": 50 }), false),
        ("status", "memory-status", json!({}), false),
        ("export", "memory-export", json!({}), true),
        (
            "bundle with the planted task",
            "context-bundle",
            json!({ "task": format!("{PRIVATE} {AGENT_NOTE} {CAPTURED}"), "render": "text", "sections": ALL_SECTIONS }),
            false,
        ),
        (
            "bundle at session start",
            "context-bundle",
            json!({ "render": "text", "sections": ALL_SECTIONS, "project": "probe" }),
            false,
        ),
    ] {
        let result = if cli {
            ws.cli(bo(), command, input).await
        } else {
            ws.call(bo(), command, input).await
        };
        assert_eq!(result["success"], true, "{name}: {result}");
        views.push((name.to_owned(), seen(&result)));
    }
    let events = ws
        .call(bo(), "event-list", json!({ "space": "alpha" }))
        .await;
    views.push(("event-list".to_owned(), data(&events)["events"].clone()));
    views
}

/// An answer about `id`, with the id itself written as `<id>`, to compare with an absent one.
fn about(result: &Value, id: &str) -> String {
    seen(result).to_string().replace(id, "<id>")
}

/// Run every leak probe on the workspace at `ws`; the number of probe groups that passed (14).
pub async fn run(ws: &mut Ws) -> usize {
    let original = std::fs::read_to_string(ws.dir.join("umbel.toml")).unwrap();
    let mut groups = 0;

    // What bo reads before ada writes anything private: a record shared with the space, bo's
    // own, and ada's record in beta.
    let shared = ws
        .remember(
            ada(),
            fact(
                "Probe shared fact",
                &format!("{SHARED} the shared probe fact"),
                json!({ "share": "space", "project": "probe" }),
            ),
        )
        .await;
    let bos = ws
        .remember(
            bo(),
            fact("Bo's probe note", "prbbonote a note of bo's own", json!({})),
        )
        .await;
    let beta = ws
        .remember(
            ada(),
            fact(
                "Probe beta fact",
                &format!("{BETA} only in beta"),
                json!({ "space": "beta" }),
            ),
        )
        .await;
    let before = bo_views(ws).await;

    // Ada's private writes: her own fact, her agent's note and a captured window.
    let private = ws
        .remember(
            ada(),
            fact(
                "Probe private fact",
                &format!("{PRIVATE} ada's private probe fact"),
                json!({ "project": "probe" }),
            ),
        )
        .await;
    let note = ws
        .remember(
            adas_agent(),
            fact(
                "Probe agent note",
                &format!("{AGENT_NOTE} the agent's private note"),
                json!({ "project": "probe" }),
            ),
        )
        .await;
    let adas_capture = ws
        .call(
            ada(),
            "memory-capture",
            capture(
                "probe-s1",
                "claude-code:probe-s1:w1:p0",
                &format!("[user]\n{CAPTURED} a captured turn\n"),
            ),
        )
        .await;
    assert_eq!(data(&adas_capture)["created"], 1, "{adas_capture}");

    // 1. bo sees nothing of it, through any read: every answer is the one bo had before,
    //    bundles' omissions, counts and `memoryHead` included.
    let after = bo_views(ws).await;
    for ((name, was), (_, is)) in before.iter().zip(&after) {
        assert_eq!(was, is, "bo's {name} changed after ada's private writes");
    }
    groups += 1;

    // 2. A term unique to the private record gives bo the same answer as an absent term.
    let planted = ws
        .call(bo(), "memory-recall", json!({ "query": PRIVATE }))
        .await;
    let absent = ws
        .call(bo(), "memory-recall", json!({ "query": ABSENT_TERM }))
        .await;
    assert_eq!(seen(&planted), seen(&absent));
    assert_eq!(data(&planted)["hits"], json!([]));
    groups += 1;

    // 3. show, invalidate and forget answer for ada's record as for one that never existed;
    //    the record stays.
    for (command, input) in [
        ("memory-show", json!({ "id": "<id>" })),
        (
            "memory-show",
            json!({ "id": "<id>", "history": true, "asOf": { "valid": "2026-01-01T00:00:00Z" } }),
        ),
        (
            "memory-invalidate",
            json!({ "id": "<id>", "reason": "wrong" }),
        ),
        ("memory-forget", json!({ "ids": ["<id>"] })),
    ] {
        let with = |id: &str| serde_json::from_str(&input.to_string().replace("<id>", id)).unwrap();
        let for_private = ws.call(bo(), command, with(&private)).await;
        let for_absent = ws.call(bo(), command, with(ABSENT)).await;
        assert_eq!(
            about(&for_private, &private),
            about(&for_absent, ABSENT),
            "{command}"
        );
        if command == "memory-forget" {
            assert_eq!(data(&for_private)["erased"], 0);
            assert_eq!(data(&for_private)["notFound"], json!([private]));
        } else {
            assert_eq!(code(&for_private), "MEMORY_NOT_FOUND", "{command}");
        }
    }
    let kept = ws
        .call(ada(), "memory-show", json!({ "id": private }))
        .await;
    assert_eq!(data(&kept)["state"], "live", "bo's forget erased nothing");
    groups += 1;

    // 4. A recall hit holds no score; 5. memory_head hides the true head.
    for format in ["concise", "detailed"] {
        let hits = ws
            .call(
                ada(),
                "memory-recall",
                json!({ "query": PRIVATE, "format": format }),
            )
            .await;
        assert_eq!(ids(&hits), [private.as_str()]);
        for hit in data(&hits)["hits"].as_array().unwrap() {
            assert!(hit.get("score").is_none(), "{hit}");
        }
        assert!(!data(&hits).to_string().contains("\"score\""));
    }
    let adas_head = ws.call(ada(), "context-bundle", json!({})).await;
    let bos_head = ws.call(bo(), "context-bundle", json!({})).await;
    let (adas_head, bos_head) = (
        data(&adas_head)["state"]["memoryHead"].as_u64().unwrap(),
        data(&bos_head)["state"]["memoryHead"].as_u64().unwrap(),
    );
    assert!(
        bos_head < adas_head,
        "bo's head {bos_head} is ada's {adas_head}"
    );
    groups += 2;

    // 6. Ada's agent reads ada's records.
    for id in [&private, &note] {
        let shown = ws
            .call(adas_agent(), "memory-show", json!({ "id": id }))
            .await;
        assert_eq!(data(&shown)["record"]["id"], json!(id));
    }
    let recalled = ws
        .call(adas_agent(), "memory-recall", json!({ "query": PRIVATE }))
        .await;
    assert_eq!(ids(&recalled), [private.as_str()]);
    groups += 1;

    // 7. A shared record is read by bo and is not writable by bo below `person`. A minute
    //    later, so an invalidation now would follow the record's valid time.
    ws.at(ws.clock + super::MINUTE);
    let read = ws
        .call(bo(), "memory-recall", json!({ "query": SHARED }))
        .await;
    assert_eq!(ids(&read), [shared.as_str()]);
    // bo's agent, without authority `person`, may change no record of ada's person: refused
    // first on authority (6.3), since it reads the record.
    let invalidated = ws
        .call(
            bos_agent(),
            "memory-invalidate",
            json!({ "id": shared, "reason": "wrong" }),
        )
        .await;
    assert_eq!(
        code(&invalidated),
        "MEMORY_AUTHORITY_TOO_LOW",
        "{invalidated}"
    );
    let superseded = ws
        .call(
            bos_agent(),
            "memory-remember",
            fact(
                "Bo's replacement",
                "prbreplacement bo replaces it",
                json!({ "supersedes": [shared], "project": "probe" }),
            ),
        )
        .await;
    assert_eq!(
        code(&superseded),
        "MEMORY_AUTHORITY_TOO_LOW",
        "{superseded}"
    );
    // Authority is checked before ownership (step 4's amendment 4). Neither bo's library
    // actor nor bo's agent has person authority: only the operator's person is trusted through
    // the library in phase 5 step 10. Both are refused before the store can count notFound.
    let forgot = ws
        .call(bo(), "memory-forget", json!({ "ids": [shared] }))
        .await;
    assert_eq!(code(&forgot), "MEMORY_AUTHORITY_TOO_LOW", "{forgot}");
    let forgot = ws
        .call(bos_agent(), "memory-forget", json!({ "ids": [shared] }))
        .await;
    assert_eq!(code(&forgot), "MEMORY_AUTHORITY_TOO_LOW", "{forgot}");
    let still = ws.call(ada(), "memory-show", json!({ "id": shared })).await;
    assert_eq!(data(&still)["state"], "live");
    assert_eq!(data(&still)["record"]["recordVersion"], 1, "{still}");
    // Bo's unverified library actor is below person authority, so an invalidation is refused
    // at the same earlier check. The hosted editors suite separately proves that a person at
    // a real terminal without an editors token gets MEMORY_NOT_OWNED. Nothing changes here.
    let by_bo = ws
        .call(
            bo(),
            "memory-invalidate",
            json!({ "id": shared, "reason": "wrong" }),
        )
        .await;
    assert_eq!(code(&by_bo), "MEMORY_AUTHORITY_TOO_LOW", "{by_bo}");
    let history = ws
        .call(
            ada(),
            "memory-show",
            json!({ "id": shared, "history": true }),
        )
        .await;
    assert_eq!(data(&history)["record"]["recordVersion"], 1, "{history}");
    assert_eq!(
        data(&history)["record"]["text"],
        format!("{SHARED} the shared probe fact")
    );
    groups += 1;

    // 8. An idempotency key of ada's gives bo a fresh write, not ada's receipt.
    let bos_capture = ws
        .call(
            bo(),
            "memory-capture",
            capture(
                "probe-s1",
                "claude-code:probe-s1:w1:p0",
                "[user]\nprbbocapture bo's own window\n",
            ),
        )
        .await;
    let bos_capture = data(&bos_capture);
    assert_eq!(
        (
            bos_capture["created"].clone(),
            bos_capture["replayed"].clone()
        ),
        (json!(1), json!(0)),
        "{bos_capture}"
    );
    assert_ne!(bos_capture["records"], data(&adas_capture)["records"]);
    assert_ne!(bos_capture["captureId"], data(&adas_capture)["captureId"]);
    groups += 1;

    // 9. beta's record never appears from alpha.
    let from_alpha = ws
        .call(ada(), "memory-recall", json!({ "query": BETA }))
        .await;
    assert_eq!(data(&from_alpha)["hits"], json!([]));
    let listed = ws.call(ada(), "memory-list", json!({ "limit": 50 })).await;
    assert!(!ids(&listed).contains(&beta));
    let shown = ws.call(ada(), "memory-show", json!({ "id": beta })).await;
    assert_eq!(code(&shown), "MEMORY_NOT_FOUND");
    let bundle = ws
        .call(
            ada(),
            "context-bundle",
            json!({ "task": BETA, "sections": ALL_SECTIONS }),
        )
        .await;
    assert!(!bundled(&bundle).contains(&beta), "{bundle}");
    assert!(!data(&bundle).to_string().contains(&beta));
    let in_beta = ws
        .call(
            ada(),
            "memory-recall",
            json!({ "query": BETA, "space": "beta" }),
        )
        .await;
    assert_eq!(ids(&in_beta), [beta.as_str()]);
    groups += 1;

    // 10. SPACE_NOT_READABLE before any handler: bo's every call in beta, even one whose input
    //     the handler would refuse, and nothing is written there. (AFD's schema check of the
    //     input comes first; it reads no store and says nothing about the space.)
    let beta_files = super::files(&ws.store_dir("beta"));
    let beta_sizes: Vec<u64> = beta_files
        .iter()
        .map(|p| std::fs::metadata(p).map_or(0, |m| m.len()))
        .collect();
    for (command, input, cli) in [
        ("memory-recall", json!({ "query": BETA }), false),
        ("memory-list", json!({}), false),
        ("memory-show", json!({ "id": beta }), false),
        ("memory-status", json!({}), false),
        (
            "memory-remember",
            fact("Bo in beta", "prbbobeta", json!({})),
            false,
        ),
        // The schema admits it and the handler would refuse it (`validUntil` before `validFrom`).
        (
            "memory-remember",
            fact(
                "Bo in beta",
                "prbbobeta",
                json!({ "validFrom": "2026-11-02T00:00:00Z", "validUntil": "2026-11-01T00:00:00Z" }),
            ),
            false,
        ),
        (
            "memory-capture",
            capture("probe-b", "claude-code:probe-b:w1:p0", "[user]\nx\n"),
            false,
        ),
        (
            "memory-invalidate",
            json!({ "id": beta, "reason": "wrong" }),
            false,
        ),
        ("memory-forget", json!({ "ids": [beta] }), false),
        ("memory-export", json!({}), true),
        ("context-bundle", json!({ "task": BETA }), false),
        ("event-list", json!({}), false),
    ] {
        let mut input = input;
        input["space"] = json!("beta");
        let result = if cli {
            ws.cli(bo(), command, input).await
        } else {
            ws.call(bo(), command, input).await
        };
        assert_eq!(code(&result), "SPACE_NOT_READABLE", "{command}: {result}");
        assert!(!result.to_string().contains(BETA), "{result}");
    }
    assert_eq!(super::files(&ws.store_dir("beta")), beta_files);
    let sizes: Vec<u64> = beta_files
        .iter()
        .map(|p| std::fs::metadata(p).map_or(0, |m| m.len()))
        .collect();
    assert_eq!(sizes, beta_sizes, "nothing written in beta");
    groups += 1;

    // 11. A group-shared record follows membership, and a tightened group hides it at once.
    let grouped = ws
        .remember(
            ada(),
            fact(
                "Probe group fact",
                &format!("{GROUP} for the platform group"),
                json!({ "share": "group:platform", "project": "probe" }),
            ),
        )
        .await;
    let read = ws
        .call(bo(), "memory-recall", json!({ "query": GROUP }))
        .await;
    assert_eq!(ids(&read), [grouped.as_str()]);
    let tightened = original.replacen(
        r#"members = ["human:ada", "human:bo"]"#,
        r#"members = ["human:ada"]"#,
        1,
    );
    assert_ne!(tightened, original);
    ws.reconfigure(&tightened);
    let hidden = ws
        .call(bo(), "memory-recall", json!({ "query": GROUP }))
        .await;
    assert_eq!(data(&hidden)["hits"], json!([]));
    let shown = ws.call(bo(), "memory-show", json!({ "id": grouped })).await;
    assert_eq!(code(&shown), "MEMORY_NOT_FOUND");
    let adas = ws
        .call(ada(), "memory-recall", json!({ "query": GROUP }))
        .await;
    assert_eq!(ids(&adas), [grouped.as_str()]);
    groups += 2;

    // 12. With `default_access = "space"`: a shared `agent` record is read by bo and not pushed
    //     to bo by default, and 13. a transcript captured stays private.
    let spaced = tightened.replacen(
        "[plugins.memory.grants.memory_write]\nallow = [\"alpha\", \"beta\"]\n",
        "[plugins.memory.grants.memory_write]\nallow = [\"alpha\", \"beta\"]\ndefault_access = \"space\"\n",
        1,
    );
    assert_ne!(spaced, tightened);
    ws.reconfigure(&spaced);
    let agent_shared = ws
        .call(
            adas_agent(),
            "memory-remember",
            fact(
                "Probe shared agent note",
                &format!("{AGENT_SHARED} an agent's note the space reads"),
                json!({ "project": "probe" }),
            ),
        )
        .await;
    let agent_shared = data(&agent_shared)["id"].as_str().unwrap().to_owned();
    let read = ws
        .call(bo(), "memory-recall", json!({ "query": AGENT_SHARED }))
        .await;
    assert_eq!(ids(&read), [agent_shared.as_str()]);
    assert_eq!(data(&read)["hits"][0]["shared"], true);
    assert_eq!(data(&read)["hits"][0]["authority"], "agent");
    // Below `person`, bo's agent reads it and may not change it: neither its owner nor a
    // sharing writer (6.3).
    ws.at(ws.clock + super::MINUTE);
    let invalidated = ws
        .call(
            bos_agent(),
            "memory-invalidate",
            json!({ "id": agent_shared, "reason": "wrong" }),
        )
        .await;
    assert_eq!(code(&invalidated), "MEMORY_NOT_OWNED", "{invalidated}");
    for input in [
        json!({ "task": AGENT_SHARED, "project": "probe" }),
        json!({ "project": "probe" }),
        json!({}),
    ] {
        let bundle = ws.call(bo(), "context-bundle", input.clone()).await;
        assert!(
            !bundled(&bundle).contains(&agent_shared),
            "{input}: {bundle}"
        );
    }
    let counted = ws
        .call(
            bo(),
            "context-bundle",
            json!({ "task": AGENT_SHARED, "project": "probe" }),
        )
        .await;
    assert!(
        omitted_count(&counted, "semantic", "authority") >= 1,
        "{counted}"
    );
    groups += 1;

    let captured = ws
        .call(
            ada(),
            "memory-capture",
            capture(
                "probe-s2",
                "claude-code:probe-s2:w1:p0",
                &format!("[user]\n{TRANSCRIPT} a window under default_access space\n"),
            ),
        )
        .await;
    let record = data(&captured)["records"][0].as_str().unwrap().to_owned();
    let shown = ws.call(ada(), "memory-show", json!({ "id": record })).await;
    assert_eq!(
        data(&shown)["record"]["access"],
        json!(["principal:human:ada"])
    );
    for actor in [bo(), human("cy")] {
        let read = ws
            .call(actor, "memory-recall", json!({ "query": TRANSCRIPT }))
            .await;
        assert_eq!(data(&read)["hits"], json!([]), "{read}");
    }
    groups += 1;

    // bo's own record was bo's throughout.
    let own = ws.call(bo(), "memory-show", json!({ "id": bos })).await;
    assert_eq!(data(&own)["record"]["scope"]["principal"], "human:bo");

    ws.reconfigure(&original);
    groups
}
