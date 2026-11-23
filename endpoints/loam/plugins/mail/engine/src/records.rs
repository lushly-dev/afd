//! Proposed records attached to messages (the specification's 10.1 and section 11):
//! `mail-record-list`, `mail-record-propose` and `mail-record-withdraw`.
//!
//! Every record carries a closed type, validated per-type fields, verbatim
//! passages verified against the message's held visible text or decoded
//! `Subject`, its proposer, and a 32-byte SHA-256 content hash. Records never
//! change screening class, never send, and never move mail. Every caller's
//! `fields` and `passages` sit inside a part labelled `"trust": "content"`.

use std::fmt::Write as _;
use std::sync::Arc;

use afd::{
    CommandContext, CommandDefinition, CommandError, CommandHandler, CommandParameter,
    CommandResult, JsonSchemaType, failure, success,
};
use async_trait::async_trait;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};

use crate::commands::store_failure;
use crate::derive;
use crate::engine::Engine;
use crate::read::{
    LIST_BUDGET, MOST_BUDGET, budget, content, cursor, fit, integer, limit, parameter,
    read_exposure, required,
};
use crate::screening::{person_at_terminal, proposer_json, proposer_of};
use crate::store::{
    MessageId, NewRecord, ProposerFilter, RecordProposed, RecordQuery, RecordRow, RecordType,
    StoreError, ThreadId, TokenRow, WithdrawOutcome,
};

/// Command name for proposing a record.
pub const PROPOSE: &str = "mail-record-propose";
/// Command name for withdrawing a record.
pub const WITHDRAW: &str = "mail-record-withdraw";
/// Command name for listing records.
pub const LIST: &str = "mail-record-list";

/// Minimum number of passages required to ground a record.
pub const MIN_PASSAGES: usize = 1;
/// Maximum number of passages permitted on one record.
pub const MAX_PASSAGES: usize = 8;
/// Maximum character length of a single passage.
pub const MAX_PASSAGE_CHARS: usize = 1_000;
/// Maximum character length of any string field value.
pub const MAX_FIELD_CHARS: usize = 500;
/// Maximum serialized byte length of a record's canonical `fields` JSON object.
pub const MAX_FIELDS_BYTES: usize = 4 * 1024;
/// Maximum active records one proposer may hold across the store.
pub const MAX_ACTIVE_PER_PROPOSER: u32 = 10_000;

fn invalid(message: impl Into<String>, suggestion: impl Into<String>) -> Box<CommandError> {
    Box::new(CommandError::new("INVALID_INPUT", message).with_suggestion(suggestion))
}

fn record_not_found(id: i64) -> CommandError {
    CommandError::new("RECORD_NOT_FOUND", format!("no record has the id {id}"))
        .with_suggestion("Run `loam-mail mail-record-list` to see the records.")
}

fn message_not_found() -> CommandError {
    CommandError::new("MESSAGE_NOT_FOUND", "no message has that id")
        .with_suggestion("Run `loam-mail mail-thread-open` to see a thread's messages.")
}

fn thread_not_found() -> CommandError {
    CommandError::new("THREAD_NOT_FOUND", "no thread has that id")
        .with_suggestion("Run `loam-mail mail-thread-list` to see a mailbox's threads.")
}

fn not_held() -> CommandError {
    CommandError::new(
        "NOT_HELD",
        "the message's body is not held in the log yet, so passages cannot be verified",
    )
    .with_suggestion(
        "Open the message with `mail-message-open` or wait for `mail-sync` to fetch its body, then propose the record again.",
    )
    .with_retryable(true)
}

/// Whether `c` is forbidden in a record string field: any control character,
/// Unicode line/paragraph separator, or hidden formatting/bidi character
/// (allowing U+200D ZWJ and U+FE0F emoji variation selector).
fn unsafe_in_field(c: char) -> bool {
    if matches!(c, '\u{200D}' | '\u{FE0F}') {
        return false;
    }
    c.is_control() || matches!(c, '\u{2028}' | '\u{2029}') || crate::html::invisible(c)
}

/// Specification of one field in a record type's schema.
#[derive(Clone, Copy)]
struct FieldSpec {
    name: &'static str,
    required: bool,
    kind: FieldKind,
}

#[derive(Clone, Copy)]
enum FieldKind {
    /// Non-empty string up to [`MAX_FIELD_CHARS`], without control/bidi chars.
    Text,
    /// Exact match against a fixed enum of strings.
    Enum(&'static [&'static str]),
    /// JSON boolean.
    Bool,
    /// JSON integer within `[min, max]`.
    IntRange(i64, i64),
}

const REQUEST_FIELDS: &[FieldSpec] = &[
    FieldSpec {
        name: "summary",
        required: true,
        kind: FieldKind::Text,
    },
    FieldSpec {
        name: "dueAt",
        required: false,
        kind: FieldKind::Text,
    },
    FieldSpec {
        name: "urgency",
        required: false,
        kind: FieldKind::Enum(&["low", "normal", "high"]),
    },
];

