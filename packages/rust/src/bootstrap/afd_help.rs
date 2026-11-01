//! afd-help bootstrap command.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Weak};

use crate::commands::{
    CommandContext, CommandDefinition, CommandHandler, CommandParameter, CommandRegistry,
};
use crate::context_fields::ContextField;
use crate::result::{failure, success_with, CommandResult, ResultOptions};

use super::{bootstrap_expose, RegistryRef, BOOTSTRAP_CATEGORY, BOOTSTRAP_TAGS};

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HelpInput {
    #[serde(default)]
    pub filter: Option<String>,
    #[serde(default = "default_format")]
    pub format: String,
}

fn default_format() -> String {
    "brief".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandInfo {
    pub name: String,
    /// The display label when set (`full` format only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mutation: Option<bool>,
    /// `destructive` when set (`full` format only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub destructive: Option<bool>,
    /// `undoable` when set (`full` format only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub undoable: Option<bool>,
    /// The approval policy when declared (`full` format only); a function policy is
    /// `conditional`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval: Option<crate::ApprovalMode>,
    /// Commands to call first (always listed when set).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requires: Option<Vec<String>>,
    /// `true` for a first-class command of a hybrid MCP server; left out otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_class: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelpOutput {
    /// The AFD contract version this crate implements ([`crate::CONTRACT_VERSION`]).
    pub contract_version: String,
    pub commands: Vec<CommandInfo>,
    pub total: usize,
    pub filtered: bool,
    pub grouped_by_category: HashMap<String, Vec<CommandInfo>>,
    /// How the MCP server lists its tools: `individual`, `grouped`, `lazy` or `hybrid`. Left out
    /// when `afd-help` does not run behind an MCP server.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_strategy: Option<String>,
    /// The first-class command names in list order, on a hybrid MCP server only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_class_tools: Option<Vec<String>>,
    /// The described registry's declared context fields
    /// ([`CommandRegistry::set_context_fields`]), in declaration order and as `server/discover`
    /// lists them, so an agent knows which `_meta` keys to send (`spec/context-fields.md`,
    /// "Discovery"). Left out when none are declared.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_fields: Option<Vec<ContextField>>,
}

/// Handler for `afd-help`.
pub struct AfdHelpHandler {
    registry: RegistryRef,
}

impl AfdHelpHandler {
    /// Describe `registry`, keeping it alive.
    pub fn new(registry: Arc<CommandRegistry>) -> Self {
        Self::from_ref(RegistryRef::Strong(registry))
    }

    /// Describe `registry` without keeping it alive, for a handler that is
    /// registered into that same registry.
    pub fn from_weak(registry: Weak<CommandRegistry>) -> Self {
        Self::from_ref(RegistryRef::Weak(registry))
    }

    pub(crate) fn from_ref(registry: RegistryRef) -> Self {
        Self { registry }
    }
}

#[async_trait]
impl CommandHandler for AfdHelpHandler {
    async fn execute(
        &self,
        input: serde_json::Value,
        context: CommandContext,
    ) -> CommandResult<serde_json::Value> {
        let input: HelpInput = serde_json::from_value(input).unwrap_or_default();
        let all_commands = match self.registry.describable_commands(&context) {
            Ok(commands) => commands,
            Err(error) => return failure(*error),
        };
        let filtered = input.filter.is_some();

        let commands: Vec<_> = if let Some(ref filter_text) = input.filter {
            let filter_lower = filter_text.to_lowercase();
            all_commands
                .into_iter()
                .filter(|cmd| {
                    let tag_match = cmd
                        .tags
                        .as_ref()
                        .map(|tags| {
                            tags.iter()
                                .any(|t| t.to_lowercase().contains(&filter_lower))
                        })
                        .unwrap_or(false);
                    let category_match = cmd
                        .category
                        .as_ref()
                        .map(|c| c.to_lowercase().contains(&filter_lower))
                        .unwrap_or(false);
                    let name_match = cmd.name.to_lowercase().contains(&filter_lower);
                    tag_match || category_match || name_match
                })
                .collect()
        } else {
            all_commands
        };

        let surface = context.tool_surface.as_ref();
        let first_class: &[String] = surface
            .and_then(|surface| surface.first_class_tools.as_deref())
            .map_or(&[], Vec::as_slice);
        let is_full = input.format == "full";
        let mut grouped_by_category: HashMap<String, Vec<CommandInfo>> = HashMap::new();
        let mut command_infos: Vec<CommandInfo> = Vec::new();

        for cmd in &commands {
            let info = CommandInfo {
                name: cmd.name.clone(),
                title: if is_full { cmd.title.clone() } else { None },
                description: cmd.description.clone(),
                category: if is_full { cmd.category.clone() } else { None },
                tags: if is_full { cmd.tags.clone() } else { None },
                mutation: if is_full { Some(cmd.mutation) } else { None },
                destructive: if is_full { cmd.destructive } else { None },
                undoable: if is_full { cmd.undoable } else { None },
                approval: if is_full {
                    crate::approval_mode(cmd.approval.as_ref())
                } else {
                    None
                },
                requires: cmd.requires.clone().filter(|requires| !requires.is_empty()),
                first_class: first_class.contains(&cmd.name).then_some(true),
            };
            let category = cmd
                .category
                .as_ref()
                .cloned()
                .unwrap_or_else(|| "uncategorized".to_string());
            grouped_by_category
                .entry(category)
                .or_default()
                .push(info.clone());
            command_infos.push(info);
        }

        let total = command_infos.len();
        let output = HelpOutput {
            contract_version: crate::CONTRACT_VERSION.to_string(),
            commands: command_infos,
            total,
            filtered,
            grouped_by_category,
            tool_strategy: surface.map(|surface| surface.strategy.to_owned()),
            first_class_tools: surface
                .and_then(|surface| surface.first_class_tools.as_deref())
                .cloned(),
            context_fields: Some(self.registry.context_fields())
                .filter(|fields| !fields.is_empty()),
        };

        let reasoning = if filtered {
            format!(
                "Found {} commands matching \"{}\"",
                total,
                input.filter.unwrap_or_default()
            )
        } else {
            format!("Listing all {} available commands", total)
        };

        success_with(
            serde_json::to_value(output).unwrap(),
            ResultOptions {
                reasoning: Some(reasoning),
                confidence: Some(1.0),
                ..Default::default()
            },
        )
    }
}

/// Create `afd-help` for `registry`, keeping it alive. To register it into
/// `registry` itself, use [`super::register_bootstrap_commands`].
pub fn create_afd_help_command(registry: Arc<CommandRegistry>) -> CommandDefinition {
    command(AfdHelpHandler::new(registry))
}

pub(super) fn command(handler: AfdHelpHandler) -> CommandDefinition {
    CommandDefinition::new(
        "afd-help",
        "List all available commands with tags and grouping",
        vec![
            CommandParameter::optional_string("filter", "Tag filter"),
            CommandParameter::optional_string("format", "Output format")
                .with_default(serde_json::json!("brief"))
                .with_enum(vec![serde_json::json!("brief"), serde_json::json!("full")]),
        ],
        handler,
    )
    .with_category(BOOTSTRAP_CATEGORY)
    .with_tags(BOOTSTRAP_TAGS.iter().map(|s| s.to_string()).collect())
    .with_version("1.0.0")
    .with_expose(bootstrap_expose())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::result::success;

    struct TestHandler;

    #[async_trait]
    impl CommandHandler for TestHandler {
        async fn execute(
            &self,
            _input: serde_json::Value,
            _context: CommandContext,
        ) -> CommandResult<serde_json::Value> {
            success(serde_json::json!({"test": true}))
        }
    }

    fn create_test_registry() -> Arc<CommandRegistry> {
        let registry = CommandRegistry::new();
        let cmd1 = CommandDefinition::new(
            "todo-create",
            "Create a new todo",
            vec![CommandParameter::required_string("title", "Todo title")],
            TestHandler,
        )
        .with_category("todo")
        .with_tags(vec!["todo".to_string(), "write".to_string()])
        .as_mutation();
        let cmd2 = CommandDefinition::new("todo-list", "List all todos", vec![], TestHandler)
            .with_category("todo")
            .with_tags(vec!["todo".to_string(), "read".to_string()]);
        let cmd3 = CommandDefinition::new(
            "user-get",
            "Get user by ID",
            vec![CommandParameter::required_string("id", "User ID")],
            TestHandler,
        )
        .with_category("user")
        .with_tags(vec!["user".to_string(), "read".to_string()]);
        registry.register(cmd1).unwrap();
        registry.register(cmd2).unwrap();
        registry.register(cmd3).unwrap();
        Arc::new(registry)
    }

    #[tokio::test]
    async fn test_afd_help_list_all() {
        let registry = create_test_registry();
        let handler = AfdHelpHandler::new(registry);
        let result = handler
            .execute(serde_json::json!({}), CommandContext::new())
            .await;
        assert!(result.success);
        let data = result.data.unwrap();
        let output: HelpOutput = serde_json::from_value(data).unwrap();
        assert_eq!(output.total, 3);
        assert!(!output.filtered);
    }

    #[tokio::test]
    async fn test_afd_help_reports_contract_version() {
        let registry = create_test_registry();
        let handler = AfdHelpHandler::new(registry);
        let result = handler
            .execute(
                serde_json::json!({"filter": "nothing-matches"}),
                CommandContext::new(),
            )
            .await;
        let data = result.data.unwrap();
        assert_eq!(data["contractVersion"], crate::CONTRACT_VERSION);
        assert_eq!(data["total"], 0);
    }

    #[tokio::test]
    async fn test_afd_help_lists_declared_context_fields() {
        let registry = create_test_registry();
        let handler = AfdHelpHandler::new(Arc::clone(&registry));
        let result = handler
            .execute(serde_json::json!({}), CommandContext::new())
            .await;
        // Left out when none are declared.
        assert!(result.data.unwrap().get("contextFields").is_none());

        let scope = ContextField::new(
            "scope",
            "dev.example/scope",
            serde_json::json!({"type": "object"}),
        )
        .with_journal(true);
        let locale = ContextField::new(
            "locale",
            "dev.example/locale",
            serde_json::json!({"type": "string"}),
        )
        .with_required(true);
        registry
            .set_context_fields([scope.clone(), locale.clone()])
            .unwrap();
        let result = handler
            .execute(serde_json::json!({}), CommandContext::new())
            .await;
        let data = result.data.unwrap();
        assert_eq!(
            data["contextFields"],
            serde_json::json!([
                {"name": "scope", "meta": "dev.example/scope", "schema": {"type": "object"}, "required": false, "journal": true},
                {"name": "locale", "meta": "dev.example/locale", "schema": {"type": "string"}, "required": true, "journal": false},
            ])
        );
        let output: HelpOutput = serde_json::from_value(data).unwrap();
        assert_eq!(output.context_fields, Some(vec![scope, locale]));
    }

    #[tokio::test]
    async fn test_afd_help_filter_by_tag() {
        let registry = create_test_registry();
        let handler = AfdHelpHandler::new(registry);
        let result = handler
            .execute(serde_json::json!({"filter": "todo"}), CommandContext::new())
            .await;
        assert!(result.success);
        let data = result.data.unwrap();
        let output: HelpOutput = serde_json::from_value(data).unwrap();
        assert_eq!(output.total, 2);
        assert!(output.filtered);
    }

    #[tokio::test]
    async fn test_afd_help_grouped_by_category() {
        let registry = create_test_registry();
        let handler = AfdHelpHandler::new(registry);
        let result = handler
            .execute(serde_json::json!({}), CommandContext::new())
            .await;
        assert!(result.success);
        let data = result.data.unwrap();
        let output: HelpOutput = serde_json::from_value(data).unwrap();
        assert!(output.grouped_by_category.contains_key("todo"));
        assert!(output.grouped_by_category.contains_key("user"));
        assert_eq!(output.grouped_by_category.get("todo").unwrap().len(), 2);
        assert_eq!(output.grouped_by_category.get("user").unwrap().len(), 1);
    }
}
