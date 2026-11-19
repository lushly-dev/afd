//! `components-check` (specification, amendment A30; Component Briefs step D1, #1154): a page's
//! source read as text against the pack, for two mistakes only: a tag in element position that
//! starts with a touched library's prefix and is in no catalog, and an attribute on a known tag
//! that its record does not declare. It renders nothing and runs nothing, and says so in every
//! answer; Specimen's story checks are the real check.
//!
//! The source is read in one pass with no regular expression, bounded by section 6.1's 262 144
//! bytes. Only a start tag of a touched library is tokenized: its attribute names, `=`, values in
//! `"…"`, `'…'` or unquoted, and expressions, `${…}` (a template literal's) and `{…}` (JSX's),
//! with the braces, strings, template literals and comments nested inside them. Text between tags
//! is never tokenized, so an apostrophe in it cannot put the reader out of step.

use std::collections::{HashMap, HashSet};

use serde_json::{Value, json};
use umbel_sdk::{Cx, Level, Outcome, success};

use crate::fit::{fit_count, fits};
use crate::list::identity;
use crate::pack::{self, Library};
use crate::{Settings, fail, input, scan, select};

/// The fixed note every answer carries (amendment A30).
pub(crate) const NOTE: &str = "Read as text: nothing was rendered or run. This compares tag and attribute names with the pack's declarations and nothing more, so a clean answer does not mean the page works. Specimen's story checks (`pnpm test:stories`) render the components and are the real check.";

/// At most this many findings in an answer; `count` says how many there were.
const MAX_FINDINGS: usize = 256;

/// The longest attribute name compared, the format's for an attribute.
const MAX_NAME: usize = 100;

/// HTML's global attributes, and the DOM's and shadow parts' that every element takes, never
/// flagged (amendment A30). Sorted, for the binary search.
const GLOBAL: [&str; 32] = [
    "accesskey",
    "autocapitalize",
    "autocorrect",
    "autofocus",
    "class",
    "contenteditable",
    "dir",
    "draggable",
    "enterkeyhint",
    "exportparts",
    "hidden",
    "id",
    "inert",
    "inputmode",
    "is",
    "itemid",
    "itemprop",
    "itemref",
    "itemscope",
    "itemtype",
    "lang",
    "nonce",
    "part",
    "popover",
    "role",
    "slot",
    "spellcheck",
    "style",
    "tabindex",
    "title",
    "translate",
    "writingsuggestions",
];

/// Names a framework reads and never sets on the element (React's, lowercased), skipped. Sorted.
const FRAMEWORK: [&str; 6] = [
    "classname",
    "dangerouslysetinnerhtml",
    "htmlfor",
    "key",
    "ref",
    "suppresshydrationwarning",
];

/// Whether a lowercased name is a global attribute: [`GLOBAL`], `aria-*`, `data-*` or an event
/// handler, `on` and a letter.
fn is_global(name: &str) -> bool {
    GLOBAL.binary_search(&name).is_ok()
        || name.starts_with("aria-")
        || name.starts_with("data-")
        || name
            .strip_prefix("on")
            .is_some_and(|rest| rest.bytes().next().is_some_and(|b| b.is_ascii_lowercase()))
}

/// Whether a lowercased name is a framework's own: [`FRAMEWORK`] or a Vue directive, `v-*`.
fn is_framework(name: &str) -> bool {
    FRAMEWORK.binary_search(&name).is_ok() || name.starts_with("v-")
}

/// HTML's whitespace.
fn is_space(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t' | b'\n' | b'\r' | 0x0c)
}

fn in_tag_alphabet(byte: u8) -> bool {
    byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'_' | b'-')
}

/// What an expression's reader is inside.
#[derive(Clone, Copy)]
enum Mode {
    /// Code, inside this many open braces.
    Code(usize),
    /// A template literal's text.
    Template,
}

/// Whether a `/` after this last significant byte of code starts a regular expression literal
/// rather than a division: after an operator or an opening (`(`, `,`, `=`, `=>`, `{` and the
/// like), and at the start of an expression, where the last byte is taken as `{`.
fn starts_regex(prev: u8) -> bool {
    matches!(
        prev,
        b'(' | b',' | b'=' | b':' | b'[' | b'!' | b'&' | b'|' | b'?' | b'{' | b'}' | b';' | b'>'
    )
}

