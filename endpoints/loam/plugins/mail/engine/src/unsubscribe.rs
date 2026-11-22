//! Unsubscribing from mailing lists at the terminal (step D3, third part; the
//! specification's 9.5, 11, 13, M18 and M29): `mail-unsubscribe-show` (read-only
//! preview) and `mail-unsubscribe` (person-only, destructive, held for
//! approval).
//!
//! Uses only a message's held `List-Unsubscribe` and `List-Unsubscribe-Post`
//! headers:
//! - RFC 8058 one-click HTTPS POST when `List-Unsubscribe-Post:
//!   List-Unsubscribe=One-Click` is declared and a valid `https://` URL is
//!   present (never `http://`, never following redirects, never private/local
//!   IPs).
//! - Otherwise, a plain-text email via SMTP to a single valid `mailto:`
//!   address in `List-Unsubscribe` (never adding `cc`/`bcc`/`to` parameters).
//! - Never opens a link in a browser; refuses when no usable header exists.

use std::sync::Arc;
use std::time::Duration;

use afd::{
    ActorKind, ApprovalPolicy, CommandContext, CommandDefinition, CommandError, CommandHandler,
    CommandInterface, CommandResult, JsonSchemaType, Warning, failure, input_digest, success,
};
use async_trait::async_trait;
use mail_parser::MessageParser;
use serde_json::{Value, json};
use url::Url;

use crate::commands::{command_line_only, store_failure};
use crate::derive;
use crate::drafts::{MOST_SUBJECT, address, unsafe_in_subject};
use crate::engine::Engine;
use crate::provider::ProviderError;
use crate::provider::http::{UnsubscribeOutcome, is_allowed_https_url};
use crate::provider::smtp::{OutgoingMessage, SendOutcome, build_message, new_message_id};
use crate::read::{
    MOST_BUDGET, budget, content, fits, integer, parameter, read_exposure, required, too_small,
};
use crate::screening::proposer_of;
use crate::store::{AccountRow, MessageId, OutboundState, StoreError};

/// The name of the preview command for unsubscribing.
pub const SHOW: &str = "mail-unsubscribe-show";
/// The name of the destructive unsubscribe command.
pub const UNSUBSCRIBE: &str = "mail-unsubscribe";

/// Maximum target URI length offered (step F's specification, §6 and F-T6).
pub const MAX_TARGET_LEN: usize = 2048;
/// Maximum raw `List-Unsubscribe` header bytes inspected.
const MAX_HEADER_BYTES: usize = 16 * 1024;
/// Maximum angle-bracketed entries inspected in one `List-Unsubscribe` header.
const MAX_HEADER_ENTRIES: usize = 16;
/// Maximum `body` length accepted from a `mailto:` query parameter.
const MAX_MAILTO_BODY: usize = 4096;
/// Fixed output budget for `mail-unsubscribe-show` (default == max == `MOST_BUDGET`,
/// matching `mail-draft-show` and step F's F-T6).
const SHOW_BUDGET: u64 = MOST_BUDGET;
/// Bounded timeout for the best-effort IMAP `APPEND` of a `mailto:` unsubscribe
/// copy to the account's Sent mailbox.
const SENT_COPY_TIMEOUT: Duration = Duration::from_secs(10);

/// How an unsubscribe will be performed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnsubscribeMethod {
    /// RFC 8058 one-click HTTPS POST (`List-Unsubscribe=One-Click`).
    OneClick,
    /// RFC 2369 `mailto:` email sent over SMTP.
    Mail,
}

impl UnsubscribeMethod {
    /// Wire and JSON spelling (`"one-click"` or `"mail"`).
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::OneClick => "one-click",
            Self::Mail => "mail",
        }
    }
}

/// Parsed fields of a `mailto:` unsubscribe target.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MailtoTarget {
    /// Single bare ASCII recipient address.
    pub to: String,
    /// Outgoing subject (defaults to `"Unsubscribe"` when omitted or empty).
    pub subject: String,
    /// Outgoing plain-text body (empty when omitted).
    pub body: String,
}

/// A usable unsubscribe target derived from a message's held headers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UnsubscribeTarget {
    /// RFC 8058 one-click HTTPS POST.
    OneClick {
        /// Exact `https://` URL to POST to.
        url: String,
    },
    /// RFC 2369 `mailto:` email over SMTP.
    Mail {
        /// Canonical `mailto:` URI (including subject/body when present).
        uri: String,
        /// Parsed email fields.
        mailto: MailtoTarget,
    },
}

impl UnsubscribeTarget {
    /// The method (`one-click` or `mail`).
    #[must_use]
    pub fn method(&self) -> UnsubscribeMethod {
        match self {
            Self::OneClick { .. } => UnsubscribeMethod::OneClick,
            Self::Mail { .. } => UnsubscribeMethod::Mail,
        }
    }

    /// Exact target string covered by the preview and digest.
    #[must_use]
    pub fn target_str(&self) -> &str {
        match self {
            Self::OneClick { url } => url,
            Self::Mail { uri, .. } => uri,
        }
    }
}

/// Everything derived from a message's held headers for preview and execution.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DerivedUnsubscribe {
    /// The message id.
    pub message: MessageId,
    /// The account associated with the message.
    pub account: AccountRow,
    /// The usable unsubscribe target.
    pub target: UnsubscribeTarget,
    /// 43-character base64url SHA-256 digest of `{ message, account, method, target }`.
    pub digest: String,
    /// `List-Id` value, if any (content).
    pub list_id: String,
    /// Sender display name, if any (content).
    pub sender_name: String,
    /// Sender address, if any (content).
    pub sender_address: String,
    /// Message subject, if any (content).
    pub subject: String,
}

