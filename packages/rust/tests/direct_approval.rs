#![cfg(feature = "approval")]

use afd::*;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};

struct Counting(Arc<AtomicUsize>);
#[async_trait]
impl CommandHandler for Counting {
    async fn execute(&self, input: Value, _: CommandContext) -> CommandResult<Value> {
        self.0.fetch_add(1, Ordering::SeqCst);
        success(input)
    }
}

struct Fixture {
    registry: Arc<CommandRegistry>,
    runs: Arc<AtomicUsize>,
    tokens: Arc<Mutex<Vec<String>>>,
    observed: Arc<Mutex<Vec<Value>>>,
    clock: ManualClock,
}

fn fixture() -> Fixture {
    fixture_with(|_, _| {})
}

/// `fixture` with more commands, registered before the approval middleware reads the list.
fn fixture_with(more: impl FnOnce(&CommandRegistry, &Arc<AtomicUsize>)) -> Fixture {
    let registry = Arc::new(CommandRegistry::new());
    let runs = Arc::new(AtomicUsize::new(0));
    registry
        .register(
            CommandDefinition::new(
                "item-delete",
                "Delete",
                vec![CommandParameter::required_number("id", "ID")],
                Counting(Arc::clone(&runs)),
            )
            .with_approval(ApprovalPolicy::Required),
        )
        .unwrap();
    more(&registry, &runs);
    let tokens = Arc::new(Mutex::new(Vec::new()));
    let collected = Arc::clone(&tokens);
    let clock = fixed_clock(1_793_016_000_000);
    let options = ApprovalMiddlewareOptions::new(
        "test-private-approval-secret-0123456789abcdef",
        registry.list(),
    )
    .with_clock(clock.clone());
    let options = options.with_on_approval_required(move |request| {
        collected.lock().unwrap().push(request.approval_token);
        Box::pin(async {})
    });
    let observed = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&observed);
    registry.add_middleware(Arc::new(move |_, _, _, next| {
        let seen = Arc::clone(&seen);
        Box::pin(async move {
            let result = next().await;
            seen.lock()
                .unwrap()
                .push(serde_json::to_value(&result).unwrap());
            result
        })
    }));
    registry.add_middleware(create_approval_middleware(options).unwrap());
    Fixture {
        registry,
        runs,
        tokens,
        observed,
        clock,
    }
}

fn held(result: &CommandResult<Value>) {
    assert!(!result.success);
    let error = result.error.as_ref().unwrap();
    assert_eq!(error.code, error_codes::APPROVAL_REQUIRED);
    assert!(!error
        .details
        .as_ref()
        .unwrap()
        .contains_key("approvalToken"));
}

#[tokio::test]
async fn public_context_cannot_approve_and_observers_never_get_credentials() {
    let f = fixture();
    let client = DirectClient::new(Arc::clone(&f.registry));
    held(&client.call("item-delete", json!({"id":1}), None).await);
    let token = f.tokens.lock().unwrap()[0].clone();
    held(
        &client
            .call(
                "item-delete",
                json!({"id":1}),
                Some(CommandContext::new().with_approval(token)),
            )
            .await,
    );
    assert_eq!(f.runs.load(Ordering::SeqCst), 0);
    assert!(f
        .observed
        .lock()
        .unwrap()
        .iter()
        .all(|v| v.pointer("/error/details/approvalToken").is_none()));
}

#[tokio::test]
async fn only_explicit_approval_retries_and_replay_is_held() {
    for answer in [Ok(true), Ok(false), Err("hook error".to_owned())] {
        let f = fixture();
        let approved = answer == Ok(true);
        let decisions = Arc::new(AtomicUsize::new(0));
        let calls = Arc::clone(&decisions);
        let client = DirectClient::new(Arc::clone(&f.registry)).with_on_approval_needed(Arc::new(
            move |mut request| {
                calls.fetch_add(1, Ordering::SeqCst);
                assert_eq!(request.command, "item-delete");
                request.input["id"] = json!(999);
                let answer = answer.clone();
                Box::pin(async move { answer })
            },
        ));
        let result = client.call("item-delete", json!({"id":1}), None).await;
        if approved {
            assert_eq!(result.data, Some(json!({"id":1})));
        } else {
            held(&result);
        }
        assert_eq!(f.runs.load(Ordering::SeqCst), usize::from(approved));
        assert_eq!(decisions.load(Ordering::SeqCst), 1);
        let token = f.tokens.lock().unwrap()[0].clone();
        held(
            &DirectClient::new(Arc::clone(&f.registry))
                .call(
                    "item-delete",
                    json!({"id":1}),
                    Some(CommandContext::new().with_approval(token)),
                )
                .await,
        );
    }
}

