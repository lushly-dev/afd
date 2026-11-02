//! The write scan (phase 2 specification, section 11): the patterns of AFD's
//! `description-injection` rule, and the check for hidden text.
//!
//! The patterns were ported from `packages/testing/src/surface/injection.ts` and are pinned by
//! test vectors shared with that package (`packages/testing/src/surface/injection-vectors.json`).
//! The host's mounted loader scans tool descriptions with them; `umbel-okf` scans documents.
//! Moving them here means neither links the other's dependencies: the host does not link
//! pulldown-cmark.
//!
//! The scan **flags and never blocks**: its findings are advisory (a runbook that says "ignore the
//! previous step's output" matches the first pattern and is not an attack), and a caller labels
//! what it stores, it does not refuse it.

use std::sync::OnceLock;

use regex::Regex;
use serde_json::Value;

/// One built-in injection pattern.
struct Pattern {
    id: &'static str,
    regex: Regex,
}

/// `(id, source)`, in the TypeScript package's order. ASCII-only (`(?-u)`), as JavaScript's `\b`
/// is; matching is case-insensitive.
const SOURCES: &[(&str, &str)] = &[
    (
        "imperative-override",
        r"(?i-u)\b(ignore|forget|disregard)\s+(previous|all|other|above)\b",
    ),
    (
        "role-assignment",
        r"(?i-u)(?:^|[.!?]\s*)you\s+(are\s+a|must\s+always|should\s+always|will\s+always)\b",
    ),
    (
        "system-prompt-fragment",
        r"(?i-u)\b(system\s*prompt|system\s*message|<<\s*SYS)\b",
    ),
    (
        "hidden-instruction",
        r"(?i-u)(?:^|[.!?]\s*)(always|never)\s+(call|use|invoke|run|execute)\s+this\b",
    ),
];

fn patterns() -> &'static [Pattern] {
    static PATTERNS: OnceLock<Vec<Pattern>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        SOURCES
            .iter()
            .filter_map(|(id, source)| Regex::new(source).ok().map(|regex| Pattern { id, regex }))
            .collect()
    })
}

/// A description that matched a pattern of the rule.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct InjectionHit {
    /// The pattern's id, such as `imperative-override`.
    pub pattern: &'static str,
    /// The text that matched.
    pub matched: String,
}

/// The ids of the patterns `text` matches, in the rule's order.
pub fn scan_description(text: &str) -> Vec<InjectionHit> {
    patterns()
        .iter()
        .filter_map(|pattern| {
            pattern.regex.find(text).map(|found| InjectionHit {
                pattern: pattern.id,
                matched: found.as_str().to_owned(),
            })
        })
        .collect()
}

/// Every `description` string anywhere in a JSON schema (a property's, a nested one's), scanned.
/// Returns `(json pointer of the description, hit)`.
pub fn scan_schema_descriptions(schema: &Value) -> Vec<(String, InjectionHit)> {
    let mut found = Vec::new();
    walk(schema, "", &mut found);
    found
}

fn walk(value: &Value, pointer: &str, found: &mut Vec<(String, InjectionHit)>) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                let here = format!("{pointer}/{}", key.replace('~', "~0").replace('/', "~1"));
                match (key.as_str(), child) {
                    ("description", Value::String(text)) => {
                        for hit in scan_description(text) {
                            found.push((here.clone(), hit));
                        }
                    }
                    // Values, not schema: a default or an example may say anything.
                    ("default" | "examples" | "enum" | "const", _) => {}
                    _ => walk(child, &here, found),
                }
            }
        }
        Value::Array(items) => {
            for (index, child) in items.iter().enumerate() {
                walk(child, &format!("{pointer}/{index}"), found);
            }
        }
        _ => {}
    }
}

/// An HTML comment longer than this many characters is hidden text: long enough to carry a
/// paragraph a reader never sees.
pub const LONG_COMMENT_CHARS: usize = 200;

