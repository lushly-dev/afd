//! The copilot's model transport on the desktop (phase 5 specification, 4.2): `model_send` and `model_cancel`.
//! The webview names a provider id and a request body, never a URL or a key. This host reads the providers from
//! `models.json` (written by `deployment write --models-out`, read once at start, owner-only), resolves the key
//! on each request from the OS keychain or an owner-only file, checks the body against the kind's allow-list,
//! builds the request itself (the kind's fixed endpoint or the configured one, the configured model, the kind's
//! key header and nothing else), and streams the answer back to the main webview as `loam:model` DOM events.
//!
//! **A key never leaves this module**: not in a result, an event, an error or a log. Every refusal is a bare code;
//! nothing a provider or the body holds is logged, so model traffic never reaches the app's stderr (#1448).
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::task::AbortHandle;

pub const PROVIDER_UNKNOWN: &str = "COPILOT_PROVIDER_UNKNOWN";
pub const KEY_MISSING: &str = "COPILOT_KEY_MISSING";
pub const PERMISSIONS: &str = "DESKTOP_MODELS_PERMISSIONS";
pub const MODELS_INVALID: &str = "DESKTOP_MODELS_INVALID";
pub const BODY_REFUSED: &str = "MODEL_BODY_REFUSED";
pub const UNREACHABLE: &str = "MODEL_UNREACHABLE";
pub const REFUSED: &str = "MODEL_REFUSED";
pub const STREAM_LIMIT: &str = "MODEL_STREAM_LIMIT";

/// A request body, at most 4 MiB (4.2).
pub const BODY_MAX: usize = 4 * 1024 * 1024;
/// A stream, at most 16 MiB and 10 minutes, then `MODEL_STREAM_LIMIT` (4.2).
pub const STREAM_MAX: usize = 16 * 1024 * 1024;
pub const STREAM_TIME: Duration = Duration::from_secs(10 * 60);
/// Open streams at once: the kernel takes one per session, so this bounds only a misbehaving page.
pub const STREAMS_MAX: usize = 16;
/// `max_tokens` at most 4.4's top of `copilot.turn.outputTokens`; the kernel's half lowers it to the setting.
pub const OUTPUT_TOKENS_MAX: u64 = 131_072;
/// One `loam:model` event's text, at most: a chunk past it is split.
pub const EVENT_TEXT_MAX: usize = 64 * 1024;
/// `models.json`, at most 1 MiB, as `mounts.json`.
const FILE_MAX: usize = 1024 * 1024;
/// A key file, at most 4 KiB.
const KEY_FILE_MAX: usize = 4096;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
const ANTHROPIC_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const OPENAI_URL: &str = "https://api.openai.com/v1/chat/completions";

/// The event's name on `window`.
pub const EVENT: &str = "loam:model";

#[derive(Deserialize, Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum Kind {
    Anthropic,
    Openai,
    OpenaiCompatible,
}