/// The index just past a regular expression literal whose `/` is at `open`: a backslash escapes,
/// a `/` inside `[…]` does not end it, and a line end ends it too, since it cannot hold one.
fn skip_regex(bytes: &[u8], open: usize) -> usize {
    let mut index = open + 1;
    let mut class = false;
    while index < bytes.len() {
        match bytes[index] {
            b'\\' => index += 2,
            b'\n' => return index,
            b'[' => {
                class = true;
                index += 1;
            }
            b']' => {
                class = false;
                index += 1;
            }
            b'/' if !class => return index + 1,
            _ => index += 1,
        }
    }
    bytes.len()
}

/// The index just past the expression whose `{` is at `open` (the `{` of `${`, or JSX's): braces
/// counted, and strings, template literals with their own `${…}`, regular expression literals
/// and comments skipped, each with an explicit stack so no input can exhaust the call stack. The
/// source's length when it never closes.
fn skip_expression(bytes: &[u8], open: usize) -> usize {
    let mut stack = vec![Mode::Code(1)];
    let mut index = open + 1;
    // The last significant byte of code read, which decides what a `/` starts.
    let mut prev = b'{';
    while index < bytes.len() {
        let byte = bytes[index];
        let Some(top) = stack.last_mut() else {
            break;
        };
        match *top {
            Mode::Code(depth) => match byte {
                _ if is_space(byte) => index += 1,
                b'{' => {
                    *top = Mode::Code(depth + 1);
                    index += 1;
                    prev = b'{';
                }
                b'}' => {
                    index += 1;
                    prev = b'}';
                    if depth == 1 {
                        stack.pop();
                        if stack.is_empty() {
                            return index;
                        }
                    } else {
                        *top = Mode::Code(depth - 1);
                    }
                }
                b'"' | b'\'' => {
                    index = skip_string(bytes, index);
                    prev = b'"';
                }
                b'`' => {
                    stack.push(Mode::Template);
                    index += 1;
                }
                b'/' if bytes.get(index + 1) == Some(&b'/') => {
                    while index < bytes.len() && bytes[index] != b'\n' {
                        index += 1;
                    }
                }
                b'/' if bytes.get(index + 1) == Some(&b'*') => {
                    index += 2;
                    while index < bytes.len() && !bytes[index..].starts_with(b"*/") {
                        index += 1;
                    }
                    index = (index + 2).min(bytes.len());
                }
                b'/' if starts_regex(prev) => {
                    index = skip_regex(bytes, index);
                    prev = b'/';
                }
                _ => {
                    prev = byte;
                    index += 1;
                }
            },
            Mode::Template => match byte {
                b'\\' => index += 2,
                b'`' => {
                    stack.pop();
                    index += 1;
                    prev = b'`';
                }
                b'$' if bytes.get(index + 1) == Some(&b'{') => {
                    stack.push(Mode::Code(1));
                    index += 2;
                    prev = b'{';
                }
                _ => index += 1,
            },
        }
    }
    bytes.len()
}

/// The index just past a script string whose quote is at `open`: a backslash escapes, and a line
/// end closes it too, since a script string cannot hold one and a stray quote must not run on.
fn skip_string(bytes: &[u8], open: usize) -> usize {
    let quote = bytes[open];
    let mut index = open + 1;
    while index < bytes.len() {
        match bytes[index] {
            b'\\' => index += 2,
            b'\n' => return index,
            byte if byte == quote => return index + 1,
            _ => index += 1,
        }
    }
    bytes.len()
}

/// The index just past an attribute value in quotes whose quote is at `open`. The other quote is
/// text, and a `${…}` inside is skipped whole, so `"${a ? "x" : 'y'}"` is one value.
fn skip_quoted(bytes: &[u8], open: usize) -> usize {
    let quote = bytes[open];
    let mut index = open + 1;
    while index < bytes.len() {
        match bytes[index] {
            byte if byte == quote => return index + 1,
            b'$' if bytes.get(index + 1) == Some(&b'{') => {
                index = skip_expression(bytes, index + 1);
            }
            _ => index += 1,
        }
    }
    bytes.len()
}

