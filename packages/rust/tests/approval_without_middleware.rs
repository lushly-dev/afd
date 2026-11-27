//! A declared approval policy holds without the approval middleware: the registry refuses a gated
//! call no approval step admitted with `APPROVAL_UNAVAILABLE`, `no-approval-step`
//! (`spec/approvals.md`, "Approvals"; #1886). These need no approval middleware, so they
//! run without the `approval` feature too. Mirrors TypeScript's
//! `packages/server/src/approval-fail-closed.test.ts`.

use afd::*;
use serde_json::json;
use std::sync::Arc;

mod approval_common;
use approval_common::*;

// ── Without the approval middleware ────────────────────────────────────────────────────────────

#[tokio::test]
async fn a_gated_command_is_refused_before_the_handler_runs() {
    let ran = Ran::default();
    let registry = registry_with(commands(&ran));
    let result = registry
        .execute("todo-delete", json!({"id": 1}), None)
        .await;
    expect_unavailable(&result, "todo-delete", "no-approval-step");
    // A policy function is not evaluated: the declaration alone needs an approval step.
    let result = registry.execute("todo-check", json!({"id": 2}), None).await;
    expect_unavailable(&result, "todo-check", "no-approval-step");
    assert!(ran_list(&ran).is_empty());
}

#[tokio::test]
async fn a_gated_command_is_refused_with_other_middleware_installed() {
    let ran = Ran::default();
    let registry = registry_with(commands(&ran));
    registry.add_middleware(pass_through());
    let result = registry
        .execute("todo-delete", json!({"id": 1}), None)
        .await;
    expect_unavailable(&result, "todo-delete", "no-approval-step");
    assert!(ran_list(&ran).is_empty());
}

#[tokio::test]
async fn a_gated_command_is_refused_through_direct_client() {
    let ran = Ran::default();
    let registry = registry_with(commands(&ran));
    let result = approving(&registry)
        .call("todo-delete", json!({"id": 1}), None)
        .await;
    expect_unavailable(&result, "todo-delete", "no-approval-step");
    assert!(ran_list(&ran).is_empty());
}

#[tokio::test]
async fn a_not_required_or_undeclared_policy_runs() {
    let ran = Ran::default();
    let registry = registry_with(commands(&ran));
    assert!(
        registry
            .execute("todo-touch", json!({"id": 1}), None)
            .await
            .success
    );
    assert!(
        registry
            .execute("todo-list", json!({"id": 2}), None)
            .await
            .success
    );
    assert_eq!(ran_list(&ran), ["todo-touch:1", "todo-list:2"]);
}

#[tokio::test]
async fn every_batch_item_and_pipeline_step_is_checked_on_its_own() {
    let ran = Ran::default();
    let registry = registry_with(commands(&ran));
    let batch = registry
        .execute_batch(BatchRequest::new(vec![
            BatchCommand::new("todo-list", json!({"id": 1})),
            BatchCommand::new("todo-delete", json!({"id": 2})),
        ]))
        .await;
    assert!(batch.results[0].result.success);
    expect_unavailable(&batch.results[1].result, "todo-delete", "no-approval-step");

    let request = PipelineRequest::new(vec![
        PipelineStep::new("todo-list").with_input(json!({"id": 3})),
        PipelineStep::new("todo-delete").with_input(json!({"id": 4})),
    ]);
    let shared = Arc::clone(&registry);
    let executor: CommandExecutor = Arc::new(move |command, input, _| {
        let registry = Arc::clone(&shared);
        Box::pin(async move { registry.execute(&command, input, None).await })
    });
    let pipe = execute_pipeline(&request, &executor, None).await;
    assert_eq!(
        pipe.steps[1]
            .error
            .as_ref()
            .map(|error| error.code.as_str()),
        Some("APPROVAL_UNAVAILABLE")
    );
    assert_eq!(ran_list(&ran), ["todo-list:1", "todo-list:3"]);
}

#[tokio::test]
async fn a_gated_command_run_from_inside_another_command_is_refused() {
    let ran = Ran::default();
    let (outer, cell, nested) = sweep(None, &ran);
    let mut all = commands(&ran);
    all.push(outer);
    let registry = registry_with(all);
    assert!(cell.set(Arc::clone(&registry)).is_ok());
    assert!(
        registry
            .execute("todo-sweep", json!({}), None)
            .await
            .success
    );
    let nested = nested.lock().unwrap().clone().expect("the nested call ran");
    expect_unavailable(&nested, "todo-delete", "no-approval-step");
    assert_eq!(ran_list(&ran), ["todo-sweep"]);
}