/// Where a key is kept: never the key itself.
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(untagged)]
pub enum KeyRef {
    Keychain(KeychainRef),
    File(FileRef),
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct KeychainRef {
    pub keychain: String,
    pub account: String,
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct FileRef {
    pub file: PathBuf,
}

/// One provider of `models.json`, as `deployment write --models-out` writes it, and of `desktop-state.json`'s
/// `copilot.providers` (phase 5 no-terminal amendment, 9.1), the same record.
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Provider {
    pub id: String,
    pub kind: Kind,
    pub model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<KeyRef>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct File {
    providers: Vec<Provider>,
}

pub(crate) fn identifier(value: &str) -> bool {
    let mut bytes = value.bytes();
    matches!(bytes.next(), Some(b'a'..=b'z'))
        && value.len() <= 32
        && bytes.all(|byte| matches!(byte, b'a'..=b'z' | b'0'..=b'9' | b'-'))
}

fn model_id(value: &str) -> bool {
    let mut bytes = value.bytes();
    matches!(bytes.next(), Some(byte) if byte.is_ascii_alphanumeric())
        && value.len() <= 128
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || b"._:/@-".contains(&byte))
}

pub(crate) fn keychain_name(value: &str) -> bool {
    let mut bytes = value.bytes();
    matches!(bytes.next(), Some(byte) if byte.is_ascii_alphanumeric())
        && value.len() <= 64
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
}

/// A key: printable ASCII with no space, quote or backslash, 8 to 4,096 characters, as `loam copilot key set`
/// stores one. So it is a valid header value, and nothing else is sent as one.
pub fn key_shaped(value: &str) -> bool {
    (8..=4096).contains(&value.len())
        && value
            .bytes()
            .all(|byte| (0x21..=0x7e).contains(&byte) && byte != b'"' && byte != b'\\')
}

/// An `openai-compatible` endpoint: `https`, or `http` to 127.0.0.1 or ::1 only, with no user, query or fragment.
pub fn endpoint_allowed(endpoint: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(endpoint) else {
        return false;
    };
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return false;
    }
    match url.scheme() {
        "https" => url.host_str().is_some_and(|host| !host.is_empty()),
        "http" => matches!(url.host_str(), Some("127.0.0.1" | "[::1]")),
        _ => false,
    }
}

/// `models.json`, or a code: none at `path` configures no provider; one others can read is refused (4.2).
pub fn read(path: &Path) -> Result<Vec<Provider>, &'static str> {
    use crate::mounts::{Unread, read_owner_only};
    let bytes = match read_owner_only(path, FILE_MAX) {
        Ok(bytes) => bytes,
        Err(Unread::Missing) => return Ok(Vec::new()),
        Err(Unread::Denied) => return Err(PERMISSIONS),
        Err(Unread::TooLarge) => return Err(MODELS_INVALID),
    };
    let file: File = serde_json::from_slice(&bytes).map_err(|_| MODELS_INVALID)?;
    let mut seen = std::collections::HashSet::new();
    for provider in &file.providers {
        if !seen.insert(provider.id.as_str()) || !provider_valid(provider) {
            return Err(MODELS_INVALID);
        }
    }
    Ok(file.providers)
}

/// One provider as `models.json` must hold it: its id, model, endpoint and key reference each valid for its kind.
pub(crate) fn provider_valid(provider: &Provider) -> bool {
    let compatible = provider.kind == Kind::OpenaiCompatible;
    let key_valid = match &provider.key {
        None => compatible,
        Some(KeyRef::Keychain(entry)) => {
            keychain_name(&entry.keychain) && keychain_name(&entry.account)
        }
        Some(KeyRef::File(FileRef { file })) => file.is_absolute(),
    };
    let endpoint_valid = match &provider.endpoint {
        None => !compatible,
        Some(endpoint) => compatible && endpoint_allowed(endpoint),
    };
    identifier(&provider.id) && model_id(&provider.model) && key_valid && endpoint_valid
}

// ─── The key ────────────────────────────────────────────────────────────────────

/// The key a provider names, read now, or `COPILOT_KEY_MISSING`. A file must be owner-only, as `models.json` is.
pub fn resolve_key(key: &KeyRef) -> Result<String, &'static str> {
    let found = match key {
        KeyRef::File(FileRef { file }) => {
            use crate::mounts::{Unread, read_owner_only};
            match read_owner_only(file, KEY_FILE_MAX) {
                Ok(bytes) => String::from_utf8(bytes).map_err(|_| KEY_MISSING)?,
                // No file is no key, whose suggestion is to set one; one others can read is refused as such.
                Err(Unread::Missing | Unread::TooLarge) => return Err(KEY_MISSING),
                Err(Unread::Denied) => return Err(PERMISSIONS),
            }
        }
        KeyRef::Keychain(KeychainRef { keychain, account }) => {
            if !keychain_name(keychain) || !keychain_name(account) {
                return Err(KEY_MISSING);
            }
            crate::keychain::read(keychain, account).ok_or(KEY_MISSING)?
        }
    };
    let trimmed = found.trim_end_matches(['\r', '\n']);
    if key_shaped(trimmed) {
        Ok(trimmed.to_owned())
    } else {
        Err(KEY_MISSING)
    }
}

// ─── The body's allow-list (4.2) ───────────────────────────────────────────────

type Checked = Result<(), &'static str>;

fn refuse() -> Checked {
    Err(BODY_REFUSED)
}

fn object(value: &Value) -> Result<&Map<String, Value>, &'static str> {
    value.as_object().ok_or(BODY_REFUSED)
}

/// Every key of `map` is one of `allowed`.
fn only(map: &Map<String, Value>, allowed: &[&str]) -> Checked {
    if map.keys().all(|key| allowed.contains(&key.as_str())) {
        Ok(())
    } else {
        refuse()
    }
}

fn string(value: Option<&Value>) -> Checked {
    match value {
        Some(Value::String(_)) => Ok(()),
        _ => refuse(),
    }
}