const COMMITMENT_FIELDS: &[FieldSpec] = &[
    FieldSpec {
        name: "summary",
        required: true,
        kind: FieldKind::Text,
    },
    FieldSpec {
        name: "by",
        required: true,
        kind: FieldKind::Enum(&["person", "sender", "other"]),
    },
    FieldSpec {
        name: "dueAt",
        required: false,
        kind: FieldKind::Text,
    },
];

const DEADLINE_FIELDS: &[FieldSpec] = &[
    FieldSpec {
        name: "summary",
        required: true,
        kind: FieldKind::Text,
    },
    FieldSpec {
        name: "dueAt",
        required: true,
        kind: FieldKind::Text,
    },
    FieldSpec {
        name: "timezone",
        required: false,
        kind: FieldKind::Text,
    },
];

const ORDER_FIELDS: &[FieldSpec] = &[
    FieldSpec {
        name: "merchant",
        required: true,
        kind: FieldKind::Text,
    },
    FieldSpec {
        name: "orderNumber",
        required: false,
        kind: FieldKind::Text,
    },
    FieldSpec {
        name: "status",
        required: false,
        kind: FieldKind::Text,
    },
    FieldSpec {
        name: "amount",
        required: false,
        kind: FieldKind::Text,
    },
    FieldSpec {
        name: "currency",
        required: false,
        kind: FieldKind::Text,
    },
    FieldSpec {
        name: "trackingNumber",
        required: false,
        kind: FieldKind::Text,
    },
    FieldSpec {
        name: "expectedAt",
        required: false,
        kind: FieldKind::Text,
    },
];

const BOOKING_FIELDS: &[FieldSpec] = &[
    FieldSpec {
        name: "title",
        required: true,
        kind: FieldKind::Text,
    },
    FieldSpec {
        name: "startsAt",
        required: true,
        kind: FieldKind::Text,
    },
    FieldSpec {
        name: "endsAt",
        required: false,
        kind: FieldKind::Text,
    },
    FieldSpec {
        name: "location",
        required: false,
        kind: FieldKind::Text,
    },
    FieldSpec {
        name: "confirmationCode",
        required: false,
        kind: FieldKind::Text,
    },
    FieldSpec {
        name: "provider",
        required: false,
        kind: FieldKind::Text,
    },
];

const BILL_FIELDS: &[FieldSpec] = &[
    FieldSpec {
        name: "vendor",
        required: true,
        kind: FieldKind::Text,
    },
    FieldSpec {
        name: "amount",
        required: true,
        kind: FieldKind::Text,
    },
    FieldSpec {
        name: "currency",
        required: true,
        kind: FieldKind::Text,
    },
    FieldSpec {
        name: "dueAt",
        required: false,
        kind: FieldKind::Text,
    },
    FieldSpec {
        name: "invoiceNumber",
        required: false,
        kind: FieldKind::Text,
    },
    FieldSpec {
        name: "autopay",
        required: false,
        kind: FieldKind::Bool,
    },
];

const CODE_FIELDS: &[FieldSpec] = &[
    FieldSpec {
        name: "service",
        required: true,
        kind: FieldKind::Text,
    },
    FieldSpec {
        name: "code",
        required: true,
        kind: FieldKind::Text,
    },
    FieldSpec {
        name: "expiresAt",
        required: false,
        kind: FieldKind::Text,
    },
];

const CATEGORY_FIELDS: &[FieldSpec] = &[
    FieldSpec {
        name: "category",
        required: true,
        kind: FieldKind::Text,
    },
    FieldSpec {
        name: "reason",
        required: false,
        kind: FieldKind::Text,
    },
];

const PRIORITY_FIELDS: &[FieldSpec] = &[
    FieldSpec {
        name: "level",
        required: true,
        kind: FieldKind::Enum(&["low", "normal", "high", "urgent"]),
    },
    FieldSpec {
        name: "rank",
        required: false,
        kind: FieldKind::IntRange(1, 100),
    },
    FieldSpec {
        name: "reason",
        required: false,
        kind: FieldKind::Text,
    },
];

fn schema_for(record_type: RecordType) -> &'static [FieldSpec] {
    match record_type {
        RecordType::Request => REQUEST_FIELDS,
        RecordType::Commitment => COMMITMENT_FIELDS,
        RecordType::Deadline => DEADLINE_FIELDS,
        RecordType::Order => ORDER_FIELDS,
        RecordType::Booking => BOOKING_FIELDS,
        RecordType::Bill => BILL_FIELDS,
        RecordType::Code => CODE_FIELDS,
        RecordType::Category => CATEGORY_FIELDS,
        RecordType::Priority => PRIORITY_FIELDS,
    }
}

