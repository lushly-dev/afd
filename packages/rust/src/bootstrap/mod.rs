//! Bootstrap commands for AFD servers.
//!
//! Bootstrap commands (`afd-help`, `afd-docs`, `afd-schema`) provide
//! introspection and documentation for the commands of a registry. Register
//! them into the registry they describe with [`register_bootstrap_commands`],
//! so that they list themselves alongside the application's commands.
//!
//! When the calling [`CommandContext`] has an `interface`, they describe only
//! the commands exposed to that interface. They are themselves exposed to
//! MCP, as in TypeScript.

mod afd_docs;
mod afd_help;
mod afd_schema;

pub use afd_docs::{create_afd_docs_command, AfdDocsHandler, DocsInput, DocsOutput};
pub use afd_help::{create_afd_help_command, AfdHelpHandler, CommandInfo, HelpInput, HelpOutput};
pub use afd_schema::{
    create_afd_schema_command, AfdSchemaHandler, SchemaFormat, SchemaInfo, SchemaInput,
    SchemaOutput,
};

use crate::commands::{CommandContext, CommandDefinition, CommandRegistry, ExposeOptions};
use crate::errors::{error_codes, CommandError};
use std::sync::{Arc, Weak};

/// Names of the bootstrap commands.
pub const BOOTSTRAP_COMMAND_NAMES: &[&str] = &["afd-help", "afd-docs", "afd-schema"];

/// Get all bootstrap commands for `registry`.
///
/// The commands hold a weak reference to `registry`, so registering them into
/// it creates no reference cycle; keep the registry alive (in its `Arc`) while
/// they are used. To describe a registry from outside it, build the commands
/// with [`create_afd_help_command`] and the other `create_*` functions, which
/// keep a strong reference.
pub fn get_bootstrap_commands(registry: &Arc<CommandRegistry>) -> Vec<CommandDefinition> {
    let registry = RegistryRef::Weak(Arc::downgrade(registry));
    vec![
        afd_help::command(AfdHelpHandler::from_ref(registry.clone())),
        afd_docs::command(AfdDocsHandler::from_ref(registry.clone())),
        afd_schema::command(AfdSchemaHandler::from_ref(registry)),
    ]
}

/// Register `afd-help`, `afd-docs` and `afd-schema` into `registry` itself.
///
/// Afterwards `afd-help` lists the bootstrap commands alongside the
/// application's commands, including ones registered later.
///
/// # Errors
/// Returns an error, and registers nothing, if a command with one of the
/// bootstrap names is already registered.
pub fn register_bootstrap_commands(registry: &Arc<CommandRegistry>) -> Result<(), String> {
    if let Some(name) = BOOTSTRAP_COMMAND_NAMES
        .iter()
        .find(|name| registry.has(name))
    {
        return Err(format!("Command '{name}' is already registered"));
    }
    for command in get_bootstrap_commands(registry) {
        registry.register(command)?;
    }
    Ok(())
}

/// Bootstrap command category name.
pub const BOOTSTRAP_CATEGORY: &str = "bootstrap";

/// Bootstrap command tags.
pub const BOOTSTRAP_TAGS: &[&str] = &["bootstrap", "read", "safe"];

/// The exposure of every bootstrap command: the defaults plus MCP.
fn bootstrap_expose() -> ExposeOptions {
    ExposeOptions::new().with_mcp(true)
}

/// The registry a bootstrap handler describes.
#[derive(Clone)]
pub(crate) enum RegistryRef {
    /// Keeps the registry alive: for handlers registered elsewhere.
    Strong(Arc<CommandRegistry>),
    /// Does not: for handlers registered into the registry they describe.
    Weak(Weak<CommandRegistry>),
}

