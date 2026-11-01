//! The YAML frontmatter at the start of a text: a line `---`, one YAML mapping, a line `---`
//! (`spec/mcp-resources.md`, S2). Feature `frontmatter`, which `server` enables.
//!
//! [`parse`] tells **no frontmatter** (the first line is not `---`: `Ok(None)`) apart from
//! **malformed** frontmatter (a typed [`FrontmatterError`]), and returns the body's byte offset
//! and line, so a caller that indexes the body reads from [`Frontmatter::body_offset`] and
//! reports lines relative to the file.
//!
//! The YAML is read with the YAML 1.2 core schema, so `2026-11-01` unquoted is a string, `yes`
//! is a string and `0x10` is 16, and with no tags, anchors or aliases. Every value is a string,
//! a finite number, a boolean, null, a sequence or a mapping, and every key is a string. The
//! parser is `saphyr-parser`'s event stream; the JSON value is built here, so those rules are
//! ours and not a library's defaults.
//!
//! The reader sets **no size cap**: it reads the whole of the frontmatter in `text`, so a caller
//! that takes untrusted files caps the input first (Umbel cuts a file's frontmatter at 64 KiB
//! before calling it). It strips no byte order mark: a text that starts with one has no
//! frontmatter by this rule, so strip it first. An empty block (`---` then `---`) is not a
//! mapping and fails with [`FrontmatterError::NotAMapping`].
//!
//! ```rust
//! use afd::frontmatter::{parse, FrontmatterError};
//!
//! let text = "---\ntitle: Hello\ntags: [a, b]\n---\n# Body\n";
//! let found = parse(text).unwrap().unwrap();
//! assert_eq!(found.fields["title"], "Hello");
//! assert_eq!(&text[found.body_offset..], "# Body\n");
//! assert_eq!(found.body_line, 5);
//!
//! assert!(parse("# No frontmatter\n").unwrap().is_none());
//! assert!(matches!(parse("---\ntitle: x\n"), Err(FrontmatterError::Unclosed)));
//! ```

use std::fmt;
use std::sync::OnceLock;

use regex::Regex;
use saphyr_parser::{Event, Parser, ScalarStyle};
use serde_json::{Map, Number, Value};

/// Nesting deeper than this is refused: the frontmatter is metadata, and the reader keeps its own
/// stack so no input can overflow the thread's.
const MAX_DEPTH: usize = 64;

/// The frontmatter of a text, from [`parse`].
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct Frontmatter {
    /// The mapping, as JSON: keys are strings and values are strings, finite numbers, booleans,
    /// null, arrays or objects.
    pub fields: Map<String, Value>,
    /// The byte offset in the text where the body starts: just after the closing `---` line and
    /// its line ending (the end of the text when the closing line is the last, unterminated).
    pub body_offset: usize,
    /// The 1-based line of the text where the body starts: the line after the closing `---`.
    pub body_line: usize,
}

/// Why a text's frontmatter is malformed. Every `line` is 1-based in the whole text, so the
/// opening `---` is line 1.
///
/// The `Display` text is generic: it names the rule and the line, never a file. A caller adds its
/// own context (the file's name, "SKILL.md").
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum FrontmatterError {
    /// The text opens with `---` but has no closing `---` line.
    Unclosed,
    /// The frontmatter is not one YAML mapping: a sequence, a scalar or nothing at all.
    NotAMapping,
    /// The frontmatter uses a feature the rules refuse: `what` names it (a YAML tag, anchor or
    /// alias, a number that is not finite, a mapping key that is not a string, a repeated key).
    Forbidden {
        /// What was refused.
        what: String,
        /// Where.
        line: usize,
    },
    /// Collections nest more than 64 levels deep.
    TooDeep {
        /// Where the 65th level opens.
        line: usize,
    },
    /// The YAML parser refused the text.
    Syntax {
        /// Where.
        line: usize,
        /// The column, 1-based in characters.
        column: usize,
        /// The parser's description.
        message: String,
    },
    /// The frontmatter holds more than one YAML document.
    MoreThanOneDocument {
        /// Where the second starts.
        line: usize,
    },
}