fn optional<F: Fn(&Value) -> Checked>(value: Option<&Value>, check: F) -> Checked {
    value.map_or(Ok(()), check)
}

fn number(value: &Value) -> Checked {
    if value.is_number() { Ok(()) } else { refuse() }
}

fn boolean(value: &Value) -> Checked {
    if value.is_boolean() { Ok(()) } else { refuse() }
}

fn strings(value: &Value) -> Checked {
    match value.as_array() {
        Some(items) if items.len() <= 16 && items.iter().all(Value::is_string) => Ok(()),
        _ => refuse(),
    }
}

/// `cache_control`, only as `{ "type": "ephemeral" }`.
fn cache_control(value: &Value) -> Checked {
    if *value == json!({ "type": "ephemeral" }) {
        Ok(())
    } else {
        refuse()
    }
}

fn array(value: &Value, max: usize) -> Result<&Vec<Value>, &'static str> {
    match value.as_array() {
        Some(items) if items.len() <= max => Ok(items),
        _ => Err(BODY_REFUSED),
    }
}

/// A JSON Schema the model is told a tool takes: an object, sent to the provider and fetched by no one.
fn schema(value: &Value) -> Checked {
    object(value).map(|_| ())
}

/// `max_tokens`: a whole number from 1 to [`OUTPUT_TOKENS_MAX`].
fn max_tokens(value: Option<&Value>) -> Checked {
    match value.and_then(Value::as_u64) {
        Some(tokens) if (1..=OUTPUT_TOKENS_MAX).contains(&tokens) => Ok(()),
        _ => refuse(),
    }
}

fn anthropic_text(block: &Map<String, Value>) -> Checked {
    only(block, &["type", "text", "cache_control"])?;
    string(block.get("text"))?;
    optional(block.get("cache_control"), cache_control)
}

/// A message's content block: text, a tool's use, or its result. No image, document, file, thinking, server
/// tool or MCP block.
fn anthropic_block(value: &Value) -> Checked {
    let block = object(value)?;
    match block.get("type").and_then(Value::as_str) {
        Some("text") => anthropic_text(block),
        Some("tool_use") => {
            only(block, &["type", "id", "name", "input", "cache_control"])?;
            string(block.get("id"))?;
            string(block.get("name"))?;
            object(block.get("input").ok_or(BODY_REFUSED)?)?;
            optional(block.get("cache_control"), cache_control)
        }
        Some("tool_result") => {
            only(
                block,
                &[
                    "type",
                    "tool_use_id",
                    "content",
                    "is_error",
                    "cache_control",
                ],
            )?;
            string(block.get("tool_use_id"))?;
            optional(block.get("is_error"), boolean)?;
            optional(block.get("cache_control"), cache_control)?;
            optional(block.get("content"), |content| match content {
                Value::String(_) => Ok(()),
                Value::Array(parts) => parts.iter().try_for_each(|part| {
                    let part = object(part)?;
                    if part.get("type").and_then(Value::as_str) != Some("text") {
                        return refuse();
                    }
                    anthropic_text(part)
                }),
                _ => refuse(),
            })
        }
        _ => refuse(),
    }
}

fn anthropic_content(value: &Value) -> Checked {
    match value {
        Value::String(_) => Ok(()),
        Value::Array(blocks) if blocks.len() <= 10_000 => {
            blocks.iter().try_for_each(anthropic_block)
        }
        _ => refuse(),
    }
}

/// TanStack's Anthropic adapter marks only the last tool, system block and message block for caching, and sends
/// `cache_control: null` on the others: removed here, where the allow-list will see them, as if never sent. Any
/// other value is the allow-list's to judge.
fn drop_null_cache_control(body: &mut Map<String, Value>) {
    fn strip(value: &mut Value) {
        if let Value::Object(map) = value
            && map.get("cache_control").is_some_and(Value::is_null)
        {
            map.remove("cache_control");
        }
    }
    for key in ["tools", "system"] {
        if let Some(Value::Array(items)) = body.get_mut(key) {
            items.iter_mut().for_each(strip);
        }
    }
    if let Some(Value::Array(messages)) = body.get_mut("messages") {
        for message in messages {
            if let Some(Value::Array(blocks)) = message.get_mut("content") {
                for block in blocks {
                    strip(block);
                    if let Some(Value::Array(parts)) = block.get_mut("content") {
                        parts.iter_mut().for_each(strip);
                    }
                }
            }
        }
    }
}