/// Unfolds RFC 5322 header folding (`CRLF`/`LF` followed by spaces or tabs).
fn unfold(raw: &[u8]) -> String {
    let text = String::from_utf8_lossy(raw);
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\r' || c == '\n' {
            if c == '\r' && chars.peek() == Some(&'\n') {
                chars.next();
            }
            if matches!(chars.peek(), Some(' ' | '\t')) {
                // RFC 5322 folding whitespace: collapse fold + following WSP
                // into a single space (stripped later inside `<...>`).
                while matches!(chars.peek(), Some(' ' | '\t')) {
                    chars.next();
                }
                out.push(' ');
            } else {
                out.push('\n');
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Removes RFC 5322 `(comments)` (handling nested parens and `\` escapes)
/// outside angle brackets.
fn strip_comments(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut depth = 0usize;
    let mut escaped = false;
    for c in input.chars() {
        if depth > 0 {
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '(' {
                depth = depth.saturating_add(1);
            } else if c == ')' {
                depth -= 1;
            }
        } else if c == '(' {
            depth = 1;
        } else {
            out.push(c);
        }
    }
    out
}

/// Extracts angle-bracketed `<URI>` entries from a `List-Unsubscribe` header
/// value (RFC 2369 §2), ignoring RFC 5322 comments and folding whitespace
/// inside angle brackets.
fn extract_angle_uris(raw: &[u8]) -> Vec<String> {
    if raw.len() > MAX_HEADER_BYTES {
        return Vec::new();
    }
    let text = String::from_utf8_lossy(raw);
    let mut entries = Vec::new();
    let mut comment_depth = 0usize;
    let mut comment_escaped = false;
    let mut in_angle = false;
    let mut current = String::new();
    let mut chars = text.chars().peekable();

    while let Some(c) = chars.next() {
        if in_angle {
            if c == '>' {
                let trimmed = current.trim().to_string();
                if !trimmed.is_empty() {
                    entries.push(trimmed);
                    if entries.len() >= MAX_HEADER_ENTRIES {
                        break;
                    }
                }
                current.clear();
                in_angle = false;
            } else if c == '\r' || c == '\n' {
                if c == '\r' && chars.peek() == Some(&'\n') {
                    chars.next();
                }
                // Folding inside `<...>`: skip the fold's leading spaces/tabs
                // (RFC 2369 §2); any other bare newline invalidates the URI.
                if matches!(chars.peek(), Some(' ' | '\t')) {
                    while matches!(chars.peek(), Some(' ' | '\t')) {
                        chars.next();
                    }
                } else {
                    current.push('\n');
                }
            } else {
                current.push(c);
            }
            continue;
        }
        if comment_depth > 0 {
            if comment_escaped {
                comment_escaped = false;
            } else if c == '\\' {
                comment_escaped = true;
            } else if c == '(' {
                comment_depth = comment_depth.saturating_add(1);
            } else if c == ')' {
                comment_depth -= 1;
            }
            continue;
        }
        match c {
            '(' => comment_depth = 1,
            '<' => {
                in_angle = true;
                current.clear();
            }
            _ => {}
        }
    }
    entries
}

/// Whether `List-Unsubscribe-Post` declares RFC 8058 one-click
/// (`List-Unsubscribe=One-Click`, case-insensitive).
fn is_one_click_post_header(raw: &[u8]) -> bool {
    if raw.len() > MAX_HEADER_BYTES {
        return false;
    }
    let unfolded = strip_comments(&unfold(raw));
    unfolded.split(';').any(|segment| {
        segment.split_once('=').is_some_and(|(key, value)| {
            key.trim().eq_ignore_ascii_case("List-Unsubscribe")
                && value.trim().eq_ignore_ascii_case("One-Click")
        })
    })
}

/// Decodes RFC 3986 `%XX` percent-encoding (preserving `+` literally, as
/// required by RFC 6068 `mailto:` URIs). Returns `None` on malformed escapes,
/// NUL bytes, or invalid UTF-8.
fn percent_decode_rfc3986(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return None;
            }
            let hi = hex_val(bytes[i + 1])?;
            let lo = hex_val(bytes[i + 2])?;
            let byte = (hi << 4) | lo;
            if byte == 0 {
                return None;
            }
            out.push(byte);
            i += 3;
        } else {
            if bytes[i] == 0 {
                return None;
            }
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn hex_val(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// Percent-encodes a `mailto:` query parameter value according to RFC 3986.
fn percent_encode_query_value(value: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut out = String::with_capacity(value.len());
    for &b in value.as_bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            out.push(char::from(b));
        } else {
            out.push('%');
            out.push(char::from(HEX[(b >> 4) as usize]));
            out.push(char::from(HEX[(b & 0x0f) as usize]));
        }
    }
    out
}

/// Parses a single `https://` URI for RFC 8058 one-click POST.
fn parse_https_target(raw: &str) -> Option<String> {
    if raw.is_empty()
        || raw.chars().count() > MAX_TARGET_LEN
        || raw.chars().any(|c| c.is_control() || c.is_whitespace())
    {
        return None;
    }
    let mut url = Url::parse(raw).ok()?;
    if !is_allowed_https_url(&url) {
        return None;
    }
    // HTTP POST never sends a fragment; strip any so preview matches the wire.
    url.set_fragment(None);
    let normalized = url.to_string();
    if normalized.chars().count() > MAX_TARGET_LEN {
        return None;
    }
    Some(normalized)
}

/// Parses a single `mailto:` URI for RFC 2369 email unsubscribe.
///
/// Rejects multiple recipients (commas in path), any `to`/`cc`/`bcc` query
/// parameter, invalid bare-ASCII addresses, unsafe subject characters, or
/// overlong targets/subjects/bodies.
fn parse_mailto_target(raw: &str) -> Option<(String, MailtoTarget)> {
    if raw.is_empty()
        || raw.chars().count() > MAX_TARGET_LEN
        || raw.chars().any(|c| c.is_control() || c.is_whitespace())
    {
        return None;
    }
    let url = Url::parse(raw).ok()?;
    if url.scheme() != "mailto" || url.has_authority() || !url.cannot_be_a_base() {
        return None;
    }
    let decoded_path = percent_decode_rfc3986(url.path())?;
    if decoded_path.contains(',') {
        return None;
    }
    let to = address(&decoded_path)?;
    let mut raw_subject: Option<String> = None;
    let mut raw_body: Option<String> = None;
    if let Some(query) = url.query() {
        for pair in query.split('&') {
            if pair.is_empty() {
                continue;
            }
            let (raw_key, raw_val) = pair.split_once('=').unwrap_or((pair, ""));
            let key = percent_decode_rfc3986(raw_key)?;
            let val = percent_decode_rfc3986(raw_val)?;
            let lower = key.to_ascii_lowercase();
            // Refuse headers that could redirect or add recipients.
            if matches!(
                lower.as_str(),
                "to" | "cc" | "bcc" | "from" | "reply-to" | "in-reply-to" | "references"
            ) {
                return None;
            }
            if lower == "subject" && raw_subject.is_none() {
                raw_subject = Some(val);
            } else if lower == "body" && raw_body.is_none() {
                raw_body = Some(val);
            }
        }
    }
    let subject = match raw_subject {
        Some(s) if !s.is_empty() => {
            if s.chars().count() > MOST_SUBJECT || s.chars().any(unsafe_in_subject) {
                return None;
            }
            s
        }
        _ => "Unsubscribe".to_string(),
    };
    let body = match raw_body {
        Some(b) => {
            if b.len() > MAX_MAILTO_BODY
                || b.chars()
                    .any(|c| c.is_control() && !matches!(c, '\r' | '\n' | '\t'))
            {
                return None;
            }
            b
        }
        None => String::new(),
    };
    // Canonical mailto URI covering exact recipient, subject, and body.
    let mut uri = format!(
        "mailto:{to}?subject={}",
        percent_encode_query_value(&subject)
    );
    if !body.is_empty() {
        uri.push_str("&body=");
        uri.push_str(&percent_encode_query_value(&body));
    }
    if uri.chars().count() > MAX_TARGET_LEN {
        return None;
    }
    Some((uri, MailtoTarget { to, subject, body }))
}

/// Parses `List-Unsubscribe` and `List-Unsubscribe-Post` from a raw header
/// block, returning the preferred usable target (RFC 8058 one-click HTTPS POST
/// first when declared, else RFC 2369 `mailto:`). Never returns a plain
/// `http://` link or a non-one-click `https://` browser link.
#[must_use]
pub fn parse_unsubscribe_headers(raw_headers: &[u8]) -> Option<UnsubscribeTarget> {
    if raw_headers.len() > derive::HEADER_LIMIT {
        return None;
    }
    let parsed = MessageParser::new().parse_headers(raw_headers)?;
    let headers = parsed.headers();
    let list_unsub = headers.get("List-Unsubscribe")?;
    let uris = extract_angle_uris(list_unsub.raw_value());
    if uris.is_empty() {
        return None;
    }
    let one_click = headers
        .get("List-Unsubscribe-Post")
        .is_some_and(|h| is_one_click_post_header(h.raw_value()));

    if one_click {
        for uri in &uris {
            if let Some(url) = parse_https_target(uri) {
                return Some(UnsubscribeTarget::OneClick { url });
            }
        }
    }

    for uri in &uris {
        if let Some((canonical_uri, mailto)) = parse_mailto_target(uri) {
            return Some(UnsubscribeTarget::Mail {
                uri: canonical_uri,
                mailto,
            });
        }
    }

    None
}

/// Computes the 43-character base64url SHA-256 digest of
/// `{ message, account, method, target }` (step F's specification, §7).
#[must_use]
pub fn compute_digest(message: i64, account: i64, method: &str, target: &str) -> String {
    let payload = json!({
        "message": message,
        "account": account,
        "method": method,
        "target": target,
    });
    input_digest(&payload).unwrap_or_default()
}

fn no_unsubscribe_header() -> CommandError {
    CommandError::new(
        "UNSUBSCRIBE_NOT_AVAILABLE",
        "this message has no usable List-Unsubscribe header (one-click HTTPS POST or mailto)",
    )
    .with_retryable(false)
    .with_suggestion(
        "The engine never opens unsubscribe links in a browser. Block the sender with mail-sender-screen instead if you want to hide its mail.",
    )
}

fn preview_changed() -> CommandError {
    CommandError::new(
        "PREVIEW_CHANGED",
        "The unsubscribe target changed since its preview was read. Nothing was contacted.",
    )
    .with_retryable(false)
    .with_suggestion("Read it again with mail-unsubscribe-show and ask the person again.")
}

/// Derives the unsubscribe target and metadata for `message_id` (and optional
/// `account_id`) directly from the message's held header block. Contacts
/// nothing over the network.
fn derive_unsubscribe(
    engine: &Engine,
    message_id: i64,
    named_account: Option<i64>,
) -> Result<DerivedUnsubscribe, Box<CommandError>> {
    let msg_id = MessageId(message_id);
    let (raw_headers, accounts) = engine
        .with_store(|store| {
            if !store.message_exists(msg_id)? {
                return Ok(None);
            }
            let headers = store.read_part(msg_id, "header")?;
            let accounts = store.message_accounts(msg_id)?;
            Ok(Some((headers, accounts)))
        })
        .map_err(|error| match error {
            StoreError::NotFound(_) | StoreError::Log(_) => Box::new(
                CommandError::new(
                    "NOT_HELD",
                    "the message's header block is not held in the log",
                )
                .with_suggestion("Run `loam-mail mail-sync` to fetch the message's headers."),
            ),
            other => Box::new(store_failure(&other)),
        })?
        .ok_or_else(|| {
            Box::new(
                CommandError::new("MESSAGE_NOT_FOUND", "no message has that id").with_suggestion(
                    "Run `loam-mail mail-thread-open` to see a thread's messages.",
                ),
            )
        })?;

    let account = match named_account {
        Some(wanted) => {
            if let Some(found) = accounts.into_iter().find(|a| a.id.0 == wanted) {
                found
            } else {
                let exists = engine
                    .with_store(|store| Ok(store.accounts()?.into_iter().any(|a| a.id.0 == wanted)))
                    .map_err(|e| Box::new(store_failure(&e)))?;
                if !exists {
                    return Err(Box::new(
                        CommandError::new("ACCOUNT_NOT_FOUND", "no account has that id")
                            .with_suggestion(
                                "Run `loam-mail mail-account-list` to see the accounts' ids.",
                            ),
                    ));
                }
                return Err(Box::new(
                    CommandError::new(
                        "INVALID_INPUT",
                        format!("account {wanted} does not hold message {message_id}"),
                    )
                    .with_suggestion("Omit `account` or pass an account that holds this message."),
                ));
            }
        }
        None => {
            let mut iter = accounts.into_iter();
            match (iter.next(), iter.next()) {
                (Some(only), None) => only,
                (None, _) => {
                    return Err(Box::new(
                        CommandError::new("ACCOUNT_NOT_FOUND", "no account holds this message")
                            .with_suggestion(
                                "Run `loam-mail mail-account-list` to see the accounts.",
                            ),
                    ));
                }
                (Some(_), Some(_)) => {
                    return Err(Box::new(
                        CommandError::new(
                            "INVALID_INPUT",
                            "this message is shown in more than one account; pass `account`",
                        )
                        .with_suggestion("Pass `account` with the account id to unsubscribe from."),
                    ));
                }
            }
        }
    };

    let target =
        parse_unsubscribe_headers(&raw_headers).ok_or_else(|| Box::new(no_unsubscribe_header()))?;
    let fields = derive::header_fields(&raw_headers);
    let digest = compute_digest(
        message_id,
        account.id.0,
        target.method().as_str(),
        target.target_str(),
    );

    Ok(DerivedUnsubscribe {
        message: msg_id,
        account,
        target,
        digest,
        list_id: fields.list_id,
        sender_name: fields.sender_name,
        sender_address: fields.sender_address,
        subject: fields.subject,
    })
}

fn preview_json(derived: &DerivedUnsubscribe) -> Value {
    let mut content_obj = json!({
        "target": derived.target.target_str(),
        "listId": (!derived.list_id.is_empty()).then_some(&derived.list_id),
        "sender": {
            "name": derived.sender_name,
            "address": derived.sender_address,
        },
        "subject": derived.subject,
    });
    if let UnsubscribeTarget::Mail { mailto, .. } = &derived.target
        && let Some(obj) = content_obj.as_object_mut()
    {
        obj.insert(
            "mailto".to_string(),
            json!({
                "to": mailto.to,
                "subject": mailto.subject,
                "body": mailto.body,
            }),
        );
    }
    json!({
        "unsubscribe": {
            "message": derived.message.0,
            "account": {
                "id": derived.account.id.0,
                "provider": derived.account.provider,
                "address": derived.account.address,
            },
            "method": derived.target.method().as_str(),
            "content": content(content_obj),
            "digest": derived.digest,
        }
    })
}

fn optional_digest(input: &Value) -> Result<Option<String>, Box<CommandError>> {
    match input.get("digest") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) if !s.is_empty() => Ok(Some(s.clone())),
        Some(_) => Err(Box::new(
            CommandError::new("INVALID_INPUT", "`digest` must be a non-empty string")
                .with_suggestion("Pass the `digest` returned by mail-unsubscribe-show."),
        )),
    }
}

fn required_digest(input: &Value) -> Result<String, Box<CommandError>> {
    optional_digest(input)?.ok_or_else(|| {
        Box::new(
            CommandError::new("INVALID_INPUT", "`digest` is required").with_suggestion(
                "Read the target with mail-unsubscribe-show and pass its `digest`.",
            ),
        )
    })
}

/// Checks `mail-unsubscribe` inputs and digest before the approval middleware
/// holds the call, so a missing/unusable header or stale digest never issues
/// an approval token (step F's specification, §7).
#[must_use]
pub fn pre_approval_check(engine: &Engine, input: &Value) -> Option<CommandError> {
    let message = match required(input, "message") {
        Ok(id) => id,
        Err(error) => return Some(*error),
    };
    let account = match integer(input, "account") {
        Ok(account) => account,
        Err(error) => return Some(*error),
    };
    let digest = match required_digest(input) {
        Ok(digest) => digest,
        Err(error) => return Some(*error),
    };
    let derived = match derive_unsubscribe(engine, message, account) {
        Ok(derived) => derived,
        Err(error) => return Some(*error),
    };
    if derived.digest != digest {
        return Some(preview_changed());
    }
    None
}

/// Content-free approval summary for `mail-unsubscribe` (the specification's
/// 3.5 and 12.1): never includes any URL, address, list id, or subject from
/// mail.
#[must_use]
pub fn approval_summary(engine: &Engine, input: &Value) -> Option<String> {
    let message = input.get("message")?.as_i64()?;
    let account = input.get("account").and_then(Value::as_i64);
    let derived = derive_unsubscribe(engine, message, account).ok()?;
    Some(match derived.target.method() {
        UnsubscribeMethod::OneClick => format!(
            "Unsubscribe from message {message} via one-click HTTPS POST (account {})",
            derived.account.id.0
        ),
        UnsubscribeMethod::Mail => format!(
            "Unsubscribe from message {message} by sending mail from account {}",
            derived.account.id.0
        ),
    })
}

struct Show {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for Show {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let message = match required(&input, "message") {
            Ok(id) => id,
            Err(error) => return failure(*error),
        };
        let account = match integer(&input, "account") {
            Ok(account) => account,
            Err(error) => return failure(*error),
        };
        let asked_digest = match optional_digest(&input) {
            Ok(digest) => digest,
            Err(error) => return failure(*error),
        };
        let derived = match derive_unsubscribe(&self.engine, message, account) {
            Ok(derived) => derived,
            Err(error) => return failure(*error),
        };
        if let Some(expected) = asked_digest
            && expected != derived.digest
        {
            return failure(preview_changed());
        }
        let result = preview_json(&derived);
        let limit = budget(&context, SHOW_BUDGET);
        if !fits(&result, limit) {
            return failure(too_small(limit));
        }
        success(result)
    }
}

/// `mail-unsubscribe-show`: previews the exact `List-Unsubscribe` target and
/// method for a message without contacting any remote server.
#[must_use]
pub fn show(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        SHOW,
        "Preview how mail-unsubscribe would unsubscribe from a message, without contacting anything",
        vec![
            parameter("message", JsonSchemaType::Integer, "The message, by id", true),
            parameter(
                "account",
                JsonSchemaType::Integer,
                "The account to unsubscribe from, when the message is shown in more than one",
                false,
            ),
            parameter(
                "digest",
                JsonSchemaType::String,
                "Optional digest to verify against the current target",
                false,
            ),
        ],
        Show { engine },
    )
    .with_output_budget(SHOW_BUDGET, SHOW_BUDGET)
    .with_expose(read_exposure())
}

