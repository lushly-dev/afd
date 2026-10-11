//! The normative validation vectors, run through actual registry dispatch.
use afd::{
    success, CommandContext, CommandDefinition, CommandHandler, CommandRegistry, CommandResult,
};
use async_trait::async_trait;
use serde_json::{json, Value};
use std::path::PathBuf;

struct Echo;
#[async_trait]
impl CommandHandler for Echo {
    async fn execute(&self, input: Value, _: CommandContext) -> CommandResult<Value> {
        success(input)
    }
}

fn sorted(values: &Value) -> Vec<String> {
    let mut values = values
        .as_array()
        .unwrap()
        .iter()
        .map(Value::to_string)
        .collect::<Vec<_>>();
    values.sort();
    values
}

#[tokio::test]
async fn shared_validation_vectors() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../spec/vectors/validation.json");
    let vectors: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let mut checked = 0;
    let mut rejected = 0;
    for case in vectors["cases"].as_array().unwrap() {
        let id = case["id"].as_str().unwrap();
        let registry = CommandRegistry::new();
        let command = CommandDefinition::new("test-echo", "Echo validated input", vec![], Echo);
        let registered = registry.register_with_schema(command, case["schema"].clone());
        if let Err(error) = registered {
            let optional = case["optionalKeywords"]
                .as_array()
                .unwrap_or_else(|| panic!("{id}: {error}"));
            assert!(
                optional
                    .iter()
                    .any(|keyword| error.contains(keyword.as_str().unwrap())),
                "{id}: {error}"
            );
            assert!(!registry.has("test-echo"));
            rejected += 1;
            continue;
        }
        assert_eq!(
            registry.get_tool("test-echo").unwrap()["inputSchema"],
            case["schema"]
        );
        for (index, test) in case["tests"].as_array().unwrap().iter().enumerate() {
            let label = format!("{id}[{index}]");
            let result = registry
                .execute("test-echo", test["input"].clone(), None)
                .await;
            assert_eq!(
                result.success,
                test["valid"].as_bool().unwrap(),
                "{label}: {result:?}"
            );
            if result.success {
                assert_eq!(result.data.as_ref().unwrap(), &test["data"], "{label}");
            } else {
                let error = serde_json::to_value(result.error.unwrap()).unwrap();
                assert_eq!(error["code"], test["error"]["code"], "{label}");
                assert_eq!(error["message"], test["error"]["message"], "{label}");
                let project = |errors: &Value| {
                    let mut entries = errors.as_array().unwrap().iter().map(|error| json!({"path":error["path"],"code":error["code"],"expected":error["expected"],"expectedPresent":error.get("expected").is_some()}).to_string()).collect::<Vec<_>>();
                    entries.sort();
                    entries
                };
                assert_eq!(
                    project(&error["details"]["errors"]),
                    project(&test["error"]["details"]["errors"]),
                    "{label}: {error}"
                );
                for field in ["expectedFields", "unexpectedFields", "missingFields"] {
                    let actual = error["details"].get(field);
                    let expected = test["error"]["details"].get(field);
                    assert_eq!(
                        actual.is_some(),
                        expected.is_some(),
                        "{label}: {field}: {error}"
                    );
                    if let (Some(actual), Some(expected)) = (actual, expected) {
                        assert_eq!(sorted(actual), sorted(expected), "{label}: {field}");
                    }
                }
                let errors = error["details"]["errors"].as_array().unwrap();
                let mut parts = vec![errors
                    .iter()
                    .map(|issue| {
                        let description = if issue["path"] == "(root)" {
                            issue["message"].as_str().unwrap().to_string()
                        } else {
                            format!(
                                "{}: {}",
                                issue["path"].as_str().unwrap(),
                                issue["message"].as_str().unwrap()
                            )
                        };
                        if errors.len() > 1 {
                            format!("- {description}")
                        } else {
                            description
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("\n")];
                for (field, label) in [
                    ("unexpectedFields", "Unknown field(s)"),
                    ("missingFields", "Missing required field(s)"),
                    ("expectedFields", "Expected fields"),
                ] {
                    if let Some(fields) = error["details"][field].as_array() {
                        parts.push(format!(
                            "{label}: {}",
                            fields
                                .iter()
                                .map(|field| field.as_str().unwrap())
                                .collect::<Vec<_>>()
                                .join(", ")
                        ));
                    }
                }
                assert_eq!(error["suggestion"], json!(parts.join(". ")), "{label}");
            }
            checked += 1;
        }
    }
    assert_eq!(checked, 102);
    assert_eq!(rejected, 7);
    eprintln!("Validation vectors: {checked} executions, {rejected} unsupported optional cases rejected at registration");
}
