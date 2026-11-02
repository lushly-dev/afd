//! Frontmatter (phase 2 specification, section 5.1): the split of a file into its mapping and its
//! body, and the normalization of OKF's keys and Umbel's extensions under the field caps.
//!
//! AFD's reader does the YAML. Umbel decides what AFD leaves to it (step 0b's amendments): the
//! input is capped at [`MAX_FRONTMATTER_BYTES`] before the reader sees it, a leading byte order
//! mark is stripped, and an empty block is a refusal like any other that is not a mapping.

use std::fmt;

use afd::frontmatter::{self, FrontmatterError};
use serde_json::{Map, Value};
use umbel_store::{ByAt, Sensitivity, Status, Tier, Verification, validate_token};

/// The largest frontmatter block Umbel reads, fences included: 64 KiB. The cap is Umbel's, not
/// AFD's.
pub const MAX_FRONTMATTER_BYTES: usize = 64 * 1024;
/// A title is cut at this many characters.
pub const MAX_TITLE_CHARS: usize = 512;
/// A description is cut at this many bytes (4 KiB), at a character boundary.
pub const MAX_DESCRIPTION_BYTES: usize = 4 * 1024;
/// At most this many aliases are kept.
pub const MAX_ALIASES: usize = 32;
/// At most this many tags are kept.
pub const MAX_TAGS: usize = 64;
/// At most this many owners are kept (the specification names no cap; owners are copied into every
/// chunk like tags, so they get one).
pub const MAX_OWNERS: usize = 32;
/// A tag, an alias or an owner is cut at this many characters.
pub const MAX_ITEM_CHARS: usize = 128;

/// The byte order mark.
const BOM: &str = "\u{FEFF}";

/// Why a file's frontmatter cannot be read. The file is skipped with `FRONTMATTER_INVALID`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum Problem {
    /// The file is not UTF-8.
    NotUtf8,
    /// The block (opening fence to closing fence) is longer than [`MAX_FRONTMATTER_BYTES`], or
    /// does not close within that many bytes.
    TooLarge,
    /// The block between the fences holds nothing.
    Empty,
    /// AFD's reader refused it.
    Malformed(FrontmatterError),
}

impl Problem {
    /// A stable code for the reason, for a result's counts.
    pub fn reason(&self) -> &'static str {
        match self {
            Self::NotUtf8 => "not-utf8",
            Self::TooLarge => "too-large",
            Self::Empty => "empty",
            Self::Malformed(error) => match error {
                FrontmatterError::Unclosed => "unclosed",
                FrontmatterError::NotAMapping => "not-a-mapping",
                FrontmatterError::Forbidden { .. } => "forbidden",
                FrontmatterError::TooDeep { .. } => "too-deep",
                FrontmatterError::Syntax { .. } => "syntax",
                FrontmatterError::MoreThanOneDocument { .. } => "multiple-documents",
                _ => "malformed",
            },
        }
    }
}

