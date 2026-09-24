//! Model Context Protocol (MCP) types.
//!
//! MCP is a JSON-RPC based protocol used by AFD for agent tooling surfaces.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::commands::McpTool;

static REQUEST_ID: AtomicU64 = AtomicU64::new(0);

/// MCP JSON-RPC request/response identifier.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum McpId {
    /// Numeric request identifier.
    Number(u64),
    /// Signed numeric request identifier.
    ///
    /// This is separate from `Number` to retain source compatibility for
    /// callers constructing unsigned IDs directly, while still preserving
    /// negative JSON-RPC IDs on the wire.
    SignedNumber(i64),
    /// String request identifier.
    String(String),
}

impl From<u64> for McpId {
    fn from(value: u64) -> Self {
        Self::Number(value)
    }
}

impl From<u32> for McpId {
    fn from(value: u32) -> Self {
        Self::Number(value.into())
    }
}

impl From<i32> for McpId {
    fn from(value: i32) -> Self {
        if value.is_negative() {
            Self::SignedNumber(value.into())
        } else {
            Self::Number(value as u64)
        }
    }
}

impl From<i64> for McpId {
    fn from(value: i64) -> Self {
        if value.is_negative() {
            Self::SignedNumber(value)
        } else {
            Self::Number(value as u64)
        }
    }
}

impl From<&str> for McpId {
    fn from(value: &str) -> Self {
        Self::String(value.to_string())
    }
}

impl From<String> for McpId {
    fn from(value: String) -> Self {
        Self::String(value)
    }
}

/// MCP JSON-RPC request format.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpRequest {
    /// JSON-RPC version, always `2.0`.
    pub jsonrpc: String,
    /// Request ID for correlation.
    pub id: McpId,
    /// Method being called.
    pub method: String,
    /// Optional parameters.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<HashMap<String, serde_json::Value>>,
}

/// MCP JSON-RPC response format.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpResponse {
    /// JSON-RPC version, always `2.0`.
    pub jsonrpc: String,
    /// Request ID this is responding to.
    ///
    /// `None` serializes as `"id": null`, which JSON-RPC requires when the
    /// request's ID could not be determined (a parse error or an invalid
    /// request). See [`create_mcp_null_id_error_response`].
    pub id: Option<McpId>,
    /// Result if successful.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    /// Error if failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<McpError>,
}

/// MCP error format.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpError {
    /// Error code.
    pub code: i32,
    /// Human-readable error message.
    pub message: String,
    /// Additional error data.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

/// MCP error code type alias.
pub type McpErrorCode = i32;

/// Standard MCP and JSON-RPC error codes.
pub struct McpErrorCodes;

impl McpErrorCodes {
    pub const PARSE_ERROR: i32 = -32700;
    pub const INVALID_REQUEST: i32 = -32600;
    pub const METHOD_NOT_FOUND: i32 = -32601;
    pub const INVALID_PARAMS: i32 = -32602;
    pub const INTERNAL_ERROR: i32 = -32603;
    pub const SERVER_NOT_INITIALIZED: i32 = -32002;
    pub const REQUEST_CANCELLED: i32 = -32800;
    pub const CONTENT_MODIFIED: i32 = -32801;
}

/// MCP notification format.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpNotification {
    /// JSON-RPC version, always `2.0`.
    pub jsonrpc: String,
    /// Notification method.
    pub method: String,
    /// Optional parameters.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<HashMap<String, serde_json::Value>>,
}

/// MCP tools/list response.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolsListResult {
    /// Available MCP tools.
    pub tools: Vec<McpTool>,
}

/// MCP tools/call request params.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpToolCallParams {
    /// Tool name.
    pub name: String,
    /// Tool arguments.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arguments: Option<HashMap<String, serde_json::Value>>,
}

/// MCP tools/call response.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpToolCallResult {
    /// Returned content chunks.
    pub content: Vec<McpContent>,
    /// Whether the result represents an error.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
}

/// Embedded MCP resource payload.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpEmbeddedResource {
    /// Resource URI.
    pub uri: String,
    /// Resource MIME type.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    /// Text payload.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Blob payload.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blob: Option<String>,
}

/// MCP text content.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpTextContent {
    #[serde(rename = "type")]
    pub content_type: String,
    pub text: String,
}

/// MCP image content.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpImageContent {
    #[serde(rename = "type")]
    pub content_type: String,
    pub data: String,
    pub mime_type: String,
}

/// MCP resource content.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpResourceContent {
    #[serde(rename = "type")]
    pub content_type: String,
    pub resource: McpEmbeddedResource,
}

