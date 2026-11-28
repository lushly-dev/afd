//! Command behaviour, mirroring `spec/test-cases.json` and the TypeScript backend.

use crate::app::{self, Approvals};
use crate::store::TodoStore;
use afd::{fixed_clock, seeded_random, ActorKind, CommandContext, CommandRegistry, CommandResult};
use serde_json::{json, Value};
use std::sync::Arc;

const SECRET: &[u8] = b"a test approval secret of 32 bytes or more";

fn registry() -> Arc<CommandRegistry> {
    app::registry(Arc::new(TodoStore::new()), Approvals::Off, SECRET).expect("commands register")
}

async fn call_with(
    registry: &CommandRegistry,
    name: &str,
    input: Value,
    context: CommandContext,
) -> Value {
    let result: CommandResult<Value> = registry.execute(name, input, Some(context)).await;
    serde_json::to_value(result).expect("results serialize")
}

async fn call(registry: &CommandRegistry, name: &str, input: Value) -> Value {
    call_with(registry, name, input, CommandContext::new()).await
}

async fn create(registry: &CommandRegistry, title: &str) -> String {
    let result = call(registry, "todo-create", json!({ "title": title })).await;
    result["data"]["id"]
        .as_str()
        .expect("todo-create returns an id")
        .to_string()
}

/// The shared contract, `spec/commands.schema.json`: the commands Rust implements, those without
/// `implementedBy` or naming it.
fn spec_commands() -> serde_json::Map<String, Value> {
    let spec: Value = serde_json::from_str(include_str!("../../../../spec/commands.schema.json"))
        .expect("the spec is JSON");
    spec["commands"]
        .as_object()
        .expect("commands")
        .iter()
        .filter(|(_, entry)| {
            entry["implementedBy"]
                .as_array()
                .is_none_or(|languages| languages.iter().any(|language| language == "rust"))
        })
        .map(|(name, entry)| (name.clone(), entry.clone()))
        .collect()
}

fn names(value: &Value) -> Vec<&str> {
    let mut names: Vec<&str> = value
        .as_object()
        .map(|properties| properties.keys().map(String::as_str).collect())
        .unwrap_or_default();
    names.sort_unstable();
    names
}

#[test]
fn defines_exactly_the_spec_commands_with_their_metadata_and_inputs() {
    let defined = crate::commands(Arc::new(TodoStore::new()));
    let spec = spec_commands();
    let mut defined_names: Vec<&str> = defined.iter().map(|(c, _)| c.name.as_str()).collect();
    defined_names.sort_unstable();
    let mut expected: Vec<&str> = spec.keys().map(String::as_str).collect();
    expected.sort_unstable();
    assert_eq!(defined_names, expected);

    for (command, schema) in &defined {
        let name = command.name.as_str();
        assert!(command.expose.mcp && command.expose.cli, "{name}");
        assert!(command.title.is_some(), "{name} has a title");
        assert!(command.returns.is_some(), "{name} declares its output");
        assert!(
            command.examples.as_ref().is_some_and(|e| !e.is_empty()),
            "{name} has examples"
        );
        let entry = &spec[name];
        let metadata = &entry["metadata"];
        assert_eq!(json!(command.mutation), metadata["mutation"], "{name}");
        assert_eq!(
            json!(command.destructive.unwrap_or(false)),
            metadata["destructive"],
            "{name}"
        );
        assert_eq!(
            command.confirm_prompt.as_deref(),
            metadata["confirmPrompt"].as_str(),
            "{name}"
        );
        assert_eq!(json!(command.contexts), metadata["contexts"], "{name}");
        // Every change declares an approval policy, and what it promises about repeats, so
        // `afd validate --surface` reports no undeclared mutation (`spec/idempotency.md`, D4).
        assert_eq!(command.approval.is_some(), command.mutation, "{name}");
        assert_eq!(command.idempotency.is_some(), command.mutation, "{name}");
        assert_eq!(json!(command.idempotency), entry["idempotency"], "{name}");

        // The input declares the spec's properties, those for other languages left out.
        let properties: serde_json::Map<String, Value> = entry["input"]["properties"]
            .as_object()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|(_, property)| {
                property["x-implementedBy"]
                    .as_array()
                    .is_none_or(|languages| languages.iter().any(|l| l == "rust"))
            })
            .collect();
        assert_eq!(
            names(&schema["properties"]),
            names(&Value::Object(properties)),
            "{name}"
        );
        assert_eq!(schema["required"], entry["input"]["required"], "{name}");
    }
}

