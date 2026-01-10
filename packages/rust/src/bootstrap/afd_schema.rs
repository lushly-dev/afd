//! afd-schema bootstrap command.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::commands::{
    command_to_mcp_tool, CommandContext, CommandDefinition, CommandHandler, CommandParameter,
    CommandRegistry, JsonSchemaType, McpTool,
};
use crate::result::{success_with, CommandResult, ResultOptions};

use super::{BOOTSTRAP_CATEGORY, BOOTSTRAP_TAGS};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SchemaFormat {
    Json,
    Typescript,
}

impl Default for SchemaFormat {
    fn default() -> Self {
        SchemaFormat::Json
    }
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SchemaInput {
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub format: SchemaFormat,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaInfo {
    pub name: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_tool: Option<McpTool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub typescript: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaOutput {
    pub schemas: Vec<SchemaInfo>,
    pub total: usize,
    pub format: SchemaFormat,
}

pub struct AfdSchemaHandler {
    registry: Arc<CommandRegistry>,
}

impl AfdSchemaHandler {
    pub fn new(registry: Arc<CommandRegistry>) -> Self {
        Self { registry }
    }

    fn generate_typescript_type(&self, cmd: &CommandDefinition) -> String {
        let mut lines = Vec::new();
        lines.push(format!("// {}", cmd.description));
        lines.push(format!("interface {}Input {{", to_pascal_case(&cmd.name)));

        for param in &cmd.parameters {
            let ts_type = match param.param_type {
                JsonSchemaType::String => "string".to_string(),
                JsonSchemaType::Number | JsonSchemaType::Integer => "number".to_string(),
                JsonSchemaType::Boolean => "boolean".to_string(),
                JsonSchemaType::Array => "unknown[]".to_string(),
                JsonSchemaType::Object => "Record<string, unknown>".to_string(),
                JsonSchemaType::Null => "null".to_string(),
            };
            let optional = if param.required { "" } else { "?" };
            lines.push(format!("  {}{}: {};", param.name, optional, ts_type));
        }

        lines.push("}".to_string());
        lines.join("\n")
    }
}

fn to_pascal_case(s: &str) -> String {
    s.split(|c| c == '-' || c == '_' || c == '.')
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                None => String::new(),
                Some(first) => first.to_uppercase().chain(chars).collect(),
            }
        })
        .collect()
}

