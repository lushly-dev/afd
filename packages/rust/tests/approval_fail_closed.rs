//! The registry dispatches a gated call only when an approval step admitted it, and answers
//! `APPROVAL_UNAVAILABLE` otherwise (`spec/command-metadata.md`, "Approvals"; #1886): the cases
//! with the approval middleware. Those without it are in `approval_without_middleware.rs`, which
//! runs without the `approval` feature. Mirrors TypeScript's
//! `packages/server/src/approval-fail-closed.test.ts`.
#![cfg(feature = "approval")]

use afd::*;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

mod approval_common;
use approval_common::*;

const SECRET: &str = "test-approval-secret-0123456789abcdef";

// ── The approval middleware decides from the command it runs ───────────────────────────────────

#[tokio::test]
async fn a_gated_command_missing_from_the_list_is_held_by_its_own_policy() {
    let ran = Ran::default();
    let registry = Arc::new(CommandRegistry::new());
    // Built before any command is registered: the list is empty, and the policy is read per call.
    let options = ApprovalMiddlewareOptions::new(SECRET, registry.list());
    registry.add_middleware(create_approval_middleware(options).unwrap());
    for command in commands(&ran) {
        registry.register(command).unwrap();
    }
    let held = registry
        .execute("todo-delete", json!({"id": 1}), None)
        .await;
    assert_eq!(code(&held), Some("APPROVAL_REQUIRED"));
    assert!(
        registry
            .execute("todo-check", json!({"id": 2}), None)
            .await
            .success
    );
    assert_eq!(ran_list(&ran), ["todo-check:2"]);
}

#[tokio::test]
async fn the_middleware_works_without_a_commands_list_and_the_approved_retry_runs() {
    let ran = Ran::default();
    let registry = registry_with(commands(&ran));
    let options = ApprovalMiddlewareOptions::from_secret(SECRET);
    registry.add_middleware(create_approval_middleware(options).unwrap());
    let client = approving(&registry);
    let result = client.call("todo-delete", json!({"id": 5}), None).await;
    assert!(result.success, "{result:?}");
    assert_eq!(result.data, Some(json!({"id": 5})));
    assert!(
        client
            .call("todo-list", json!({"id": 6}), None)
            .await
            .success
    );
    assert_eq!(ran_list(&ran), ["todo-delete:5", "todo-list:6"]);
}

#[tokio::test]
async fn the_token_retry_runs_once_approved() {
    let ran = Ran::default();
    let registry = registry_with(commands(&ran));
    let options = ApprovalMiddlewareOptions::from_secret(SECRET);
    registry.add_middleware(create_approval_middleware(options).unwrap());
    let held = registry
        .execute("todo-delete", json!({"id": 1}), None)
        .await;
    let token = held
        .error
        .as_ref()
        .and_then(|error| error.details.as_ref())
        .and_then(|details| details.get("approvalToken"))
        .and_then(Value::as_str)
        .expect("a token")
        .to_owned();
    let retried = registry
        .execute(
            "todo-delete",
            json!({"id": 1}),
            Some(CommandContext::new().with_approval(token)),
        )
        .await;
    assert!(retried.success, "{retried:?}");
    assert_eq!(ran_list(&ran), ["todo-delete:1"]);
}

#[tokio::test]
async fn the_summary_is_the_confirm_prompt_of_the_command_it_runs() {
    let ran = Ran::default();
    let registry = Arc::new(CommandRegistry::new());
    registry
        .register(
            command("todo-purge", Some(ApprovalPolicy::Required), &ran)
                .with_confirm_prompt("Purge every todo"),
        )
        .unwrap();
    let options = ApprovalMiddlewareOptions::from_secret(SECRET);
    registry.add_middleware(create_approval_middleware(options).unwrap());
    let asked = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&asked);
    let client = DirectClient::new(Arc::clone(&registry)).with_on_approval_needed(Arc::new(
        move |request| {
            seen.lock().unwrap().push(request.summary);
            Box::pin(async { Ok(false) })
        },
    ));
    client.call("todo-purge", json!({"id": 1}), None).await;
    assert_eq!(*asked.lock().unwrap(), ["Purge every todo"]);
    assert!(ran_list(&ran).is_empty());
}