#[tokio::test]
async fn create_applies_defaults_and_enforces_the_title_limit() {
    let registry = registry();
    let created = call(&registry, "todo-create", json!({ "title": "Task" })).await;
    assert_eq!(created["data"]["priority"], "medium");
    assert_eq!(created["data"]["completed"], false);
    assert!(created["data"].get("completedAt").is_none());
    assert_eq!(created["undoCommand"], "todo-delete");
    assert_eq!(created["undoArgs"], json!({ "id": created["data"]["id"] }));

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
async fn ids_and_times_come_from_the_context() {
    let registry = registry();
    let context = || {
        CommandContext::new()
            .with_clock(fixed_clock(1_700_000_000_000_i64))
            .with_random(seeded_random("todo"))
    };
    let first = call_with(
        &registry,
        "todo-create",
        json!({ "title": "Seeded" }),
        context(),
    )
    .await;
    // TypeScript's `stampFrom` with `seededRandom('todo')` at this time makes the same id.
    assert_eq!(first["data"]["id"], "todo-1700000000000-w76p4ky");
    assert_eq!(first["data"]["createdAt"], "2023-11-14T22:13:20.000Z");

    // The same seed and clock give the same id, as a replay needs.
    let again = app::registry(Arc::new(TodoStore::new()), Approvals::Off, SECRET).unwrap();
    let second = call_with(
        &again,
        "todo-create",
        json!({ "title": "Seeded" }),
        context(),
    )
    .await;
    assert_eq!(second["data"]["id"], first["data"]["id"]);
}

#[tokio::test]
async fn validation_errors_carry_paths_and_missing_fields() {
    let registry = registry();
    let missing = call(&registry, "todo-create", json!({})).await;
    assert_eq!(missing["error"]["code"], "VALIDATION_ERROR");
    assert_eq!(missing["error"]["details"]["missingFields"][0], "title");

    let wrong = call(&registry, "todo-create", json!({ "title": 123 })).await;
    assert_eq!(wrong["error"]["details"]["errors"][0]["path"], "title");

    let bad = call(
        &registry,
        "todo-create",
        json!({ "title": "x", "priority": "urgent" }),
    )
    .await;
    assert_eq!(bad["error"]["code"], "VALIDATION_ERROR");
    assert!(bad["error"]["suggestion"].is_string());
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
    assert!(page.get("alternatives").is_none(), "unfiltered");

    let last = call(&registry, "todo-list", json!({ "limit": 2, "offset": 2 })).await;
    assert_eq!(last["data"]["total"], 3);
    assert_eq!(last["data"]["hasMore"], false);

    let too_big = call(&registry, "todo-list", json!({ "limit": 101 })).await;
    assert_eq!(too_big["error"]["code"], "VALIDATION_ERROR");
}

#[tokio::test]
async fn equal_times_keep_the_order_todos_were_added_in_both_directions() {
    let registry = registry();
    let at = || CommandContext::new().with_clock(fixed_clock(1_700_000_000_000_i64));
    for title in ["First", "Second", "Third"] {
        call_with(&registry, "todo-create", json!({ "title": title }), at()).await;
    }
    for order in ["asc", "desc"] {
        let listed = call(&registry, "todo-list", json!({ "sortOrder": order })).await;
        let titles: Vec<&str> = listed["data"]["todos"]
            .as_array()
            .expect("todos")
            .iter()
            .filter_map(|todo| todo["title"].as_str())
            .collect();
        assert_eq!(titles, ["First", "Second", "Third"], "{order}");
    }
}

#[tokio::test]
async fn a_filtered_list_offers_the_unfiltered_and_the_opposite_view() {
    let registry = registry();
    let done = create(&registry, "Done").await;
    create(&registry, "Pending").await;
    call(&registry, "todo-toggle", json!({ "id": done })).await;

    let completed = call(&registry, "todo-list", json!({ "completed": true })).await;
    assert_eq!(completed["data"]["total"], 1);
    assert_eq!(completed["data"]["todos"][0]["title"], "Done");
    assert_eq!(
        completed["reasoning"],
        "Found 1 todos (completed), returning 1 starting at offset 0"
    );
    let alternatives = completed["alternatives"].as_array().expect("alternatives");
    assert_eq!(alternatives.len(), 2);
    assert_eq!(alternatives[0]["data"]["total"], 2);
    assert_eq!(
        alternatives[0]["reason"],
        "View all 2 todos without filters"
    );
    assert_eq!(alternatives[1]["data"]["todos"][0]["title"], "Pending");
    assert_eq!(alternatives[1]["reason"], "View pending todos instead (1)");

    let empty = call(&registry, "todo-list", json!({ "search": "" })).await;
    assert_eq!(
        empty["reasoning"],
        "Found 2 todos, returning 2 starting at offset 0"
    );

    let search = call(&registry, "todo-list", json!({ "search": "PEND" })).await;
    assert_eq!(search["data"]["total"], 1);
    assert_eq!(search["alternatives"].as_array().map(Vec::len), Some(1));
}

#[tokio::test]
async fn update_checks_for_changes_before_existence_and_names_its_undo() {
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
    assert!(missing["error"]["suggestion"]
        .as_str()
        .is_some_and(|s| s.contains("deleted: true")));

    let changed = call(
        &registry,
        "todo-update",
        json!({ "id": id, "title": "New", "description": "Details", "completed": true }),
    )
    .await;
    assert_eq!(changed["data"]["completed"], true);
    assert!(changed["data"]["completedAt"].is_string());
    assert_eq!(changed["undoCommand"], "todo-update");
    assert_eq!(
        changed["undoArgs"],
        json!({ "id": id, "title": "Task", "description": "", "completed": false })
    );

    // Running the undo puts the todo back: the empty description removes the one added.
    let undone = call(&registry, "todo-update", changed["undoArgs"].clone()).await;
    assert_eq!(undone["data"]["title"], "Task");
    assert!(undone["data"].get("description").is_none());
    assert!(undone["data"].get("completedAt").is_none());
}

#[tokio::test]
async fn a_toggle_names_the_previous_state_as_its_undo() {
    let registry = registry();
    let id = create(&registry, "Task").await;
    let done = call(&registry, "todo-toggle", json!({ "id": id })).await;
    assert_eq!(done["undoCommand"], "todo-update");
    assert_eq!(done["undoArgs"], json!({ "id": id, "completed": false }));
    assert_eq!(done["reasoning"], "Marked as completed: \"Task\"");

    let back = call(&registry, "todo-toggle", json!({ "id": id })).await;
    assert_eq!(back["data"]["completed"], false);
    assert!(back["data"].get("completedAt").is_none());
}

#[tokio::test]
async fn a_delete_keeps_the_todo_until_a_clear_and_restore_brings_it_back() {
    let registry = registry();
    let first = create(&registry, "First").await;
    create(&registry, "Second").await;

    let deleted = call(&registry, "todo-delete", json!({ "id": first })).await;
    assert_eq!(deleted["data"], json!({ "deleted": true, "id": first }));
    assert_eq!(deleted["undoCommand"], "todo-restore");
    assert_eq!(deleted["undoArgs"], json!({ "ids": [first] }));
    assert_eq!(deleted["warnings"][0]["code"], "RESTORABLE");

    let gone = call(&registry, "todo-get", json!({ "id": first })).await;
    assert_eq!(gone["error"]["code"], "NOT_FOUND");
    let again = call(&registry, "todo-delete", json!({ "id": first })).await;
    assert_eq!(again["error"]["code"], "NOT_FOUND");
    let stats = call(&registry, "todo-stats", json!({})).await;
    assert_eq!(stats["data"]["total"], 1);

    let listed = call(&registry, "todo-list", json!({ "deleted": true })).await;
    assert_eq!(listed["data"]["total"], 1);
    assert!(listed["data"]["todos"][0]["deletedAt"].is_string());

    let restored = call(
        &registry,
        "todo-restore",
        json!({ "ids": [first, "todo-never-deleted"] }),
    )
    .await;
    assert_eq!(restored["data"]["restoredIds"], json!([first]));
    assert!(restored["data"]["restored"][0].get("deletedAt").is_none());
    assert_eq!(restored["data"]["failed"][0]["error"]["code"], "NOT_FOUND");
    assert!(restored["data"]["failed"][0]["error"]["suggestion"].is_string());
    assert_eq!(restored["warnings"][0]["code"], "PARTIAL_SUCCESS");
    assert_eq!(restored["undoCommand"], "todo-delete-batch");
    assert_eq!(restored["undoArgs"], json!({ "ids": [first] }));

    let live = call(&registry, "todo-restore", json!({ "ids": [first] })).await;
    assert_eq!(
        live["data"]["failed"][0]["error"]["message"],
        format!("Todo \"{first}\" is not deleted")
    );
    assert!(live.get("undoCommand").is_none());
}

#[tokio::test]
async fn clears_remove_completed_deleted_or_every_todo() {
    let registry = registry();
    let done = create(&registry, "Done").await;
    let gone = create(&registry, "Gone").await;
    create(&registry, "Stay").await;
    call(&registry, "todo-toggle", json!({ "id": done })).await;
    call(&registry, "todo-delete", json!({ "id": gone })).await;

    let completed = call(&registry, "todo-clear", json!({})).await;
    assert_eq!(
        completed["data"],
        json!({ "cleared": 1, "remaining": 1, "clearedIds": [done] })
    );
    assert_eq!(completed["warnings"][0]["code"], "PERMANENT");
    assert!(completed.get("undoCommand").is_none());

    let deleted = call(&registry, "todo-clear", json!({ "deleted": true })).await;
    assert_eq!(
        deleted["data"],
        json!({ "cleared": 1, "remaining": 1, "clearedIds": [gone] })
    );
    let restore = call(&registry, "todo-restore", json!({ "ids": [gone] })).await;
    assert_eq!(restore["data"]["summary"]["failureCount"], 1);

    let all = call(&registry, "todo-clear", json!({ "all": true })).await;
    assert_eq!(all["data"]["cleared"], 1);
    assert_eq!(all["data"]["remaining"], 0);
}

#[tokio::test]
async fn stats_count_live_priorities_and_completion() {
    let registry = registry();
    let done = create(&registry, "Done").await;
    create(&registry, "Pending").await;
    let gone = create(&registry, "Gone").await;
    call(&registry, "todo-toggle", json!({ "id": done })).await;
    call(&registry, "todo-delete", json!({ "id": gone })).await;

    let stats = call(&registry, "todo-stats", json!({})).await;
    assert_eq!(stats["data"]["byPriority"]["medium"], 2);
    assert_eq!(stats["data"]["completionRate"], 0.5);
    assert_eq!(stats["data"]["pending"], 1);
    assert_eq!(
        stats["reasoning"],
        "2 total todos, 1 completed, 1 pending, 50% completion rate"
    );
}

#[tokio::test]
async fn create_batch_reports_partial_failures_and_undoes_what_it_made() {
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
    assert_eq!(result["undoCommand"], "todo-delete-batch");
    assert_eq!(
        result["undoArgs"],
        json!({ "ids": [result["data"]["succeeded"][0]["id"]] })
    );

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
    assert_eq!(result["undoCommand"], "todo-restore");
    assert_eq!(result["undoArgs"], json!({ "ids": [id] }));

    let nothing = call(
        &registry,
        "todo-delete-batch",
        json!({ "ids": ["missing-id"] }),
    )
    .await;
    assert!(nothing.get("warnings").is_none());
    assert!(nothing.get("undoCommand").is_none());
}

#[tokio::test]
async fn toggle_batch_toggles_or_sets_and_names_one_undo_when_it_can() {
    let registry = registry();
    let first = create(&registry, "First").await;
    let second = create(&registry, "Second").await;
    call(&registry, "todo-toggle", json!({ "id": second })).await;

    // A plain toggle of mixed states has no single undo.
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
    assert_eq!(flipped["warnings"][0]["code"], "NO_SINGLE_UNDO");
    assert!(flipped.get("undoCommand").is_none());

    // first is done, second open: setting both done changes only second.
    let set = call(
        &registry,
        "todo-toggle-batch",
        json!({ "ids": [first, second], "completed": true }),
    )
    .await;
    assert_eq!(set["data"]["summary"]["markedComplete"], 2);
    assert_eq!(set["data"]["summary"]["markedIncomplete"], 0);
    assert_eq!(set["undoCommand"], "todo-toggle-batch");
    assert_eq!(
        set["undoArgs"],
        json!({ "ids": [second], "completed": false })
    );

    // Nothing changed: nothing to undo.
    let same = call(
        &registry,
        "todo-toggle-batch",
        json!({ "ids": [first, second], "completed": true }),
    )
    .await;
    assert!(same.get("undoCommand").is_none());
    assert!(same.get("warnings").is_none());
}

#[tokio::test]
async fn history_records_who_changed_what_and_offers_only_the_latest_undo() {
    let registry = registry();
    let agent = || CommandContext::new().with_actor(ActorKind::Agent);
    let person = || CommandContext::new().with_actor(ActorKind::Human);
    let created = call_with(
        &registry,
        "todo-create",
        json!({ "title": "Watch" }),
        agent(),
    )
    .await;
    let id = created["data"]["id"].as_str().unwrap().to_string();
    call_with(&registry, "todo-toggle", json!({ "id": id }), person()).await;
    // Reads are not recorded.
    call(&registry, "todo-list", json!({})).await;

    let history = call(&registry, "todo-history", json!({})).await;
    assert_eq!(history["data"]["total"], 2);
    let entries = history["data"]["entries"].as_array().expect("entries");
    assert_eq!(entries[0]["command"], "todo-toggle");
    assert_eq!(entries[0]["actor"], json!({ "kind": "human" }));
    assert_eq!(entries[0]["undoCommand"], "todo-update");
    assert_eq!(entries[0]["ids"], json!([id]));
    assert!(entries[0]["at"].is_string());
    // The create is no longer the todo's latest change, so its undo is not offered.
    assert_eq!(entries[1]["command"], "todo-create");
    assert_eq!(entries[1]["actor"]["kind"], "agent");
    assert_eq!(entries[1]["superseded"], true);
    assert!(entries[1].get("undoCommand").is_none());
    assert!(entries[0]["seq"].as_u64() > entries[1]["seq"].as_u64());

    let by_agent = call(&registry, "todo-history", json!({ "actor": "agent" })).await;
    assert_eq!(by_agent["data"]["total"], 1);
    let other = call(&registry, "todo-history", json!({ "todoId": "other" })).await;
    assert_eq!(other["data"]["total"], 0);
    let paged = call(&registry, "todo-history", json!({ "limit": 1 })).await;
    assert_eq!(paged["data"]["hasMore"], true);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
async fn concurrent_changes_are_recorded_in_the_order_they_happened() {
    let registry = registry();
    let id = create(&registry, "Busy").await;
    let calls: Vec<_> = (0..200)
        .map(|_| {
            let registry = Arc::clone(&registry);
            let id = id.clone();
            tokio::spawn(async move { call(&registry, "todo-toggle", json!({ "id": id })).await })
        })
        .collect();
    for call in calls {
        assert_eq!(call.await.expect("the call ran")["success"], true);
    }
    // The latest entry is the latest toggle: its undo sets back the state before it.
    let now = call(&registry, "todo-get", json!({ "id": id })).await;
    let history = call(&registry, "todo-history", json!({ "limit": 1 })).await;
    let latest = &history["data"]["entries"][0];
    assert_eq!(
        latest["undoArgs"]["completed"],
        !now["data"]["completed"].as_bool().unwrap()
    );
    // Every change was recorded: the create and the 200 toggles.
    let all = call(&registry, "todo-history", json!({ "limit": 100 })).await;
    assert_eq!(all["data"]["total"], 201);
}

#[test]
fn the_history_description_states_its_limit() {
    let defined = crate::commands(Arc::new(TodoStore::new()));
    let (history, _) = defined
        .iter()
        .find(|(command, _)| command.name == "todo-history")
        .expect("todo-history");
    assert!(history
        .description
        .contains(&crate::HISTORY_LIMIT.to_string()));
}

// ─── Approvals ───────────────────────────────────────────────────────────────

fn held_registry() -> (Arc<TodoStore>, Arc<CommandRegistry>) {
    let store = Arc::new(TodoStore::new());
    let registry =
        app::registry(Arc::clone(&store), Approvals::Agents, SECRET).expect("commands register");
    (store, registry)
}

#[tokio::test]
async fn an_agents_clear_waits_for_a_person_and_runs_once_approved() {
    let (_store, registry) = held_registry();
    let agent = || CommandContext::new().with_actor(ActorKind::Agent);
    let done = create(&registry, "Done").await;
    call(&registry, "todo-toggle", json!({ "id": done })).await;

    let held = call_with(&registry, "todo-clear", json!({}), agent()).await;
    assert_eq!(held["error"]["code"], "APPROVAL_REQUIRED");
    assert!(held["error"]["suggestion"].is_string());
    assert_eq!(
        held["error"]["details"]["summary"],
        "Remove the completed todos for good (1 todo now)"
    );
    // Nothing ran, so nothing was recorded.
    let history = call(&registry, "todo-history", json!({})).await;
    assert_ne!(history["data"]["entries"][0]["command"], "todo-clear");

    // A delete can be undone, so it is not held.
    let other = create(&registry, "Other").await;
    let deleted = call_with(&registry, "todo-delete", json!({ "id": other }), agent()).await;
    assert_eq!(deleted["success"], true);

    // Trusted code retries with the token once a person approves.
    let token = held["error"]["details"]["approvalToken"]
        .as_str()
        .expect("a token")
        .to_string();
    let approved = call_with(
        &registry,
        "todo-clear",
        json!({}),
        agent().with_approval(token.clone()),
    )
    .await;
    assert_eq!(approved["data"]["cleared"], 1);
    let spent = call_with(
        &registry,
        "todo-clear",
        json!({}),
        agent().with_approval(token),
    )
    .await;
    assert_eq!(spent["error"]["code"], "APPROVAL_REQUIRED");
}

#[tokio::test]
async fn a_person_clears_without_approval() {
    let (_store, registry) = held_registry();
    let person = CommandContext::new().with_actor(ActorKind::Human);
    let cleared = call_with(&registry, "todo-clear", json!({ "all": true }), person).await;
    assert_eq!(cleared["success"], true);
}

#[tokio::test]
async fn the_approval_summary_says_what_goes_and_how_many() {
    let (store, registry) = held_registry();
    let first = create(&registry, "First").await;
    create(&registry, "Second").await;
    call(&registry, "todo-delete", json!({ "id": first })).await;
    assert_eq!(
        crate::summarize_clear(&store, &json!({ "all": true })),
        "Remove every todo for good, live and deleted (2 todos now)"
    );
    assert_eq!(
        crate::summarize_clear(&store, &json!({ "deleted": true })),
        "Empty the deleted todos for good (1 todo now)"
    );
}

#[tokio::test]
async fn approvals_off_hold_nothing() {
    let registry = registry();
    let agent = CommandContext::new().with_actor(ActorKind::Agent);
    let cleared = call_with(&registry, "todo-clear", json!({}), agent).await;
    assert_eq!(cleared["success"], true);
    // Served without its policy, so nothing advertises a hold this registry does not make; the
    // changes keep their declared `not-required`.
    assert!(registry.get("todo-clear").unwrap().approval.is_none());
    assert!(matches!(
        registry.get("todo-delete").unwrap().approval,
        Some(afd::ApprovalPolicy::NotRequired)
    ));
}

// ─── Contexts ────────────────────────────────────────────────────────────────

#[tokio::test]
async fn reading_offers_only_the_commands_that_read() {
    let registry = registry();
    let reading = || CommandContext::new().with_active_context("todo-reading");
    let refused = call_with(
        &registry,
        "todo-create",
        json!({ "title": "No" }),
        reading(),
    )
    .await;
    assert_eq!(refused["error"]["code"], "COMMAND_NOT_IN_CONTEXT");
    for name in ["todo-list", "todo-stats", "todo-history"] {
        let read = call_with(&registry, name, json!({}), reading()).await;
        assert_eq!(read["success"], true, "{name}");
    }
}

#[tokio::test]
async fn a_keyed_repeat_creates_a_todo_once() {
    // `todo-create` is answered by the registry's idempotency step, `todo-create-batch` by its
    // own handler, since it may run as a task (`spec/idempotency.md`, D5, S11).
    let registry = registry();
    let keyed = |key: &str| {
        CommandContext::new()
            .with_actor(ActorKind::Agent)
            .with_idempotency_key(key)
    };
    let first = call_with(
        &registry,
        "todo-create",
        json!({ "title": "Once" }),
        keyed("k1"),
    )
    .await;
    let again = call_with(
        &registry,
        "todo-create",
        json!({ "title": "Once" }),
        keyed("k1"),
    )
    .await;
    assert_eq!(first["data"], again["data"]);
    assert_eq!(again["metadata"]["idempotentReplay"], true);
    let reused = call_with(
        &registry,
        "todo-create",
        json!({ "title": "Other" }),
        keyed("k1"),
    )
    .await;
    assert_eq!(reused["error"]["code"], "IDEMPOTENCY_KEY_REUSED");

    let batch = json!({ "todos": [{ "title": "A" }, { "title": "B" }] });
    let first = call_with(&registry, "todo-create-batch", batch.clone(), keyed("b1")).await;
    let again = call_with(&registry, "todo-create-batch", batch, keyed("b1")).await;
    assert_eq!(first["data"], again["data"]);
    let reused = call_with(
        &registry,
        "todo-create-batch",
        json!({ "todos": [{ "title": "C" }] }),
        keyed("b1"),
    )
    .await;
    assert_eq!(reused["error"]["code"], "IDEMPOTENCY_KEY_REUSED");
    let listed = call(&registry, "todo-list", json!({})).await;
    assert_eq!(listed["data"]["total"], 3, "{listed}");
}
