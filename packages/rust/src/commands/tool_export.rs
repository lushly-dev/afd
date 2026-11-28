//! Commands as MCP tools: [`McpTool`], annotations and the output schema.

#[allow(clippy::wildcard_imports)]
use super::*;

// MCP TOOL CONVERSION

/// MCP Tool format for command export.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpTool {
    /// Command tool name.
    pub name: String,
    /// Display label (`spec/command-metadata.md`, "Tool titles"), only when the command sets one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Human- and agent-readable description of the tool.
    pub description: String,
    /// JSON Schema describing the tool's input object.
    pub input_schema: McpInputSchema,
}

/// JSON Schema object describing an [`McpTool`]'s input arguments.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpInputSchema {
    /// JSON Schema type, always `"object"`.
    #[serde(rename = "type")]
    pub schema_type: String,
    /// Declared input properties keyed by parameter name.
    pub properties: HashMap<String, JsonSchema>,
    /// Names of required input properties.
    pub required: Vec<String>,
}

/// MCP tool annotations for a command (`spec/command-metadata.md`, "Annotations").
///
/// Only what the command declares is reported. `mutation` has no unset state here, so a
/// mutation gives `readOnlyHint: false` and `destructiveHint` from `destructive` (`false` when
/// unset), and anything else gives neither. `idempotency: natural` adds `idempotentHint: true`
/// (`spec/idempotency.md`, D2); no other value, and no default, reports it. A command with none
/// of them gives `None`.
pub fn command_tool_annotations(command: &CommandDefinition) -> Option<serde_json::Value> {
    let mut annotations = serde_json::Map::new();
    if command.mutation {
        annotations.insert("readOnlyHint".into(), serde_json::json!(false));
        annotations.insert(
            "destructiveHint".into(),
            serde_json::json!(command.destructive.unwrap_or(false)),
        );
    }
    if command.idempotency == Some(crate::IdempotencySupport::Natural) {
        annotations.insert("idempotentHint".into(), serde_json::json!(true));
    }
    (!annotations.is_empty()).then_some(serde_json::Value::Object(annotations))
}

/// Keywords of the schema subset (`spec/validation.md`) whose value is a schema.
const SCHEMA_KEYWORDS: [&str; 11] = [
    "items",
    "additionalProperties",
    "not",
    "if",
    "then",
    "else",
    "contains",
    "propertyNames",
    "additionalItems",
    "unevaluatedItems",
    "unevaluatedProperties",
];
/// Keywords whose value is an array of schemas.
const SCHEMA_LIST_KEYWORDS: [&str; 5] = ["allOf", "anyOf", "oneOf", "prefixItems", "items"];
/// Keywords whose value maps names to schemas. Draft-07 `dependencies` maps a name to a schema or
/// to a list of property names; only a schema is walked.
const SCHEMA_MAP_KEYWORDS: [&str; 6] = [
    "properties",
    "patternProperties",
    "$defs",
    "definitions",
    "dependentSchemas",
    "dependencies",
];

/// Point every `"$ref": "#"` naming `schema`'s root, outside any nested schema resource, at
/// `target`. Values and annotations (`const`, `enum`, `default`, `examples`) are left alone.
fn retarget_root(schema: &mut serde_json::Value, target: &str, root: bool) {
    use serde_json::Value;
    if !root && crate::schema_validation::starts_resource(schema) {
        return;
    }
    let Value::Object(object) = schema else {
        return;
    };
    for (key, value) in object.iter_mut() {
        let key = key.as_str();
        if key == "$ref" && value == "#" {
            *value = Value::String(target.to_owned());
        } else if SCHEMA_LIST_KEYWORDS.contains(&key) && value.is_array() {
            for item in value.as_array_mut().into_iter().flatten() {
                retarget_root(item, target, false);
            }
        } else if SCHEMA_KEYWORDS.contains(&key) {
            retarget_root(value, target, false);
        } else if SCHEMA_MAP_KEYWORDS.contains(&key) {
            for item in value
                .as_object_mut()
                .into_iter()
                .flat_map(|map| map.values_mut())
            {
                retarget_root(item, target, false);
            }
        }
    }
}

/// The MCP `outputSchema` of a command tool: the CommandResult envelope, with `data` typed by
/// `data_schema` (`spec/command-metadata.md`, "Structured results").
///
/// `$schema` is dropped. When `data` starts a schema resource (a string `$id` that is not a bare
/// fragment, the validators' test), its local references resolve against it, so its definitions
/// stay inside it. Otherwise its definitions move to the envelope, and a `"$ref": "#"` that named
/// `data` becomes `"#/properties/data"`, since `#` now names the envelope.
pub fn command_result_output_schema(data_schema: &serde_json::Value) -> serde_json::Value {
    let mut data = data_schema.clone();
    let mut hoisted = serde_json::Map::new();
    if let Some(object) = data.as_object_mut() {
        object.remove("$schema");
    }
    if !crate::schema_validation::starts_resource(&data) {
        retarget_root(&mut data, "#/properties/data", true);
        if let Some(object) = data.as_object_mut() {
            for key in ["$defs", "definitions"] {
                if let Some(definitions) = object.remove(key) {
                    hoisted.insert(key.to_owned(), definitions);
                }
            }
        }
    }
    let mut envelope = serde_json::json!({
        "type": "object",
        "properties": {
            "success": { "type": "boolean" },
            "data": data,
            "error": {
                "type": "object",
                "properties": {
                    "code": { "type": "string" },
                    "message": { "type": "string" },
                    "suggestion": { "type": "string" },
                    "retryable": { "type": "boolean" },
                },
                "required": ["code", "message"],
            },
            "metadata": { "type": "object" },
        },
        "required": ["success"],
    });
    if let Some(object) = envelope.as_object_mut() {
        object.extend(hoisted);
    }
    envelope
}

/// Convert a legacy definition to a tool. For whole-schema registrations, use
/// [`CommandRegistry::get_tool`] instead: the definition alone does not carry the override.
pub fn command_to_mcp_tool(command: &CommandDefinition) -> McpTool {
    let mut properties = HashMap::new();
    let mut required = Vec::new();

    for param in &command.parameters {
        let mut schema = param.schema.clone().unwrap_or_else(|| JsonSchema {
            schema_type: Some(param.param_type.clone()),
            description: Some(param.description.clone()),
            default: param.default.clone(),
            enum_values: param.enum_values.clone(),
            ..Default::default()
        });

        if param.default.is_some() {
            schema.default = param.default.clone();
        }
        let has_default = schema.default.is_some();
        properties.insert(param.name.clone(), schema);

        if param.required && !has_default {
            required.push(param.name.clone());
        }
    }

    McpTool {
        name: command.name.clone(),
        title: command.title.clone(),
        description: command.description.clone(),
        input_schema: McpInputSchema {
            schema_type: "object".to_string(),
            properties,
            required,
        },
    }
}