#[tokio::test]
async fn a_nested_call_does_not_inherit_the_outer_admission() {
    let ran = Ran::default();
    let (outer, cell, nested) = sweep(
        Some(ApprovalPolicy::when(|_, _| ApprovalDecision::NotRequired)),
        &ran,
    );
    let registry = registry_with(vec![
        command("todo-delete", Some(ApprovalPolicy::Required), &ran),
        outer,
    ]);
    assert!(cell.set(Arc::clone(&registry)).is_ok());
    let options = ApprovalMiddlewareOptions::from_secret(SECRET);
    registry.add_middleware(create_approval_middleware(options).unwrap());
    assert!(
        registry
            .execute("todo-sweep", json!({}), None)
            .await
            .success
    );
    let nested = nested.lock().unwrap().clone().expect("the nested call ran");
    assert_eq!(code(&nested), Some("APPROVAL_REQUIRED"));
    assert_eq!(ran_list(&ran), ["todo-sweep"]);
}

// ── One admission runs one handler, on what was approved ───────────────────────────────────────

/// Fails with a transient error the first time.
struct Flaky {
    calls: Arc<Mutex<usize>>,
}

#[async_trait]
impl CommandHandler for Flaky {
    async fn execute(&self, _: Value, _: CommandContext) -> CommandResult<Value> {
        let mut calls = self.calls.lock().unwrap();
        *calls += 1;
        if *calls == 1 {
            failure(CommandError::new("TRANSIENT_ERROR", "try again").with_retryable(true))
        } else {
            success(json!(null))
        }
    }
}

#[tokio::test]
async fn a_retry_after_the_approval_middleware_is_refused() {
    let calls = Arc::new(Mutex::new(0));
    let registry = registry_with(vec![CommandDefinition::new(
        "todo-delete",
        "Fails once with a transient error",
        vec![CommandParameter::required_number("id", "ID")],
        Flaky {
            calls: Arc::clone(&calls),
        },
    )
    .with_approval(ApprovalPolicy::Required)]);
    let options = ApprovalMiddlewareOptions::from_secret(SECRET);
    registry.add_middleware(create_approval_middleware(options).unwrap());
    // Retries a failed call once, behind the approval step.
    registry.add_middleware(Arc::new(|_, _, context, next| {
        Box::pin(async move {
            let first = next(context.clone()).await;
            if first.success {
                first
            } else {
                next(context.clone()).await
            }
        })
    }));
    let result = approving(&registry)
        .call("todo-delete", json!({"id": 1}), None)
        .await;
    assert_eq!(*calls.lock().unwrap(), 1, "the handler ran once");
    expect_unavailable(&result, "todo-delete", "admission-mismatch");
    let suggestion = result.error.unwrap().suggestion.unwrap();
    assert!(
        suggestion.contains("before the approval middleware"),
        "{suggestion}"
    );
}

#[tokio::test]
async fn an_input_other_than_the_one_approved_is_refused() {
    let ran = Ran::default();
    // Lets id 99 through without approval and holds any other.
    let registry = registry_with(vec![command(
        "todo-delete",
        Some(ApprovalPolicy::when(|input, _| {
            if input.get("id") == Some(&json!(99)) {
                ApprovalDecision::NotRequired
            } else {
                ApprovalDecision::Required
            }
        })),
        &ran,
    )]);
    let approval =
        create_approval_middleware(ApprovalMiddlewareOptions::from_secret(SECRET)).unwrap();
    // Asks the approval step about another input, then dispatches the one sent.
    registry.add_middleware(Arc::new(move |name, _, context, next| {
        approval(name, Arc::new(json!({"id": 99})), context, next)
    }));
    let result = registry
        .execute("todo-delete", json!({"id": 1}), None)
        .await;
    expect_unavailable(&result, "todo-delete", "admission-mismatch");
    assert!(ran_list(&ran).is_empty());
}

