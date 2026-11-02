//! The tree-sitter half of code symbols (specification section 7.4): parse a file under the
//! budgets and read its definitions with the committed query file of its language.
//!
//! Nothing here recurses over the tree: a file may nest a million levels deep, and the Rust stack
//! is not the place to find out. The error rate walks with a cursor, the enclosing definitions are
//! found from byte ranges in `code.rs`, and the two helpers that look at relatives (`span_of`)
//! look at most a few steps up or sideways.

use std::cell::Cell;
use std::ops::{ControlFlow, Range};
use std::sync::OnceLock;
use std::time::Instant;

use streaming_iterator::StreamingIterator;
use tree_sitter::{
    Language, Node, ParseOptions, ParseState, Parser, Query, QueryCursor, QueryCursorOptions,
    QueryCursorState,
};

use super::symbols::Def;
use super::{Budget, Grammar, Reason};

/// What a successful parse found.
pub(super) struct Parsed {
    /// The definitions, in the order the query produced them.
    pub(super) defs: Vec<Def>,
    /// The bytes covered by `ERROR` nodes plus one per `MISSING` node.
    pub(super) error_bytes: usize,
}

const RUST_QUERY: &str = include_str!("../../queries/rust.scm");
const PYTHON_QUERY: &str = include_str!("../../queries/python.scm");
const TYPESCRIPT_QUERY: &str = include_str!("../../queries/typescript.scm");

/// The tree-sitter language of a grammar.
fn language(grammar: Grammar) -> Language {
    match grammar {
        Grammar::Rust => tree_sitter_rust::LANGUAGE.into(),
        Grammar::Python => tree_sitter_python::LANGUAGE.into(),
        Grammar::Typescript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
        Grammar::Tsx => tree_sitter_typescript::LANGUAGE_TSX.into(),
    }
}

/// The compiled query of a grammar; compiled once, or the reason it cannot be.
fn query(grammar: Grammar) -> Result<&'static Query, Reason> {
    static RUST: OnceLock<Result<Query, String>> = OnceLock::new();
    static PYTHON: OnceLock<Result<Query, String>> = OnceLock::new();
    static TYPESCRIPT: OnceLock<Result<Query, String>> = OnceLock::new();
    static TSX: OnceLock<Result<Query, String>> = OnceLock::new();
    let (cell, source) = match grammar {
        Grammar::Rust => (&RUST, RUST_QUERY),
        Grammar::Python => (&PYTHON, PYTHON_QUERY),
        Grammar::Typescript => (&TYPESCRIPT, TYPESCRIPT_QUERY),
        Grammar::Tsx => (&TSX, TYPESCRIPT_QUERY),
    };
    cell.get_or_init(|| Query::new(&language(grammar), source).map_err(|error| error.to_string()))
        .as_ref()
        .map_err(|_| Reason::QueryInvalid)
}

