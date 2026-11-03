//! Retention (sections 7.2, 8.8 and 8.11): class defaults; `memory-sweep` with `remaining`; no
//! tombstone and no erased prefix on a purge; keys destroyed on a purge; the purge before a write,
//! kept when the quota refuses the write; orphan keys left by a sweep and removed only by
//! `memory-reindex` with `removeOrphans`; a past `validUntil` kept until `expiresAt`;
//! `expiringSoon`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::*;

fn episode(n: u32) -> Value {
    json!({ "class": "episodic", "subject": format!("Run {n}"), "text": format!("Run {n} passed.") })
}

async fn total(fx: &Fx) -> u64 {
    let status = fx.person("memory-status", json!({})).await;
    data(&status)["counts"]["total"].as_u64().unwrap()
}

async fn sweep(fx: &Fx, input: Value) -> Value {
    fx.cli_person("memory-sweep", input).await
}

#[tokio::test]
async fn each_class_has_its_default_lifetime() {
    let fx = Fx::new();
    for (class, days) in [("episodic", 30), ("semantic", 180), ("procedural", 365)] {
        let result = fx
            .person(
                "memory-remember",
                json!({ "class": class, "subject": class, "text": "A record." }),
            )
            .await;
        assert_eq!(
            millis(&data(&result)["expiresAt"]),
            NOW + days * DAY,
            "{class}"
        );
    }
}

#[tokio::test]
async fn a_sweep_purges_what_is_past_its_purge_date_and_counts_the_rest() {
    let mut fx = Fx::new();
    for n in 0..3 {
        fx.remember(episode(n)).await;
    }
    let live = fx.remember(fact("Live", "A live fact.", json!({}))).await;
    let invalidated = fx
        .remember(fact("Lapsed", "A lapsed fact.", json!({})))
        .await;
    fx.at(NOW + 1000);
    fx.person(
        "memory-invalidate",
        json!({ "id": invalidated, "reason": "outdated" }),
    )
    .await;
    // Nothing is past its purge date yet.
    let early = sweep(&fx, json!({})).await;
    assert_eq!(data(&early), &json!({ "purged": 0, "remaining": 0 }));
    // Day 61: the episodes expired on day 30, and their purge date, 30 days later, has passed.
    fx.at(NOW + 61 * DAY);
    let first = sweep(&fx, json!({ "limit": 1 })).await;
    assert_eq!(
        data(&first),
        &json!({ "purged": 1, "remaining": 2 }),
        "{first}"
    );
    assert!(first["suggestions"][0].as_str().unwrap().contains("again"));
    let rest = sweep(&fx, json!({})).await;
    assert_eq!(data(&rest), &json!({ "purged": 2, "remaining": 0 }));
    assert_eq!(total(&fx).await, 2);
    // Day 91: the invalidation was recorded more than 90 days ago; the live fact stays.
    fx.at(NOW + 91 * DAY);
    let lapsed = sweep(&fx, json!({})).await;
    assert_eq!(data(&lapsed)["purged"], 1, "{lapsed}");
    assert_eq!(code(&fx.show(&invalidated).await), "MEMORY_NOT_FOUND");
    assert_eq!(data(&fx.show(&live).await)["record"]["id"], live.as_str());
    for bad in [json!({ "limit": 0 }), json!({ "limit": 10_001 })] {
        assert_eq!(sweep(&fx, bad).await["success"], false);
    }
}

#[tokio::test]
async fn a_purge_leaves_no_tombstone_no_erased_prefix_and_no_live_key() {
    let mut fx = Fx::new();
    let capture = |key: &str| {
        json!({
            "version": 1, "harness": { "name": "claude-code" }, "event": "stop",
            "session": "s-1", "idempotencyKey": key, "captureKey": "claude-code:s-1:w1",
            "episodes": [{ "subject": "Window", "text": format!("Window text {key}.") }],
        })
    };
    let first = fx.person("memory-capture", capture("k1")).await;
    assert_eq!(data(&first)["created"], 1);
    fx.at(NOW + 61 * DAY);
    assert_eq!(data(&sweep(&fx, json!({})).await)["purged"], 1);
    // A forget would refuse the same window again; a purge erases no prefix, so it is captured.
    let again = fx.person("memory-capture", capture("k2")).await;
    assert_eq!(data(&again)["created"], 1, "{again}");
    assert_eq!(data(&again)["refused"], 0);
    // The purged record's key was destroyed, so it is a marker and never an orphan.
    let reindex = fx.cli_person("memory-reindex", json!({})).await;
    assert_eq!(data(&reindex)["orphans"], 0, "{reindex}");
}

