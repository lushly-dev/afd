//! The Claude Code transcript reader (section 10.3): text turns, in file order, from a session's
//! JSON-lines transcript. **User and assistant text only**: tool calls and their output, thinking,
//! summaries, harness lines and every other line type are left out, with no flag to include them.
//!
//! The format is not a documented contract (W18). The rules come from the structure of local
//! sessions, read without their text, and every excluded kind has a line in the test fixture.

use std::collections::BTreeMap;

use serde_json::Value;

/// Who wrote a turn.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Role {
    User,
    Assistant,
}

impl Role {
    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::User => "[user]",
            Self::Assistant => "[assistant]",
        }
    }
}

/// One text turn.
#[derive(Clone, Debug)]
pub(crate) struct Turn {
    /// Its position among the session's text turns, from 0.
    pub index: u64,
    /// The byte offset of its first line (for an assistant turn, of its message's first line).
    pub offset: u64,
    pub role: Role,
    /// Its text; empty when the scan did not collect text.
    pub text: String,
    /// Its first line's `timestamp`, when it is one.
    pub timestamp: Option<String>,
}

/// What one scan found.
#[derive(Debug, Default)]
pub(crate) struct Scan {
    /// The turns, the last possibly still open.
    pub turns: Vec<Turn>,
    /// Where the next scan starts with a clean reader: the end of the complete lines, or the first
    /// line of an assistant message still open there.
    pub resume_offset: u64,
    /// The turns before `resume_offset`, counted from the session's start.
    pub resume_turns: u64,
    /// Every turn counted, the open one included.
    pub total: u64,
    /// Lines that did not parse. A torn last line is not counted: it is read next time.
    pub unparsed: u64,
    /// Lines left out for a value the reader does not know (`origin.kind`, `turnOrigin`).
    pub unknown: u64,
    /// The last `version` seen on a conversation line.
    pub version: Option<String>,
}

/// Leading text that marks a harness wrapper rather than a person's words.
const WRAPPERS: [&str; 8] = [
    "<task-notification",
    "<command-",
    "<local-command",
    "<system-reminder",
    "<bash-",
    "<user-prompt-submit-hook",
    "Caveat:",
    "[Request interrupted",
];

/// The `origin.kind` values that are known and left out (others are left out and counted).
const KNOWN_ORIGINS: [&str; 2] = ["task-notification", "peer"];
/// The `turnOrigin` values that are known and left out.
const KNOWN_TURN_ORIGINS: [&str; 3] = ["task_notification", "scheduled", "peer"];

/// What a line is to the reader.
enum Line {
    /// A person's text turn.
    Human(String),
    /// An assistant line: its message id and its text blocks (possibly none).
    Assistant { id: String, texts: Vec<String> },
    /// Not conversation, or excluded.
    Skip,
    /// Excluded for a value the reader does not know.
    Unknown,
}

fn is_true(line: &Value, key: &str) -> bool {
    line.get(key).and_then(Value::as_bool) == Some(true)
}

fn wrapper(text: &str) -> bool {
    let text = text.trim_start();
    WRAPPERS.iter().any(|prefix| text.starts_with(prefix))
}

/// The text blocks of a content value (a string, or an array of blocks), dropping harness
/// wrappers. `None` when the content holds a `tool_result` block.
fn texts(content: Option<&Value>) -> Option<Vec<String>> {
    let mut texts = Vec::new();
    match content {
        Some(Value::String(text)) => texts.push(text.clone()),
        Some(Value::Array(blocks)) => {
            for block in blocks {
                match block.get("type").and_then(Value::as_str) {
                    Some("tool_result") => return None,
                    Some("text") => {
                        if let Some(text) = block.get("text").and_then(Value::as_str) {
                            texts.push(text.to_owned());
                        }
                    }
                    // Thinking, tool_use, image and every other block are not text.
                    _ => {}
                }
            }
        }
        _ => {}
    }
    texts.retain(|text| !text.trim().is_empty() && !wrapper(text));
    Some(texts)
}

/// `Ok(())` for an `origin` absent or `human`; `Err(true)` for an unknown kind.
fn origin_ok(origin: Option<&Value>) -> Result<(), bool> {
    match origin {
        None | Some(Value::Null) => Ok(()),
        Some(origin) => match origin.get("kind").and_then(Value::as_str) {
            None | Some("human") => Ok(()),
            Some(kind) => Err(!KNOWN_ORIGINS.contains(&kind)),
        },
    }
}

fn classify(line: &Value) -> Line {
    if !line.is_object() || is_true(line, "isSidechain") {
        return Line::Skip;
    }
    match line.get("type").and_then(Value::as_str) {
        Some("user") => user(line),
        Some("assistant") => assistant(line),
        Some("attachment") => attachment(line),
        // `system` and every other line type are not conversation.
        _ => Line::Skip,
    }
}

fn user(line: &Value) -> Line {
    if ["isMeta", "isCompactSummary", "isVisibleInTranscriptOnly"]
        .iter()
        .any(|key| is_true(line, key))
        || line.get("toolUseResult").is_some()
        || line.get("sourceToolAssistantUUID").is_some()
    {
        return Line::Skip;
    }
    if let Err(unknown) = origin_ok(line.get("origin")) {
        return if unknown { Line::Unknown } else { Line::Skip };
    }
    match line.get("turnOrigin") {
        None | Some(Value::Null) => {}
        Some(value) => match value.as_str() {
            Some("human" | "sdk") => {}
            Some(known) if KNOWN_TURN_ORIGINS.contains(&known) => return Line::Skip,
            _ => return Line::Unknown,
        },
    }
    if line.get("promptSource").and_then(Value::as_str) == Some("system") {
        return Line::Skip;
    }
    match texts(line.pointer("/message/content")) {
        Some(texts) if !texts.is_empty() => Line::Human(texts.join("\n\n")),
        _ => Line::Skip,
    }
}

