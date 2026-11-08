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
//!
//! # One state per call
//!
//! The confirmation and the form-mode approval relay ([`ApprovalRelay::McpElicitation`](crate::ApprovalRelay))
//! share one signed `requestState` (`spec/command-metadata.md`, "Asking the human over MCP"): it
//! carries the questions just asked and the answers accepted in earlier rounds, so a call that
//! needs a confirmation and then an approval keeps the first answer while the second is asked. Each
//! answer counts for 10 minutes from when its question was asked, however many rounds carry it.
//! The state's associated data is the call's principal binding and every command the call runs
//! with its input as sent, so it answers nothing for another call or another caller.
//!
//! A [host-verified](crate::CommandConfirmationMode::HostVerified) command never reaches this
//! gate: only the host's [`HumanRelay`](super::HumanRelay) confirms it (see
//! [`super::human_relay`]).

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use rmcp::model::{
    CallToolRequestParams, CallToolResponse, ElicitRequestParams, InputRequiredResult,
    ProtocolVersion, RequestStateCodec, SealOptions,
};
use rmcp::service::RequestContext;
use rmcp::RoleServer;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::approval::relay::{ApprovalHold, Asked, RoundAnswers, APPROVAL_INPUT_KEY};
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

/// How long a confirmation `requestState` stays valid, and how long an answer counts from when its
/// question was asked.
const STATE_TTL: Duration = Duration::from_secs(600);

/// The form-mode approval elicitation: one required boolean.
pub fn approval_requested_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "approve": { "type": "boolean", "title": "Approve", "description": "Allow this action to run" }
        },
        "required": ["approve"],
    })
}

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
/// and input alone, before #532; the gated commands alone with a bare payload, before the
/// approval relay shared the state) never verifies.
const BINDING_VERSION: &str = "afd.confirm.v3";

/// The associated data of the `requestState` of a call to one command: the command, its input as
/// sent and the call's principal binding ([`principal_binding`](crate::principal_binding)),
/// canonically. Confirmation and approval-relay answers of that call are both bound to it.
pub fn confirmation_binding(command: &str, input: &Value, principal: &str) -> Vec<u8> {
    steps_binding(&[Step::new(command, input.clone())], principal)
}

/// The associated data of a call's `requestState`: the layout's version, the call's principal
/// binding (as a JSON string, so it can never be read as part of the steps) and every command the
/// call runs with its input as sent, canonically.
fn steps_binding(steps: &[Step], principal: &str) -> Vec<u8> {
    let steps: Vec<Value> = steps
        .iter()
        .map(|step| json!([step.command, step.input]))
        .collect();
    canonical(&json!([BINDING_VERSION, principal, steps])).into_bytes()
}

/// The binding of a confirmation question: the unpadded base64url SHA-256 of the gated commands
/// and their input, canonically. The state's associated data binds the caller.
fn confirm_question(steps: &[Step]) -> String {
    let steps: Vec<Value> = steps
        .iter()
        .map(|step| json!([step.command, step.input]))
        .collect();
    crate::canonical::base64url_encode(&Sha256::digest(canonical(&json!(steps)).as_bytes()))
}

/// The signed `requestState`: the questions just asked (`p`) and those accepted in earlier rounds
/// (`a`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct RoundState {
    p: Vec<Asked>,
    a: Vec<Asked>,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| {
            i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX)
        })
}

/// The elicitations of one `tools/call`: the answers its retry carries, read once, and the
/// `input_required` result for the next question. Only a modern request carries a state.
pub(crate) struct Round {
    gate: Arc<Gate>,
    modern: bool,
    /// The state's associated data; `None` when the call's credentials cannot be bound.
    binding: Option<Vec<u8>>,
    state: Option<String>,
    responses: Value,
    answers: OnceLock<Option<Arc<RoundAnswers>>>,
}

impl Round {
    /// The round of a call that runs `steps` (every command, with its input as sent).
    pub(crate) fn new(gate: Arc<Gate>, channel: &Channel<'_>, steps: &[Step]) -> Self {
        Self {
            gate,
            modern: is_modern(channel.context),
            binding: channel
                .principal
                .map(|principal| steps_binding(steps, principal)),
            state: channel.request.request_state.clone(),
            responses: channel
                .request
                .input_responses
                .as_ref()
                .and_then(|responses| serde_json::to_value(responses).ok())
                .unwrap_or(Value::Null),
            answers: OnceLock::new(),
        }
    }

    /// The answers this request carries: none without a state that verifies for this call and
    /// this caller. `None` when it carries a state but its credentials cannot be bound: the call
    /// then fails with an internal error, before any state is verified.
    pub(crate) fn answers(&self) -> Option<Arc<RoundAnswers>> {
        self.answers.get_or_init(|| self.read()).clone()
    }

