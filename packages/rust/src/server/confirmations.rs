//! Confirmation enforcement for commands with `confirm_prompt` (`spec/command-metadata.md`,
//! "Confirmations").
//!
//! [`McpServer::with_confirmations`](super::McpServer::with_confirmations) turns it on. A tool call
//! for a command with `confirm_prompt` then runs only with a confirmation:
//!
//! - an accepted MCP elicitation: an `input_required` result on MCP 2026-07-28, whose
//!   `requestState` is HMAC-signed and bound to the command and its input, or a server-sent
//!   elicitation on a 2025 stdio connection; or
//! - under [`ConfirmationMode::Enforce`], an acknowledgement: `confirm: true` in the arguments, or
//!   `_meta["dev.afd/confirm"]: true`.
//!
//! Otherwise the call fails with `CONFIRMATION_REQUIRED` or `CONFIRMATION_DECLINED` before the
//! handler runs. A 2025 request over Streamable HTTP has no back channel, so it never elicits.

use std::collections::HashMap;
use std::time::Duration;

use rmcp::model::{
    CallToolRequestParams, CallToolResponse, ElicitRequestParams, InputRequiredResult,
    ProtocolVersion, RequestStateCodec, SealOptions,
};
use rmcp::service::RequestContext;
use rmcp::RoleServer;
use serde_json::{json, Map, Value};

use crate::{error_codes, CommandError};

/// How a server treats `confirm_prompt`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ConfirmationMode {
    /// No enforcement (the default).
    #[default]
    Off,
    /// An accepted elicitation, or an acknowledgement from the caller.
    Enforce,
    /// An accepted elicitation only.
    RequireHuman,
}

/// `_meta` key a client sets to `true` to acknowledge a confirm-gated call.
pub const AFD_CONFIRM_META_KEY: &str = "dev.afd/confirm";

/// The `inputRequests` key of the confirmation elicitation.
pub const CONFIRM_INPUT_KEY: &str = "confirm";

/// How long a confirmation `requestState` stays valid.
const STATE_TTL: Duration = Duration::from_secs(600);

/// The elicitation form: one required boolean.
pub fn confirm_requested_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "confirm": { "type": "boolean", "title": "Confirm", "description": "Run the command" }
        },
        "required": ["confirm"],
    })
}

/// The `confirm` property a confirm-gated tool advertises under [`ConfirmationMode::Enforce`].
pub fn confirm_property() -> Value {
    json!({
        "type": "boolean",
        "description": "Set to true to confirm this command, once the user intends it. The server asks for confirmation when it is missing.",
    })
}

/// JSON with object keys sorted, so equal inputs bind equally whatever the key order.
fn canonical(value: &Value) -> String {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let fields: Vec<String> = keys
                .into_iter()
                .map(|key| format!("{}:{}", Value::String(key.clone()), canonical(&map[key])))
                .collect();
            format!("{{{}}}", fields.join(","))
        }
        Value::Array(items) => {
            let items: Vec<String> = items.iter().map(canonical).collect();
            format!("[{}]", items.join(","))
        }
        other => other.to_string(),
    }
}

/// The associated data of a confirmation: the command and its input, canonically.
pub fn confirmation_binding(command: &str, input: &Value) -> Vec<u8> {
    canonical(&json!([[command, input]])).into_bytes()
}

/// Whether a tool's own input schema declares a `confirm` property.
pub fn declares_confirm(tool: Option<&Value>) -> bool {
    tool.and_then(|tool| tool["inputSchema"]["properties"].as_object())
        .is_some_and(|properties| properties.contains_key("confirm"))
}

/// The gate of one server: its mode and the key that signs confirmation state.
pub(crate) struct Gate {
    pub(crate) mode: ConfirmationMode,
    codec: RequestStateCodec,
}

impl Gate {
    /// A gate whose `requestState` key is `key`, or a random per-process key.
    ///
    /// # Errors
    /// The key is shorter than 32 bytes.
    pub(crate) fn new(mode: ConfirmationMode, key: Option<Vec<u8>>) -> Result<Self, String> {
        let key = match key {
            Some(key) => key,
            None => {
                let mut bytes = vec![0u8; 32];
                // Every request a client retries must then reach this process.
                getrandom::fill(&mut bytes).map_err(|error| error.to_string())?;
                bytes
            }
        };
        let codec = RequestStateCodec::try_new(key).map_err(|error| error.to_string())?;
        Ok(Self { mode, codec })
    }
}

/// What the gate decided for one call.
pub(crate) enum Decision {
    /// Run the command with this input (`confirm` removed when the server added it).
    Proceed(Value),
    /// Answer with this failure.
    Refuse(CommandError),
    /// Answer with this `input_required` result.
    Ask(CallToolResponse),
}

