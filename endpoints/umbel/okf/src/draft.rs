//! The curator's fixed draft rendering and its id derivations (phase 4 specification, sections
//! 3.2, 4.4 and 4.5; D91, D93), shared so that the curator renders a draft and the knowledge
//! plugin re-renders it to verify, without either plugin depending on the other.
//!
//! Every function here is pure: the same inputs give the same bytes on every run and platform.
//! Ids, paths and keys are content-free: each is a hash of record ids, never of memory text.
//!
//! - [`render`]: a draft's file, from its memory sources, the drafter and the settling instant;
//! - [`Rationale`]: a draft's fixed rationale and its exact inverse;
//! - [`subject_key`] and [`subject_key_digest`]: the normalised subject a conflict set groups on;
//! - [`candidate_id`], [`conflict_set_id`], [`document_id`] (with [`is_safe_prefix`]),
//!   [`idempotency_key`] and [`proposal_id`];
//! - [`excerpt`]: the first [`EXCERPT_CHARS`] characters of a record's text;
//! - [`settled_at`]: the settling instant a rendering carries in `generated.at`.

use std::fmt::Write as _;

use umbel_store::memory::{Millis, format_instant, parse_instant};
use umbel_store::{Authority, ContentHash, MemoryClass};

/// The most memory sources one draft cites (section 2.3).
pub const MAX_SOURCES: usize = 32;
/// The characters of a record's text an evidence entry's `excerpt` holds (section 4.5).
pub const EXCERPT_CHARS: usize = 1000;
/// The hex digits of SHA-256 each derived id keeps.
const ID_HEX: usize = 20;

/// What one draft renders: the group's shared subject and text (equal content hashes mean equal
/// subject and text), the union of its records' tags and constraints, the drafter, and the
/// candidate's settling instant.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Draft<'a> {
    /// The group's class: `semantic` renders a `fact`, `procedural` a `procedure`.
    pub class: MemoryClass,
    /// The records' one-line subject: the title.
    pub subject: &'a str,
    /// The records' text: the body.
    pub text: &'a str,
    /// The records' tags; [`render`] sorts them and keeps each once.
    pub tags: Vec<String>,
    /// The records' constraints; [`render`] sorts them and keeps each once.
    pub constraints: Vec<String>,
    /// The drafting plugin's id, as the host attests it.
    pub plugin: &'a str,
    /// The drafting instance, as the host attests it.
    pub instance: &'a str,
    /// The candidate's settling instant, `generated.at`.
    pub settled_at: Millis,
}

/// The document type a class renders as, or `None` for `episodic`, which never settles (D15).
#[must_use]
pub fn doc_type(class: MemoryClass) -> Option<&'static str> {
    match class {
        MemoryClass::Semantic => Some("fact"),
        MemoryClass::Procedural => Some("procedure"),
        MemoryClass::Episodic => None,
    }
}

/// `text` as a YAML double-quoted scalar: JSON's escapes (a subset of YAML's), and also `\u`
/// escapes for the characters YAML does not take raw or reads as line breaks (C1 controls,
/// U+2028, U+2029, the byte order mark), so every value stays on its one line.
#[must_use]
pub fn quoted(text: &str) -> String {
    let json = serde_json::to_string(text).unwrap_or_else(|_| "\"\"".to_owned());
    let mut out = String::with_capacity(json.len());
    for c in json.chars() {
        if matches!(
            c,
            '\u{80}'..='\u{9f}' | '\u{2028}' | '\u{2029}' | '\u{feff}'
        ) {
            let _ = write!(out, "\\u{:04x}", u32::from(c));
        } else {
            out.push(c);
        }
    }
    out
}

/// `items` sorted, each once.
fn sorted(items: &[String]) -> Vec<String> {
    let mut items = items.to_vec();
    items.sort();
    items.dedup();
    items
}

/// The draft's file: the fixed rendering of section 4.5.
///
/// ```text
/// ---
/// title: "<subject>"
/// type: "<fact | procedure>"
/// tags: [<the tags>]
/// generated:
///   by: "umbel:<plugin>/<instance>"
///   at: "<settled at>"
/// ---
/// <text>
///
/// ## Holds only
///
/// - "<each constraint>"
/// ```
///
/// The text ends with a newline (one is added when it has none). `Holds only` appears only when
/// there are constraints. An `episodic` class renders as `fact`; callers never draft one.
#[must_use]
pub fn render(draft: &Draft<'_>) -> String {
    let mut out = String::new();
    let tags = sorted(&draft.tags)
        .iter()
        .map(|tag| quoted(tag))
        .collect::<Vec<_>>()
        .join(", ");
    let _ = write!(
        out,
        "---\ntitle: {}\ntype: \"{}\"\ntags: [{tags}]\ngenerated:\n  by: {}\n  at: \"{}\"\n---\n",
        quoted(draft.subject),
        doc_type(draft.class).unwrap_or("fact"),
        quoted(&format!("umbel:{}/{}", draft.plugin, draft.instance)),
        format_instant(draft.settled_at),
    );
    out.push_str(draft.text);
    if !draft.text.ends_with('\n') {
        out.push('\n');
    }
    let constraints = sorted(&draft.constraints);
    if !constraints.is_empty() {
        out.push_str("\n## Holds only\n\n");
        for constraint in &constraints {
            let _ = writeln!(out, "- {}", quoted(constraint));
        }
    }
    out
}