#[async_trait]
impl CommandHandler for AfdSchemaHandler {
    async fn execute(
        &self,
        input: serde_json::Value,
        _context: CommandContext,
    ) -> CommandResult<serde_json::Value> {
        let input: SchemaInput = serde_json::from_value(input).unwrap_or_default();
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
            let output = SchemaOutput {
                schemas: vec![],
                total: 0,
                format: input.format,
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

        let schemas: Vec<SchemaInfo> = commands
            .iter()
            .map(|cmd| {
                let (mcp_tool, typescript) = match input.format {
                    SchemaFormat::Json => (Some(command_to_mcp_tool(cmd)), None),
                    SchemaFormat::Typescript => (None, Some(self.generate_typescript_type(cmd))),
                };

                SchemaInfo {
                    name: cmd.name.clone(),
                    description: cmd.description.clone(),
                    mcp_tool,
                    typescript,
                }
            })
            .collect();

        let total = schemas.len();
        let output = SchemaOutput {
            schemas,
            total,
            format: input.format.clone(),
        };

        let reasoning = if let Some(cmd_name) = input.command {
            format!("Exported schema for \"{}\"", cmd_name)
        } else {
            format!("Exported {} command schemas", total)
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

pub fn create_afd_schema_command(registry: Arc<CommandRegistry>) -> CommandDefinition {
    CommandDefinition::new(
        "afd-schema",
        "Export JSON schemas for all commands",
        vec![
            CommandParameter::optional_string("command", "Specific command name, or omit for all"),
            CommandParameter::optional_string("format", "Output format: json or typescript")
                .with_default(serde_json::json!("json"))
                .with_enum(vec![
                    serde_json::json!("json"),
                    serde_json::json!("typescript"),
                ]),
        ],
        AfdSchemaHandler::new(registry),
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
        let cmd = CommandDefinition::new(
            "todo-create",
            "Create a new todo item",
            vec![
                CommandParameter::required_string("title", "The todo title"),
                CommandParameter::optional_string("description", "Optional description")
                    .with_default(serde_json::json!(null)),
                CommandParameter::required_string("priority", "Priority level")
                    .with_enum(vec![
                        serde_json::json!("low"),
                        serde_json::json!("medium"),
                        serde_json::json!("high"),
                    ])
                    .with_default(serde_json::json!("medium")),
            ],
            TestHandler,
        )
        .with_category("todo")
        .as_mutation();
        registry.register(cmd).unwrap();
        Arc::new(registry)
    }

    #[tokio::test]
    async fn test_afd_schema_json() {
        let registry = create_test_registry();
        let handler = AfdSchemaHandler::new(registry);
        let result = handler
            .execute(serde_json::json!({}), CommandContext::new())
            .await;
        assert!(result.success);
        let data = result.data.unwrap();
        let output: SchemaOutput = serde_json::from_value(data).unwrap();
        assert_eq!(output.total, 1);
        assert_eq!(output.format, SchemaFormat::Json);
        assert!(output.schemas[0].mcp_tool.is_some());
    }

    #[tokio::test]
    async fn test_afd_schema_typescript() {
        let registry = create_test_registry();
        let handler = AfdSchemaHandler::new(registry);
        let result = handler
            .execute(
                serde_json::json!({"format": "typescript"}),
                CommandContext::new(),
            )
            .await;
        assert!(result.success);
        let data = result.data.unwrap();
        let output: SchemaOutput = serde_json::from_value(data).unwrap();
        assert_eq!(output.format, SchemaFormat::Typescript);
        assert!(output.schemas[0].typescript.is_some());
        let ts = output.schemas[0].typescript.as_ref().unwrap();
        assert!(ts.contains("interface TodoCreateInput"));
    }

    #[tokio::test]
    async fn test_afd_schema_includes_properties() {
        let registry = create_test_registry();
        let handler = AfdSchemaHandler::new(registry);
        let result = handler
            .execute(serde_json::json!({}), CommandContext::new())
            .await;
        assert!(result.success);
        let data = result.data.unwrap();
        let output: SchemaOutput = serde_json::from_value(data).unwrap();
        let mcp = output.schemas[0].mcp_tool.as_ref().unwrap();
        assert!(mcp.input_schema.properties.contains_key("title"));
        assert!(mcp.input_schema.properties.contains_key("description"));
        assert!(mcp.input_schema.properties.contains_key("priority"));
    }

    #[tokio::test]
    async fn test_afd_schema_includes_enum_and_default() {
        let registry = create_test_registry();
        let handler = AfdSchemaHandler::new(registry);
        let result = handler
            .execute(serde_json::json!({}), CommandContext::new())
            .await;
        assert!(result.success);
        let data = result.data.unwrap();
        let output: SchemaOutput = serde_json::from_value(data).unwrap();
        let mcp = output.schemas[0].mcp_tool.as_ref().unwrap();
        let priority = mcp.input_schema.properties.get("priority").unwrap();
        assert!(priority.enum_values.is_some());
        assert!(priority.default.is_some());
    }

    #[tokio::test]
    async fn test_afd_schema_empty_parameters() {
        let mut registry = CommandRegistry::new();
        let cmd = CommandDefinition::new("todo-list", "List all todos", vec![], TestHandler);
        registry.register(cmd).unwrap();
        let registry = Arc::new(registry);

        let handler = AfdSchemaHandler::new(registry);
        let result = handler
            .execute(serde_json::json!({}), CommandContext::new())
            .await;
        assert!(result.success);
        let data = result.data.unwrap();
        let output: SchemaOutput = serde_json::from_value(data).unwrap();
        let mcp = output.schemas[0].mcp_tool.as_ref().unwrap();
        assert!(mcp.input_schema.properties.is_empty());
        assert!(mcp.input_schema.required.is_empty());
    }
}