#[tokio::test]
async fn an_admission_for_another_command_is_refused() {
    let ran = Ran::default();
    let registry = registry_with(commands(&ran));
    let approval =
        create_approval_middleware(ApprovalMiddlewareOptions::new(SECRET, commands(&ran))).unwrap();
    // Asks the approval step about a command its policy lets through, then lets the gated one
    // through.
    registry.add_middleware(Arc::new(move |_, input, context, next| {
        approval("todo-check".to_owned(), input, context, next)
    }));
    let result = registry
        .execute("todo-delete", json!({"id": 1}), None)
        .await;
    expect_unavailable(&result, "todo-delete", "admission-mismatch");
    assert!(ran_list(&ran).is_empty());
}

#[tokio::test]
async fn an_approved_call_runs_when_later_middleware_leaves_it_alone() {
    let ran = Ran::default();
    let registry = registry_with(commands(&ran));
    let options = ApprovalMiddlewareOptions::from_secret(SECRET);
    registry.add_middleware(create_approval_middleware(options).unwrap());
    registry.add_middleware(pass_through());
    let result = approving(&registry)
        .call("todo-delete", json!({"id": 2}), None)
        .await;
    assert!(result.success, "{result:?}");
    assert_eq!(ran_list(&ran), ["todo-delete:2"]);
}

// ── A policy given only in the commands list ───────────────────────────────────────────────────

#[tokio::test]
async fn a_policy_only_in_the_list_still_holds() {
    let ran = Ran::default();
    let registry = registry_with(vec![command("todo-wipe", None, &ran)]);
    let listed = command("todo-wipe", Some(ApprovalPolicy::Required), &ran);
    let options = ApprovalMiddlewareOptions::new(SECRET, [listed]);
    registry.add_middleware(create_approval_middleware(options).unwrap());
    let held = registry.execute("todo-wipe", json!({"id": 1}), None).await;
    assert_eq!(code(&held), Some("APPROVAL_REQUIRED"));
    assert!(ran_list(&ran).is_empty());
}

#[tokio::test]
async fn a_listed_function_holds_though_the_command_declares_not_required() {
    let ran = Ran::default();
    let registry = registry_with(commands(&ran));
    let listed = command(
        "todo-touch",
        Some(ApprovalPolicy::when(|_, _| ApprovalDecision::Required)),
        &ran,
    );
    let options = ApprovalMiddlewareOptions::new(SECRET, [listed]);
    registry.add_middleware(create_approval_middleware(options).unwrap());
    let held = registry.execute("todo-touch", json!({"id": 1}), None).await;
    assert_eq!(code(&held), Some("APPROVAL_REQUIRED"));
    assert!(ran_list(&ran).is_empty());
}

#[tokio::test]
async fn a_list_only_gate_takes_its_admission_once() {
    let calls = Arc::new(Mutex::new(0));
    // The command declares no policy; only the middleware's list gates it.
    let flaky = || {
        CommandDefinition::new(
            "todo-wipe",
            "Fails once with a transient error",
            vec![CommandParameter::required_number("id", "ID")],
            Flaky {
                calls: Arc::clone(&calls),
            },
        )
    };
    let registry = registry_with(vec![flaky()]);
    let listed = flaky().with_approval(ApprovalPolicy::Required);
    let options = ApprovalMiddlewareOptions::new(SECRET, [listed]);
    registry.add_middleware(create_approval_middleware(options).unwrap());
    registry.add_middleware(Arc::new(|_, _, context, next| {
        Box::pin(async move {
            let first = next(context.clone()).await;
            if first.success {
                first
            } else {
                next(context.clone()).await
            }
        })
    }));
    let result = approving(&registry)
        .call("todo-wipe", json!({"id": 1}), None)
        .await;
    assert_eq!(*calls.lock().unwrap(), 1, "the handler ran once");
    expect_unavailable(&result, "todo-wipe", "admission-mismatch");
}