/// The settling instant a rendering's frontmatter carries in `generated.at`, when it is an instant
/// in the canonical form [`format_instant`] writes (`YYYY-MM-DDTHH:MM:SS.mmmZ`).
#[must_use]
pub fn settled_at(content: &str) -> Option<Millis> {
    let fields = crate::frontmatter::split(content.as_bytes()).ok()?.fields?;
    let at = fields.get("generated")?.get("at")?.as_str()?;
    let ms = parse_instant(at).ok()?;
    (format_instant(ms) == at).then_some(ms)
}

/// A draft's rationale (section 4.5): fixed text from the candidate's snapshot, so it never
/// changes between runs, and [`Rationale::parse`] is its exact inverse.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rationale {
    /// The group's class.
    pub class: MemoryClass,
    /// The candidate's authority when it became ready: the highest of its records'.
    pub authority: Authority,
    /// The sessions the snapshot counted: the sum of the records' observed sessions.
    pub sessions: u64,
    /// The distinct principals among the records.
    pub principals: u64,
    /// The settling instant, `generated.at`.
    pub settled_at: Millis,
}

fn plural(count: u64, one: &'static str, many: &'static str) -> &'static str {
    if count == 1 { one } else { many }
}

impl Rationale {
    /// `Drafted from <class> memory of authority <authority>, observed in <n> session(s) by <m>
    /// principal(s), settled at <instant>.`
    #[must_use]
    pub fn render(&self) -> String {
        format!(
            "Drafted from {} memory of authority {}, observed in {} {} by {} {}, settled at {}.",
            self.class.as_str(),
            self.authority.as_str(),
            self.sessions,
            plural(self.sessions, "session", "sessions"),
            self.principals,
            plural(self.principals, "principal", "principals"),
            format_instant(self.settled_at),
        )
    }

    /// The rationale `text` renders, or `None` when it is not exactly a [`Rationale::render`].
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        let rest = text.strip_prefix("Drafted from ")?;
        let (class, rest) = rest.split_once(" memory of authority ")?;
        let (authority, rest) = rest.split_once(", observed in ")?;
        let (sessions, rest) = rest.split_once(' ')?;
        let (_, rest) = rest.split_once(" by ")?;
        let (principals, rest) = rest.split_once(' ')?;
        let (_, rest) = rest.split_once(", settled at ")?;
        let at = rest.strip_suffix('.')?;
        let parsed = Self {
            class: MemoryClass::parse(class)?,
            authority: Authority::parse(authority)?,
            sessions: sessions.parse().ok()?,
            principals: principals.parse().ok()?,
            settled_at: parse_instant(at).ok()?,
        };
        (parsed.render() == text).then_some(parsed)
    }
}

/// Section 4.4's normalised subject: lowercased, each run of whitespace and ASCII punctuation one
/// space, trimmed. It is memory text: a curator record keeps only [`subject_key_digest`].
#[must_use]
pub fn subject_key(subject: &str) -> String {
    let mut out = String::with_capacity(subject.len());
    let mut gap = false;
    for c in subject.to_lowercase().chars() {
        if c.is_whitespace() || c.is_ascii_punctuation() {
            gap = true;
        } else {
            if gap && !out.is_empty() {
                out.push(' ');
            }
            gap = false;
            out.push(c);
        }
    }
    out
}

/// `sha256:` of [`subject_key`]: what a candidate keeps (phase 4 step 1, amendment 11).
#[must_use]
pub fn subject_key_digest(subject: &str) -> String {
    ContentHash::of(subject_key(subject).as_bytes()).to_string()
}

/// `<prefix>` and 20 hex digits of SHA-256 of `parts` joined by NUL.
fn derive(prefix: &str, parts: &[&str]) -> String {
    let hash = ContentHash::of(parts.join("\0").as_bytes());
    let hex = hash.as_str().strip_prefix("sha256:").unwrap_or_default();
    format!("{prefix}{}", &hex[..ID_HEX])
}

/// Whether `id` is `<prefix>` and 20 lowercase hex digits.
fn has_form(id: &str, prefix: &str) -> bool {
    id.strip_prefix(prefix).is_some_and(|hex| {
        hex.len() == ID_HEX && hex.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
    })
}