/// A kind of hidden text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[non_exhaustive]
pub enum HiddenKind {
    /// A zero-width character: U+200B to U+200D, U+2060, U+180E, or U+FEFF anywhere but the
    /// first position (where it is a byte order mark).
    ZeroWidth,
    /// A bidirectional control: U+061C, U+200E, U+200F, U+202A to U+202E, U+2066 to U+2069.
    Bidirectional,
    /// A Unicode tag character, U+E0000 to U+E007F.
    TagCharacter,
    /// An HTML comment of more than [`LONG_COMMENT_CHARS`] characters (an unterminated one runs
    /// to the end of the text).
    LongComment,
}

impl HiddenKind {
    /// The kind's name in a report: `zero-width`, `bidirectional`, `tag-character` or
    /// `long-comment`.
    pub fn name(self) -> &'static str {
        match self {
            Self::ZeroWidth => "zero-width",
            Self::Bidirectional => "bidirectional",
            Self::TagCharacter => "tag-character",
            Self::LongComment => "long-comment",
        }
    }
}

/// Hidden text of one kind found in a document.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct HiddenHit {
    /// The kind.
    pub kind: HiddenKind,
    /// How many were found.
    pub count: usize,
    /// The 1-based line of the first.
    pub first_line: usize,
}

/// What the write scan found in a document's text.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
#[non_exhaustive]
pub struct ContentScan {
    /// The injection patterns the text matched, in the rule's order.
    pub instruction_like: Vec<InjectionHit>,
    /// The hidden text found, by kind.
    pub hidden_text: Vec<HiddenHit>,
}

impl ContentScan {
    /// Whether the text matched an injection pattern (the document flag `instruction-like`).
    pub fn is_instruction_like(&self) -> bool {
        !self.instruction_like.is_empty()
    }

    /// Whether the text holds hidden text (the document flag `hidden-text`).
    pub fn has_hidden_text(&self) -> bool {
        !self.hidden_text.is_empty()
    }
}

fn hidden_kind(c: char) -> Option<HiddenKind> {
    match c {
        '\u{200B}'..='\u{200D}' | '\u{2060}' | '\u{180E}' | '\u{FEFF}' => {
            Some(HiddenKind::ZeroWidth)
        }
        '\u{061C}'
        | '\u{200E}'
        | '\u{200F}'
        | '\u{202A}'..='\u{202E}'
        | '\u{2066}'..='\u{2069}' => Some(HiddenKind::Bidirectional),
        '\u{E0000}'..='\u{E007F}' => Some(HiddenKind::TagCharacter),
        _ => None,
    }
}

/// Scan a document's text (frontmatter included): the injection patterns and the hidden-text
/// check, in one linear pass each. The text is untrusted and may be large; neither check
/// backtracks.
pub fn scan_content(text: &str) -> ContentScan {
    let mut scan = ContentScan {
        instruction_like: scan_description(text),
        hidden_text: Vec::new(),
    };
    let mut found: Vec<(HiddenKind, usize, usize)> = Vec::new();
    let mut note =
        |kind: HiddenKind, line: usize| match found.iter_mut().find(|(known, ..)| *known == kind) {
            Some(entry) => entry.1 += 1,
            None => found.push((kind, 1, line)),
        };

    let mut line = 1usize;
    let mut comment_end = 0usize;
    for (offset, c) in text.char_indices() {
        if c == '\n' {
            line += 1;
            continue;
        }
        // A comment already counted is not counted again, but a hidden character inside it is
        // still hidden.
        if offset >= comment_end && c == '<' && text[offset..].starts_with("<!--") {
            let end = text[offset + 4..]
                .find("-->")
                .map_or(text.len(), |found| offset + 4 + found + 3);
            comment_end = end;
            if text[offset..end].chars().count() > LONG_COMMENT_CHARS {
                note(HiddenKind::LongComment, line);
            }
        }
        // A byte order mark is not hidden text at the very start of a file.
        if let Some(kind) = hidden_kind(c).filter(|_| !(c == '\u{FEFF}' && offset == 0)) {
            note(kind, line);
        }
    }
    found.sort_by_key(|(kind, ..)| *kind);
    scan.hidden_text = found
        .into_iter()
        .map(|(kind, count, first_line)| HiddenHit {
            kind,
            count,
            first_line,
        })
        .collect();
    scan
}