/// The index just past an unquoted value starting at `start`: up to whitespace or `>`, with a
/// `${…}` inside skipped whole.
fn skip_unquoted(bytes: &[u8], start: usize) -> usize {
    let mut index = start;
    while index < bytes.len() && !is_space(bytes[index]) && bytes[index] != b'>' {
        if bytes[index] == b'$' && bytes.get(index + 1) == Some(&b'{') {
            index = skip_expression(bytes, index + 1);
        } else {
            index += 1;
        }
    }
    index
}

/// One attribute name in a start tag, as written.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Name<'a> {
    pub(crate) text: &'a str,
    /// Its byte offset in the source.
    pub(crate) at: usize,
    /// Written against an expression (`name${…}`), so not the whole name.
    pub(crate) partial: bool,
}

/// Where a start tag's tokenizing stopped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Stop {
    /// At its `>`: the index just past it.
    Closed(usize),
    /// At a `<` where a name would be: that `<`'s index, where the pass resumes.
    Angle(usize),
    /// At the end of the source, which ends the pass, since every later byte was read already.
    End,
}

/// A start tag's attribute names, and where it stopped. A tag that stopped at a `<` or at the
/// end is unclosed and not checked (amendment A30). No byte is read twice by the pass.
pub(crate) fn start_tag(source: &str, from: usize) -> (Vec<Name<'_>>, Stop) {
    let bytes = source.as_bytes();
    let mut names = Vec::new();
    let mut index = from;
    loop {
        while index < bytes.len() && is_space(bytes[index]) {
            index += 1;
        }
        let Some(&byte) = bytes.get(index) else {
            return (names, Stop::End);
        };
        match byte {
            b'>' => return (names, Stop::Closed(index + 1)),
            b'<' => return (names, Stop::Angle(index)),
            // A self-closing slash, or a stray `=` with no name before it.
            b'/' | b'=' => {
                index += 1;
                continue;
            }
            b'$' if bytes.get(index + 1) == Some(&b'{') => {
                index = skip_expression(bytes, index + 1);
                continue;
            }
            b'{' => {
                index = skip_expression(bytes, index);
                continue;
            }
            b'"' | b'\'' => {
                index = skip_quoted(bytes, index);
                continue;
            }
            _ => {}
        }
        let start = index;
        while index < bytes.len() {
            let byte = bytes[index];
            if is_space(byte) || matches!(byte, b'=' | b'>' | b'/' | b'"' | b'\'' | b'<' | b'{') {
                break;
            }
            if byte == b'$' && bytes.get(index + 1) == Some(&b'{') {
                break;
            }
            index += 1;
        }
        let partial = bytes.get(index) == Some(&b'{') || bytes.get(index) == Some(&b'$');
        // Every byte that ends a name is ASCII, so `start..index` is on character boundaries.
        if let Some(text) = source.get(start..index) {
            names.push(Name {
                text,
                at: start,
                partial,
            });
        }
        let mut after = index;
        while after < bytes.len() && is_space(bytes[after]) {
            after += 1;
        }
        if bytes.get(after) != Some(&b'=') {
            continue;
        }
        index = after + 1;
        while index < bytes.len() && is_space(bytes[index]) {
            index += 1;
        }
        index = match bytes.get(index) {
            Some(b'"' | b'\'') => skip_quoted(bytes, index),
            Some(b'$') if bytes.get(index + 1) == Some(&b'{') => skip_expression(bytes, index + 1),
            Some(b'{') => skip_expression(bytes, index),
            Some(b'>') | None => index,
            Some(_) => skip_unquoted(bytes, index),
        };
    }
}

/// What a name in a start tag is checked as (amendment A30).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Checked {
    /// An attribute, lowercased, with a leading `?` (a boolean binding) removed.
    Attribute(String),
    /// Not compared: a property or event binding, a name joined to an expression, or one outside
    /// the attribute pattern.
    Skipped,
}

