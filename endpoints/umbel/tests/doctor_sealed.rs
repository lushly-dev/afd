//! The doctor on a sealed host (specification section 2): the registry-dependent checks that
//! `doctor::run` can only `skip`, and the result shapes of `workspace-doctor`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::{Actor, ActorKind};
use serde_json::{Value, json};
use support::*;

async fn doctor(host: &umbel::Host) -> afd::CommandResult<Value> {
    host.registry()
        .execute(
            "workspace-doctor",
            json!({}),
            Some(host.context(Actor::new(ActorKind::Test).with_id("t"))),
        )
        .await
}

fn check<'a>(data: &'a Value, id: &str) -> &'a Value {
    data["checks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == id)
        .unwrap_or_else(|| panic!("no check {id}"))
}

#[tokio::test]
async fn a_sealed_host_runs_the_two_checks_the_unopened_doctor_skips() {
    let dir = minimal();
    let skipped = umbel::doctor::run(dir.path());
    let skipped = skipped.data();
    assert_eq!(check(&skipped, "mcp.surface")["status"], "skip");
    assert_eq!(check(&skipped, "cli.verbs")["status"], "skip");
    assert_eq!(skipped["healthy"], true);

    let host = host(dir.path());
    let result = doctor(&host).await;
    assert!(result.success, "{result:?}");
    let data = result.data.unwrap();
    assert_eq!(data["healthy"], true);
    assert_eq!(check(&data, "mcp.surface")["status"], "pass");
    assert_eq!(check(&data, "cli.verbs")["status"], "pass");
    assert!(
        check(&data, "mcp.surface")["message"]
            .as_str()
            .unwrap()
            .contains("workspace-show")
    );
    assert_eq!(
        data["checks"].as_array().unwrap().len(),
        skipped["checks"].as_array().unwrap().len(),
        "the same checks, in the same order"
    );
    for (sealed, unopened) in data["checks"]
        .as_array()
        .unwrap()
        .iter()
        .zip(skipped["checks"].as_array().unwrap())
    {
        assert_eq!(sealed["id"], unopened["id"]);
    }
}

#[tokio::test]
async fn an_unhealthy_workspace_is_a_failure_that_carries_the_report() {
    let dir = minimal();
    let host = host(dir.path());
    // An unparsable entry before the last line.
    std::fs::write(
        dir.path().join("state/journal.jsonl"),
        "garbage\n{\"seq\":2}\n",
    )
    .unwrap();
    let result = doctor(&host).await;
    assert!(!result.success);
    let error = result.error.unwrap();
    assert_eq!(error.code, "WORKSPACE_UNHEALTHY");
    assert!(!error.suggestion.unwrap().is_empty());
    let details = error.details.unwrap();
    assert_eq!(details["healthy"], false);
    let failing: Vec<&Value> = details["checks"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["status"] == "fail")
        .collect();
    assert_eq!(failing[0]["id"], "journal.readable");
}