impl RegistryRef {
    /// The commands the calling context may see: all of them, or only those
    /// exposed to `context.interface` when it is set.
    pub(crate) fn describable_commands(
        &self,
        context: &CommandContext,
    ) -> Result<Vec<Arc<CommandDefinition>>, Box<CommandError>> {
        let registry = match self {
            Self::Strong(registry) => Arc::clone(registry),
            Self::Weak(registry) => registry.upgrade().ok_or_else(|| {
                Box::new(
                    CommandError::new(
                        error_codes::INTERNAL_ERROR,
                        "The command registry this command describes no longer exists",
                    )
                    .with_suggestion(
                        "Keep the Arc<CommandRegistry> alive while its bootstrap commands are in use",
                    )
                    .with_retryable(false),
                )
            })?,
        };
        Ok(match context.interface {
            Some(interface) => registry.list_by_exposure(interface),
            None => registry.list(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::{CommandHandler, CommandInterface, CommandParameter};
    use crate::result::{success, CommandResult};
    use async_trait::async_trait;

    struct EchoHandler;

    #[async_trait]
    impl CommandHandler for EchoHandler {
        async fn execute(
            &self,
            input: serde_json::Value,
            _context: CommandContext,
        ) -> CommandResult<serde_json::Value> {
            success(input)
        }
    }

    fn app_registry() -> Arc<CommandRegistry> {
        let registry = Arc::new(CommandRegistry::new());
        registry
            .register(
                CommandDefinition::new(
                    "todo-create",
                    "Create a todo",
                    vec![CommandParameter::required_string("title", "Title")],
                    EchoHandler,
                )
                .with_requires(["todo-list"]),
            )
            .unwrap();
        registry
            .register(
                CommandDefinition::new("todo-list", "List todos", vec![], EchoHandler)
                    .with_expose(ExposeOptions::new().with_mcp(true)),
            )
            .unwrap();
        registry
    }

    fn names(data: &serde_json::Value) -> Vec<String> {
        data["commands"]
            .as_array()
            .unwrap()
            .iter()
            .map(|command| command["name"].as_str().unwrap().to_string())
            .collect()
    }

    #[tokio::test]
    async fn afd_help_lists_itself_alongside_app_commands() {
        let registry = app_registry();
        register_bootstrap_commands(&registry).unwrap();

        let result = registry
            .execute("afd-help", serde_json::json!({}), None)
            .await;

        assert!(result.success, "{:?}", result.error);
        let data = result.data.unwrap();
        assert_eq!(
            names(&data),
            vec![
                "todo-create",
                "todo-list",
                "afd-help",
                "afd-docs",
                "afd-schema"
            ]
        );
        assert_eq!(data["total"], 5);
        assert_eq!(
            data["commands"][0]["requires"],
            serde_json::json!(["todo-list"])
        );
    }

    #[tokio::test]
    async fn bootstrap_commands_see_commands_registered_later() {
        let registry = app_registry();
        register_bootstrap_commands(&registry).unwrap();
        registry
            .register(CommandDefinition::new(
                "todo-clear",
                "Clear todos",
                vec![],
                EchoHandler,
            ))
            .unwrap();

        let result = registry
            .execute(
                "afd-docs",
                serde_json::json!({"command": "todo-clear"}),
                None,
            )
            .await;

        assert!(result.success);
        assert_eq!(result.data.unwrap()["commandCount"], 1);
    }

    #[tokio::test]
    async fn bootstrap_commands_describe_only_commands_exposed_to_the_caller() {
        let registry = app_registry();
        register_bootstrap_commands(&registry).unwrap();

        let result = registry
            .execute(
                "afd-help",
                serde_json::json!({}),
                Some(CommandContext::new().with_interface(CommandInterface::Mcp)),
            )
            .await;

        assert!(result.success, "{:?}", result.error);
        assert_eq!(
            names(&result.data.unwrap()),
            vec!["todo-list", "afd-help", "afd-docs", "afd-schema"]
        );
    }

    #[tokio::test]
    async fn bootstrap_input_is_validated() {
        let registry = app_registry();
        register_bootstrap_commands(&registry).unwrap();

        let result = registry
            .execute("afd-help", serde_json::json!({"format": "xml"}), None)
            .await;

        assert!(!result.success);
        assert_eq!(result.error.unwrap().code, "VALIDATION_ERROR");
    }

    #[test]
    fn registering_twice_fails_without_partial_registration() {
        let registry = app_registry();
        register_bootstrap_commands(&registry).unwrap();
        let before = registry.list().len();

        let error = register_bootstrap_commands(&registry).unwrap_err();

        assert!(error.contains("afd-help"), "{error}");
        assert_eq!(registry.list().len(), before);
    }

    #[test]
    fn self_registration_does_not_leak_the_registry() {
        let registry = app_registry();
        register_bootstrap_commands(&registry).unwrap();
        let weak = Arc::downgrade(&registry);

        drop(registry);

        assert!(
            weak.upgrade().is_none(),
            "a reference cycle kept the registry alive"
        );
    }

    #[tokio::test]
    async fn weak_handler_reports_a_dropped_registry() {
        let registry = app_registry();
        let help = get_bootstrap_commands(&registry).remove(0);
        drop(registry);

        let result = help
            .execute(serde_json::json!({}), CommandContext::new())
            .await;

        assert!(!result.success);
        assert_eq!(result.error.unwrap().code, "INTERNAL_ERROR");
    }

    #[test]
    fn bootstrap_commands_are_exposed_to_mcp() {
        let registry = app_registry();
        for command in get_bootstrap_commands(&registry) {
            assert!(
                command.expose.mcp,
                "{} should be exposed to MCP",
                command.name
            );
            assert!(command.expose.agent);
        }
    }
}