impl fmt::Display for FrontmatterError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unclosed => f.write_str("the frontmatter has no closing line ---"),
            Self::NotAMapping => f.write_str("the frontmatter must be one YAML mapping"),
            Self::Forbidden { what, line } => {
                write!(f, "the frontmatter uses {what} (line {line})")
            }
            Self::TooDeep { line } => write!(
                f,
                "the frontmatter is nested more than {MAX_DEPTH} levels (line {line})"
            ),
            Self::Syntax {
                line,
                column,
                message,
            } => write!(
                f,
                "the frontmatter is not valid YAML (line {line}, column {column}): {message}"
            ),
            Self::MoreThanOneDocument { line } => write!(
                f,
                "the frontmatter must be one YAML document (a second starts at line {line})"
            ),
        }
    }
}

impl std::error::Error for FrontmatterError {}

/// Parse the frontmatter at the start of `text`.
///
/// `Ok(None)` when the first line is not `---` (the text has no frontmatter, which is not an
/// error); `Ok(Some(..))` with the mapping and where the body starts otherwise.
///
/// # Errors
/// The rule a malformed frontmatter breaks, with its line.
pub fn parse(text: &str) -> Result<Option<Frontmatter>, FrontmatterError> {
    let mut lines = text.split_inclusive('\n');
    let is_fence = |line: &str| line.trim_end_matches(['\n', '\r']) == "---";
    match lines.next() {
        Some(first) if is_fence(first) => {}
        _ => return Ok(None),
    }
    let start = text.len() - lines.clone().map(str::len).sum::<usize>();
    let mut end = start;
    // The line of `text` the loop is on: the opening fence is line 1.
    let mut line = 1;
    for next in lines {
        line += 1;
        if is_fence(next) {
            let body_offset = end + next.len();
            let fields = read_mapping(&text[start..end])?;
            return Ok(Some(Frontmatter {
                fields,
                body_offset,
                body_line: line + 1,
            }));
        }
        end += next.len();
    }
    Err(FrontmatterError::Unclosed)
}

enum Frame {
    Sequence(Vec<Value>),
    Mapping {
        entries: Map<String, Value>,
        key: Option<String>,
    },
}

fn forbidden(what: impl Into<String>, line: usize) -> FrontmatterError {
    FrontmatterError::Forbidden {
        what: what.into(),
        line,
    }
}

/// `yaml` is the text between the fences, which starts on line 2 of the whole text.
fn read_mapping(yaml: &str) -> Result<Map<String, Value>, FrontmatterError> {
    let mut stack: Vec<Frame> = Vec::new();
    let mut root: Option<Value> = None;
    let mut documents = 0usize;
    for event in Parser::new_from_str(yaml) {
        let (event, span) = event.map_err(|error| FrontmatterError::Syntax {
            line: error.marker().line() + 1,
            column: error.marker().col() + 1,
            message: error.info().to_owned(),
        })?;
        let line = span.start.line() + 1;
        let value = match event {
            Event::Nothing | Event::StreamStart | Event::StreamEnd | Event::DocumentEnd => continue,
            Event::DocumentStart(_) => {
                documents += 1;
                if documents > 1 {
                    return Err(FrontmatterError::MoreThanOneDocument { line });
                }
                continue;
            }
            Event::Alias(_) => return Err(forbidden("a YAML alias", line)),
            Event::Scalar(text, style, anchor, tag) => {
                refuse_decoration(anchor, tag.is_some(), line)?;
                if matches!(style, ScalarStyle::Plain) {
                    resolve_plain(&text).map_err(|what| forbidden(what, line))?
                } else {
                    Value::String(text.into_owned())
                }
            }
            Event::SequenceStart(anchor, tag) => {
                refuse_decoration(anchor, tag.is_some(), line)?;
                open(&mut stack, Frame::Sequence(Vec::new()), line)?;
                continue;
            }
            Event::MappingStart(anchor, tag) => {
                refuse_decoration(anchor, tag.is_some(), line)?;
                open(
                    &mut stack,
                    Frame::Mapping {
                        entries: Map::new(),
                        key: None,
                    },
                    line,
                )?;
                continue;
            }
            Event::SequenceEnd | Event::MappingEnd => match stack.pop() {
                Some(Frame::Sequence(items)) => Value::Array(items),
                Some(Frame::Mapping { entries, .. }) => Value::Object(entries),
                None => return Err(FrontmatterError::NotAMapping),
            },
        };
        match stack.last_mut() {
            None => root = Some(value),
            Some(Frame::Sequence(items)) => items.push(value),
            Some(Frame::Mapping { entries, key }) => match key.take() {
                Some(key) => {
                    if entries.insert(key.clone(), value).is_some() {
                        return Err(forbidden(format!("the repeated key \"{key}\""), line));
                    }
                }
                None => match value {
                    Value::String(name) => *key = Some(name),
                    _ => return Err(forbidden("a mapping key that is not a string", line)),
                },
            },
        }
    }
    match root {
        Some(Value::Object(entries)) => Ok(entries),
        _ => Err(FrontmatterError::NotAMapping),
    }
}

