//! Command behaviour, mirroring `spec/test-cases.json` and the TypeScript backend.

use super::register_commands;
use crate::store::TodoStore;
use afd::{CommandRegistry, CommandResult};
use serde_json::{json, Value};
use std::sync::Arc;

fn registry() -> CommandRegistry {
    let mut registry = CommandRegistry::new();
    register_commands(&mut registry, &Arc::new(TodoStore::default())).expect("commands register");
    registry
}

async fn call(registry: &CommandRegistry, name: &str, input: Value) -> Value {
    let result: CommandResult<Value> = registry.execute(name, input, None).await;
    serde_json::to_value(result).expect("results serialize")
}

async fn create(registry: &CommandRegistry, title: &str) -> String {
    let result = call(registry, "todo-create", json!({ "title": title })).await;
    result["data"]["id"]
        .as_str()
        .expect("todo-create returns an id")
        .to_string()
}

#[tokio::test]
async fn registers_all_eleven_spec_commands_exposed_to_mcp_and_cli() {
    let registry = registry();
    let mut names: Vec<String> = registry.list().iter().map(|c| c.name.clone()).collect();
    names.sort();
    assert_eq!(
        names,
        [
            "todo-clear",
            "todo-create",
            "todo-create-batch",
            "todo-delete",
            "todo-delete-batch",
            "todo-get",
            "todo-list",
            "todo-stats",
            "todo-toggle",
            "todo-toggle-batch",
            "todo-update",
        ]
    );
    for command in registry.list() {
        assert!(command.expose.mcp && command.expose.cli, "{}", command.name);
    }
}

#[tokio::test]
async fn optional_fields_are_not_declared_required() {
    let registry = registry();
    for name in ["todo-list", "todo-update"] {
        let command = registry.get(name).expect("registered");
        let completed = command
            .parameters
            .iter()
            .find(|p| p.name == "completed")
            .expect("has a completed parameter");
        assert!(!completed.required, "{name}.completed must be optional");
    }
}

#[tokio::test]
async fn create_applies_defaults_and_enforces_the_title_limit() {
    let registry = registry();
    let created = call(&registry, "todo-create", json!({ "title": "Task" })).await;
    assert_eq!(created["data"]["priority"], "medium");
    assert_eq!(created["data"]["completed"], false);
    assert!(created["data"].get("completedAt").is_none());

    let exact = call(
        &registry,
        "todo-create",
        json!({ "title": "x".repeat(200) }),
    )
    .await;
    assert_eq!(exact["success"], true);

    let long = call(
        &registry,
        "todo-create",
        json!({ "title": "x".repeat(201) }),
    )
    .await;
    assert_eq!(long["error"]["code"], "VALIDATION_ERROR");
    assert!(long["error"]["suggestion"].is_string());
}

#[tokio::test]
async fn validation_errors_carry_paths_and_missing_fields() {
    let registry = registry();
    let missing = call(&registry, "todo-create", json!({})).await;
    assert_eq!(missing["error"]["details"]["missingFields"][0], "title");
    assert_eq!(missing["error"]["details"]["errors"][0]["path"], "title");

    let wrong = call(&registry, "todo-create", json!({ "title": 123 })).await;
    assert_eq!(wrong["error"]["details"]["errors"][0]["path"], "title");

    let bad = call(
        &registry,
        "todo-create",
        json!({ "title": "x", "priority": "urgent" }),
    )
    .await;
    assert_eq!(bad["error"]["code"], "VALIDATION_ERROR");
}

#[tokio::test]
async fn list_reports_the_total_before_pagination() {
    let registry = registry();
    for title in ["One", "Two", "Three"] {
        create(&registry, title).await;
    }

    let page = call(&registry, "todo-list", json!({ "limit": 2 })).await;
    assert_eq!(page["data"]["total"], 3);
    assert_eq!(page["data"]["todos"].as_array().map(Vec::len), Some(2));
    assert_eq!(page["data"]["hasMore"], true);

    let last = call(&registry, "todo-list", json!({ "limit": 2, "offset": 2 })).await;
    assert_eq!(last["data"]["total"], 3);
    assert_eq!(last["data"]["hasMore"], false);

    // Newest first by default.
    assert_eq!(page["data"]["todos"][0]["title"], "Three");

    let too_big = call(&registry, "todo-list", json!({ "limit": 101 })).await;
    assert_eq!(too_big["error"]["code"], "VALIDATION_ERROR");
}

#[tokio::test]
async fn list_filters_before_counting() {
    let registry = registry();
    let done = create(&registry, "Done").await;
    create(&registry, "Pending").await;
    call(&registry, "todo-toggle", json!({ "id": done })).await;

    let completed = call(&registry, "todo-list", json!({ "completed": true })).await;
    assert_eq!(completed["data"]["total"], 1);
    assert_eq!(completed["data"]["todos"][0]["title"], "Done");

    let search = call(&registry, "todo-list", json!({ "search": "PEND" })).await;
    assert_eq!(search["data"]["total"], 1);
}