/// Ensures an in-flight unsubscribe never stays stranded in `sending` if the
/// future is dropped by a server call deadline or Ctrl-C before finalization.
struct InFlightUnsubscribe {
    engine: Arc<Engine>,
    outbound_id: i64,
    armed: bool,
}

impl InFlightUnsubscribe {
    fn arm(engine: Arc<Engine>, outbound_id: i64) -> Self {
        Self {
            engine,
            outbound_id,
            armed: true,
        }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for InFlightUnsubscribe {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX));
        let _ = self.engine.with_store(|store| {
            store.finish_unsubscribe(
                self.outbound_id,
                OutboundState::Unknown,
                Some("the unsubscribe was interrupted before its outcome was recorded; whether it took effect is not known"),
                now,
            )
        });
    }
}

struct Unsubscribe {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for Unsubscribe {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let is_terminal_human = context.interface == Some(CommandInterface::Cli)
            && context
                .actor
                .as_ref()
                .is_some_and(|actor| actor.kind == ActorKind::Human);
        if !is_terminal_human {
            return failure(
                CommandError::new(
                    "PERSON_REQUIRED",
                    "`mail-unsubscribe` is a person's command and must be run at a terminal",
                )
                .with_suggestion("Run `loam-mail mail-unsubscribe` at a terminal."),
            );
        }
        let now = context.clock().now();
        let sender_proposer = proposer_of(&context);
        let message = match required(&input, "message") {
            Ok(id) => id,
            Err(error) => return failure(*error),
        };
        let account = match integer(&input, "account") {
            Ok(account) => account,
            Err(error) => return failure(*error),
        };
        let expected_digest = match required_digest(&input) {
            Ok(digest) => digest,
            Err(error) => return failure(*error),
        };

