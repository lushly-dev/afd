use super::*;
use crate::commands::{CommandInterface, CommandParameter};
use crate::{BatchCommand, BatchRequest};
use serde_json::json;

struct Echo;

#[async_trait]
impl CommandHandler for Echo {
    async fn execute(&self, input: Value, _context: CommandContext) -> CommandResult<Value> {
        crate::success(input)
    }
}

fn registry() -> Arc<CommandRegistry> {
    let registry = CommandRegistry::new();
    let mcp = ExposeOptions::new().with_mcp(true);
    registry
        .register(
            CommandDefinition::new(
                "plan-create",
                "Create a plan",
                vec![CommandParameter::required_string("title", "Title")],
                Echo,
            )
            .with_contexts(["planning"])
            .with_expose(mcp.clone()),
        )
        .unwrap();
    registry
        .register(CommandDefinition::new("note-add", "Add a note", vec![], Echo).with_expose(mcp))
        .unwrap();
    Arc::new(registry)
}

fn configs() -> Vec<ContextConfig> {
    vec![
        ContextConfig::new("planning").with_description("Plan work"),
        ContextConfig::new("review")
            .with_priority(5)
            .with_triggers(["review"]),
    ]
}

#[test]
fn stacks_cap_depth_and_ignore_reentering_the_active_context() {
    let stack = ContextStack::with_max_depth(2);
    stack.enter("a").unwrap();
    stack.enter("a").unwrap();
    assert_eq!(stack.entries(), ["a"]);
    stack.enter("b").unwrap();
    assert_eq!(
        stack.enter("c").unwrap_err(),
        "Context stack is limited to 2 levels"
    );
    assert_eq!(stack.exit().as_deref(), Some("b"));
    assert_eq!(stack.active().as_deref(), Some("a"));
    assert_eq!(ContextStack::new().max_depth(), DEFAULT_CONTEXT_MAX_DEPTH);
}

#[tokio::test]
async fn execution_rejects_commands_outside_the_active_context_before_validation() {
    let registry = registry();
    // No `title`: the context check comes first.
    let result = registry
        .execute(
            "plan-create",
            json!({}),
            Some(CommandContext::new().with_active_context("review")),
        )
        .await;
    let error = result.error.unwrap();
    assert_eq!(error.code, "COMMAND_NOT_IN_CONTEXT");
    assert_eq!(
        error.message,
        "Command 'plan-create' is not available in context 'review'"
    );
    // No context tools registered: the suggestion names the command's contexts.
    assert_eq!(
        error.suggestion.as_deref(),
        Some("Switch to a context this command belongs to ('planning'), or call it with no active context.")
    );

    let universal = registry
        .execute(
            "note-add",
            json!({}),
            Some(CommandContext::new().with_active_context("review")),
        )
        .await;
    assert!(universal.success);
    let scoped = registry
        .execute(
            "plan-create",
            json!({ "title": "x" }),
            Some(CommandContext::new().with_active_context("planning")),
        )
        .await;
    assert!(scoped.success);
}

#[tokio::test]
async fn batch_items_are_scoped_like_single_calls() {
    let registry = registry();
    let request = BatchRequest::new(vec![
        BatchCommand::new("note-add", json!({})),
        BatchCommand::new("plan-create", json!({ "title": "x" })),
    ]);
    let result = registry
        .execute_batch_with_context(request, CommandContext::new().with_active_context("review"))
        .await;
    assert!(result.results[0].result.success);
    assert_eq!(
        result.results[1].result.error.as_ref().unwrap().code,
        "COMMAND_NOT_IN_CONTEXT"
    );
}

#[tokio::test]
async fn not_found_suggestions_leave_out_commands_outside_the_context() {
    let registry = registry();
    let result = registry
        .execute(
            "plan-creat",
            json!({}),
            Some(CommandContext::new().with_active_context("review")),
        )
        .await;
    let suggestion = result.error.unwrap().suggestion.unwrap();
    assert!(!suggestion.contains("plan-create"), "{suggestion}");
}