fn is_modern(context: &RequestContext<RoleServer>) -> bool {
    context.protocol_version().is_some_and(|version| {
        serde_json::to_value(&version)
            .ok()
            .and_then(|value| value.as_str().map(str::to_owned))
            .zip(
                serde_json::to_value(ProtocolVersion::V_2026_07_28)
                    .ok()
                    .and_then(|value| value.as_str().map(str::to_owned)),
            )
            .is_some_and(|(version, modern)| version >= modern)
    })
}

fn allows_form_elicitation(context: &RequestContext<RoleServer>) -> bool {
    context
        .client_capabilities()
        .and_then(|capabilities| capabilities.elicitation)
        .is_some_and(|elicitation| elicitation.form.is_some() || elicitation.url.is_none())
}

fn answer(action: &Value, content: &Value) -> bool {
    action == "accept" && content["confirm"] == Value::Bool(true)
}

fn declined(command: &str) -> CommandError {
    CommandError::new(
        error_codes::CONFIRMATION_DECLINED,
        format!("The user did not confirm '{command}'"),
    )
    .with_suggestion(
        "Do not run this again without asking the user first; the user chose not to proceed.",
    )
    .with_retryable(false)
    .with_details(HashMap::from([("commands".to_owned(), json!([command]))]))
}

/// Decide a tool call for `command`, whose `confirm_prompt` is `prompt`.
pub(crate) async fn check(
    gate: &Gate,
    command: &str,
    prompt: &str,
    tool: Option<&Value>,
    request: &CallToolRequestParams,
    context: &RequestContext<RoleServer>,
    legacy_back_channel: bool,
) -> Decision {
    let mut input = Map::new();
    if let Some(arguments) = &request.arguments {
        input.clone_from(arguments);
    }
    let acknowledged = input.get("confirm") == Some(&Value::Bool(true))
        || context.meta.get(AFD_CONFIRM_META_KEY) == Some(&Value::Bool(true));
    if !declares_confirm(tool) {
        input.remove("confirm");
    }
    let input = Value::Object(input);
    let binding = confirmation_binding(command, &input);
    let modern = is_modern(context);

    // The retry of an earlier elicitation, if its state verifies for this command and input.
    if modern {
        if let (Some(responses), Some(state)) = (&request.input_responses, &request.request_state) {
            let responses = serde_json::to_value(responses).unwrap_or(Value::Null);
            let response = &responses[CONFIRM_INPUT_KEY];
            if !response["action"].is_null() && gate.codec.open_with(state, &binding).is_ok() {
                return if answer(&response["action"], &response["content"]) {
                    Decision::Proceed(input)
                } else {
                    Decision::Refuse(declined(command))
                };
            }
        }
    }

    if gate.mode == ConfirmationMode::Enforce && acknowledged {
        return Decision::Proceed(input);
    }

    if allows_form_elicitation(context) {
        let elicitation = json!({
            "mode": "form",
            "message": prompt,
            "requestedSchema": confirm_requested_schema(),
        });
        if modern {
            let state = gate.codec.seal_with(
                b"confirm",
                &SealOptions::new().associated_data(&binding).ttl(STATE_TTL),
            );
            let result: Result<InputRequiredResult, _> = serde_json::from_value(json!({
                "resultType": "input_required",
                "inputRequests": {
                    CONFIRM_INPUT_KEY: { "method": "elicitation/create", "params": elicitation }
                },
                "requestState": state,
            }));
            if let Ok(result) = result {
                return Decision::Ask(CallToolResponse::InputRequired(result));
            }
        } else if legacy_back_channel {
            if let Ok(params) = serde_json::from_value::<ElicitRequestParams>(elicitation) {
                if let Ok(result) = context.peer.create_elicitation(params).await {
                    let result = serde_json::to_value(result).unwrap_or(Value::Null);
                    return if answer(&result["action"], &result["content"]) {
                        Decision::Proceed(input)
                    } else {
                        Decision::Refuse(declined(command))
                    };
                }
            }
        }
    }

    let suggestion = if gate.mode == ConfirmationMode::Enforce {
        "Make sure the user intends this, then repeat the call with confirm: true."
    } else {
        "This server accepts only a confirmation from the user: use an MCP client that supports elicitation."
    };
    Decision::Refuse(
        CommandError::new(
            error_codes::CONFIRMATION_REQUIRED,
            format!("'{command}' needs confirmation: {prompt}"),
        )
        .with_suggestion(suggestion)
        .with_retryable(false)
        .with_details(HashMap::from([("commands".to_owned(), json!([command]))])),
    )
}