        // Derive once and act on that exact derivation (step F, §7).
        let derived = match derive_unsubscribe(&self.engine, message, account) {
            Ok(derived) => derived,
            Err(error) => return failure(*error),
        };
        if derived.digest != expected_digest {
            return failure(preview_changed());
        }

        match &derived.target {
            UnsubscribeTarget::OneClick { url } => {
                self.execute_one_click(&derived, url, &sender_proposer, &context, now)
                    .await
            }
            UnsubscribeTarget::Mail { mailto, .. } => {
                self.execute_mail(&derived, mailto, &sender_proposer, &context, now)
                    .await
            }
        }
    }
}

impl Unsubscribe {
    async fn execute_one_click(
        &self,
        derived: &DerivedUnsubscribe,
        url: &str,
        sender_proposer: &crate::store::Proposer,
        context: &CommandContext,
        now: i64,
    ) -> CommandResult<Value> {
        let record_key = format!("unsubscribe-https-{}", derived.message.0);
        let outbound_id = match self.engine.with_store(|store| {
            store.begin_unsubscribe(derived.account.id, &record_key, sender_proposer, now)
        }) {
            Ok(id) => id,
            Err(error) => return failure(store_failure(&error)),
        };
        let mut guard = InFlightUnsubscribe::arm(Arc::clone(&self.engine), outbound_id);

        let poster = Arc::clone(self.engine.unsubscribe_poster());
        let outcome = poster.post_one_click(url).await;
        let finished_at = context.clock().now();

        match outcome {
            UnsubscribeOutcome::Accepted { status } => {
                let record_saved = self
                    .engine
                    .with_store(|store| {
                        store.finish_unsubscribe(
                            outbound_id,
                            OutboundState::Sent,
                            None,
                            finished_at,
                        )
                    })
                    .is_ok();
                guard.disarm();
                let mut result = success(json!({
                    "outbound": outbound_id,
                    "message": derived.message.0,
                    "account": derived.account.id.0,
                    "method": "one-click",
                    "status": status,
                    "state": "sent",
                    "recordSaved": record_saved,
                }));
                if !record_saved {
                    result.warnings = Some(vec![Warning::new(
                        "OUTBOUND_RECORD_FAILED",
                        "the unsubscribe request was accepted, but the local outbound record could not be updated",
                    )]);
                }
                result
            }
            UnsubscribeOutcome::RedirectRefused { status } => {
                let why = format!(
                    "the unsubscribe server replied with a redirect (HTTP {status}), which the engine does not follow"
                );
                let saved = self.engine.with_store(|store| {
                    store.finish_unsubscribe(
                        outbound_id,
                        OutboundState::Failed,
                        Some(&why),
                        finished_at,
                    )
                });
                guard.disarm();
                if saved.is_err() {
                    return failure(outbound_finalize_failed());
                }
                failure(
                    CommandError::new("PROVIDER_REFUSED", why)
                        .with_retryable(false)
                        .with_suggestion(
                            "The engine never follows redirects on unsubscribe targets. Block the sender with mail-sender-screen instead.",
                        ),
                )
            }
            UnsubscribeOutcome::RateLimited { status } => {
                let why =
                    format!("the unsubscribe server rate-limited the request (HTTP {status})");
                let saved = self.engine.with_store(|store| {
                    store.finish_unsubscribe(
                        outbound_id,
                        OutboundState::Failed,
                        Some(&why),
                        finished_at,
                    )
                });
                guard.disarm();
                if saved.is_err() {
                    return failure(outbound_finalize_failed());
                }
                failure(
                    CommandError::new("PROVIDER_LIMIT", why)
                        .with_retryable(true)
                        .with_suggestion("Wait a while before trying again."),
                )
            }
            UnsubscribeOutcome::Refused { status } => {
                let why = format!("the unsubscribe server refused the request (HTTP {status})");
                let saved = self.engine.with_store(|store| {
                    store.finish_unsubscribe(
                        outbound_id,
                        OutboundState::Failed,
                        Some(&why),
                        finished_at,
                    )
                });
                guard.disarm();
                if saved.is_err() {
                    return failure(outbound_finalize_failed());
                }
                failure(
                    CommandError::new("PROVIDER_REFUSED", why)
                        .with_retryable(false)
                        .with_suggestion(
                            "The mailing list refused the one-click unsubscribe request. Block the sender with mail-sender-screen instead.",
                        ),
                )
            }
            UnsubscribeOutcome::ServerError { status } => {
                let why = format!("the unsubscribe server returned an error (HTTP {status})");
                let saved = self.engine.with_store(|store| {
                    store.finish_unsubscribe(
                        outbound_id,
                        OutboundState::Failed,
                        Some(&why),
                        finished_at,
                    )
                });
                guard.disarm();
                if saved.is_err() {
                    return failure(outbound_finalize_failed());
                }
                failure(
                    CommandError::new("PROVIDER_UNAVAILABLE", why)
                        .with_retryable(true)
                        .with_suggestion(
                            "Try again later, or block the sender with mail-sender-screen.",
                        ),
                )
            }
            UnsubscribeOutcome::Failed(why) => {
                let saved = self.engine.with_store(|store| {
                    store.finish_unsubscribe(
                        outbound_id,
                        OutboundState::Failed,
                        Some(why),
                        finished_at,
                    )
                });
                guard.disarm();
                if saved.is_err() {
                    return failure(outbound_finalize_failed());
                }
                failure(
                    CommandError::new("PROVIDER_UNAVAILABLE", why)
                        .with_retryable(true)
                        .with_suggestion("Check the network, then run mail-unsubscribe again."),
                )
            }
            UnsubscribeOutcome::Unknown(why) => {
                let record_saved = self
                    .engine
                    .with_store(|store| {
                        store.finish_unsubscribe(
                            outbound_id,
                            OutboundState::Unknown,
                            Some(why),
                            finished_at,
                        )
                    })
                    .is_ok();
                guard.disarm();
                failure(
                    CommandError::new("SEND_OUTCOME_UNKNOWN", why)
                        .with_retryable(false)
                        .with_details(std::collections::HashMap::from([
                            ("outbound".to_string(), json!(outbound_id)),
                            ("message".to_string(), json!(derived.message.0)),
                            ("recordSaved".to_string(), json!(record_saved)),
                        ]))
                        .with_suggestion(
                            "Check mail-status before deciding whether to try again; this request is not retried automatically.",
                        ),
                )
            }
        }
    }