/// MCP audio content.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpAudioContent {
    /// Always `audio`.
    #[serde(rename = "type")]
    pub content_type: String,
    /// Base64-encoded audio data.
    pub data: String,
    /// Audio MIME type, such as `audio/wav`.
    pub mime_type: String,
}

/// MCP resource link content: a reference to a resource the client can read.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpResourceLinkContent {
    /// Always `resource_link`.
    #[serde(rename = "type")]
    pub content_type: String,
    /// Resource URI.
    pub uri: String,
    /// Resource name.
    pub name: String,
    /// Human-readable title.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Description of the resource.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Resource MIME type.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    /// Resource size in bytes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    /// Content annotations (audience, priority, ...), kept as JSON.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub annotations: Option<serde_json::Value>,
    /// Protocol metadata (`_meta`), kept as JSON.
    #[serde(rename = "_meta", default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<serde_json::Value>,
}

/// MCP content union.
///
/// Items are told apart by their `type` field: `text`, `image`, `audio`,
/// `resource` and `resource_link`. An item with any other `type` (or none)
/// becomes [`McpContent::Unknown`] with its JSON intact, so a content type
/// added by a later MCP revision does not make a whole tool result fail to
/// parse. A known `type` with a malformed body is still an error.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(untagged)]
#[non_exhaustive]
pub enum McpContent {
    Text(McpTextContent),
    Image(McpImageContent),
    Audio(McpAudioContent),
    Resource(McpResourceContent),
    ResourceLink(McpResourceLinkContent),
    /// A content item of a type this crate does not model, kept verbatim.
    Unknown(serde_json::Value),
}

impl<'de> Deserialize<'de> for McpContent {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        use serde::de::Error;

        let value = serde_json::Value::deserialize(deserializer)?;
        let content_type = value.get("type").and_then(serde_json::Value::as_str);
        let parsed = match content_type {
            Some("text") => serde_json::from_value(value).map(Self::Text),
            Some("image") => serde_json::from_value(value).map(Self::Image),
            Some("audio") => serde_json::from_value(value).map(Self::Audio),
            Some("resource") => serde_json::from_value(value).map(Self::Resource),
            Some("resource_link") => serde_json::from_value(value).map(Self::ResourceLink),
            _ => Ok(Self::Unknown(value)),
        };
        parsed.map_err(D::Error::custom)
    }
}

/// Tool capability metadata.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpToolsCapability {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub list_changed: Option<bool>,
}

/// Resource capability metadata.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpResourcesCapability {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subscribe: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub list_changed: Option<bool>,
}

/// Prompt capability metadata.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpPromptsCapability {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub list_changed: Option<bool>,
}

/// Roots capability metadata.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpRootsCapability {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub list_changed: Option<bool>,
}

/// MCP server capabilities.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpServerCapabilities {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<McpToolsCapability>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resources: Option<McpResourcesCapability>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompts: Option<McpPromptsCapability>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logging: Option<HashMap<String, serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub experimental: Option<HashMap<String, serde_json::Value>>,
}

/// MCP client capabilities.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpClientCapabilities {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub roots: Option<McpRootsCapability>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sampling: Option<HashMap<String, serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub experimental: Option<HashMap<String, serde_json::Value>>,
}

/// MCP peer info.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpPeerInfo {
    pub name: String,
    pub version: String,
}

/// MCP initialize request params.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpInitializeParams {
    pub protocol_version: String,
    pub capabilities: McpClientCapabilities,
    pub client_info: McpPeerInfo,
}

/// MCP initialize response.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpInitializeResult {
    pub protocol_version: String,
    pub capabilities: McpServerCapabilities,
    pub server_info: McpPeerInfo,
}

/// Create an MCP request with an auto-incrementing ID.
pub fn create_mcp_request(
    method: &str,
    params: Option<HashMap<String, serde_json::Value>>,
) -> McpRequest {
    McpRequest {
        jsonrpc: "2.0".to_string(),
        id: McpId::Number(REQUEST_ID.fetch_add(1, Ordering::SeqCst) + 1),
        method: method.to_string(),
        params,
    }
}

/// Create an MCP success response.
pub fn create_mcp_response(
    id: impl Into<McpId>,
    result: impl Into<serde_json::Value>,
) -> McpResponse {
    McpResponse {
        jsonrpc: "2.0".to_string(),
        id: Some(id.into()),
        result: Some(result.into()),
        error: None,
    }
}

/// Create an MCP error response.
pub fn create_mcp_error_response(
    id: impl Into<McpId>,
    code: McpErrorCode,
    message: &str,
    data: Option<serde_json::Value>,
) -> McpResponse {
    error_response(Some(id.into()), code, message, data)
}