#[tokio::test]
async fn a_retry_with_a_new_context_keeps_the_admission() {
    // A retrying middleware that hands `next` a fresh context, not the one it was given, cannot
    // drop the call's admission record: the retry is still refused.
    let calls = Arc::new(Mutex::new(0));
    let flaky = || {
        CommandDefinition::new(
            "todo-wipe",
            "Fails once with a transient error",
            vec![CommandParameter::required_number("id", "ID")],
            Flaky {
                calls: Arc::clone(&calls),
            },
        )
    };
    let registry = registry_with(vec![flaky()]);
    let listed = flaky().with_approval(ApprovalPolicy::Required);
    let options = ApprovalMiddlewareOptions::new(SECRET, [listed]);
    registry.add_middleware(create_approval_middleware(options).unwrap());
    registry.add_middleware(Arc::new(|_, _, context, next| {
        Box::pin(async move {
            let first = next(context).await;
            if first.success {
                first
            } else {
                next(CommandContext::new()).await
            }
        })
    }));
    let result = approving(&registry)
        .call("todo-wipe", json!({"id": 1}), None)
        .await;
    assert_eq!(*calls.lock().unwrap(), 1, "the handler ran once");
    expect_unavailable(&result, "todo-wipe", "admission-mismatch");
}

/// `todo-wipe`, declaring no policy, gated by the approval middleware's list, with the stock retry
/// middleware before or after the approval middleware.
async fn stock_retry_around_approval(retry_first: bool) -> (CommandResult<Value>, usize) {
    let calls = Arc::new(Mutex::new(0));
    let flaky = || {
        CommandDefinition::new(
            "todo-wipe",
            "Fails once with a transient error",
            vec![CommandParameter::required_number("id", "ID")],
            Flaky {
                calls: Arc::clone(&calls),
            },
        )
    };
    let registry = registry_with(vec![flaky()]);
    let listed = flaky().with_approval(ApprovalPolicy::Required);
    let approval = create_approval_middleware(ApprovalMiddlewareOptions::new(SECRET, [listed]));
    let retry = afd::middleware::create_retry_middleware(afd::middleware::RetryOptions {
        sleep: Some(Arc::new(|_| Box::pin(std::future::ready(())))),
        ..afd::middleware::RetryOptions::default()
    })
    .unwrap();
    if retry_first {
        registry.add_middleware(retry);
        registry.add_middleware(approval.unwrap());
    } else {
        registry.add_middleware(approval.unwrap());
        registry.add_middleware(retry);
    }
    // The held call's token, presented with the retried call: it holds for every attempt.
    let held = registry.execute("todo-wipe", json!({"id": 1}), None).await;
    let token = held.error.as_ref().unwrap().details.as_ref().unwrap()["approvalToken"]
        .as_str()
        .expect("a token")
        .to_owned();
    let context = CommandContext::new().with_approval(token);
    let result = registry
        .execute("todo-wipe", json!({"id": 1}), Some(context))
        .await;
    let calls = *calls.lock().unwrap();
    (result, calls)
}

#[tokio::test]
async fn the_stock_retry_before_the_approval_middleware_asks_again_for_a_retry() {
    // A token works once: the retry reaches the approval step again, which holds it for a new
    // approval instead of running the gated handler a second time on the first one.
    let (result, calls) = stock_retry_around_approval(true).await;
    assert_eq!(calls, 1, "the handler ran once");
    let error = result.error.expect("held");
    assert_eq!(error.code, "APPROVAL_REQUIRED");
    assert_eq!(error.details.unwrap()["reason"], "already-used");
}

#[tokio::test]
async fn the_stock_retry_after_the_approval_middleware_is_refused() {
    let (result, calls) = stock_retry_around_approval(false).await;
    assert_eq!(calls, 1, "the handler ran once");
    expect_unavailable(&result, "todo-wipe", "admission-mismatch");
}

