//! Confirmation enforcement for commands with `confirm_prompt` (`spec/command-metadata.md`,
//! "Confirmations").
//!
//! [`McpServer::with_confirmations`](super::McpServer::with_confirmations) turns it on. A tool call
//! for a command with `confirm_prompt` then runs only with a confirmation:
//!
//! - an accepted MCP elicitation: an `input_required` result on MCP 2026-07-28, whose
//!   `requestState` is HMAC-signed and bound to the command, its input and the call's principal
//!   binding, or a server-sent elicitation on a 2025 stdio connection; or
//! - under [`ConfirmationMode::Enforce`], an acknowledgement: `confirm: true` in the arguments of
//!   a command's tool, a grouped tool or `afd-call`; `confirm: [names]` in the arguments of
//!   `afd-batch` or `afd-pipe`; or `_meta["dev.afd/confirm"]: true`.
//!
//! Otherwise the call fails with `CONFIRMATION_REQUIRED` or `CONFIRMATION_DECLINED` before any
//! handler runs. A batch or pipeline is checked as a whole, before its first command: one
//! elicitation covers every gated command in it. A 2025 request over Streamable HTTP has no back channel, so it never elicits.
//!
//! # The principal binding (#532)
//!
//! The state is bound to the call's [principal binding](crate::principal_binding)
//! (`spec/authorization.md`, M8): the actor's `kind`, `id` and `onBehalfOf` after the context
//! hook, and the verified credentials' `issuer`, `subject` and `clientId` when the call has
//! them. The binding is HMAC associated data, never part of the state, so the state carries no
//! identity. A retry whose binding differs (another actor, or another issuer, subject or client)
//! fails to verify exactly as an altered state does, and the server asks again: a confirmation
//! one caller answered never lets another caller skip the question. A state minted before the
//! binding existed does not verify either.
//!
//! Credentials with an empty issuer, subject or client id are never bound
//! ([`IncompleteCredentials`](crate::IncompleteCredentials)): such a call gets no state, and a
//! retry carrying one is refused, both with a JSON-RPC internal error that names no one.

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use rmcp::model::{
    CallToolRequestParams, CallToolResponse, ElicitRequestParams, InputRequiredResult,
    ProtocolVersion, RequestStateCodec, SealOptions,
};
use rmcp::service::RequestContext;
use rmcp::RoleServer;
use serde_json::{json, Value};

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

/// Labels the associated data's layout, so a state minted under an earlier layout (the command
/// and input alone, before #532) never verifies.
const BINDING_VERSION: &str = "afd.confirm.v2";

/// The associated data of a confirmation for one command: the command, its input and the call's
/// principal binding ([`principal_binding`](crate::principal_binding)), canonically.
pub fn confirmation_binding(command: &str, input: &Value, principal: &str) -> Vec<u8> {
    steps_binding(&[Step::new(command, input.clone())], principal)
}