#[tokio::test]
async fn context_commands_enter_list_and_exit_a_session_stack() {
    let registry = registry();
    register_context_commands(&registry, configs()).unwrap();
    let stack = ContextStack::new();
    let session = || {
        Some(
            CommandContext::new()
                .with_interface(CommandInterface::Mcp)
                .with_context_stack(stack.clone()),
        )
    };

    let entered = registry
        .execute(
            "afd-context-enter",
            json!({ "context": "planning" }),
            session(),
        )
        .await;
    assert_eq!(
        entered.data,
        Some(json!({ "entered": "planning", "previous": null }))
    );
    assert_eq!(
        entered.reasoning.as_deref(),
        Some("Entered context 'planning'")
    );
    assert_eq!(stack.active().as_deref(), Some("planning"));

    let again = registry
        .execute(
            "afd-context-enter",
            json!({ "context": "planning" }),
            session(),
        )
        .await;
    assert_eq!(
        again.reasoning.as_deref(),
        Some("Already in context 'planning'; nothing changed")
    );

    let listed = registry
        .execute("afd-context-list", json!({}), session())
        .await;
    assert_eq!(
        listed.data,
        Some(json!({
            "contexts": [
                { "name": "review", "triggers": ["review"], "priority": 5 },
                { "name": "planning", "description": "Plan work" },
            ],
            "activeContext": "planning",
        }))
    );

    // With the context tools registered, the suggestion names them.
    stack.enter("review").unwrap();
    let denied = registry
        .execute("plan-create", json!({ "title": "x" }), session())
        .await;
    assert_eq!(
        denied.error.unwrap().suggestion.as_deref(),
        Some("Use afd-context-list to see available contexts, or afd-context-enter to switch.")
    );

    let exited = registry
        .execute("afd-context-exit", json!({}), session())
        .await;
    assert_eq!(
        exited.data,
        Some(json!({ "exited": "review", "current": "planning" }))
    );
    assert_eq!(
        exited.reasoning.as_deref(),
        Some("Exited context 'review', now in 'planning'")
    );
}

#[tokio::test]
async fn context_commands_validate_names_and_depth() {
    let registry = registry();
    register_context_commands(&registry, configs()).unwrap();
    let stack = ContextStack::with_max_depth(1);
    let session = Some(CommandContext::new().with_context_stack(stack.clone()));

    let unknown = registry
        .execute(
            "afd-context-enter",
            json!({ "context": "nope" }),
            session.clone(),
        )
        .await
        .error
        .unwrap();
    assert_eq!(unknown.code, "CONTEXT_NOT_FOUND");
    assert_eq!(
        unknown.suggestion.as_deref(),
        Some("Available contexts: planning, review. Use afd-context-list to see all contexts.")
    );

    stack.enter("planning").unwrap();
    let full = registry
        .execute(
            "afd-context-enter",
            json!({ "context": "review" }),
            session.clone(),
        )
        .await
        .error
        .unwrap();
    assert_eq!(full.code, "CONTEXT_DEPTH_EXCEEDED");

    let blank = registry
        .execute("afd-context-enter", json!({ "context": "" }), session)
        .await
        .error
        .unwrap();
    assert_eq!(blank.code, "VALIDATION_ERROR");
}

#[tokio::test]
async fn a_request_context_validates_but_never_persists() {
    let registry = registry();
    register_context_commands(&registry, configs()).unwrap();
    let request = Some(CommandContext::new().with_active_context("planning"));
    let entered = registry
        .execute(
            "afd-context-enter",
            json!({ "context": "review" }),
            request.clone(),
        )
        .await;
    assert_eq!(
        entered.data,
        Some(json!({ "entered": "review", "previous": "planning", "persisted": false }))
    );
    let exited = registry
        .execute("afd-context-exit", json!({}), request)
        .await;
    assert_eq!(
        exited.data,
        Some(json!({ "exited": null, "current": "planning", "persisted": false }))
    );
}

#[tokio::test]
async fn context_changes_need_a_session() {
    let registry = registry();
    register_context_commands(&registry, configs()).unwrap();
    for (name, input) in [
        ("afd-context-enter", json!({ "context": "planning" })),
        ("afd-context-exit", json!({})),
    ] {
        let unscoped = registry.execute(name, input.clone(), None).await;
        assert_eq!(unscoped.error.unwrap().code, "SESSION_REQUIRED");
        let no_session = registry
            .execute(
                name,
                input,
                Some(CommandContext {
                    context_scope: Some(ContextScope::NoSession),
                    ..CommandContext::new()
                }),
            )
            .await;
        assert_eq!(no_session.error.unwrap().code, "SESSION_REQUIRED");
    }
    let listed = registry.execute("afd-context-list", json!({}), None).await;
    assert_eq!(listed.data.unwrap()["activeContext"], Value::Null);
}

#[test]
fn registration_rejects_bad_configurations() {
    let registry = registry();
    assert!(register_context_commands(&registry, vec![]).is_err());
    assert!(register_context_commands(
        &registry,
        vec![ContextConfig::new("a"), ContextConfig::new("a")]
    )
    .is_err());
    assert!(register_context_commands(&registry, vec![ContextConfig::new(" ")]).is_err());
    register_context_commands(&registry, configs()).unwrap();
    assert_eq!(
        register_context_commands(&registry, configs()).unwrap_err(),
        "Reserved context command name: afd-context-list"
    );
}

#[test]
fn context_commands_are_bootstrap_commands_exposed_to_mcp() {
    let commands = get_context_commands(configs());
    let names: Vec<&str> = commands
        .iter()
        .map(|command| command.name.as_str())
        .collect();
    assert_eq!(names, crate::AFD_CONTEXT_COMMAND_NAMES);
    for command in &commands {
        assert!(command.expose.mcp);
        assert_eq!(command.category.as_deref(), Some("bootstrap"));
    }
    assert!(!commands[0].mutation);
    assert!(commands[1].mutation && commands[2].mutation);
}
