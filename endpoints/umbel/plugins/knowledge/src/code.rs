//! Code symbols (phase 2 specification, section 7.4): a source file becomes chunks per top-level
//! definition and a list of the symbols it defines, under budgets that keep hostile input to a
//! clean per-file outcome.
//!
//! A file is read with the tree-sitter grammar of its extension and the committed query file of
//! its language (`queries/<language>.scm`). It is indexed as plain text, 60 lines to a chunk,
//! with a reason, when it is over [`MAX_BYTES`], when the parse or the query is cancelled by its
//! wall-time bound, when the query exceeds its match limit, when more than a quarter of its bytes
//! sit under `ERROR` or `MISSING` nodes, or when it defines more than [`MAX_SYMBOLS`] things.
//! Nothing here recurses over a tree, so the depth of the input cannot overflow the stack.
//!
//! Qualified names join the enclosing definitions' names with `::` (Rust) or `.` (the others). A
//! symbol's node is `symbol:<language>:<qualified name>` and carries nothing of the file it came
//! from but that name, so a node that several files produce says the same to every reader.

use std::time::Duration;

use crate::chunk::{self, Chunked};

#[cfg(feature = "code")]
mod parse;
#[cfg(feature = "code")]
mod symbols;

/// A file over this many bytes is indexed as plain text.
pub const MAX_BYTES: usize = 1 << 20;
/// The wall-time bound of one parse.
pub const PARSE_TIME: Duration = Duration::from_secs(2);
/// The wall-time bound of one query.
pub const QUERY_TIME: Duration = Duration::from_secs(1);
/// The most in-progress matches a query cursor holds.
pub const MATCH_LIMIT: u32 = 10_000;
/// A file with more than this percentage of its bytes under `ERROR` or `MISSING` nodes is indexed
/// as plain text.
pub const MAX_ERROR_PERCENT: usize = 25;
/// The most definitions one file may have; past it the file is indexed as plain text.
pub const MAX_SYMBOLS: usize = 5000;
/// The longest qualified name kept; a longer one is not a symbol.
pub(crate) const MAX_NAME_BYTES: usize = 256;
/// The most distinct inline code spans of a document considered as mentions.
pub(crate) const MAX_MENTION_SPANS: usize = 200;

/// The limits a parse runs under; [`Budget::default`] is the specification's.
#[derive(Debug, Clone)]
pub struct Budget {
    /// The largest file parsed, in bytes.
    pub max_bytes: usize,
    /// The parse is cancelled after this much wall time.
    pub parse: Duration,
    /// The query is cancelled after this much wall time.
    pub query: Duration,
    /// The query cursor's match limit.
    pub match_limit: u32,
    /// The largest percentage of bytes under error nodes.
    pub max_error_percent: usize,
    /// The most definitions.
    pub max_symbols: usize,
}

impl Default for Budget {
    fn default() -> Self {
        Self {
            max_bytes: MAX_BYTES,
            parse: PARSE_TIME,
            query: QUERY_TIME,
            match_limit: MATCH_LIMIT,
            max_error_percent: MAX_ERROR_PERCENT,
            max_symbols: MAX_SYMBOLS,
        }
    }
}

/// Which tree-sitter grammar reads a file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Grammar {
    Rust,
    Python,
    Typescript,
    /// TSX parses JavaScript and JSX as well.
    Tsx,
}

/// A file's language by its extension: the name its symbols carry and the grammar that reads it.
#[derive(Debug, Clone, Copy)]
struct Lang {
    name: &'static str,
    grammar: Grammar,
}

impl Lang {
    fn of(path: &str) -> Option<Self> {
        let extension = path.rsplit_once('.')?.1.to_ascii_lowercase();
        let (name, grammar) = match extension.as_str() {
            "rs" => ("rust", Grammar::Rust),
            "py" => ("python", Grammar::Python),
            "ts" => ("typescript", Grammar::Typescript),
            "tsx" => ("typescript", Grammar::Tsx),
            "js" | "jsx" | "mjs" => ("javascript", Grammar::Tsx),
            _ => return None,
        };
        Some(Self { name, grammar })
    }
}

#[cfg(feature = "code")]
impl Lang {
    fn separator(self) -> &'static str {
        if self.name == "rust" { "::" } else { "." }
    }
}

/// The language of a code file by its extension: `rust`, `python`, `typescript` or `javascript`.
#[must_use]
pub fn language_of(path: &str) -> Option<&'static str> {
    Lang::of(path).map(|lang| lang.name)
}

/// Why a file is indexed as plain text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum Reason {
    /// The extension has no grammar (a custom `include` pattern).
    Unsupported,
    /// The knowledge crate was built without its `code` feature.
    FeatureDisabled,
    /// The file is over [`Budget::max_bytes`].
    TooLarge,
    /// The parse was cancelled by its wall-time bound.
    ParseTimeout,
    /// The parser returned no tree.
    ParseFailed,
    /// The grammar cannot be loaded by this tree-sitter.
    ParserUnavailable,
    /// The query file does not compile against its grammar (a bug, found by the tests).
    QueryInvalid,
    /// The query was cancelled by its wall-time bound.
    QueryTimeout,
    /// The query exceeded its match limit.
    MatchLimit,
    /// More than [`Budget::max_error_percent`] of the bytes sit under error nodes.
    ErrorRate,
    /// More than [`Budget::max_symbols`] definitions.
    SymbolLimit,
}

