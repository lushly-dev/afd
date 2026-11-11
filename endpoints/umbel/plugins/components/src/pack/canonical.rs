//! Canonical bytes (`JSON.stringify` of sorted keys, tab indent, a final line feed), and the
//! lexing that lets `serde_json` read what JavaScript reads.
//!
//! `serde_json` refuses two things `JSON.parse` accepts: a string with an unpaired surrogate
//! escape, and a number too large for a double. [`prepare`] rewrites both before parsing, so the
//! file goes on to the checks that give it the code Specimen gives it (specification, section 3.3).

use std::borrow::Cow;
use std::collections::HashSet;
use std::fmt::Write as _;

use serde_json::Value;

/// What [`prepare`] gives the parser.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Prepared<'a> {
    /// The text to parse.
    pub(crate) text: Cow<'a, str>,
    /// The character written for each unpaired surrogate escape: one this file uses nowhere else,
    /// so a string holds it exactly when it held such an escape. `None` when there are none.
    pub(crate) marker: Option<char>,
}

/// Replaces each unpaired surrogate escape with a character the file does not use, and each valid
/// number too large for a double with `{}`, a value that fails every field a number can reach
/// exactly as JavaScript's `Infinity` does. Anything else malformed is left for the parser to
/// refuse.
pub(crate) fn prepare(text: &str) -> Prepared<'_> {
    let (first, any) = rewrite(text, "\\ufffd");
    if !any {
        return Prepared {
            text: first,
            marker: None,
        };
    }
    let marker = unused_character(text);
    let escape = format!("\\u{:04x}", marker as u32);
    Prepared {
        text: rewrite(text, &escape).0,
        marker: Some(marker),
    }
}

/// The first character in the Basic Multilingual Plane the file does not write, plainly or as an
/// escape, so it counts as one code point as a surrogate does; the noncharacters and private use
/// area first. A file that uses all of them keeps U+FFFD, which can only refuse more.
fn unused_character(text: &str) -> char {
    let mut used: HashSet<u32> = text.chars().map(u32::from).collect();
    let bytes = text.as_bytes();
    for index in 0..bytes.len() {
        if let Some(unit) = escape_at(bytes, index) {
            used.insert(u32::from(unit));
        }
    }
    (0xFDD0..=0xFDEF)
        .chain(0xE000..=0xF8FF)
        .chain(0x80..=0xFFFD)
        .filter(|code| !used.contains(code))
        .find_map(char::from_u32)
        .unwrap_or('\u{FFFD}')
}

/// `text` with each unpaired surrogate escape replaced by `replacement` and each overflowing
/// number by `{}`, and whether it had an unpaired surrogate escape.
fn rewrite<'a>(text: &'a str, replacement: &str) -> (Cow<'a, str>, bool) {
    let bytes = text.as_bytes();
    let mut out = String::new();
    let mut any = false;
    let mut copied = 0;
    let mut index = 0;
    while let Some(&byte) = bytes.get(index) {
        match byte {
            b'"' => {
                let end = string_end(bytes, index);
                if let Some(fixed) = text
                    .get(index..end)
                    .and_then(|token| fix_string(token, replacement))
                {
                    any = true;
                    out.push_str(text.get(copied..index).unwrap_or_default());
                    out.push_str(&fixed);
                    copied = end;
                }
                index = end;
            }
            b'-' | b'0'..=b'9' => {
                let end = number_end(bytes, index);
                let token = text.get(index..end).unwrap_or_default();
                if json_number(token) && token.parse::<f64>().is_ok_and(f64::is_infinite) {
                    out.push_str(text.get(copied..index).unwrap_or_default());
                    out.push_str("{}");
                    copied = end;
                }
                index = end;
            }
            _ => index += 1,
        }
    }
    let result = if copied == 0 {
        Cow::Borrowed(text)
    } else {
        out.push_str(text.get(copied..).unwrap_or_default());
        Cow::Owned(out)
    };
    (result, any)
}

/// Whether `token` is a number by JSON's grammar, which is narrower than Rust's float parsing.
fn json_number(token: &str) -> bool {
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    let token = token.strip_prefix('-').unwrap_or(token);
    let (mantissa, exponent) = match token.find(['e', 'E']) {
        Some(at) => (&token[..at], Some(&token[at + 1..])),
        None => (token, None),
    };
    let (whole, fraction) = match mantissa.split_once('.') {
        Some((whole, fraction)) => (whole, Some(fraction)),
        None => (mantissa, None),
    };
    let exponent_ok = exponent.is_none_or(|e| digits(e.strip_prefix(['+', '-']).unwrap_or(e)));
    digits(whole)
        && (whole == "0" || !whole.starts_with('0'))
        && fraction.is_none_or(digits)
        && exponent_ok
}