/// How a name as written is checked.
pub(crate) fn classify(name: &Name<'_>) -> Checked {
    if name.partial {
        return Checked::Skipped;
    }
    let bare = name.text.strip_prefix('?').unwrap_or(name.text);
    let lower = bare.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    let shaped = !bytes.is_empty()
        && bytes.len() <= MAX_NAME
        && bytes[0].is_ascii_lowercase()
        && bytes.iter().all(|b| {
            b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'_' | b'.' | b'-')
        });
    if !shaped {
        return Checked::Skipped;
    }
    Checked::Attribute(lower)
}

/// One finding, before it is written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Finding {
    pub(crate) reason: &'static str,
    pub(crate) tag: String,
    pub(crate) attribute: Option<String>,
    pub(crate) line: usize,
    pub(crate) nearest: Vec<String>,
}

impl Finding {
    fn value(&self) -> Value {
        let mut value = json!({ "reason": self.reason, "tag": self.tag, "line": self.line });
        if let Some(attribute) = &self.attribute {
            value["attribute"] = Value::from(attribute.as_str());
        }
        value["nearest"] = Value::from(self.nearest.clone());
        value
    }
}

/// What one pass over a source found.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(crate) struct Report {
    /// The first [`MAX_FINDINGS`], in source order.
    pub(crate) findings: Vec<Finding>,
    /// Every finding, kept or not.
    pub(crate) count: usize,
    /// Start tags of a touched library's prefix, known or not.
    pub(crate) elements: usize,
    /// Names compared with a record's attributes and the global ones.
    pub(crate) attributes: usize,
    /// Names not compared (see [`Checked::Skipped`]).
    pub(crate) skipped: usize,
    /// Start tags of a known tag whose `>` never came, so not checked.
    pub(crate) unclosed: usize,
}

/// What a tag declares, for one pass.
pub(crate) struct Declared<'a> {
    /// Every attribute name the tag's record holds, whatever its basis.
    pub(crate) names: HashSet<&'a str>,
    /// The names `nearest` may give: those `minimum_basis` serves.
    pub(crate) served: Vec<&'a str>,
}

/// Counts line ends as the pass moves forward, so finding a line costs nothing extra.
struct Lines<'a> {
    bytes: &'a [u8],
    at: usize,
    line: usize,
}

impl Lines<'_> {
    fn of(&mut self, index: usize) -> usize {
        if index > self.at {
            self.line += self.bytes[self.at..index]
                .iter()
                .filter(|b| **b == b'\n')
                .count();
            self.at = index;
        }
        self.line
    }
}

impl Report {
    /// Counts a finding, and keeps it, with its nearest names, while fewer than [`MAX_FINDINGS`]
    /// are kept: past the cap only the count grows, so no nearest name is sought for it.
    fn push(&mut self, finding: Finding, nearest: impl FnOnce() -> Vec<String>) {
        self.count += 1;
        if self.findings.len() < MAX_FINDINGS {
            self.findings.push(Finding {
                nearest: nearest(),
                ..finding
            });
        }
    }
}

