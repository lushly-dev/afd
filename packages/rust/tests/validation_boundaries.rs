//! Integration tests for command input validation boundaries.

use afd::{
    command_to_mcp_tool, register_bootstrap_commands, success, CommandContext, CommandDefinition,
    CommandHandler, CommandParameter, CommandRegistry, CommandResult, JsonSchema, JsonSchemaType,
};
use async_trait::async_trait;
use serde_json::{json, Value};
use std::sync::Arc;

struct Echo;
#[async_trait]
impl CommandHandler for Echo {
    async fn execute(&self, input: Value, _: CommandContext) -> CommandResult<Value> {
        success(input)
    }
}

#[tokio::test]
async fn legacy_null_defaults_and_export_agree() {
    for explicit_schema in [false, true] {
        let mut parameter =
            CommandParameter::required_string("priority", "Priority").with_default(json!("medium"));
        if explicit_schema {
            parameter.schema = Some(JsonSchema {
                schema_type: Some(JsonSchemaType::String),
                default: Some(json!("low")),
                ..Default::default()
            });
        }
        let command = CommandDefinition::new("test-default", "Defaults", vec![parameter], Echo);
        let tool = command_to_mcp_tool(&command);
        assert!(tool.input_schema.required.is_empty());
        assert_eq!(
            tool.input_schema.properties["priority"].default,
            Some(json!("medium"))
        );
        let registry = CommandRegistry::new();
        registry.register(command).unwrap();
        assert_eq!(
            registry.execute("test-default", json!({}), None).await.data,
            Some(json!({"priority":"medium"}))
        );
        let null = registry
            .execute("test-default", json!({"priority":null}), None)
            .await
            .error
            .unwrap();
        assert!(!null.details.unwrap().contains_key("missingFields"));
    }
}

#[tokio::test]
async fn legacy_nested_defaults_are_used_as_is() {
    let child = JsonSchema {
        schema_type: Some(JsonSchemaType::Object),
        default: Some(json!({"extra":1})),
        properties: Some(std::collections::HashMap::from([(
            "nested".into(),
            JsonSchema {
                schema_type: Some(JsonSchemaType::String),
                default: Some(json!("inner")),
                ..Default::default()
            },
        )])),
        ..Default::default()
    };
    let schema = JsonSchema {
        schema_type: Some(JsonSchemaType::Object),
        properties: Some(std::collections::HashMap::from([("child".into(), child)])),
        ..Default::default()
    };
    let parameter = CommandParameter {
        schema: Some(schema),
        param_type: JsonSchemaType::Object,
        ..CommandParameter::required_string("filter", "Filter")
    };
    let registry = CommandRegistry::new();
    registry
        .register(CommandDefinition::new(
            "test-nested",
            "Nested",
            vec![parameter],
            Echo,
        ))
        .unwrap();
    assert_eq!(
        registry
            .execute("test-nested", json!({"filter":{}}), None)
            .await
            .data,
        Some(json!({"filter":{"child":{"extra":1}}}))
    );
    assert_eq!(
        registry
            .execute("test-nested", json!({"filter":{"child":{}}}), None)
            .await
            .data,
        Some(json!({"filter":{"child":{"nested":"inner"}}}))
    );
}

#[tokio::test]
async fn whole_schema_discovery_matches_dispatch_and_registration_is_atomic() {
    let registry = Arc::new(CommandRegistry::new());
    let schema = json!({"type":"object","properties":{"value":{"type":["string","null"]}},"required":["value"],"additionalProperties":false});
    registry
        .register_with_schema(
            CommandDefinition::new("test-schema", "Schema", vec![], Echo),
            schema.clone(),
        )
        .unwrap();
    register_bootstrap_commands(&registry).unwrap();
    let output = registry
        .execute("afd-schema", json!({"command":"test-schema"}), None)
        .await
        .data
        .unwrap();
    assert_eq!(output["schemas"][0]["mcpTool"]["inputSchema"], schema);
    assert_eq!(
        registry
            .execute("test-schema", json!({"value":null}), None)
            .await
            .data,
        Some(json!({"value":null}))
    );
    let rejected = registry
        .register_with_schema(
            CommandDefinition::new("test-rejected", "Rejected", vec![], Echo),
            json!({"properties":{"value":{"uniqueItems":true}}}),
        )
        .unwrap_err();
    assert!(rejected.contains("uniqueItems"));
    assert!(rejected.contains("#/properties/value/uniqueItems"));
    assert!(!registry.has("test-rejected"));
    assert!(registry
        .register_with_schema(
            CommandDefinition::new("test-schema", "Duplicate", vec![], Echo),
            json!({})
        )
        .is_err());
    assert_eq!(
        registry.get_tool("test-schema").unwrap()["inputSchema"],
        schema
    );
}

