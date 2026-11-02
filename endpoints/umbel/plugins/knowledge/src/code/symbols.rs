//! Placing definitions and building a code file's chunks and symbols from them (the part of code
//! symbols that does not touch tree-sitter).

use std::cmp::Reverse;
use std::collections::BTreeSet;
use std::ops::Range;

use super::{Analysis, MAX_NAME_BYTES, Mode, Symbol};
use crate::chunk::{self, MAX_CHUNK_BYTES};

/// The most bytes of symbol names one chunk's `code` field holds.
const MAX_CODE_FIELD: usize = 16 * 1024;

/// One definition found by the query, before it is placed among the others.
#[derive(Debug, Clone)]
pub(crate) struct Def {
    /// The query's `@definition.<kind>` suffix: `function`, `struct`, `class`, ...
    pub(crate) kind: String,
    /// The defined name.
    pub(crate) name: String,
    /// Where the name begins.
    pub(crate) name_start: usize,
    /// The definition node's bytes.
    pub(crate) range: Range<usize>,
    /// The bytes its chunk covers: the definition with its `export` or decorators and the
    /// comments above it.
    pub(crate) span: Range<usize>,
}

/// A definition with its place among the others.
struct Placed {
    def: Def,
    qualified: String,
    /// How many definitions enclose it; 0 for a top-level one.
    depth: usize,
}

/// Definitions that enclose others for the purpose of qualified names.
fn is_container(kind: &str) -> bool {
    !matches!(kind, "const" | "static" | "type" | "macro")
}

/// Place the definitions in source order, each with its qualified name and depth. Enclosure is
/// read from byte ranges alone (a stack, no recursion).
fn place(mut defs: Vec<Def>, separator: &str) -> Vec<Placed> {
    defs.sort_by_key(|def| (def.range.start, Reverse(def.range.end), def.name_start));
    defs.dedup_by(|a, b| a.range == b.range && a.name_start == b.name_start);
    let mut placed: Vec<Placed> = Vec::with_capacity(defs.len());
    let mut stack: Vec<usize> = Vec::new();
    for mut def in defs {
        while let Some(&top) = stack.last() {
            let above = &placed[top].def.range;
            let encloses =
                above.start <= def.range.start && def.range.end <= above.end && *above != def.range;
            if encloses {
                break;
            }
            stack.pop();
        }
        let parent_kind = stack
            .iter()
            .rev()
            .map(|&at| &placed[at])
            .find(|p| is_container(&p.def.kind))
            .map(|p| p.def.kind.clone());
        if def.kind == "function"
            && matches!(
                parent_kind.as_deref(),
                Some("class" | "impl" | "trait" | "interface")
            )
        {
            "method".clone_into(&mut def.kind);
        }
        let mut qualified = String::new();
        for &at in &stack {
            let outer = &placed[at];
            if is_container(&outer.def.kind) {
                qualified.push_str(&outer.def.name);
                qualified.push_str(separator);
            }
        }
        qualified.push_str(&def.name);
        let depth = stack.len();
        placed.push(Placed {
            def,
            qualified,
            depth,
        });
        stack.push(placed.len() - 1);
    }
    placed
}

/// Whether a qualified name can be a symbol.
fn valid(qualified: &str) -> bool {
    !qualified.is_empty()
        && qualified.len() <= MAX_NAME_BYTES
        && !qualified.chars().any(char::is_control)
}

/// The analysis of a file whose definitions the query found.
pub(super) fn analyse(
    text: &str,
    language: &'static str,
    separator: &str,
    defs: Vec<Def>,
    error_bytes: usize,
) -> Analysis {
    let placed = place(defs, separator);
    let lines = LineIndex::new(text);

    // The symbols, each qualified name once.
    let mut seen: BTreeSet<&str> = BTreeSet::new();
    let mut found: Vec<Symbol> = Vec::new();
    let mut named: Vec<(usize, &str)> = Vec::new();
    for p in &placed {
        if !valid(&p.qualified) {
            continue;
        }
        named.push((p.def.name_start, p.qualified.as_str()));
        if seen.insert(p.qualified.as_str()) {
            found.push(Symbol {
                language,
                qualified: p.qualified.clone(),
                name: p.def.name.clone(),
                kind: p.def.kind.clone(),
                line: u32::try_from(lines.line_of(p.def.name_start)).unwrap_or(u32::MAX),
            });
        }
    }

    // The chunks: one per top-level definition, the text between them in plain-text pieces.
    let mut tops: Vec<Range<usize>> = placed
        .iter()
        .filter(|p| p.depth == 0)
        .map(|p| lines.align(&p.def.span))
        .collect();
    tops.sort_by_key(|range| (range.start, Reverse(range.end)));
    let mut merged: Vec<Range<usize>> = Vec::with_capacity(tops.len());
    for range in tops {
        match merged.last_mut() {
            Some(last) if range.start < last.end => last.end = last.end.max(range.end),
            _ => merged.push(range),
        }
    }
    let mut spans: Vec<(Range<usize>, (usize, usize))> = Vec::new();
    let mut at = 0usize;
    for top in &merged {
        gap(text, &lines, at..top.start, &mut spans);
        definition(text, &lines, top.clone(), &mut spans);
        at = top.end;
    }
    gap(text, &lines, at..text.len(), &mut spans);
    if spans.is_empty() {
        spans.push((0..0, (1, 1)));
    }
    spans.truncate(chunk::MAX_CHUNKS);

    // Each symbol belongs to the chunk its name is in.
    let mut words: Vec<Vec<&str>> = vec![Vec::new(); spans.len()];
    for (start, qualified) in named {
        let index = spans.partition_point(|(range, _)| range.end <= start);
        if let Some((range, _)) = spans.get(index)
            && range.start <= start
        {
            words[index].push(qualified);
        }
    }
    let code = words.iter().map(|names| code_field(names)).collect();
    Analysis {
        chunked: chunk::from_spans(text, spans),
        code,
        symbols: found,
        mode: Mode::Symbols,
        language: Some(language),
        error_bytes,
    }
}