/// One pass over `source`: each start tag in element position whose name is a known tag
/// (`declared` gives its attributes) or starts with one of `prefixes` (`tags` gives the nearest
/// tags of an unknown one). HTML comments are skipped.
pub(crate) fn read<'a>(
    source: &str,
    declared: impl Fn(&str) -> Option<&'a Declared<'a>>,
    prefixes: &[&str],
    tags: &[&str],
) -> Report {
    let bytes = source.as_bytes();
    let mut report = Report::default();
    let mut lines = Lines {
        bytes,
        at: 0,
        line: 1,
    };
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'<' {
            index += 1;
            continue;
        }
        if bytes[index..].starts_with(b"<!--") {
            index = bytes[index + 4..]
                .windows(3)
                .position(|window| window == b"-->")
                .map_or(bytes.len(), |end| index + 4 + end + 3);
            continue;
        }
        let open = index;
        let start = index + 1;
        let mut end = start;
        while end < bytes.len() && in_tag_alphabet(bytes[end]) {
            end += 1;
        }
        let ends_name = bytes
            .get(end)
            .is_none_or(|b| is_space(*b) || matches!(b, b'>' | b'/'));
        let Some(tag) = source.get(start..end) else {
            index += 1;
            continue;
        };
        if !ends_name || !tag.as_bytes().first().is_some_and(u8::is_ascii_lowercase) {
            index += 1;
            continue;
        }
        if let Some(known) = declared(tag) {
            report.elements += 1;
            let (names, stop) = start_tag(source, end);
            let after = match stop {
                Stop::Closed(after) => after,
                // Resume at the `<`, so the bytes between are never read again.
                Stop::Angle(at) => {
                    report.unclosed += 1;
                    index = at;
                    continue;
                }
                // The tag ran to the end of the source: there is nothing left to read.
                Stop::End => {
                    report.unclosed += 1;
                    break;
                }
            };
            for name in &names {
                let Checked::Attribute(attribute) = classify(name) else {
                    report.skipped += 1;
                    continue;
                };
                if known.names.contains(attribute.as_str()) || is_global(&attribute) {
                    report.attributes += 1;
                    continue;
                }
                if is_framework(&attribute) {
                    report.skipped += 1;
                    continue;
                }
                // The name is echoed outside the content part (section 5.1): it has passed the
                // attribute shape, and is dropped when the scan reads it as an instruction.
                if scan::identifier_hit(&attribute) {
                    report.skipped += 1;
                    continue;
                }
                report.attributes += 1;
                let line = lines.of(name.at);
                let wanted = attribute.clone();
                report.push(
                    Finding {
                        reason: "unknown-attribute",
                        tag: tag.to_owned(),
                        attribute: Some(attribute),
                        line,
                        nearest: Vec::new(),
                    },
                    || select::nearest(&wanted, known.served.iter().copied()),
                );
            }
            index = after;
            continue;
        }
        let is_tag = tag.len() <= 100 && tag.contains('-');
        if is_tag && prefixes.iter().any(|prefix| tag.starts_with(prefix)) {
            report.elements += 1;
            // Echoed outside the content part, so dropped, and counted, when the scan hits it.
            if scan::identifier_hit(tag) {
                report.skipped += 1;
                index = end;
                continue;
            }
            let line = lines.of(open);
            report.push(
                Finding {
                    reason: "unknown-tag",
                    tag: tag.to_owned(),
                    attribute: None,
                    line,
                    nearest: Vec::new(),
                },
                || select::nearest(tag, tags.iter().copied()),
            );
        }
        index = end;
    }
    report
}

/// The records' attributes for each known tag: from the call's `library`, else from
/// `default_library` when it holds the tag, else from every library that holds it.
fn declarations<'a>(
    libraries: &'a [Library],
    settings: &Settings,
) -> HashMap<&'a str, Declared<'a>> {
    let mut holders: HashMap<&str, Vec<usize>> = HashMap::new();
    for (index, library) in libraries.iter().enumerate() {
        for component in &library.catalog.components {
            holders
                .entry(component.tag.as_str())
                .or_default()
                .push(index);
        }
    }
    let mut out = HashMap::new();
    for (tag, holding) in holders {
        let chosen: Vec<usize> = match settings.default_library.as_deref() {
            Some(default) if holding.len() > 1 => holding
                .iter()
                .copied()
                .filter(|index| libraries[*index].id == default)
                .collect(),
            _ => Vec::new(),
        };
        let from = if chosen.is_empty() { holding } else { chosen };
        let mut names = HashSet::new();
        let mut served = Vec::new();
        for index in from {
            let Some(record) = libraries[index].records.iter().find(|r| r.tag == tag) else {
                continue;
            };
            for attribute in &record.api.attributes {
                names.insert(attribute.name.as_str());
                if settings.serves(&attribute.basis) && !served.contains(&attribute.name.as_str()) {
                    served.push(attribute.name.as_str());
                }
            }
        }
        out.insert(tag, Declared { names, served });
    }
    out
}