fn allowed_type_names() -> String {
    RecordType::ALL
        .iter()
        .map(|kind| kind.as_str())
        .collect::<Vec<_>>()
        .join(", ")
}

fn parse_record_type(
    input: &Value,
    required_field: bool,
) -> Result<Option<RecordType>, Box<CommandError>> {
    match input.get("type") {
        None | Some(Value::Null) => {
            if required_field {
                Err(invalid(
                    "`type` is required",
                    format!("Use one of: {}.", allowed_type_names()),
                ))
            } else {
                Ok(None)
            }
        }
        Some(Value::String(text)) => RecordType::parse(text).map(Some).ok_or_else(|| {
            invalid(
                "`type` is not a supported record type",
                format!("Use one of: {}.", allowed_type_names()),
            )
        }),
        Some(_) => Err(invalid(
            "`type` must be a string",
            format!("Use one of: {}.", allowed_type_names()),
        )),
    }
}

/// Validates and canonicalizes `fields` against `record_type`'s strict schema.
/// Never echoes caller-supplied keys or values in error messages (§12.1).
fn validate_fields(
    record_type: RecordType,
    raw: Option<&Value>,
) -> Result<(Map<String, Value>, String), Box<CommandError>> {
    let Some(Value::Object(object)) = raw else {
        return Err(invalid(
            "`fields` must be a JSON object",
            format!(
                "Pass `fields` as an object for record type `{}`.",
                record_type.as_str()
            ),
        ));
    };
    let specs = schema_for(record_type);
    let allowed_names = || {
        specs
            .iter()
            .map(|spec| spec.name)
            .collect::<Vec<_>>()
            .join(", ")
    };

    // Reject any key outside the closed schema for this type.
    for key in object.keys() {
        if !specs.iter().any(|spec| spec.name == key) {
            return Err(invalid(
                format!(
                    "`fields` contains an unknown key for record type `{}`",
                    record_type.as_str()
                ),
                format!(
                    "Allowed keys for `{}`: {}.",
                    record_type.as_str(),
                    allowed_names()
                ),
            ));
        }
    }

    let mut canonical = Map::new();
    for spec in specs {
        match object.get(spec.name) {
            None | Some(Value::Null) => {
                if spec.required {
                    return Err(invalid(
                        format!(
                            "`fields.{}` is required for record type `{}`",
                            spec.name,
                            record_type.as_str()
                        ),
                        format!("Provide `{}` in `fields`.", spec.name),
                    ));
                }
            }
            Some(value) => {
                let checked = validate_field_value(spec, value)?;
                canonical.insert(spec.name.to_string(), checked);
            }
        }
    }

    let serialized = serde_json::to_string(&Value::Object(canonical.clone())).map_err(|_| {
        invalid(
            "`fields` could not be serialized",
            "Pass plain JSON values.",
        )
    })?;
    if serialized.len() > MAX_FIELDS_BYTES {
        return Err(invalid(
            format!("serialized `fields` exceeds {MAX_FIELDS_BYTES} bytes"),
            "Shorten the record's field values.",
        ));
    }
    Ok((canonical, serialized))
}

fn validate_field_value(spec: &FieldSpec, value: &Value) -> Result<Value, Box<CommandError>> {
    match spec.kind {
        FieldKind::Text => {
            let Some(text) = value.as_str() else {
                return Err(invalid(
                    format!("`fields.{}` must be a string", spec.name),
                    format!("Pass `{}` as a non-empty string.", spec.name),
                ));
            };
            if text
                .chars()
                .all(|c| c.is_whitespace() || matches!(c, '\u{200D}' | '\u{FE0F}'))
            {
                return Err(invalid(
                    format!("`fields.{}` must not be empty", spec.name),
                    format!(
                        "Provide visible text for `{}` or omit it if optional.",
                        spec.name
                    ),
                ));
            }
            if text.chars().count() > MAX_FIELD_CHARS {
                return Err(invalid(
                    format!(
                        "`fields.{}` is longer than {MAX_FIELD_CHARS} characters",
                        spec.name
                    ),
                    format!(
                        "Shorten `{}` to at most {MAX_FIELD_CHARS} characters.",
                        spec.name
                    ),
                ));
            }
            if text.chars().any(unsafe_in_field) {
                return Err(invalid(
                    format!(
                        "`fields.{}` holds a control character or hidden formatting character",
                        spec.name
                    ),
                    format!(
                        "Give `{}` on one line without control or invisible formatting characters.",
                        spec.name
                    ),
                ));
            }
            Ok(Value::String(text.to_string()))
        }
        FieldKind::Enum(allowed) => {
            let Some(text) = value.as_str() else {
                return Err(invalid(
                    format!("`fields.{}` must be a string", spec.name),
                    format!("Use one of: {}.", allowed.join(", ")),
                ));
            };
            if !allowed.contains(&text) {
                return Err(invalid(
                    format!("`fields.{}` is not an allowed value", spec.name),
                    format!("Use one of: {}.", allowed.join(", ")),
                ));
            }
            Ok(Value::String(text.to_string()))
        }
        FieldKind::Bool => {
            let Some(flag) = value.as_bool() else {
                return Err(invalid(
                    format!("`fields.{}` must be true or false", spec.name),
                    format!("Pass `{}` as a boolean.", spec.name),
                ));
            };
            Ok(Value::Bool(flag))
        }
        FieldKind::IntRange(min, max) => {
            let Some(number) = value.as_i64() else {
                return Err(invalid(
                    format!(
                        "`fields.{}` must be a whole number between {min} and {max}",
                        spec.name
                    ),
                    format!("Pass `{}` as an integer from {min} to {max}.", spec.name),
                ));
            };
            if !(min..=max).contains(&number) {
                return Err(invalid(
                    format!("`fields.{}` must be between {min} and {max}", spec.name),
                    format!("Pass `{}` as an integer from {min} to {max}.", spec.name),
                ));
            }
            Ok(json!(number))
        }
    }
}