/// Anthropic's Messages API, as TanStack's adapter sends it.
fn anthropic_body(body: &Map<String, Value>) -> Checked {
    only(
        body,
        &[
            "model",
            "messages",
            "system",
            "max_tokens",
            "temperature",
            "top_p",
            "stop_sequences",
            "stream",
            "tools",
            "tool_choice",
        ],
    )?;
    max_tokens(body.get("max_tokens"))?;
    optional(body.get("temperature"), number)?;
    optional(body.get("top_p"), number)?;
    optional(body.get("stream"), boolean)?;
    optional(body.get("stop_sequences"), strings)?;
    for message in array(body.get("messages").ok_or(BODY_REFUSED)?, 100_000)? {
        let message = object(message)?;
        only(message, &["role", "content"])?;
        if !matches!(
            message.get("role").and_then(Value::as_str),
            Some("user" | "assistant")
        ) {
            return refuse();
        }
        anthropic_content(message.get("content").ok_or(BODY_REFUSED)?)?;
    }
    optional(body.get("system"), |system| match system {
        Value::String(_) => Ok(()),
        Value::Array(blocks) => blocks.iter().try_for_each(|block| {
            let block = object(block)?;
            if block.get("type").and_then(Value::as_str) != Some("text") {
                return refuse();
            }
            anthropic_text(block)
        }),
        _ => refuse(),
    })?;
    // Function tools alone: a name, a description and an input schema, with no `type` or `type: "custom"`. A
    // provider-side tool (web search, code execution, a computer, a text editor) has another `type`.
    optional(body.get("tools"), |tools| {
        array(tools, 512)?.iter().try_for_each(|tool| {
            let tool = object(tool)?;
            only(
                tool,
                &[
                    "name",
                    "description",
                    "input_schema",
                    "type",
                    "cache_control",
                ],
            )?;
            string(tool.get("name"))?;
            optional(tool.get("description"), |text| string(Some(text)))?;
            schema(tool.get("input_schema").ok_or(BODY_REFUSED)?)?;
            optional(tool.get("type"), |kind| {
                if kind == "custom" { Ok(()) } else { refuse() }
            })?;
            optional(tool.get("cache_control"), cache_control)
        })
    })?;
    optional(body.get("tool_choice"), |choice| {
        let choice = object(choice)?;
        only(choice, &["type", "name", "disable_parallel_tool_use"])?;
        optional(choice.get("disable_parallel_tool_use"), boolean)?;
        match choice.get("type").and_then(Value::as_str) {
            Some("auto" | "any" | "none") if !choice.contains_key("name") => Ok(()),
            Some("tool") => string(choice.get("name")),
            _ => refuse(),
        }
    })
}

/// A Chat Completions message's content: a string, or text parts alone (no image, audio or file part).
fn openai_content(value: &Value, nullable: bool) -> Checked {
    match value {
        Value::Null if nullable => Ok(()),
        Value::String(_) => Ok(()),
        Value::Array(parts) if parts.len() <= 10_000 => parts.iter().try_for_each(|part| {
            let part = object(part)?;
            only(part, &["type", "text"])?;
            if part.get("type").and_then(Value::as_str) != Some("text") {
                return refuse();
            }
            string(part.get("text"))
        }),
        _ => refuse(),
    }
}

