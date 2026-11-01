//! Command arguments: one JSON object, or `key=value` pairs.
//!
//! This is `packages/cli/src/args.ts`: a value is JSON when it parses as JSON and a string
//! otherwise (`count=2`, `done=true`, `tags=["a","b"]`, `title=milk`), and a word without `=` is
//! an error. The words arrive already split by the shell, so each word is one pair; a single word
//! that holds several pairs (`'a=1 b=2'`) is split by the AFD CLI's rules.

use serde_json::{Map, Value};

fn is_space(c: char) -> bool {
    matches!(c, ' ' | '\t' | '\n' | '\r')
}

/// Index of the quote that closes the one at `start`; `"` honours backslash escapes.
fn closing_quote(chars: &[char], start: usize) -> Result<usize, String> {
    let quote = chars[start];
    let mut i = start + 1;
    while i < chars.len() {
        let c = chars[i];
        if quote == '"' && c == '\\' {
            i += 1;
        } else if c == quote {
            return Ok(i);
        }
        i += 1;
    }
    Err(format!(
        "Unterminated {quote} quote in: {}",
        chars[start..].iter().collect::<String>()
    ))
}

/// Index of the bracket that closes the JSON array or object opened at `start`.
fn closing_bracket(chars: &[char], start: usize) -> Result<usize, String> {
    let mut depth = 0usize;
    let mut i = start;
    while i < chars.len() {
        match chars[i] {
            '"' => i = closing_quote(chars, i)?,
            '{' | '[' => depth += 1,
            '}' | ']' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    return Ok(i);
                }
            }
            _ => {}
        }
        i += 1;
    }
    Err(format!(
        "Unbalanced brackets in: {}",
        chars[start..].iter().collect::<String>()
    ))
}

/// Split `key=value` pairs on whitespace. A value that starts with a quote runs to the closing
/// quote, and one that starts with `{` or `[` runs to the matching bracket, so either may contain
/// spaces. Quotes and brackets elsewhere (`note=don't`) are ordinary characters.
fn split_pairs(input: &str) -> Result<Vec<String>, String> {
    let chars: Vec<char> = input.chars().collect();
    let mut tokens = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        if is_space(chars[i]) {
            i += 1;
            continue;
        }
        let mut token = String::new();
        let mut at_value_start = true;
        let mut saw_equals = false;
        while i < chars.len() && !is_space(chars[i]) {
            let c = chars[i];
            let end = if at_value_start && (c == '"' || c == '\'') {
                Some(closing_quote(&chars, i)?)
            } else if at_value_start && saw_equals && (c == '{' || c == '[') {
                Some(closing_bracket(&chars, i)?)
            } else {
                None
            };
            if let Some(end) = end {
                token.extend(&chars[i..=end]);
                i = end + 1;
                at_value_start = false;
                continue;
            }
            token.push(c);
            i += 1;
            at_value_start = c == '=' && !saw_equals;
            if c == '=' {
                saw_equals = true;
            }
        }
        tokens.push(token);
    }
    Ok(tokens)
}

fn parse_value(value: &str) -> Value {
    if value.chars().count() >= 2 && value.starts_with('\'') && value.ends_with('\'') {
        return Value::String(value[1..value.len() - 1].to_owned());
    }
    serde_json::from_str(value).unwrap_or_else(|_| Value::String(value.to_owned()))
}

fn parse_pair(token: &str) -> Result<(String, Value), String> {
    match token.find('=') {
        Some(equals) if equals > 0 => Ok((
            token[..equals].to_owned(),
            parse_value(&token[equals + 1..]),
        )),
        _ => Err(format!("Expected key=value, got \"{token}\"")),
    }
}

/// Parse the words after a command name: one JSON object when the first word starts with `{`
/// (the words are joined with spaces), otherwise `key=value` pairs. No words gives `{}`.
pub(crate) fn parse_input(words: &[String]) -> Result<Value, String> {
    let Some(first) = words.first() else {
        return Ok(Value::Object(Map::new()));
    };
    if first.trim_start().starts_with('{') {
        return match serde_json::from_str::<Value>(words.join(" ").trim()) {
            Ok(value @ Value::Object(_)) => Ok(value),
            Ok(_) => Err("Expected a JSON object".to_owned()),
            Err(error) => Err(error.to_string()),
        };
    }
    let tokens = if words.len() == 1 {
        split_pairs(first)?
    } else {
        words.to_vec()
    };
    let mut object = Map::new();
    for token in &tokens {
        let (key, value) = parse_pair(token)?;
        object.insert(key, value);
    }
    Ok(Value::Object(object))
}

/// The message printed when [`parse_input`] rejects the words.
pub(crate) fn describe_error(reason: &str) -> String {
    format!("Invalid arguments ({reason}). Use a JSON object or key=value pairs.")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn words(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| (*item).to_owned()).collect()
    }

    #[test]
    fn no_words_is_an_empty_object() {
        assert_eq!(parse_input(&[]).unwrap(), json!({}));
    }

    #[test]
    fn a_json_object_parses() {
        let parsed = parse_input(&words(&[r#"{"title":"Buy  milk"}"#])).unwrap();
        assert_eq!(parsed, json!({"title": "Buy  milk"}));
    }

    #[test]
    fn a_json_object_split_over_words_is_joined() {
        let parsed = parse_input(&words(&[r#"{"a":"#, "1}"])).unwrap();
        assert_eq!(parsed, json!({"a": 1}));
    }

    #[test]
    fn values_are_json_when_they_parse_and_strings_otherwise() {
        let parsed = parse_input(&words(&[
            "count=2",
            "done=true",
            r#"tags=["a","b"]"#,
            "title=milk",
            "note=two words",
            "quoted='single'",
        ]))
        .unwrap();
        assert_eq!(
            parsed,
            json!({
                "count": 2,
                "done": true,
                "tags": ["a", "b"],
                "title": "milk",
                "note": "two words",
                "quoted": "single",
            })
        );
    }

    #[test]
    fn one_word_may_hold_several_pairs() {
        let parsed = parse_input(&words(&[r#"a=1 b="x y" c=[1, 2] d=don't"#])).unwrap();
        assert_eq!(
            parsed,
            json!({"a": 1, "b": "x y", "c": [1, 2], "d": "don't"})
        );
    }

    #[test]
    fn a_word_without_equals_is_an_error() {
        let error = parse_input(&words(&["count=2", "oops"])).unwrap_err();
        assert!(error.contains("Expected key=value"), "{error}");
        assert!(parse_input(&words(&["=3"])).is_err());
    }

    #[test]
    fn a_proto_key_stays_an_argument() {
        let parsed = parse_input(&words(&["__proto__=1"])).unwrap();
        assert_eq!(parsed, json!({"__proto__": 1}));
    }

    #[test]
    fn broken_json_is_an_error() {
        assert!(parse_input(&words(&["{not json}"])).is_err());
    }
}