/// Validates `passages`: 1 to [`MAX_PASSAGES`] non-blank strings, each up to
/// [`MAX_PASSAGE_CHARS`] characters.
fn validate_passages(raw: Option<&Value>) -> Result<Vec<String>, Box<CommandError>> {
    let Some(Value::Array(items)) = raw else {
        return Err(invalid(
            "`passages` must be a non-empty list of verbatim quotes",
            "Pass 1 to 8 exact substrings from the message's visible text or subject.",
        ));
    };
    if items.len() < MIN_PASSAGES || items.len() > MAX_PASSAGES {
        return Err(invalid(
            format!("`passages` must hold between {MIN_PASSAGES} and {MAX_PASSAGES} items"),
            format!("Provide {MIN_PASSAGES} to {MAX_PASSAGES} verbatim quotes from the message."),
        ));
    }
    let mut passages = Vec::with_capacity(items.len());
    for (index, item) in items.iter().enumerate() {
        let Some(text) = item.as_str() else {
            return Err(invalid(
                format!("`passages[{index}]` must be a string"),
                "Pass each passage as an exact string quote from the message.",
            ));
        };
        if text.trim().is_empty() {
            return Err(invalid(
                format!("`passages[{index}]` must contain visible text"),
                "Quote a non-empty substring from the message's visible text or subject.",
            ));
        }
        if text.chars().count() > MAX_PASSAGE_CHARS {
            return Err(invalid(
                format!("`passages[{index}]` is longer than {MAX_PASSAGE_CHARS} characters"),
                format!("Shorten each passage to at most {MAX_PASSAGE_CHARS} characters."),
            ));
        }
        passages.push(text.to_string());
    }
    Ok(passages)
}

/// Verifies that every passage occurs verbatim in either the message's visible
/// body text or its decoded visible `Subject` (with invisible characters
/// removed per §6.2). Refuses the whole proposal with `PASSAGE_NOT_FOUND` on
/// the first missing passage without echoing passage text.
pub(crate) fn verify_passages(
    passages: &[String],
    visible_text: &str,
    subject: &str,
) -> Result<(), Box<CommandError>> {
    let visible_subject: String = subject
        .chars()
        .filter(|&c| !crate::html::invisible(c) || matches!(c, '\u{200D}' | '\u{FE0F}'))
        .collect();
    for (index, passage) in passages.iter().enumerate() {
        if !visible_text.contains(passage.as_str()) && !visible_subject.contains(passage.as_str()) {
            return Err(Box::new(
                CommandError::new(
                    "PASSAGE_NOT_FOUND",
                    format!(
                        "passage {index} was not found verbatim in the message's visible text or subject"
                    ),
                )
                .with_suggestion(
                    "Quote exact substrings from the message's visible text or subject returned by mail-message-open; hidden text cannot ground a record.",
                )
                .with_retryable(false),
            ));
        }
    }
    Ok(())
}

/// Computes the 32-byte SHA-256 content hash over canonical
/// `{ fields, message, passages, type }`.
fn compute_content_hash(
    message: MessageId,
    record_type: RecordType,
    fields: &Map<String, Value>,
    passages: &[String],
) -> [u8; 32] {
    let payload = json!({
        "fields": Value::Object(fields.clone()),
        "message": message.0,
        "passages": passages,
        "type": record_type.as_str(),
    });
    let bytes = serde_json::to_vec(&payload).unwrap_or_default();
    Sha256::digest(&bytes).into()
}

fn hex_hash(bytes: &[u8; 32]) -> String {
    let mut out = String::with_capacity(64);
    for byte in bytes {
        let _ = write!(&mut out, "{byte:02x}");
    }
    out
}