/// The Chat Completions API, for `openai` and `openai-compatible`, as TanStack's adapter sends it.
fn openai_body(body: &Map<String, Value>) -> Checked {
    only(
        body,
        &[
            "model",
            "messages",
            "max_tokens",
            "temperature",
            "top_p",
            "stop",
            "stream",
            "stream_options",
            "tools",
            "tool_choice",
            "parallel_tool_calls",
            "prompt_cache_key",
        ],
    )?;
    max_tokens(body.get("max_tokens"))?;
    optional(body.get("temperature"), number)?;
    optional(body.get("top_p"), number)?;
    optional(body.get("stream"), boolean)?;
    optional(body.get("parallel_tool_calls"), boolean)?;
    optional(body.get("stop"), |stop| match stop {
        Value::String(_) => Ok(()),
        other => strings(other),
    })?;
    optional(body.get("stream_options"), |options| {
        let options = object(options)?;
        only(options, &["include_usage"])?;
        optional(options.get("include_usage"), boolean)
    })?;
    // A cache hint, the session's id: short, and only what the provider is already sent.
    optional(body.get("prompt_cache_key"), |key| match key.as_str() {
        Some(text) if text.len() <= 64 => Ok(()),
        _ => refuse(),
    })?;
    for message in array(body.get("messages").ok_or(BODY_REFUSED)?, 100_000)? {
        let message = object(message)?;
        let content = message.get("content");
        match message.get("role").and_then(Value::as_str) {
            Some("system" | "developer" | "user") => {
                only(message, &["role", "content", "name"])?;
                openai_content(content.ok_or(BODY_REFUSED)?, false)?;
            }
            Some("assistant") => {
                only(
                    message,
                    &["role", "content", "name", "tool_calls", "refusal"],
                )?;
                optional(content, |content| openai_content(content, true))?;
                optional(message.get("refusal"), |refusal| match refusal {
                    Value::Null | Value::String(_) => Ok(()),
                    _ => refuse(),
                })?;
                optional(message.get("tool_calls"), |calls| {
                    array(calls, 512)?.iter().try_for_each(|call| {
                        let call = object(call)?;
                        only(call, &["id", "type", "function"])?;
                        string(call.get("id"))?;
                        if call.get("type").and_then(Value::as_str) != Some("function") {
                            return refuse();
                        }
                        let function = object(call.get("function").ok_or(BODY_REFUSED)?)?;
                        only(function, &["name", "arguments"])?;
                        string(function.get("name"))?;
                        string(function.get("arguments"))
                    })
                })?;
            }
            Some("tool") => {
                only(message, &["role", "content", "tool_call_id"])?;
                string(message.get("tool_call_id"))?;
                openai_content(content.ok_or(BODY_REFUSED)?, false)?;
            }
            _ => return refuse(),
        }
        optional(message.get("name"), |name| string(Some(name)))?;
    }
    // Function tools alone: a name, a description, its parameters and `strict`.
    optional(body.get("tools"), |tools| {
        array(tools, 512)?.iter().try_for_each(|tool| {
            let tool = object(tool)?;
            only(tool, &["type", "function"])?;
            if tool.get("type").and_then(Value::as_str) != Some("function") {
                return refuse();
            }
            let function = object(tool.get("function").ok_or(BODY_REFUSED)?)?;
            only(function, &["name", "description", "parameters", "strict"])?;
            string(function.get("name"))?;
            optional(function.get("description"), |text| string(Some(text)))?;
            optional(function.get("parameters"), schema)?;
            optional(function.get("strict"), boolean)
        })
    })?;
    optional(body.get("tool_choice"), |choice| match choice {
        Value::String(text) if matches!(text.as_str(), "auto" | "none" | "required") => Ok(()),
        Value::Object(choice) => {
            only(choice, &["type", "function"])?;
            if choice.get("type").and_then(Value::as_str) != Some("function") {
                return refuse();
            }
            let function = object(choice.get("function").ok_or(BODY_REFUSED)?)?;
            only(function, &["name"])?;
            string(function.get("name"))
        }
        _ => refuse(),
    })
}

/// The body to send: `body` checked against `kind`'s allow-list, with `model` set to the configured one, or
/// `MODEL_BODY_REFUSED`. Nothing of a refused body is kept.
pub fn checked_body(kind: Kind, model: &str, body: Value) -> Result<Vec<u8>, &'static str> {
    let Value::Object(mut map) = body else {
        return Err(BODY_REFUSED);
    };
    match kind {
        Kind::Anthropic => {
            drop_null_cache_control(&mut map);
            anthropic_body(&map)?;
        }
        Kind::Openai | Kind::OpenaiCompatible => openai_body(&map)?,
    }
    map.insert("model".into(), Value::String(model.to_owned()));
    // Streamed, and for the Chat Completions kinds with its usage: the turn's token limits are counted from the
    // stream's usage (4.4), which the runtime cannot then turn off.
    map.insert("stream".into(), Value::Bool(true));
    if kind != Kind::Anthropic {
        map.insert("stream_options".into(), json!({ "include_usage": true }));
    }
    let encoded = serde_json::to_vec(&Value::Object(map)).map_err(|_| BODY_REFUSED)?;
    if encoded.len() > BODY_MAX {
        return Err(BODY_REFUSED);
    }
    Ok(encoded)
}

// ─── The request and its stream ─────────────────────────────────────────────────

/// Where the answer goes: one statement per event in the main webview (`event_script`).
pub type Emit = Arc<dyn Fn(Value) + Send + Sync>;

/// The statement that delivers one `loam:model` event, its detail one JSON literal (`notify::literal`).
pub fn event_script(detail: &Value) -> String {
    format!(
        "window.dispatchEvent(new CustomEvent('{EVENT}',{{detail:{}}}))",
        crate::notify::literal(detail)
    )
}

