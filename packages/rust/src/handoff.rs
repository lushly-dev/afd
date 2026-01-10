//! # Handoff Protocol Types
//!
//! Types and utilities for protocol handoff in AFD.
//!
//! Protocol handoff enables commands to establish real-time connections
//! (WebSocket, WebRTC, SSE, etc.) by returning connection details.
//!
//! ## Example
//!
//! ```rust
//! use afd::handoff::{HandoffResult, HandoffProtocol, HandoffCredentials, HandoffMetadata};
//!
//! // Create a WebSocket handoff
//! let handoff = HandoffResult::new(HandoffProtocol::Websocket, "wss://api.example.com/ws")
//!     .with_credentials(HandoffCredentials::new().with_token("jwt-token-here"))
//!     .with_metadata(HandoffMetadata::new().with_description("Real-time updates"));
//! ```

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ═══════════════════════════════════════════════════════════════════════════════
// HANDOFF PROTOCOL
// ═══════════════════════════════════════════════════════════════════════════════

/// Supported handoff protocols.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HandoffProtocol {
    /// WebSocket protocol (ws:// or wss://)
    Websocket,
    /// WebRTC peer connection
    Webrtc,
    /// Server-Sent Events
    Sse,
    /// HTTP streaming
    #[serde(rename = "http-stream")]
    HttpStream,
    /// Custom protocol with identifier
    #[serde(untagged)]
    Custom(String),
}

impl HandoffProtocol {
    /// Get the protocol as a string.
    pub fn as_str(&self) -> &str {
        match self {
            HandoffProtocol::Websocket => "websocket",
            HandoffProtocol::Webrtc => "webrtc",
            HandoffProtocol::Sse => "sse",
            HandoffProtocol::HttpStream => "http-stream",
            HandoffProtocol::Custom(s) => s.as_str(),
        }
    }
}

impl std::fmt::Display for HandoffProtocol {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HANDOFF CREDENTIALS
// ═══════════════════════════════════════════════════════════════════════════════

/// Credentials for authenticating the handoff connection.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandoffCredentials {
    /// Authentication token (JWT, API key, etc.)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,

    /// Additional headers for the connection
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<HashMap<String, String>>,

    /// Session identifier for reconnection
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

impl HandoffCredentials {
    /// Create new empty credentials.
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the authentication token.
    pub fn with_token(mut self, token: impl Into<String>) -> Self {
        self.token = Some(token.into());
        self
    }

    /// Set additional headers.
    pub fn with_headers(mut self, headers: HashMap<String, String>) -> Self {
        self.headers = Some(headers);
        self
    }

    /// Add a single header.
    pub fn with_header(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        let headers = self.headers.get_or_insert_with(HashMap::new);
        headers.insert(key.into(), value.into());
        self
    }

    /// Set the session ID.
    pub fn with_session_id(mut self, session_id: impl Into<String>) -> Self {
        self.session_id = Some(session_id.into());
        self
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RECONNECT POLICY
// ═══════════════════════════════════════════════════════════════════════════════

/// Policy for reconnecting to a handoff endpoint.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconnectPolicy {
    /// Whether reconnection is allowed
    pub allowed: bool,

    /// Maximum number of reconnection attempts
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_attempts: Option<u32>,

    /// Backoff delay in milliseconds between attempts
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backoff_ms: Option<u32>,
}

impl Default for ReconnectPolicy {
    fn default() -> Self {
        Self {
            allowed: true,
            max_attempts: Some(3),
            backoff_ms: Some(1000),
        }
    }
}

impl ReconnectPolicy {
    /// Create a new reconnect policy.
    pub fn new(allowed: bool) -> Self {
        Self {
            allowed,
            max_attempts: None,
            backoff_ms: None,
        }
    }

    /// Set maximum reconnection attempts.
    pub fn with_max_attempts(mut self, max: u32) -> Self {
        self.max_attempts = Some(max);
        self
    }

    /// Set backoff delay in milliseconds.
    pub fn with_backoff_ms(mut self, ms: u32) -> Self {
        self.backoff_ms = Some(ms);
        self
    }