fn assistant(line: &Value) -> Line {
    if is_true(line, "isApiErrorMessage")
        || is_true(line, "isMeta")
        || line.pointer("/message/model").and_then(Value::as_str) == Some("<synthetic>")
    {
        return Line::Skip;
    }
    let Some(id) = line
        .pointer("/message/id")
        .and_then(Value::as_str)
        .map(|id| format!("m:{id}"))
        .or_else(|| {
            line.get("uuid")
                .and_then(Value::as_str)
                .map(|uuid| format!("u:{uuid}"))
        })
    else {
        return Line::Skip;
    };
    match texts(line.pointer("/message/content")) {
        Some(texts) => Line::Assistant { id, texts },
        None => Line::Skip,
    }
}

/// A message a person sent while a turn was running: a `queued_command` attachment in prompt
/// mode, not meta, from a person. Every other attachment, `hook_additional_context` included, is
/// left out, so a bundle injected at session start is never captured back.
fn attachment(line: &Value) -> Line {
    let Some(attachment) = line.get("attachment") else {
        return Line::Skip;
    };
    if attachment.get("type").and_then(Value::as_str) != Some("queued_command")
        || attachment.get("commandMode").and_then(Value::as_str) != Some("prompt")
        || is_true(line, "isMeta")
        || is_true(attachment, "isMeta")
    {
        return Line::Skip;
    }
    if let Err(unknown) = origin_ok(attachment.get("origin")) {
        return if unknown { Line::Unknown } else { Line::Skip };
    }
    match texts(attachment.get("prompt")) {
        Some(texts) if !texts.is_empty() => Line::Human(texts.join("\n\n")),
        _ => Line::Skip,
    }
}

/// The assistant message being read.
struct Open {
    id: String,
    offset: u64,
    timestamp: Option<String>,
    texts: Vec<String>,
    has_text: bool,
}

/// End the open message: a turn when it held text.
fn close(open: &mut Option<Open>, turns: &mut Vec<Turn>, index: &mut u64) {
    if let Some(message) = open.take().filter(|message| message.has_text) {
        turns.push(Turn {
            index: *index,
            offset: message.offset,
            role: Role::Assistant,
            text: message.texts.join("\n\n"),
            timestamp: message.timestamp,
        });
        *index += 1;
    }
}

/// Read the text turns of `bytes`, which start at byte `base` of the transcript, at a clean point
/// with `first_index` turns before it. `ids` holds every message id seen with its message's first
/// offset, and gains the new ones. With `collect` false only turns are counted, and no text kept.
pub(crate) fn scan(
    bytes: &[u8],
    base: u64,
    first_index: u64,
    ids: &mut BTreeMap<String, u64>,
    collect: bool,
) -> Scan {
    let mut scan = Scan::default();
    let mut index = first_index;
    let mut open: Option<Open> = None;
    let mut end = 0usize;
    while let Some(newline) = bytes[end..].iter().position(|&b| b == b'\n') {
        let start = end;
        end = start + newline + 1;
        let offset = base + start as u64;
        let raw = &bytes[start..start + newline];
        if raw.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        let Ok(line) = serde_json::from_slice::<Value>(raw) else {
            scan.unparsed += 1;
            continue;
        };
        let timestamp = line
            .get("timestamp")
            .and_then(Value::as_str)
            .map(str::to_owned);
        let classified = classify(&line);
        if matches!(classified, Line::Human(_) | Line::Assistant { .. })
            && let Some(version) = line.get("version").and_then(Value::as_str)
        {
            scan.version = Some(version.to_owned());
        }
        match classified {
            Line::Skip => {}
            Line::Unknown => scan.unknown += 1,
            Line::Human(text) => {
                close(&mut open, &mut scan.turns, &mut index);
                scan.turns.push(Turn {
                    index,
                    offset,
                    role: Role::User,
                    text: if collect { text } else { String::new() },
                    timestamp,
                });
                index += 1;
            }
            Line::Assistant { id, texts } => {
                let joins = open.as_ref().is_some_and(|message| message.id == id);
                if !joins {
                    // An id first seen before this line, with another message between, is a repeat.
                    if ids.get(&id).is_some_and(|&first| first < offset) {
                        continue;
                    }
                    close(&mut open, &mut scan.turns, &mut index);
                    ids.insert(id.clone(), offset);
                    open = Some(Open {
                        id,
                        offset,
                        timestamp,
                        texts: Vec::new(),
                        has_text: false,
                    });
                }
                if let Some(message) = open.as_mut() {
                    for text in texts {
                        message.has_text = true;
                        // An exact repeat within one message is dropped.
                        if collect && !message.texts.contains(&text) {
                            message.texts.push(text);
                        }
                    }
                }
            }
        }
    }
    // The open message, if any, is the last turn; the next scan reads it again from its start.
    let resume = open.as_ref().map(|message| message.offset);
    let before = index;
    close(&mut open, &mut scan.turns, &mut index);
    scan.total = index;
    match resume {
        Some(offset) => {
            scan.resume_offset = offset;
            scan.resume_turns = before;
        }
        None => {
            scan.resume_offset = base + end as u64;
            scan.resume_turns = index;
        }
    }
    scan
}