/// Open a collection inside the frame on top of `stack`.
fn open(stack: &mut Vec<Frame>, frame: Frame, line: usize) -> Result<(), FrontmatterError> {
    if stack.len() >= MAX_DEPTH {
        return Err(FrontmatterError::TooDeep { line });
    }
    if matches!(stack.last(), Some(Frame::Mapping { key: None, .. })) {
        return Err(forbidden("a mapping key that is not a string", line));
    }
    stack.push(frame);
    Ok(())
}

fn refuse_decoration(anchor: usize, tagged: bool, line: usize) -> Result<(), FrontmatterError> {
    if anchor != 0 {
        return Err(forbidden("a YAML anchor", line));
    }
    if tagged {
        return Err(forbidden("a YAML tag", line));
    }
    Ok(())
}

fn regex(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("a valid pattern"))
}

/// A plain scalar by the YAML 1.2 core schema, as a JSON value, or what it is that the rules
/// refuse.
fn resolve_plain(text: &str) -> Result<Value, String> {
    static INTEGER: OnceLock<Regex> = OnceLock::new();
    static FLOAT: OnceLock<Regex> = OnceLock::new();
    static NOT_FINITE: OnceLock<Regex> = OnceLock::new();
    match text {
        "" | "~" | "null" | "Null" | "NULL" => return Ok(Value::Null),
        "true" | "True" | "TRUE" => return Ok(Value::Bool(true)),
        "false" | "False" | "FALSE" => return Ok(Value::Bool(false)),
        _ => {}
    }
    if regex(&NOT_FINITE, r"^([-+]?\.(inf|Inf|INF)|\.(nan|NaN|NAN))$").is_match(text) {
        return Err(format!("{text}, which is not a finite number"));
    }
    if regex(&INTEGER, r"^[-+]?[0-9]+$").is_match(text) {
        return Ok(integer(text.strip_prefix('+').unwrap_or(text), 10, text));
    }
    if let Some(octal) = text.strip_prefix("0o").filter(|rest| is_digits(rest, 8)) {
        return Ok(integer(octal, 8, text));
    }
    if let Some(hex) = text.strip_prefix("0x").filter(|rest| is_digits(rest, 16)) {
        return Ok(integer(hex, 16, text));
    }
    if regex(
        &FLOAT,
        r"^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?$",
    )
    .is_match(text)
    {
        return text
            .parse::<f64>()
            .ok()
            .and_then(Number::from_f64)
            .map(Value::Number)
            .ok_or_else(|| format!("{text}, which is not a finite number"));
    }
    Ok(Value::String(text.to_owned()))
}

fn is_digits(text: &str, radix: u32) -> bool {
    !text.is_empty() && text.chars().all(|c| c.is_digit(radix))
}