#[tokio::test]
async fn update_checks_for_changes_before_existence() {
    let registry = registry();
    let id = create(&registry, "Task").await;

    let none = call(&registry, "todo-update", json!({ "id": "missing" })).await;
    assert_eq!(none["error"]["code"], "NO_CHANGES");
    assert!(none["error"]["suggestion"].is_string());

    let missing = call(
        &registry,
        "todo-update",
        json!({ "id": "missing", "title": "New" }),
    )
    .await;
    assert_eq!(missing["error"]["code"], "NOT_FOUND");
    assert!(missing["error"]["suggestion"].is_string());

    let done = call(
        &registry,
        "todo-update",
        json!({ "id": id, "completed": true }),
    )
    .await;
    assert_eq!(done["data"]["completed"], true);
    assert!(done["data"]["completedAt"].is_string());
}

#[tokio::test]
async fn toggling_twice_clears_completed_at() {
    let registry = registry();
    let id = create(&registry, "Task").await;
    call(&registry, "todo-toggle", json!({ "id": id })).await;
    let back = call(&registry, "todo-toggle", json!({ "id": id })).await;
    assert_eq!(back["data"]["completed"], false);
    assert!(back["data"].get("completedAt").is_none());
}

#[tokio::test]
async fn delete_and_clear_report_counts() {
    let registry = registry();
    let first = create(&registry, "First").await;
    create(&registry, "Second").await;

    let deleted = call(&registry, "todo-delete", json!({ "id": first })).await;
    assert_eq!(deleted["data"], json!({ "deleted": true, "id": first }));
    let again = call(&registry, "todo-delete", json!({ "id": first })).await;
    assert_eq!(again["error"]["code"], "NOT_FOUND");

    let completed_only = call(&registry, "todo-clear", json!({})).await;
    assert_eq!(
        completed_only["data"],
        json!({ "cleared": 0, "remaining": 1 })
    );
    let all = call(&registry, "todo-clear", json!({ "all": true })).await;
    assert_eq!(all["data"], json!({ "cleared": 1, "remaining": 0 }));
}

#[tokio::test]
async fn stats_count_priorities_and_completion() {
    let registry = registry();
    let done = create(&registry, "Done").await;
    create(&registry, "Pending").await;
    call(&registry, "todo-toggle", json!({ "id": done })).await;

    let stats = call(&registry, "todo-stats", json!({})).await;
    assert_eq!(stats["data"]["byPriority"]["medium"], 2);
    assert_eq!(stats["data"]["completionRate"], 0.5);
    assert_eq!(stats["data"]["pending"], 1);
}

#[tokio::test]
async fn create_batch_reports_partial_failures() {
    let registry = registry();
    let result = call(
        &registry,
        "todo-create-batch",
        json!({ "todos": [{ "title": "Valid", "priority": "high" }, { "title": "   " }] }),
    )
    .await;

    assert_eq!(result["success"], true);
    assert_eq!(result["data"]["succeeded"][0]["priority"], "high");
    assert_eq!(result["data"]["failed"][0]["index"], 1);
    assert_eq!(
        result["data"]["failed"][0]["error"]["code"],
        "VALIDATION_ERROR"
    );
    assert!(result["data"]["failed"][0]["error"]["suggestion"].is_string());
    assert_eq!(
        result["data"]["summary"],
        json!({ "total": 2, "successCount": 1, "failureCount": 1 })
    );
    assert_eq!(result["warnings"][0]["code"], "PARTIAL_SUCCESS");
    assert_eq!(result["confidence"], 0.5);

    let empty = call(&registry, "todo-create-batch", json!({ "todos": [] })).await;
    assert_eq!(empty["error"]["code"], "VALIDATION_ERROR");
}

#[tokio::test]
async fn delete_batch_reports_missing_ids() {
    let registry = registry();
    let id = create(&registry, "Delete me").await;
    let result = call(
        &registry,
        "todo-delete-batch",
        json!({ "ids": [id, "missing-id"] }),
    )
    .await;

    assert_eq!(result["data"]["deletedIds"], json!([id]));
    assert_eq!(result["data"]["failed"][0]["id"], "missing-id");
    assert_eq!(result["data"]["failed"][0]["error"]["code"], "NOT_FOUND");
    assert_eq!(result["warnings"][0]["code"], "DESTRUCTIVE_BATCH");
    assert_eq!(result["warnings"][1]["code"], "PARTIAL_SUCCESS");
}

#[tokio::test]
async fn toggle_batch_toggles_or_sets() {
    let registry = registry();
    let first = create(&registry, "First").await;
    let second = create(&registry, "Second").await;
    call(&registry, "todo-toggle", json!({ "id": second })).await;

    let flipped = call(
        &registry,
        "todo-toggle-batch",
        json!({ "ids": [first, second] }),
    )
    .await;
    assert_eq!(flipped["data"]["succeeded"][0]["completed"], true);
    assert_eq!(flipped["data"]["succeeded"][1]["completed"], false);
    assert_eq!(flipped["data"]["summary"]["markedComplete"], 1);
    assert_eq!(flipped["data"]["summary"]["markedIncomplete"], 1);

    let set = call(
        &registry,
        "todo-toggle-batch",
        json!({ "ids": [first, second], "completed": true }),
    )
    .await;
    assert_eq!(set["data"]["summary"]["markedComplete"], 2);
    assert_eq!(set["data"]["summary"]["markedIncomplete"], 0);
}