/// The text between definitions: plain-text pieces, none of only whitespace.
fn gap(
    text: &str,
    lines: &LineIndex,
    region: Range<usize>,
    spans: &mut Vec<(Range<usize>, (usize, usize))>,
) {
    let Some(source) = text.get(region.clone()) else {
        return;
    };
    if source.trim().is_empty() {
        return;
    }
    let first = lines.line_of(region.start);
    for (range, span) in chunk::plain_spans(source, region.start, first) {
        if text
            .get(range.clone())
            .is_some_and(|piece| !piece.trim().is_empty())
        {
            spans.push((range, span));
        }
    }
}

/// One definition's chunk; a definition over the byte cap is cut into plain-text pieces.
fn definition(
    text: &str,
    lines: &LineIndex,
    region: Range<usize>,
    spans: &mut Vec<(Range<usize>, (usize, usize))>,
) {
    if region.len() <= MAX_CHUNK_BYTES {
        let first = lines.line_of(region.start);
        let last = lines.line_of(region.end.saturating_sub(1).max(region.start));
        spans.push((region, (first, last)));
        return;
    }
    let first = lines.line_of(region.start);
    if let Some(source) = text.get(region.clone()) {
        spans.extend(chunk::plain_spans(source, region.start, first));
    }
}

/// A chunk's `code` field: each qualified name whole and the words in it, once each, so a search
/// for `rollback` finds `RollbackPlan::apply_step`.
fn code_field(names: &[&str]) -> String {
    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut out = String::new();
    let mut add = |token: &str, out: &mut String| {
        if token.is_empty() || out.len() + token.len() + 1 > MAX_CODE_FIELD {
            return;
        }
        if seen.insert(token.to_owned()) {
            if !out.is_empty() {
                out.push(' ');
            }
            out.push_str(token);
        }
    };
    for name in names {
        add(name, &mut out);
        for word in words_of(name) {
            add(&word, &mut out);
        }
    }
    out
}

/// The words of an identifier path: split on anything that is not a letter or digit and at case
/// changes (`HTTPServer` is `HTTP` and `Server`).
fn words_of(name: &str) -> Vec<String> {
    let mut words: Vec<String> = Vec::new();
    let mut current = String::new();
    let chars: Vec<char> = name.chars().collect();
    for (at, &c) in chars.iter().enumerate() {
        if !c.is_alphanumeric() {
            if !current.is_empty() {
                words.push(std::mem::take(&mut current));
            }
            continue;
        }
        if let Some(&before) = at.checked_sub(1).and_then(|i| chars.get(i))
            && c.is_uppercase()
            && before.is_alphanumeric()
        {
            let after_lower = chars.get(at + 1).is_some_and(|next| next.is_lowercase());
            if before.is_lowercase()
                || before.is_numeric()
                || (before.is_uppercase() && after_lower)
            {
                words.push(std::mem::take(&mut current));
            }
        }
        current.push(c);
    }
    if !current.is_empty() {
        words.push(current);
    }
    words
}

/// Where each line of a text begins, to turn byte offsets into lines and to align spans to whole
/// lines without scanning a long line again and again.
struct LineIndex {
    starts: Vec<usize>,
    len: usize,
}

impl LineIndex {
    fn new(text: &str) -> Self {
        let mut starts = vec![0usize];
        for (at, byte) in text.bytes().enumerate() {
            if byte == b'\n' && at + 1 < text.len() {
                starts.push(at + 1);
            }
        }
        Self {
            starts,
            len: text.len(),
        }
    }

    /// The 1-based line a byte is on.
    fn line_of(&self, byte: usize) -> usize {
        self.starts.partition_point(|&start| start <= byte).max(1)
    }

    /// `range` widened to whole lines: from the start of its first line to the end of its last
    /// (after the line ending).
    fn align(&self, range: &Range<usize>) -> Range<usize> {
        let first = self.line_of(range.start);
        let last = self.line_of(range.end.saturating_sub(1).max(range.start));
        let start = self.starts.get(first - 1).copied().unwrap_or(0);
        let end = self.starts.get(last).copied().unwrap_or(self.len);
        start..end
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn words_split_on_punctuation_and_case() {
        assert_eq!(
            words_of("RollbackPlan::apply_step"),
            ["Rollback", "Plan", "apply", "step"]
        );
        assert_eq!(words_of("HTTPServer.start"), ["HTTP", "Server", "start"]);
        assert_eq!(words_of("parseV2Url"), ["parse", "V2", "Url"]);
    }

    #[test]
    fn the_code_field_has_each_token_once() {
        assert_eq!(
            code_field(&["Plan", "Plan::apply"]),
            "Plan Plan::apply apply"
        );
    }
}