/// Shapes a record row for command results, keeping `fields` and `passages`
/// strictly inside `"content": { "trust": "content", ... }` (§12.1).
fn record_json(row: &RecordRow, tokens: &[TokenRow]) -> Value {
    json!({
        "record": row.id,
        "message": row.message.0,
        "type": row.record_type.as_str(),
        "state": row.state.as_str(),
        "proposer": proposer_json(&row.proposer, tokens),
        "proposedAt": row.proposed_at,
        "endedAt": row.ended_at,
        "supersededBy": row.superseded_by,
        "contentHash": hex_hash(&row.content_hash),
        "content": content(json!({
            "fields": row.fields,
            "passages": row.passages,
        })),
    })
}

fn proposer_filter(input: &Value) -> Result<Option<ProposerFilter>, Box<CommandError>> {
    match input.get("proposer") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                return Err(invalid(
                    "`proposer` must not be empty",
                    "Pass an actor kind (human, agent, script) or an agent token id.",
                ));
            }
            if trimmed.parse::<afd::ActorKind>().is_ok() || trimmed == "unknown" {
                Ok(Some(ProposerFilter::Kind(trimmed.to_string())))
            } else {
                Ok(Some(ProposerFilter::Token(trimmed.to_string())))
            }
        }
        Some(_) => Err(invalid(
            "`proposer` must be a string",
            "Pass an actor kind (human, agent, script) or an agent token id.",
        )),
    }
}

fn optional_bool(input: &Value, name: &str, default: bool) -> Result<bool, Box<CommandError>> {
    match input.get(name) {
        None | Some(Value::Null) => Ok(default),
        Some(Value::Bool(flag)) => Ok(*flag),
        Some(_) => Err(invalid(
            format!("`{name}` must be true or false"),
            format!("Pass `{name}` as a boolean."),
        )),
    }
}

struct Propose {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for Propose {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let message = match required(&input, "message") {
            Ok(id) => MessageId(id),
            Err(error) => return failure(*error),
        };
        let record_type = match parse_record_type(&input, true) {
            Ok(Some(kind)) => kind,
            Ok(None) => return failure(*invalid("`type` is required", allowed_type_names())),
            Err(error) => return failure(*error),
        };
        let (fields_map, fields_json) = match validate_fields(record_type, input.get("fields")) {
            Ok(valid) => valid,
            Err(error) => return failure(*error),
        };
        let passages = match validate_passages(input.get("passages")) {
            Ok(valid) => valid,
            Err(error) => return failure(*error),
        };
        let passages_json = match serde_json::to_string(&passages) {
            Ok(serialized) => serialized,
            Err(_) => {
                return failure(*invalid(
                    "`passages` could not be serialized",
                    "Pass `passages` as a list of strings.",
                ));
            }
        };

        let proposer = proposer_of(&context);
        let now = context.clock().now();
        let hash = compute_content_hash(message, record_type, &fields_map, &passages);

        let done = self.engine.with_store(|store| {
            let Some(listed) = store.message_listed(message)? else {
                return Ok(Err(Box::new(message_not_found())));
            };
            if !listed.held_whole && !listed.held_in_parts {
                return Ok(Err(Box::new(not_held())));
            }
            let Some(whole) = store.body_bytes(message)? else {
                return Ok(Err(Box::new(not_held())));
            };
            let reading = derive::reading(&whole);
            if let Err(error) = verify_passages(&passages, &reading.visible, &listed.subject) {
                return Ok(Err(error));
            }
            let proposed = store.propose_record(
                &NewRecord {
                    message,
                    record_type,
                    fields_json: &fields_json,
                    passages_json: &passages_json,
                    content_hash: &hash,
                    proposer: &proposer,
                },
                MAX_ACTIVE_PER_PROPOSER,
                now,
            )?;
            match proposed {
                RecordProposed::Stored { row, superseded } => {
                    let tokens = store.tokens()?;
                    let mut out = record_json(&row, &tokens);
                    out["superseded"] = json!(superseded);
                    Ok(Ok(out))
                }
                RecordProposed::TooMany(most) => Ok(Err(Box::new(
                    CommandError::new(
                        "POLICY_LIMIT",
                        format!(
                            "this caller has {most} active records already, the most it may hold"
                        ),
                    )
                    .with_suggestion(
                        "Withdraw unneeded records with `mail-record-withdraw` or supersede existing ones.",
                    )
                    .with_retryable(false),
                ))),
            }
        });

        match done {
            Ok(Ok(result)) => success(result),
            Ok(Err(error)) => failure(*error),
            Err(StoreError::NotFound("message")) => failure(message_not_found()),
            Err(error) => failure(store_failure(&error)),
        }
    }
}