    /// Create a policy that disallows reconnection.
    pub fn no_reconnect() -> Self {
        Self::new(false)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HANDOFF METADATA
// ═══════════════════════════════════════════════════════════════════════════════

/// Additional metadata about the handoff connection.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandoffMetadata {
    /// Expected latency in milliseconds
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_latency: Option<u32>,

    /// Capabilities supported by the endpoint
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<Vec<String>>,

    /// ISO 8601 timestamp when the handoff expires
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,

    /// Reconnection policy
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reconnect: Option<ReconnectPolicy>,

    /// Human-readable description
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

impl HandoffMetadata {
    /// Create new empty metadata.
    pub fn new() -> Self {
        Self::default()
    }

    /// Set expected latency in milliseconds.
    pub fn with_expected_latency(mut self, ms: u32) -> Self {
        self.expected_latency = Some(ms);
        self
    }

    /// Set capabilities.
    pub fn with_capabilities(mut self, caps: Vec<String>) -> Self {
        self.capabilities = Some(caps);
        self
    }

    /// Add a capability.
    pub fn with_capability(mut self, cap: impl Into<String>) -> Self {
        let caps = self.capabilities.get_or_insert_with(Vec::new);
        caps.push(cap.into());
        self
    }

    /// Set expiration timestamp (ISO 8601).
    pub fn with_expires_at(mut self, expires: impl Into<String>) -> Self {
        self.expires_at = Some(expires.into());
        self
    }

    /// Set reconnect policy.
    pub fn with_reconnect(mut self, policy: ReconnectPolicy) -> Self {
        self.reconnect = Some(policy);
        self
    }

    /// Set description.
    pub fn with_description(mut self, desc: impl Into<String>) -> Self {
        self.description = Some(desc.into());
        self
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HANDOFF RESULT
// ═══════════════════════════════════════════════════════════════════════════════

/// Result type for protocol handoff operations.
///
/// A `HandoffResult` provides all the information needed for a client
/// to establish a real-time connection to a service endpoint.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandoffResult {
    /// The protocol to use for the connection
    pub protocol: HandoffProtocol,

    /// The endpoint URL to connect to
    pub endpoint: String,

    /// Optional credentials for authentication
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credentials: Option<HandoffCredentials>,

    /// Optional metadata about the connection
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<HandoffMetadata>,
}

impl HandoffResult {
    /// Create a new handoff result.
    pub fn new(protocol: HandoffProtocol, endpoint: impl Into<String>) -> Self {
        Self {
            protocol,
            endpoint: endpoint.into(),
            credentials: None,
            metadata: None,
        }
    }

    /// Create a WebSocket handoff.
    pub fn websocket(endpoint: impl Into<String>) -> Self {
        Self::new(HandoffProtocol::Websocket, endpoint)
    }

    /// Create a WebRTC handoff.
    pub fn webrtc(endpoint: impl Into<String>) -> Self {
        Self::new(HandoffProtocol::Webrtc, endpoint)
    }

    /// Create an SSE handoff.
    pub fn sse(endpoint: impl Into<String>) -> Self {
        Self::new(HandoffProtocol::Sse, endpoint)
    }

    /// Create an HTTP streaming handoff.
    pub fn http_stream(endpoint: impl Into<String>) -> Self {
        Self::new(HandoffProtocol::HttpStream, endpoint)
    }

    /// Set credentials.
    pub fn with_credentials(mut self, credentials: HandoffCredentials) -> Self {
        self.credentials = Some(credentials);
        self
    }

    /// Set metadata.
    pub fn with_metadata(mut self, metadata: HandoffMetadata) -> Self {
        self.metadata = Some(metadata);
        self
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TYPE GUARDS
// ═══════════════════════════════════════════════════════════════════════════════

/// Check if a JSON value is a valid handoff result.
///
/// Returns true if the value has the required `protocol` and `endpoint` fields.
pub fn is_handoff(value: &serde_json::Value) -> bool {
    value.get("protocol").is_some() && value.get("endpoint").is_some()
}

/// Check if a string is a valid handoff protocol.
pub fn is_handoff_protocol(protocol: &str) -> bool {
    matches!(
        protocol.to_lowercase().as_str(),
        "websocket" | "webrtc" | "sse" | "http-stream"
    )
}

/// Trait for types that may be handoff commands.
pub trait HandoffCommandLike {
    /// Check if this is a handoff command.
    fn is_handoff(&self) -> bool;

    /// Get the handoff protocol if specified.
    fn handoff_protocol(&self) -> Option<&str>;

    /// Get the command tags.
    fn tags(&self) -> Option<&[String]>;
}

/// Check if a command definition is a handoff command.
///
/// A command is considered a handoff command if:
/// - It has `handoff: true`, or
/// - It has a `handoff_protocol` specified, or
/// - It has "handoff" in its tags
pub fn is_handoff_command<T: HandoffCommandLike>(command: &T) -> bool {
    command.is_handoff()
        || command.handoff_protocol().is_some()
        || command
            .tags()
            .map(|t| t.iter().any(|tag| tag == "handoff"))
            .unwrap_or(false)
}

/// Get the handoff protocol from a command if it's a handoff command.
pub fn get_handoff_protocol<T: HandoffCommandLike>(command: &T) -> Option<&str> {
    if is_handoff_command(command) {
        command.handoff_protocol()
    } else {
        None
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/// Check if a handoff has expired based on its metadata.
///
/// Returns `true` if the handoff has an `expires_at` timestamp that is in the past.
/// Returns `false` if there's no expiration or if the timestamp can't be parsed.
pub fn is_handoff_expired(handoff: &HandoffResult) -> bool {
    let Some(metadata) = &handoff.metadata else {
        return false;
    };
    let Some(expires_at) = &metadata.expires_at else {
        return false;
    };

    // Try to parse ISO 8601 timestamp
    if let Ok(expires) = chrono::DateTime::parse_from_rfc3339(expires_at) {
        expires < chrono::Utc::now()
    } else {
        false
    }
}

/// Get the time-to-live in seconds for a handoff.
///
/// Returns `Some(seconds)` if the handoff has an `expires_at` timestamp in the future.
/// Returns `None` if there's no expiration, if it's already expired, or if the timestamp can't be parsed.
pub fn get_handoff_ttl(handoff: &HandoffResult) -> Option<u64> {
    let metadata = handoff.metadata.as_ref()?;
    let expires_at = metadata.expires_at.as_ref()?;

    let expires = chrono::DateTime::parse_from_rfc3339(expires_at).ok()?;
    let now = chrono::Utc::now();

    if expires > now {
        Some((expires.timestamp() - now.timestamp()) as u64)
    } else {
        None
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_handoff_protocol_serialization() {
        assert_eq!(
            serde_json::to_string(&HandoffProtocol::Websocket).unwrap(),
            "\"websocket\""
        );
        assert_eq!(
            serde_json::to_string(&HandoffProtocol::HttpStream).unwrap(),
            "\"http-stream\""
        );
    }

    #[test]
    fn test_handoff_result_builder() {
        let handoff = HandoffResult::websocket("wss://example.com/ws")
            .with_credentials(HandoffCredentials::new().with_token("test-token"))
            .with_metadata(HandoffMetadata::new().with_description("Test connection"));

        assert_eq!(handoff.protocol, HandoffProtocol::Websocket);
        assert_eq!(handoff.endpoint, "wss://example.com/ws");
        assert_eq!(
            handoff.credentials.as_ref().unwrap().token,
            Some("test-token".to_string())
        );
        assert_eq!(
            handoff.metadata.as_ref().unwrap().description,
            Some("Test connection".to_string())
        );
    }

    #[test]
    fn test_handoff_credentials_builder() {
        let creds = HandoffCredentials::new()
            .with_token("jwt-token")
            .with_session_id("session-123")
            .with_header("X-Custom", "value");

        assert_eq!(creds.token, Some("jwt-token".to_string()));
        assert_eq!(creds.session_id, Some("session-123".to_string()));
        assert_eq!(
            creds.headers.as_ref().unwrap().get("X-Custom"),
            Some(&"value".to_string())
        );
    }

    #[test]
    fn test_handoff_metadata_builder() {
        let meta = HandoffMetadata::new()
            .with_expected_latency(50)
            .with_capability("streaming")
            .with_capability("bidirectional")
            .with_reconnect(ReconnectPolicy::default());

        assert_eq!(meta.expected_latency, Some(50));
        assert_eq!(
            meta.capabilities,
            Some(vec!["streaming".to_string(), "bidirectional".to_string()])
        );
        assert!(meta.reconnect.is_some());
    }

    #[test]
    fn test_reconnect_policy() {
        let policy = ReconnectPolicy::new(true)
            .with_max_attempts(5)
            .with_backoff_ms(2000);

        assert!(policy.allowed);
        assert_eq!(policy.max_attempts, Some(5));
        assert_eq!(policy.backoff_ms, Some(2000));

        let no_reconnect = ReconnectPolicy::no_reconnect();
        assert!(!no_reconnect.allowed);
    }

    #[test]
    fn test_is_handoff_type_guard() {
        let valid = serde_json::json!({
            "protocol": "websocket",
            "endpoint": "wss://example.com"
        });
        assert!(is_handoff(&valid));

        let missing_protocol = serde_json::json!({
            "endpoint": "wss://example.com"
        });
        assert!(!is_handoff(&missing_protocol));

        let missing_endpoint = serde_json::json!({
            "protocol": "websocket"
        });
        assert!(!is_handoff(&missing_endpoint));
    }

    #[test]
    fn test_is_handoff_protocol() {
        assert!(is_handoff_protocol("websocket"));
        assert!(is_handoff_protocol("WEBSOCKET"));
        assert!(is_handoff_protocol("webrtc"));
        assert!(is_handoff_protocol("sse"));
        assert!(is_handoff_protocol("http-stream"));
        assert!(!is_handoff_protocol("invalid"));
        assert!(!is_handoff_protocol("custom"));
    }

    #[test]
    fn test_handoff_json_serialization() {
        let handoff = HandoffResult::websocket("wss://api.example.com/ws")
            .with_credentials(HandoffCredentials::new().with_token("token"))
            .with_metadata(
                HandoffMetadata::new()
                    .with_expires_at("2025-12-31T23:59:59Z")
                    .with_reconnect(ReconnectPolicy::default()),
            );

        let json = serde_json::to_string(&handoff).unwrap();

        // Verify camelCase serialization
        assert!(json.contains("\"protocol\":\"websocket\""));
        assert!(json.contains("\"endpoint\":"));
        assert!(json.contains("\"expiresAt\":"));
        assert!(json.contains("\"maxAttempts\":"));
        assert!(json.contains("\"backoffMs\":"));
    }

    #[test]
    fn test_handoff_expired() {
        // Not expired (no metadata)
        let handoff = HandoffResult::websocket("wss://example.com");
        assert!(!is_handoff_expired(&handoff));

        // Not expired (no expires_at)
        let handoff = HandoffResult::websocket("wss://example.com")
            .with_metadata(HandoffMetadata::new().with_description("test"));
        assert!(!is_handoff_expired(&handoff));

        // Expired
        let handoff = HandoffResult::websocket("wss://example.com")
            .with_metadata(HandoffMetadata::new().with_expires_at("2020-01-01T00:00:00Z"));
        assert!(is_handoff_expired(&handoff));

        // Not expired (future date)
        let handoff = HandoffResult::websocket("wss://example.com")
            .with_metadata(HandoffMetadata::new().with_expires_at("2099-12-31T23:59:59Z"));
        assert!(!is_handoff_expired(&handoff));
    }

    #[test]
    fn test_get_handoff_ttl() {
        // No TTL (no metadata)
        let handoff = HandoffResult::websocket("wss://example.com");
        assert!(get_handoff_ttl(&handoff).is_none());

        // No TTL (expired)
        let handoff = HandoffResult::websocket("wss://example.com")
            .with_metadata(HandoffMetadata::new().with_expires_at("2020-01-01T00:00:00Z"));
        assert!(get_handoff_ttl(&handoff).is_none());

        // Has TTL (future date)
        let handoff = HandoffResult::websocket("wss://example.com")
            .with_metadata(HandoffMetadata::new().with_expires_at("2099-12-31T23:59:59Z"));
        assert!(get_handoff_ttl(&handoff).is_some());
        assert!(get_handoff_ttl(&handoff).unwrap() > 0);
    }
}