/// The command `todo-wipe`, which declares no policy, and the approval middleware whose list gates
/// it.
fn list_gated(handler: impl CommandHandler + 'static) -> (Arc<CommandRegistry>, CommandMiddleware) {
    let wipe = CommandDefinition::new(
        "todo-wipe",
        "Wipe a todo",
        vec![CommandParameter::required_number("id", "ID")],
        handler,
    );
    let listed = CommandDefinition::new(
        "todo-wipe",
        "Wipe a todo",
        vec![CommandParameter::required_number("id", "ID")],
        Recording {
            name: "unused",
            ran: Ran::default(),
        },
    )
    .with_approval(ApprovalPolicy::Required);
    let registry = registry_with(vec![wipe]);
    let gating =
        create_approval_middleware(ApprovalMiddlewareOptions::new(SECRET, [listed])).unwrap();
    (registry, gating)
}

/// A second approval middleware none of whose policies gate the command.
fn non_gating() -> CommandMiddleware {
    create_approval_middleware(ApprovalMiddlewareOptions::from_secret(SECRET)).unwrap()
}

#[tokio::test]
async fn an_approved_call_runs_past_a_later_middleware_that_does_not_gate_it() {
    let ran = Ran::default();
    let (registry, gating) = list_gated(Recording {
        name: "todo-wipe",
        ran: Arc::clone(&ran),
    });
    registry.add_middleware(gating);
    registry.add_middleware(non_gating());
    let result = approving(&registry)
        .call("todo-wipe", json!({"id": 3}), None)
        .await;
    assert!(result.success, "{result:?}");
    assert_eq!(ran_list(&ran), ["todo-wipe:3"]);
}

#[tokio::test]
async fn a_middleware_that_does_not_gate_a_call_does_not_admit_its_retry() {
    let calls = Arc::new(Mutex::new(0));
    let (registry, gating) = list_gated(Flaky {
        calls: Arc::clone(&calls),
    });
    registry.add_middleware(gating);
    registry.add_middleware(Arc::new(|_, _, context, next| {
        Box::pin(async move {
            let first = next(context.clone()).await;
            if first.success {
                first
            } else {
                next(context.clone()).await
            }
        })
    }));
    registry.add_middleware(non_gating());
    let result = approving(&registry)
        .call("todo-wipe", json!({"id": 1}), None)
        .await;
    assert_eq!(*calls.lock().unwrap(), 1, "the handler ran once");
    expect_unavailable(&result, "todo-wipe", "admission-mismatch");
}

#[tokio::test]
async fn a_retry_between_two_middlewares_that_admit_a_call_is_refused() {
    let calls = Arc::new(Mutex::new(0));
    let (registry, gating) = list_gated(Flaky {
        calls: Arc::clone(&calls),
    });
    registry.add_middleware(gating);
    registry.add_middleware(Arc::new(|_, _, context, next| {
        Box::pin(async move {
            let first = next(context.clone()).await;
            if first.success {
                first
            } else {
                next(context.clone()).await
            }
        })
    }));
    // Its list gives the command a policy function that lets every call through: it may gate the
    // call, so it admits it, also on the retry.
    let listed = CommandDefinition::new(
        "todo-wipe",
        "Wipe a todo",
        vec![CommandParameter::required_number("id", "ID")],
        Recording {
            name: "unused",
            ran: Ran::default(),
        },
    )
    .with_approval(ApprovalPolicy::when(|_, _| ApprovalDecision::NotRequired));
    registry.add_middleware(
        create_approval_middleware(ApprovalMiddlewareOptions::new(SECRET, [listed])).unwrap(),
    );
    let result = approving(&registry)
        .call("todo-wipe", json!({"id": 1}), None)
        .await;
    assert_eq!(*calls.lock().unwrap(), 1, "the handler ran once");
    expect_unavailable(&result, "todo-wipe", "admission-mismatch");
}