    fn read(&self) -> Option<Arc<RoundAnswers>> {
        let none = Some(Arc::new(RoundAnswers::default()));
        let Some(state) = self.state.as_deref().filter(|_| self.modern) else {
            return none;
        };
        let binding = self.binding.as_ref()?;
        let Ok(payload) = self.gate.codec.open_with(state, binding) else {
            return none;
        };
        let Ok(round) = serde_json::from_slice::<RoundState>(&payload) else {
            return none;
        };
        // An answer carried from an earlier round lapses with its own question, so re-minting the
        // state never extends it.
        let now = now_ms();
        let mut answers = RoundAnswers {
            accepted: round.a.into_iter().filter(|item| item.t > now).collect(),
            declined: Vec::new(),
        };
        for asked in round.p.into_iter().filter(|item| item.t > now) {
            let response = &self.responses[asked.k.as_str()];
            let Some(action) = response["action"].as_str() else {
                continue;
            };
            let field = if asked.k == APPROVAL_INPUT_KEY {
                "approve"
            } else {
                "confirm"
            };
            if action == "accept" && response["content"][field] == Value::Bool(true) {
                answers.accepted.push(asked);
            } else {
                answers.declined.push(asked);
            }
        }
        Some(Arc::new(answers))
    }

    /// The `input_required` result asking `question` with one form elicitation. The state carries
    /// the answers accepted so far, except earlier answers to the same question (`replaces`, the
    /// question's bindings under every key). `None` when the call's credentials cannot be bound:
    /// no state is minted for it.
    fn ask(
        &self,
        question: Asked,
        message: String,
        requested_schema: Value,
        replaces: &[String],
    ) -> Option<CallToolResponse> {
        let binding = self.binding.as_ref()?;
        let answers = self.answers()?;
        let kept: Vec<Asked> = answers
            .accepted
            .iter()
            .filter(|item| item.k != question.k || !replaces.contains(&item.b))
            .cloned()
            .collect();
        let key = question.k.clone();
        let asked = Asked {
            t: now_ms().saturating_add(STATE_TTL.as_millis() as i64),
            ..question
        };
        let payload = serde_json::to_vec(&RoundState {
            p: vec![asked],
            a: kept,
        })
        .ok()?;
        let state = self.gate.codec.seal_with(
            &payload,
            &SealOptions::new().associated_data(binding).ttl(STATE_TTL),
        );
        let result: InputRequiredResult = serde_json::from_value(json!({
            "resultType": "input_required",
            "inputRequests": {
                key: {
                    "method": "elicitation/create",
                    "params": { "mode": "form", "message": message, "requestedSchema": requested_schema },
                }
            },
            "requestState": state,
        }))
        .ok()?;
        Some(CallToolResponse::InputRequired(result))
    }

    /// The `input_required` result asking for the approval the middleware held.
    pub(crate) fn ask_approval(&self, hold: &ApprovalHold) -> Option<CallToolResponse> {
        self.ask(
            Asked {
                k: APPROVAL_INPUT_KEY.to_owned(),
                b: hold.binding.clone(),
                t: 0,
                n: Some(hold.nonce.clone()),
                x: Some(hold.expires_at),
                m: Some(hold.mac.clone()),
            },
            hold.message.clone(),
            approval_requested_schema(),
            &hold.bindings,
        )
    }
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

pub(crate) fn allows_form_elicitation(context: &RequestContext<RoleServer>) -> bool {
    context
        .client_capabilities()
        .and_then(|capabilities| capabilities.elicitation)
        .is_some_and(|elicitation| elicitation.form.is_some() || elicitation.url.is_none())
}

fn answer(action: &Value, content: &Value) -> bool {
    action == "accept" && content["confirm"] == Value::Bool(true)
}

pub(crate) fn quoted(names: &[String]) -> String {
    names
        .iter()
        .map(|name| format!("'{name}'"))
        .collect::<Vec<_>>()
        .join(", ")
}

pub(crate) fn declined(names: &[String]) -> CommandError {
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

/// Decide a tool call that runs `steps`. `prompt` returns a command's `confirm_prompt` (and
/// `None` for a host-verified command, which only the host's relay confirms);
/// `how_to_acknowledge` is the recovery text for this tool, such as "repeat the call with
/// confirm: true". `round` holds the answers the request carries.
pub(crate) async fn check(
    gate: &Gate,
    steps: &[Step],
    prompt: impl Fn(&str) -> Option<String>,
    acknowledged: Acknowledgement,
    how_to_acknowledge: &str,
    channel: &Channel<'_>,
    round: &Round,
) -> Decision {
    let context = channel.context;
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
    let question = confirm_question(&gated_steps);
    let modern = is_modern(context);

    // The retry of an earlier elicitation, if its state verifies for this call and this
    // principal. A state that does not (altered, expired, or issued for other input or to
    // another principal) is no answer, and the call is asked again below. Incomplete
    // credentials are never bound: a retry carrying a state fails closed.
    let Some(answers) = round.answers() else {
        return Decision::Internal;
    };
    let asks = |item: &Asked| item.k == CONFIRM_INPUT_KEY && item.b == question;
    if answers.declined.iter().any(asks) {
        return Decision::Refuse(declined(&names));
    }
    if answers.accepted.iter().any(asks) {
        return Decision::Proceed;
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
        let message = elicitation_message(&gated);
        if modern {
            // Incomplete credentials are never bound: no state is minted for them.
            let asked = Asked {
                k: CONFIRM_INPUT_KEY.to_owned(),
                b: question.clone(),
                t: 0,
                n: None,
                x: None,
                m: None,
            };
            return match round.ask(asked, message, confirm_requested_schema(), &[question]) {
                Some(response) => Decision::Ask(response),
                None => Decision::Internal,
            };
        } else if channel.legacy_back_channel {
            let elicitation = json!({
                "mode": "form",
                "message": message,
                "requestedSchema": confirm_requested_schema(),
            });
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