    async fn execute_mail(
        &self,
        derived: &DerivedUnsubscribe,
        mailto: &MailtoTarget,
        sender_proposer: &crate::store::Proposer,
        context: &CommandContext,
        now: i64,
    ) -> CommandResult<Value> {
        let Some(mail_sender) = self.engine.sender().cloned() else {
            return failure(
                CommandError::new(
                    "PROVIDER_UNAVAILABLE",
                    "this build of the engine cannot send mail",
                )
                .with_suggestion("Configure an SMTP sender for the engine."),
            );
        };
        let message_id = match new_message_id(&derived.account.address) {
            Ok(id) => id,
            Err(why) => {
                return failure(
                    CommandError::new("STORE_FAILED", why)
                        .with_suggestion("Check the operating system's random source."),
                );
            }
        };
        let outbound_id = match self.engine.with_store(|store| {
            store.begin_unsubscribe(derived.account.id, &message_id, sender_proposer, now)
        }) {
            Ok(id) => id,
            Err(error) => return failure(store_failure(&error)),
        };
        let mut guard = InFlightUnsubscribe::arm(Arc::clone(&self.engine), outbound_id);

        let to = [mailto.to.clone()];
        let wire_bytes = build_message(&OutgoingMessage {
            from: &derived.account.address,
            to: &to,
            cc: &[],
            bcc: &[],
            subject: &mailto.subject,
            body: &mailto.body,
            date_ms: now,
            message_id: &message_id,
            in_reply_to: None,
            references: &[],
            include_bcc: false,
        });

        let outcome = mail_sender
            .send(&derived.account, &derived.account.address, &to, &wire_bytes)
            .await;
        let finished_at = context.clock().now();

        match outcome {
            SendOutcome::Sent => {
                let record_saved = self
                    .engine
                    .with_store(|store| {
                        store.finish_unsubscribe(
                            outbound_id,
                            OutboundState::Sent,
                            None,
                            finished_at,
                        )
                    })
                    .is_ok();
                guard.disarm();
                let sent_copy = tokio::time::timeout(
                    SENT_COPY_TIMEOUT,
                    append_sent_copy(&self.engine, &derived.account, &wire_bytes),
                )
                .await
                .unwrap_or(false);
                if sent_copy && record_saved {
                    let _ = self
                        .engine
                        .with_store(|store| store.mark_outbound_sent_copy(outbound_id));
                }
                let mut result = success(json!({
                    "outbound": outbound_id,
                    "message": derived.message.0,
                    "account": derived.account.id.0,
                    "method": "mail",
                    "state": "sent",
                    "sentCopy": sent_copy,
                    "recordSaved": record_saved,
                }));
                let mut warnings = Vec::new();
                if !record_saved {
                    warnings.push(Warning::new(
                        "OUTBOUND_RECORD_FAILED",
                        "the unsubscribe mail was accepted by the provider, but the local outbound record could not be updated",
                    ));
                }
                if !sent_copy {
                    warnings.push(Warning::new(
                        "SENT_COPY_FAILED",
                        "the unsubscribe mail was sent, but a copy could not be placed in the sent mailbox",
                    ));
                }
                if !warnings.is_empty() {
                    result.warnings = Some(warnings);
                }
                result
            }
            SendOutcome::Failed(error) => {
                let why = error.to_string();
                let saved = self.engine.with_store(|store| {
                    store.finish_unsubscribe(
                        outbound_id,
                        OutboundState::Failed,
                        Some(&why),
                        finished_at,
                    )
                });
                guard.disarm();
                if saved.is_err() {
                    return failure(outbound_finalize_failed());
                }
                failure(mail_provider_failure(&error))
            }
            SendOutcome::Unknown(why) => {
                let record_saved = self
                    .engine
                    .with_store(|store| {
                        store.finish_unsubscribe(
                            outbound_id,
                            OutboundState::Unknown,
                            Some(why),
                            finished_at,
                        )
                    })
                    .is_ok();
                guard.disarm();
                failure(
                    CommandError::new("SEND_OUTCOME_UNKNOWN", why)
                        .with_retryable(false)
                        .with_details(std::collections::HashMap::from([
                            ("outbound".to_string(), json!(outbound_id)),
                            ("message".to_string(), json!(derived.message.0)),
                            ("recordSaved".to_string(), json!(record_saved)),
                        ]))
                        .with_suggestion(
                            "Check your Sent mailbox and mail-status before deciding whether to try again; this send is never retried.",
                        ),
                )
            }
        }
    }
}

