//! What the approval admission tests share (#1886): commands that record their runs, with each
//! kind of approval policy, and a command that runs another from its handler.
#![allow(dead_code)]

use afd::*;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex, OnceLock};

pub fn expect_unavailable(result: &CommandResult<Value>, command: &str, reason: &str) {
    assert!(!result.success, "{result:?}");
    let error = result.error.as_ref().expect("an error");
    assert_eq!(error.code, "APPROVAL_UNAVAILABLE", "{error:?}");
    assert_eq!(
        error.message,
        format!("{command} needs a person's approval, and this server cannot ask for it")
    );
    assert_eq!(error.retryable, Some(false));
    assert_eq!(
        error
            .details
            .as_ref()
            .and_then(|details| details.get("reason")),
        Some(&json!(reason))
    );
    let suggestion = error.suggestion.as_deref().unwrap_or_default();
    assert!(
        suggestion.to_lowercase().contains("do not retry"),
        "{suggestion}"
    );
    // The operator fixes the approval setup (`spec/recovery.md`, "Engine errors").
    assert_eq!(
        serde_json::to_value(&error.recovery).unwrap(),
        json!({ "kind": "external" }),
        "{error:?}"
    );
}

pub fn code(result: &CommandResult<Value>) -> Option<&str> {
    result.error.as_ref().map(|error| error.code.as_str())
}

pub type Ran = Arc<Mutex<Vec<String>>>;

/// Records `<command>:<id>` and returns the input.
pub struct Recording {
    pub name: &'static str,
    pub ran: Ran,
}

#[async_trait]
impl CommandHandler for Recording {
    async fn execute(&self, input: Value, _: CommandContext) -> CommandResult<Value> {
        let id = input.get("id").cloned().unwrap_or(Value::Null);
        self.ran.lock().unwrap().push(format!("{}:{id}", self.name));
        success(input)
    }
}

pub fn command(
    name: &'static str,
    approval: Option<ApprovalPolicy>,
    ran: &Ran,
) -> CommandDefinition {
    let definition = CommandDefinition::new(
        name,
        format!("Command {name}"),
        vec![CommandParameter::required_number("id", "ID")],
        Recording {
            name,
            ran: Arc::clone(ran),
        },
    );
    match approval {
        Some(approval) => definition.with_approval(approval),
        None => definition,
    }
}

/// Commands with each kind of policy.
pub fn commands(ran: &Ran) -> Vec<CommandDefinition> {
    vec![
        command("todo-delete", Some(ApprovalPolicy::Required), ran),
        command(
            "todo-check",
            Some(ApprovalPolicy::when(|_, _| ApprovalDecision::NotRequired)),
            ran,
        ),
        command("todo-touch", Some(ApprovalPolicy::NotRequired), ran),
        command("todo-list", None, ran),
    ]
}

pub fn registry_with(commands: Vec<CommandDefinition>) -> Arc<CommandRegistry> {
    let registry = Arc::new(CommandRegistry::new());
    for command in commands {
        registry.register(command).unwrap();
    }
    registry
}

pub fn approving(registry: &Arc<CommandRegistry>) -> DirectClient {
    DirectClient::new(Arc::clone(registry))
        .with_on_approval_needed(Arc::new(|_| Box::pin(async { Ok(true) })))
}

pub fn ran_list(ran: &Ran) -> Vec<String> {
    ran.lock().unwrap().clone()
}

pub fn pass_through() -> CommandMiddleware {
    Arc::new(|_, _, context, next| next(context))
}

/// Runs `inner` from its handler, on its own context, and keeps the nested result.
pub struct Sweep {
    registry: RegistryCell,
    inner: &'static str,
    nested: Nested,
    ran: Ran,
}

#[async_trait]
impl CommandHandler for Sweep {
    async fn execute(&self, _: Value, context: CommandContext) -> CommandResult<Value> {
        self.ran.lock().unwrap().push("todo-sweep".to_owned());
        let registry = Arc::clone(self.registry.get().expect("the registry is set"));
        let result = registry
            .execute(self.inner, json!({"id": 9}), Some(context))
            .await;
        *self.nested.lock().unwrap() = Some(result);
        success(json!(null))
    }
}

pub type RegistryCell = Arc<OnceLock<Arc<CommandRegistry>>>;
pub type Nested = Arc<Mutex<Option<CommandResult<Value>>>>;

pub fn sweep(
    approval: Option<ApprovalPolicy>,
    ran: &Ran,
) -> (CommandDefinition, RegistryCell, Nested) {
    let cell = Arc::new(OnceLock::new());
    let nested = Arc::new(Mutex::new(None));
    let definition = CommandDefinition::new(
        "todo-sweep",
        "Runs todo-delete from its handler",
        vec![],
        Sweep {
            registry: Arc::clone(&cell),
            inner: "todo-delete",
            nested: Arc::clone(&nested),
            ran: Arc::clone(ran),
        },
    );
    let definition = match approval {
        Some(approval) => definition.with_approval(approval),
        None => definition,
    };
    (definition, cell, nested)
}
