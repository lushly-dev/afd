//! Reading one stored document: its text by line, its structure and who may see it.

use std::cell::OnceCell;

use serde::Serialize;
use umbel_okf::Structure;
use umbel_okf::structure::count_lines;
use umbel_sdk::{Cx, HostError};
use umbel_store::{DocMeta, Document, ListQuery};

/// A serde enum's wire spelling (`stable`, `human`, `internal`), for fields the index and the
/// results spell as strings.
pub(crate) fn label<T: Serialize>(value: &T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_default()
}

/// The metadata of the stored document `id` when the caller's reader filter admits it: a metadata
/// read, so no bytes are loaded.
pub(crate) fn meta(cx: &Cx, space: &str, id: &str) -> Result<Option<DocMeta>, HostError> {
    let collection = id
        .split_once('/')
        .map(|(collection, _)| collection.to_owned());
    let page = cx.doc_list(
        space,
        &ListQuery {
            collection,
            prefix: Some(id.to_owned()),
            doc_type: None,
            after: None,
            limit: 1,
        },
    )?;
    // Ids are ordered, and an id sorts before every id it is a prefix of.
    Ok(page.items.into_iter().next().filter(|meta| meta.id == id))
}

/// Whether the caller's reader filter admits the stored document `id`.
pub(crate) fn readable(cx: &Cx, space: &str, id: &str) -> Result<bool, HostError> {
    Ok(meta(cx, space, id)?.is_some())
}

/// A document's text and its lines.
pub(crate) struct Loaded {
    pub(crate) doc: Document,
    /// The file's text with the byte order mark stripped (line numbers do not depend on it).
    pub(crate) text: String,
    /// Where each line begins, in bytes.
    starts: Vec<usize>,
    total: usize,
    structure: OnceCell<Structure>,
}

/// The document `id` as the caller may read it; `None` when it is absent or not readable.
pub(crate) fn load(cx: &Cx, space: &str, id: &str) -> Result<Option<Loaded>, HostError> {
    Ok(cx.doc_get(space, id)?.map(Loaded::new))
}

impl Loaded {
    pub(crate) fn new(doc: Document) -> Self {
        let whole = String::from_utf8_lossy(&doc.bytes);
        let text = whole.strip_prefix('\u{feff}').unwrap_or(&whole).to_owned();
        let mut starts = vec![0usize];
        for (at, byte) in text.bytes().enumerate() {
            if byte == b'\n' && at + 1 < text.len() {
                starts.push(at + 1);
            }
        }
        let total = count_lines(&text);
        if total == 0 {
            starts.clear();
        }
        Self {
            doc,
            text,
            starts,
            total,
            structure: OnceCell::new(),
        }
    }

    /// The file's line count.
    pub(crate) fn total_lines(&self) -> usize {
        self.total
    }

    /// Whether this is a code file (no markdown structure).
    pub(crate) fn is_code(&self) -> bool {
        self.doc.doc_type == "code"
    }

    /// Lines `start..=end` (1-based, clamped to the file), without the last line ending.
    pub(crate) fn lines(&self, start: usize, end: usize) -> &str {
        if self.total == 0 || start == 0 || start > end {
            return "";
        }
        let end = end.min(self.total);
        let Some(&from) = self.starts.get(start - 1) else {
            return "";
        };
        let to = self.starts.get(end).copied().unwrap_or(self.text.len());
        self.text[from..to].trim_end_matches(['\n', '\r'])
    }

    /// One line, without its line ending.
    pub(crate) fn line(&self, number: usize) -> &str {
        self.lines(number, number)
    }

    /// The markdown structure; empty for a code file.
    pub(crate) fn structure(&self) -> &Structure {
        self.structure.get_or_init(|| {
            if self.is_code() {
                return Structure::default();
            }
            match umbel_okf::frontmatter::split(self.doc.bytes.as_slice()) {
                Ok(parts) => umbel_okf::structure(parts.text, parts.body_offset),
                Err(_) => Structure::default(),
            }
        })
    }

    /// The heading texts from the top down to the section that holds `line`.
    pub(crate) fn heading_path_at(&self, line: usize) -> Vec<String> {
        let structure = self.structure();
        let mut at = structure
            .headings
            .iter()
            .rposition(|heading| heading.line <= line);
        while let Some(index) = at {
            let heading = &structure.headings[index];
            if heading.lines.end >= line {
                break;
            }
            at = heading.parent;
        }
        structure.heading_path(at)
    }
}