/// The associated data of a confirmation: the layout's version, the call's principal binding
/// (as a JSON string, so it can never be read as part of the steps) and the gated commands with
/// their input, canonically.
fn steps_binding(steps: &[Step], principal: &str) -> Vec<u8> {
    let steps: Vec<Value> = steps
        .iter()
        .map(|step| json!([step.command, step.input]))
        .collect();
    canonical(&json!([BINDING_VERSION, principal, steps])).into_bytes()
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

/// One command a call would run, with its input as sent.
#[derive(Debug, Clone)]
pub(crate) struct Step {
    pub(crate) command: String,
    pub(crate) input: Value,
}

impl Step {
    pub(crate) fn new(command: impl Into<String>, input: Value) -> Self {
        Self {
            command: command.into(),
            input,
        }
    }
}

/// How the caller acknowledges confirm-gated commands: all of them (`confirm: true`), or the
/// named ones (`afd-batch` and `afd-pipe` take `confirm: [names]`).
pub(crate) enum Acknowledgement {
    None,
    All,
    Names(HashSet<String>),
}

/// What the gate decided for one call.
pub(crate) enum Decision {
    /// Run the call.
    Proceed,
    /// Answer with this failure.
    Refuse(CommandError),
    /// Answer with this `input_required` result.
    Ask(CallToolResponse),
    /// Answer with a JSON-RPC internal error: the call carries a confirmation state, or needs
    /// one, but its credentials cannot be bound ([`crate::IncompleteCredentials`]).
    Internal,
}

pub(crate) fn is_modern(context: &RequestContext<RoleServer>) -> bool {
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

fn quoted(names: &[String]) -> String {
    names
        .iter()
        .map(|name| format!("'{name}'"))
        .collect::<Vec<_>>()
        .join(", ")
}

fn declined(names: &[String]) -> CommandError {
    CommandError::new(
        error_codes::CONFIRMATION_DECLINED,
        format!("The user did not confirm {}", quoted(names)),
    )
    .with_suggestion(
        "Do not run this again without asking the user first; the user chose not to proceed.",
    )
    .with_retryable(false)
    .with_details(HashMap::from([("commands".to_owned(), json!(names))]))
}

/// The elicitation message: the prompt of a single command, or every gated command's.
fn elicitation_message(steps: &[(Step, String)]) -> String {
    match steps {
        [(_, prompt)] => prompt.clone(),
        _ => std::iter::once("This request runs commands that need confirmation:".to_owned())
            .chain(
                steps
                    .iter()
                    .map(|(step, prompt)| format!("- {}: {prompt}", step.command)),
            )
            .collect::<Vec<_>>()
            .join("\n"),
    }
}

/// What the request being decided can carry.
pub(crate) struct Channel<'a> {
    pub(crate) request: &'a CallToolRequestParams,
    pub(crate) context: &'a RequestContext<RoleServer>,
    /// Whether a 2025 connection can receive a server-sent elicitation.
    pub(crate) legacy_back_channel: bool,
    /// The call's principal binding (`spec/authorization.md`, M8), from its context after the
    /// hook: the `requestState`'s associated data includes it. `None` when its credentials are
    /// incomplete: then no state is read or minted, and such a call fails with an internal error.
    pub(crate) principal: Option<&'a str>,
}

/// Decide a tool call that runs `steps`. `prompt` returns a command's `confirm_prompt`;
/// `how_to_acknowledge` is the recovery text for this tool, such as "repeat the call with
/// confirm: true".
pub(crate) async fn check(
    gate: &Gate,
    steps: &[Step],
    prompt: impl Fn(&str) -> Option<String>,
    acknowledged: Acknowledgement,
    how_to_acknowledge: &str,
    channel: &Channel<'_>,
) -> Decision {
    let (request, context) = (channel.request, channel.context);
    if gate.mode == ConfirmationMode::Off {
        return Decision::Proceed;
    }
    let gated: Vec<(Step, String)> = steps
        .iter()
        .filter_map(|step| prompt(&step.command).map(|prompt| (step.clone(), prompt)))
        .collect();
    if gated.is_empty() {
        return Decision::Proceed;
    }
    let mut names: Vec<String> = Vec::new();
    for (step, _) in &gated {
        if !names.contains(&step.command) {
            names.push(step.command.clone());
        }
    }
    let gated_steps: Vec<Step> = gated.iter().map(|(step, _)| step.clone()).collect();
    let binding = channel
        .principal
        .map(|principal| steps_binding(&gated_steps, principal));
    let modern = is_modern(context);
    // Incomplete credentials are never bound: a retry carrying a state fails closed.
    if modern && request.request_state.is_some() && binding.is_none() {
        return Decision::Internal;
    }

    // The retry of an earlier elicitation, if its state verifies for these commands, this input
    // and this principal. A state that does not (altered, expired, or issued for other input or
    // to another principal) is no answer, and the call is asked again below.
    if modern {
        if let (Some(responses), Some(state), Some(binding)) =
            (&request.input_responses, &request.request_state, &binding)
        {
            let responses = serde_json::to_value(responses).unwrap_or(Value::Null);
            let response = &responses[CONFIRM_INPUT_KEY];
            if !response["action"].is_null() && gate.codec.open_with(state, binding).is_ok() {
                return if answer(&response["action"], &response["content"]) {
                    Decision::Proceed
                } else {
                    Decision::Refuse(declined(&names))
                };
            }
        }
    }

    if gate.mode == ConfirmationMode::Enforce {
        let covered = context.meta.get(AFD_CONFIRM_META_KEY) == Some(&Value::Bool(true))
            || match &acknowledged {
                Acknowledgement::None => false,
                Acknowledgement::All => true,
                Acknowledgement::Names(acknowledged) => {
                    names.iter().all(|name| acknowledged.contains(name))
                }
            };
        if covered {
            return Decision::Proceed;
        }
    }

    if allows_form_elicitation(context) {
        let elicitation = json!({
            "mode": "form",
            "message": elicitation_message(&gated),
            "requestedSchema": confirm_requested_schema(),
        });
        if modern {
            // Incomplete credentials are never bound: no state is minted for them.
            let Some(binding) = &binding else {
                return Decision::Internal;
            };
            let state = gate.codec.seal_with(
                b"confirm",
                &SealOptions::new().associated_data(binding).ttl(STATE_TTL),
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
        } else if channel.legacy_back_channel {
            if let Ok(params) = serde_json::from_value::<ElicitRequestParams>(elicitation) {
                if let Ok(result) = context.peer.create_elicitation(params).await {
                    let result = serde_json::to_value(result).unwrap_or(Value::Null);
                    return if answer(&result["action"], &result["content"]) {
                        Decision::Proceed
                    } else {
                        Decision::Refuse(declined(&names))
                    };
                }
            }
        }
    }

    let suggestion = if gate.mode == ConfirmationMode::Enforce {
        format!("Make sure the user intends this, then {how_to_acknowledge}.")
    } else {
        "This server accepts only a confirmation from the user: use an MCP client that supports elicitation.".to_owned()
    };
    let message = match gated.as_slice() {
        [(step, prompt)] => format!("'{}' needs confirmation: {prompt}", step.command),
        _ if names.len() == 1 => format!("'{}' needs confirmation: {}", names[0], gated[0].1),
        _ => format!("{} need confirmation", quoted(&names)),
    };
    Decision::Refuse(
        CommandError::new(error_codes::CONFIRMATION_REQUIRED, message)
            .with_suggestion(suggestion)
            .with_retryable(false)
            .with_details(HashMap::from([("commands".to_owned(), json!(names))])),
    )
}
