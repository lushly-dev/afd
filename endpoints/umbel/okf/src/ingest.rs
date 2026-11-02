//! One file in, everything the plugin stores out (phase 2 specification, sections 5.1, 5.4 and
//! 11): the document id, the frontmatter and its normalized keys, the body's structure and the
//! write scan's flags.

use std::collections::BTreeSet;

use serde_json::{Map, Value};
use umbel_scan::{ContentScan, scan_content};
use umbel_store::{ByAt, Flag, MAX_DOC_ID_BYTES, Sensitivity, Status, Verification};

use crate::frontmatter::{Declared, Problem, normalize, split};
use crate::structure::{Structure, structure};

/// What a collection holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// Markdown with optional frontmatter.
    Markdown,
    /// Source files, whole, with no frontmatter.
    Code,
}

/// A file to read.
#[derive(Debug, Clone, Copy)]
#[non_exhaustive]
pub struct Ingest<'a> {
    /// The file's bytes.
    pub bytes: &'a [u8],
    /// The path relative to the collection root, with `/` separators and the extension.
    pub path: &'a str,
    /// The collection's kind.
    pub kind: Kind,
    /// The type of a file without frontmatter or without `type`.
    pub default_type: &'a str,
}

impl<'a> Ingest<'a> {
    /// A file of a collection.
    pub fn new(bytes: &'a [u8], path: &'a str, kind: Kind, default_type: &'a str) -> Self {
        Self {
            bytes,
            path,
            kind,
            default_type,
        }
    }
}

/// A reserved file of the container (section 5.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum Reserved {
    /// `index.md`, type `okf-index`.
    Index,
    /// `log.md`, type `okf-log`.
    Log,
}

/// What reading a file found.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct Analysis {
    /// The type, from the frontmatter or the collection's default; `okf-index`, `okf-log` or
    /// `code` for those files.
    pub doc_type: String,
    /// The title: the frontmatter's, else the first level-1 heading, else the file name; a code
    /// file's is its path.
    pub title: String,
    /// The description.
    pub description: Option<String>,
    /// Tags, capped.
    pub tags: Vec<String>,
    /// Aliases, capped.
    pub aliases: Vec<String>,
    /// Owners, capped.
    pub owners: Vec<String>,
    /// The status; `stable` when the file does not say.
    pub status: Status,
    /// `stale_after`.
    pub stale_after: Option<String>,
    /// `superseded_by`.
    pub superseded_by: Option<String>,
    /// The verification state derived from `verified`.
    pub verification: Verification,
    /// OKF `generated`.
    pub generated: Option<ByAt>,
    /// The frontmatter mapping, whole, unknown keys kept; empty without frontmatter.
    pub frontmatter: Map<String, Value>,
    /// The `access` the file declares.
    pub access: Declared,
    /// The `sensitivity` the file declares.
    pub sensitivity: Option<Sensitivity>,
    /// The flags reading set: `type-defaulted`, `fields-limited`, `instruction-like` and
    /// `hidden-text`. (`schema-invalid` and `broken-links` need the schema and the collection,
    /// which the caller has.)
    pub flags: BTreeSet<Flag>,
    /// What the write scan found, for the report.
    pub scan: ContentScan,
    /// The reserved file this is, when it is one.
    pub reserved: Option<Reserved>,
    /// A bundle-root `index.md` carries an `okf_version` other than `"0.2"`.
    pub okf_version_unknown: bool,
    /// The keys whose values had the wrong shape.
    pub unusable: Vec<&'static str>,
    /// The body's structure; empty for a code file.
    pub structure: Structure,
    /// The file's byte count.
    pub size: u64,
    /// The file's line count.
    pub lines: u64,
    /// Where the body starts in the file's bytes (after any byte order mark and frontmatter).
    pub body_offset: usize,
}

/// Why a path cannot name a document.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum PathProblem {
    /// The path is empty or starts or ends with `/`.
    Empty,
    /// A control character or a backslash.
    Character,
    /// A segment starts with `.` (hidden files, `..`).
    Hidden,
    /// The id would be longer than 512 bytes.
    TooLong,
}

impl PathProblem {
    /// A short reason for a report.
    pub fn reason(self) -> &'static str {
        match self {
            Self::Empty => "empty-segment",
            Self::Character => "control-or-backslash",
            Self::Hidden => "hidden-segment",
            Self::TooLong => "too-long",
        }
    }
}