#[tokio::test]
async fn a_write_purges_first_and_the_purge_stays_when_the_quota_refuses_it() {
    let mut fx = Fx::new();
    let default = include_str!("../packs/policy/data/policy.toml");
    let tight = default.replace("bytes_per_hour = 67108864", "bytes_per_hour = 2000");
    fx.pack_override("main", "policy", "data/policy.toml", &tight);
    for n in 0..3 {
        fx.remember(episode(n)).await;
    }
    fx.at(NOW + 61 * DAY);
    // Over the hourly byte limit by itself: refused, after the purge before it committed.
    let big = fx
        .person(
            "memory-remember",
            fact("Big", &"x ".repeat(1500), json!({})),
        )
        .await;
    assert_eq!(code(&big), "MEMORY_QUOTA_EXCEEDED", "{big}");
    assert_eq!(total(&fx).await, 0);
    // And a write that fits purges before itself too.
    let mut fx = Fx::new();
    for n in 0..3 {
        fx.remember(episode(n)).await;
    }
    fx.at(NOW + 61 * DAY);
    fx.remember(fact("New", "A new fact.", json!({}))).await;
    assert_eq!(total(&fx).await, 1);
    // The purge before a write makes no event of its own (section 8.10).
    let commands: Vec<String> = fx
        .events("main")
        .iter()
        .map(|e| e["command"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(commands, vec!["memory-remember"; 4]);
}

#[tokio::test]
async fn orphan_keys_survive_a_sweep_and_go_only_when_asked() {
    let mut fx = Fx::new();
    fx.remember(fact("Kept", "Written first.", json!({}))).await;
    let forgotten = fx.remember(fact("Forgotten", "A marker.", json!({}))).await;
    fx.person("memory-forget", json!({ "ids": [forgotten] }))
        .await;
    let database = fx.copy_out("memory.sqlite3");
    fx.remember(fact("Later", "Written after the copy.", json!({})))
        .await;
    // The older database put back: the later record's key has no row.
    fx.put_back("memory.sqlite3", &database);
    fx.at(NOW + 400 * DAY);
    let swept = sweep(&fx, json!({})).await;
    assert_eq!(data(&swept)["purged"], 1, "{swept}");
    let counted = fx.cli_person("memory-reindex", json!({})).await;
    let d = data(&counted);
    // The marker of the forgotten record is never an orphan.
    assert_eq!(
        (d["orphans"].as_u64(), d["orphansRemoved"].as_u64()),
        (Some(1), Some(0)),
        "{counted}"
    );
    let suggestion = counted["suggestions"][0].as_str().unwrap();
    assert!(suggestion.contains("removeOrphans = true only on the database you mean to keep"));
    let removed = fx
        .cli_person("memory-reindex", json!({ "removeOrphans": true }))
        .await;
    assert_eq!(data(&removed)["orphansRemoved"], 1, "{removed}");
    assert!(removed.get("suggestions").is_none());
    let after = fx.cli_person("memory-reindex", json!({})).await;
    assert_eq!(data(&after)["orphans"], 0);
    // Both are the command line's alone.
    for command in ["memory-sweep", "memory-reindex"] {
        let over_mcp = fx.person(command, json!({})).await;
        assert_eq!(code(&over_mcp), "COMMAND_NOT_EXPOSED", "{command}");
    }
}

#[tokio::test]
async fn a_past_valid_until_waits_for_its_expiry() {
    let mut fx = Fx::new();
    let id = fx
        .remember(fact(
            "Old server",
            "Server X ran the build until last year.",
            json!({ "validFrom": umbel_store::memory::format_instant(NOW - 100 * DAY),
                    "validUntil": umbel_store::memory::format_instant(NOW - 50 * DAY) }),
        ))
        .await;
    // It has no invalidation, so only its expiry (day 180) and purge age (90) count.
    fx.at(NOW + 100 * DAY);
    assert_eq!(data(&sweep(&fx, json!({})).await)["purged"], 0);
    assert_eq!(data(&fx.show(&id).await)["state"], "invalidated");
    fx.at(NOW + 271 * DAY);
    assert_eq!(data(&sweep(&fx, json!({})).await)["purged"], 1);
    assert_eq!(code(&fx.show(&id).await), "MEMORY_NOT_FOUND");
}

#[tokio::test]
async fn status_counts_what_expires_soon() {
    let fx = Fx::new();
    fx.remember(fact(
        "Soon",
        "Expires in ten days.",
        json!({ "ttlDays": 10 }),
    ))
    .await;
    fx.remember(fact("Later", "Expires in half a year.", json!({})))
        .await;
    let status = fx.person("memory-status", json!({})).await;
    let semantic = &data(&status)["counts"]["byClass"]["semantic"];
    assert_eq!(semantic["live"], 2, "{status}");
    assert_eq!(semantic["expiringSoon"], 1, "{status}");
}