/// Create an MCP error response with `"id": null`.
///
/// JSON-RPC requires a null ID when the request's ID could not be determined,
/// as for a parse error ([`McpErrorCodes::PARSE_ERROR`]) or an invalid
/// request.
pub fn create_mcp_null_id_error_response(
    code: McpErrorCode,
    message: &str,
    data: Option<serde_json::Value>,
) -> McpResponse {
    error_response(None, code, message, data)
}

fn error_response(
    id: Option<McpId>,
    code: McpErrorCode,
    message: &str,
    data: Option<serde_json::Value>,
) -> McpResponse {
    McpResponse {
        jsonrpc: "2.0".to_string(),
        id,
        result: None,
        error: Some(McpError {
            code,
            message: message.to_string(),
            data,
        }),
    }
}

/// Create an audio content item from base64 data.
pub fn audio_content(data: &str, mime_type: &str) -> McpAudioContent {
    McpAudioContent {
        content_type: "audio".to_string(),
        data: data.to_string(),
        mime_type: mime_type.to_string(),
    }
}

/// Create a resource link content item.
pub fn resource_link_content(uri: &str, name: &str) -> McpResourceLinkContent {
    McpResourceLinkContent {
        content_type: "resource_link".to_string(),
        uri: uri.to_string(),
        name: name.to_string(),
        title: None,
        description: None,
        mime_type: None,
        size: None,
        annotations: None,
        meta: None,
    }
}

/// Create a text content item.
pub fn text_content(text: &str) -> McpTextContent {
    McpTextContent {
        content_type: "text".to_string(),
        text: text.to_string(),
    }
}

/// Type guard for MCP requests.
pub fn is_mcp_request<T: Serialize>(value: &T) -> bool {
    if let Ok(json) = serde_json::to_value(value) {
        json.get("jsonrpc") == Some(&serde_json::json!("2.0"))
            && json.get("id").is_some()
            && matches!(json.get("method"), Some(serde_json::Value::String(_)))
    } else {
        false
    }
}

/// Type guard for MCP responses.
pub fn is_mcp_response<T: Serialize>(value: &T) -> bool {
    if let Ok(json) = serde_json::to_value(value) {
        json.get("jsonrpc") == Some(&serde_json::json!("2.0"))
            && json.get("id").is_some()
            && (json.get("result").is_some() || json.get("error").is_some())
    } else {
        false
    }
}