#[tokio::test]
async fn whole_schema_caps_issues_at_default_limit_and_handles_large_bounds() {
    let registry = CommandRegistry::new();
    registry.register_with_schema(CommandDefinition::new("test-many","Many",vec![],Echo),json!({"type":"object","properties":{"items":{"type":"array","items":{"type":"string"}}}})).unwrap();
    let result = registry
        .execute("test-many", json!({"items":vec![0;125]}), None)
        .await
        .error
        .unwrap();
    let details = result.details.unwrap();
    assert_eq!(
        details["errors"].as_array().unwrap().len(),
        afd::DEFAULT_MAX_VALIDATION_ISSUES
    );
    assert_eq!(details.get("truncated"), Some(&json!(true)));
    assert_eq!(
        details.get("limit"),
        Some(&json!(afd::DEFAULT_MAX_VALIDATION_ISSUES))
    );
    assert_eq!(details.get("totalErrors"), Some(&json!(125)));

    registry.set_max_validation_issues(200).unwrap();
    let expanded = registry
        .execute("test-many", json!({"items":vec![0;125]}), None)
        .await
        .error
        .unwrap();
    let expanded_details = expanded.details.unwrap();
    assert_eq!(expanded_details["errors"].as_array().unwrap().len(), 125);
    assert!(!expanded_details.contains_key("truncated"));
    registry
        .register_with_schema(
            CommandDefinition::new("test-large", "Large", vec![], Echo),
            json!({"type":"object","properties":{"value":{"type":"string","minLength":1e100}}}),
        )
        .unwrap();
    assert!(
        !registry
            .execute("test-large", json!({"value":"x"}), None)
            .await
            .success
    );
}

#[test]
fn legacy_schema_deserialization_keeps_null_defaults_and_rejects_lost_constraints() {
    let schema: JsonSchema = serde_json::from_value(json!({"type":"null","default":null,"title":"Null","$schema":"http://json-schema.org/draft-07/schema#"})).unwrap();
    assert_eq!(schema.default, Some(Value::Null));
    assert!(serde_json::from_value::<JsonSchema>(json!({"uniqueItems":true})).is_err());
    let parameter: CommandParameter = serde_json::from_value(
        json!({"name":"value","description":"Value","type":"null","default":null}),
    )
    .unwrap();
    assert_eq!(parameter.default, Some(Value::Null));
}