/// A candidate's id (section 2.3): `c-` and 20 hex of SHA-256 of `<space>\0<principal>\0<the
/// lowest source memory id>`. Memory ids are random, so it says nothing about content.
#[must_use]
pub fn candidate_id(space: &str, principal: &str, lowest_source: &str) -> String {
    derive("c-", &[space, principal, lowest_source])
}

/// Whether `id` has a candidate id's form.
#[must_use]
pub fn is_candidate_id(id: &str) -> bool {
    has_form(id, "c-")
}

/// A conflict set's id (section 4.4): `k-` and 20 hex of SHA-256 of `<space>\0<principal>\0<the
/// lowest member candidate id>`, fixed when the set first forms.
#[must_use]
pub fn conflict_set_id(space: &str, principal: &str, lowest_member: &str) -> String {
    derive("k-", &[space, principal, lowest_member])
}

/// Whether `id` has a conflict set id's form.
#[must_use]
pub fn is_conflict_set_id(id: &str) -> bool {
    has_form(id, "k-")
}

/// The most segments a target's prefix holds.
pub const MAX_PREFIX_SEGMENTS: usize = 8;

/// Whether `prefix` is a safe, fixed target prefix (phase 4 step 3c, amendment 14): one to
/// [`MAX_PREFIX_SEGMENTS`] segments joined by `/`, each a lowercase ASCII letter or digit then up
/// to 62 more of those, `-` or `_`. So no empty, `.` or `..` segment, no leading or trailing `/`,
/// no hidden directory and nothing a document id or a file path would read otherwise.
#[must_use]
pub fn is_safe_prefix(prefix: &str) -> bool {
    let segments: Vec<&str> = prefix.split('/').collect();
    !prefix.is_empty()
        && segments.len() <= MAX_PREFIX_SEGMENTS
        && segments.iter().all(|segment| {
            let bytes = segment.as_bytes();
            !bytes.is_empty()
                && bytes.len() <= 63
                && matches!(bytes[0], b'a'..=b'z' | b'0'..=b'9')
                && bytes
                    .iter()
                    .all(|b| matches!(b, b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_'))
        })
}

/// A draft's document id (section 4.5, with phase 4 step 3c's amendment 14):
/// `<collection>/<prefix>/<id>`, or `<collection>/<id>` without a prefix, where `id` is the
/// candidate id, or the conflict set id for alternatives; its file is `<prefix>/<id>.md` in the
/// collection. The collection and prefix are the drafter's configured target, which the knowledge
/// instance holds and enforces, so no drafter-chosen text is in the path.
#[must_use]
pub fn document_id(collection: &str, prefix: Option<&str>, id: &str) -> String {
    match prefix {
        Some(prefix) => format!("{collection}/{prefix}/{id}"),
        None => format!("{collection}/{id}"),
    }
}

/// A draft's idempotency key (section 4.5): `<instance>/<candidate id>/<drafts>`, so a rerun
/// renders the same key and a changed source, which increments `drafts`, a new one.
#[must_use]
pub fn idempotency_key(instance: &str, candidate: &str, drafts: u32) -> String {
    format!("{instance}/{candidate}/{drafts}")
}

/// A proposal's id (phase 2's derivation, shared since phase 4 step 5): `p-` and 20 hex of SHA-256
/// of `<space>\0<proposer actor string>\0<idempotency key>`, the actor string `<kind>:<id>`. The
/// knowledge plugin assigns it; the curator derives it for the key it submits, so a run that
/// stopped after its batch can withdraw what it drafted. Content-free whenever the key is.
#[must_use]
pub fn proposal_id(space: &str, actor: &str, key: &str) -> String {
    derive("p-", &[space, actor, key])
}

/// Whether `id` has a proposal id's form.
#[must_use]
pub fn is_proposal_id(id: &str) -> bool {
    has_form(id, "p-")
}

/// Whether `key` is [`idempotency_key`] of `instance` and `candidate` for some draft count, the
/// count written in decimal without leading zeros.
#[must_use]
pub fn is_idempotency_key(key: &str, instance: &str, candidate: &str) -> bool {
    key.strip_prefix(instance)
        .and_then(|rest| rest.strip_prefix('/'))
        .and_then(|rest| rest.strip_prefix(candidate))
        .and_then(|rest| rest.strip_prefix('/'))
        .and_then(|drafts| drafts.parse::<u32>().ok().map(|n| (n, drafts)))
        .is_some_and(|(n, drafts)| n.to_string() == drafts)
}

/// The first [`EXCERPT_CHARS`] characters of `text`.
#[must_use]
pub fn excerpt(text: &str) -> String {
    text.chars().take(EXCERPT_CHARS).collect()
}