fn outbound_finalize_failed() -> CommandError {
    CommandError::new(
        "STORE_FAILED",
        "the unsubscribe request failed, and the local outbound record could not be updated",
    )
    .with_retryable(false)
    .with_suggestion("Check the store and mail-status before deciding whether to try again.")
}

/// Maps an SMTP failure during `mail-unsubscribe` (`mailto:`) into
/// unsubscribe-specific engine words.
fn mail_provider_failure(error: &ProviderError) -> CommandError {
    match error {
        ProviderError::SignIn => CommandError::new("SIGN_IN_REQUIRED", error.to_string())
            .with_suggestion("Sign in to the account again."),
        ProviderError::Keychain => CommandError::new("SIGN_IN_REQUIRED", error.to_string())
            .with_suggestion("Unlock the keychain, then try again."),
        ProviderError::NoCredential => CommandError::new("SIGN_IN_REQUIRED", error.to_string())
            .with_suggestion("Store the account's sign-in, then try again."),
        ProviderError::Limit(_) => CommandError::new("PROVIDER_LIMIT", error.to_string())
            .with_suggestion("Wait a while before trying to unsubscribe again.")
            .with_retryable(true),
        ProviderError::Refused(_) => CommandError::new("PROVIDER_REFUSED", error.to_string())
            .with_suggestion(
                "The provider permanently refused the unsubscribe mail. Block the sender with mail-sender-screen instead.",
            )
            .with_retryable(false),
        ProviderError::TooDeep => CommandError::new("PROVIDER_UNAVAILABLE", error.to_string())
            .with_suggestion("The provider's reply could not be read.")
            .with_retryable(false),
        ProviderError::Unavailable(_) | ProviderError::Protocol(_) => {
            CommandError::new("PROVIDER_UNAVAILABLE", error.to_string())
                .with_suggestion(
                    "Nothing was sent. Check the network, then run mail-unsubscribe again.",
                )
                .with_retryable(true)
        }
    }
}