impl fmt::Display for Problem {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotUtf8 => f.write_str("the file is not valid UTF-8"),
            Self::TooLarge => write!(
                f,
                "the frontmatter is not closed within {MAX_FRONTMATTER_BYTES} bytes"
            ),
            Self::Empty => f.write_str("the frontmatter block is empty"),
            Self::Malformed(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for Problem {}

/// A file split into frontmatter and body.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct Split<'a> {
    /// The file's text without a leading byte order mark.
    pub text: &'a str,
    /// The length of the byte order mark that was stripped: 0 or 3.
    pub bom_len: usize,
    /// The mapping, when the file has frontmatter; `None` when it has none (not an error).
    pub fields: Option<Map<String, Value>>,
    /// Where the body starts in `text`: after the closing fence line, or 0 without frontmatter.
    pub body_offset: usize,
    /// The 1-based line where the body starts: 1 without frontmatter.
    pub body_line: usize,
}

/// Split `bytes` into frontmatter and body.
///
/// A file whose first line is not `---` has **no frontmatter** and is a document of the
/// collection's default type. A file that opens a block that does not read as one mapping is
/// **malformed**. The two are never confused.
///
/// # Errors
/// The [`Problem`] that makes the file unreadable.
pub fn split(bytes: &[u8]) -> Result<Split<'_>, Problem> {
    let whole = std::str::from_utf8(bytes).map_err(|_| Problem::NotUtf8)?;
    let text = whole.strip_prefix(BOM).unwrap_or(whole);
    let bom_len = whole.len() - text.len();
    let none = |text| Split {
        text,
        bom_len,
        fields: None,
        body_offset: 0,
        body_line: 1,
    };
    if !text.starts_with("---") {
        return Ok(none(text));
    }
    // The reader sets no cap, so cut the input at the last complete line within the cap. A
    // longer block that closes later reads as unclosed here, and is reported as too large.
    let capped = if text.len() > MAX_FRONTMATTER_BYTES {
        let mut end = MAX_FRONTMATTER_BYTES;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        match text[..end].rfind('\n') {
            Some(newline) => &text[..=newline],
            None => &text[..0],
        }
    } else {
        text
    };
    match frontmatter::parse(capped) {
        Ok(None) => Ok(none(text)),
        Ok(Some(found)) => Ok(Split {
            text,
            bom_len,
            fields: Some(found.fields),
            body_offset: found.body_offset,
            body_line: found.body_line,
        }),
        Err(FrontmatterError::Unclosed) if capped.len() < text.len() => Err(Problem::TooLarge),
        Err(FrontmatterError::NotAMapping) if block_is_empty(capped) => Err(Problem::Empty),
        Err(error) => Err(Problem::Malformed(error)),
    }
}

/// Whether the block between the first two fence lines holds only blank lines and comments.
fn block_is_empty(text: &str) -> bool {
    text.split_inclusive('\n')
        .skip(1)
        .take_while(|line| line.trim_end_matches(['\n', '\r']) != "---")
        .all(|line| {
            let trimmed = line.trim();
            trimmed.is_empty() || trimmed.starts_with('#')
        })
}

/// An `access` key as the file declares it.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
#[non_exhaustive]
pub enum Declared {
    /// The key is absent.
    #[default]
    Absent,
    /// A valid access set: tokens as written, in file order, deduplicated.
    Set(Vec<String>),
    /// The key is present and is not a list of valid tokens; the file is skipped
    /// (`ACCESS_INVALID`) rather than made more readable than it asked to be.
    Invalid,
}

/// Which frontmatter values were present and unusable. The schema pack's check reports them in
/// detail; this lets ingestion note it without a schema.
pub type Unusable = Vec<&'static str>;

/// The frontmatter's keys in the shape the document record stores them (section 5.4), under the
/// caps of section 5.1.
#[derive(Debug, Clone, PartialEq, Default)]
#[non_exhaustive]
pub struct Normalized {
    /// `type`, when present and a non-empty string.
    pub doc_type: Option<String>,
    /// `title`, cut at [`MAX_TITLE_CHARS`].
    pub title: Option<String>,
    /// `description`, cut at [`MAX_DESCRIPTION_BYTES`].
    pub description: Option<String>,
    /// `tags`, at most [`MAX_TAGS`], each cut at [`MAX_ITEM_CHARS`].
    pub tags: Vec<String>,
    /// `aliases`, at most [`MAX_ALIASES`].
    pub aliases: Vec<String>,
    /// `owners`, OKF actors, at most [`MAX_OWNERS`].
    pub owners: Vec<String>,
    /// `status`; `stable` when absent or not one of the three.
    pub status: Option<Status>,
    /// `stale_after`, when an absolute datetime with a UTC offset.
    pub stale_after: Option<String>,
    /// `superseded_by`, a document id or a `/`-prefixed path.
    pub superseded_by: Option<String>,
    /// `verified`, derived (section 9.3).
    pub verification: Option<Verification>,
    /// `generated`, when `{ by, at }` with `at` carrying a UTC offset.
    pub generated: Option<ByAt>,
    /// `access`, as declared.
    pub access: Declared,
    /// `sensitivity`, when one of the four.
    pub sensitivity: Option<Sensitivity>,
    /// Whether a value was cut or a list shortened (the flag `fields-limited`).
    pub fields_limited: bool,
    /// The keys whose values had the wrong shape.
    pub unusable: Unusable,
    /// `okf_version`, as written, when a string.
    pub okf_version: Option<String>,
}