/// A request's URL, and its headers but `Content-Type`.
pub type RequestParts = (String, Vec<(&'static str, String)>);

/// The request for `provider`: its URL, and its headers but `Content-Type`, which `send` sets.
pub fn request_parts(provider: &Provider, key: Option<&str>) -> Result<RequestParts, &'static str> {
    Ok(match provider.kind {
        Kind::Anthropic => (
            ANTHROPIC_URL.to_owned(),
            vec![
                ("x-api-key", key.ok_or(KEY_MISSING)?.to_owned()),
                ("anthropic-version", ANTHROPIC_VERSION.to_owned()),
            ],
        ),
        Kind::Openai => (
            OPENAI_URL.to_owned(),
            vec![(
                "authorization",
                format!("Bearer {}", key.ok_or(KEY_MISSING)?),
            )],
        ),
        Kind::OpenaiCompatible => {
            let endpoint = provider.endpoint.as_deref().ok_or(MODELS_INVALID)?;
            if !endpoint_allowed(endpoint) {
                return Err(MODELS_INVALID);
            }
            (
                format!("{}/chat/completions", endpoint.trim_end_matches('/')),
                key.map(|key| vec![("authorization", format!("Bearer {key}"))])
                    .unwrap_or_default(),
            )
        }
    })
}

/// The largest stream id a page may name: JavaScript's safe integers.
pub const STREAM_ID_MAX: u64 = (1 << 53) - 1;

/// Each open stream: running, or held while its key is read.
enum Slot {
    Reserved,
    Running(AbortHandle),
}

/// Every provider `models.json` lists, and the streams the webview holds open.
///
/// Kept as a process singleton whose provider list lives behind an `RwLock` so managed-mode reloads
/// and setup mutations can update providers in place without dropping active, cancelable model
/// streams (phase 5 no-terminal amendment, 9.2).
pub struct Models {
    providers: std::sync::RwLock<Result<Vec<Provider>, &'static str>>,
    client: Option<reqwest::Client>,
    streams: Arc<Mutex<HashMap<u64, Slot>>>,
    /// Moved by every page load: a stream of an earlier page neither starts nor emits.
    epoch: Arc<AtomicU64>,
}

impl Models {
    pub fn new(providers: Result<Vec<Provider>, &'static str>) -> Self {
        // No redirect, no proxy, as 10.4's mounts: the request goes to the URL built here and nowhere else.
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .connect_timeout(CONNECT_TIMEOUT)
            .build()
            .ok();
        Self {
            providers: std::sync::RwLock::new(providers),
            client,
            streams: Arc::default(),
            epoch: Arc::default(),
        }
    }

    /// Replaces the provider configuration in place without disturbing active streams or the page
    /// epoch (amendment 9.2). Subsequent [`Models::send`] calls observe the new configuration.
    pub fn update_providers(&self, providers: Result<Vec<Provider>, &'static str>) {
        *self
            .providers
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = providers;
    }

    /// The main webview began loading a page: every stream of the page it leaves goes silent at once, and is
    /// cancelled by [`Models::cancel_all`].
    pub fn leave_page(&self) {
        self.epoch.fetch_add(1, Ordering::SeqCst);
    }

    /// `model_send`: `stream`, the id the page chose and listens on, at once, or a code; the answer follows as
    /// events through `emit`. The page names the id, so it hears every event of it, the first included.
    pub async fn send(
        &self,
        provider: &str,
        body: Value,
        stream: u64,
        emit: Emit,
    ) -> Result<u64, &'static str> {
        let provider = {
            let guard = self
                .providers
                .read()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let providers = guard.as_ref().map_err(|code| *code)?;
            providers
                .iter()
                .find(|entry| entry.id == provider)
                .ok_or(PROVIDER_UNKNOWN)?
                .clone()
        };
        // Before the body is checked: the IPC layer has parsed it already, so this bounds only what is kept.
        if serde_json::to_vec(&body).map_or(true, |bytes| bytes.len() > BODY_MAX) {
            return Err(BODY_REFUSED);
        }
        let encoded = checked_body(provider.kind, &provider.model, body)?;
        if stream == 0 || stream > STREAM_ID_MAX {
            return Err(BODY_REFUSED);
        }
        let epoch = self.epoch.load(Ordering::SeqCst);
        // The slot is held from here, through the key's lookup, so the bound counts it and a page load meets it.
        {
            let mut streams = self.streams.lock().await;
            if streams.len() >= STREAMS_MAX || streams.contains_key(&stream) {
                return Err(STREAM_LIMIT);
            }
            streams.insert(stream, Slot::Reserved);
        }
        let release = |streams: &mut HashMap<u64, Slot>| {
            if matches!(streams.get(&stream), Some(Slot::Reserved)) {
                streams.remove(&stream);
            }
        };
        // The key, read now: a key set after Loam started is used, and one removed is not.
        let key = match provider.key.clone() {
            None => Ok(None),
            Some(reference) => tokio::task::spawn_blocking(move || resolve_key(&reference))
                .await
                .map_err(|_| KEY_MISSING)
                .and_then(|found| found.map(Some)),
        };
        let parts = key
            .as_ref()
            .map_err(|code| *code)
            .and_then(|key| request_parts(&provider, key.as_deref()));
        let client = self.client.clone().ok_or(UNREACHABLE);
        let mut streams = self.streams.lock().await;
        let (url, headers) = match parts {
            Ok(parts) => parts,
            Err(code) => {
                release(&mut streams);
                return Err(code);
            }
        };
        let client = match client {
            Ok(client) => client,
            Err(code) => {
                release(&mut streams);
                return Err(code);
            }
        };
        // The page left while the key was read, or cancelled the stream: nothing is sent.
        if self.epoch.load(Ordering::SeqCst) != epoch
            || !matches!(streams.get(&stream), Some(Slot::Reserved))
        {
            release(&mut streams);
            return Err(UNREACHABLE);
        }
        let secret = key.ok().flatten();
        let mut request = client
            .post(url)
            .header("content-type", "application/json")
            .body(encoded);
        for (name, value) in headers {
            request = request.header(name, value);
        }
        let held = self.streams.clone();
        let current = self.epoch.clone();
        // Silent once the page that asked has gone.
        let emit: Emit = Arc::new(move |event| {
            if current.load(Ordering::SeqCst) == epoch {
                emit(event);
            }
        });
        let task = tokio::spawn(async move {
            run(stream, request, &emit, secret.as_deref()).await;
            held.lock().await.remove(&stream);
        });
        streams.insert(stream, Slot::Running(task.abort_handle()));
        Ok(stream)
    }

    /// `model_cancel`: the request is dropped, and nothing more of it arrives.
    pub async fn cancel(&self, stream: u64) {
        if let Some(Slot::Running(task)) = self.streams.lock().await.remove(&stream) {
            task.abort();
        }
    }

    /// Every stream, when the app exits or the main webview loads a page: a page's streams are its own.
    pub async fn cancel_all(&self) {
        for (_, slot) in self.streams.lock().await.drain() {
            if let Slot::Running(task) = slot {
                task.abort();
            }
        }
    }
}

