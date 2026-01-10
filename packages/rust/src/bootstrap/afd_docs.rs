//! afd-docs bootstrap command.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::commands::{
    CommandContext, CommandDefinition, CommandHandler, CommandParameter, CommandRegistry,
};
use crate::result::{success_with, CommandResult, ResultOptions};

use super::{BOOTSTRAP_CATEGORY, BOOTSTRAP_TAGS};

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DocsInput {
    #[serde(default)]
    pub command: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocsOutput {
    pub markdown: String,
    pub command_count: usize,
}

pub struct AfdDocsHandler {
    registry: Arc<CommandRegistry>,
}

impl AfdDocsHandler {
    pub fn new(registry: Arc<CommandRegistry>) -> Self {
        Self { registry }
    }

    fn generate_command_docs(&self, cmd: &CommandDefinition) -> String {
        let mut lines: Vec<String> = Vec::new();
        lines.push(format!("### `{}`", cmd.name));
        lines.push(String::new());
        lines.push(cmd.description.clone());
        lines.push(String::new());

        if let Some(tags) = &cmd.tags {
            if !tags.is_empty() {
                let tag_str = tags
                    .iter()
                    .map(|t| format!("`{}`", t))
                    .collect::<Vec<_>>()
                    .join(", ");
                lines.push(format!("**Tags:** {}", tag_str));
                lines.push(String::new());
            }
        }

        lines.push(format!(
            "**Mutation:** {}",
            if cmd.mutation { "Yes" } else { "No (read-only)" }
        ));
        lines.push(String::new());

        if !cmd.parameters.is_empty() {
            lines.push("**Parameters:**".to_string());
            lines.push(String::new());
            lines.push("| Name | Type | Required | Description |".to_string());
            lines.push("|------|------|----------|-------------|".to_string());
            for param in &cmd.parameters {
                let required = if param.required { "Yes" } else { "No" };
                let type_str = format!("{:?}", param.param_type).to_lowercase();
                lines.push(format!(
                    "| {} | {} | {} | {} |",
                    param.name, type_str, required, param.description
                ));
            }
            lines.push(String::new());
        }

        lines.push("---".to_string());
        lines.push(String::new());
        lines.join("\n")
    }
}

#[async_trait]
impl CommandHandler for AfdDocsHandler {
    async fn execute(
        &self,
        input: serde_json::Value,
        _context: CommandContext,
    ) -> CommandResult<serde_json::Value> {
        let input: DocsInput = serde_json::from_value(input).unwrap_or_default();
        let all_commands = self.registry.list();

        let commands: Vec<_> = if let Some(ref cmd_name) = input.command {
            all_commands
                .into_iter()
                .filter(|cmd| cmd.name == *cmd_name)
                .collect()
        } else {
            all_commands
        };

        if input.command.is_some() && commands.is_empty() {
            let output = DocsOutput {
                markdown: String::new(),
                command_count: 0,
            };
            return success_with(
                serde_json::to_value(output).unwrap(),
                ResultOptions {
                    reasoning: Some(format!(
                        "Command \"{}\" not found",
                        input.command.unwrap()
                    )),
                    confidence: Some(1.0),
                    ..Default::default()
                },
            );
        }

        let mut by_category: std::collections::HashMap<String, Vec<&Arc<CommandDefinition>>> =
            std::collections::HashMap::new();
        for cmd in &commands {
            let category = cmd
                .category
                .as_ref()
                .cloned()
                .unwrap_or_else(|| "General".to_string());
            by_category.entry(category).or_default().push(cmd);
        }

        let mut lines: Vec<String> = Vec::new();
        lines.push("# Command Documentation".to_string());
        lines.push(String::new());

        let mut categories: Vec<_> = by_category.keys().cloned().collect();
        categories.sort();

        for category in categories {
            let cmds = by_category.get(&category).unwrap();
            lines.push(format!("## {}", category));
            lines.push(String::new());

            let mut sorted_cmds: Vec<_> = cmds.iter().collect();
            sorted_cmds.sort_by(|a, b| a.name.cmp(&b.name));

            for cmd in sorted_cmds {
                lines.push(self.generate_command_docs(cmd));
            }
        }

        let markdown = lines.join("\n");
        let command_count = commands.len();
        let output = DocsOutput {
            markdown,
            command_count,
        };

        let reasoning = if let Some(cmd_name) = input.command {
            format!("Generated documentation for \"{}\"", cmd_name)
        } else {
            format!("Generated documentation for {} commands", command_count)
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

pub fn create_afd_docs_command(registry: Arc<CommandRegistry>) -> CommandDefinition {
    CommandDefinition::new(
        "afd-docs",
        "Get detailed documentation for commands",
        vec![CommandParameter::optional_string(
            "command",
            "Specific command name, or omit for all",
        )],
        AfdDocsHandler::new(registry),
    )
    .with_category(BOOTSTRAP_CATEGORY)
    .with_tags(BOOTSTRAP_TAGS.iter().map(|s| s.to_string()).collect())
    .with_version("1.0.0")
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
        let mut registry = CommandRegistry::new();
        let cmd1 = CommandDefinition::new(
            "todo-create",
            "Create a new todo item",
            vec![
                CommandParameter::required_string("title", "The todo title"),
                CommandParameter::optional_string("description", "Optional description"),
            ],
            TestHandler,
        )
        .with_category("todo")
        .with_tags(vec!["todo".to_string(), "write".to_string()])
        .as_mutation();
        let cmd2 = CommandDefinition::new("todo-list", "List all todos", vec![], TestHandler)
            .with_category("todo")
            .with_tags(vec!["todo".to_string(), "read".to_string()]);
        registry.register(cmd1).unwrap();
        registry.register(cmd2).unwrap();
        Arc::new(registry)
    }

    #[tokio::test]
    async fn test_afd_docs_all() {
        let registry = create_test_registry();
        let handler = AfdDocsHandler::new(registry);
        let result = handler
            .execute(serde_json::json!({}), CommandContext::new())
            .await;
        assert!(result.success);
        let data = result.data.unwrap();
        let output: DocsOutput = serde_json::from_value(data).unwrap();
        assert_eq!(output.command_count, 2);
        assert!(output.markdown.contains("# Command Documentation"));
    }

    #[tokio::test]
    async fn test_afd_docs_not_found() {
        let registry = create_test_registry();
        let handler = AfdDocsHandler::new(registry);
        let result = handler
            .execute(
                serde_json::json!({"command": "nonexistent"}),
                CommandContext::new(),
            )
            .await;
        assert!(result.success);
        let data = result.data.unwrap();
        let output: DocsOutput = serde_json::from_value(data).unwrap();
        assert_eq!(output.command_count, 0);
        assert!(output.markdown.is_empty());
    }
}