/// Cut `text` to `max` characters at a character boundary.
fn cut_chars(text: &str, max: usize) -> (&str, bool) {
    match text.char_indices().nth(max) {
        Some((end, _)) => (&text[..end], true),
        None => (text, false),
    }
}

/// Cut `text` to at most `max` bytes at a character boundary.
fn cut_bytes(text: &str, max: usize) -> (&str, bool) {
    if text.len() <= max {
        return (text, false);
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    (&text[..end], true)
}

/// A list of strings from a YAML sequence or a single string; scalars are written out, other
/// values are not usable. Returns `None` for a value that is neither.
fn string_list(value: &Value) -> Option<Vec<String>> {
    match value {
        Value::String(single) => Some(vec![single.clone()]),
        Value::Array(items) => Some(
            items
                .iter()
                .filter_map(|item| match item {
                    Value::String(text) => Some(text.clone()),
                    Value::Number(number) => Some(number.to_string()),
                    Value::Bool(flag) => Some(flag.to_string()),
                    _ => None,
                })
                .collect(),
        ),
        _ => None,
    }
}

/// `YYYY-MM-DDTHH:MM:SS[.fff](Z|±HH:MM)`: an absolute datetime with a UTC offset, as OKF requires.
pub fn is_datetime_with_offset(text: &str) -> bool {
    let bytes = text.as_bytes();
    let digit = |at: usize| bytes.get(at).is_some_and(u8::is_ascii_digit);
    let digits = |from: usize, count: usize| (from..from + count).all(digit);
    let at = |index: usize, wanted: u8| bytes.get(index) == Some(&wanted);
    if !(digits(0, 4)
        && at(4, b'-')
        && digits(5, 2)
        && at(7, b'-')
        && digits(8, 2)
        && (at(10, b'T') || at(10, b't'))
        && digits(11, 2)
        && at(13, b':')
        && digits(14, 2)
        && at(16, b':')
        && digits(17, 2))
    {
        return false;
    }
    let mut index = 19;
    if at(index, b'.') {
        index += 1;
        let start = index;
        while digit(index) {
            index += 1;
        }
        if index == start {
            return false;
        }
    }
    match bytes.get(index) {
        Some(b'Z' | b'z') => index + 1 == bytes.len(),
        Some(b'+' | b'-') => {
            digits(index + 1, 2)
                && at(index + 3, b':')
                && digits(index + 4, 2)
                && index + 6 == bytes.len()
        }
        _ => false,
    }
}

fn by_at(value: &Value) -> Option<ByAt> {
    let map = value.as_object()?;
    let by = map.get("by")?.as_str().filter(|by| !by.is_empty())?;
    let at = map
        .get("at")?
        .as_str()
        .filter(|at| is_datetime_with_offset(at))?;
    Some(ByAt {
        by: by.to_owned(),
        at: at.to_owned(),
    })
}

/// The tier and the latest entry of OKF's `verified` (a list, or one mapping), against the
/// document's owners (section 9.3).
fn verification(value: &Value, owners: &[String]) -> Verification {
    let entries: Vec<ByAt> = match value {
        Value::Array(items) => items.iter().filter_map(by_at).collect(),
        single => by_at(single).into_iter().collect(),
    };
    let tier = if entries.is_empty() {
        Tier::Unverified
    } else if entries
        .iter()
        .any(|entry| entry.by.starts_with("human:") && owners.contains(&entry.by))
    {
        Tier::Owner
    } else if entries.iter().any(|entry| entry.by.starts_with("human:")) {
        Tier::Human
    } else {
        Tier::Machine
    };
    Verification {
        tier,
        count: u32::try_from(entries.len()).unwrap_or(u32::MAX),
        last: entries.last().cloned(),
    }
}

/// Read the OKF keys and Umbel's extensions out of a frontmatter mapping. Unknown keys are not
/// touched (the stored frontmatter keeps the mapping whole); a value of the wrong shape is
/// ignored and listed in [`Normalized::unusable`].
pub fn normalize(fields: &Map<String, Value>) -> Normalized {
    let mut out = Normalized::default();
    fn bad(key: &'static str, out: &mut Normalized) {
        out.unusable.push(key);
    }

    if let Some(value) = fields.get("type") {
        match value.as_str().map(str::trim) {
            Some(text) if !text.is_empty() => out.doc_type = Some(text.to_owned()),
            _ => bad("type", &mut out),
        }
    }
    if let Some(value) = fields.get("title") {
        match value.as_str().map(str::trim) {
            Some(text) if !text.is_empty() => {
                let (kept, cut) = cut_chars(text, MAX_TITLE_CHARS);
                out.fields_limited |= cut;
                out.title = Some(kept.to_owned());
            }
            _ => bad("title", &mut out),
        }
    }
    if let Some(value) = fields.get("description") {
        match value.as_str() {
            Some(text) => {
                let (kept, cut) = cut_bytes(text.trim(), MAX_DESCRIPTION_BYTES);
                out.fields_limited |= cut;
                out.description = Some(kept.to_owned());
            }
            None => bad("description", &mut out),
        }
    }
    for (key, max, target) in [
        ("tags", MAX_TAGS, 0),
        ("aliases", MAX_ALIASES, 1),
        ("owners", MAX_OWNERS, 2),
    ] {
        let Some(value) = fields.get(key) else {
            continue;
        };
        let Some(items) = string_list(value) else {
            bad(key, &mut out);
            continue;
        };
        let mut kept: Vec<String> = Vec::new();
        for item in items {
            let item = item.trim();
            if item.is_empty() {
                continue;
            }
            let (item, cut) = cut_chars(item, MAX_ITEM_CHARS);
            out.fields_limited |= cut;
            if !kept.iter().any(|known| known == item) {
                kept.push(item.to_owned());
            }
        }
        if kept.len() > max {
            kept.truncate(max);
            out.fields_limited = true;
        }
        match target {
            0 => out.tags = kept,
            1 => out.aliases = kept,
            _ => out.owners = kept,
        }
    }
    if let Some(value) = fields.get("status") {
        match value.as_str() {
            Some("draft") => out.status = Some(Status::Draft),
            Some("stable") => out.status = Some(Status::Stable),
            Some("deprecated") => out.status = Some(Status::Deprecated),
            _ => bad("status", &mut out),
        }
    }
    if let Some(value) = fields.get("stale_after") {
        match value.as_str().filter(|text| is_datetime_with_offset(text)) {
            Some(text) => out.stale_after = Some(text.to_owned()),
            None => bad("stale_after", &mut out),
        }
    }
    if let Some(value) = fields.get("superseded_by") {
        match value
            .as_str()
            .map(str::trim)
            .filter(|text| !text.is_empty())
        {
            Some(text) => out.superseded_by = Some(text.to_owned()),
            None => bad("superseded_by", &mut out),
        }
    }
    if let Some(value) = fields.get("generated") {
        match by_at(value) {
            Some(generated) => out.generated = Some(generated),
            None => bad("generated", &mut out),
        }
    }
    if let Some(value) = fields.get("verified") {
        out.verification = Some(verification(value, &out.owners));
    }
    if let Some(value) = fields.get("access") {
        out.access = match string_list(value) {
            Some(tokens)
                if !tokens.is_empty() && tokens.iter().all(|t| validate_token(t).is_ok()) =>
            {
                let mut set: Vec<String> = Vec::new();
                for token in tokens {
                    if !set.contains(&token) {
                        set.push(token);
                    }
                }
                Declared::Set(set)
            }
            _ => Declared::Invalid,
        };
    }
    if let Some(value) = fields.get("sensitivity") {
        match value.as_str() {
            Some("public") => out.sensitivity = Some(Sensitivity::Public),
            Some("internal") => out.sensitivity = Some(Sensitivity::Internal),
            Some("confidential") => out.sensitivity = Some(Sensitivity::Confidential),
            Some("restricted") => out.sensitivity = Some(Sensitivity::Restricted),
            _ => bad("sensitivity", &mut out),
        }
    }
    if let Some(value) = fields.get("okf_version") {
        out.okf_version = match value {
            Value::String(text) => Some(text.clone()),
            other => Some(other.to_string()),
        };
    }
    out
}