/// Valid UTF-8 from the front of `bytes`, leaving an incomplete character at its end for the next chunk.
fn take_text(bytes: &mut Vec<u8>) -> String {
    let valid = match std::str::from_utf8(bytes) {
        Ok(_) => bytes.len(),
        Err(error) => match error.error_len() {
            // An incomplete character at the end: kept for the next chunk.
            None => error.valid_up_to(),
            // An invalid sequence: it is replaced, as a lossy decode would.
            Some(_) => bytes.len(),
        },
    };
    let rest = bytes.split_off(valid);
    let text = String::from_utf8_lossy(bytes).into_owned();
    *bytes = rest;
    text
}

fn emit_text(stream: u64, text: &str, emit: &Emit) {
    let mut start = 0;
    while start < text.len() {
        let mut end = (start + EVENT_TEXT_MAX).min(text.len());
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        emit(json!({ "stream": stream, "chunk": &text[start..end] }));
        start = end;
    }
}

/// One request: `{ stream, status }` when its headers arrive, `{ stream, chunk }` for its text, and one
/// `{ stream, done, status, code? }` at its end. A refusal (`4xx`, `5xx`) ends with its status and code alone.
/// The text that replaces the key in a stream that quotes it.
pub const KEY_REMOVED: &str = "[key removed]";

/// A stream's text with the key removed: text is held back until no key can be split across what is emitted and
/// what comes next.
///
/// Each clean piece is emitted one step late, and the last joined to the tail, so the final chunk is not the tail
/// alone. This does not hide the key's length from a reader of every chunk: where each piece is cut is the end of a
/// network chunk less the tail. The standard providers' key lengths are public, which is why that is accepted. The key is matched as written and as JSON may escape it (`\/`, and `<`, `>` and `&` as `\u` sequences),
/// which a key's allowed characters can need.
struct Redactor {
    forms: Vec<String>,
    held: String,
    ready: String,
}

