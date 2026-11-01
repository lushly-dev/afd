//! A skill's frontmatter (`spec/mcp-resources.md`, S2): a line `---`, one YAML mapping, a line
//! `---`.
//!
//! The YAML is read with the YAML 1.2 core schema, so `2026-11-01` unquoted is a string, `yes`
//! is a string and `0x10` is 16, and with no tags, anchors or aliases. Every value is a string,
//! a finite number, a boolean, null, a sequence or a mapping, and every key is a string. The
//! parser is `saphyr-parser`'s event stream; the JSON value is built here, so those rules are
//! ours and not a library's defaults.

use std::sync::OnceLock;

use regex::Regex;
use saphyr_parser::{Event, Parser, ScalarStyle};
use serde_json::{Map, Number, Value};

/// Nesting deeper than this is refused: the frontmatter is metadata, and the reader keeps its own
/// stack so no input can overflow the thread's.
const MAX_DEPTH: usize = 64;

/// Parse the frontmatter at the start of `text` into a JSON object.
///
/// # Errors
/// The rule the frontmatter breaks.
pub(crate) fn parse(text: &str) -> Result<Map<String, Value>, String> {
    let yaml = extract(text)?;
    read_mapping(yaml)
}

/// The YAML between the opening and the closing `---` line.
fn extract(text: &str) -> Result<&str, String> {
    let mut lines = text.split_inclusive('\n');
    let is_fence = |line: &str| line.trim_end_matches(['\n', '\r']) == "---";
    match lines.next() {
        Some(first) if is_fence(first) => {}
        _ => return Err("SKILL.md must begin with a line ---".to_owned()),
    }
    let start = text.len() - lines.clone().map(str::len).sum::<usize>();
    let mut end = start;
    for line in lines {
        if is_fence(line) {
            return Ok(&text[start..end]);
        }
        end += line.len();
    }
    Err("the frontmatter has no closing line ---".to_owned())
}

enum Frame {
    Sequence(Vec<Value>),
    Mapping {
        entries: Map<String, Value>,
        key: Option<String>,
    },
}

fn read_mapping(yaml: &str) -> Result<Map<String, Value>, String> {
    let mut stack: Vec<Frame> = Vec::new();
    let mut root: Option<Value> = None;
    let mut documents = 0usize;
    for event in Parser::new_from_str(yaml) {
        let (event, _) =
            event.map_err(|error| format!("the frontmatter is not valid YAML: {error}"))?;
        let value = match event {
            Event::Nothing | Event::StreamStart | Event::StreamEnd | Event::DocumentEnd => continue,
            Event::DocumentStart(_) => {
                documents += 1;
                if documents > 1 {
                    return Err("the frontmatter must be one YAML document".to_owned());
                }
                continue;
            }
            Event::Alias(_) => return Err("the frontmatter uses a YAML alias".to_owned()),
            Event::Scalar(text, style, anchor, tag) => {
                refuse_decoration(anchor, tag.is_some())?;
                if matches!(style, ScalarStyle::Plain) {
                    resolve_plain(&text)?
                } else {
                    Value::String(text.into_owned())
                }
            }
            Event::SequenceStart(anchor, tag) => {
                refuse_decoration(anchor, tag.is_some())?;
                open(&mut stack, Frame::Sequence(Vec::new()))?;
                continue;
            }
            Event::MappingStart(anchor, tag) => {
                refuse_decoration(anchor, tag.is_some())?;
                open(
                    &mut stack,
                    Frame::Mapping {
                        entries: Map::new(),
                        key: None,
                    },
                )?;
                continue;
            }
            Event::SequenceEnd | Event::MappingEnd => match stack.pop() {
                Some(Frame::Sequence(items)) => Value::Array(items),
                Some(Frame::Mapping { entries, .. }) => Value::Object(entries),
                None => return Err("the frontmatter is not valid YAML".to_owned()),
            },
        };
        match stack.last_mut() {
            None => root = Some(value),
            Some(Frame::Sequence(items)) => items.push(value),
            Some(Frame::Mapping { entries, key }) => match key.take() {
                Some(key) => {
                    if entries.insert(key.clone(), value).is_some() {
                        return Err(format!("the frontmatter repeats the key \"{key}\""));
                    }
                }
                None => match value {
                    Value::String(name) => *key = Some(name),
                    _ => return Err("a mapping key must be a string".to_owned()),
                },
            },
        }
    }
    match root {
        Some(Value::Object(entries)) => Ok(entries),
        _ => Err("the frontmatter must be one YAML mapping".to_owned()),
    }
}

/// Open a collection inside the frame on top of `stack`.
fn open(stack: &mut Vec<Frame>, frame: Frame) -> Result<(), String> {
    if stack.len() >= MAX_DEPTH {
        return Err(format!(
            "the frontmatter is nested more than {MAX_DEPTH} levels"
        ));
    }
    if matches!(stack.last(), Some(Frame::Mapping { key: None, .. })) {
        return Err("a mapping key must be a string".to_owned());
    }
    stack.push(frame);
    Ok(())
}

fn refuse_decoration(anchor: usize, tagged: bool) -> Result<(), String> {
    if anchor != 0 {
        return Err("the frontmatter uses a YAML anchor".to_owned());
    }
    if tagged {
        return Err("the frontmatter uses a YAML tag".to_owned());
    }
    Ok(())
}

fn regex(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("a valid pattern"))
}

/// A plain scalar by the YAML 1.2 core schema, as a JSON value.
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
        return Err(format!(
            "the frontmatter holds {text}, which is not a finite number"
        ));
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
            .ok_or_else(|| format!("the frontmatter holds {text}, which is not a finite number"));
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

    fn frontmatter(yaml: &str) -> Result<Map<String, Value>, String> {
        parse(&format!("---\n{yaml}---\nbody\n"))
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
        let parsed =
            parse("---\r\nname: a\r\ndescription: |\r\n  one\r\n  two\r\n---\r\nbody").unwrap();
        assert_eq!(parsed["description"], json!("one\ntwo\n"));
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

    #[test]
    fn refuses_what_the_rules_forbid() {
        for (yaml, expected) in [
            ("name: &n hello\ndescription: *n\n", "anchor"),
            ("name: hello\ndescription: *n\n", "YAML"),
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
            ("a: 1\na: 2\n", "repeats"),
            ("- a\n- b\n", "mapping"),
            ("just text\n", "mapping"),
            ("", "mapping"),
            ("a: [1\n", "YAML"),
            ("a: b: c\n", "YAML"),
        ] {
            let error = frontmatter(yaml).unwrap_err();
            assert!(error.contains(expected), "{yaml:?}: {error}");
        }
    }

    #[test]
    fn refuses_a_second_document_and_deep_nesting() {
        assert!(read_mapping("a: 1\n...\n---\nb: 2\n")
            .unwrap_err()
            .contains("one YAML document"));
        let deep = format!("a: {}{}\n", "[".repeat(200), "]".repeat(200));
        assert!(frontmatter(&deep).unwrap_err().contains("nested"));
    }

    #[test]
    fn needs_both_fences() {
        assert!(parse("name: a\n").unwrap_err().contains("begin"));
        assert!(parse("# title\n---\nname: a\n---\n")
            .unwrap_err()
            .contains("begin"));
        assert!(parse("---\nname: a\n").unwrap_err().contains("closing"));
        assert_eq!(parse("---\nname: a\n---").unwrap()["name"], json!("a"));
    }
}