async fn append_sent_copy(engine: &Engine, account: &AccountRow, copy_bytes: &[u8]) -> bool {
    let Some(connector) = engine.connector().cloned() else {
        return false;
    };
    let sent_mailbox = engine
        .with_store(|store| store.sent_mailbox(account.id))
        .ok()
        .flatten();
    let Some(sent_mailbox) = sent_mailbox else {
        return false;
    };
    let Ok(mut provider) = connector.connect(account).await else {
        return false;
    };
    let appended = provider
        .append(&sent_mailbox.provider_key, &["\\Seen"], copy_bytes)
        .await
        .is_ok();
    provider.close().await;
    appended
}

/// `mail-unsubscribe`: unsubscribes using a message's `List-Unsubscribe` /
/// `List-Unsubscribe-Post` headers (RFC 8058 one-click HTTPS POST, else RFC
/// 2369 `mailto:`). Person-only, destructive, held for approval (M18, M29).
#[must_use]
pub fn unsubscribe(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        UNSUBSCRIBE,
        "Unsubscribe using a message's List-Unsubscribe headers (one-click HTTPS POST or mailto); person-only",
        vec![
            parameter("message", JsonSchemaType::Integer, "The message, by id", true),
            parameter(
                "digest",
                JsonSchemaType::String,
                "The target digest returned by mail-unsubscribe-show",
                true,
            ),
            parameter(
                "account",
                JsonSchemaType::Integer,
                "The account to unsubscribe from, when the message is shown in more than one",
                false,
            ),
        ],
        Unsubscribe { engine },
    )
    .as_mutation()
    .with_destructive(true)
    .with_confirm_prompt("Unsubscribe from this message's mailing list")
    .with_approval(ApprovalPolicy::Required)
    .with_expose(command_line_only())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_one_click_https_when_declared_otherwise_mailto() {
        let both_one_click = concat!(
            "From: news@example.com\r\n",
            "List-Unsubscribe: <mailto:unsub@lists.example.com>, <https://lists.example.com/u/41>\r\n",
            "List-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n",
            "\r\n"
        );
        assert_eq!(
            parse_unsubscribe_headers(both_one_click.as_bytes()),
            Some(UnsubscribeTarget::OneClick {
                url: "https://lists.example.com/u/41".to_string()
            })
        );

        // Without List-Unsubscribe-Post, NEVER uses https link; falls back to mailto.
        let both_no_post = concat!(
            "From: news@example.com\r\n",
            "List-Unsubscribe: <https://lists.example.com/u/41>, <mailto:unsub@lists.example.com?subject=Leave%20List&body=Bye+now>\r\n",
            "\r\n"
        );
        assert_eq!(
            parse_unsubscribe_headers(both_no_post.as_bytes()),
            Some(UnsubscribeTarget::Mail {
                uri: "mailto:unsub@lists.example.com?subject=Leave%20List&body=Bye%2Bnow"
                    .to_string(),
                mailto: MailtoTarget {
                    to: "unsub@lists.example.com".to_string(),
                    subject: "Leave List".to_string(),
                    body: "Bye+now".to_string(),
                }
            })
        );
    }

    #[test]
    fn refuses_browser_only_http_overlong_private_and_poisoned_mailto() {
        for raw in [
            // No header
            "From: news@example.com\r\nSubject: Hi\r\n\r\n",
            // HTTPS without List-Unsubscribe-Post (browser link only)
            "From: news@example.com\r\nList-Unsubscribe: <https://lists.example.com/u/41>\r\n\r\n",
            // Plain HTTP even with List-Unsubscribe-Post
            "From: news@example.com\r\nList-Unsubscribe: <http://lists.example.com/u/41>\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n\r\n",
            // Loopback / private IP SSRF
            "From: news@example.com\r\nList-Unsubscribe: <https://127.0.0.1/u/41>\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n\r\n",
            "From: news@example.com\r\nList-Unsubscribe: <https://localhost:8443/u/41>\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n\r\n",
            // Credentials in URL
            "From: news@example.com\r\nList-Unsubscribe: <https://user:pass@lists.example.com/u/41>\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n\r\n",
            // Multiple recipients in mailto
            "From: news@example.com\r\nList-Unsubscribe: <mailto:a@example.com,b@example.com>\r\n\r\n",
            // Poisoned bcc/cc/to query param in mailto
            "From: news@example.com\r\nList-Unsubscribe: <mailto:unsub@example.com?bcc=victim@example.org>\r\n\r\n",
            "From: news@example.com\r\nList-Unsubscribe: <mailto:unsub@example.com?cc=victim@example.org>\r\n\r\n",
            // CRLF injection in mailto subject
            "From: news@example.com\r\nList-Unsubscribe: <mailto:unsub@example.com?subject=hi%0d%0aBcc:%20evil@example.org>\r\n\r\n",
            // Malformed mailto with authority (e.g. mailto://host/addr@domain)
            "From: news@example.com\r\nList-Unsubscribe: <mailto://evil.example.com/unsub@example.com>\r\n\r\n",
            // Unencoded brace in HTTPS query (rejected by RFC 3986 / hyper::Uri)
            "From: news@example.com\r\nList-Unsubscribe: <https://lists.example.com/u?x={bad}>\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n\r\n",
            // Wrong List-Unsubscribe-Post value
            "From: news@example.com\r\nList-Unsubscribe: <https://lists.example.com/u/41>\r\nList-Unsubscribe-Post: Something-Else\r\n\r\n",
        ] {
            assert_eq!(parse_unsubscribe_headers(raw.as_bytes()), None, "{raw}");
        }

        // Over 2,048 characters is refused (plugin.spec.md §6, F-T6).
        let long_path = "a".repeat(2050);
        let overlong = format!(
            "From: news@example.com\r\nList-Unsubscribe: <https://lists.example.com/{long_path}>\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n\r\n"
        );
        assert_eq!(parse_unsubscribe_headers(overlong.as_bytes()), None);
    }

    #[test]
    fn handles_folded_headers_comments_and_case_insensitive_one_click() {
        let folded = concat!(
            "From: news@example.com\r\n",
            "List-Unsubscribe: (comment <https://ignored.example.com>) <https://lists.example.com/\r\n",
            " u/41?token=abc>\r\n",
            "List-Unsubscribe-Post: (rfc8058) list-unsubscribe = one-click\r\n",
            "\r\n"
        );
        assert_eq!(
            parse_unsubscribe_headers(folded.as_bytes()),
            Some(UnsubscribeTarget::OneClick {
                url: "https://lists.example.com/u/41?token=abc".to_string()
            })
        );
    }

    #[test]
    fn digest_is_43_char_base64url_and_deterministic() {
        let d1 = compute_digest(41, 1, "one-click", "https://lists.example.com/u/41");
        let d2 = compute_digest(41, 1, "one-click", "https://lists.example.com/u/41");
        let d3 = compute_digest(41, 1, "one-click", "https://lists.example.com/u/42");
        assert_eq!(d1, d2);
        assert_ne!(d1, d3);
        assert_eq!(d1.len(), 43);
        assert!(
            d1.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        );
    }
}