/// The id of the document at `path` of `collection`: `<collection>/<path without .md>`; a code
/// file keeps its extension. Case is kept.
///
/// # Errors
/// The [`PathProblem`] that makes the path unusable (`SOURCE_PATH_INVALID`).
pub fn document_id(collection: &str, path: &str, kind: Kind) -> Result<String, PathProblem> {
    if path.is_empty() || path.starts_with('/') || path.ends_with('/') {
        return Err(PathProblem::Empty);
    }
    if path.chars().any(|c| c.is_control() || c == '\\') {
        return Err(PathProblem::Character);
    }
    for segment in path.split('/') {
        if segment.is_empty() {
            return Err(PathProblem::Empty);
        }
        if segment.starts_with('.') {
            return Err(PathProblem::Hidden);
        }
    }
    let trimmed = match kind {
        Kind::Markdown => path.strip_suffix(".md").unwrap_or(path),
        Kind::Code => path,
    };
    if trimmed.is_empty() || trimmed.ends_with('/') {
        return Err(PathProblem::Empty);
    }
    let id = format!("{collection}/{trimmed}");
    if id.len() > MAX_DOC_ID_BYTES {
        return Err(PathProblem::TooLong);
    }
    Ok(id)
}

/// The file name of `path` without its last extension.
fn stem(path: &str) -> &str {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.rsplit_once('.').map_or(name, |(stem, _)| stem).trim()
}

/// Read one file.
///
/// # Errors
/// The [`Problem`] that makes the file unreadable: not UTF-8, or frontmatter that does not read.
pub fn analyze(input: &Ingest<'_>) -> Result<Analysis, Problem> {
    let size = input.bytes.len() as u64;
    let mut flags = BTreeSet::new();
    if input.kind == Kind::Code {
        let text = std::str::from_utf8(input.bytes).map_err(|_| Problem::NotUtf8)?;
        let scan = scan_content(text);
        note_scan(&scan, &mut flags);
        return Ok(Analysis {
            doc_type: "code".to_owned(),
            title: input.path.to_owned(),
            description: None,
            tags: Vec::new(),
            aliases: Vec::new(),
            owners: Vec::new(),
            status: Status::Stable,
            stale_after: None,
            superseded_by: None,
            verification: unverified(),
            generated: None,
            frontmatter: Map::new(),
            access: Declared::Absent,
            sensitivity: None,
            flags,
            scan,
            reserved: None,
            okf_version_unknown: false,
            unusable: Vec::new(),
            structure: Structure {
                total_lines: crate::structure::count_lines(text),
                ..Structure::default()
            },
            size,
            lines: crate::structure::count_lines(text) as u64,
            body_offset: 0,
        });
    }

    let parts = split(input.bytes)?;
    let fields = parts.fields.clone().unwrap_or_default();
    let normal = normalize(&fields);
    let name = input.path.rsplit('/').next().unwrap_or(input.path);
    let reserved = match name {
        "index.md" => Some(Reserved::Index),
        "log.md" => Some(Reserved::Log),
        _ => None,
    };
    let doc_type = match reserved {
        Some(Reserved::Index) => "okf-index".to_owned(),
        Some(Reserved::Log) => "okf-log".to_owned(),
        None => normal.doc_type.clone().unwrap_or_else(|| {
            flags.insert(Flag::TypeDefaulted);
            input.default_type.to_owned()
        }),
    };
    if normal.fields_limited {
        flags.insert(Flag::FieldsLimited);
    }
    let scan = scan_content(parts.text);
    note_scan(&scan, &mut flags);

    let body = structure(parts.text, parts.body_offset);
    let title = normal
        .title
        .clone()
        .or_else(|| {
            body.headings
                .iter()
                .find(|heading| heading.level == 1)
                .map(|heading| heading.text.clone())
                .filter(|text| !text.is_empty())
        })
        .unwrap_or_else(|| stem(input.path).to_owned());
    let okf_version_unknown = input.path == "index.md"
        && normal
            .okf_version
            .as_deref()
            .is_some_and(|version| version != "0.2");
    Ok(Analysis {
        doc_type,
        title,
        description: normal.description,
        tags: normal.tags,
        aliases: normal.aliases,
        owners: normal.owners,
        status: normal.status.unwrap_or(Status::Stable),
        stale_after: normal.stale_after,
        superseded_by: normal.superseded_by,
        verification: normal.verification.unwrap_or_else(unverified),
        generated: normal.generated,
        frontmatter: fields,
        access: normal.access,
        sensitivity: normal.sensitivity,
        flags,
        scan,
        reserved,
        okf_version_unknown,
        unusable: normal.unusable,
        lines: body.total_lines as u64,
        structure: body,
        size,
        body_offset: parts.bom_len + parts.body_offset,
    })
}

fn unverified() -> Verification {
    Verification {
        tier: umbel_store::Tier::Unverified,
        last: None,
        count: 0,
    }
}

fn note_scan(scan: &ContentScan, flags: &mut BTreeSet<Flag>) {
    if scan.is_instruction_like() {
        flags.insert(Flag::InstructionLike);
    }
    if scan.has_hidden_text() {
        flags.insert(Flag::HiddenText);
    }
}