/// An integer in `radix`; one too large for 64 bits becomes the nearest float, which is still a
/// finite number.
fn integer(digits: &str, radix: u32, original: &str) -> Value {
    let negative = digits.starts_with('-');
    let magnitude = digits.trim_start_matches('-');
    if let Ok(unsigned) = u64::from_str_radix(magnitude, radix) {
        if !negative {
            return Value::Number(unsigned.into());
        }
        if let Some(signed) = 0i64.checked_sub_unsigned(unsigned) {
            return Value::Number(signed.into());
        }
    }
    let float = magnitude.chars().fold(0f64, |sum, c| {
        sum * f64::from(radix) + f64::from(c.to_digit(radix).unwrap_or(0))
    });
    let float = if negative { -float } else { float };
    Number::from_f64(float)
        .map(Value::Number)
        .unwrap_or_else(|| Value::String(original.to_owned()))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn frontmatter(yaml: &str) -> Result<Map<String, Value>, FrontmatterError> {
        parse(&format!("---\n{yaml}---\nbody\n"))
            .map(|found| found.expect("an opening fence").fields)
    }

    #[test]
    fn reads_the_core_schema() {
        let parsed = frontmatter(
            "name: hello\n\
             date: 2026-11-01\n\
             yes: no\n\
             when: 12:30:00\n\
             n: -12\n\
             plus: +7\n\
             hex: 0x1F\n\
             oct: 0o17\n\
             legacy: 0777\n\
             f: 1.5e3\n\
             dot: 1.\n\
             half: .5\n\
             nothing: ~\n\
             empty:\n\
             up: TRUE\n\
             quoted: \"123\"\n\
             single: 'true'\n\
             list: [a, 1, null]\n\
             nested:\n  deep:\n    - x: y\n",
        )
        .unwrap();
        assert_eq!(
            Value::Object(parsed),
            json!({
                "name": "hello",
                "date": "2026-11-01",
                "yes": "no",
                "when": "12:30:00",
                "n": -12,
                "plus": 7,
                "hex": 31,
                "oct": 15,
                "legacy": 777,
                "f": 1500.0,
                "dot": 1.0,
                "half": 0.5,
                "nothing": null,
                "empty": null,
                "up": true,
                "quoted": "123",
                "single": "true",
                "list": ["a", 1, null],
                "nested": { "deep": [{ "x": "y" }] },
            })
        );
    }

    #[test]
    fn reads_block_scalars_and_crlf() {
        let parsed = parse("---\r\nname: a\r\ndescription: |\r\n  one\r\n  two\r\n---\r\nbody")
            .unwrap()
            .unwrap();
        assert_eq!(parsed.fields["description"], json!("one\ntwo\n"));
        assert_eq!(parsed.body_line, 7);
        assert_eq!(
            &"---\r\nname: a\r\ndescription: |\r\n  one\r\n  two\r\n---\r\nbody"
                [parsed.body_offset..],
            "body"
        );
    }

    #[test]
    fn large_integers_stay_finite_numbers() {
        let parsed = frontmatter(
            "big: 18446744073709551616\nmax: 18446744073709551615\nmin: -9223372036854775808\n",
        )
        .unwrap();
        assert_eq!(parsed["max"], json!(18_446_744_073_709_551_615u64));
        assert_eq!(parsed["min"], json!(i64::MIN));
        assert!(parsed["big"].as_f64().is_some_and(f64::is_finite));
    }

    fn forbidden_what(yaml: &str) -> String {
        match frontmatter(yaml) {
            Err(FrontmatterError::Forbidden { what, .. }) => what,
            other => panic!("{yaml:?}: {other:?}"),
        }
    }

    #[test]
    fn refuses_what_the_rules_forbid() {
        for (yaml, expected) in [
            ("name: &n hello\ndescription: *n\n", "anchor"),
            ("name: &n hello\n", "anchor"),
            ("name: !!str hello\n", "tag"),
            ("name: !custom hello\n", "tag"),
            ("a: .inf\n", "finite"),
            ("a: -.INF\n", "finite"),
            ("a: .nan\n", "finite"),
            ("a: 1e999\n", "finite"),
            ("1: x\n", "key"),
            ("true: x\n", "key"),
            ("~: x\n", "key"),
            ("? [a]\n: x\n", "key"),
            ("a: 1\na: 2\n", "repeated"),
        ] {
            let what = forbidden_what(yaml);
            assert!(what.contains(expected), "{yaml:?}: {what}");
        }
        assert!(matches!(
            frontmatter("name: hello\ndescription: *n\n"),
            Err(FrontmatterError::Syntax { .. } | FrontmatterError::Forbidden { .. })
        ));
    }

    #[test]
    fn not_a_mapping_and_syntax_errors_are_typed() {
        for yaml in ["- a\n- b\n", "just text\n", ""] {
            assert_eq!(
                frontmatter(yaml),
                Err(FrontmatterError::NotAMapping),
                "{yaml:?}"
            );
        }
        for yaml in ["a: [1\n", "a: b: c\n"] {
            assert!(
                matches!(frontmatter(yaml), Err(FrontmatterError::Syntax { .. })),
                "{yaml:?}"
            );
        }
    }

    #[test]
    fn refuses_a_second_document_and_deep_nesting() {
        // The closing line ends the frontmatter, so a second document needs a `...` marker.
        assert!(matches!(
            read_mapping("a: 1\n...\n--- x\nb: 2\n"),
            Err(FrontmatterError::MoreThanOneDocument { line: 4 })
        ));
        let deep = format!("a: {}{}\n", "[".repeat(200), "]".repeat(200));
        assert_eq!(
            frontmatter(&deep),
            Err(FrontmatterError::TooDeep { line: 2 })
        );
    }

    #[test]
    fn lines_are_relative_to_the_whole_text() {
        let text = "---\nname: a\ntitle: b\nname: c\n---\nbody\n";
        assert_eq!(
            parse(text),
            Err(FrontmatterError::Forbidden {
                what: "the repeated key \"name\"".to_owned(),
                line: 4,
            })
        );
        let error = parse("---\nname: a\nbad: [1\n---\n").unwrap_err();
        let FrontmatterError::Syntax { line, column, .. } = error else {
            panic!("{error:?}");
        };
        assert!(line >= 3 && column >= 1, "{line}:{column}");
    }

    #[test]
    fn no_opening_fence_is_not_an_error() {
        for text in [
            "",
            "name: a\n",
            "# title\n---\nname: a\n---\n",
            " ---\nname: a\n---\n",
            "--- \nname: a\n---\n",
            "----\nname: a\n---\n",
        ] {
            assert_eq!(parse(text), Ok(None), "{text:?}");
        }
    }

    #[test]
    fn needs_a_closing_fence_and_reports_the_body() {
        assert_eq!(parse("---\nname: a\n"), Err(FrontmatterError::Unclosed));
        assert_eq!(parse("---\n"), Err(FrontmatterError::Unclosed));
        assert_eq!(parse("---"), Err(FrontmatterError::Unclosed));
        let unterminated = parse("---\nname: a\n---").unwrap().unwrap();
        assert_eq!(unterminated.fields["name"], json!("a"));
        assert_eq!(unterminated.body_offset, "---\nname: a\n---".len());
        assert_eq!(unterminated.body_line, 4);
        let text = "---\nname: a\n---\nline one\nline two\n";
        let found = parse(text).unwrap().unwrap();
        assert_eq!(&text[found.body_offset..], "line one\nline two\n");
        assert_eq!(found.body_line, 4);
        // An empty block is not a mapping.
        assert_eq!(parse("---\n---\nbody"), Err(FrontmatterError::NotAMapping));
    }

    #[test]
    fn body_offsets_count_bytes_not_characters() {
        let text = "---\ntitle: caf\u{e9} \u{1f600}\n---\n\u{e9}body\n";
        let found = parse(text).unwrap().unwrap();
        assert_eq!(&text[found.body_offset..], "\u{e9}body\n");
        assert_eq!(found.fields["title"], json!("caf\u{e9} \u{1f600}"));
    }

    #[test]
    fn messages_are_generic() {
        for error in [
            FrontmatterError::Unclosed,
            FrontmatterError::NotAMapping,
            forbidden("a YAML tag", 2),
            FrontmatterError::TooDeep { line: 2 },
            FrontmatterError::Syntax {
                line: 2,
                column: 3,
                message: "bad".to_owned(),
            },
            FrontmatterError::MoreThanOneDocument { line: 5 },
        ] {
            let text = error.to_string();
            assert!(text.starts_with("the frontmatter"), "{text}");
            assert!(!text.contains("SKILL"), "{text}");
        }
    }
}