#[tokio::test]
async fn hook_panics_leave_the_original_hold() {
    let f = fixture();
    let client = DirectClient::new(Arc::clone(&f.registry))
        .with_on_approval_needed(Arc::new(|_| panic!("hook")));
    held(&client.call("item-delete", json!({"id":1}), None).await);
    assert_eq!(f.runs.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn expired_retry_is_held_without_reprompting() {
    let f = fixture();
    let clock = f.clock.clone();
    let client =
        DirectClient::new(Arc::clone(&f.registry)).with_on_approval_needed(Arc::new(move |_| {
            clock.advance(300_001);
            Box::pin(async { Ok(true) })
        }));
    let result = client.call("item-delete", json!({"id":1}), None).await;
    held(&result);
    assert_eq!(result.error.unwrap().details.unwrap()["reason"], "expired");
    assert_eq!(f.tokens.lock().unwrap().len(), 2);
    assert_eq!(f.runs.load(Ordering::SeqCst), 0);
}

#[cfg(feature = "native")]
#[tokio::test(start_paused = true)]
async fn deadline_covers_human_wait() {
    let f = fixture();
    let client =
        DirectClient::new(Arc::clone(&f.registry)).with_on_approval_needed(Arc::new(|_| {
            Box::pin(async {
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                Ok(true)
            })
        }));
    let result = client
        .call(
            "item-delete",
            json!({"id":1}),
            Some(CommandContext::new().with_timeout(10)),
        )
        .await;
    assert_eq!(result.error.unwrap().code, error_codes::TIMEOUT);
    assert_eq!(f.runs.load(Ordering::SeqCst), 0);
    assert_eq!(f.tokens.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn concurrent_decisions_are_isolated() {
    let f = fixture();
    let client =
        DirectClient::new(Arc::clone(&f.registry)).with_on_approval_needed(Arc::new(|request| {
            Box::pin(async move {
                tokio::task::yield_now().await;
                Ok(request.input["id"] == 1)
            })
        }));
    let (approved, denied) = tokio::join!(
        client.call("item-delete", json!({"id":1}), None),
        client.call("item-delete", json!({"id":2}), None)
    );
    assert!(approved.success);
    held(&denied);
    assert_eq!(f.runs.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn recorded_holds_never_contain_approval_evidence() {
    let f = fixture();
    let sink = Arc::new(MemoryJournalSink::new());
    f.registry
        .set_journal(JournalRecorder::new(sink.clone()).with_record_failures(true));
    held(
        &DirectClient::new(Arc::clone(&f.registry))
            .call("item-delete", json!({"id":1}), None)
            .await,
    );
    let entries = sink.read(JournalRange::default()).await.unwrap();
    assert_eq!(entries.len(), 1);
    assert!(!serde_json::to_string(&entries)
        .unwrap()
        .contains("approvalToken"));
}

#[cfg(feature = "native")]
#[tokio::test]
async fn blocking_hook_cannot_authorize_after_deadline() {
    let f = fixture();
    let client =
        DirectClient::new(Arc::clone(&f.registry)).with_on_approval_needed(Arc::new(|_| {
            Box::pin(async {
                std::thread::sleep(std::time::Duration::from_millis(20));
                Ok(true)
            })
        }));
    let result = client
        .call(
            "item-delete",
            json!({"id":1}),
            Some(CommandContext::new().with_timeout(1)),
        )
        .await;
    assert_eq!(result.error.unwrap().code, error_codes::TIMEOUT);
    assert_eq!(f.runs.load(Ordering::SeqCst), 0);
}

/// `item-delete` (approval required, exposed to the agent by default) plus a CLI-only
/// `item-purge`, a CLI-only `item-wipe` that also needs approval, and an agent-only `item-peek`.
fn interface_fixture() -> Fixture {
    fixture_with(|registry, runs| {
        let command = |name: &str, expose: ExposeOptions| {
            CommandDefinition::new(
                name,
                name,
                vec![CommandParameter::required_number("id", "ID")],
                Counting(Arc::clone(runs)),
            )
            .with_expose(expose)
        };
        let cli_only = ExposeOptions::new().with_agent(false).with_cli(true);
        registry
            .register(command("item-purge", cli_only.clone()))
            .unwrap();
        registry
            .register(command("item-wipe", cli_only).with_approval(ApprovalPolicy::Required))
            .unwrap();
        registry
            .register(command("item-peek", ExposeOptions::new().with_cli(false)))
            .unwrap();
    })
}
#[tokio::test]
async fn the_agent_interface_is_the_default() {
    let f = interface_fixture();
    let client = DirectClient::new(Arc::clone(&f.registry));
    let purge = client.call("item-purge", json!({"id":1}), None).await;
    assert_eq!(purge.error.unwrap().code, error_codes::COMMAND_NOT_EXPOSED);
    assert!(
        client
            .call("item-peek", json!({"id":1}), None)
            .await
            .success
    );
}

#[tokio::test]
async fn the_cli_interface_runs_cli_commands_only() {
    let f = interface_fixture();
    let client = DirectClient::new(Arc::clone(&f.registry)).with_interface(CommandInterface::Cli);
    assert!(
        client
            .call("item-purge", json!({"id":1}), None)
            .await
            .success
    );
    let peek = client.call("item-peek", json!({"id":1}), None).await;
    assert_eq!(peek.error.unwrap().code, error_codes::COMMAND_NOT_EXPOSED);
    assert_eq!(f.runs.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn the_caller_context_cannot_change_the_interface() {
    let f = interface_fixture();
    let client = DirectClient::new(Arc::clone(&f.registry)).with_interface(CommandInterface::Cli);
    let context = CommandContext::new().with_interface(CommandInterface::Agent);
    let peek = client
        .call("item-peek", json!({"id":1}), Some(context))
        .await;
    assert_eq!(peek.error.unwrap().code, error_codes::COMMAND_NOT_EXPOSED);
}

#[tokio::test]
async fn unknown_name_suggestions_name_only_commands_of_the_interface() {
    let f = interface_fixture();
    let client = DirectClient::new(Arc::clone(&f.registry)).with_interface(CommandInterface::Cli);
    let error = client
        .call("item-peeks", json!({"id":1}), None)
        .await
        .error
        .unwrap();
    assert_eq!(error.code, error_codes::COMMAND_NOT_FOUND);
    let suggestion = error.suggestion.unwrap();
    assert!(!suggestion.contains("item-peek'"), "{suggestion}");
    assert!(!suggestion.contains("item-delete"), "{suggestion}");
    // The same name from the agent interface suggests the agent command.
    let agent = DirectClient::new(Arc::clone(&f.registry));
    let error = agent
        .call("item-peeks", json!({"id":1}), None)
        .await
        .error
        .unwrap();
    assert!(error.suggestion.unwrap().contains("'item-peek'"));
}

#[tokio::test]
async fn the_approval_hook_runs_once_on_the_cli_interface() {
    let f = interface_fixture();
    let decisions = Arc::new(AtomicUsize::new(0));
    let calls = Arc::clone(&decisions);
    let client = DirectClient::new(Arc::clone(&f.registry))
        .with_interface(CommandInterface::Cli)
        .with_on_approval_needed(Arc::new(move |request| {
            calls.fetch_add(1, Ordering::SeqCst);
            assert_eq!(request.command, "item-wipe");
            Box::pin(async { Ok(true) })
        }));
    let result = client.call("item-wipe", json!({"id":1}), None).await;
    assert_eq!(result.data, Some(json!({"id":1})));
    assert_eq!(decisions.load(Ordering::SeqCst), 1);
    assert_eq!(f.runs.load(Ordering::SeqCst), 1);
    // The token went to the host's observer, never to the caller.
    assert_eq!(f.tokens.lock().unwrap().len(), 1);
}
