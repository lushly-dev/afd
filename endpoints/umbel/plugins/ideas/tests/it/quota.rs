//! The host's records write quota (D212), through `ideas-capture` on a real host: one writer
//! past `limits.kind_records` is answered `QUOTA_EXCEEDED` with the host's code and the limit,
//! and another writer to the same kind is not held up by it.
use crate::support;
use serde_json::json;
use support::*;

/// The fixture's configuration at version 8, with each principal allowed `records` records of
/// each declared kind.
fn config_with_quota(records: u64) -> String {
    format!(
        "{}\n[limits]\nkind_records = {records}\n",
        config().replace("config_version = 6", "config_version = 8")
    )
}

fn idea(statement: &str) -> serde_json::Value {
    json!({ "statement": statement, "type": "position", "said": "person" })
}

#[tokio::test]
async fn a_writer_past_its_records_quota_is_refused_and_another_writer_is_not() {
    let fx = Fx::with(&config_with_quota(1));
    let first = fx
        .agent(
            "ideas-capture",
            json!({ "ideas": [idea("Raised beds warm earlier in spring.")] }),
        )
        .await;
    assert_eq!(data(&first)["captured"], 1, "{first}");
    let refused = fx
        .agent(
            "ideas-capture",
            json!({ "ideas": [idea("Mulch keeps the soil cool through the summer.")] }),
        )
        .await;
    assert_eq!(code(&refused), "QUOTA_EXCEEDED", "{refused}");
    assert_eq!(refused["error"]["details"]["host"], "RECORD_QUOTA_EXCEEDED");
    assert_eq!(refused["error"]["details"]["limit"], "kind_records");
    assert_eq!(refused["error"]["retryable"], false, "{refused}");
    let suggestion = refused["error"]["suggestion"].as_str().unwrap();
    assert!(suggestion.contains("limits.kind_records"), "{suggestion}");
    // Another principal writes to the same kinds.
    let other = fx
        .stranger(
            "ideas-capture",
            json!({ "ideas": [idea("Water the beans at dawn, before the heat.")] }),
        )
        .await;
    assert_eq!(data(&other)["captured"], 1, "{other}");
    // The first writer's idea is still found, and matching still runs over the kind.
    let found = fx.agent("ideas-find", json!({ "text": "beds" })).await;
    assert!(
        found
            .to_string()
            .contains("Raised beds warm earlier in spring."),
        "{found}"
    );
}

#[tokio::test]
async fn past_its_postings_a_keyed_capture_keeps_what_it_wrote_and_finishes_once_raised() {
    let mut fx = Fx::with(&format!(
        "{}\n[limits]\nkind_postings = 10\n",
        config().replace("config_version = 6", "config_version = 8")
    ));
    let first = fx
        .agent(
            "ideas-capture",
            json!({ "ideas": [idea("Raised beds warm earlier in spring.")] }),
        )
        .await;
    assert_eq!(data(&first)["captured"], 1, "{first}");
    // The idea record holds no text and is written; its wording passes the postings, and is not.
    let call = json!({
        "ideas": [idea("Mulch keeps the soil cool and holds water through the summer.")],
        "idempotencyKey": "mulch-once",
    });
    let refused = fx.agent("ideas-capture", call.clone()).await;
    assert_eq!(code(&refused), "QUOTA_EXCEEDED", "{refused}");
    assert_eq!(refused["error"]["details"]["limit"], "kind_postings");
    let message = refused["error"]["message"].as_str().unwrap();
    assert!(message.contains("before the refusal stay"), "{message}");
    assert!(
        !message.contains("nothing was written"),
        "a capture may have written its idea: {message}"
    );
    // The operator raises the limit, and the same call finishes what the first wrote.
    std::fs::write(
        fx.path("umbel.toml"),
        format!(
            "{}\n[limits]\nkind_postings = 1000\n",
            config().replace("config_version = 6", "config_version = 8")
        ),
    )
    .unwrap();
    let clock = fx.clock;
    fx.at(clock);
    let finished = fx.agent("ideas-capture", call).await;
    assert_eq!(data(&finished)["captured"], 1, "{finished}");
    assert_eq!(data(&finished)["replayed"], true, "{finished}");
    let found = fx.agent("ideas-find", json!({ "text": "mulch" })).await;
    assert!(
        found.to_string().contains("Mulch keeps the soil cool"),
        "{found}"
    );
}