/// `mail-record-propose`: proposes a structured record attached to a message,
/// grounded in verbatim passages from its held visible text or subject.
#[must_use]
pub fn propose(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        PROPOSE,
        "Propose a structured record attached to a message, grounded in verbatim visible passages",
        vec![
            parameter(
                "message",
                JsonSchemaType::Integer,
                "The message to attach the record to, by id",
                true,
            ),
            CommandParameter {
                name: "type".to_string(),
                param_type: JsonSchemaType::String,
                description: format!("Record type ({})", allowed_type_names()),
                required: true,
                default: None,
                enum_values: Some(
                    RecordType::ALL
                        .iter()
                        .map(|kind| json!(kind.as_str()))
                        .collect(),
                ),
                schema: None,
            },
            parameter(
                "fields",
                JsonSchemaType::Object,
                "Validated per-type fields object (serialized JSON up to 4 KiB; string fields up to 500 characters)",
                true,
            ),
            parameter(
                "passages",
                JsonSchemaType::Array,
                "1 to 8 verbatim quotes (up to 1,000 characters each) from the message's visible text or subject",
                true,
            ),
        ],
        Propose { engine },
    )
    .as_mutation()
    .with_expose(read_exposure())
}

struct Withdraw {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for Withdraw {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let id = match required(&input, "record") {
            Ok(id) => id,
            Err(error) => return failure(*error),
        };
        let person = person_at_terminal(&context);
        let caller = proposer_of(&context);
        let now = context.clock().now();

        let done = self.engine.with_store(|store| {
            let Some(row) = store.record(id)? else {
                return Ok(Err(record_not_found(id)));
            };
            if !person && row.proposer != caller {
                return Ok(Err(CommandError::new(
                    "FORBIDDEN",
                    "only the person, or the caller that proposed it, may withdraw a record",
                )
                .with_suggestion("Withdraw only records you proposed.")));
            }
            match store.withdraw_record(id, now)? {
                WithdrawOutcome::Withdrawn(updated) => Ok(Ok(json!({
                    "record": updated.id,
                    "message": updated.message.0,
                    "type": updated.record_type.as_str(),
                    "state": updated.state.as_str(),
                    "endedAt": updated.ended_at,
                }))),
                WithdrawOutcome::AlreadyEnded(state) => Ok(Err(CommandError::new(
                    "INVALID_INPUT",
                    format!("record {id} is already {}", state.as_str()),
                )
                .with_suggestion("Run `loam-mail mail-record-list` to see active records."))),
                WithdrawOutcome::NotFound => Ok(Err(record_not_found(id))),
            }
        });

        match done {
            Ok(Ok(result)) => success(result),
            Ok(Err(error)) => failure(error),
            Err(error) => failure(store_failure(&error)),
        }
    }
}

/// `mail-record-withdraw`: withdraws an active record. Allowed for the person
/// at a terminal or the record's own proposer; non-destructive (M29).
#[must_use]
pub fn withdraw(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        WITHDRAW,
        "Withdraw an active record: the person's, or its proposer's own",
        vec![parameter(
            "record",
            JsonSchemaType::Integer,
            "The record, by id",
            true,
        )],
        Withdraw { engine },
    )
    .as_mutation()
    .with_expose(read_exposure())
}

struct List {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for List {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let read = || -> Result<Value, Box<CommandError>> {
            let message = integer(&input, "message")?.map(MessageId);
            let thread = integer(&input, "thread")?.map(ThreadId);
            let record_type = parse_record_type(&input, false)?;
            let proposer = proposer_filter(&input)?;
            let include_ended = optional_bool(&input, "includeEnded", false)?;
            let before = cursor(&input)?;
            let limit = limit(&input, 50, 200)?;

            let query = RecordQuery {
                message,
                thread,
                record_type,
                proposer,
                include_ended,
                before,
                limit: limit + 1,
            };

            let (rows, tokens) = self
                .engine
                .with_store(|store| {
                    if let Some(message) = message
                        && !store.message_exists(message)?
                    {
                        return Ok(Err(Box::new(message_not_found())));
                    }
                    if let Some(thread) = thread
                        && !store.thread_exists(thread)?
                    {
                        return Ok(Err(Box::new(thread_not_found())));
                    }
                    let rows = store.list_records(&query)?;
                    let tokens = store.tokens()?;
                    Ok(Ok((rows, tokens)))
                })
                .map_err(|error| Box::new(store_failure(&error)))??;

            let more = rows.len() > limit as usize;
            let items: Vec<Value> = rows
                .iter()
                .take(limit as usize)
                .map(|row| record_json(row, &tokens))
                .collect();
            let (kept, cut) = fit(items, budget(&context, LIST_BUDGET));
            let next = (more || cut)
                .then(|| kept.last())
                .flatten()
                .map(|last| format!("{}.{}", last["proposedAt"], last["record"]));
            Ok(json!({ "records": kept, "nextCursor": next }))
        };