#[tokio::test]
async fn structural_issue_order_and_ref_target_defaults() {
    let registry = CommandRegistry::new();
    registry.register_with_schema(CommandDefinition::new("test-order","Order",vec![],Echo),json!({"type":"object","properties":{"items":{"type":"array","items":{"type":"string"},"maxItems":1}},"additionalProperties":false})).unwrap();
    let errors = registry
        .execute("test-order", json!({"items":[0,0],"extra":1}), None)
        .await
        .error
        .unwrap()
        .details
        .unwrap()["errors"]
        .as_array()
        .unwrap()
        .clone();
    assert_eq!(
        errors
            .iter()
            .map(|error| error["path"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["items.0", "items.1", "items", "(root)"]
    );
    registry.register_with_schema(CommandDefinition::new("test-refdefault","Reference default",vec![],Echo),json!({"type":"object","properties":{"value":{"$ref":"#/$defs/defaulted"}},"required":["value"],"$defs":{"defaulted":{"type":"string","default":null}}})).unwrap();
    assert_eq!(
        registry
            .execute("test-refdefault", json!({}), None)
            .await
            .data,
        Some(json!({"value":null}))
    );
    assert!(
        !registry
            .execute("test-refdefault", json!({"value":null}), None)
            .await
            .success
    );
}

#[tokio::test]
async fn legacy_registration_rejects_invalid_patterns_and_treats_format_as_annotation() {
    // `format` is treated as an annotation (unblocks schemars-generated schemas; #1762).
    let format_param = CommandParameter {
        schema: Some(JsonSchema {
            schema_type: Some(JsonSchemaType::String),
            format: Some("email".into()),
            ..Default::default()
        }),
        ..CommandParameter::required_string("value", "Value")
    };
    let registry = CommandRegistry::new();
    registry
        .register(CommandDefinition::new(
            "test-format",
            "Format annotation",
            vec![format_param],
            Echo,
        ))
        .unwrap();
    assert_eq!(
        registry
            .execute("test-format", json!({"value": "anything"}), None)
            .await
            .data,
        Some(json!({"value": "anything"}))
    );

    // Unenforceable regex patterns still fail at registration.
    let pattern_param = CommandParameter {
        schema: Some(JsonSchema {
            pattern: Some("(?=x)x".into()),
            ..Default::default()
        }),
        ..CommandParameter::required_string("value", "Value")
    };
    let error = registry
        .register(CommandDefinition::new(
            "test-rejected",
            "Rejected",
            vec![pattern_param],
            Echo,
        ))
        .unwrap_err();
    assert!(error.contains("pattern"));
    assert!(error.contains("#/properties/value/pattern"));
    assert!(!registry.has("test-rejected"));
}

#[tokio::test]
async fn references_cannot_enter_annotation_or_default_payloads() {
    for (payload_key, payload) in [
        ("default", json!({"$ref":"#/$defs/Missing"})),
        ("examples", json!({"uniqueItems":true})),
        ("description", json!({"type":"string"})),
    ] {
        let registry = CommandRegistry::new();
        let mut schema = json!({"type":"object","properties":{"x":{"$ref":format!("#/$defs/Carrier/{payload_key}")}},"$defs":{"Carrier":{}}});
        schema["$defs"]["Carrier"][payload_key] = payload;
        let registration = registry.register_with_schema(
            CommandDefinition::new("test-reference", "Reference", vec![], Echo),
            schema,
        );
        assert!(
            registration.is_err(),
            "reference through {payload_key} must fail registration"
        );
        assert!(!registry.has("test-reference"));
    }
    // Defaults are data; a valid direct schema reference uses that data as-is.
    let registry = CommandRegistry::new();
    registry.register_with_schema(CommandDefinition::new("test-defaultdata","Default data",vec![],Echo),json!({"type":"object","properties":{"x":{"$ref":"#/$defs/Carrier"}},"$defs":{"Carrier":{"default":{"$ref":"#/$defs/Missing"}}}})).unwrap();
    assert_eq!(
        registry
            .execute("test-defaultdata", json!({}), None)
            .await
            .data,
        Some(json!({"x":{"$ref":"#/$defs/Missing"}}))
    );
}

#[tokio::test]
async fn const_and_enum_both_constrain_whole_schema_inputs() {
    for (allowed, valid_a) in [(json!(["b"]), false), (json!(["a", "b"]), true)] {
        let registry = CommandRegistry::new();
        registry.register_with_schema(CommandDefinition::new("test-conjunction","Conjunction",vec![],Echo),json!({"type":"object","properties":{"x":{"const":"a","enum":allowed}},"required":["x"]})).unwrap();
        assert_eq!(
            registry
                .execute("test-conjunction", json!({"x":"a"}), None)
                .await
                .success,
            valid_a
        );
        assert!(
            !registry
                .execute("test-conjunction", json!({"x":"b"}), None)
                .await
                .success
        );
    }
}

#[tokio::test]
async fn missing_unconstrained_required_fields_expect_nonoptional() {
    for schema in [
        json!({"type":"object","properties":{"x":{}},"required":["x"]}),
        json!({"type":"object","properties":{},"required":["x"]}),
        json!({"type":"object","required":["x"]}),
        json!({"type":"object","properties":{"x":{"$ref":"#/$defs/Any"}},"required":["x"],"$defs":{"Any":{}}}),
    ] {
        let registry = CommandRegistry::new();
        registry
            .register_with_schema(
                CommandDefinition::new("test-required", "Required", vec![], Echo),
                schema,
            )
            .unwrap();
        let result = registry.execute("test-required", json!({}), None).await;
        let details = result.error.unwrap().details.unwrap();
        assert_eq!(
            details["errors"],
            json!([{"path":"x","code":"invalid_type","expected":"nonoptional","message":"Invalid input: expected nonoptional, received undefined"}])
        );
        assert_eq!(details["missingFields"], json!(["x"]));
        assert!(
            registry
                .execute("test-required", json!({"x":null}), None)
                .await
                .success
        );
    }
    // A `true` property, directly or through a `$ref`, is `{}`: absent and required, it expects
    // nonoptional (spec/validation.md; #2047).
    for schema in [
        json!({"type":"object","properties":{"x":true},"required":["x"]}),
        json!({"type":"object","properties":{"x":{"$ref":"#/$defs/Any"}},"required":["x"],"$defs":{"Any":true}}),
    ] {
        let registry = CommandRegistry::new();
        registry
            .register_with_schema(
                CommandDefinition::new("test-boolean", "Boolean", vec![], Echo),
                schema,
            )
            .unwrap();
        let details = registry
            .execute("test-boolean", json!({}), None)
            .await
            .error
            .unwrap()
            .details
            .unwrap();
        assert_eq!(
            details["errors"],
            json!([{"path":"x","code":"invalid_type","expected":"nonoptional","message":"Invalid input: expected nonoptional, received undefined"}])
        );
        assert_eq!(details["missingFields"], json!(["x"]));
    }
}

/// A boolean schema is allowed below the root, never as a command's whole input (#2047).
#[tokio::test]
async fn boolean_schemas_register_below_the_root_only() {
    let registry = CommandRegistry::new();
    for root in [json!(true), json!(false)] {
        let refused = registry
            .register_with_schema(
                CommandDefinition::new("thing-root", "Root", vec![], Echo),
                root,
            )
            .unwrap_err();
        assert!(
            refused.contains("must be a JSON Schema object"),
            "{refused}"
        );
    }
    registry
        .register_with_schema(
            CommandDefinition::new("thing-check", "Booleans", vec![], Echo),
            json!({
                "type": "object",
                "properties": {"t": true, "f": false, "r": {"$ref": "#/$defs/A"}},
                "required": ["t"],
                "$defs": {"A": true}
            }),
        )
        .unwrap();
    assert!(
        registry
            .execute("thing-check", json!({"t": 1, "r": [1]}), None)
            .await
            .success
    );
    let never = registry
        .execute("thing-check", json!({"t": 1, "f": 1}), None)
        .await;
    assert_eq!(never.error.unwrap().code, "VALIDATION_ERROR");
}
