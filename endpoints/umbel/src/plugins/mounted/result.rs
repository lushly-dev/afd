//! A mounted tool's answer as a `CommandResult` (specification section 6.3).

use afd::{CommandError, CommandResult};
use serde_json::{Value, json};

use crate::plugins::codes;

/// The prefix of every key the host owns; a mounted server may not set one.
const HOST_PREFIX: &str = "dev.umbel/";

/// Map the JSON form of a `tools/call` result (`content`, `structuredContent`, `isError`).
///
/// - `structuredContent` that is an AFD `CommandResult` (an object with a boolean `success`) is
///   used, with every `dev.umbel/` key removed from its `metadata`.
/// - Otherwise `isError: true` is the failure `PLUGIN_TOOL_ERROR` with the first text content as
///   its message.
/// - Otherwise a success carries `data = structuredContent`, or `{ "content": [...] }` when there
///   is none.
pub(crate) fn map_tool_result(result: &Value) -> CommandResult<Value> {
    let structured = result
        .get("structuredContent")
        .filter(|value| !value.is_null());
    if let Some(structured) = structured
        && structured
            .get("success")
            .is_some_and(serde_json::Value::is_boolean)
        && let Ok(mut command_result) =
            serde_json::from_value::<CommandResult<Value>>(structured.clone())
    {
        strip_host_keys(&mut command_result);
        return command_result;
    }
    if result.get("isError").and_then(Value::as_bool) == Some(true) {
        let message = first_text(result)
            .unwrap_or_else(|| "the mounted tool reported an error without a message".to_owned());
        return afd::failure(
            CommandError::new(codes::PLUGIN_TOOL_ERROR, message)
                .with_suggestion("See the message from the mounted server.")
                .with_retryable(false),
        );
    }
    afd::success(match structured {
        Some(data) => data.clone(),
        None => json!({ "content": result.get("content").cloned().unwrap_or_else(|| json!([])) }),
    })
}

fn first_text(result: &Value) -> Option<String> {
    result.get("content")?.as_array()?.iter().find_map(|block| {
        (block.get("type").and_then(Value::as_str) == Some("text"))
            .then(|| block.get("text").and_then(Value::as_str).map(str::to_owned))
            .flatten()
    })
}

/// Remove every `dev.umbel/` key from the result's metadata (the plugin gate removes them too;
/// this is the first of the two).
fn strip_host_keys(result: &mut CommandResult<Value>) {
    if let Some(metadata) = result.metadata.as_mut() {
        metadata
            .extra
            .retain(|key, _| !key.starts_with(HOST_PREFIX));
    }
}

#[cfg(test)]
mod tests {
    use super::map_tool_result;
    use serde_json::json;

    #[test]
    fn a_command_result_in_structured_content_is_used_without_host_keys() {
        let result = map_tool_result(&json!({
            "content": [{"type": "text", "text": "ignored"}],
            "structuredContent": {
                "success": true,
                "data": {"a": 1},
                "metadata": {"dev.umbel/space": "forged", "other": 1}
            }
        }));
        assert!(result.success);
        assert_eq!(result.data, Some(json!({"a": 1})));
        let extra = result.metadata.unwrap().extra;
        assert!(!extra.contains_key("dev.umbel/space"));
        assert!(extra.contains_key("other"));
    }

    #[test]
    fn plain_structured_content_is_the_data() {
        let result = map_tool_result(&json!({"structuredContent": {"n": 2}}));
        assert_eq!(result.data, Some(json!({"n": 2})));
    }

    #[test]
    fn no_structured_content_wraps_the_content_blocks() {
        let result = map_tool_result(&json!({"content": [{"type": "text", "text": "hi"}]}));
        assert_eq!(
            result.data,
            Some(json!({"content": [{"type": "text", "text": "hi"}]}))
        );
    }

    #[test]
    fn an_error_result_is_plugin_tool_error_with_the_first_text() {
        let result = map_tool_result(&json!({
            "isError": true,
            "content": [{"type": "image"}, {"type": "text", "text": "no such ticket"}]
        }));
        assert!(!result.success);
        let error = result.error.unwrap();
        assert_eq!(error.code, "PLUGIN_TOOL_ERROR");
        assert_eq!(error.message, "no such ticket");
        assert!(error.suggestion.is_some());
    }
}