impl Reason {
    /// The reason as the warning and the description spell it.
    #[must_use]
    pub fn code(self) -> &'static str {
        match self {
            Self::Unsupported => "language-unsupported",
            Self::FeatureDisabled => "feature-disabled",
            Self::TooLarge => "file-too-large",
            Self::ParseTimeout => "parse-timeout",
            Self::ParseFailed => "parse-failed",
            Self::ParserUnavailable => "parser-unavailable",
            Self::QueryInvalid => "query-invalid",
            Self::QueryTimeout => "query-timeout",
            Self::MatchLimit => "match-limit",
            Self::ErrorRate => "error-rate",
            Self::SymbolLimit => "symbol-limit",
        }
    }

    /// Whether the file was readable code that a budget or a failure sent to plain text (the
    /// warning `CODE_PARSE_DEGRADED`), as against a file the plugin does not parse at all.
    #[must_use]
    pub fn degraded(self) -> bool {
        !matches!(self, Self::Unsupported | Self::FeatureDisabled)
    }
}

/// How a code file was indexed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// Chunked by definition, with its symbols.
    Symbols,
    /// Chunked as plain text, for this reason.
    PlainText(Reason),
}

/// One symbol a file defines.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Symbol {
    /// `rust`, `python`, `typescript` or `javascript`.
    pub language: &'static str,
    /// The qualified name: enclosing names joined by `::` (Rust) or `.`.
    pub qualified: String,
    /// The name itself.
    pub name: String,
    /// `function`, `method`, `struct`, `class`, ...
    pub kind: String,
    /// The line the name is on, 1-based.
    pub line: u32,
}

impl Symbol {
    /// The graph node of the symbol: `symbol:<language>:<qualified name>`.
    #[must_use]
    pub fn node_id(&self) -> String {
        format!("symbol:{}:{}", self.language, self.qualified)
    }
}

/// What reading a code file found.
#[derive(Debug, Clone)]
pub struct Analysis {
    /// The chunks.
    pub chunked: Chunked,
    /// The `code` field of each chunk (symbol names with their words), aligned with
    /// [`Chunked::chunks`]; empty for a chunk that defines nothing.
    pub code: Vec<String>,
    /// The symbols, each qualified name once, in source order; none when indexed as plain text.
    pub symbols: Vec<Symbol>,
    /// How the file was indexed.
    pub mode: Mode,
    /// The language by extension, when there is one.
    pub language: Option<&'static str>,
    /// The bytes under error nodes (and one per missing node); 0 when nothing was parsed.
    pub error_bytes: usize,
}

/// Read a code file at `path` whose text is `text`, under `budget`.
#[must_use]
pub fn analyse(path: &str, text: &str, budget: &Budget) -> Analysis {
    let Some(lang) = Lang::of(path) else {
        return plain(text, None, Reason::Unsupported, 0);
    };
    if text.len() > budget.max_bytes {
        return plain(text, Some(lang.name), Reason::TooLarge, 0);
    }
    #[cfg(feature = "code")]
    {
        match parse::run(lang.grammar, text, budget) {
            Ok(parsed) => symbols::analyse(
                text,
                lang.name,
                lang.separator(),
                parsed.defs,
                parsed.error_bytes,
            ),
            Err(reason) => plain(text, Some(lang.name), reason, 0),
        }
    }
    #[cfg(not(feature = "code"))]
    {
        let _ = budget;
        let _ = lang.grammar;
        plain(text, Some(lang.name), Reason::FeatureDisabled, 0)
    }
}

/// The file as plain-text chunks, for a reason.
fn plain(
    text: &str,
    language: Option<&'static str>,
    reason: Reason,
    error_bytes: usize,
) -> Analysis {
    let chunked = chunk::plain(text);
    Analysis {
        code: vec![String::new(); chunked.chunks.len()],
        chunked,
        symbols: Vec::new(),
        mode: Mode::PlainText(reason),
        language,
        error_bytes,
    }
}

/// The graph nodes an inline code span may name: `symbol:<language>:<span>` for each language
/// whose qualified names the span could be.
///
/// A span is a path of identifiers joined by `::` (Rust) or `.` (the others), with a trailing
/// `()` allowed; a single identifier could be a top-level symbol of any language. Whether a
/// symbol by that name exists is not asked here: an edge to a node that no readable document
/// produces is never served, so a mention stored today starts to count when the symbol appears,
/// and a mention of a symbol the reader cannot read is invisible to them.
#[must_use]
pub fn mention_targets(span: &str) -> Vec<String> {
    let span = span.trim();
    let span = span.strip_suffix("()").unwrap_or(span);
    if span.is_empty() || span.len() > MAX_NAME_BYTES {
        return Vec::new();
    }
    let identifier = |part: &str| {
        let mut chars = part.chars();
        chars
            .next()
            .is_some_and(|c| c.is_alphabetic() || c == '_' || c == '$')
            && chars.all(|c| c.is_alphanumeric() || c == '_' || c == '$')
    };
    let rust = span.contains("::");
    let dotted = span.contains('.');
    if rust && dotted {
        return Vec::new();
    }
    let separator = if rust { "::" } else { "." };
    if !span.split(separator).all(identifier) {
        return Vec::new();
    }
    let languages: &[&str] = if rust {
        &["rust"]
    } else if dotted {
        &["python", "typescript", "javascript"]
    } else {
        &["rust", "python", "typescript", "javascript"]
    };
    languages
        .iter()
        .map(|language| format!("symbol:{language}:{span}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mention_targets_follow_the_separator() {
        assert_eq!(mention_targets("Plan::apply"), ["symbol:rust:Plan::apply"]);
        assert_eq!(
            mention_targets("plan.apply()"),
            [
                "symbol:python:plan.apply",
                "symbol:typescript:plan.apply",
                "symbol:javascript:plan.apply"
            ]
        );
        assert_eq!(mention_targets("main").len(), 4);
        assert!(mention_targets("cargo test").is_empty());
        assert!(mention_targets("a::b.c").is_empty());
        assert!(mention_targets("--flag").is_empty());
        assert!(mention_targets("").is_empty());
    }
}
