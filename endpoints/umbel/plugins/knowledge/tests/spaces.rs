//! Spaces (specification section 8.4): one space unless the query names several, each searched
//! with its own reader filter, fused by rank, labeled, never written back; an unreadable space is
//! refused for the whole call.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::*;

async fn two_spaces(config: &str) -> Fx {
    let fx = Fx::with(config);
    // The same pseudo-words in both spaces, so a leak between them would be visible.
    fx.handbook("main-note.md", "# Main note\n\nvaltrin osmerid in main\n");
    fx.handbook("main-other.md", "# Main other\n\nvaltrin only in main\n");
    fx.note("beta-note.md", "# Beta note\n\nvaltrin osmerid in beta\n");
    fx.note("beta-only.md", "# Beta only\n\nosmerid only in beta\n");
    // Whoever may read both spaces refreshes them.
    fx.refresh_as(member(), "main").await;
    fx.refresh_as(member(), "beta").await;
    fx
}

fn labels(result: &Value) -> Vec<(String, String)> {
    data(result)["hits"]
        .as_array()
        .unwrap()
        .iter()
        .map(|hit| {
            (
                hit["space"].as_str().unwrap().to_owned(),
                hit["doc"].as_str().unwrap().to_owned(),
            )
        })
        .collect()
}

#[tokio::test]
async fn a_single_space_query_never_returns_another_space() {
    let fx = two_spaces(CONFIG).await;
    for (space, expected) in [("main", "main"), ("beta", "beta")] {
        let result = fx
            .search(
                human("local"),
                json!({ "query": "valtrin osmerid", "space": space }),
            )
            .await;
        let found = labels(&result);
        assert!(!found.is_empty());
        assert!(found.iter().all(|(s, _)| s == expected), "{found:?}");
    }
    // The default space is main.
    let result = fx
        .search(human("local"), json!({ "query": "osmerid" }))
        .await;
    assert!(labels(&result).iter().all(|(s, _)| s == "main"), "{result}");
}

#[tokio::test]
async fn a_multi_space_query_labels_fuses_and_ranks_by_reciprocal_rank() {
    let fx = two_spaces(CONFIG).await;
    let result = fx
        .search(
            human("local"),
            json!({ "query": "valtrin osmerid", "spaces": ["main", "beta"] }),
        )
        .await;
    let found = labels(&result);
    let spaces: Vec<&str> = found.iter().map(|(s, _)| s.as_str()).collect();
    assert!(
        spaces.contains(&"main") && spaces.contains(&"beta"),
        "{found:?}"
    );
    assert_eq!(data(&result)["spaces"], json!(["main", "beta"]));
    let hits = data(&result)["hits"].as_array().unwrap();
    // Fused scores are 1 / (60 + rank), per space ranks from 1; ties by space then document id.
    assert_eq!(hits[0]["score"], 0.0164);
    assert_eq!(hits[1]["score"], 0.0164);
    assert_eq!(
        (hits[0]["space"].as_str(), hits[1]["space"].as_str()),
        (Some("beta"), Some("main"))
    );
    for hit in hits {
        assert!(
            hit["spaceScore"].as_f64().unwrap() > 0.0,
            "the space's own BM25 score is kept: {hit}"
        );
    }
    // Both spaces' index states are reported.
    let index = &result["metadata"]["dev.umbel/index"];
    assert!(
        index["main"]["applied"].as_u64().unwrap() > 0
            && index["beta"]["applied"].as_u64().unwrap() > 0
    );
    // Sources are labeled by space.
    let ids: Vec<&str> = result["sources"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["id"].as_str().unwrap())
        .collect();
    assert!(
        ids.iter().any(|id| id.starts_with("main:"))
            && ids.iter().any(|id| id.starts_with("beta:"))
    );
}