/// Parse `text` and read its definitions, or say why the file is indexed as plain text.
pub(super) fn run(grammar: Grammar, text: &str, budget: &Budget) -> Result<Parsed, Reason> {
    let query = query(grammar)?;
    let mut parser = Parser::new();
    parser
        .set_language(&language(grammar))
        .map_err(|_| Reason::ParserUnavailable)?;

    // Parse under the wall-time bound: the callback cancels the parse, which then has no tree.
    let bytes = text.as_bytes();
    let started = Instant::now();
    let mut stop = |_: &ParseState| {
        if started.elapsed() >= budget.parse {
            ControlFlow::Break(())
        } else {
            ControlFlow::Continue(())
        }
    };
    let options = ParseOptions::new().progress_callback(&mut stop);
    let tree = parser.parse_with_options(
        &mut |offset, _| &bytes[offset.min(bytes.len())..],
        None,
        Some(options),
    );
    let Some(tree) = tree else {
        return Err(if started.elapsed() >= budget.parse {
            Reason::ParseTimeout
        } else {
            Reason::ParseFailed
        });
    };
    let root = tree.root_node();

    let error_bytes = error_bytes(root);
    if error_bytes * 100 > bytes.len() * budget.max_error_percent {
        return Err(Reason::ErrorRate);
    }

    // Query under a match limit and a wall-time bound.
    let names = query.capture_names();
    let mut cursor = QueryCursor::new();
    cursor.set_match_limit(budget.match_limit);
    let started = Instant::now();
    let cancelled = Cell::new(false);
    let mut stop = |_: &QueryCursorState| {
        if started.elapsed() >= budget.query {
            cancelled.set(true);
            ControlFlow::Break(())
        } else {
            ControlFlow::Continue(())
        }
    };
    let mut defs: Vec<Def> = Vec::new();
    let mut too_many = false;
    {
        let mut matches = cursor.matches_with_options(
            query,
            root,
            bytes,
            QueryCursorOptions::new().progress_callback(&mut stop),
        );
        while let Some(found) = matches.next() {
            let mut name: Option<Node> = None;
            let mut whole: Option<(Node, &str)> = None;
            for capture in found.captures() {
                let label = names.get(capture.index as usize).copied().unwrap_or("");
                if label == "name" {
                    name = Some(capture.node);
                } else if let Some(kind) = label.strip_prefix("definition.") {
                    whole = Some((capture.node, kind));
                }
            }
            let (Some(name), Some((node, kind))) = (name, whole) else {
                continue;
            };
            let Some(identifier) = text.get(name.start_byte()..name.end_byte()) else {
                continue;
            };
            if defs.len() >= budget.max_symbols {
                too_many = true;
                break;
            }
            defs.push(Def {
                kind: kind.to_owned(),
                name: identifier.to_owned(),
                name_start: name.start_byte(),
                range: node.start_byte()..node.end_byte(),
                span: span_of(node, text),
            });
        }
    }
    if cancelled.get() {
        return Err(Reason::QueryTimeout);
    }
    if cursor.did_exceed_match_limit() {
        return Err(Reason::MatchLimit);
    }
    if too_many {
        return Err(Reason::SymbolLimit);
    }
    Ok(Parsed { defs, error_bytes })
}

/// The bytes covered by `ERROR` nodes plus one byte per `MISSING` node, walked with a cursor and
/// only into the subtrees that hold an error.
fn error_bytes(root: Node) -> usize {
    let mut total = 0usize;
    let mut cursor = root.walk();
    'walk: loop {
        let node = cursor.node();
        let mut descend = false;
        if node.is_error() {
            total += node.end_byte() - node.start_byte();
        } else if node.is_missing() {
            total += 1;
        } else if node.has_error() {
            descend = true;
        }
        if descend && cursor.goto_first_child() {
            continue;
        }
        loop {
            if cursor.goto_next_sibling() {
                continue 'walk;
            }
            if !cursor.goto_parent() {
                break 'walk;
            }
        }
    }
    total
}

/// Node kinds that are comments or attributes, which belong to the definition below them.
fn is_leading(kind: &str) -> bool {
    matches!(
        kind,
        "comment" | "line_comment" | "block_comment" | "attribute_item"
    )
}

/// The bytes a definition's chunk covers: the definition, the `export` or decorators around it,
/// and the comments and attributes directly above it (each on its own line, with no blank line
/// between).
fn span_of(node: Node, text: &str) -> Range<usize> {
    let mut top = node;
    while let Some(parent) = top.parent() {
        if matches!(parent.kind(), "export_statement" | "decorated_definition") {
            top = parent;
        } else {
            break;
        }
    }
    let mut start = top.start_byte();
    let mut previous = top.prev_sibling();
    while let Some(above) = previous {
        if !is_leading(above.kind()) {
            break;
        }
        let Some(gap) = text.get(above.end_byte()..start) else {
            break;
        };
        // On its own line: only indentation (at most 256 bytes of it) before it.
        let column = above.start_position().column;
        let own_line = column <= 256
            && above
                .start_byte()
                .checked_sub(column)
                .and_then(|begin| text.get(begin..above.start_byte()))
                .is_some_and(|indent| indent.trim().is_empty());
        if gap.trim().is_empty() && gap.matches('\n').count() <= 1 && own_line {
            start = above.start_byte();
            previous = above.prev_sibling();
        } else {
            break;
        }
    }
    start..top.end_byte()
}