impl Redactor {
    fn new(key: Option<&str>) -> Self {
        let mut forms = Vec::new();
        if let Some(key) = key {
            let slashed = key.replace('/', "\\/");
            let unicode = |text: &str| {
                text.replace('<', "\\u003c")
                    .replace('>', "\\u003e")
                    .replace('&', "\\u0026")
            };
            for form in [key.to_owned(), unicode(key), unicode(&slashed), slashed] {
                if !forms.contains(&form) {
                    forms.push(form);
                }
            }
            // The longest first, so a shorter form inside a longer one is not cut first.
            forms.sort_by_key(|form| std::cmp::Reverse(form.len()));
        }
        Self {
            forms,
            held: String::new(),
            ready: String::new(),
        }
    }

    fn clean(&self, text: &str) -> String {
        self.forms.iter().fold(text.to_owned(), |text, form| {
            text.replace(form.as_str(), KEY_REMOVED)
        })
    }

    /// What may be emitted now: the clean piece before this one, while `text` waits to be matched against what follows.
    /// With no key there is nothing to match, and `text` goes at once.
    fn take(&mut self, text: &str) -> String {
        self.held.push_str(text);
        if self.forms.is_empty() {
            return std::mem::take(&mut self.held);
        }
        let longest = self.forms.first().map_or(0, String::len);
        let clean = self.clean(&self.held);
        // Keep the last `longest - 1` bytes: the start of a key the next text may complete.
        let mut keep = clean.len().saturating_sub(longest.saturating_sub(1));
        while !clean.is_char_boundary(keep) {
            keep -= 1;
        }
        self.held = clean[keep..].to_owned();
        // Nothing new to emit (an empty chunk, such as HTTP/2's closing frame, or half a character): the piece held
        // stays held, so the stream still ends on it joined to the tail.
        if keep == 0 {
            return String::new();
        }
        std::mem::replace(&mut self.ready, clean[..keep].to_owned())
    }

    /// The rest, with `text`, the stream's last undecoded bytes: the last clean piece and the tail, as one.
    fn finish(&mut self, text: &str) -> String {
        self.held.push_str(text);
        let held = std::mem::take(&mut self.held);
        let tail = self.clean(&held);
        std::mem::take(&mut self.ready) + &tail
    }
}

async fn run(stream: u64, request: reqwest::RequestBuilder, emit: &Emit, key: Option<&str>) {
    let done = |status: u16, code: Option<&str>| {
        let mut detail = json!({ "stream": stream, "done": true, "status": status });
        if let Some(code) = code {
            detail["code"] = json!(code);
        }
        emit(detail);
    };
    let outcome = tokio::time::timeout(STREAM_TIME, async {
        let response = match request.send().await {
            Ok(response) => response,
            Err(_) => return (502, Some(UNREACHABLE)),
        };
        let status = response.status().as_u16();
        emit(json!({ "stream": stream, "status": status }));
        // A refusal's body is not passed on: a provider's 401 can quote part of the key (OpenAI's names its first
        // and last characters), and a local server may quote more. Its status and code say enough.
        if !(200..=299).contains(&status) {
            drop(response);
            let code = if (400..=499).contains(&status) {
                REFUSED
            } else {
                UNREACHABLE
            };
            return (status, Some(code));
        }
        let mut body = response.bytes_stream();
        let mut total = 0usize;
        let mut pending = Vec::new();
        let mut redactor = Redactor::new(key);
        while let Some(chunk) = body.next().await {
            let Ok(chunk) = chunk else {
                return (status, Some(UNREACHABLE));
            };
            total += chunk.len();
            if total > STREAM_MAX {
                return (status, Some(STREAM_LIMIT));
            }
            pending.extend_from_slice(&chunk);
            emit_text(stream, &redactor.take(&take_text(&mut pending)), emit);
        }
        // One last chunk: the last clean piece joined to the tail, never the tail alone.
        emit_text(
            stream,
            &redactor.finish(&String::from_utf8_lossy(&pending)),
            emit,
        );
        (status, None)
    })
    .await;
    match outcome {
        Ok((status, code)) => done(status, code),
        Err(_) => done(504, Some(STREAM_LIMIT)),
    }
}

#[cfg(test)]
#[path = "models_tests.rs"]
mod tests;