pub(crate) fn run(input: &Value, cx: &mut Cx) -> Outcome {
    if let Err(outcome) = input::check_check(input) {
        return outcome;
    }
    let settings = Settings::load(cx);
    let library = input.get("library").and_then(Value::as_str);
    let libraries = match pack::read(cx, library) {
        Ok(libraries) => libraries,
        Err(outcome) => return outcome,
    };
    let source = input
        .get("source")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let declared = declarations(&libraries, &settings);
    let prefixes: Vec<&str> = libraries
        .iter()
        .map(|library| library.catalog.prefix.as_str())
        .collect();
    let mut tags: Vec<&str> = declared.keys().copied().collect();
    tags.sort_unstable();
    let report = read(source, |tag| declared.get(tag), &prefixes, &tags);

    let identities: Vec<Value> = libraries.iter().map(identity).collect();
    let versions = input
        .get("versions")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let build = |shown: usize| -> Outcome {
        let findings: Vec<Value> = report.findings[..shown]
            .iter()
            .map(Finding::value)
            .collect();
        let mut outcome = success(json!({
            "read": "text",
            "rendered": false,
            "note": NOTE,
            "libraries": identities,
            "checked": {
                "elements": report.elements,
                "attributes": report.attributes,
                "skipped": report.skipped,
                "unclosed": report.unclosed,
            },
            "findings": findings,
            "count": report.count,
            "truncated": shown < report.count,
        }))
        .with_reasoning(&format!(
            "Read the source as text and rendered nothing: {} element(s) and {} attribute(s) compared with {} library(ies), {} finding(s), {} name(s) not compared. Specimen's story checks are the real check.",
            report.elements,
            report.attributes,
            libraries.len(),
            report.count,
            report.skipped,
        ));
        for library in &libraries {
            let package = &library.catalog.package;
            if let Some(installed) = versions.get(&package.name).and_then(Value::as_str)
                && installed != package.version
            {
                outcome = fail::warn_version(
                    outcome,
                    &library.id,
                    &package.name,
                    installed,
                    &package.version,
                );
            }
        }
        outcome
    };

    let budget = cx.call().output_budget;
    let total = report.findings.len();
    let mut outcome = build(total);
    let mut shown = total;
    if !fits(&outcome, budget) {
        if !fits(&build(0), budget) {
            return fail::budget_exceeded();
        }
        shown = fit_count(total, budget, build);
        outcome = build(shown);
    }
    cx.log(
        Level::Info,
        &format!(
            "components-check: {} element(s), {} finding(s), {shown} shown",
            report.elements, report.count
        ),
    );
    outcome
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    /// The names of the first start tag in `source`, which starts with `<x-y`, and whether it
    /// closed.
    fn names(source: &str) -> (Vec<&str>, bool) {
        let (names, stop) = start_tag(source, 4);
        (
            names.iter().map(|name| name.text).collect(),
            matches!(stop, Stop::Closed(_)),
        )
    }

    fn declared() -> Declared<'static> {
        Declared {
            names: ["label", "value", "disabled", "supporting-text"]
                .into_iter()
                .collect(),
            served: vec!["disabled", "label", "supporting-text", "value"],
        }
    }

    fn check(source: &str) -> Report {
        let known = declared();
        read(
            source,
            |tag| (tag == "x-field").then_some(&known),
            &["x-"],
            &["x-field"],
        )
    }

    fn flagged(report: &Report) -> Vec<(&str, Option<&str>, usize)> {
        report
            .findings
            .iter()
            .map(|f| (f.tag.as_str(), f.attribute.as_deref(), f.line))
            .collect()
    }

    #[test]
    fn the_lists_are_sorted_for_the_search() {
        assert!(GLOBAL.windows(2).all(|pair| pair[0] < pair[1]));
        assert!(FRAMEWORK.windows(2).all(|pair| pair[0] < pair[1]));
    }

    #[test]
    fn quotes_of_either_kind_and_an_apostrophe_in_a_value() {
        assert_eq!(
            names(r#"<x-y a="Don't" b='say "no"' c=bare d>"#),
            (vec!["a", "b", "c", "d"], true)
        );
        // An apostrophe in the text after the tag is never read.
        let report =
            check("<x-field label=\"Don't\">It's <b>fine</b>, isn't it</x-field><x-field nope>");
        assert_eq!(flagged(&report), [("x-field", Some("nope"), 1)]);
    }

    #[test]
    fn template_expressions_with_nested_braces_strings_and_backticks() {
        let source = r#"<x-y a="${x ? "q" : 'r'}" b=${{ k: { v: "}" } }} ${spread({ z: `t${`u${1}`}`})} c="${`>${"'"}`}" d>"#;
        assert_eq!(names(source), (vec!["a", "b", "c", "d"], true));
        // A comment inside an expression may hold a quote.
        assert_eq!(
            names("<x-y a=${x /* don't */ // it's\n} b>"),
            (vec!["a", "b"], true)
        );
        // JSX: a braced value and a spread.
        assert_eq!(
            names(r#"<x-y a={cond ? "}" : obj.v} {...rest} b>"#),
            (vec!["a", "b"], true)
        );
    }

    #[test]
    fn self_closing_and_multi_line_tags() {
        assert_eq!(names("<x-y a=\"1\" b/>"), (vec!["a", "b"], true));
        assert_eq!(names("<x-y a=1/>"), (vec!["a"], true));
        let report = check("<p>\n<x-field\n  label=\"A\"\n  nope\n  other=\"x\"\n/>");
        assert_eq!(
            flagged(&report),
            [("x-field", Some("nope"), 4), ("x-field", Some("other"), 5)]
        );
    }

    #[test]
    fn bindings_by_prefix() {
        let report = check(
            "<x-field ?disabled=${d} ?nope=${n} :value=${v} :nope=${n} .value=${v} @change=${f} @nope=${f} [x]=\"y\" (click)=\"z\" #ref v-model=\"m\" v-on:click=\"f\" className=\"c\" key=\"k\">",
        );
        // `?` is checked as an attribute; `:`, `.`, `@` and every other binding are not compared.
        assert_eq!(flagged(&report), [("x-field", Some("nope"), 1)]);
        assert_eq!(report.attributes, 2);
        assert_eq!(report.skipped, 12);
    }

    #[test]
    fn global_attributes_are_never_flagged() {
        let report = check(
            "<x-field id=a class=b style=c slot=d part=e role=f title=g hidden tabindex=0 lang=en dir=ltr inert popover autofocus exportparts=h is=i aria-label=j data-x=k onclick=l inputmode=m enterkeyhint=n autocapitalize=o spellcheck translate accesskey=p contenteditable draggable nonce=q itemprop=r>",
        );
        assert_eq!(flagged(&report), []);
        // `on` alone is not a handler.
        assert_eq!(
            flagged(&check("<x-field on>")),
            [("x-field", Some("on"), 1)]
        );
    }

    #[test]
    fn names_are_compared_lowercased() {
        let report = check("<x-field LABEL=\"A\" Supporting-Text=\"b\" Error-Text=\"c\">");
        assert_eq!(flagged(&report), [("x-field", Some("error-text"), 1)]);
        assert!(report.findings[0].nearest.is_empty());
        let report = check("<x-field lable=\"A\">");
        assert_eq!(report.findings[0].nearest, ["label", "value"]);
    }

    #[test]
    fn an_unclosed_tag_at_the_end_is_not_checked() {
        let report = check("<x-field label=\"A\">ok</x-field>\n<x-field nope=\"");
        assert_eq!(flagged(&report), []);
        assert_eq!((report.elements, report.unclosed), (2, 1));
        let report = check("text <x-field nope and then <b>more</b>");
        assert_eq!((flagged(&report), report.unclosed), (vec![], 1));
        let report = check("<x-field a=${never closes");
        assert_eq!(report.unclosed, 1);
    }

    #[test]
    fn unknown_tags_in_element_position_and_comments() {
        let report = check(
            "<x-feild label=a></x-feild>\n<!-- <x-gone nope> -->\n<y-other nope>\n\"<x-field nope>\"\nx-loose and </x-closing>",
        );
        assert_eq!(
            flagged(&report),
            [("x-feild", None, 1), ("x-field", Some("nope"), 4)]
        );
        assert_eq!(report.findings[0].nearest, ["x-field"]);
    }

    #[test]
    fn findings_are_capped_and_counted() {
        let source = "<x-field nope>".repeat(MAX_FINDINGS + 10);
        let report = check(&source);
        assert_eq!(report.findings.len(), MAX_FINDINGS);
        assert_eq!(report.count, MAX_FINDINGS + 10);
    }

    #[test]
    fn an_instruction_in_a_name_is_dropped_not_echoed() {
        let report = check("<x-field ignore-previous-instructions>");
        assert_eq!(flagged(&report), []);
        assert_eq!(report.skipped, 1);
    }

    #[test]
    fn deeply_nested_expressions_do_not_exhaust_the_stack() {
        let source = format!("<x-y a=${}>", "{`${".repeat(50_000));
        let (_, stop) = start_tag(&source, 4);
        assert_eq!(stop, Stop::End);
    }

    /// Unclosed tags repeated up to the source cap: each used to rescan to the end, which took
    /// seconds in a release build. The pass now reads each byte once, so even a debug build is
    /// far inside the bound.
    #[test]
    fn repeated_unclosed_tags_at_the_cap_are_read_in_one_pass() {
        let cap = crate::input::MAX_SOURCE_BYTES;
        for unit in [
            "<x-field a=${",
            "<x-field a=${`",
            "<x-field a=\"${",
            "<x-field a=${/*",
            "<x-field a <x-field b ",
        ] {
            let source = unit.repeat(cap / unit.len());
            let started = std::time::Instant::now();
            let report = check(&source);
            let took = started.elapsed();
            assert!(took.as_secs_f64() < 2.0, "{unit}: {took:?}");
            assert!(report.unclosed >= 1, "{unit}");
            assert_eq!(report.count, 0, "{unit}");
        }
        // A tag that runs to the end ends the pass at once; one that stops at a `<` resumes there.
        assert_eq!(check(&"<x-field a=${".repeat(1_000)).unclosed, 1);
        assert_eq!(check(&"<x-field a ".repeat(1_000)).unclosed, 1_000);
    }

    #[test]
    fn regular_expression_literals_in_an_expression() {
        assert_eq!(
            names(r"<x-y a=${x => x.url.replace(/\/\//g, '')} b>"),
            (vec!["a", "b"], true)
        );
        assert_eq!(
            names(r"<x-y a=${x => /'/.test(x)} b>"),
            (vec!["a", "b"], true)
        );
        assert_eq!(
            names(r#"<x-y a=${x => /[/"]+/.test(x) ? 1 : 2} b>"#),
            (vec!["a", "b"], true)
        );
        // A division is not a regular expression: `a / b / c` leaves the expression intact.
        assert_eq!(names("<x-y a=${x.w / 2 / x.h} b>"), (vec!["a", "b"], true));
        let report = check(r"<x-field a=${x => x.url.replace(/\/\//g, '')} nope>");
        assert_eq!(
            flagged(&report),
            [("x-field", Some("a"), 1), ("x-field", Some("nope"), 1)]
        );
    }

    #[test]
    fn a_capitalised_tag_name_is_not_read() {
        // HTML folds a tag name's case, but JSX and frameworks read a capitalised name as their
        // own component, so `<X-Field>` and `<X-FIELD>` are neither checked nor unknown.
        let report = check("<X-FIELD nope></X-FIELD><X-Field nope><x-Feild>");
        assert_eq!(flagged(&report), []);
        assert_eq!(report.elements, 0);
    }

    #[test]
    fn an_unknown_tag_the_scan_hits_is_counted_not_echoed() {
        let report = check("<x-ignore-previous-instructions>");
        assert_eq!(flagged(&report), []);
        assert_eq!((report.elements, report.skipped), (1, 1));
    }

    #[test]
    fn a_declared_name_wins_over_a_framework_name() {
        let known = Declared {
            names: ["ref"].into_iter().collect(),
            served: vec!["ref"],
        };
        let report = read(
            "<x-field ref=\"a\" key=\"b\">",
            |tag| (tag == "x-field").then_some(&known),
            &["x-"],
            &["x-field"],
        );
        assert_eq!(flagged(&report), []);
        assert_eq!((report.attributes, report.skipped), (1, 1));
    }
}