#[tokio::test]
async fn a_list_gated_call_renamed_before_the_middleware_is_refused() {
    let ran = Ran::default();
    let (registry, gating) = list_gated(Recording {
        name: "todo-wipe",
        ran: Arc::clone(&ran),
    });
    // Asks the approval step about a name its list does not gate, then lets the call through.
    registry.add_middleware(Arc::new(move |_, input, context, next| {
        gating("todo-list".to_owned(), input, context, next)
    }));
    let result = registry.execute("todo-wipe", json!({"id": 1}), None).await;
    expect_unavailable(&result, "todo-wipe", "no-approval-step");
    assert!(ran_list(&ran).is_empty());
}

#[tokio::test]
async fn two_middlewares_that_gate_a_command_each_ask_for_it() {
    // The documented limit: one approval middleware per registry.
    let ran = Ran::default();
    let registry = registry_with(commands(&ran));
    for _ in 0..2 {
        let options = ApprovalMiddlewareOptions::from_secret(SECRET);
        registry.add_middleware(create_approval_middleware(options).unwrap());
    }
    let result = approving(&registry)
        .call("todo-delete", json!({"id": 1}), None)
        .await;
    assert_eq!(code(&result), Some("APPROVAL_REQUIRED"), "{result:?}");
    assert!(ran_list(&ran).is_empty());
}

/// 2^53 + 1: a JavaScript number cannot hold it exactly, so it has no canonical JSON.
const UNBOUND: u64 = (1 << 53) + 1;

#[tokio::test]
async fn a_held_input_without_canonical_json_is_refused_by_the_approval_step() {
    let ran = Ran::default();
    let registry = registry_with(commands(&ran));
    let options = ApprovalMiddlewareOptions::from_secret(SECRET);
    registry.add_middleware(create_approval_middleware(options).unwrap());
    let result = approving(&registry)
        .call("todo-delete", json!({"id": UNBOUND}), None)
        .await;
    let error = result.error.expect("refused");
    assert_eq!(error.code, "APPROVAL_UNAVAILABLE", "{error:?}");
    assert_eq!(
        error.message,
        "todo-delete needs a person's approval, and this input cannot be bound to one"
    );
    assert_eq!(error.retryable, Some(false));
    assert_eq!(
        error
            .details
            .as_ref()
            .and_then(|details| details.get("reason")),
        Some(&json!("input-not-canonical"))
    );
    // The caller sends the input in another form: no recovery (`spec/recovery.md`).
    assert!(error.recovery.is_none(), "{error:?}");
    assert_eq!(
        error.suggestion.as_deref(),
        Some("Do not retry with this input: it has no exact canonical form, so an approval cannot be bound to it. Send the input in a form canonical JSON accepts (for example, an integer a JavaScript number cannot hold exactly, such as 2^53 + 1, as a string).")
    );
    assert!(ran_list(&ran).is_empty());
}

#[tokio::test]
async fn an_input_without_canonical_json_runs_when_the_policy_lets_it_through() {
    let ran = Ran::default();
    let registry = registry_with(commands(&ran));
    let options = ApprovalMiddlewareOptions::from_secret(SECRET);
    registry.add_middleware(create_approval_middleware(options).unwrap());
    let result = registry
        .execute("todo-check", json!({"id": UNBOUND}), None)
        .await;
    assert!(result.success, "{result:?}");
    assert_eq!(ran_list(&ran), [format!("todo-check:{UNBOUND}")]);
}

#[tokio::test]
async fn an_input_without_canonical_json_is_compared_as_a_value_at_dispatch() {
    let ran = Ran::default();
    let registry = registry_with(commands(&ran));
    let approval =
        create_approval_middleware(ApprovalMiddlewareOptions::from_secret(SECRET)).unwrap();
    // Asks the approval step about another such input, then dispatches the one sent.
    registry.add_middleware(Arc::new(move |name, _, context, next| {
        approval(name, Arc::new(json!({"id": UNBOUND + 2})), context, next)
    }));
    let result = registry
        .execute("todo-check", json!({"id": UNBOUND}), None)
        .await;
    expect_unavailable(&result, "todo-check", "admission-mismatch");
    assert!(ran_list(&ran).is_empty());
}