        match read() {
            Ok(result) => success(result),
            Err(error) => failure(*error),
        }
    }
}

/// `mail-record-list`: lists proposed records, newest first, paged by cursor.
#[must_use]
pub fn list(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        LIST,
        "List proposed records, newest first, optionally filtered by message, thread, type or proposer",
        vec![
            parameter(
                "message",
                JsonSchemaType::Integer,
                "Filter to records attached to this message id",
                false,
            ),
            parameter(
                "thread",
                JsonSchemaType::Integer,
                "Filter to records attached to messages in this thread id",
                false,
            ),
            CommandParameter {
                name: "type".to_string(),
                param_type: JsonSchemaType::String,
                description: format!("Filter to one record type ({})", allowed_type_names()),
                required: false,
                default: None,
                enum_values: Some(
                    RecordType::ALL
                        .iter()
                        .map(|kind| json!(kind.as_str()))
                        .collect(),
                ),
                schema: None,
            },
            parameter(
                "proposer",
                JsonSchemaType::String,
                "Filter by actor kind (human, agent, script) or an agent token id",
                false,
            ),
            parameter(
                "includeEnded",
                JsonSchemaType::Boolean,
                "Include superseded and withdrawn records (default false)",
                false,
            ),
            parameter(
                "cursor",
                JsonSchemaType::String,
                "Where the page before ended",
                false,
            ),
            parameter(
                "limit",
                JsonSchemaType::Integer,
                "At most this many records (1 to 200)",
                false,
            ),
        ],
        List { engine },
    )
    .with_output_budget(LIST_BUDGET, MOST_BUDGET)
    .with_expose(read_exposure())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used, clippy::unwrap_used)]

    use super::*;

    #[test]
    fn validates_all_nine_record_types_and_strips_null_optionals() {
        let cases: &[(RecordType, Value)] = &[
            (
                RecordType::Request,
                json!({ "summary": "Send Q4 slides", "dueAt": "2026-12-01", "urgency": "high" }),
            ),
            (
                RecordType::Commitment,
                json!({ "summary": "I will review tomorrow", "by": "person", "dueAt": null }),
            ),
            (
                RecordType::Deadline,
                json!({ "summary": "Tax filing", "dueAt": "2026-04-15T23:59:00Z", "timezone": "America/Los_Angeles" }),
            ),
            (
                RecordType::Order,
                json!({ "merchant": "Acme", "orderNumber": "A-123", "status": "shipped", "amount": "49.99", "currency": "USD", "trackingNumber": "1Z999", "expectedAt": "2026-11-25" }),
            ),
            (
                RecordType::Booking,
                json!({ "title": "Dentist", "startsAt": "2026-12-02T10:00:00Z", "endsAt": "2026-12-02T11:00:00Z", "location": "Main St", "confirmationCode": "XYZ", "provider": "Clinic" }),
            ),
            (
                RecordType::Bill,
                json!({ "vendor": "Power Co", "amount": "120.00", "currency": "USD", "dueAt": "2026-12-10", "invoiceNumber": "INV-9", "autopay": true }),
            ),
            (
                RecordType::Code,
                json!({ "service": "Bank", "code": "482910", "expiresAt": "2026-11-22T12:00:00Z" }),
            ),
            (
                RecordType::Category,
                json!({ "category": "finance", "reason": "Monthly statement" }),
            ),
            (
                RecordType::Priority,
                json!({ "level": "urgent", "rank": 95, "reason": "Expires in 10 minutes" }),
            ),
        ];

        for (kind, sample) in cases {
            let (map, serialized) = validate_fields(*kind, Some(sample)).unwrap();
            assert!(!serialized.is_empty(), "{kind:?}");
            assert!(
                !map.values().any(Value::is_null),
                "null optional stripped for {kind:?}"
            );
        }
    }

    #[test]
    fn rejects_unknown_keys_bad_types_and_unsafe_characters_without_echoing() {
        let secret_key = "secret_injected_key_xyz";
        let err = validate_fields(
            RecordType::Category,
            Some(&json!({ "category": "news", secret_key: "nope" })),
        )
        .unwrap_err();
        assert_eq!(err.code, "INVALID_INPUT");
        assert!(!err.message.contains(secret_key));

        let err = validate_fields(RecordType::Priority, Some(&json!({ "level": "extreme" })))
            .unwrap_err();
        assert_eq!(err.code, "INVALID_INPUT");
        assert!(!err.message.contains("extreme"));

        for bad_rank in [json!(0), json!(101), json!(50.5), json!("50")] {
            let err = validate_fields(
                RecordType::Priority,
                Some(&json!({ "level": "high", "rank": bad_rank })),
            )
            .unwrap_err();
            assert_eq!(err.code, "INVALID_INPUT");
        }

        let err = validate_fields(
            RecordType::Bill,
            Some(&json!({ "vendor": "V", "amount": "1", "currency": "USD", "autopay": "yes" })),
        )
        .unwrap_err();
        assert_eq!(err.code, "INVALID_INPUT");

        // Control and bidi characters rejected; ZWJ/FE0F-only rejected; emoji sequences preserved.
        for bad in [
            "line1\nline2",
            "a\tb",
            "hi\u{202E}there",
            "zero\u{200B}width",
            "\u{200D}",
            "\u{FE0F}",
            "  \u{200D}\u{FE0F}  ",
        ] {
            let err = validate_fields(RecordType::Category, Some(&json!({ "category": bad })))
                .unwrap_err();
            assert_eq!(err.code, "INVALID_INPUT", "{bad:?}");
        }
        assert!(
            validate_fields(
                RecordType::Category,
                Some(&json!({ "category": "family \u{1F469}\u{200D}\u{1F467} \u{2764}\u{FE0F}" })),
            )
            .is_ok()
        );

        // 500-char field cap and 4 KiB serialized JSON cap.
        let ok_500 = "a".repeat(MAX_FIELD_CHARS);
        assert!(
            validate_fields(RecordType::Category, Some(&json!({ "category": ok_500 })),).is_ok()
        );
        let over_500 = "a".repeat(MAX_FIELD_CHARS + 1);
        assert_eq!(
            validate_fields(RecordType::Category, Some(&json!({ "category": over_500 })),)
                .unwrap_err()
                .code,
            "INVALID_INPUT"
        );
        // 7 fields of 500 multi-byte chars exceed 4 KiB while each is <= 500 chars.
        let wide = "é".repeat(500);
        assert_eq!(
            validate_fields(
                RecordType::Order,
                Some(&json!({
                    "merchant": wide,
                    "orderNumber": wide,
                    "status": wide,
                    "amount": wide,
                    "currency": wide,
                    "trackingNumber": wide,
                    "expectedAt": wide,
                })),
            )
            .unwrap_err()
            .code,
            "INVALID_INPUT"
        );
    }

    #[test]
    fn validates_and_verifies_passages_strictly() {
        assert_eq!(
            validate_passages(Some(&json!([]))).unwrap_err().code,
            "INVALID_INPUT"
        );
        assert_eq!(
            validate_passages(Some(&json!(["   "]))).unwrap_err().code,
            "INVALID_INPUT"
        );
        let nine: Vec<String> = (0..9).map(|i| format!("p{i}")).collect();
        assert_eq!(
            validate_passages(Some(&json!(nine))).unwrap_err().code,
            "INVALID_INPUT"
        );
        assert_eq!(
            validate_passages(Some(&json!(["x".repeat(MAX_PASSAGE_CHARS + 1)])))
                .unwrap_err()
                .code,
            "INVALID_INPUT"
        );

        // Matches visible body or decoded subject (preserving emoji ZWJ/FE0F while stripping hidden chars).
        assert!(
            verify_passages(
                &["Order #99 ✈️".to_string(), "arrives Friday".to_string(),],
                "Your parcel arrives Friday afternoon.",
                "Order\u{200B} #99 ✈️ shipped",
            )
            .is_ok()
        );
        // Refuses passage spanning subject + body boundary or containing hidden invisible chars.
        let err = verify_passages(
            &["shipped Your parcel".to_string()],
            "Your parcel arrives Friday.",
            "Order #99 shipped",
        )
        .unwrap_err();
        assert_eq!(err.code, "PASSAGE_NOT_FOUND");
        assert_eq!(err.retryable, Some(false));
        assert!(!err.message.contains("shipped"));

        let hidden_err = verify_passages(
            &["Order\u{200B} #99".to_string()],
            "Body text",
            "Order\u{200B} #99",
        )
        .unwrap_err();
        assert_eq!(hidden_err.code, "PASSAGE_NOT_FOUND");
    }

    #[test]
    fn content_hash_is_deterministic_and_sensitive() {
        let (f1, _) =
            validate_fields(RecordType::Category, Some(&json!({ "category": "work" }))).unwrap();
        let (f2, _) = validate_fields(
            RecordType::Category,
            Some(&json!({ "category": "personal" })),
        )
        .unwrap();
        let h1 = compute_content_hash(MessageId(7), RecordType::Category, &f1, &["q".to_string()]);
        let h1_again =
            compute_content_hash(MessageId(7), RecordType::Category, &f1, &["q".to_string()]);
        let h2 = compute_content_hash(MessageId(7), RecordType::Category, &f2, &["q".to_string()]);
        assert_eq!(h1, h1_again);
        assert_ne!(h1, h2);
        assert_eq!(hex_hash(&h1).len(), 64);
    }
}