/// The index just past the string opening at `start`, or the end of the text.
fn string_end(bytes: &[u8], start: usize) -> usize {
    let mut index = start + 1;
    while let Some(&byte) = bytes.get(index) {
        match byte {
            b'\\' => index += 2,
            b'"' => return index + 1,
            _ => index += 1,
        }
    }
    bytes.len()
}

fn number_end(bytes: &[u8], start: usize) -> usize {
    let mut index = start;
    while bytes
        .get(index)
        .is_some_and(|byte| matches!(byte, b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9'))
    {
        index += 1;
    }
    index
}

fn hex4(bytes: &[u8], at: usize) -> Option<u16> {
    let text = std::str::from_utf8(bytes.get(at..at + 4)?).ok()?;
    if !text.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    u16::from_str_radix(text, 16).ok()
}

/// The code unit of a `\uXXXX` escape at `at`.
fn escape_at(bytes: &[u8], at: usize) -> Option<u16> {
    if bytes.get(at) == Some(&b'\\') && bytes.get(at + 1) == Some(&b'u') {
        hex4(bytes, at + 2)
    } else {
        None
    }
}

/// `token`, a whole string with its quotes, with each unpaired surrogate escape replaced by
/// `replacement`; `None` when it has none.
fn fix_string(token: &str, replacement: &str) -> Option<String> {
    let bytes = token.as_bytes();
    let mut out = None::<String>;
    let mut copied = 0;
    let mut index = 1;
    while let Some(&byte) = bytes.get(index) {
        if byte != b'\\' {
            index += 1;
            continue;
        }
        let Some(unit) = escape_at(bytes, index) else {
            // Another escape: `\\ud800` is an escaped backslash, then plain text.
            index += 2;
            continue;
        };
        let paired = (0xD800..=0xDBFF).contains(&unit)
            && escape_at(bytes, index + 6).is_some_and(|low| (0xDC00..=0xDFFF).contains(&low));
        if paired {
            index += 12;
        } else if (0xD800..=0xDFFF).contains(&unit) {
            let fixed = out.get_or_insert_with(String::new);
            fixed.push_str(token.get(copied..index).unwrap_or_default());
            fixed.push_str(replacement);
            index += 6;
            copied = index;
        } else {
            index += 6;
        }
    }
    out.map(|mut fixed| {
        fixed.push_str(token.get(copied..).unwrap_or_default());
        fixed
    })
}

/// The one writing a pack file may have: `JSON.stringify` with sorted keys and a tab indent, and
/// a final line feed.
pub(crate) fn canonical_json(value: &Value) -> String {
    let mut out = String::new();
    write_value(&mut out, value, 0);
    out.push('\n');
    out
}

fn indent(out: &mut String, depth: usize) {
    out.push('\n');
    for _ in 0..depth {
        out.push('\t');
    }
}

fn write_value(out: &mut String, value: &Value, depth: usize) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(flag) => out.push_str(if *flag { "true" } else { "false" }),
        Value::Number(number) => write_number(out, number),
        Value::String(text) => write_string(out, text),
        Value::Array(items) if items.is_empty() => out.push_str("[]"),
        Value::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                indent(out, depth + 1);
                write_value(out, item, depth + 1);
            }
            indent(out, depth);
            out.push(']');
        }
        Value::Object(map) if map.is_empty() => out.push_str("{}"),
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
            out.push('{');
            for (index, key) in keys.into_iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                indent(out, depth + 1);
                write_string(out, key);
                out.push_str(": ");
                if let Some(item) = map.get(key) {
                    write_value(out, item, depth + 1);
                }
            }
            indent(out, depth);
            out.push('}');
        }
    }
}

/// Integers only: a pack's numbers have passed the schema by the time a file is compared.
fn write_number(out: &mut String, number: &serde_json::Number) {
    if let Some(value) = number.as_i64() {
        let _ = write!(out, "{value}");
    } else if let Some(value) = number.as_u64() {
        let _ = write!(out, "{value}");
    } else if let Some(value) = number.as_f64() {
        // `as` saturates, and the schema has held the value to the safe integers. `-0` is `0`.
        let _ = write!(out, "{}", value as i64);
    }
}

fn write_string(out: &mut String, text: &str) {
    out.push('"');
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{C}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}
