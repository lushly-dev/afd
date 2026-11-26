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
use serde::Deserialize;
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

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum Kind {
    Anthropic,
    Openai,
    OpenaiCompatible,
}

/// Where a key is kept: never the key itself.
#[derive(Deserialize, Clone, Debug)]
#[serde(untagged)]
pub enum KeyRef {
    Keychain(KeychainRef),
    File(FileRef),
}

#[derive(Deserialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct KeychainRef {
    pub keychain: String,
    pub account: String,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct FileRef {
    pub file: PathBuf,
}

/// One provider of `models.json`, as `deployment write --models-out` writes it.
#[derive(Deserialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct Provider {
    pub id: String,
    pub kind: Kind,
    pub model: String,
    pub endpoint: Option<String>,
    pub key: Option<KeyRef>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct File {
    providers: Vec<Provider>,
}

fn identifier(value: &str) -> bool {
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

fn keychain_name(value: &str) -> bool {
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
        if !seen.insert(provider.id.as_str())
            || !identifier(&provider.id)
            || !model_id(&provider.model)
            || !key_valid
            || !endpoint_valid
        {
            return Err(MODELS_INVALID);
        }
    }
    Ok(file.providers)
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
pub struct Models {
    providers: Result<Vec<Provider>, &'static str>,
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
            providers,
            client,
            streams: Arc::default(),
            epoch: Arc::default(),
        }
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
        let providers = self.providers.as_ref().map_err(|code| *code)?;
        let provider = providers
            .iter()
            .find(|entry| entry.id == provider)
            .ok_or(PROVIDER_UNKNOWN)?
            .clone();
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
mod tests {
    use super::*;

    fn anthropic() -> Value {
        // As TanStack's Anthropic adapter sent it, captured for step 2: cache hints, a custom tool, a tool round.
        json!({
            "model": "m-1",
            "max_tokens": 100,
            "messages": [
                { "role": "user", "content": "earlier" },
                { "role": "assistant", "content": [{ "type": "text", "text": "ok" }] },
                { "role": "user", "content": "hi" },
                { "role": "assistant", "content": [{ "type": "tool_use", "id": "tu1", "name": "note-list", "input": { "limit": 2 } }] },
                { "role": "user", "content": [{ "type": "tool_result", "tool_use_id": "tu1", "content": "two notes", "cache_control": { "type": "ephemeral" } }] }
            ],
            "system": [{ "type": "text", "text": "SYS", "cache_control": { "type": "ephemeral" } }],
            "tools": [{
                "name": "note-list", "type": "custom", "description": "Lists",
                "input_schema": { "type": "object", "properties": { "limit": { "type": "number" } }, "required": null },
                "cache_control": { "type": "ephemeral" }
            }],
            "stream": true
        })
    }

    fn openai() -> Value {
        // As TanStack's Chat Completions adapter sent it, captured for step 2.
        json!({
            "prompt_cache_key": "cps_0123456789abcdef",
            "max_tokens": 100,
            "model": "m-1",
            "messages": [
                { "role": "system", "content": "SYS" },
                { "role": "user", "content": "hi" },
                { "role": "assistant", "content": null, "tool_calls": [{ "id": "call1", "type": "function", "function": { "name": "note-list", "arguments": "{\"limit\":2}" } }] },
                { "role": "tool", "tool_call_id": "call1", "content": "two notes" }
            ],
            "tools": [{ "type": "function", "function": {
                "name": "note-list", "description": "Lists",
                "parameters": { "type": "object", "properties": { "limit": { "type": ["number", "null"] } }, "required": ["limit"], "additionalProperties": false },
                "strict": true
            } }],
            "stream": true,
            "stream_options": { "include_usage": true }
        })
    }

    fn sent(kind: Kind, body: Value) -> Result<Value, &'static str> {
        checked_body(kind, "configured-model", body)
            .map(|bytes| serde_json::from_slice(&bytes).unwrap())
    }

    #[test]
    fn p5_a3_the_adapters_bodies_pass_with_the_configured_model_set() {
        let body = sent(Kind::Anthropic, anthropic()).unwrap();
        assert_eq!(body["model"], "configured-model");
        assert_eq!(body["messages"], anthropic()["messages"]);
        for kind in [Kind::Openai, Kind::OpenaiCompatible] {
            assert_eq!(sent(kind, openai()).unwrap()["model"], "configured-model");
        }
        // A body naming another model, or none, gets the configured one.
        let mut other = anthropic();
        other.as_object_mut().unwrap().remove("model");
        assert_eq!(
            sent(Kind::Anthropic, other).unwrap()["model"],
            "configured-model"
        );
    }

    fn with(mut body: Value, pointer: &str, value: Value) -> Value {
        let (parent, key) = pointer.rsplit_once('/').unwrap();
        let target = if parent.is_empty() {
            &mut body
        } else {
            body.pointer_mut(parent).unwrap()
        };
        match target {
            Value::Object(map) => {
                map.insert(key.to_owned(), value);
            }
            Value::Array(items) => items.push(value),
            _ => panic!("{pointer}"),
        }
        body
    }

    #[test]
    fn p5_a3_anthropic_refuses_provider_tools_mcp_servers_urls_unlisted_keys_and_other_cache_control()
     {
        let refused = [
            with(
                anthropic(),
                "/tools/x",
                json!({ "type": "web_search_20250305", "name": "web_search" }),
            ),
            with(
                anthropic(),
                "/tools/x",
                json!({ "type": "code_execution_20250522", "name": "code_execution" }),
            ),
            with(
                anthropic(),
                "/tools/x",
                json!({ "type": "computer_20250124", "name": "computer", "display_width_px": 1, "display_height_px": 1 }),
            ),
            with(
                anthropic(),
                "/mcp_servers",
                json!([{ "type": "url", "url": "https://evil.example/mcp", "name": "x" }]),
            ),
            with(anthropic(), "/container", json!("container_1")),
            with(anthropic(), "/metadata", json!({ "user_id": "x" })),
            with(
                anthropic(),
                "/thinking",
                json!({ "type": "enabled", "budget_tokens": 1024 }),
            ),
            with(anthropic(), "/top_k", json!(5)),
            with(
                anthropic(),
                "/system/0/cache_control",
                json!({ "type": "ephemeral", "ttl": "1h" }),
            ),
            with(
                anthropic(),
                "/tools/0/cache_control",
                json!({ "type": "persistent" }),
            ),
            with(
                anthropic(),
                "/messages/1/content/x",
                json!({ "type": "image", "source": { "type": "url", "url": "https://evil.example/a.png" } }),
            ),
            with(
                anthropic(),
                "/messages/1/content/x",
                json!({ "type": "document", "source": { "type": "url", "url": "https://evil.example/a.pdf" } }),
            ),
            with(
                anthropic(),
                "/messages/1/content/x",
                json!({ "type": "container_upload", "file_id": "f" }),
            ),
            with(anthropic(), "/messages/0/role", json!("system")),
            with(anthropic(), "/tools/0/type", json!("bash_20250124")),
            with(anthropic(), "/max_tokens", json!(OUTPUT_TOKENS_MAX + 1)),
            with(anthropic(), "/max_tokens", json!("100")),
            with(
                anthropic(),
                "/tool_choice",
                json!({ "type": "auto", "name": "x" }),
            ),
        ];
        for body in refused {
            assert_eq!(
                sent(Kind::Anthropic, body.clone()).err(),
                Some(BODY_REFUSED),
                "{body}"
            );
        }
        let mut missing = anthropic();
        missing.as_object_mut().unwrap().remove("max_tokens");
        assert_eq!(sent(Kind::Anthropic, missing).err(), Some(BODY_REFUSED));
        // `type: "custom"` and a tool with no type at all are function tools, allowed.
        let mut untyped = anthropic();
        untyped["tools"][0].as_object_mut().unwrap().remove("type");
        assert!(sent(Kind::Anthropic, untyped).is_ok());
        assert!(sent(Kind::Anthropic, json!([anthropic()])).is_err());
    }

    #[test]
    fn p5_a3_chat_completions_refuses_web_search_audio_files_and_unlisted_keys() {
        let refused = [
            with(openai(), "/web_search_options", json!({})),
            with(
                openai(),
                "/audio",
                json!({ "voice": "alloy", "format": "wav" }),
            ),
            with(openai(), "/modalities", json!(["text", "audio"])),
            with(
                openai(),
                "/response_format",
                json!({ "type": "json_object" }),
            ),
            with(openai(), "/user", json!("someone")),
            with(openai(), "/store", json!(true)),
            with(openai(), "/n", json!(2)),
            with(openai(), "/prompt_cache_key", json!("x".repeat(65))),
            with(
                openai(),
                "/messages/x",
                json!({ "role": "user", "content": [{ "type": "image_url", "image_url": { "url": "https://evil.example/a.png" } }] }),
            ),
            with(
                openai(),
                "/messages/x",
                json!({ "role": "user", "content": [{ "type": "file", "file": { "file_id": "f" } }] }),
            ),
            with(
                openai(),
                "/tools/x",
                json!({ "type": "web_search_preview" }),
            ),
            with(openai(), "/tools/0/function/x", json!("unlisted")),
            with(openai(), "/messages/0/role", json!("function")),
            with(openai(), "/max_completion_tokens", json!(10)),
        ];
        for body in refused {
            assert_eq!(
                sent(Kind::Openai, body.clone()).err(),
                Some(BODY_REFUSED),
                "{body}"
            );
        }
    }

    #[test]
    fn p5_a3_each_kind_builds_its_own_request_with_its_key_header_alone() {
        let provider = |kind, endpoint: Option<&str>| Provider {
            id: "p".into(),
            kind,
            model: "m".into(),
            endpoint: endpoint.map(str::to_owned),
            key: None,
        };
        let (url, headers) = request_parts(&provider(Kind::Anthropic, None), Some("k")).unwrap();
        assert_eq!(url, ANTHROPIC_URL);
        assert_eq!(
            headers,
            vec![
                ("x-api-key", "k".to_owned()),
                ("anthropic-version", ANTHROPIC_VERSION.to_owned())
            ]
        );
        let (url, headers) = request_parts(&provider(Kind::Openai, None), Some("k")).unwrap();
        assert_eq!(url, OPENAI_URL);
        assert_eq!(headers, vec![("authorization", "Bearer k".to_owned())]);
        let local = provider(Kind::OpenaiCompatible, Some("http://127.0.0.1:11434/v1/"));
        let (url, headers) = request_parts(&local, None).unwrap();
        assert_eq!(url, "http://127.0.0.1:11434/v1/chat/completions");
        assert!(headers.is_empty());
        assert_eq!(
            request_parts(&provider(Kind::Anthropic, None), None).err(),
            Some(KEY_MISSING)
        );
        let elsewhere = provider(Kind::OpenaiCompatible, Some("http://10.0.0.1/v1"));
        assert_eq!(request_parts(&elsewhere, None).err(), Some(MODELS_INVALID));
    }

    #[test]
    fn an_endpoint_is_https_or_loopback_http() {
        for allowed in [
            "https://models.example.com/v1",
            "http://127.0.0.1:11434/v1",
            "http://[::1]:8080/v1",
        ] {
            assert!(endpoint_allowed(allowed), "{allowed}");
        }
        for refused in [
            "http://localhost:11434/v1",
            "http://10.0.0.1/v1",
            "https://user:pass@example.com/v1",
            "https://example.com/v1?x=1",
            "https://example.com/v1#x",
            "file:///etc/passwd",
            "ftp://127.0.0.1/",
        ] {
            assert!(!endpoint_allowed(refused), "{refused}");
        }
    }

    #[test]
    fn text_is_split_on_character_boundaries_and_an_incomplete_one_waits() {
        let mut bytes = "héllo".as_bytes().to_vec();
        let tail = bytes.split_off(2);
        let mut pending = bytes;
        assert_eq!(take_text(&mut pending), "h");
        pending.extend_from_slice(&tail);
        assert_eq!(take_text(&mut pending), "éllo");
        assert!(pending.is_empty());
    }

    #[test]
    fn a_key_is_shaped_as_one() {
        assert!(key_shaped("sk-ant-api03-abcdefgh"));
        for refused in [
            "short",
            "has space here",
            "quote\"inside",
            "back\\slash1",
            "new\nline12",
        ] {
            assert!(!key_shaped(refused), "{refused:?}");
        }
    }

    #[cfg(unix)]
    fn restrict(path: &Path) {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).unwrap();
    }

    #[cfg(windows)]
    fn restrict(path: &Path) {
        let system = Path::new(&std::env::var_os("SystemRoot").unwrap()).join("System32");
        let user = std::process::Command::new(system.join("whoami.exe"))
            .args(["/user", "/fo", "csv", "/nh"])
            .output()
            .unwrap();
        let sid = String::from_utf8(user.stdout)
            .unwrap()
            .trim()
            .rsplit(',')
            .next()
            .unwrap()
            .trim_matches('"')
            .to_owned();
        let icacls = system.join("icacls.exe");
        let reset = std::process::Command::new(&icacls)
            .arg(path)
            .arg("/reset")
            .stdout(std::process::Stdio::null())
            .status()
            .unwrap();
        assert!(reset.success());
        let status = std::process::Command::new(&icacls)
            .arg(path)
            .args(["/inheritance:r", "/grant:r"])
            .arg(format!("*{sid}:F"))
            .stdout(std::process::Stdio::null())
            .status()
            .unwrap();
        assert!(status.success());
        let owner = std::process::Command::new(&icacls)
            .arg(path)
            .args(["/setowner", &format!("*{sid}")])
            .stdout(std::process::Stdio::null())
            .status()
            .unwrap();
        assert!(owner.success());
    }

    #[test]
    fn p5_a3_models_json_is_read_strictly_and_refused_unless_owner_only() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("models.json");
        assert!(read(&path).unwrap().is_empty());
        let file = |text: &str| {
            let _ = std::fs::remove_file(&path);
            std::fs::write(&path, text).unwrap();
            restrict(&path);
            read(&path)
        };
        let good = r#"{"providers":[
            {"id":"claude","kind":"anthropic","model":"claude-sonnet-4-5","key":{"keychain":"loam-copilot","account":"claude"}},
            {"id":"local","kind":"openai-compatible","model":"llama3.1:8b","endpoint":"http://127.0.0.1:11434/v1"}
        ]}"#;
        assert_eq!(file(good).unwrap().len(), 2);
        for bad in [
            r#"{"providers":[{"id":"x","kind":"anthropic","model":"m"}]}"#,
            r#"{"providers":[{"id":"x","kind":"anthropic","model":"m","key":{"keychain":"a","account":"b"},"endpoint":"https://e.example"}]}"#,
            r#"{"providers":[{"id":"x","kind":"openai-compatible","model":"m","endpoint":"http://10.0.0.1/v1"}]}"#,
            r#"{"providers":[{"id":"x","kind":"openai","model":"m","key":{"file":"relative.key"}}]}"#,
            r#"{"providers":[{"id":"x","kind":"openai","model":"m","key":"sk-the-key-itself"}]}"#,
            r#"{"providers":[{"id":"x","kind":"test","model":"m"}]}"#,
            r#"{"providers":[],"extra":1}"#,
        ] {
            assert_eq!(file(bad).err(), Some(MODELS_INVALID), "{bad}");
        }
        // Readable by others: refused.
        let _ = std::fs::remove_file(&path);
        std::fs::write(&path, good).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        }
        assert_eq!(read(&path).err(), Some(PERMISSIONS));
    }

    #[test]
    fn p5_a3_a_key_file_must_be_owner_only_and_hold_a_key() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("k.key");
        std::fs::write(&path, "sk-a-file-key-0123\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        }
        let reference = KeyRef::File(FileRef { file: path.clone() });
        assert_eq!(resolve_key(&reference).err(), Some(PERMISSIONS));
        restrict(&path);
        assert_eq!(resolve_key(&reference).unwrap(), "sk-a-file-key-0123");
        let _ = std::fs::remove_file(&path);
        std::fs::write(&path, "two words").unwrap();
        restrict(&path);
        assert_eq!(resolve_key(&reference).err(), Some(KEY_MISSING));
        let absent = KeyRef::Keychain(KeychainRef {
            keychain: "loam-copilot-test-absent".into(),
            account: "nobody-0000".into(),
        });
        assert_eq!(resolve_key(&absent).err(), Some(KEY_MISSING));
    }

    #[tokio::test]
    async fn p5_a3_an_unknown_provider_a_refused_file_and_a_refused_body_send_nothing() {
        let sent = Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen = sent.clone();
        let emit: Emit = Arc::new(move |event| seen.lock().unwrap().push(event));
        let none = Models::new(Ok(Vec::new()));
        assert_eq!(
            none.send("claude", anthropic(), 7, emit.clone())
                .await
                .err(),
            Some(PROVIDER_UNKNOWN)
        );
        let refused = Models::new(Err(PERMISSIONS));
        assert_eq!(
            refused
                .send("claude", anthropic(), 7, emit.clone())
                .await
                .err(),
            Some(PERMISSIONS)
        );
        let keyless = Models::new(Ok(vec![Provider {
            id: "claude".into(),
            kind: Kind::Anthropic,
            model: "m".into(),
            endpoint: None,
            key: Some(KeyRef::Keychain(KeychainRef {
                keychain: "loam-copilot-test-absent".into(),
                account: "nobody-0000".into(),
            })),
        }]));
        assert_eq!(
            keyless
                .send(
                    "claude",
                    with(anthropic(), "/mcp_servers", json!([])),
                    7,
                    emit.clone()
                )
                .await
                .err(),
            Some(BODY_REFUSED)
        );
        assert_eq!(
            keyless
                .send("claude", anthropic(), 7, emit.clone())
                .await
                .err(),
            Some(KEY_MISSING)
        );
        // The slot held through the key's lookup was released: the id can be named again.
        assert_eq!(
            keyless.send("claude", anthropic(), 7, emit).await.err(),
            Some(KEY_MISSING)
        );
        assert!(sent.lock().unwrap().is_empty());
    }

    /// A provider on 127.0.0.1 that answers every request with `response`, raw.
    async fn provider_answering(response: &'static str) -> u16 {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                let mut buffer = vec![0u8; 65536];
                let _ = socket.read(&mut buffer).await;
                let _ = socket.write_all(response.as_bytes()).await;
                let _ = socket.shutdown().await;
            }
        });
        port
    }

    #[tokio::test]
    async fn p5_a3_a_refusal_passes_no_body_on_since_it_can_quote_the_key() {
        let port = provider_answering(
            "HTTP/1.1 401 Unauthorized\r\ncontent-type: application/json\r\nconnection: close\r\ncontent-length: 64\r\n\r\n{\"error\":\"Incorrect API key provided: sk-ab****************wxyz\"}",
        )
        .await;
        let events = Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen = events.clone();
        let emit: Emit = Arc::new(move |event| seen.lock().unwrap().push(event));
        let models = Models::new(Ok(vec![Provider {
            id: "local".into(),
            kind: Kind::OpenaiCompatible,
            model: "m".into(),
            endpoint: Some(format!("http://127.0.0.1:{port}/v1")),
            key: None,
        }]));
        let stream = models.send("local", openai(), 41, emit).await.unwrap();
        for _ in 0..200 {
            if events
                .lock()
                .unwrap()
                .iter()
                .any(|event| event["done"] == true)
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert_eq!(
            *events.lock().unwrap(),
            vec![
                json!({ "stream": stream, "status": 401 }),
                json!({ "stream": stream, "done": true, "status": 401, "code": REFUSED }),
            ]
        );
    }

    #[test]
    fn p5_a3_two_tools_from_the_anthropic_adapter_pass_its_null_cache_markers_dropped() {
        // As TanStack's adapter sends two tools: only the last is marked, the first carries `cache_control: null`.
        let mut body = anthropic();
        let first = json!({
            "name": "note-get", "type": "custom", "description": "Gets",
            "input_schema": { "type": "object", "properties": {} },
            "cache_control": null
        });
        body["tools"].as_array_mut().unwrap().insert(0, first);
        body["system"][0]["cache_control"] = Value::Null;
        body["messages"][1]["content"][0]["cache_control"] = Value::Null;
        let sent = sent(Kind::Anthropic, body).unwrap();
        assert!(sent["tools"][0].get("cache_control").is_none());
        assert_eq!(
            sent["tools"][1]["cache_control"],
            json!({ "type": "ephemeral" })
        );
        assert!(sent["system"][0].get("cache_control").is_none());
        // Any other value is still the allow-list's to refuse.
        assert_eq!(
            sent_err(with(
                anthropic(),
                "/tools/0/cache_control",
                json!({ "type": "other" })
            )),
            Some(BODY_REFUSED)
        );
    }

    fn sent_err(body: Value) -> Option<&'static str> {
        checked_body(Kind::Anthropic, "m", body).err()
    }

    #[test]
    fn p5_a3_every_request_streams_and_a_chat_completion_reports_its_usage() {
        let mut quiet = openai();
        quiet["stream"] = json!(false);
        quiet["stream_options"] = json!({ "include_usage": false });
        let sent = sent(Kind::OpenaiCompatible, quiet).unwrap();
        assert_eq!(sent["stream"], true);
        assert_eq!(sent["stream_options"], json!({ "include_usage": true }));
        let mut anthropic_quiet = anthropic();
        anthropic_quiet.as_object_mut().unwrap().remove("stream");
        let sent = super::checked_body(Kind::Anthropic, "m", anthropic_quiet)
            .map(|bytes| serde_json::from_slice::<Value>(&bytes).unwrap())
            .unwrap();
        assert_eq!(sent["stream"], true);
        assert!(sent.get("stream_options").is_none());
    }

    #[test]
    fn p5_a3_a_key_quoted_in_an_accepted_stream_is_removed_across_chunks() {
        let key = "sk-test-0123456789abcdef";
        let mut redactor = Redactor::new(Some(key));
        let mut out = String::new();
        // The key split across three chunks, and quoted twice.
        for part in [
            "data: {\"error\":\"bad sk-test-01",
            "23456789ab",
            "cdef\"} and sk-test-0123456789abcdef é",
        ] {
            out.push_str(&redactor.take(part));
        }
        out.push_str(&redactor.finish(""));
        assert!(!out.contains(key), "{out}");
        assert!(!out.contains("0123456789"), "{out}");
        assert_eq!(out.matches(KEY_REMOVED).count(), 2);
        assert!(out.ends_with(" é"));
        let mut plain = Redactor::new(None);
        let mut both = plain.take("as ");
        both.push_str(&plain.take("is"));
        both.push_str(&plain.finish(""));
        assert_eq!(both, "as is");
    }

    #[test]
    fn p5_a3_a_key_is_removed_as_json_may_escape_it_and_no_chunk_measures_it() {
        let key = "sk/test&0123456789<x>";
        let mut redactor = Redactor::new(Some(key));
        let mut chunks = Vec::new();
        for part in [
            "quoted sk\\/test\\u00260123456789\\u003cx\\u003e and ",
            "sk/test&0123456789<x>",
            " and sk\\/test&0123456789<x> done, with more text after it",
        ] {
            chunks.push(redactor.take(part));
        }
        // As `run` ends: `finish` with the stream's last undecoded bytes, which are none here.
        chunks.push(redactor.finish(""));
        let out = chunks.concat();
        assert!(!out.contains("0123456789"), "{out}");
        assert_eq!(out.matches(KEY_REMOVED).count(), 3);
        // The last chunk is the last clean piece and the tail together, not a tail the key's length long.
        assert_ne!(chunks.last().map(String::len), Some(key.len() - 1));
    }

    #[tokio::test]
    async fn p5_a3_a_page_names_its_stream_and_a_page_load_silences_it() {
        let port = provider_answering(
            "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\nconnection: close\r\ncontent-length: 14\r\n\r\ndata: [DONE]\n\n",
        )
        .await;
        let events = Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen = events.clone();
        let emit: Emit = Arc::new(move |event| seen.lock().unwrap().push(event));
        let local = |port: u16| Provider {
            id: "local".into(),
            kind: Kind::OpenaiCompatible,
            model: "m".into(),
            endpoint: Some(format!("http://127.0.0.1:{port}/v1")),
            key: None,
        };
        let models = Models::new(Ok(vec![local(port)]));
        // Ids out of JavaScript's safe integers, and zero, are refused.
        for id in [0, STREAM_ID_MAX + 1] {
            assert_eq!(
                models.send("local", openai(), id, emit.clone()).await.err(),
                Some(BODY_REFUSED)
            );
        }
        assert_eq!(
            models.send("local", openai(), 900, emit.clone()).await,
            Ok(900)
        );
        for _ in 0..200 {
            if events
                .lock()
                .unwrap()
                .iter()
                .any(|event| event["done"] == true)
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert!(
            events
                .lock()
                .unwrap()
                .iter()
                .all(|event| event["stream"] == 900)
        );
        assert!(
            events
                .lock()
                .unwrap()
                .iter()
                .any(|event| event["done"] == true)
        );
        // A stream of the page that left emits nothing more.
        let silent = Models::new(Ok(vec![local(port)]));
        events.lock().unwrap().clear();
        silent
            .send("local", openai(), 901, emit.clone())
            .await
            .unwrap();
        silent.leave_page();
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert!(
            events.lock().unwrap().is_empty(),
            "{:?}",
            events.lock().unwrap()
        );
    }

    #[tokio::test]
    async fn p5_a3_an_id_in_use_is_refused_and_the_bound_counts_held_slots() {
        let models = Models::new(Ok(Vec::new()));
        models.streams.lock().await.insert(5, Slot::Reserved);
        let emit: Emit = Arc::new(|_| {});
        // An unknown provider is refused first; a known one meets the slot.
        let local = Models::new(Ok(vec![Provider {
            id: "local".into(),
            kind: Kind::OpenaiCompatible,
            model: "m".into(),
            endpoint: Some("http://127.0.0.1:9/v1".into()),
            key: None,
        }]));
        local.streams.lock().await.insert(5, Slot::Reserved);
        assert_eq!(
            local.send("local", openai(), 5, emit.clone()).await.err(),
            Some(STREAM_LIMIT)
        );
        for id in 100..(100 + STREAMS_MAX as u64) {
            local.streams.lock().await.insert(id, Slot::Reserved);
        }
        assert_eq!(
            local.send("local", openai(), 6, emit).await.err(),
            Some(STREAM_LIMIT)
        );
        assert!(models.streams.lock().await.contains_key(&5));
    }

    #[test]
    fn p5_a3_an_empty_last_chunk_keeps_the_stream_from_ending_on_the_tail_alone() {
        // HTTP/2 commonly closes a stream with an empty DATA frame: \`run\` then takes "" before it finishes.
        let key = "sk-ant-api03-abcdefghijklmnop";
        let mut redactor = Redactor::new(Some(key));
        let mut chunks = vec![
            redactor.take("data: {\"text\":\"a long enough answer, well past the key\"}\n\n"),
            redactor.take(""),
        ];
        chunks.push(redactor.finish(""));
        assert_eq!(
            chunks.concat(),
            "data: {\"text\":\"a long enough answer, well past the key\"}\n\n"
        );
        assert_ne!(chunks.last().map(String::len), Some(key.len() - 1));
    }

    #[tokio::test]
    async fn p5_a3_run_removes_a_quoted_key_and_ends_on_no_chunk_the_tail_alone() {
        // A provider that accepts the request, quotes the key, and ends; as `run` streams it, not the redactor alone.
        let key = "sk-ant-api03-abcdefghijklmnop";
        let body = "data: {\"type\":\"error\",\"message\":\"key sk-ant-api03-abcdefghijklmnop refused\"}\n\ndata: [DONE]\n\n";
        let response: &'static str = Box::leak(
            format!(
                "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\nconnection: close\r\ncontent-length: {}\r\n\r\n{body}",
                body.len()
            )
            .into_boxed_str(),
        );
        let port = provider_answering(response).await;
        let events = Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen = events.clone();
        let emit: Emit = Arc::new(move |event| seen.lock().unwrap().push(event));
        let request =
            reqwest::Client::new().post(format!("http://127.0.0.1:{port}/v1/chat/completions"));
        run(3, request, &emit, Some(key)).await;
        let events = events.lock().unwrap();
        let chunks: Vec<&str> = events
            .iter()
            .filter_map(|event| event["chunk"].as_str())
            .collect();
        let text = chunks.concat();
        assert_eq!(text, body.replace(key, KEY_REMOVED));
        assert_ne!(chunks.last().map(|chunk| chunk.len()), Some(key.len() - 1));
        assert_eq!(events.last().unwrap()["done"], true);
    }

    #[test]
    fn p5_a3_a_missing_key_file_is_a_missing_key() {
        let dir = tempfile::tempdir().unwrap();
        let reference = KeyRef::File(FileRef {
            file: dir.path().join("absent.key"),
        });
        assert_eq!(resolve_key(&reference).err(), Some(KEY_MISSING));
    }

    #[cfg(unix)]
    #[test]
    fn p5_a3_a_key_file_reached_through_a_link_is_refused() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("real.key");
        std::fs::write(&real, "sk-a-file-key-0123").unwrap();
        std::fs::set_permissions(&real, std::fs::Permissions::from_mode(0o600)).unwrap();
        let link = dir.path().join("link.key");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        let reference = KeyRef::File(FileRef { file: link });
        assert_eq!(resolve_key(&reference).err(), Some(PERMISSIONS));
    }

    #[test]
    fn an_event_is_one_inert_statement() {
        let script = event_script(&json!({ "stream": 1, "chunk": "</script><b>\u{2028}" }));
        assert!(script.starts_with("window.dispatchEvent(new CustomEvent('loam:model',{detail:"));
        for forbidden in ['<', '>', '\u{2028}'] {
            assert!(!script.contains(forbidden), "{forbidden:?}");
        }
    }
}