#[tokio::test]
async fn a_multi_space_search_writes_nothing_back() {
    let fx = two_spaces(CONFIG).await;
    let events = |space: &'static str| {
        let fx = &fx;
        async move {
            let list = fx.cli("event-list", json!({ "space": space })).await;
            data(&list)["events"].as_array().unwrap().len()
        }
    };
    let (main_before, beta_before) = (events("main").await, events("beta").await);
    let changes_before = fx
        .cli("knowledge-changes", json!({ "space": "main" }))
        .await;
    for _ in 0..3 {
        let result = fx
            .search(
                human("local"),
                json!({ "query": "osmerid", "spaces": ["main", "beta"] }),
            )
            .await;
        assert_eq!(result["success"], true);
    }
    assert_eq!(
        (events("main").await, events("beta").await),
        (main_before, beta_before)
    );
    let changes_after = fx
        .cli("knowledge-changes", json!({ "space": "main" }))
        .await;
    assert_eq!(changes_before["data"], changes_after["data"]);
}

#[tokio::test]
async fn the_spaces_argument_is_validated_before_anything_runs() {
    let fx = two_spaces(CONFIG).await;
    let both = fx
        .search(
            human("local"),
            json!({ "query": "x", "space": "main", "spaces": ["main", "beta"] }),
        )
        .await;
    assert_eq!(code(&both), "VALIDATION_ERROR", "{both}");
    for spaces in [
        json!(["main"]),
        json!(["main", "main"]),
        json!(["main", "nowhere"]),
    ] {
        let result = fx
            .search(
                human("local"),
                json!({ "query": "x", "spaces": spaces.clone() }),
            )
            .await;
        assert_eq!(result["success"], false, "{spaces}: {result}");
    }
    let unknown = fx
        .search(
            human("local"),
            json!({ "query": "x", "spaces": ["main", "nowhere"] }),
        )
        .await;
    assert_eq!(code(&unknown), "SPACE_NOT_FOUND", "{unknown}");
    let nine: Vec<String> = (0..9).map(|n| format!("s{n}")).collect();
    let too_many = fx
        .search(human("local"), json!({ "query": "x", "spaces": nine }))
        .await;
    assert_eq!(code(&too_many), "VALIDATION_ERROR");
}

#[tokio::test]
async fn an_unreadable_space_refuses_the_whole_multi_space_query() {
    let fx = two_spaces(&config_with_private_beta()).await;
    // The outsider may read main but not beta.
    let alone = fx
        .search(outsider(), json!({ "query": "valtrin", "space": "main" }))
        .await;
    assert_eq!(alone["success"], true, "{alone}");
    let both = fx
        .search(
            outsider(),
            json!({ "query": "valtrin", "spaces": ["main", "beta"] }),
        )
        .await;
    assert_eq!(code(&both), "SPACE_NOT_READABLE", "{both}");
    never_mentions(&both, &["beta-note", "beta-only", "osmerid in beta"]);
    assert!(
        both.get("data").is_none(),
        "nothing from main either: {both}"
    );
    let beta = fx
        .search(outsider(), json!({ "query": "valtrin", "space": "beta" }))
        .await;
    assert_eq!(code(&beta), "SPACE_NOT_READABLE");
    // A member reads both.
    let member_both = fx
        .search(
            member(),
            json!({ "query": "valtrin", "spaces": ["main", "beta"] }),
        )
        .await;
    assert_eq!(member_both["success"], true, "{member_both}");
}

#[tokio::test]
async fn documents_of_another_space_are_not_found() {
    let fx = two_spaces(CONFIG).await;
    for (command, input) in [
        ("knowledge-open", json!({ "doc": "notes/beta-note" })),
        ("knowledge-describe", json!({ "doc": "notes/beta-note" })),
        (
            "knowledge-find",
            json!({ "doc": "notes/beta-note", "pattern": "valtrin" }),
        ),
    ] {
        let result = fx.as_actor(human("local"), command, input).await;
        assert_eq!(code(&result), "DOCUMENT_NOT_FOUND", "{command}: {result}");
    }
    // The same call in its own space works.
    let result = fx
        .as_actor(
            human("local"),
            "knowledge-open",
            json!({ "space": "beta", "doc": "notes/beta-note" }),
        )
        .await;
    assert_eq!(result["success"], true, "{result}");
}