/// Type guard for MCP notifications.
pub fn is_mcp_notification<T: Serialize>(value: &T) -> bool {
    if let Ok(json) = serde_json::to_value(value) {
        json.get("jsonrpc") == Some(&serde_json::json!("2.0"))
            && matches!(json.get("method"), Some(serde_json::Value::String(_)))
            && json.get("id").is_none()
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_mcp_request() {
        let req1 = create_mcp_request("tools/list", None);
        let req2 = create_mcp_request("tools/call", None);

        assert_eq!(req1.jsonrpc, "2.0");
        assert_eq!(req1.method, "tools/list");
        assert!(matches!(req2.id, McpId::Number(_)));
        assert_ne!(req1.id, req2.id);
    }

    #[test]
    fn test_create_mcp_response() {
        let res = create_mcp_response(1u32, serde_json::json!({ "data": "hello" }));
        assert_eq!(res.jsonrpc, "2.0");
        assert_eq!(res.id, Some(McpId::Number(1)));
        assert_eq!(res.result, Some(serde_json::json!({ "data": "hello" })));
        assert!(res.error.is_none());
    }

    #[test]
    fn test_create_mcp_error_response() {
        let res = create_mcp_error_response(
            1u32,
            McpErrorCodes::METHOD_NOT_FOUND,
            "Method not found",
            None,
        );
        assert_eq!(res.id, Some(McpId::Number(1)));
        assert!(res.result.is_none());
        assert_eq!(
            res.error,
            Some(McpError {
                code: McpErrorCodes::METHOD_NOT_FOUND,
                message: "Method not found".to_string(),
                data: None,
            })
        );
    }

    #[test]
    fn test_signed_mcp_ids_round_trip_without_clamping() {
        let id = McpId::from(-42i32);
        assert_eq!(id, McpId::SignedNumber(-42));
        assert_eq!(serde_json::to_value(&id).unwrap(), serde_json::json!(-42));

        let decoded: McpId = serde_json::from_value(serde_json::json!(-42)).unwrap();
        assert_eq!(decoded, id);

        let response = create_mcp_response(-7i32, serde_json::json!({"ok": true}));
        assert_eq!(
            serde_json::to_value(response.id).unwrap(),
            serde_json::json!(-7)
        );
    }

    #[test]
    fn test_unsigned_mcp_ids_still_support_full_u64_range() {
        let id = McpId::from(u64::MAX);
        let json = serde_json::to_value(&id).unwrap();
        assert_eq!(json, serde_json::json!(u64::MAX));

        let decoded: McpId = serde_json::from_value(json).unwrap();
        assert_eq!(decoded, id);
    }

    #[test]
    fn test_text_content() {
        let content = text_content("hello world");
        assert_eq!(content.content_type, "text");
        assert_eq!(content.text, "hello world");
    }

    #[test]
    fn test_is_mcp_request() {
        assert!(is_mcp_request(
            &serde_json::json!({ "jsonrpc": "2.0", "id": 1, "method": "test" })
        ));
        assert!(!is_mcp_request(
            &serde_json::json!({ "jsonrpc": "1.0", "id": 1, "method": "test" })
        ));
    }

    #[test]
    fn test_is_mcp_response() {
        assert!(is_mcp_response(
            &serde_json::json!({ "jsonrpc": "2.0", "id": 1, "result": {} })
        ));
        assert!(is_mcp_response(
            &serde_json::json!({ "jsonrpc": "2.0", "id": 1, "error": { "code": -1, "message": "err" } })
        ));
        assert!(!is_mcp_response(
            &serde_json::json!({ "jsonrpc": "2.0", "id": 1 })
        ));
    }

    #[test]
    fn test_is_mcp_notification() {
        assert!(is_mcp_notification(
            &serde_json::json!({ "jsonrpc": "2.0", "method": "notify" })
        ));
        assert!(!is_mcp_notification(
            &serde_json::json!({ "jsonrpc": "2.0", "id": 1, "method": "notify" })
        ));
    }

    #[test]
    fn test_parse_error_response_has_null_id() {
        let response =
            create_mcp_null_id_error_response(McpErrorCodes::PARSE_ERROR, "Parse error", None);
        let json = serde_json::to_value(&response).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "jsonrpc": "2.0",
                "id": null,
                "error": { "code": -32700, "message": "Parse error" }
            })
        );
        assert!(is_mcp_response(&json));

        let decoded: McpResponse = serde_json::from_value(json).unwrap();
        assert_eq!(decoded, response);
        assert!(decoded.id.is_none());

        let with_id: McpResponse = serde_json::from_value(
            serde_json::json!({ "jsonrpc": "2.0", "id": "abc", "result": {} }),
        )
        .unwrap();
        assert_eq!(with_id.id, Some(McpId::String("abc".to_string())));
    }

    #[test]
    fn test_tool_result_parses_every_content_type() {
        let json = serde_json::json!({
            "content": [
                { "type": "text", "text": "hello" },
                { "type": "image", "data": "aW1n", "mimeType": "image/png" },
                { "type": "audio", "data": "YXVkaW8=", "mimeType": "audio/wav" },
                {
                    "type": "resource",
                    "resource": { "uri": "file:///a.txt", "mimeType": "text/plain", "text": "a" }
                },
                {
                    "type": "resource_link",
                    "uri": "file:///b.md",
                    "name": "b.md",
                    "description": "Notes",
                    "mimeType": "text/markdown",
                    "annotations": { "audience": ["user"] }
                },
                { "type": "hologram", "frames": 3 },
                { "no": "type" }
            ],
            "isError": false
        });

        let result: McpToolCallResult = serde_json::from_value(json.clone()).unwrap();

        assert!(matches!(&result.content[0], McpContent::Text(text) if text.text == "hello"));
        assert!(matches!(&result.content[1], McpContent::Image(_)));
        assert_eq!(
            result.content[2],
            McpContent::Audio(audio_content("YXVkaW8=", "audio/wav"))
        );
        assert!(matches!(&result.content[3], McpContent::Resource(_)));
        let McpContent::ResourceLink(link) = &result.content[4] else {
            panic!("expected a resource link, got {:?}", result.content[4]);
        };
        assert_eq!(link.name, "b.md");
        assert_eq!(link.description.as_deref(), Some("Notes"));
        assert!(matches!(&result.content[5], McpContent::Unknown(value) if value["frames"] == 3));
        assert!(matches!(&result.content[6], McpContent::Unknown(_)));

        // Every item, including unknown ones, serializes back unchanged.
        assert_eq!(serde_json::to_value(&result).unwrap(), json);
    }

    #[test]
    fn test_malformed_known_content_is_an_error() {
        let malformed = serde_json::json!({ "type": "text", "text": 5 });
        assert!(serde_json::from_value::<McpContent>(malformed).is_err());

        let link = resource_link_content("file:///c", "c");
        let round_trip: McpContent = serde_json::from_value(
            serde_json::to_value(McpContent::ResourceLink(link.clone())).unwrap(),
        )
        .unwrap();
        assert_eq!(round_trip, McpContent::ResourceLink(link));
    }
}
